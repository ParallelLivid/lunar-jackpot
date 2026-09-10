/**
 * Coverage for the ten-machine roster and band-gated recipes
 *.
 */

import { describe, expect, it } from "vitest";
import { ENCOUNTERS, GEAR, MACHINES, MACHINE_IDS, RESEARCH_NODES, SPECS } from "../../content/catalog";
import { DEPTH_BANDS, DEPTH_BAND_IDS, bandForDepth } from "../../content/depthBands";
import { earliestIncompleteRecipeMachineId } from "../../domain/casino";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(seed = 3): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/**
 * Deepest depth reached by one run, for reachability checks.
 *
 * The choice-resolution step is the point of this helper. An earlier version
 * only ticked, and auto-continue never resolves a `choice` encounter — so every
 * sampled run stalled at the first one and the function returned "depth before
 * the first choice" while claiming to return reachable depth. That artefact is
 * what produced a set of depth bands compressed to a few units each.
 */
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

describe("the machine roster", () => {
  it("has ten machines, one of them free", () => {
    expect(MACHINE_IDS).toHaveLength(10);

    const starters = Object.values(MACHINES).filter((machine) => machine.startsUnlocked);

    expect(starters).toHaveLength(1);
    expect(starters[0].recipePiecesRequired).toBe(0);
  });

  it("gives every machine its own research and specs", () => {
    for (const machine of Object.values(MACHINES)) {
      expect(machine.researchNodeIds).toHaveLength(4);
      expect(machine.specIds).toHaveLength(3);

      for (const nodeId of machine.researchNodeIds) {
        expect(RESEARCH_NODES[nodeId].machineId).toBe(machine.id);
      }

      for (const specId of machine.specIds) {
        expect(SPECS[specId].machineId).toBe(machine.id);
      }
    }
  });

  it("spreads recipes across every band, deepest costing most", () => {
    const byBand = new Map<string, number>();

    for (const machine of Object.values(MACHINES)) {
      if (machine.startsUnlocked) {
        continue;
      }

      byBand.set(machine.recipeBand, (byBand.get(machine.recipeBand) ?? 0) + 1);
    }

    // No band is a dead end with nothing to build in it.
    for (const bandId of DEPTH_BAND_IDS) {
      expect(byBand.get(bandId) ?? 0, `band ${bandId}`).toBeGreaterThan(0);
    }

    // And a deeper band never asks for fewer pieces than a shallower one.
    const cheapest = (bandId: string): number =>
      Math.min(
        ...Object.values(MACHINES)
          .filter((machine) => machine.recipeBand === bandId && !machine.startsUnlocked)
          .map((machine) => machine.recipePiecesRequired),
      );

    for (let index = 1; index < DEPTH_BAND_IDS.length; index += 1) {
      expect(cheapest(DEPTH_BAND_IDS[index])).toBeGreaterThanOrEqual(
        cheapest(DEPTH_BAND_IDS[index - 1]),
      );
    }
  });
});

describe("band-gated recipe pieces", () => {
  it("routes a piece only to a machine of the band it was found in", () => {
    const state = fresh();

    for (const bandId of DEPTH_BAND_IDS) {
      const machineId = earliestIncompleteRecipeMachineId(state, bandId);

      expect(machineId, `band ${bandId}`).not.toBeNull();
      expect(MACHINES[machineId!].recipeBand).toBe(bandId);
    }
  });

  it("reports nothing once a band's machines are all built", () => {
    const base = fresh();
    const shelfMachines = Object.values(MACHINES).filter(
      (machine) => machine.recipeBand === "band.shelf",
    );

    const state: GameState = {
      ...base,
      casino: {
        ...base.casino,
        machines: {
          ...base.casino.machines,
          ...Object.fromEntries(
            shelfMachines.map((machine) => [
              machine.id,
              { ...base.casino.machines[machine.id], unlocked: true },
            ]),
          ),
        },
      },
    };

    // The caller turns this into components, so the find is never dropped.
    expect(earliestIncompleteRecipeMachineId(state, "band.shelf")).toBeNull();

    // A deeper band is unaffected by a shallow one being finished.
    expect(earliestIncompleteRecipeMachineId(state, "band.core")).not.toBeNull();
  });

  it("still finds any incomplete machine when no band is given", () => {
    expect(earliestIncompleteRecipeMachineId(fresh())).not.toBeNull();
  });
});

describe("band reachability", () => {
  /*
   * A machine whose band no run ever reaches is unbuildable content. This is the
   * guard against that, and it is only meaningful because the helper above
   * resolves choices — the version that did not made this exact assertion pass
   * against bands that were far too short.
   */
  it("puts every recipe band inside reach of a maxed-gear run", () => {
    const maxTank = GEAR.tank.levels.length;
    const maxPickaxe = GEAR.pickaxe.levels.length;
    const depths = Array.from({ length: 12 }, (_, index) =>
      deepestDepth(index + 1, maxTank, maxPickaxe),
    );
    const deepest = Math.max(...depths);
    const recipeBands = new Set(
      Object.values(MACHINES)
        .filter((machine) => !machine.startsUnlocked)
        .map((machine) => machine.recipeBand),
    );

    for (const bandId of recipeBands) {
      expect(
        DEPTH_BANDS[bandId].minimum,
        `${bandId} starts at ${DEPTH_BANDS[bandId].minimum}, deepest sampled run was ${deepest}`,
      ).toBeLessThanOrEqual(deepest);
    }
  }, 30_000);

  it("still starts every run on the shallowest band", () => {
    expect(bandForDepth(0).id).toBe(DEPTH_BAND_IDS[0]);
  });
});
