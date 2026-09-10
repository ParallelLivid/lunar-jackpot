/**
 * Expedition balance simulations.
 *
 * Encounter distributions, pity activation, and oxygen-failure loss are all
 * measured through the real reducer so a content change is reflected here.
 */

import { ECONOMY, ENCOUNTERS, TOTEMS } from "../../content/catalog";
import type { EncounterFamily, EncounterId, Modifier } from "../../content/catalog";
import { commitFailureResult } from "../../domain/expedition";
import { reduce } from "../../domain/reducer";
import { createRngState } from "../../domain/rng";
import { createEmptyRunInventory, createGameState, type GameState } from "../../domain/state";

export interface RunOutcome {
  depth: number;
  encountersCompleted: number;
  chipsGained: number;
  relicsGained: number;
  componentsGained: number;
  cachesGained: number;
  failed: boolean;
}

/** Plays one run with a simple strategy: engage until oxygen drops below a floor. */
export function simulateRun(
  seed: number,
  returnAtOxygenRatio: number,
  stepMs = 100,
  maxSteps = 100_000,
): RunOutcome {
  let state: GameState = createGameState({ nowUnixMs: 0, seed });
  const before = { ...state.resources };
  let wallClockMs = 0;

  state = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

  for (let index = 0; index < maxSteps; index += 1) {
    if (state.expedition.status === "surface" && index > 0) {
      break;
    }

    const oxygenRatio =
      state.expedition.maxOxygenSnapshot > 0
        ? state.expedition.oxygen / state.expedition.maxOxygenSnapshot
        : 0;

    if (state.expedition.status === "decision") {
      state =
        oxygenRatio <= returnAtOxygenRatio
          ? reduce(state, { type: "RETURN_FROM_EXPEDITION" }).state
          : reduce(state, { type: "CONTINUE_EXPEDITION" }).state;
      continue;
    }

    if (state.expedition.status === "choice") {
      const definition = ENCOUNTERS[state.expedition.currentEncounter?.encounterId as EncounterId];
      const optionId = definition?.choiceOptions?.[0]?.id ?? "";
      state = reduce(state, { type: "CHOOSE_ENCOUNTER_OPTION", optionId }).state;
      continue;
    }

    wallClockMs += stepMs;
    state = reduce(state, {
      type: "TICK",
      casinoElapsedMs: 0,
      expeditionElapsedMs: stepMs,
      nowUnixMs: wallClockMs,
    }).state;
  }

  return {
    depth: state.statistics.encountersCompleted,
    encountersCompleted: state.statistics.encountersCompleted,
    chipsGained: state.resources.chips - before.chips,
    relicsGained: state.resources.relics - before.relics,
    componentsGained: state.resources.components - before.components,
    cachesGained: state.resources.caches - before.caches,
    failed: state.statistics.runsFailed > 0,
  };
}

export interface EncounterDistribution {
  byFamily: Record<EncounterFamily, number>;
  byEncounter: Partial<Record<EncounterId, number>>;
  samples: number;
}

/** Measures which encounters actually appear over many runs. */
export function simulateEncounterDistribution(
  runs: number,
  returnAtOxygenRatio = 0.2,
): EncounterDistribution {
  const byFamily = {
    ore: 0,
    oxygen: 0,
    supply: 0,
    rare: 0,
    hazard: 0,
    choice: 0,
  } satisfies Record<EncounterFamily, number>;
  const byEncounter: Partial<Record<EncounterId, number>> = {};
  let samples = 0;

  for (let run = 0; run < runs; run += 1) {
    let state: GameState = createGameState({ nowUnixMs: 0, seed: 5_000 + run });
    let wallClockMs = 0;
    state = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

    for (let index = 0; index < 60_000; index += 1) {
      if (state.expedition.status === "surface" && index > 0) {
        break;
      }

      const oxygenRatio =
        state.expedition.maxOxygenSnapshot > 0
          ? state.expedition.oxygen / state.expedition.maxOxygenSnapshot
          : 0;

      if (state.expedition.status === "decision") {
        const encounterId = state.expedition.currentEncounter?.encounterId;

        if (encounterId !== undefined) {
          samples += 1;
          byFamily[ENCOUNTERS[encounterId].family] += 1;
          byEncounter[encounterId] = (byEncounter[encounterId] ?? 0) + 1;
        }

        state =
          oxygenRatio <= returnAtOxygenRatio
            ? reduce(state, { type: "RETURN_FROM_EXPEDITION" }).state
            : reduce(state, { type: "CONTINUE_EXPEDITION" }).state;
        continue;
      }

      if (state.expedition.status === "choice") {
        const definition = ENCOUNTERS[state.expedition.currentEncounter?.encounterId as EncounterId];
        state = reduce(state, {
          type: "CHOOSE_ENCOUNTER_OPTION",
          optionId: definition?.choiceOptions?.[0]?.id ?? "",
        }).state;
        continue;
      }

      wallClockMs += 100;
      state = reduce(state, {
        type: "TICK",
        casinoElapsedMs: 0,
        expeditionElapsedMs: 100,
        nowUnixMs: wallClockMs,
      }).state;
    }
  }

  return { byFamily, byEncounter, samples };
}

export interface FailureLossSample {
  label: string;
  lossChance: number;
  observedLossRate: number;
  units: number;
}

/**
 * Confirms the per-unit loss rate converges on the configured probability. No
 * collectible modifies `expedition.failureLossChance`, so the base rate is the
 * only case; the sweep is kept because the stat's clamps are worth exercising if
 * a modifier is ever added back.
 */
export function simulateFailureLoss(units = 20_000): FailureLossSample[] {
  const cases = [
    { label: "base", chance: ECONOMY.failureLossChanceBase },
    { label: "clamped low", chance: ECONOMY.failureLossChanceMinimum },
    { label: "clamped high", chance: ECONOMY.failureLossChanceMaximum },
  ];

  return cases.map((entry, index) => {
    const inventory = { ...createEmptyRunInventory(), components: units };
    const result = commitFailureResult(
      inventory,
      createRngState(9_000 + index, "expedition-failure"),
      entry.chance,
    );

    return {
      label: entry.label,
      lossChance: entry.chance,
      observedLossRate: result.result.lost.components / units,
      units,
    };
  });
}
