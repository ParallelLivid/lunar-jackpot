/**
 * Coverage for the machine progression rebuild.
 *
 * Levels became an uncapped curve, upgrade bands became a repeatable Overclock
 * research node, and components moved onto every fifth level. The properties
 * worth pinning are the ones that make an endless ladder behave: it never runs
 * out, it never gets cheaper, and it never produces a number the economy cannot
 * hold.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, MACHINES, RESEARCH_NODES, STARTER_MACHINE_ID } from "../../content/catalog";
import { evaluateMachineLevel } from "../../content/machines";
import { deriveContext, selectMachineView } from "../../domain/selectors";
import {
  machineLevelDefinition,
  planMachineLevelPurchase,
  researchChipCost,
  researchPayoutMultiplier,
  selectCyclePayout,
} from "../../domain/casino";
import { formatRankNumeral } from "../../domain/numbers";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";
import { runMigrations } from "../../persistence/migrations";
import { SAVE_VERSION } from "../../persistence/saveSchema";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;

function fresh(seed = 5): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A state with enough of everything to buy levels without the economy in the way. */
function wealthy(level = 1): GameState {
  const base = fresh();

  return {
    ...base,
    resources: {
      ...base.resources,
      cash: Number.MAX_SAFE_INTEGER,
      components: Number.MAX_SAFE_INTEGER,
      chips: Number.MAX_SAFE_INTEGER,
    },
    casino: {
      ...base.casino,
      machines: {
        ...base.casino.machines,
        [STARTER_MACHINE_ID]: { ...base.casino.machines[STARTER_MACHINE_ID], level },
      },
    },
  };
}

describe("uncapped machine levels", () => {
  it("never runs out of levels to sell", () => {
    // The old table stopped at ten. Nothing should stop now.
    for (const level of [11, 25, 100, 400]) {
      expect(machineLevelDefinition(STARTER_MACHINE_ID, level), `level ${level}`).not.toBeNull();
    }
  });

  it("keeps every value finite and ordered deep into the curve", () => {
    for (const machine of Object.values(MACHINES)) {
      let previous = evaluateMachineLevel(machine, 1);

      for (let level = 2; level <= 500; level += 1) {
        const definition = evaluateMachineLevel(machine, level);

        if (definition === null) {
          break;
        }

        expect(Number.isFinite(definition.cashCost), `${machine.id} L${level}`).toBe(true);
        expect(Number.isNaN(definition.cashCost)).toBe(false);
        expect(definition.cashCost).toBeGreaterThanOrEqual(previous?.cashCost ?? 0);
        expect(definition.payoutMultiplier).toBeGreaterThan(0);
        previous = definition;
      }
    }
  });

  it("clamps the payout multiplier but never the price", () => {
    /*
     * Clamping the cost down would open a band where the price stopped rising
     * while payout kept climbing — levels would get cheaper in real terms the
     * deeper you went. The cost is left to grow past what cash can represent, so
     * the ordinary affordability check becomes the wall instead.
     */
    /*
     * The level is *found* rather than written down. It has moved twice already —
     * 300 when the ceiling was `MAX_SAFE_INTEGER`, 600 when it became a googol,
     * and again when the whole curve was retuned — because the property being
     * pinned is the relationship between two curves, not any particular level.
     * Searching for it means the next retune does not break this test for a
     * reason that has nothing to do with what it is checking.
     */
    let deepLevel = 0;

    for (let level = 2; level <= 20_000; level += 1) {
      const evaluated = evaluateMachineLevel(MACHINES[STARTER_MACHINE_ID], level);

      if (evaluated !== null && evaluated.cashCost > ECONOMY.safeMaximum) {
        deepLevel = level;
        break;
      }
    }

    expect(deepLevel, "no level prices itself past the ceiling").toBeGreaterThan(0);

    const deep = evaluateMachineLevel(MACHINES[STARTER_MACHINE_ID], deepLevel);

    expect(deep).not.toBeNull();
    expect(deep?.payoutMultiplier).toBeLessThanOrEqual(ECONOMY.safeMaximum);
    expect(deep?.cashCost ?? 0).toBeGreaterThan(ECONOMY.safeMaximum);

    // And a level nobody could pay for is simply refused, not sold on credit.
    const plan = planMachineLevelPurchase(wealthy(deepLevel - 1), STARTER_MACHINE_ID);

    expect(plan.ok).toBe(false);
  });

  it("charges components on every fifth level and nowhere else", () => {
    for (let level = 1; level <= 40; level += 1) {
      const definition = machineLevelDefinition(STARTER_MACHINE_ID, level);

      expect((definition?.componentCost ?? 0) > 0, `level ${level}`).toBe(level % 5 === 0);
    }
  });

  it("sells level twenty through the real reducer", () => {
    let state = wealthy();

    for (let step = 1; step < 20; step += 1) {
      state = reduce(state, { type: "BUY_MACHINE_LEVEL", machineId: STARTER_MACHINE_ID }).state;
    }

    expect(state.casino.machines[STARTER_MACHINE_ID].level).toBe(20);
  });
});

describe("overclock research", () => {
  const NODE = "research.alpha.overclock" as const;

  it("doubles payout with every rank", () => {
    let state = wealthy();
    const base = selectCyclePayout(state, STARTER_MACHINE_ID, []);

    for (let rank = 1; rank <= 4; rank += 1) {
      state = reduce(state, { type: "RESEARCH_NODE", nodeId: NODE }).state;

      expect(state.casino.machines[STARTER_MACHINE_ID].researchRanks[NODE]).toBe(rank);
      expect(selectCyclePayout(state, STARTER_MACHINE_ID, [])).toBe(base * 2 ** rank);
    }
  });

  it("charges more for each successive rank, and never stops offering one", () => {
    let progress = fresh().casino.machines[STARTER_MACHINE_ID];
    let previous = 0;

    for (let rank = 0; rank < 6; rank += 1) {
      const cost = researchChipCost(progress, NODE);

      expect(cost, `rank ${rank + 1}`).not.toBeNull();
      expect(cost ?? 0).toBeGreaterThan(previous);
      previous = cost ?? 0;
      progress = { ...progress, researchRanks: { ...progress.researchRanks, [NODE]: rank + 1 } };
    }
  });

  it("still treats a spec unlock as a one-shot", () => {
    const node = RESEARCH_NODES["research.alpha.spec-endurance"];

    expect(node.maximumRank).toBe(1);

    const progress = {
      ...fresh().casino.machines[STARTER_MACHINE_ID],
      researchRanks: { "research.alpha.spec-endurance": 1 },
    };

    expect(researchChipCost(progress, "research.alpha.spec-endurance")).toBeNull();
    expect(researchPayoutMultiplier(progress)).toBe(1);
  });
});

describe("the version 5 to 6 migration", () => {
  it("folds researched nodes to rank 1 and refunds the deleted bands", () => {
    const legacy = {
      saveVersion: 5,
      contentVersion: "0.1.0",
      revision: 12,
      savedAtUnixMs: NOW,
      game: {
        resources: { chips: 100 },
        casino: {
          machines: {
            "machine.alpha": {
              unlocked: true,
              level: 8,
              researchedNodeIds: [
                "research.alpha.band-two",
                "research.alpha.band-three",
                "research.alpha.spec-endurance",
              ],
            },
            "machine.beta": {
              unlocked: false,
              level: 1,
              researchedNodeIds: [],
            },
          },
        },
      },
    };

    const migrated = runMigrations(legacy);
    const game = migrated.envelope.game as Record<string, unknown>;
    const casino = game.casino as Record<string, unknown>;
    const machines = casino.machines as Record<string, Record<string, unknown>>;
    const resources = game.resources as Record<string, unknown>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(5));
    expect(migrated.envelope.saveVersion).toBe(SAVE_VERSION);

    // The surviving node keeps its purchase, at rank 1.
    expect(machines["machine.alpha"].researchRanks).toEqual({
      "research.alpha.spec-endurance": 1,
    });

    // Both band nodes are gone, and their chips came back rather than being
    // silently deleted out of a save the player can read.
    expect(resources.chips).toBe(100 + 40 + 320);

    // The level survives untouched; it is no longer clamped to a table.
    expect(machines["machine.alpha"].level).toBe(8);
    expect(machines["machine.beta"].researchRanks).toEqual({});
  });
});

describe("research rank naming", () => {
  const NODE = "research.alpha.overclock" as const;

  function nameAtRank(rank: number): string {
    const base = fresh();
    const state: GameState = {
      ...base,
      casino: {
        ...base.casino,
        machines: {
          ...base.casino.machines,
          [STARTER_MACHINE_ID]: {
            ...base.casino.machines[STARTER_MACHINE_ID],
            researchRanks: rank === 0 ? {} : { [NODE]: rank },
          },
        },
      },
    };

    const view = selectMachineView(deriveContext(state), STARTER_MACHINE_ID);

    return view.research.find((node) => node.id === NODE)?.displayName ?? "";
  }

  it("names a repeatable node for the rank it is offering", () => {
    // The row is a purchase, so it reads as what the button buys.
    expect(nameAtRank(0)).toBe("Overclock I");
    expect(nameAtRank(1)).toBe("Overclock II");
    expect(nameAtRank(2)).toBe("Overclock III");
    expect(nameAtRank(8)).toBe("Overclock IX");
  });

  it("drops to arabic once roman stops being readable", () => {
    // "Overclock XLVII" is a puzzle, not a label.
    expect(nameAtRank(9)).toBe("Overclock X");
    expect(nameAtRank(10)).toBe("Overclock 11");
    expect(nameAtRank(46)).toBe("Overclock 47");
  });

  it("leaves a one-shot node's name alone", () => {
    const view = selectMachineView(deriveContext(fresh()), STARTER_MACHINE_ID);
    const spec = view.research.find((node) => node.id === "research.alpha.spec-endurance");

    expect(spec?.repeatable).toBe(false);
    expect(spec?.displayName).toBe("Endurance tuning");
  });

  it("formats a rank numeral defensively", () => {
    expect(formatRankNumeral(0)).toBe("I");
    expect(formatRankNumeral(-4)).toBe("I");
    expect(formatRankNumeral(Number.NaN)).toBe("I");
  });
});
