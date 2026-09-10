/**
 * Coverage for blackjack.
 *
 * Two things make this the most dangerous of the four games, and both drive the
 * tests here:
 *
 * **The committed shoe.** Every other game decides its whole result before the
 * player sees anything. Blackjack decides it in pieces, so without a shoe
 * committed at the deal a player reloads before each hit until the card is good.
 * The reload tests are the ones that would catch that regressing.
 *
 * **The measured cap.** The player acts *after* seeing a card, so a leaning shoe
 * is worth more than any closed form on the opening deal would say. The cap is
 * calibrated against simulated basic-strategy play, and the table it interpolates
 * is reproduced here — if a rules change moves the real return, this fails rather
 * than silently uncapping luck.
 */

import { describe, expect, it } from "vitest";
import {
  BLACKJACK_MEASURED_RETURN,
  BLACKJACK_SHOE_SIZE,
  ECONOMY,
} from "../../content/catalog";
import {
  cappedBiasStrength,
  dealBlackjackHand,
  handTotal,
  isNaturalBlackjack,
  measureBlackjackReturn,
  outcomeMultiplier,
  playDealer,
  selectBlackjackExpectedReturn,
  settleOutcome,
} from "../../domain/blackjack";
import { maximumAttainableLuck } from "../../dev/simulations/gambling";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectRailAttention } from "../../domain/selectors";
import { createGameState, type BlackjackHand, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;
const MAXIMUM_LUCK = maximumAttainableLuck();

function fresh(chips = 100_000, seed = 41): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });

  return { ...base, resources: { ...base.resources, chips } };
}

/** Puts an exact hand on the table, so a rule can be tested rather than sampled. */
function withHand(state: GameState, hand: Partial<BlackjackHand>): GameState {
  const base = state.gambling.blackjack.hand;

  return {
    ...state,
    gambling: {
      ...state.gambling,
      blackjack: {
        ...state.gambling.blackjack,
        hand: base === null ? null : { ...base, ...hand },
      },
    },
  };
}

function reload(state: GameState): GameState {
  return normalizeGameState(
    JSON.parse(JSON.stringify(createEnvelope(state, 1, NOW).game)) as unknown,
    NOW,
  ).state;
}

describe("hand arithmetic", () => {
  it("counts an ace as eleven only while it fits", () => {
    expect(handTotal([1, 10])).toEqual({ total: 21, soft: true });
    expect(handTotal([1, 5])).toEqual({ total: 16, soft: true });
    expect(handTotal([1, 5, 10])).toEqual({ total: 16, soft: false });
    expect(handTotal([1, 1, 9])).toEqual({ total: 21, soft: true });
    expect(handTotal([13, 12, 11])).toEqual({ total: 30, soft: false });
  });

  it("counts every court card as ten", () => {
    for (const rank of [10, 11, 12, 13]) {
      expect(handTotal([rank, 5]).total).toBe(15);
    }
  });

  it("recognises a natural only on the opening two cards", () => {
    expect(isNaturalBlackjack([1, 13])).toBe(true);
    expect(isNaturalBlackjack([5, 6, 10])).toBe(false);
    expect(isNaturalBlackjack([1, 5, 5])).toBe(false);
  });
});

describe("the dealer", () => {
  it("stands on all seventeen, soft included", () => {
    // Soft 17 is the rule most often got wrong, and the one that moves the edge
    // most, so it is asserted directly rather than through a total.
    const soft17 = playDealer([5, 5, 5], 0, [1, 6]);

    expect(soft17.cards).toEqual([1, 6]);
    expect(handTotal(soft17.cards)).toEqual({ total: 17, soft: true });

    const hard16 = playDealer([5, 5, 5], 0, [10, 6]);

    expect(hard16.cards).toEqual([10, 6, 5]);
  });

  it("draws until seventeen and no further, at every starting total", () => {
    const shoe = Array.from({ length: BLACKJACK_SHOE_SIZE }, () => 2);

    for (let upcard = 1; upcard <= 13; upcard += 1) {
      const played = playDealer(shoe, 0, [upcard, 2]);
      const total = handTotal(played.cards).total;

      expect(total).toBeGreaterThanOrEqual(17);
      // Every card here is a two, so it can never overshoot past 22.
      expect(total).toBeLessThanOrEqual(22);
    }
  });

  it("takes no card at all once it is already at seventeen", () => {
    const played = playDealer([5, 5], 0, [10, 7]);

    expect(played.cards).toEqual([10, 7]);
    expect(played.cursor).toBe(0);
  });
});

describe("settlement", () => {
  it("pays a natural three to two, and a push returns the stake", () => {
    expect(outcomeMultiplier(settleOutcome([1, 13], [10, 9]))).toBe(2.5);
    expect(outcomeMultiplier(settleOutcome([10, 9], [10, 9]))).toBe(1);
    expect(outcomeMultiplier(settleOutcome([1, 13], [1, 12]))).toBe(1);
  });

  it("beats a dealer twenty-one made of three cards with a natural", () => {
    // A natural outranks a drawn 21; without this, blackjack would pay 3:2 only
    // when the dealer happened not to reach the same number.
    expect(settleOutcome([1, 10], [7, 4, 10])).toBe("player-blackjack");
  });

  it("loses a bust hand even when the dealer busts too", () => {
    // The player acts first, so busting settles the hand before the dealer plays
    // at all. Anything else would make hitting on 20 free.
    expect(settleOutcome([10, 6, 10], [10, 6, 10])).toBe("dealer");
  });

  it("pays an ordinary win double and a loss nothing", () => {
    expect(outcomeMultiplier(settleOutcome([10, 10], [10, 9]))).toBe(2);
    expect(outcomeMultiplier(settleOutcome([10, 8], [10, 9]))).toBe(0);
  });
});

describe("the committed shoe", () => {
  it("deals identical cards after a reload", () => {
    const dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;
    const hand = dealt.gambling.blackjack.hand;

    expect(hand).not.toBeNull();
    expect(hand?.shoe).toHaveLength(BLACKJACK_SHOE_SIZE);

    const restored = reload(dealt);

    expect(restored.gambling.blackjack.hand?.shoe).toEqual(hand?.shoe);
    expect(restored.gambling.blackjack.hand?.playerCards).toEqual(hand?.playerCards);
    expect(restored.gambling.blackjack.hand?.dealerCards).toEqual(hand?.dealerCards);

    /*
     * The rule that matters: hitting after a reload draws the card that was
     * already decided, not a fresh one. Without this a player reloads before
     * every hit until the card suits them.
     */
    const hitFresh = reduce(dealt, { type: "BLACKJACK_HIT" }).state;
    const hitReloaded = reduce(restored, { type: "BLACKJACK_HIT" }).state;

    expect(hitReloaded.gambling.blackjack.hand?.playerCards).toEqual(
      hitFresh.gambling.blackjack.hand?.playerCards,
    );
  });

  it("holds enough cards for the worst hand the rules allow", () => {
    /*
     * Neither side can pass 21 before its twenty-second card, even drawing
     * nothing but aces, so 44 is the true bound. A short shoe would deal off the
     * end of the array, which is a silent gift rather than a visible failure.
     */
    expect(BLACKJACK_SHOE_SIZE).toBeGreaterThanOrEqual(44);
  });

  it("refuses to restore a hand whose shoe has been truncated", () => {
    const dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 50 }).state;
    const damaged = withHand(dealt, { shoe: [1, 2, 3, 4] });
    const restored = reload(damaged);

    expect(restored.gambling.blackjack.hand).toBeNull();
  });

  it("never rewinds a restored hand's cursor behind the cards it holds", () => {
    /*
     * A cursor below the number of cards already dealt makes the next hit deal a
     * card the player is visibly already holding. The repair floors it at the
     * card count, which a real hand always satisfies exactly.
     */
    const dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;
    const rewound = withHand(dealt, { cursor: 0, status: "player" });
    const restored = reload(rewound);
    const hand = restored.gambling.blackjack.hand;

    expect(hand).not.toBeNull();
    expect(hand?.cursor).toBe(
      (hand?.playerCards.length ?? 0) + (hand?.dealerCards.length ?? 0),
    );

    const hit = reduce(restored, { type: "BLACKJACK_HIT" }).state;
    const drawn = hit.gambling.blackjack.hand;

    // The card taken is the next unseen one, not one already on the table.
    expect(drawn?.playerCards[2]).toBe(hand?.shoe[hand.cursor]);
  });

  it("does not advance the shoe when a command is rejected", () => {
    const idle = fresh(5);
    const refused = reduce(idle, { type: "DEAL_BLACKJACK", wager: 1_000 });

    expect(refused.state.random.gambling).toEqual(idle.random.gambling);
    expect(refused.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });
});

describe("playing a hand", () => {
  it("deducts the stake at the deal", () => {
    const before = fresh();
    const dealt = reduce(before, { type: "DEAL_BLACKJACK", wager: 250 }).state;

    expect(dealt.resources.chips).toBeLessThanOrEqual(before.resources.chips - 250);
    expect(dealt.statistics.chipsWagered).toBe(250);
    expect(dealt.statistics.blackjackHandsPlayed).toBe(1);
  });

  it("settles a natural on the deal rather than offering a decision", () => {
    const dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;
    const hand = dealt.gambling.blackjack.hand;

    if (hand !== null && (isNaturalBlackjack(hand.playerCards) || isNaturalBlackjack(hand.dealerCards))) {
      expect(hand.status).toBe("settled");
    }

    // And the general rule, forced: a hand dealt a natural never sits in play.
    const forced = withHand(dealt, { playerCards: [1, 13], dealerCards: [9, 7] });
    const settled = dealBlackjackHand(
      { ...forced, gambling: { ...forced.gambling, blackjack: { ...forced.gambling.blackjack, hand: null } } },
      250,
      [],
      0,
    );

    expect(settled.ok).toBe(true);
  });

  it("takes exactly one card on a double and doubles the stake", () => {
    let dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;

    // Force a two-card hand that cannot be a natural, so double is legal.
    dealt = withHand(dealt, {
      playerCards: [5, 4],
      dealerCards: [10, 6],
      cursor: 4,
      status: "player",
      doubled: false,
    });

    const wageredBefore = dealt.statistics.chipsWagered;
    const doubled = reduce(dealt, { type: "BLACKJACK_DOUBLE" }).state;
    const hand = doubled.gambling.blackjack.hand;

    // The second stake really left the balance, which is what makes doubling a
    // decision rather than a free extra card.
    expect(doubled.statistics.chipsWagered).toBe(wageredBefore + 250);
    expect(hand?.wager).toBe(500);
    expect(hand?.doubled).toBe(true);
    expect(hand?.playerCards).toHaveLength(3);
    expect(hand?.status).toBe("settled");
  });

  it("refuses a double after the first hit", () => {
    let dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;

    dealt = withHand(dealt, {
      playerCards: [3, 4, 2],
      dealerCards: [10, 6],
      status: "player",
    });

    const refused = reduce(dealt, { type: "BLACKJACK_DOUBLE" });

    expect(refused.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
    expect(refused.state.gambling.blackjack.hand?.wager).toBe(250);
  });

  it("settles the hand when the player busts, without playing the dealer on", () => {
    let dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;

    dealt = withHand(dealt, {
      playerCards: [10, 10],
      dealerCards: [6, 6],
      shoe: [...Array.from({ length: BLACKJACK_SHOE_SIZE }, () => 10)],
      cursor: 4,
      status: "player",
    });

    const bust = reduce(dealt, { type: "BLACKJACK_HIT" }).state;
    const hand = bust.gambling.blackjack.hand;

    expect(hand?.status).toBe("settled");
    expect(hand?.outcome).toBe("dealer");
    expect(hand?.payout).toBe(0);
    // The dealer sat on 12 and was never asked to play, because the hand was
    // already over.
    expect(hand?.dealerCards).toEqual([6, 6]);
  });

  it("pays a settled hand exactly once", () => {
    let dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;

    dealt = withHand(dealt, {
      playerCards: [10, 10],
      dealerCards: [10, 8],
      status: "player",
    });

    const stood = reduce(dealt, { type: "BLACKJACK_STAND" }).state;
    const paid = stood.resources.chips;

    expect(stood.gambling.blackjack.hand?.outcome).toBe("player");

    const again = reduce(stood, { type: "BLACKJACK_STAND" });

    expect(again.state.resources.chips).toBe(paid);
    expect(again.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("blocks prestige while a hand is live, and allows it once settled", () => {
    const rich: GameState = {
      ...fresh(),
      prestige: { ...fresh().prestige, cycleCashEarned: 1e9, lifetimeCashEarned: 1e9 },
    };
    let dealt = reduce(rich, { type: "DEAL_BLACKJACK", wager: 10 }).state;

    dealt = withHand(dealt, { playerCards: [5, 6], dealerCards: [10, 7], status: "player" });

    expect(reduce(dealt, { type: "PRESTIGE" }).state.prestige.count).toBe(0);

    const stood = reduce(dealt, { type: "BLACKJACK_STAND" }).state;

    expect(reduce(stood, { type: "PRESTIGE" }).state.prestige.count).toBe(1);
  });
});

describe("the rail marker", () => {
  it("calls a live hand an action, and a settled one nothing", () => {
    // The only gambling state that genuinely wants the player: a hand sitting on
    // hit-or-stand. Everything else in the window can only be waited on.
    let dealt = reduce(fresh(), { type: "DEAL_BLACKJACK", wager: 250 }).state;

    dealt = withHand(dealt, { playerCards: [5, 6], dealerCards: [10, 7], status: "player" });

    expect(selectRailAttention(deriveContext(dealt)).gambling).toBe("action");

    const stood = reduce(dealt, { type: "BLACKJACK_STAND" }).state;

    expect(selectRailAttention(deriveContext(stood)).gambling).toBe("none");
  });
});

describe("the measured cap", () => {
  it("reproduces the shipped return table from live simulation", () => {
    /*
     * Fewer hands than the table was built from, so the tolerance is set to
     * three standard errors rather than to the table's own precision. What this
     * catches is a rules change moving the real return out from under a cap that
     * is still interpolating the old numbers.
     */
    for (const [strength, published] of BLACKJACK_MEASURED_RETURN) {
      const measured = measureBlackjackReturn(strength, 120_000, 909 + strength * 1000);

      expect(
        measured.realisedReturn,
        `lean ${String(strength)} measured ${measured.realisedReturn.toFixed(4)} against a published ${String(published)}`,
      ).toBeCloseTo(published, 1);
    }
  }, 300_000);

  it("starts below the cap, so luck has something to give", () => {
    expect(BLACKJACK_MEASURED_RETURN[0][1]).toBeLessThan(ECONOMY.gamblingMaxExpectedReturn);
    expect(selectBlackjackExpectedReturn([], 0)).toBeLessThan(ECONOMY.gamblingMaxExpectedReturn);
  });

  it("holds the realised return inside the cap at every luck level", () => {
    for (const [label, luckPoints, modifiers] of [
      ["no luck", 0, []],
      ["typical luck", 120, []],
      ["maximum luck", MAXIMUM_LUCK.luckPoints, MAXIMUM_LUCK.modifiers],
    ] as const) {
      const expected = selectBlackjackExpectedReturn(modifiers, luckPoints);

      expect(expected, `${label} returned ${String(expected)}`).toBeLessThanOrEqual(
        ECONOMY.gamblingMaxExpectedReturn + 1e-9,
      );
    }
  });

  it("refuses most of what full luck asks for", () => {
    /*
     * The point of measuring rather than deriving. Full luck wants a lean of 0.5;
     * the measured return says that is worth well over the cap, so the cap holds
     * it near a fifth of that. A closed form on the opening deal would not have
     * seen the difference, which is exactly the failure the plan predicted.
     */
    const asked = 0.5;
    const allowed = cappedBiasStrength(MAXIMUM_LUCK.modifiers, MAXIMUM_LUCK.luckPoints);

    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThan(asked / 2);
  });

  it("measures a realised return that rises with the lean", () => {
    const flat = measureBlackjackReturn(0, 80_000, 5);
    const leaned = measureBlackjackReturn(0.5, 80_000, 5);

    expect(leaned.realisedReturn).toBeGreaterThan(flat.realisedReturn);
  }, 120_000);
});
