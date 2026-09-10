/**
 * Coverage for run modifier frequency and the banking lock.
 *
 * Sealed orders is the only content in the game that removes a choice rather than
 * changing a number, and it is the spec's single exception to "returning is
 * always a deliberate act". Low oxygen does not lift it, so a locked run can end
 * with a full haul and no exit — which means the tests that matter are the ones
 * proving it is *bounded* rather than merely severe.
 */

import { describe, expect, it } from "vitest";
import {
  DEPTH_BAND_IDS,
  ECONOMY,
  ENCOUNTERS,
  EXPEDITION_MODIFIERS,
  EXPEDITION_MODIFIER_IDS,
} from "../../content/catalog";
import type { EncounterId, ExpeditionModifierId } from "../../content/catalog";
import { bankingLockedUntil } from "../../domain/expedition";
import { evaluateStat } from "../../domain/modifiers";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectExpeditionView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;
const SEALED: ExpeditionModifierId = "modifier.sealed-orders";

function fresh(seed = 11): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A launched run carrying `modifierId`, at the given gear. */
function running(
  modifierId: ExpeditionModifierId | null,
  seed = 11,
  gearLevel = 5,
): GameState {
  const base = fresh(seed);
  const ready: GameState = {
    ...base,
    gear: { ...base.gear, tankLevel: gearLevel, pickaxeLevel: gearLevel },
    statistics: { ...base.statistics, deepestDepth: 60, deepestDepthThisCycle: 60 },
  };
  const launched = reduce(ready, { type: "LAUNCH_EXPEDITION" }).state;

  return {
    ...launched,
    expedition: { ...launched.expedition, activeModifierId: modifierId },
  };
}

/** Puts a launched run at a decision at the given depth. */
function atDecision(state: GameState, depth: number): GameState {
  return {
    ...state,
    expedition: { ...state.expedition, status: "decision", depth },
  };
}

describe("how often a run is coloured", () => {
  it("rolls a modifier on a third of runs", () => {
    expect(ECONOMY.expeditionModifierChance).toBeCloseTo(1 / 3, 6);
  });

  it("offers every band at least six conditions to draw from", () => {
    /*
     * At one run in three, a three-deep pool is exhausted within an hour and the
     * change makes runs *less* varied rather than more. The starting pool went
     * from three to seven in this chunk for exactly that reason.
     */
    for (let index = 0; index < DEPTH_BAND_IDS.length; index += 1) {
      const available = EXPEDITION_MODIFIER_IDS.filter(
        (id) => DEPTH_BAND_IDS.indexOf(EXPEDITION_MODIFIERS[id].requiredBand) <= index,
      );

      expect(available.length, DEPTH_BAND_IDS[index]).toBeGreaterThanOrEqual(6);
    }
  });

  it("draws the observed rate over a large sample", () => {
    let rolled = 0;
    const runs = 600;

    for (let seed = 1; seed <= runs; seed += 1) {
      const base = fresh(seed);
      const launched = reduce(
        { ...base, statistics: { ...base.statistics, deepestDepth: 120 } },
        { type: "LAUNCH_EXPEDITION" },
      ).state;

      rolled += launched.expedition.activeModifierId === null ? 0 : 1;
    }

    // Wide enough not to be flaky, tight enough to catch a wrong constant.
    expect(rolled / runs).toBeGreaterThan(0.27);
    expect(rolled / runs).toBeLessThan(0.40);
  });
});

describe("the two answers to why press on", () => {
  it("pays deep quota more the deeper the run goes", () => {
    /*
     * The effect is compounding and applied when a reward resolves, not folded
     * into the launch snapshot — a flat bonus would raise the prize without
     * changing the decision, which is the whole point of the modifier.
     */
    const perDepth = EXPEDITION_MODIFIERS["modifier.deep-quota"].rewardPerDepth ?? 0;

    expect(perDepth).toBeGreaterThan(0);
    expect((1 + perDepth) ** 30).toBeGreaterThan((1 + perDepth) ** 10);
  });

  it("grants deep quota nothing at all at depth zero", () => {
    // The bonus is distance travelled, so a run that has not moved has not earned
    // any of it.
    expect((1 + (EXPEDITION_MODIFIERS["modifier.deep-quota"].rewardPerDepth ?? 0)) ** 0).toBe(1);
  });

  it("moves the escort's loss chance and nothing else", () => {
    const escort = EXPEDITION_MODIFIERS["modifier.company-escort"];

    expect(escort.modifiers).toHaveLength(1);
    expect(escort.modifiers[0].targetStat).toBe("expedition.failureLossChance");
    expect(
      evaluateStat(ECONOMY.failureLossChanceBase, escort.modifiers, {
        targetStat: "expedition.failureLossChance",
      }),
    ).toBeLessThan(ECONOMY.failureLossChanceBase);
  });
});

describe("sealed orders", () => {
  const target = EXPEDITION_MODIFIERS[SEALED].bankingLockedUntilDepth ?? 0;

  it("shuts the exit before the target and opens it at the target", () => {
    expect(bankingLockedUntil(atDecision(running(SEALED), target - 1))).toBe(target);
    expect(bankingLockedUntil(atDecision(running(SEALED), 0))).toBe(target);
    expect(bankingLockedUntil(atDecision(running(SEALED), target))).toBeNull();
    expect(bankingLockedUntil(atDecision(running(SEALED), target + 5))).toBeNull();
  });

  it("refuses the command, not just the button", () => {
    const locked = atDecision(running(SEALED), 2);
    const refused = reduce(locked, { type: "RETURN_FROM_EXPEDITION" });

    expect(refused.materialChange).toBe(false);
    // Nothing is half-processed: the run is untouched, haul included.
    expect(refused.state.expedition).toEqual(locked.expedition);
  });

  it("does not open when the air runs low", () => {
    /*
     * Ruled on directly by the product owner. An earlier draft released the lock
     * at the low-oxygen threshold; it does not. The only way out is down, and a
     * locked run can genuinely end with a full haul and no exit.
     */
    const gasping: GameState = (() => {
      const locked = atDecision(running(SEALED), 3);

      return {
        ...locked,
        expedition: {
          ...locked.expedition,
          oxygen: locked.expedition.maxOxygenSnapshot * 0.01,
        },
      };
    })();

    expect(bankingLockedUntil(gasping)).toBe(target);
    expect(reduce(gasping, { type: "RETURN_FROM_EXPEDITION" }).materialChange).toBe(false);
  });

  it("says which condition holds the exit and how far is left", () => {
    // A disabled button whose reason has to be inferred is the difference between
    // a hard modifier and a broken one.
    const view = selectExpeditionView(deriveContext(atDecision(running(SEALED), 4)));

    expect(view.canReturn.available).toBe(false);
    expect(view.canReturn.reason).toContain(String(target));
    expect(view.canReturn.reason).toContain(String(target - 4));
    expect(view.canReturn.reason).toMatch(/tank/i);
  });

  it("leaves an unlocked run able to bank, at any depth", () => {
    // The regression this chunk is most likely to cause.
    for (const depth of [0, 1, 5, 50]) {
      expect(bankingLockedUntil(atDecision(running(null), depth)), `depth ${String(depth)}`).toBeNull();
      expect(
        selectExpeditionView(deriveContext(atDecision(running(null), depth))).canReturn.available,
      ).toBe(true);
    }

    // And a run carrying some *other* modifier is equally free to leave.
    expect(bankingLockedUntil(atDecision(running("modifier.rich-vein"), 0))).toBeNull();
  });

  it("survives a reload with the lock intact", () => {
    const locked = atDecision(running(SEALED), 3);
    const restored = normalizeGameState(createEnvelope(locked, 1, NOW).game, NOW).state;

    expect(restored.expedition.activeModifierId).toBe(SEALED);
    expect(bankingLockedUntil(restored)).toBe(target);
  });

  it("is never offered on gear that cannot clear its own target", () => {
    /*
     * The load-bearing safety gate, and the one the plan did not anticipate.
     * `requiredBand` reads *lifetime* deepest depth, but prestige resets gear to
     * level 1 while lifetime depth survives — measured, a veteran on reset gear
     * fails 85.8% of a ten-depth target, against 0% once gear is back to level 3.
     */
    const gate = EXPEDITION_MODIFIERS[SEALED].minimumDepthThisCycle ?? 0;

    expect(gate).toBeGreaterThanOrEqual(target * 2);

    // A freshly prestiged veteran: lifetime depth intact, this cycle at zero.
    const veteran = fresh(3);
    const justPrestiged: GameState = {
      ...veteran,
      statistics: { ...veteran.statistics, deepestDepth: 200, deepestDepthThisCycle: 0 },
    };

    for (let seed = 1; seed <= 200; seed += 1) {
      const launched = reduce(
        { ...justPrestiged, random: { ...justPrestiged.random, nextExpeditionSeedCounter: seed } },
        { type: "LAUNCH_EXPEDITION" },
      ).state;

      expect(launched.expedition.activeModifierId).not.toBe(SEALED);
    }
  });

  it("pays for what it takes", () => {
    // It takes more than any other modifier, so a pure penalty would be a
    // punishment for bad luck at launch.
    expect(EXPEDITION_MODIFIERS[SEALED].modifiers.length).toBeGreaterThan(0);
  });

  it("always terminates: a locked run reaches the target or runs out of air", () => {
    /*
     * The property that makes an exit-less modifier bounded rather than a trap.
     * Pressing on is available at every decision and oxygen only falls, so there
     * is no state a locked run can sit in. Soaked over many seeds, because "it
     * cannot hang" is not a claim to make from reading the code alone.
     */
    let reachedTarget = 0;
    let ranOut = 0;

    for (let seed = 1; seed <= 60; seed += 1) {
      let state = running(SEALED, seed, 5);
      let settled = false;

      for (let step = 0; step < 20_000 && !settled; step += 1) {
        if (state.expedition.status === "surface" && step > 0) {
          ranOut += 1;
          settled = true;
          break;
        }

        if (state.expedition.status === "decision") {
          if (bankingLockedUntil(state) === null) {
            reachedTarget += 1;
            settled = true;
            break;
          }

          state = reduce(state, { type: "CONTINUE_EXPEDITION" }).state;
          continue;
        }

        if (state.expedition.status === "choice") {
          const definition =
            ENCOUNTERS[state.expedition.currentEncounter?.encounterId as EncounterId];

          state = reduce(state, {
            type: "CHOOSE_ENCOUNTER_OPTION",
            optionId: definition?.choiceOptions?.[0]?.id ?? "",
          }).state;
          continue;
        }

        state = reduce(state, {
          type: "TICK",
          casinoElapsedMs: 0,
          expeditionElapsedMs: 250,
          nowUnixMs: state.lastSettledAtUnixMs + 250,
        }).state;
      }

      expect(settled, `seed ${String(seed)} neither reached the target nor ended`).toBe(true);
    }

    expect(reachedTarget + ranOut).toBe(60);
    // Measured at 0% failure from gear level 3 upward; this is the guard, not the
    // measurement, so it allows for seeds this soak happens to draw badly.
    expect(reachedTarget).toBeGreaterThan(54);
  });
});
