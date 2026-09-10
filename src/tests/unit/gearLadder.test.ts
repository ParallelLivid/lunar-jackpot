/**
 * Coverage for the extended gear ladders.
 *
 * The tank curve is not a free choice: each level's oxygen is what puts a depth
 * band in reach, so these tests pin the ladder against the bands rather than
 * against a table of numbers that would drift apart from it silently.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, ENCOUNTERS, GEAR } from "../../content/catalog";
import { DEPTH_BANDS } from "../../content/depthBands";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";

/** Deepest depth a run reaches, resolving choices the way a player does. */
function deepestDepth(seed: number, tankLevel: number, pickaxeLevel: number): number {
  const base = createGameState({ nowUnixMs: 0, seed });
  let state: GameState = {
    ...base,
    gear: { ...base.gear, tankLevel, pickaxeLevel },
    settings: {
      ...base.settings,
      autoContinue: { enabled: true, oxygenThresholdRatio: 0.1 },
    },
  };

  state = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

  let deepest = 0;

  for (let step = 0; step < 200_000; step += 1) {
    const expedition = state.expedition;

    /*
     * Auto-continue presses through a decision but never resolves a choice, so a
     * harness that only ticks parks at the first one and measures nothing. This
     * is the mistake that produced chunk 5's wrong band boundaries.
     */
    if (expedition.status === "choice") {
      const encounter = expedition.currentEncounter;
      const optionId =
        encounter === null
          ? null
          : (ENCOUNTERS[encounter.encounterId].choiceOptions?.[0]?.id ?? null);

      if (optionId !== null) {
        state = reduce(state, { type: "CHOOSE_ENCOUNTER_OPTION", optionId }).state;
        continue;
      }
    }

    deepest = Math.max(deepest, expedition.depth);

    state = reduce(state, {
      type: "TICK",
      casinoElapsedMs: 0,
      expeditionElapsedMs: 500,
      nowUnixMs: state.lastSettledAtUnixMs + 500,
    }).state;

    if (state.expedition.status === "surface") {
      break;
    }
  }

  return deepest;
}

/** Median of a small sweep, which is what "a typical run" means here. */
function medianDepth(tankLevel: number, pickaxeLevel: number, samples = 9): number {
  const depths = Array.from({ length: samples }, (_, index) =>
    deepestDepth(index + 1, tankLevel, pickaxeLevel),
  ).sort((left, right) => left - right);

  return depths[Math.floor(depths.length / 2)];
}

describe("the gear ladders", () => {
  it("gives both items twelve ordered levels", () => {
    for (const gear of Object.values(GEAR)) {
      expect(gear.levels).toHaveLength(12);
      expect(gear.levels.map((level) => level.level)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
    }
  });

  it("raises the stat and the price at every step", () => {
    for (const gear of Object.values(GEAR)) {
      gear.levels.forEach((level, index) => {
        if (index === 0) {
          expect(level.relicCost).toBe(0);

          return;
        }

        expect(level.statValue, `${gear.id} L${level.level}`).toBeGreaterThan(
          gear.levels[index - 1].statValue,
        );
        expect(level.relicCost, `${gear.id} L${level.level}`).toBeGreaterThan(
          gear.levels[index - 1].relicCost,
        );
      });
    }
  });

  it("never weakens a level the five-level ladder already sold", () => {
    // Anyone mid-cycle keeps exactly what they bought.
    const previousTank = [60, 85, 115, 150, 195];
    const previousPickaxe = [10, 16, 25, 38, 58];

    previousTank.forEach((value, index) => {
      expect(GEAR.tank.levels[index].statValue).toBeGreaterThanOrEqual(value);
    });
    previousPickaxe.forEach((value, index) => {
      expect(GEAR.pickaxe.levels[index].statValue).toBeGreaterThanOrEqual(value);
    });
  });

  it("caps trinket slots at three and never takes one back", () => {
    for (const gear of Object.values(GEAR)) {
      const slots = gear.levels.map((level) => level.unlockedTrinketSlots);

      expect(Math.max(...slots)).toBe(ECONOMY.trinketSlotsPerGear);
      expect(slots[slots.length - 1]).toBe(ECONOMY.trinketSlotsPerGear);

      slots.forEach((count, index) => {
        expect(count).toBeGreaterThanOrEqual(index === 0 ? 1 : slots[index - 1]);
      });
    }
  });

  it("keeps the slot unlocks where they already were", () => {
    /*
     * Re-spacing these across the longer ladder would relock the third slot for
     * anyone past level 5, and `releaseRelockedSlots` would unequip the trinket
     * sitting in it. A longer ladder is not worth taking someone's slot away.
     */
    const unlockLevel = (count: number): number | undefined =>
      GEAR.tank.levels.find((level) => level.unlockedTrinketSlots >= count)?.level;

    expect(unlockLevel(1)).toBe(1);
    expect(unlockLevel(2)).toBe(3);
    expect(unlockLevel(3)).toBe(5);
  });
});

describe("the ladder against the depth bands", () => {
  /*
   * A run spends roughly six seconds of oxygen per depth, so each tank level is
   * very nearly the depth it reaches. These are the pairings the curve exists to
   * produce; if the bands or the curve move, one of them has to move back.
   */
  /*
   * These have moved twice, and both times for a reason worth recording.
   *
   * Chunk 6 banded the encounter table, and deeper encounters got their own
   * tougher reward tables — a depth went from about 5.5 seconds of oxygen to
   * about 6.8. Chunk 7 then added run modifiers, one of which cuts a quarter of
   * the tank. The ladder absorbed the second change at its top three levels; the
   * pairings absorbed the first.
   *
   * Each is stated at the level whose *median* run clears the band with room,
   * not the first level that can scrape it — a pairing that holds half the time
   * is a coin toss, not a gate.
   */
  it.each([
    ["band.seams", 6],
    ["band.dark", 8],
    ["band.hollow", 10],
    ["band.core", 12],
  ] as const)("reaches %s by tank level %i", (bandId, tankLevel) => {
    // Fifteen samples: the margins here are single digits, and a nine-sample
    // median is noisy enough to flip one of them run to run.
    const reached = medianDepth(tankLevel, tankLevel, 15);

    expect(
      reached,
      `tank level ${tankLevel} reached depth ${reached}, band opens at ${DEPTH_BANDS[bandId].minimum}`,
    ).toBeGreaterThanOrEqual(DEPTH_BANDS[bandId].minimum);
  }, 60_000);

  it("does not open the deepest band too early", () => {
    // A starting tank must not stumble into the Core; the ladder is the gate.
    expect(medianDepth(1, 1)).toBeLessThan(DEPTH_BANDS["band.core"].minimum);
  }, 60_000);
});
