/**
 * Three parts of one economy, measured together, because each has tests that
 * pass on its own terms and none of them can see the coupling:
 *
 * - The prestige wall rises 1.5x per prestige, so a later cycle must reach a far
 *   larger income before it may reset.
 * - Overclock's price decides how fast that income arrives.
 * - A cache costs thirty seconds of that same income.
 *
 * The third couples them. If the wall outruns the ladder, caches get more
 * expensive in step with a threshold the player is already struggling to reach,
 * and the collectible economy stalls exactly where it should keep moving.
 *
 * These are pure readings over the content constants rather than played
 * simulations: they answer whether the shape holds, not how long a cycle takes.
 */

import { ECONOMY, MACHINE_IDS, MACHINES, machineMerit } from "../../content/catalog";
import { cachePrice } from "../../domain/collections";
import { createGameState } from "../../domain/state";
import { prestigeCurveReport } from "./progression";

/** A throwaway state, since `cachePrice` reads only the constants and the floor. */
const PRICING_STATE = createGameState({ nowUnixMs: 0, seed: 1 });

export interface CoupledCycleReport {
  prestigeCount: number;
  /** Cash this cycle must earn before it may reset. */
  threshold: number;
  /** Selenite the cycle awards at twice its threshold. */
  awardAtDouble: number;
  /**
   * The income a cycle needs to clear its own wall in an hour of play. A crude
   * stand-in for how rich the cycle has to get, but the right shape: the wall is
   * a cash total and income is what fills it.
   */
  incomeToClearInAnHour: number;
  /** What a cache costs at that income. */
  cachePriceAtThatIncome: number;
  /**
   * Caches the cycle's whole threshold would buy — the coupled number. Flat if
   * the three are in step, since both the wall and the cache price scale with
   * the same income. It falling is the failure mode: a collectible economy going
   * backwards while the wall goes forwards.
   */
  cachesPerCycle: number;
}

export function coupledBalanceReport(cycles = 20): CoupledCycleReport[] {
  const curve = prestigeCurveReport(cycles);
  const secondsPerHour = 3_600;

  return curve.map((cycle) => {
    const incomeToClearInAnHour = cycle.threshold / secondsPerHour;
    const price = cachePrice(PRICING_STATE, incomeToClearInAnHour);

    return {
      prestigeCount: cycle.prestigeCount,
      threshold: cycle.threshold,
      awardAtDouble: cycle.awardAtDouble,
      incomeToClearInAnHour,
      cachePriceAtThatIncome: price,
      cachesPerCycle: price <= 0 ? 0 : cycle.threshold / price,
    };
  });
}

export interface MachineLadderStep {
  machineId: string;
  displayName: string;
  merit: number;
  /** Merit gain over the machine below it, which is what makes it an upgrade. */
  stepOverPrevious: number | null;
}

/**
 * The Overclock ladder. A machine's whole competitive position is
 * `basePayout / cycleSeconds` divided by the square root of its Overclock cost,
 * because each rank costs four times as much and pays twice as much. Two
 * adjacent machines within a couple of percent on this measure makes the second
 * one permanently pointless.
 */
export function machineLadderReport(): MachineLadderStep[] {
  return MACHINE_IDS.map((machineId, index) => {
    const merit = machineMerit(machineId);
    const previous = index === 0 ? null : machineMerit(MACHINE_IDS[index - 1]);

    return {
      machineId,
      displayName: MACHINES[machineId].displayName,
      merit,
      stepOverPrevious: previous === null || previous <= 0 ? null : merit / previous,
    };
  });
}

/** The smallest step anywhere on the ladder, which is the one that can fail. */
export function weakestLadderStep(): MachineLadderStep | null {
  return machineLadderReport()
    .filter((step) => step.stepOverPrevious !== null)
    .reduce<MachineLadderStep | null>(
      (weakest, step) =>
        weakest === null || (step.stepOverPrevious ?? 0) < (weakest.stepOverPrevious ?? 0)
          ? step
          : weakest,
      null,
    );
}

export interface CacheGateReport {
  /** Depths a player must descend between purchases. */
  depthsPerPurchase: number;
  /** The floor a cache can never be priced below. */
  priceFloor: number;
  /** Income at which the derived price overtakes the floor. */
  incomeWhereFloorStopsBinding: number;
}

export function cacheGateReport(): CacheGateReport {
  const floor = ECONOMY.keyCashCost * ECONOMY.cacheMinimumKeyMultiple;

  return {
    depthsPerPurchase: ECONOMY.depthsPerCachePurchase,
    priceFloor: floor,
    incomeWhereFloorStopsBinding: floor / ECONOMY.cacheIncomeSeconds,
  };
}
