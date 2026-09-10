/** Casino machine production, purchases, research, and specs. */

import { ECONOMY, MACHINES, RESEARCH_NODES, SPECS } from "../content/catalog";
import type { DepthBandId } from "../content/depthBands";
import {
  evaluateMachineLevel,
  FLYWHEEL_FLOOR,
  FLYWHEEL_SHORTENING_PER_CYCLE,
  GAMBLER_EXPONENT,
  GAMBLER_MAXIMUM,
  GAMBLER_MEAN,
  GAMBLER_MINIMUM,
  GAMBLER_VARIANCE,
  expectedSpecPayoutMultiplier,
} from "../content/machines";

import type {
  MachineDefinition,
  MachineId,
  MachineLevelDefinition,
  ResearchNodeId,
  SpecDefinition,
  SpecId,
} from "../content/catalog";
import { evaluateStat, type Modifier } from "./modifiers";
import { safeDivide } from "./numbers";
import { nextPowerCurveSum, type RngState } from "./rng";
import type { GameState, MachineProgress } from "./state";
import { canAfford, type ResourceDelta, type TransactionPlan } from "./transactions";

export function machineDefinition(machineId: MachineId): MachineDefinition {
  return MACHINES[machineId];
}

/** Evaluates the level curve. The formula lives in content; this binds the id. */
export function machineLevelDefinition(
  machineId: MachineId,
  level: number,
): MachineLevelDefinition | null {
  return evaluateMachineLevel(MACHINES[machineId], level);
}

/** Total payout multiplier from a machine's researched ranks. */
export function researchPayoutMultiplier(progress: MachineProgress): number {
  let multiplier = 1;

  for (const [nodeId, rank] of Object.entries(progress.researchRanks)) {
    const node = RESEARCH_NODES[nodeId as ResearchNodeId];

    if (node === undefined || rank <= 0) {
      continue;
    }

    multiplier *= node.payoutMultiplierPerRank ** rank;
  }

  return Number.isFinite(multiplier) ? multiplier : ECONOMY.safeMaximum;
}

export function researchRank(progress: MachineProgress, nodeId: ResearchNodeId): number {
  return progress.researchRanks[nodeId] ?? 0;
}

/** Chips for the next rank of a node, or null when it is already maxed. */
export function researchChipCost(
  progress: MachineProgress,
  nodeId: ResearchNodeId,
): number | null {
  const node = RESEARCH_NODES[nodeId];

  if (node === undefined) {
    return null;
  }

  const rank = researchRank(progress, nodeId);

  if (node.maximumRank !== null && rank >= node.maximumRank) {
    return null;
  }

  const cost = node.chipCost * node.chipCostGrowth ** rank;

  return Number.isFinite(cost) ? Math.round(cost) : null;
}

export function activeSpec(progress: MachineProgress): SpecDefinition | null {
  return progress.activeSpecId === null ? null : (SPECS[progress.activeSpecId] ?? null);
}

function activeSpecMultipliers(progress: MachineProgress): {
  payout: number;
  duration: number;
} {
  const spec = activeSpec(progress);

  return spec === null
    ? { payout: 1, duration: 1 }
    : { payout: spec.payoutMultiplier, duration: spec.durationMultiplier };
}

/**
 * How much the flywheel has shortened this machine's cycle so far. The ramp
 * compounds per completed cycle and stops at the floor, so it is a function of
 * the cycle count alone.
 */
export function flywheelDurationMultiplier(cycles: number): number {
  const completed = Math.max(0, Math.trunc(cycles));

  return Math.max(FLYWHEEL_FLOOR, (1 - FLYWHEEL_SHORTENING_PER_CYCLE) ** completed);
}

/** Cycles needed to reach the floor, past which the length stops changing. */
export const FLYWHEEL_CYCLES_TO_FLOOR = Math.ceil(
  Math.log(FLYWHEEL_FLOOR) / Math.log(1 - FLYWHEEL_SHORTENING_PER_CYCLE),
);

/**
 * Cycle payout before any modifier is applied, which is the base a `base + x`
 * breakdown is built from.
 */
export function baseCyclePayout(
  state: GameState,
  machineId: MachineId,
  levelOverride?: number,
): number {
  const definition = MACHINES[machineId];
  const progress = state.casino.machines[machineId];
  const level = levelOverride ?? progress.level;
  const levelDefinition = machineLevelDefinition(machineId, level);

  if (levelDefinition === null) {
    return 0;
  }

  const spec = activeSpecMultipliers(progress);
  const research = researchPayoutMultiplier(progress);
  const base =
    definition.basePayout * levelDefinition.payoutMultiplier * spec.payout * research;

  return Math.min(Number.isFinite(base) ? base : ECONOMY.safeMaximum, ECONOMY.safeMaximum);
}

/** Cash granted by one completed cycle at the machine's current configuration. */
export function selectCyclePayout(
  state: GameState,
  machineId: MachineId,
  modifiers: readonly Modifier[],
  levelOverride?: number,
): number {
  return evaluateStat(baseCyclePayout(state, machineId, levelOverride), modifiers, {
    targetStat: "machine.payout",
  });
}

/** Duration of one production cycle at the machine's current configuration. */
export function selectCycleMs(
  state: GameState,
  machineId: MachineId,
  modifiers: readonly Modifier[],
): number {
  const definition = MACHINES[machineId];
  const progress = state.casino.machines[machineId];
  const spec = activeSpecMultipliers(progress);
  const ramp =
    activeSpec(progress)?.behaviour === "flywheel"
      ? flywheelDurationMultiplier(progress.flywheelCycles)
      : 1;
  const base = definition.baseCycleMs * spec.duration * ramp;

  return evaluateStat(base, modifiers, { targetStat: "machine.cycleMs" });
}

/**
 * Payout averaged over the long run. Identical to `selectCyclePayout` except
 * under the Gambler, whose per-cycle draw makes a single cycle a poor
 * description. Rate readouts and previews use this; the tick applies its own draw.
 */
export function selectExpectedCyclePayout(
  state: GameState,
  machineId: MachineId,
  modifiers: readonly Modifier[],
  levelOverride?: number,
): number {
  const spec = activeSpec(state.casino.machines[machineId]);
  const payout = selectCyclePayout(state, machineId, modifiers, levelOverride);

  return spec === null ? payout : payout * (expectedSpecPayoutMultiplier(spec) / spec.payoutMultiplier);
}

export function selectCashPerSecond(
  state: GameState,
  machineId: MachineId,
  modifiers: readonly Modifier[],
): number {
  const cycleMs = selectCycleMs(state, machineId, modifiers);

  return safeDivide(selectExpectedCyclePayout(state, machineId, modifiers) * 1000, cycleMs);
}

export interface MachineAdvanceResult {
  machines: Record<MachineId, MachineProgress>;
  /**
   * Which machines completed at least one cycle, in ladder order, so the caller
   * can play the right payout cue. Reported here because this loop already
   * knows it.
   */
  completedMachineIds: MachineId[];
  cashGranted: number;
  /**
   * True on the single tick that takes cash to the ceiling and rolls it to
   * `INF`. Never true again afterwards, because an infinite balance has nothing
   * left to clamp.
   */
  clamped: boolean;
  /** Advanced whenever a Gambler cycle was drawn, so the caller can store it. */
  payoutRng: RngState;
}

/**
 * Counts the cycles an elapsed span completes, and what it leaves on the clock.
 * Constant-length cycles are one division; the flywheel's ramp has to be walked,
 * but only until it reaches the floor, after which the fast path takes over and
 * a long offline stretch stays cheap.
 */
function countCycles(
  baseCycleMs: number,
  isFlywheel: boolean,
  flywheelCycles: number,
  availableMs: number,
): { cycles: number; remainderMs: number; flywheelCycles: number } {
  if (!isFlywheel) {
    const cycles = Math.floor(availableMs / baseCycleMs);

    return { cycles, remainderMs: availableMs - cycles * baseCycleMs, flywheelCycles };
  }

  let remaining = availableMs;
  let ramp = flywheelCycles;
  let cycles = 0;

  while (ramp < FLYWHEEL_CYCLES_TO_FLOOR) {
    const length = baseCycleMs * flywheelDurationMultiplier(ramp);

    if (length <= 0 || remaining < length) {
      return { cycles, remainderMs: remaining, flywheelCycles: ramp };
    }

    remaining -= length;
    ramp += 1;
    cycles += 1;
  }

  const steady = baseCycleMs * FLYWHEEL_FLOOR;

  if (steady <= 0) {
    return { cycles, remainderMs: remaining, flywheelCycles: ramp };
  }

  const extra = Math.floor(remaining / steady);

  return {
    cycles: cycles + extra,
    remainderMs: remaining - extra * steady,
    flywheelCycles: ramp + extra,
  };
}

/**
 * Advances every unlocked machine by `elapsedMs` and reports the combined cash
 * so the caller can grant it in one atomic transaction.
 */
export function advanceMachines(
  state: GameState,
  elapsedMs: number,
  modifiers: readonly Modifier[],
): MachineAdvanceResult {
  const machines: Record<MachineId, MachineProgress> = { ...state.casino.machines };
  const completedMachineIds: MachineId[] = [];
  const elapsed = Math.max(0, elapsedMs);
  let cashGranted = 0;
  let payoutRng = state.random.machinePayout;

  for (const machineId of Object.keys(machines) as MachineId[]) {
    const progress = machines[machineId];

    if (!progress.unlocked) {
      continue;
    }

    const spec = activeSpec(progress);
    const isFlywheel = spec?.behaviour === "flywheel";
    // The unramped length: `countCycles` applies the ramp itself, per cycle.
    const cycleMs = isFlywheel
      ? safeDivide(
          selectCycleMs(state, machineId, modifiers),
          flywheelDurationMultiplier(progress.flywheelCycles),
        )
      : selectCycleMs(state, machineId, modifiers);

    if (cycleMs <= 0) {
      continue;
    }

    const counted = countCycles(
      cycleMs,
      isFlywheel,
      progress.flywheelCycles,
      progress.cycleProgressMs + elapsed,
    );

    machines[machineId] = {
      ...progress,
      cycleProgressMs: counted.remainderMs,
      flywheelCycles: counted.flywheelCycles,
    };

    if (counted.cycles > 0) {
      completedMachineIds.push(machineId);

      const payout = selectCyclePayout(state, machineId, modifiers);

      if (spec?.behaviour === "gambler") {
        const draw = nextPowerCurveSum(
          payoutRng,
          counted.cycles,
          GAMBLER_MINIMUM,
          GAMBLER_MAXIMUM,
          GAMBLER_EXPONENT,
          GAMBLER_MEAN,
          GAMBLER_VARIANCE,
        );

        payoutRng = draw.state;
        cashGranted += payout * draw.value;
      } else {
        cashGranted += counted.cycles * payout;
      }
    }
  }

  cashGranted = Math.floor(cashGranted);

  // The grant is trimmed to what fits below the ceiling, which is what turns the
  // next `addQuantity` into the rollover to `INF`. An already-infinite balance
  // is not clamped, or `clamped` would be true on every tick forever.
  const headroom = ECONOMY.safeMaximum - state.resources.cash;
  const clamped = Number.isFinite(state.resources.cash) && cashGranted > headroom;

  return {
    machines,
    completedMachineIds,
    cashGranted: Math.max(0, Math.floor(clamped ? headroom : cashGranted)),
    clamped,
    payoutRng,
  };
}

/**
 * Rescales partial cycle progress so a spec change neither grants nor destroys
 * production already accumulated.
 */
export function rescaleCycleProgress(
  progressMs: number,
  previousCycleMs: number,
  nextCycleMs: number,
): number {
  if (previousCycleMs <= 0) {
    return 0;
  }

  const ratio = progressMs / previousCycleMs;

  return Math.min(nextCycleMs, Math.max(0, ratio * nextCycleMs));
}

export type MachineActionBlock =
  | { kind: "locked" }
  | { kind: "max-level" }
  /** A batch size that is not a whole number of levels, or is not positive. */
  | { kind: "invalid-quantity" }
  | { kind: "research-required"; nodeId: ResearchNodeId }
  | { kind: "insufficient-resources"; missing: ResourceDelta[] }
  | { kind: "already-researched" }
  | { kind: "prerequisite-required"; nodeId: ResearchNodeId }
  | { kind: "unknown-spec" }
  | { kind: "spec-not-researched"; nodeId: ResearchNodeId }
  | { kind: "recipe-incomplete"; owned: number; required: number }
  | { kind: "already-unlocked" };

export type MachinePlan =
  | { ok: true; plan: TransactionPlan }
  | { ok: false; block: MachineActionBlock };

export function planMachineUnlock(state: GameState, machineId: MachineId): MachinePlan {
  const definition = MACHINES[machineId];
  const progress = state.casino.machines[machineId];

  if (progress.unlocked) {
    return { ok: false, block: { kind: "already-unlocked" } };
  }

  if (progress.recipePieces < definition.recipePiecesRequired) {
    return {
      ok: false,
      block: {
        kind: "recipe-incomplete",
        owned: progress.recipePieces,
        required: definition.recipePiecesRequired,
      },
    };
  }

  return {
    ok: true,
    plan: {
      label: `unlock:${machineId}`,
      costs: [],
      grants: [],
      inventoryMutations: [
        { kind: "recipePieces", machineId, delta: -definition.recipePiecesRequired },
      ],
      stateMutations: [
        (current) => ({
          ...current,
          casino: {
            ...current.casino,
            selectedMachineId: machineId,
            machines: {
              ...current.casino.machines,
              [machineId]: {
                ...current.casino.machines[machineId],
                unlocked: true,
                cycleProgressMs: 0,
              },
            },
          },
        }),
      ],
    },
  };
}

/**
 * Buys one level, or a batch of them, all or nothing: a batch of ten costs the
 * sum of the ten purchases it replaces and is refused entire if any part cannot
 * be paid for or represented. A button labelled "x10" must never buy seven.
 *
 * Representability matters because levels are uncapped but the curve stops
 * producing finite numbers eventually; the selector marks such a batch
 * unavailable rather than quietly buying fewer levels than the label promised.
 */
export function planMachineLevelPurchase(
  state: GameState,
  machineId: MachineId,
  quantity = 1,
): MachinePlan {
  const progress = state.casino.machines[machineId];

  if (!progress.unlocked) {
    return { ok: false, block: { kind: "locked" } };
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, block: { kind: "invalid-quantity" } };
  }

  let cashCost = 0;
  let componentCost = 0;

  for (let step = 1; step <= quantity; step += 1) {
    const level = machineLevelDefinition(machineId, progress.level + step);

    if (level === null) {
      return { ok: false, block: { kind: "max-level" } };
    }

    cashCost += level.cashCost;
    componentCost += level.componentCost;
  }

  const targetLevel = progress.level + quantity;
  const costs: ResourceDelta[] = [];

  if (cashCost > 0) {
    costs.push({ resource: "cash", amount: cashCost });
  }

  if (componentCost > 0) {
    costs.push({ resource: "components", amount: componentCost });
  }

  if (!canAfford(state, costs)) {
    return {
      ok: false,
      block: {
        kind: "insufficient-resources",
        missing: costs.filter((cost) => state.resources[cost.resource] < cost.amount),
      },
    };
  }

  return {
    ok: true,
    plan: {
      // The quantity is in the label so the transaction log distinguishes a batch
      // from one large single purchase.
      label: `machine-level:${machineId}:${quantity}`,
      costs,
      grants: [],
      stateMutations: [
        (current) => ({
          ...current,
          casino: {
            ...current.casino,
            machines: {
              ...current.casino.machines,
              [machineId]: {
                ...current.casino.machines[machineId],
                level: targetLevel,
              },
            },
          },
          onboarding: { ...current.onboarding, hasPurchasedMachineLevel: true },
        }),
      ],
    },
  };
}

export function planResearch(state: GameState, nodeId: ResearchNodeId): MachinePlan {
  const node = RESEARCH_NODES[nodeId];

  if (node === undefined) {
    return { ok: false, block: { kind: "unknown-spec" } };
  }

  const progress = state.casino.machines[node.machineId];

  if (!progress.unlocked) {
    return { ok: false, block: { kind: "locked" } };
  }

  const chipCost = researchChipCost(progress, nodeId);

  if (chipCost === null) {
    return { ok: false, block: { kind: "already-researched" } };
  }

  const missingPrerequisite = node.prerequisiteNodeIds.find(
    (prerequisite) => researchRank(progress, prerequisite) < 1,
  );

  if (missingPrerequisite !== undefined) {
    return { ok: false, block: { kind: "prerequisite-required", nodeId: missingPrerequisite } };
  }

  const costs: ResourceDelta[] = chipCost > 0 ? [{ resource: "chips", amount: chipCost }] : [];

  if (!canAfford(state, costs)) {
    return {
      ok: false,
      block: {
        kind: "insufficient-resources",
        missing: costs.filter((cost) => state.resources[cost.resource] < cost.amount),
      },
    };
  }

  return {
    ok: true,
    plan: {
      label: `research:${nodeId}`,
      costs,
      grants: [],
      stateMutations: [
        (current) => ({
          ...current,
          casino: {
            ...current.casino,
            machines: {
              ...current.casino.machines,
              [node.machineId]: {
                ...current.casino.machines[node.machineId],
                researchRanks: {
                  ...current.casino.machines[node.machineId].researchRanks,
                  [nodeId]: researchRank(current.casino.machines[node.machineId], nodeId) + 1,
                },
              },
            },
          },
        }),
      ],
    },
  };
}

export function isSpecAvailable(state: GameState, specId: SpecId): boolean {
  const spec = SPECS[specId];

  if (spec === undefined) {
    return false;
  }

  return researchRank(state.casino.machines[spec.machineId], spec.requiredResearchNodeId) >= 1;
}

/**
 * Spec switching is free and immediate. Progress is rescaled so the swap
 * neither grants nor destroys accumulated production.
 */
export function planSpecChange(
  state: GameState,
  machineId: MachineId,
  specId: SpecId | null,
  modifiers: readonly Modifier[],
): MachinePlan {
  const progress = state.casino.machines[machineId];

  if (!progress.unlocked) {
    return { ok: false, block: { kind: "locked" } };
  }

  if (specId !== null) {
    const spec = SPECS[specId];

    if (spec === undefined || spec.machineId !== machineId) {
      return { ok: false, block: { kind: "unknown-spec" } };
    }

    if (researchRank(progress, spec.requiredResearchNodeId) < 1) {
      return {
        ok: false,
        block: { kind: "spec-not-researched", nodeId: spec.requiredResearchNodeId },
      };
    }
  }

  const previousCycleMs = selectCycleMs(state, machineId, modifiers);

  return {
    ok: true,
    plan: {
      label: `spec:${machineId}:${specId ?? "none"}`,
      costs: [],
      grants: [],
      stateMutations: [
        (current) => {
          const swapped: GameState = {
            ...current,
            casino: {
              ...current.casino,
              machines: {
                ...current.casino.machines,
                [machineId]: {
                  ...current.casino.machines[machineId],
                  activeSpecId: specId,
                  // A flywheel's ramp is earned by leaving the spec alone, so
                  // swapping away from it — or onto it — starts from cold.
                  flywheelCycles: 0,
                },
              },
            },
          };

          const nextCycleMs = selectCycleMs(swapped, machineId, modifiers);

          return {
            ...swapped,
            casino: {
              ...swapped.casino,
              machines: {
                ...swapped.casino.machines,
                [machineId]: {
                  ...swapped.casino.machines[machineId],
                  cycleProgressMs: rescaleCycleProgress(
                    current.casino.machines[machineId].cycleProgressMs,
                    previousCycleMs,
                    nextCycleMs,
                  ),
                },
              },
            },
          };
        },
      ],
    },
  };
}

/**
 * The next machine still waiting on recipe pieces, optionally within one band.
 * Passing a band is what makes depth matter: a piece found on The Shelf can only
 * go toward a Shelf machine, so deep machines are a reason to dive.
 */
export function earliestIncompleteRecipeMachineId(
  state: GameState,
  band?: DepthBandId,
): MachineId | null {
  for (const machineId of Object.keys(MACHINES) as MachineId[]) {
    const definition = MACHINES[machineId];
    const progress = state.casino.machines[machineId];

    if (band !== undefined && definition.recipeBand !== band) {
      continue;
    }

    if (!progress.unlocked && progress.recipePieces < definition.recipePiecesRequired) {
      return machineId;
    }
  }

  return null;
}

/**
 * The single plan through which produced cash enters the economy, so lifetime
 * and per-cycle totals can never drift from the balance.
 */
export function planCashProduction(
  amount: number,
  machines: Record<MachineId, MachineProgress>,
  payoutRng: RngState,
): TransactionPlan {
  return {
    label: "casino-production",
    costs: [],
    grants: amount > 0 ? [{ resource: "cash", amount }] : [],
    stateMutations: [
      (current) => ({
        ...current,
        casino: { ...current.casino, machines },
        random: { ...current.random, machinePayout: payoutRng },
        prestige: {
          ...current.prestige,
          lifetimeCashEarned: current.prestige.lifetimeCashEarned + amount,
          cycleCashEarned: current.prestige.cycleCashEarned + amount,
        },
        statistics: {
          ...current.statistics,
          cashEarned: current.statistics.cashEarned + amount,
        },
      }),
    ],
  };
}
