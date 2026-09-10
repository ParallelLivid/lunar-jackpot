/**
 * Progression-pace simulation.
 *
 * A simple spending bot plays the casino loop so the balance report can state
 * how long each milestone takes. It only uses domain commands, so it can never
 * reach a state the player could not.
 */

import {
  ECONOMY,
  MACHINES,
  PRESTIGE_PERKS,
  PRESTIGE_PERK_IDS,
  STARTER_MACHINE_ID,
} from "../../content/catalog";
import { perkRankCost } from "../../content/prestigePerks";
import { evaluateMachineLevel } from "../../content/machines";
import type { MachineId } from "../../content/catalog";
import { prestigeDivisorFor, prestigeThresholdFor } from "../../domain/prestige";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";

export interface ProgressionMilestones {
  secondsToFirstUpgrade: number | null;
  secondsToFirstKey: number | null;
  secondsToPrestige: number | null;
  finalStarterLevel: number;
  simulatedSeconds: number;
}

/**
 * Buys the starter machine's next level whenever it is affordable and reports
 * when each milestone is reached. Expeditions are not simulated here, so this
 * measures the pure casino curve: a floor, not the expected player pace.
 */
export function simulateCasinoProgression(
  maximumSeconds = 4 * 60 * 60,
  stepMs = 1_000,
): ProgressionMilestones {
  let wallClockMs = 0;
  let state: GameState = createGameState({ nowUnixMs: wallClockMs, seed: 1 });
  let elapsedSeconds = 0;

  let secondsToFirstUpgrade: number | null = null;
  let secondsToFirstKey: number | null = null;
  let secondsToPrestige: number | null = null;

  const starter: MachineId = STARTER_MACHINE_ID;

  while (elapsedSeconds < maximumSeconds) {
    wallClockMs += stepMs;
    state = reduce(state, {
      type: "TICK",
      casinoElapsedMs: stepMs,
      expeditionElapsedMs: 0,
      nowUnixMs: wallClockMs,
    }).state;
    elapsedSeconds += stepMs / 1000;

    const purchase = reduce(state, { type: "BUY_MACHINE_LEVEL", machineId: starter });

    if (purchase.materialChange) {
      state = purchase.state;
      secondsToFirstUpgrade ??= elapsedSeconds;
    }

    if (secondsToFirstKey === null && state.resources.cash >= ECONOMY.keyCashCost) {
      secondsToFirstKey = elapsedSeconds;
    }

    if (
      secondsToPrestige === null &&
      state.prestige.cycleCashEarned >= prestigeThresholdFor(state.prestige.count)
    ) {
      secondsToPrestige = elapsedSeconds;
      break;
    }
  }

  return {
    secondsToFirstUpgrade,
    secondsToFirstKey,
    secondsToPrestige,
    finalStarterLevel: state.casino.machines[starter].level,
    simulatedSeconds: elapsedSeconds,
  };
}

export interface OfflineSample {
  gapMinutes: number;
  cash: number;
}

/** Offline income at common session gaps and at the cap. */
export function sampleOfflineIncome(level = 1): OfflineSample[] {
  const gaps = [5, 30, 60, 4 * 60, 8 * 60, 24 * 60];
  const definition = MACHINES[STARTER_MACHINE_ID];
  const levelDefinition =
    evaluateMachineLevel(definition, level) ?? evaluateMachineLevel(definition, 1)!;
  const payout = Math.floor(definition.basePayout * levelDefinition.payoutMultiplier);

  return gaps.map((gapMinutes) => {
    const creditedMs = Math.min(gapMinutes * 60_000, ECONOMY.offlineCapMs);

    return {
      gapMinutes,
      cash: Math.floor(creditedMs / definition.baseCycleMs) * payout,
    };
  });
}

// ---------------------------------------------------------------------------
// The prestige curve
// ---------------------------------------------------------------------------

export interface PrestigeCycleReport {
  prestigeCount: number;
  /** Cash needed to prestige at this count. */
  threshold: number;
  /** Selenite awarded at exactly the threshold, and at two and ten times it. */
  awardAtThreshold: number;
  awardAtDouble: number;
  awardAtTenTimes: number;
  /** Cheapest unbought perk rank once this cycle's award has been spent. */
  nextRankCost: number | null;
  /**
   * Award at twice the threshold, over the cost of the next rank. Below 1 and
   * staying there means a cycle no longer buys anything, and the tree has
   * stopped advancing however impressive the threshold looks.
   */
  advanceRatio: number | null;
}

/**
 * The prestige curve, cycle by cycle. Pure arithmetic over the content constants
 * rather than a played simulation: it answers whether the shape of the curve
 * lets the tree keep advancing, which does not depend on how fast any player
 * earns. How long a cycle takes needs a full-economy bot.
 *
 * The perk spend is greedy cheapest-first, which is neither optimal play nor the
 * worst case — it shows whether anything remains affordable, which is what the
 * ratio asks.
 */
export function prestigeCurveReport(cycles = 20): PrestigeCycleReport[] {
  const perks = PRESTIGE_PERK_IDS.map((perkId) => PRESTIGE_PERKS[perkId]);
  const ranks = new Map<string, number>();
  const report: PrestigeCycleReport[] = [];

  const cheapestNextRank = (): number | null => {
    let cheapest: number | null = null;

    for (const perk of perks) {
      const cost = perkRankCost(perk, ranks.get(perk.id) ?? 0);

      if (cost !== null && (cheapest === null || cost < cheapest)) {
        cheapest = cost;
      }
    }

    return cheapest;
  };

  const buyCheapest = (): boolean => {
    let target = perks[0];
    let best: number | null = null;

    for (const perk of perks) {
      const cost = perkRankCost(perk, ranks.get(perk.id) ?? 0);

      if (cost !== null && (best === null || cost < best)) {
        best = cost;
        target = perk;
      }
    }

    if (best === null) {
      return false;
    }

    ranks.set(target.id, (ranks.get(target.id) ?? 0) + 1);

    return true;
  };

  const awardFor = (cash: number, count: number): number => {
    if (cash < prestigeThresholdFor(count)) {
      return 0;
    }

    return Math.max(
      1,
      Math.floor((cash / prestigeDivisorFor(count)) ** ECONOMY.prestigeSeleniteExponent),
    );
  };

  let bank = 0;

  for (let count = 0; count <= cycles; count += 1) {
    const threshold = prestigeThresholdFor(count);
    const awardAtDouble = awardFor(threshold * 2, count);

    bank += awardAtDouble;

    // Spend down before reading the next price, so the ratio is measured against
    // what a player would actually be saving for.
    let next = cheapestNextRank();

    while (next !== null && next <= bank) {
      bank -= next;

      if (!buyCheapest()) {
        break;
      }

      next = cheapestNextRank();
    }

    report.push({
      prestigeCount: count,
      threshold,
      awardAtThreshold: awardFor(threshold, count),
      awardAtDouble,
      awardAtTenTimes: awardFor(threshold * 10, count),
      nextRankCost: next,
      advanceRatio: next === null ? null : awardAtDouble / next,
    });
  }

  return report;
}
