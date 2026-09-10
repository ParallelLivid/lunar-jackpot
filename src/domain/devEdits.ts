/**
 * Applying a developer-menu patch to the game state. Split out of the reducer so
 * the whole cheat surface reads in one file.
 *
 * Nothing here validates: values are clamped to a sane range and the caller
 * re-normalises the whole state, the same path a loaded save takes. Repairing on
 * the way in beats handing the loader a state it will later reject.
 */

import { GRADE_IDS, HIGHEST_GRADE, isGradeId } from "../content/grades";
import { reconcileCats } from "./cats";
import {
  ECONOMY,
  GEAR,
  MACHINES,
  PRESTIGE_PERKS,
  RESEARCH_NODES,
  RESOURCE_IDS,
  TOTEMS,
  TRINKETS,
} from "../content/catalog";
import type {
  MachineId,
  PrestigePerkDefinition,
  PrestigePerkId,
  ResearchNodeId,
  ResourceId,
  TotemId,
  TrinketId,
} from "../content/catalog";
import type { DevCollectiblePatch, DevStatePatch } from "./commands";
import { evaluateMachineLevel } from "../content/machines";
import { clamp } from "./numbers";
import type { GameState, MachineProgress } from "./state";

/**
 * The largest value the menu will set, matching the save schema's ceiling.
 * Deliberately the rollover point, since typing it into a resource field is the
 * only way to reach `INF` by hand and so the only way to test that state.
 */
export const DEV_MAXIMUM_QUANTITY = ECONOMY.safeMaximum;

function count(value: unknown, current: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return current;
  }

  return Math.floor(clamp(value, 0, DEV_MAXIMUM_QUANTITY));
}

function collectible(
  patch: DevCollectiblePatch,
  current: { owned: boolean; grade: (typeof GRADE_IDS)[number]; fragments: number },
) {
  // A grade outside the ladder is dropped rather than clamped: reading "SSSS" as
  // SSS would hand out the top grade for a typo.
  const grade = patch.grade !== undefined && isGradeId(patch.grade) ? patch.grade : current.grade;

  return {
    owned: patch.owned ?? current.owned,
    grade,
    fragments: count(patch.fragments, current.fragments),
  };
}

/**
 * Machine levels are uncapped by design, so the only ceiling is what the curve
 * can still represent as a finite number. A level past that keeps the current
 * one rather than being stored, since the save normaliser would otherwise reset
 * the machine to level 1 over one extra digit.
 */
function representableLevel(machineId: MachineId, requested: number, current: number): number {
  const level = Math.max(1, Math.floor(requested));

  return evaluateMachineLevel(MACHINES[machineId], level) === null ? current : level;
}

function machine(
  machineId: MachineId,
  patch: NonNullable<DevStatePatch["machines"]>[MachineId],
  current: MachineProgress,
): MachineProgress {
  if (patch === undefined) {
    return current;
  }

  const level = representableLevel(machineId, patch.level ?? current.level, current.level);

  const researchRanks: Partial<Record<ResearchNodeId, number>> = { ...current.researchRanks };

  for (const [nodeId, rank] of Object.entries(patch.researchRanks ?? {})) {
    const definition = RESEARCH_NODES[nodeId as ResearchNodeId];

    // A node belonging to another machine is ignored: a rank filed under the
    // wrong machine is invisible in the UI.
    if (definition === undefined || definition.machineId !== machineId) {
      continue;
    }

    researchRanks[nodeId as ResearchNodeId] = Math.floor(
      clamp(rank ?? 0, 0, definition.maximumRank ?? DEV_MAXIMUM_QUANTITY),
    );
  }

  return {
    ...current,
    unlocked: patch.unlocked ?? current.unlocked,
    level,
    recipePieces: count(patch.recipePieces, current.recipePieces),
    researchRanks,
  };
}

/**
 * Applies a developer patch. The result still has to go through
 * `normalizeGameState` before it is trusted; this only gets it close.
 */
export function applyDevPatch(state: GameState, patch: DevStatePatch): GameState {
  const resources = { ...state.resources };

  for (const [id, value] of Object.entries(patch.resources ?? {})) {
    if ((RESOURCE_IDS as readonly string[]).includes(id)) {
      resources[id as ResourceId] = count(value, resources[id as ResourceId]);
    }
  }

  const trinkets = { ...state.collection.trinkets };

  for (const [id, entry] of Object.entries(patch.trinkets ?? {})) {
    const trinketId = id as TrinketId;

    if (TRINKETS[trinketId] !== undefined && entry !== undefined) {
      trinkets[trinketId] = collectible(entry, trinkets[trinketId]);
    }
  }

  const totems = { ...state.collection.totems };

  for (const [id, entry] of Object.entries(patch.totems ?? {})) {
    const totemId = id as TotemId;

    if (TOTEMS[totemId] !== undefined && entry !== undefined) {
      totems[totemId] = collectible(entry, totems[totemId]);
    }
  }

  const machines = { ...state.casino.machines };

  for (const [id, entry] of Object.entries(patch.machines ?? {})) {
    const machineId = id as MachineId;

    if (MACHINES[machineId] !== undefined) {
      machines[machineId] = machine(machineId, entry, machines[machineId]);
    }
  }

  const perkRanks: Partial<Record<PrestigePerkId, number>> = { ...state.prestige.perkRanks };

  for (const [id, rank] of Object.entries(patch.perkRanks ?? {})) {
    const perk = PRESTIGE_PERKS[id as PrestigePerkId];

    if (perk !== undefined) {
      perkRanks[id as PrestigePerkId] = Math.floor(
        clamp(rank ?? 0, 0, perk.repeatable === true ? DEV_MAXIMUM_QUANTITY : perk.maximumRank),
      );
    }
  }

  const catsFound = count(patch.catsFound, state.statistics.catsFound);

  return {
    ...state,
    resources,
    casino: { ...state.casino, machines },
    // The cat list is regenerated in the same expression that sets the count, so
    // the two never disagree until a save round-trip repairs them.
    collection: {
      ...state.collection,
      trinkets,
      totems,
      cats: reconcileCats(state.collection.cats, catsFound, state.collection.ownedCatSkinIds),
    },
    gear: {
      // Slots are left alone: `releaseRelockedSlots` runs in the reducer after
      // this, so touching them here would do the work twice.
      ...state.gear,
      tankLevel: Math.floor(
        clamp(patch.tankLevel ?? state.gear.tankLevel, 1, GEAR.tank.levels.length),
      ),
      pickaxeLevel: Math.floor(
        clamp(patch.pickaxeLevel ?? state.gear.pickaxeLevel, 1, GEAR.pickaxe.levels.length),
      ),
    },
    prestige: {
      ...state.prestige,
      count: count(patch.prestigeCount, state.prestige.count),
      perkRanks,
    },
    statistics: {
      ...state.statistics,
      catsFound: catsFound,
      deepestDepth: count(patch.deepestDepth, state.statistics.deepestDepth),
    },
  };
}

// ---------------------------------------------------------------------------
// Max me out
// ---------------------------------------------------------------------------

/**
 * What every balance is set to. Not the ceiling, which would roll over to `INF`
 * on the next payout and make the save useless for reading. Ten trillion buys
 * everything the game sells and still leaves room to watch a number grow.
 */
export const DEV_MAX_RESOURCE = 1e13;

/**
 * How high "max me out" takes every machine. A stated level rather than an
 * income budget, so the answer can be predicted from reading the code and does
 * not drift whenever the curve is retuned. Five hundred is late-game territory
 * while staying a number the panels can still print.
 */
export const DEV_MAX_MACHINE_LEVEL = 500;

/**
 * Ranks given to Overclock, which is repeatable forever and has no maximum to
 * ask for. Each rank doubles, so eight is a 256x payout multiplier.
 */
const DEV_OVERCLOCK_RANKS = 8;

/** Ranks a max-out gives a perk that could otherwise be bought forever. */
const DEV_REPEATABLE_PERK_RANKS = 100;

/**
 * The rank the developer menu treats as "maxed". A repeatable perk has no
 * maximum and a placeholder `maximumRank` of 1, so the patch has to be told what
 * a lot of it looks like. Exported so the menu's label gives the same answer.
 */
export function devPerkRank(perk: PrestigePerkDefinition): number {
  return perk.repeatable === true ? DEV_REPEATABLE_PERK_RANKS : perk.maximumRank;
}


/**
 * The level every machine is set to, or as close as the curve allows. It walks
 * up to `DEV_MAX_MACHINE_LEVEL` and stops early only if the curve stops
 * producing finite numbers, then returns the level actually reached rather than
 * the one it wanted, so the menu can print the truth.
 */
export function devMaximumMachineLevel(): number {
  let best = 1;

  for (let level = 1; level <= DEV_MAX_MACHINE_LEVEL; level += 1) {
    for (const machineId of Object.keys(MACHINES) as MachineId[]) {
      // The curve stops producing finite numbers eventually, and a level past
      // that would be stored and then reset to 1 by the save normaliser.
      if (evaluateMachineLevel(MACHINES[machineId], level) === null) {
        return best;
      }
    }

    best = level;
  }

  return best;
}

/**
 * Everything the save has: every resource, collectible, level, rank and perk.
 * Built as one `DevStatePatch` so it costs a single re-normalisation and save
 * rather than one per edit.
 *
 * It does not touch the record — deepest depth, prestige count, cats found. The
 * line is between what a save has and what a save has done: the first is an
 * inventory, the second is history, and a button that rewrites history makes
 * every later reading of the save a lie. Cats sit with the record because
 * `catsFound` is the statistic the luck modifier reads.
 *
 * Nothing becomes unreachable: all three are fields in the menu's Progress
 * section, one deliberate edit each. Slots are left alone too, so
 * `releaseRelockedSlots` can run after this in the reducer.
 */
export function maxOutPatch(): DevStatePatch {
  const level = devMaximumMachineLevel();

  const machines: NonNullable<DevStatePatch["machines"]> = {};

  for (const machineId of Object.keys(MACHINES) as MachineId[]) {
    const definition = MACHINES[machineId];
    const researchRanks: Partial<Record<ResearchNodeId, number>> = {};

    for (const nodeId of definition.researchNodeIds) {
      const node = RESEARCH_NODES[nodeId];

      // Overclock is repeatable forever, so it needs a number rather than a
      // maximum.
      researchRanks[nodeId] = node.maximumRank ?? DEV_OVERCLOCK_RANKS;
    }

    machines[machineId] = {
      unlocked: true,
      level,
      recipePieces: definition.recipePiecesRequired,
      researchRanks,
    };
  }

  return {
    resources: Object.fromEntries(
      RESOURCE_IDS.map((id) => [id, DEV_MAX_RESOURCE]),
    ) as Partial<Record<ResourceId, number>>,
    trinkets: Object.fromEntries(
      Object.keys(TRINKETS).map((id) => [id, { owned: true, grade: HIGHEST_GRADE }]),
    ),
    totems: Object.fromEntries(
      Object.keys(TOTEMS).map((id) => [id, { owned: true, grade: HIGHEST_GRADE }]),
    ),
    tankLevel: GEAR.tank.levels.length,
    pickaxeLevel: GEAR.pickaxe.levels.length,
    machines,
    perkRanks: Object.fromEntries(
      Object.keys(PRESTIGE_PERKS).map((id) => [
        id,
        devPerkRank(PRESTIGE_PERKS[id as PrestigePerkId]),
      ]),
    ),
    // No `catsFound`, `deepestDepth` or `prestigeCount`: those are what the save
    // has done, and the Progress section edits them one at a time.
  };
}

/**
 * A short human summary of a patch, for the feedback line, so an edit that did
 * nothing can be told apart from a panel that never dispatched.
 */
export function describeDevPatch(patch: DevStatePatch): string {
  const parts: string[] = [];

  const resources = Object.entries(patch.resources ?? {});

  for (const [id, value] of resources) {
    parts.push(`${id} = ${String(value)}`);
  }

  if (patch.catsFound !== undefined) {
    parts.push(`cats = ${String(patch.catsFound)}`);
  }

  if (patch.deepestDepth !== undefined) {
    parts.push(`deepest depth = ${String(patch.deepestDepth)}`);
  }

  if (patch.prestigeCount !== undefined) {
    parts.push(`prestiges = ${String(patch.prestigeCount)}`);
  }

  if (patch.tankLevel !== undefined) {
    parts.push(`tank = level ${String(patch.tankLevel)}`);
  }

  if (patch.pickaxeLevel !== undefined) {
    parts.push(`pickaxe = level ${String(patch.pickaxeLevel)}`);
  }

  const named = (label: string, count: number): void => {
    if (count > 0) {
      parts.push(`${String(count)} ${label}${count === 1 ? "" : "s"}`);
    }
  };

  named("trinket", Object.keys(patch.trinkets ?? {}).length);
  named("totem", Object.keys(patch.totems ?? {}).length);
  named("machine", Object.keys(patch.machines ?? {}).length);
  named("perk", Object.keys(patch.perkRanks ?? {}).length);

  return parts.length === 0 ? "nothing" : parts.join(", ");
}
