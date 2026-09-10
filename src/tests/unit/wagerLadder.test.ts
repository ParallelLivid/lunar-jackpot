/**
 * Coverage for the chip wager ladder.
 *
 * The ladder widening is the easy half. The half worth testing is the change of
 * meaning underneath it: ladder membership used to decide whether a stake could
 * be *played*, and now only decides which button is pressed. Any positive whole
 * number the player can cover is a legal stake, which is what lets "Bet it all"
 * exist without a rung for every possible balance.
 */

import { describe, expect, it } from "vitest";
import {
  CHIP_WAGERS,
  STAKE_EVERYTHING,
  isChipWager,
  isStakeable,
} from "../../content/chipGames";
import { INFINITE } from "../../domain/numbers";
import { reduce } from "../../domain/reducer";
import {
  deriveContext,
  selectBlackjackView,
  selectDepthWagerView,
  selectGamblingView,
  selectRouletteView,
} from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;

function withChips(chips: number, seed = 4): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });

  return {
    ...base,
    resources: { ...base.resources, chips },
    statistics: { ...base.statistics, deepestDepth: 40, deepestDepthThisCycle: 40 },
  };
}

describe("the ladder", () => {
  it("reaches a million", () => {
    expect(CHIP_WAGERS).toEqual([10, 50, 250, 1_000, 10_000, 100_000, 1_000_000]);
  });

  it("plays every rung it offers", () => {
    for (const wager of CHIP_WAGERS) {
      const state = withChips(wager);
      const spun = reduce(state, { type: "START_SLOT_SPIN", wager });

      expect(spun.state.gambling.committedSpin?.wager, String(wager)).toBe(wager);
      expect(spun.state.resources.chips).toBe(0);
    }
  });

  it("keeps ladder membership for selection and stakeability for play", () => {
    // The two questions came apart in this chunk, and conflating them again is
    // what would quietly forbid "Bet it all".
    expect(isChipWager(1_000)).toBe(true);
    expect(isChipWager(1_337)).toBe(false);
    expect(isStakeable(1_337)).toBe(true);
    expect(isStakeable(0)).toBe(false);
    expect(isStakeable(-5)).toBe(false);
    expect(isStakeable(12.5)).toBe(false);
    // An infinite balance has no "everything" to bet.
    expect(isStakeable(INFINITE)).toBe(false);
  });
});

describe("betting it all", () => {
  it("stakes the whole balance and leaves nothing", () => {
    const state = withChips(1_337);
    const spun = reduce(state, { type: "START_SLOT_SPIN", wager: 1_337 });

    expect(spun.state.gambling.committedSpin?.wager).toBe(1_337);
    expect(spun.state.resources.chips).toBe(0);
  });

  it("does not disturb which rung is selected", () => {
    /*
     * The selection means "the rung I picked". Writing an off-ladder stake into
     * it would leave no button pressed *and* store a value the loader repairs on
     * the next load — a selection that silently changes itself.
     */
    const state = withChips(1_337);
    const chosen = reduce(state, { type: "SET_WAGER", wager: 250 }).state;
    const spun = reduce(chosen, { type: "START_SLOT_SPIN", wager: 1_337 }).state;

    expect(spun.gambling.selectedWager).toBe(250);
    expect(normalizeGameState(spun, NOW).state.gambling.selectedWager).toBe(250);
  });

  it("is offered by all four games, and priced at the balance", () => {
    const context = deriveContext(withChips(1_337));

    for (const view of [
      selectGamblingView(context),
      selectRouletteView(context),
      selectBlackjackView(context),
      selectDepthWagerView(context),
    ]) {
      expect(view.betEverything.wager).toBe(1_337);
      expect(view.betEverything.available.available).toBe(true);
    }
  });

  it("is offered even when the selected rung is unaffordable", () => {
    // Forty chips with the thousand rung selected is exactly when a player wants
    // this button, so it must not inherit the rung's affordability.
    const state = reduce(withChips(40), { type: "SET_WAGER", wager: 1_000 }).state;
    const view = selectGamblingView(deriveContext(state));

    expect(view.spin.available).toBe(false);
    expect(view.betEverything.available.available).toBe(true);
    expect(view.betEverything.wager).toBe(40);
  });

  it("refuses, with a reason, when there is nothing or everything to bet", () => {
    const broke = selectGamblingView(deriveContext(withChips(0))).betEverything;

    expect(broke.available.available).toBe(false);
    expect(broke.available.reason).toContain("no chips");

    const endless = selectGamblingView(deriveContext(withChips(INFINITE))).betEverything;

    expect(endless.available.available).toBe(false);
    expect(endless.available.reason).toContain("outgrown counting");
  });

  it("refuses while the game is busy, naming what is holding it", () => {
    const spinning = reduce(withChips(1_000), { type: "START_SLOT_SPIN", wager: 10 }).state;
    const view = selectGamblingView(deriveContext(spinning));

    expect(view.betEverything.available.available).toBe(false);
    expect(view.betEverything.available.reason).toContain("resolving");
  });
});

describe("what an all-in forecloses", () => {
  it("leaves blackjack unable to double", () => {
    /*
     * Doubling takes a second stake equal to the first, and after betting
     * everything there is nothing to take. The check already existed; this pins
     * it, because raising the ladder is what makes an all-in a normal thing to
     * do rather than a curiosity.
     */
    const dealt = reduce(withChips(500), { type: "DEAL_BLACKJACK", wager: 500 }).state;
    const view = selectBlackjackView(deriveContext(dealt));

    expect(dealt.resources.chips).toBe(0);

    if (dealt.gambling.blackjack.hand?.status === "player") {
      expect(view.double.available).toBe(false);
      expect(view.double.reason).toContain("chips");
    }
  });
});

/**
 * "Bet it all" as a selection.
 *
 * It used to play immediately. It is a rung now, and the reason that needed a
 * state change rather than a markup change is the whole of what these cover: a
 * selection persists, and the balance underneath it does not hold still.
 */
describe("betting everything, as a selection", () => {
  /** Selecting it in each of the four games, by that game's own command. */
  const select = (state: GameState): GameState =>
    [
      { type: "SET_WAGER", wager: STAKE_EVERYTHING },
      { type: "SET_ROULETTE_WAGER", wager: STAKE_EVERYTHING },
      { type: "SET_BLACKJACK_WAGER", wager: STAKE_EVERYTHING },
      {
        type: "SET_DEPTH_WAGER",
        targetDepth: state.gambling.depthWager.selectedTargetDepth,
        stake: STAKE_EVERYTHING,
      },
    ].reduce((current, command) => reduce(current, command as never).state, state);

  it("is stored as a mode, not as the balance at the moment it was picked", () => {
    /*
     * The point of the whole chunk. A number captured on selection would be
     * stale by the time it was staked — machines pay out between the two clicks
     * — and staking a stale number is the one thing a bet must never do.
     */
    const picked = select(withChips(1_000));

    expect(picked.gambling.selectedWager).toBe(STAKE_EVERYTHING);

    const richer: GameState = {
      ...picked,
      resources: { ...picked.resources, chips: 7_500 },
    };

    for (const view of [
      selectGamblingView(deriveContext(richer)),
      selectRouletteView(deriveContext(richer)),
      selectBlackjackView(deriveContext(richer)),
    ]) {
      expect(view.selectedWager).toBe(7_500);
      expect(view.stakeIsEverything).toBe(true);
    }

    expect(selectDepthWagerView(deriveContext(richer)).selectedStake).toBe(7_500);
  });

  it("un-presses every numbered rung while it is the selection", () => {
    // Otherwise two things claim to be selected at once, which is worse than
    // either being wrong.
    const view = selectGamblingView(deriveContext(select(withChips(1_000))));

    expect(view.wagers.every((rung) => rung.wager !== view.selectedWager)).toBe(false);
    expect(view.stakeIsEverything).toBe(true);
  });

  it("blocks the play with the everything reason, not an affordability one", () => {
    /*
     * The trap this chunk had to avoid. Resolving "all" against a zero balance
     * gives a stake of 0, and `chips >= 0` is true — so an affordability test
     * alone would have left Spin enabled on a stake the domain then refuses.
     */
    const broke = selectGamblingView(deriveContext(select(withChips(0))));

    expect(broke.selectedWager).toBe(0);
    expect(broke.spin.available).toBe(false);
    expect(broke.spin.reason).toContain("no chips");

    const endless = selectBlackjackView(deriveContext(select(withChips(INFINITE))));

    expect(endless.deal.available).toBe(false);
    expect(endless.deal.reason).toContain("outgrown counting");
  });

  it("keeps the depth wager's payout quote honest", () => {
    // It multiplies the stake by the offered odds, so an unresolved "all" would
    // have quoted a payout of NaN.
    const view = selectDepthWagerView(deriveContext(select(withChips(2_000))));

    expect(view.selectedStake).toBe(2_000);
    expect(Number.isFinite(view.potentialPayout)).toBe(true);
    expect(view.potentialPayout).toBeGreaterThan(0);
  });

  it("survives a save round trip, and repairs anything else", () => {
    const picked = select(withChips(1_000));

    expect(normalizeGameState(picked, NOW).state.gambling.selectedWager).toBe(STAKE_EVERYTHING);
    expect(normalizeGameState(picked, NOW).state.gambling.blackjack.selectedWager).toBe(
      STAKE_EVERYTHING,
    );

    const nonsense: GameState = {
      ...picked,
      gambling: {
        ...picked.gambling,
        selectedWager: "everything" as never,
      },
    };

    expect(normalizeGameState(nonsense, NOW).state.gambling.selectedWager).toBe(CHIP_WAGERS[0]);
  });

  it("goes back to a rung when one is picked", () => {
    const back = reduce(select(withChips(1_000)), { type: "SET_WAGER", wager: 250 }).state;
    const view = selectGamblingView(deriveContext(back));

    expect(view.stakeIsEverything).toBe(false);
    expect(view.selectedWager).toBe(250);
  });
});
