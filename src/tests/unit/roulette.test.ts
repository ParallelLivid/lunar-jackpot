/**
 * Coverage for roulette and the shared luck-and-cap pathway.
 *
 * The product owner's answer that luck affects every game turned the cap from a
 * slot-game detail into shared infrastructure, so the tests here are as much
 * about `luckBias.ts` as about the wheel: four independent implementations of
 * the cap would be four places for luck to become uncapped, and the tests that
 * matter are the ones that would catch that.
 */

import { describe, expect, it } from "vitest";
import {
  ECONOMY,
  ROULETTE_BETS,
  ROULETTE_BET_IDS,
  ROULETTE_POCKET_COUNT,
} from "../../content/catalog";
import type { Modifier, RouletteBetId } from "../../content/catalog";
import { maximumAttainableLuck } from "../../dev/simulations/gambling";
import { pocketColour, winningPockets } from "../../content/roulette";
import {
  ROULETTE_POCKETS,
  roulettePayoutMultiplier,
  selectRouletteExpectedReturn,
  selectWheelWeights,
  spinWheel,
} from "../../domain/roulette";
import { blendToCap, blendScalar } from "../../domain/luckBias";
import { describeBlock, reduce } from "../../domain/reducer";
import { prestigeBlock } from "../../domain/prestige";
import { createRngState } from "../../domain/rng";
import { createGameState, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";
import { exportSave, parseImport } from "../../persistence/exportImport";

const NOW = 1_700_000_000_000;

function fresh(chips = 100_000, seed = 31): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });

  return { ...base, resources: { ...base.resources, chips } };
}

/**
 * The strongest luck a player can actually reach, from the existing helper the
 * slot simulations use. Reimplementing it here would let the two drift, and the
 * whole point of a shared cap is that every game is measured at the same ceiling.
 */
const MAXIMUM_LUCK = maximumAttainableLuck();

function maximumLuckModifiers(): Modifier[] {
  return MAXIMUM_LUCK.modifiers;
}

describe("the wheel", () => {
  it("has thirty-seven pockets and one green", () => {
    expect(ROULETTE_POCKET_COUNT).toBe(37);
    expect(ROULETTE_POCKETS.filter((pocket) => pocketColour(pocket) === "green")).toEqual([0]);
    expect(ROULETTE_POCKETS.filter((pocket) => pocketColour(pocket) === "red")).toHaveLength(18);
    expect(ROULETTE_POCKETS.filter((pocket) => pocketColour(pocket) === "black")).toHaveLength(18);
  });

  it("never returns a pocket that is not on the wheel", () => {
    /*
     * Drawn against a heavily leaned wheel rather than a flat one: a bias that
     * pushed a weight negative would show up here as a draw falling off the end
     * of the option list.
     */
    const weights = selectWheelWeights(maximumLuckModifiers(), MAXIMUM_LUCK.luckPoints, "bet.straight", 17);
    let rngState = createRngState(4, "gambling");

    for (let spin = 0; spin < 5_000; spin += 1) {
      const draw = spinWheel(rngState, weights);

      rngState = draw.rngState;
      expect(Number.isInteger(draw.pocket)).toBe(true);
      expect(draw.pocket).toBeGreaterThanOrEqual(0);
      expect(draw.pocket).toBeLessThan(ROULETTE_POCKET_COUNT);
    }
  });
});

describe("published payouts", () => {
  it("pays every bet type its published multiplier, and nothing otherwise", () => {
    for (const betTypeId of ROULETTE_BET_IDS) {
      const definition = ROULETTE_BETS[betTypeId];
      const winners = new Set(winningPockets(betTypeId, 17));

      for (const pocket of ROULETTE_POCKETS) {
        expect(roulettePayoutMultiplier(betTypeId, 17, pocket)).toBe(
          winners.has(pocket) ? definition.multiplier : 0,
        );
      }
    }
  });

  it("loses every outside bet to zero", () => {
    /*
     * The zero is the entire house edge on an outside bet, so this is the one
     * pocket whose behaviour the whole game's pricing rests on.
     *
     * Green is excluded because it *is* the zero — a straight-up on the house's
     * own pocket rather than an outside bet with a hole in it. The exclusion is
     * written as "backs the zero" rather than naming the bet, so a second such
     * bet would be covered without an edit.
     */
    for (const betTypeId of ROULETTE_BET_IDS) {
      const pockets = ROULETTE_BETS[betTypeId].pockets;

      if (pockets === null || pockets.includes(0)) {
        continue;
      }

      expect(roulettePayoutMultiplier(betTypeId, 0, 0), betTypeId).toBe(0);
    }
  });

  it("pays green on zero and on nothing else", () => {
    expect(roulettePayoutMultiplier("bet.green", 0, 0)).toBe(36);

    for (let pocket = 1; pocket < ROULETTE_POCKET_COUNT; pocket += 1) {
      expect(roulettePayoutMultiplier("bet.green", 0, pocket), String(pocket)).toBe(0);
    }
  });

  it("prices green as a straight-up, not as the whole wheel", () => {
    /*
     * Thirty-seven would be the wheel itself and would give green a positive
     * expectation — the only correct bet on the table. It has to be priced like
     * any other single pocket, which is what the shared 36/37 test above then
     * confirms it is.
     */
    expect(ROULETTE_BETS["bet.green"].multiplier).toBe(
      ROULETTE_BETS["bet.straight"].multiplier,
    );
  });

  it("prices every bet at the same house edge with no luck", () => {
    for (const betTypeId of ROULETTE_BET_IDS) {
      // 36/37: one pocket of edge, whatever the bet.
      expect(selectRouletteExpectedReturn([], 0, betTypeId, 17)).toBeCloseTo(36 / 37, 9);
    }
  });
});

describe("the shared cap", () => {
  const luckLevels: Array<[string, number, Modifier[]]> = [
    ["no luck", 0, []],
    ["typical luck", 120, []],
    ["maximum luck", MAXIMUM_LUCK.luckPoints, maximumLuckModifiers()],
  ];

  it("holds every bet type inside the cap at every luck level", () => {
    for (const [label, luckPoints, modifiers] of luckLevels) {
      for (const betTypeId of ROULETTE_BET_IDS) {
        const expected = selectRouletteExpectedReturn(modifiers, luckPoints, betTypeId, 17);

        expect(
          expected,
          `${betTypeId} at ${label} returned ${String(expected)}`,
        ).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 1e-9);
      }
    }
  });

  it("lets luck improve the return until the cap, and never past it", () => {
    const none = selectRouletteExpectedReturn([], 0, "bet.red", 0);
    const some = selectRouletteExpectedReturn([], 200, "bet.red", 0);
    const most = selectRouletteExpectedReturn(
      maximumLuckModifiers(),
      MAXIMUM_LUCK.luckPoints,
      "bet.red",
      0,
    );

    expect(some).toBeGreaterThan(none);
    expect(most).toBeGreaterThanOrEqual(some);
    expect(most).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 1e-9);
  });

  it("bites hardest on the bet that is cheapest to bias", () => {
    /*
     * A single-pocket bias moves a straight-up bet's return far further per unit
     * of weight than an even-money one, so a wheel capped once for all bets
     * would leave the straight bet uncapped. Capping per bet is what this
     * asserts: at full luck both sit at the cap rather than one overshooting.
     */
    const modifiers = maximumLuckModifiers();
    const straight = selectRouletteExpectedReturn(modifiers, MAXIMUM_LUCK.luckPoints, "bet.straight", 7);
    const red = selectRouletteExpectedReturn(modifiers, MAXIMUM_LUCK.luckPoints, "bet.red", 0);

    expect(straight).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 1e-9);
    expect(red).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 1e-9);
  });

  it("hands back the base configuration when the base is already at the cap", () => {
    // Guards the branch that would otherwise blend toward something worse than
    // where it started.
    expect(blendToCap(0.5, 2, 0.4, blendScalar, (value) => value)).toBe(0.5);
  });

  it("measures a simulated return that matches the analytic one", () => {
    const betTypeId: RouletteBetId = "bet.dozen2";
    const weights = selectWheelWeights([], 300, betTypeId, 0);
    let rngState = createRngState(77, "gambling");
    let returned = 0;
    const spins = 200_000;

    for (let spin = 0; spin < spins; spin += 1) {
      const draw = spinWheel(rngState, weights);

      rngState = draw.rngState;
      returned += roulettePayoutMultiplier(betTypeId, 0, draw.pocket);
    }

    expect(returned / spins).toBeCloseTo(
      selectRouletteExpectedReturn([], 300, betTypeId, 0),
      2,
    );
  });
});

describe("committing a bet", () => {
  it("deducts the stake and decides the pocket in one command", () => {
    const before = fresh();
    const after = reduce(before, { type: "START_ROULETTE_SPIN", wager: 250 }).state;
    const committed = after.gambling.roulette.committedBet;

    expect(after.resources.chips).toBe(before.resources.chips - 250);
    expect(committed).not.toBeNull();
    expect(committed?.pocket).toBeGreaterThanOrEqual(0);
    expect(after.statistics.chipsWagered).toBe(250);
    expect(after.statistics.rouletteSpinsPlayed).toBe(1);
  });

  it("refuses a second bet while the wheel is turning", () => {
    const spinning = reduce(fresh(), { type: "START_ROULETTE_SPIN", wager: 10 }).state;
    const again = reduce(spinning, { type: "START_ROULETTE_SPIN", wager: 10 });

    expect(again.state.resources.chips).toBe(spinning.resources.chips);
    expect(again.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("survives a reload and pays exactly once", () => {
    const spinning = reduce(fresh(), { type: "START_ROULETTE_SPIN", wager: 1_000 }).state;
    const committed = spinning.gambling.roulette.committedBet;

    expect(committed).not.toBeNull();

    const restored = normalizeGameState(
      JSON.parse(JSON.stringify(createEnvelope(spinning, 1, NOW).game)) as unknown,
      NOW,
    ).state;

    // The whole result comes back, not just the fact that a bet existed.
    expect(restored.gambling.roulette.committedBet?.pocket).toBe(committed?.pocket);
    expect(restored.gambling.roulette.committedBet?.payout).toBe(committed?.payout);

    const settled = reduce(restored, {
      type: "COMPLETE_ROULETTE_SPIN",
      betId: committed?.betId ?? "",
    }).state;

    expect(settled.resources.chips).toBe(restored.resources.chips + (committed?.payout ?? 0));
    expect(settled.gambling.roulette.committedBet).toBeNull();

    const again = reduce(settled, {
      type: "COMPLETE_ROULETTE_SPIN",
      betId: committed?.betId ?? "",
    });

    expect(again.state.resources.chips).toBe(settled.resources.chips);
    expect(again.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("cannot be settled by naming a different bet", () => {
    const spinning = reduce(fresh(), { type: "START_ROULETTE_SPIN", wager: 50 }).state;
    const wrong = reduce(spinning, { type: "COMPLETE_ROULETTE_SPIN", betId: "roulette-999" });

    expect(wrong.state.resources.chips).toBe(spinning.resources.chips);
    expect(wrong.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("names the wheel, not the reels, when it blocks prestige", () => {
    /*
     * Both games hold a committed bet, and folding them into one block kind made
     * a spinning wheel report "A spin is still resolving." A player with the
     * roulette tab live and prestige refused would go looking at the slot game.
     */
    const spinning = reduce(fresh(), { type: "START_ROULETTE_SPIN", wager: 10 }).state;

    expect(prestigeBlock(spinning)).toEqual({ kind: "wheel-in-progress" });
    expect(describeBlock({ kind: "wheel-in-progress" })).toContain("wheel");

    const reels = reduce(fresh(), { type: "START_SLOT_SPIN", wager: 10 }).state;

    expect(prestigeBlock(reels)).toEqual({ kind: "spin-in-progress" });
  });

  it("blocks prestige while the wheel is turning", () => {
    const rich: GameState = {
      ...fresh(),
      prestige: {
        ...fresh().prestige,
        cycleCashEarned: 10_000_000,
        lifetimeCashEarned: 10_000_000,
      },
    };
    const spinning = reduce(rich, { type: "START_ROULETTE_SPIN", wager: 10 }).state;
    const attempted = reduce(spinning, { type: "PRESTIGE" });

    expect(attempted.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
    expect(attempted.state.prestige.count).toBe(0);
  });
});

describe("selecting a bet", () => {
  it("keeps the chosen number when the bet type changes and comes back", () => {
    const picked = reduce(fresh(), {
      type: "SET_ROULETTE_BET",
      betTypeId: "bet.straight",
      straightNumber: 23,
    }).state;
    const moved = reduce(picked, {
      type: "SET_ROULETTE_BET",
      betTypeId: "bet.red",
      straightNumber: 23,
    }).state;

    expect(moved.gambling.roulette.selectedNumber).toBe(23);
  });

  it("refuses a number that is not on the wheel, keeping the last good one", () => {
    const picked = reduce(fresh(), {
      type: "SET_ROULETTE_BET",
      betTypeId: "bet.straight",
      straightNumber: 12,
    }).state;
    const bad = reduce(picked, {
      type: "SET_ROULETTE_BET",
      betTypeId: "bet.straight",
      straightNumber: 99,
    }).state;

    expect(bad.gambling.roulette.selectedNumber).toBe(12);
  });
});

describe("all four games through one save file", () => {
  it("carries every live commitment through an export and back", () => {
    /*
     * Each game has its own reload test already. This is the one that would
     * catch a new game being added to the state and forgotten by the exporter,
     * the checksum, or the envelope validator — a whole game silently dropped
     * on import is much harder to notice than one that reloads wrongly.
     */
    let state = fresh(50_000);

    state = {
      ...state,
      statistics: { ...state.statistics, deepestDepth: 40, deepestDepthThisCycle: 40 },
    };
    state = reduce(state, { type: "START_SLOT_SPIN", wager: 10 }).state;
    state = reduce(state, { type: "START_ROULETTE_SPIN", wager: 50 }).state;
    state = reduce(state, { type: "DEAL_BLACKJACK", wager: 250 }).state;
    state = reduce(state, { type: "PLACE_DEPTH_WAGER", targetDepth: 40, stake: 1_000 }).state;

    const imported = parseImport(exportSave(createEnvelope(state, 1, NOW)), NOW);

    expect(imported.ok).toBe(true);

    if (!imported.ok) {
      return;
    }

    const restored = imported.envelope.game.gambling;

    expect(restored.committedSpin?.betId).toBe(state.gambling.committedSpin?.betId);
    expect(restored.roulette.committedBet?.pocket).toBe(
      state.gambling.roulette.committedBet?.pocket,
    );
    // The whole shoe, not just the fact that a hand existed: a truncated one
    // would deal different cards from the next hit onward.
    expect(restored.blackjack.hand?.shoe).toEqual(state.gambling.blackjack.hand?.shoe);
    expect(restored.depthWager.pending?.multiplier).toBe(
      state.gambling.depthWager.pending?.multiplier,
    );
  });
});
