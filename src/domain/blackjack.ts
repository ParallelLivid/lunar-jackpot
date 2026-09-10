/**
 * Blackjack, the only chip game with in-hand decisions. Two things follow from
 * that:
 *
 * The shoe is committed. Every card the hand could need is drawn the instant it
 * is dealt, and every hit takes the next already-decided card, so a player
 * cannot reload until the card is good.
 *
 * The cap is measured rather than derived. The player acts after seeing a card,
 * so a luck-shaded shoe is worth more than any closed form on the opening deal
 * would say. The cap interpolates realised returns measured from simulated
 * basic-strategy play — see `BLACKJACK_MEASURED_RETURN` — through the same
 * `blendToCap` every other game uses.
 */

import { ECONOMY } from "../content/catalog";
import {
  BLACKJACK_BLACKJACK_MULTIPLIER,
  BLACKJACK_LUCK_BIAS,
  BLACKJACK_LUCK_SHAPE,
  BLACKJACK_MEASURED_RETURN,
  BLACKJACK_PUSH_MULTIPLIER,
  BLACKJACK_RANKS,
  BLACKJACK_RANK_WEIGHT,
  BLACKJACK_SHOE_SIZE,
  BLACKJACK_WIN_MULTIPLIER,
  cardValue,
} from "../content/blackjack";
import { isChipWager, isStakeable } from "../content/chipGames";
import type { DomainEffect } from "./commands";
import { blendScalar, blendToCap, type WeightMap } from "./luckBias";
import { luckFactor, type Modifier } from "./modifiers";
import { nextWeighted, type RngState, type WeightedOption } from "./rng";
import type {
  BlackjackHand,
  BlackjackOutcome,
  BlackjackSummary,
  GameState,
} from "./state";
import { applyTransaction, type TransactionPlan } from "./transactions";

export type RankWeights = WeightMap<string>;

// ---------------------------------------------------------------------------
// Hand arithmetic
// ---------------------------------------------------------------------------

export interface HandTotal {
  /** The best total at or under 21, or the hard total once the hand is bust. */
  total: number;
  /** True when an ace is still being counted as eleven. */
  soft: boolean;
}

export function handTotal(cards: readonly number[]): HandTotal {
  const hard = cards.reduce((sum, rank) => sum + cardValue(rank), 0);
  const hasAce = cards.some((rank) => rank === 1);

  if (hasAce && hard + 10 <= 21) {
    return { total: hard + 10, soft: true };
  }

  return { total: hard, soft: false };
}

export function isBust(cards: readonly number[]): boolean {
  return handTotal(cards).total > 21;
}

/** Twenty-one on the opening two cards, and nothing else. */
export function isNaturalBlackjack(cards: readonly number[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}

// ---------------------------------------------------------------------------
// The shoe, and the shared luck-and-cap pathway
// ---------------------------------------------------------------------------

/**
 * The shoe at a given lean strength. Affine in `strength`, which lets the cap
 * blend it as a single scalar rather than as thirteen weights.
 */
export function shoeWeightsAt(strength: number): RankWeights {
  return BLACKJACK_RANKS.reduce((weights, rank) => {
    weights[String(rank)] = Math.max(
      0,
      BLACKJACK_RANK_WEIGHT * (1 + (BLACKJACK_LUCK_SHAPE[rank] ?? 0) * strength),
    );

    return weights;
  }, {} as RankWeights);
}

/**
 * Realised return at a lean strength, read off the measured table: linear
 * interpolation between points, flat beyond the ends. The table is monotonic in
 * strength, which is what `blendToCap` needs.
 */
export function measuredBlackjackReturn(strength: number): number {
  const table = BLACKJACK_MEASURED_RETURN;

  if (strength <= table[0][0]) {
    return table[0][1];
  }

  for (let index = 1; index < table.length; index += 1) {
    const [upperStrength, upperReturn] = table[index];

    if (strength <= upperStrength) {
      const [lowerStrength, lowerReturn] = table[index - 1];
      const span = upperStrength - lowerStrength;
      const t = span === 0 ? 0 : (strength - lowerStrength) / span;

      return lowerReturn + (upperReturn - lowerReturn) * t;
    }
  }

  return table[table.length - 1][1];
}

/**
 * How far luck may actually lean the shoe, after the cap. The cap runs over the
 * lean strength rather than the thirteen weights: they are affine in it, so
 * halving the strength equals blending the map halfway toward base, and the
 * measured-return table is indexed by the scalar.
 */
export function cappedBiasStrength(
  modifiers: readonly Modifier[],
  luckPoints: number,
): number {
  /*
   * Accepted for the shape every game's luck entry point has, and deliberately
   * not applied: a tagged `gambling.outcomeWeight` modifier would move the shoe
   * off the single lean strength the weights are affine in, invalidating the
   * measured table the cap interpolates.
   */
  void modifiers;

  const wanted = BLACKJACK_LUCK_BIAS * luckFactor(luckPoints);

  return blendToCap(
    0,
    wanted,
    ECONOMY.gamblingMaxExpectedReturn,
    blendScalar,
    measuredBlackjackReturn,
  );
}

export function selectShoeWeights(
  modifiers: readonly Modifier[],
  luckPoints: number,
): RankWeights {
  return shoeWeightsAt(cappedBiasStrength(modifiers, luckPoints));
}

export function selectBlackjackExpectedReturn(
  modifiers: readonly Modifier[],
  luckPoints: number,
): number {
  return measuredBlackjackReturn(cappedBiasStrength(modifiers, luckPoints));
}

export interface ShoeDraw {
  rngState: RngState;
  shoe: number[];
}

/**
 * Draws the whole committed shoe for one hand, as independent weighted draws
 * rather than a dealt-down six-deck shoe: over the dozen cards one hand can use
 * the difference is below the noise the measured return is calibrated against,
 * and the shoe stays a plain list of cards.
 */
export function drawShoe(rngState: RngState, weights: RankWeights): ShoeDraw {
  const options: Array<WeightedOption<number>> = BLACKJACK_RANKS.map((rank) => ({
    value: rank,
    weight: weights[String(rank)] ?? 0,
  }));

  let current = rngState;
  const shoe: number[] = [];

  for (let index = 0; index < BLACKJACK_SHOE_SIZE; index += 1) {
    const draw = nextWeighted(current, options);

    current = draw.state;
    shoe.push(draw.value ?? 1);
  }

  return { rngState: current, shoe };
}

// ---------------------------------------------------------------------------
// Dealer and settlement rules
// ---------------------------------------------------------------------------

/**
 * Plays the dealer out, standing on all 17, soft included. Takes and returns the
 * cursor rather than mutating, so one committed shoe always produces the same
 * dealer hand.
 */
export function playDealer(
  shoe: readonly number[],
  cursor: number,
  dealerCards: readonly number[],
): { cards: number[]; cursor: number } {
  const cards = [...dealerCards];
  let next = cursor;

  while (handTotal(cards).total < 17 && next < shoe.length) {
    cards.push(shoe[next]);
    next += 1;
  }

  return { cards, cursor: next };
}

export function settleOutcome(
  playerCards: readonly number[],
  dealerCards: readonly number[],
): BlackjackOutcome {
  const playerNatural = isNaturalBlackjack(playerCards);
  const dealerNatural = isNaturalBlackjack(dealerCards);

  if (playerNatural && dealerNatural) {
    return "push";
  }

  if (playerNatural) {
    return "player-blackjack";
  }

  if (dealerNatural) {
    return "dealer";
  }

  const player = handTotal(playerCards).total;
  const dealer = handTotal(dealerCards).total;

  if (player > 21) {
    return "dealer";
  }

  if (dealer > 21) {
    return "player";
  }

  if (player > dealer) {
    return "player";
  }

  if (player < dealer) {
    return "dealer";
  }

  return "push";
}

export function outcomeMultiplier(outcome: BlackjackOutcome): number {
  switch (outcome) {
    case "player-blackjack":
      return BLACKJACK_BLACKJACK_MULTIPLIER;
    case "player":
      return BLACKJACK_WIN_MULTIPLIER;
    case "push":
      return BLACKJACK_PUSH_MULTIPLIER;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Basic strategy, for measurement only
// ---------------------------------------------------------------------------

export type BasicStrategyMove = "hit" | "stand" | "double";

/**
 * A fixed basic-strategy bot for the reduced rule set, so the cap is measured
 * against a player who extracts the most from a leaning shoe. Calibrating
 * against weaker play would set the cap too high.
 */
export function basicStrategyMove(
  playerCards: readonly number[],
  dealerUpcard: number,
  canDouble: boolean,
): BasicStrategyMove {
  const { total, soft } = handTotal(playerCards);
  const up = cardValue(dealerUpcard);
  const aceUp = dealerUpcard === 1;
  // Treating an ace up as 11 keeps it out of the "vs 2 to 9" bands below.
  const upValue = aceUp ? 11 : up;

  if (soft) {
    if (total >= 19) {
      return "stand";
    }

    if (total === 18) {
      if (canDouble && upValue >= 3 && upValue <= 6) {
        return "double";
      }

      return upValue <= 8 ? "stand" : "hit";
    }

    if (total === 17) {
      return canDouble && upValue >= 3 && upValue <= 6 ? "double" : "hit";
    }

    if (total === 15 || total === 16) {
      return canDouble && upValue >= 4 && upValue <= 6 ? "double" : "hit";
    }

    if (total === 13 || total === 14) {
      return canDouble && upValue >= 5 && upValue <= 6 ? "double" : "hit";
    }

    return "hit";
  }

  if (total >= 17) {
    return "stand";
  }

  if (total >= 13) {
    return upValue <= 6 ? "stand" : "hit";
  }

  if (total === 12) {
    return upValue >= 4 && upValue <= 6 ? "stand" : "hit";
  }

  if (total === 11) {
    return canDouble && upValue <= 10 ? "double" : "hit";
  }

  if (total === 10) {
    return canDouble && upValue <= 9 ? "double" : "hit";
  }

  if (total === 9) {
    return canDouble && upValue >= 3 && upValue <= 6 ? "double" : "hit";
  }

  return "hit";
}

export interface BlackjackMeasurement {
  strength: number;
  hands: number;
  /** Chips returned per chip staked, doubled stakes included in both. */
  realisedReturn: number;
}

/**
 * Plays the basic-strategy bot over many hands at a fixed lean, producing the
 * number the cap is calibrated against. It uses the real dealer rules, shoe draw
 * and settlement, so a rules change moves it and the table test fails.
 */
export function measureBlackjackReturn(
  strength: number,
  hands: number,
  seed: number,
): BlackjackMeasurement {
  const weights = shoeWeightsAt(strength);
  // Seeded locally so a measurement is reproducible from its seed alone,
  // without depending on a stream name the game might later rename.
  let rngState: RngState = createSeededState(seed);
  let staked = 0;
  let returned = 0;

  for (let hand = 0; hand < hands; hand += 1) {
    const draw = drawShoe(rngState, weights);

    rngState = draw.rngState;

    const shoe = draw.shoe;
    let cursor = 4;
    const playerCards = [shoe[0], shoe[2]];
    const dealerCards = [shoe[1], shoe[3]];
    let stake = 1;

    if (!isNaturalBlackjack(playerCards) && !isNaturalBlackjack(dealerCards)) {
      let acting = true;

      while (acting && !isBust(playerCards)) {
        const move = basicStrategyMove(playerCards, dealerCards[0], playerCards.length === 2);

        if (move === "stand") {
          acting = false;
        } else if (move === "double") {
          stake = 2;
          playerCards.push(shoe[cursor]);
          cursor += 1;
          acting = false;
        } else {
          playerCards.push(shoe[cursor]);
          cursor += 1;
        }
      }
    }

    let finalDealer = dealerCards;

    if (!isBust(playerCards) && !isNaturalBlackjack(playerCards)) {
      finalDealer = playDealer(shoe, cursor, dealerCards).cards;
    }

    staked += stake;
    returned += stake * outcomeMultiplier(settleOutcome(playerCards, finalDealer));
  }

  return {
    strength,
    hands,
    realisedReturn: staked === 0 ? 0 : returned / staked,
  };
}

/** Local seeding so the measurement does not depend on a stream name. */
function createSeededState(seed: number): RngState {
  let value = (Math.trunc(seed) >>> 0) || 0x9e37_79b9;

  const next = (): number => {
    value = (value + 0x6d2b_79f5) | 0;
    let mixed = value;

    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    return (mixed ^ (mixed >>> 14)) >>> 0;
  };

  return { a: next(), b: next(), c: next(), d: next(), draws: 0 };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type BlackjackBlock =
  | { kind: "hand-in-progress" }
  | { kind: "no-hand" }
  | { kind: "hand-settled" }
  | { kind: "unknown-wager" }
  | { kind: "double-too-late" }
  | { kind: "insufficient-chips"; required: number; available: number }
  | { kind: "transaction-failed"; message: string };

export type BlackjackGameOutcome =
  | { ok: true; state: GameState; effects: DomainEffect[] }
  | { ok: false; block: BlackjackBlock };

function summaryOf(hand: BlackjackHand, outcome: BlackjackOutcome, payout: number): BlackjackSummary {
  return {
    betId: hand.betId,
    gameId: "game.blackjack",
    wager: hand.wager,
    payout,
    net: payout - hand.wager,
    outcome,
    playerTotal: handTotal(hand.playerCards).total,
    dealerTotal: handTotal(hand.dealerCards).total,
  };
}

/**
 * Finishes a hand: plays the dealer out where the rules call for it, pays, and
 * files the result. One function for every ending — stand, bust, double, natural
 * — so "who pays what" has a single implementation.
 */
function settleHand(state: GameState, hand: BlackjackHand): BlackjackGameOutcome {
  const playerBust = isBust(hand.playerCards);
  const playerNatural = isNaturalBlackjack(hand.playerCards);

  const dealer =
    playerBust || playerNatural
      ? { cards: hand.dealerCards, cursor: hand.cursor }
      : playDealer(hand.shoe, hand.cursor, hand.dealerCards);

  const outcome = settleOutcome(hand.playerCards, dealer.cards);
  const payout = Math.floor(hand.wager * outcomeMultiplier(outcome));

  const settled: BlackjackHand = {
    ...hand,
    dealerCards: dealer.cards,
    cursor: dealer.cursor,
    status: "settled",
    outcome,
    payout,
  };

  const summary = summaryOf(settled, outcome, payout);

  const plan: TransactionPlan = {
    label: `blackjack-settle:${hand.betId}`,
    costs: [],
    grants: payout > 0 ? [{ resource: "chips", amount: payout }] : [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          blackjack: {
            ...current.gambling.blackjack,
            hand: settled,
            recentResults: [summary, ...current.gambling.blackjack.recentResults].slice(
              0,
              ECONOMY.recentSpinHistoryLength,
            ),
          },
        },
        statistics: {
          ...current.statistics,
          chipsWon: current.statistics.chipsWon + payout,
          chipsEarned: current.statistics.chipsEarned + payout,
        },
      }),
    ],
  };

  const applied = applyTransaction(state, plan);

  if (!applied.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: applied.message } };
  }

  return {
    ok: true,
    state: applied.state,
    effects: [
      ...(payout > hand.wager
        ? [{ type: "PLAY_SOUND", soundId: "sound.blackjack.win" } as const]
        : []),
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

/** Deals a hand, committing the whole shoe before a single card is shown. */
export function dealBlackjackHand(
  state: GameState,
  wager: number,
  modifiers: readonly Modifier[],
  luckPoints: number,
): BlackjackGameOutcome {
  const existing = state.gambling.blackjack.hand;

  if (existing !== null && existing.status === "player") {
    return { ok: false, block: { kind: "hand-in-progress" } };
  }

  if (!isStakeable(wager)) {
    return { ok: false, block: { kind: "unknown-wager" } };
  }

  if (state.resources.chips < wager) {
    return {
      ok: false,
      block: { kind: "insufficient-chips", required: wager, available: state.resources.chips },
    };
  }

  const weights = selectShoeWeights(modifiers, luckPoints);
  const draw = drawShoe(state.random.gambling, weights);
  const betId = `blackjack-${String(state.statistics.blackjackHandsPlayed + 1)}`;

  const hand: BlackjackHand = {
    betId,
    gameId: "game.blackjack",
    wager,
    payout: 0,
    luckPoints,
    animationRemainingMs: 0,
    shoe: draw.shoe,
    // Two to the player, two to the dealer, dealt alternately as at a table.
    cursor: 4,
    playerCards: [draw.shoe[0], draw.shoe[2]],
    dealerCards: [draw.shoe[1], draw.shoe[3]],
    doubled: false,
    status: "player",
    outcome: null,
  };

  const plan: TransactionPlan = {
    label: `blackjack:${betId}`,
    costs: [{ resource: "chips", amount: wager }],
    grants: [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          blackjack: {
            ...current.gambling.blackjack,
            selectedWager: isChipWager(wager)
              ? wager
              : current.gambling.blackjack.selectedWager,
            hand,
          },
        },
        random: { ...current.random, gambling: draw.rngState },
        statistics: {
          ...current.statistics,
          blackjackHandsPlayed: current.statistics.blackjackHandsPlayed + 1,
          chipsWagered: current.statistics.chipsWagered + wager,
        },
      }),
    ],
  };

  const applied = applyTransaction(state, plan);

  if (!applied.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: applied.message } };
  }

  const dealt = applied.state.gambling.blackjack.hand;

  // A natural on either side ends the hand: there is no decision to offer, and
  // leaving it open would let a player hit on a blackjack.
  if (
    dealt !== null &&
    (isNaturalBlackjack(dealt.playerCards) || isNaturalBlackjack(dealt.dealerCards))
  ) {
    const settled = settleHand(applied.state, dealt);

    if (settled.ok) {
      return {
        ok: true,
        state: settled.state,
        effects: [
          { type: "PLAY_SOUND", soundId: "sound.blackjack.deal" },
          ...settled.effects,
        ],
      };
    }

    return settled;
  }

  return {
    ok: true,
    state: applied.state,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.blackjack.deal" },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

function liveHand(state: GameState): BlackjackHand | BlackjackBlock {
  const hand = state.gambling.blackjack.hand;

  if (hand === null) {
    return { kind: "no-hand" };
  }

  if (hand.status !== "player") {
    return { kind: "hand-settled" };
  }

  return hand;
}

function isBlock(value: BlackjackHand | BlackjackBlock): value is BlackjackBlock {
  return (value as BlackjackBlock).kind !== undefined;
}

/** Takes the next already-decided card. */
export function hitBlackjackHand(state: GameState): BlackjackGameOutcome {
  const hand = liveHand(state);

  if (isBlock(hand)) {
    return { ok: false, block: hand };
  }

  const drawn: BlackjackHand = {
    ...hand,
    playerCards: [...hand.playerCards, hand.shoe[hand.cursor] ?? 1],
    cursor: hand.cursor + 1,
  };

  const withCard: GameState = {
    ...state,
    gambling: {
      ...state.gambling,
      blackjack: { ...state.gambling.blackjack, hand: drawn },
    },
  };

  if (isBust(drawn.playerCards)) {
    return settleHand(withCard, drawn);
  }

  return {
    ok: true,
    state: withCard,
    effects: [{ type: "REQUEST_SAVE", immediate: true }],
  };
}

export function standBlackjackHand(state: GameState): BlackjackGameOutcome {
  const hand = liveHand(state);

  if (isBlock(hand)) {
    return { ok: false, block: hand };
  }

  return settleHand(state, hand);
}

/** Doubles the stake, takes exactly one card, and stands. */
export function doubleBlackjackHand(state: GameState): BlackjackGameOutcome {
  const hand = liveHand(state);

  if (isBlock(hand)) {
    return { ok: false, block: hand };
  }

  if (hand.playerCards.length !== 2 || hand.doubled) {
    return { ok: false, block: { kind: "double-too-late" } };
  }

  if (state.resources.chips < hand.wager) {
    return {
      ok: false,
      block: {
        kind: "insufficient-chips",
        required: hand.wager,
        available: state.resources.chips,
      },
    };
  }

  const doubled: BlackjackHand = {
    ...hand,
    wager: hand.wager * 2,
    doubled: true,
    playerCards: [...hand.playerCards, hand.shoe[hand.cursor] ?? 1],
    cursor: hand.cursor + 1,
  };

  const plan: TransactionPlan = {
    label: `blackjack-double:${hand.betId}`,
    costs: [{ resource: "chips", amount: hand.wager }],
    grants: [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          blackjack: { ...current.gambling.blackjack, hand: doubled },
        },
        statistics: {
          ...current.statistics,
          chipsWagered: current.statistics.chipsWagered + hand.wager,
        },
      }),
    ],
  };

  const applied = applyTransaction(state, plan);

  if (!applied.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: applied.message } };
  }

  return settleHand(applied.state, doubled);
}
