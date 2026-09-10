/**
 * The chip slot game. Payout multipliers are fixed and published; luck only
 * shifts symbol weights, and the resulting expected return is capped by blending
 * back toward the base weights. That machinery lives in `luckBias.ts`, shared
 * with the other three games; the functions here are the slot game's names for
 * it, since the panel, simulations and tests all speak in symbols.
 */

import {
  ECONOMY,
  SLOT_REEL_COUNT,
  SLOT_SPIN_DURATION_MS,
  SLOT_SYMBOLS,
  SLOT_SYMBOL_IDS,
} from "../content/catalog";
import type { SlotSymbolId } from "../content/catalog";
import { isChipWager, isStakeable } from "../content/chipGames";
import type { DomainEffect } from "./commands";
import {
  baseWeightsOf,
  blendToCap,
  blendWeightMaps,
  luckBiasedWeights,
  weightProbabilities,
  type BiasableOutcome,
} from "./luckBias";
import { type Modifier } from "./modifiers";
import { nextWeightedSequence, type RngState, type WeightedOption } from "./rng";
import type { CommittedSpin, GameState, SpinSummary } from "./state";
import { applyTransaction, type TransactionPlan } from "./transactions";

export type SlotWeights = Record<SlotSymbolId, number>;

/** The symbol list in the shape the shared luck pathway consumes. */
const SLOT_OUTCOMES: ReadonlyArray<BiasableOutcome<SlotSymbolId>> = SLOT_SYMBOL_IDS.map((id) => ({
  id,
  baseWeight: SLOT_SYMBOLS[id].baseWeight,
  luckWeightBias: SLOT_SYMBOLS[id].luckWeightBias,
  tags: SLOT_SYMBOLS[id].tags,
}));

export function baseSlotWeights(): SlotWeights {
  return baseWeightsOf(SLOT_OUTCOMES);
}

/** Weights after the luck curve and any tagged outcome-weight modifiers. */
export function luckAdjustedSlotWeights(
  modifiers: readonly Modifier[],
  luckPoints: number,
): SlotWeights {
  return luckBiasedWeights(SLOT_OUTCOMES, modifiers, luckPoints);
}

export function symbolProbabilities(weights: SlotWeights): Record<SlotSymbolId, number> {
  return weightProbabilities(weights);
}

/**
 * Exact expected return per chip wagered, enumerated analytically rather than
 * simulated. Only three-reel matching classes pay.
 */
export function expectedReturn(weights: SlotWeights): number {
  const probabilities = symbolProbabilities(weights);

  return SLOT_SYMBOL_IDS.reduce((total, id) => {
    const symbol = SLOT_SYMBOLS[id];
    const p = probabilities[id];
    const triple = p ** 3 * symbol.tripleMultiplier;
    const pair = 3 * p ** 2 * (1 - p) * symbol.pairMultiplier;

    return total + triple + pair;
  }, 0);
}

/**
 * Applies the MVP expected-return cap. If luck would push the return above the
 * cap, the weights are blended back toward the base distribution until it sits
 * at the cap, so no undocumented payout rule is ever introduced.
 */
export function cappedSlotWeights(
  modifiers: readonly Modifier[],
  luckPoints: number,
): SlotWeights {
  return blendToCap(
    baseSlotWeights(),
    luckAdjustedSlotWeights(modifiers, luckPoints),
    ECONOMY.gamblingMaxExpectedReturn,
    blendWeightMaps,
    expectedReturn,
  );
}

export function selectSlotWeights(
  modifiers: readonly Modifier[],
  luckPoints: number,
): SlotWeights {
  return cappedSlotWeights(modifiers, luckPoints);
}

export function selectExpectedReturn(
  modifiers: readonly Modifier[],
  luckPoints: number,
): number {
  return expectedReturn(selectSlotWeights(modifiers, luckPoints));
}

/** Fixed payout rule: three of a kind, then exactly two of a kind. */
export function payoutMultiplier(symbolIds: readonly SlotSymbolId[]): number {
  const counts = new Map<SlotSymbolId, number>();

  for (const id of symbolIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  for (const [id, count] of counts) {
    if (count === symbolIds.length && symbolIds.length > 0) {
      return SLOT_SYMBOLS[id].tripleMultiplier;
    }
  }

  for (const [id, count] of counts) {
    if (count === 2) {
      return SLOT_SYMBOLS[id].pairMultiplier;
    }
  }

  return 0;
}

export type GamblingBlock =
  | { kind: "spin-in-progress" }
  | { kind: "unknown-wager" }
  | { kind: "insufficient-chips"; required: number; available: number }
  | { kind: "no-committed-spin" }
  | { kind: "wrong-spin" }
  | { kind: "transaction-failed"; message: string };

export type GamblingOutcome =
  | { ok: true; state: GameState; effects: DomainEffect[] }
  | { ok: false; block: GamblingBlock };

/** The slot game's own name for the shared rule: can this amount be staked? */
export function isValidWager(wager: number): boolean {
  return isStakeable(wager);
}

export interface SpinDraw {
  rngState: RngState;
  symbolIds: SlotSymbolId[];
}

export function drawSpin(rngState: RngState, weights: SlotWeights): SpinDraw {
  const options: Array<WeightedOption<SlotSymbolId>> = SLOT_SYMBOL_IDS.map((id) => ({
    value: id,
    weight: weights[id],
  }));

  const draw = nextWeightedSequence(rngState, options, SLOT_REEL_COUNT);

  return {
    rngState: draw.state,
    symbolIds: draw.value.map((id) => id ?? SLOT_SYMBOL_IDS[0]),
  };
}

/**
 * Deducts the wager and commits the complete result in one transaction. The
 * reels then animate toward a result that already exists.
 */
export function startSpin(
  state: GameState,
  wager: number,
  modifiers: readonly Modifier[],
  luckPoints: number,
): GamblingOutcome {
  if (state.gambling.committedSpin !== null) {
    return { ok: false, block: { kind: "spin-in-progress" } };
  }

  if (!isValidWager(wager)) {
    return { ok: false, block: { kind: "unknown-wager" } };
  }

  if (state.resources.chips < wager) {
    return {
      ok: false,
      block: { kind: "insufficient-chips", required: wager, available: state.resources.chips },
    };
  }

  const weights = selectSlotWeights(modifiers, luckPoints);
  const draw = drawSpin(state.random.gambling, weights);
  const multiplier = payoutMultiplier(draw.symbolIds);
  const payout = Math.floor(wager * multiplier);
  const betId = `spin-${state.statistics.spinsPlayed + 1}`;

  const committedSpin: CommittedSpin = {
    betId,
    gameId: "game.slots",
    wager,
    symbolIds: draw.symbolIds,
    multiplier,
    payout,
    luckPoints,
    animationRemainingMs: SLOT_SPIN_DURATION_MS,
  };

  const plan: TransactionPlan = {
    label: `spin:${betId}`,
    costs: [{ resource: "chips", amount: wager }],
    grants: [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          // The rung stays selected when the stake was not one: "bet it all"
          // plays an arbitrary amount without leaving every button unpressed.
          selectedWager: isChipWager(wager) ? wager : current.gambling.selectedWager,
          committedSpin,
        },
        random: { ...current.random, gambling: draw.rngState },
        statistics: {
          ...current.statistics,
          spinsPlayed: current.statistics.spinsPlayed + 1,
          chipsWagered: current.statistics.chipsWagered + wager,
        },
      }),
    ],
  };

  const outcome = applyTransaction(state, plan);

  if (!outcome.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: outcome.message } };
  }

  return {
    ok: true,
    state: outcome.state,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.slots.spin" },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

/** Settles a committed spin exactly once, granting winnings if any. */
export function completeSpin(state: GameState, betId: string): GamblingOutcome {
  const committed = state.gambling.committedSpin;

  if (committed === null) {
    return { ok: false, block: { kind: "no-committed-spin" } };
  }

  if (committed.betId !== betId) {
    return { ok: false, block: { kind: "wrong-spin" } };
  }

  const summary: SpinSummary = {
    betId: committed.betId,
    gameId: "game.slots",
    wager: committed.wager,
    symbolIds: committed.symbolIds,
    multiplier: committed.multiplier,
    payout: committed.payout,
    net: committed.payout - committed.wager,
  };

  const plan: TransactionPlan = {
    label: `spin-settle:${betId}`,
    costs: [],
    grants: committed.payout > 0 ? [{ resource: "chips", amount: committed.payout }] : [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          committedSpin: null,
          recentResults: [summary, ...current.gambling.recentResults].slice(
            0,
            ECONOMY.recentSpinHistoryLength,
          ),
        },
        statistics: {
          ...current.statistics,
          chipsWon: current.statistics.chipsWon + committed.payout,
          chipsEarned: current.statistics.chipsEarned + committed.payout,
        },
      }),
    ],
  };

  const outcome = applyTransaction(state, plan);

  if (!outcome.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: outcome.message } };
  }

  return {
    ok: true,
    state: outcome.state,
    effects: [
      ...(committed.payout > 0
        ? [{ type: "PLAY_SOUND", soundId: "sound.slots.win" } as const]
        : []),
      { type: "SHOW_SPIN_RESULT", summary },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

/** Advances only the reel animation clock; the result is already decided. */
export function tickSpinAnimation(state: GameState, elapsedMs: number): GameState {
  const committed = state.gambling.committedSpin;

  if (committed === null || elapsedMs <= 0) {
    return state;
  }

  return {
    ...state,
    gambling: {
      ...state.gambling,
      committedSpin: {
        ...committed,
        animationRemainingMs: Math.max(0, committed.animationRemainingMs - elapsedMs),
      },
    },
  };
}
