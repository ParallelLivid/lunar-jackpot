/**
 * Statistical checks over the real content and domain code.
 *
 * Tolerances are set for the sample sizes used here; these are convergence
 * checks, not assertions that a small sample hits an exact percentage.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY } from "../../content/catalog";
import {
  simulateEncounterDistribution,
  simulateFailureLoss,
  simulateRun,
} from "../../dev/simulations/expeditions";
import {
  maximumAttainableLuck,
  runSlotSimulations,
  slotReturnCurve,
} from "../../dev/simulations/gambling";
import {
  depthWagerCurve,
  chipGameLuckLevels,
  rouletteReturnByBet,
  runBlackjackSimulations,
  runDepthWagerSimulations,
  runRouletteSimulations,
} from "../../dev/simulations/chipGames";
import { sampleOfflineIncome, simulateCasinoProgression } from "../../dev/simulations/progression";
import {
  cacheGateReport,
  coupledBalanceReport,
  machineLadderReport,
  weakestLadderStep,
} from "../../dev/simulations/combinedBalance";

describe("slot return simulation", () => {
  const results = runSlotSimulations(60_000);

  it("matches the analytic return at every luck breakpoint", () => {
    for (const result of results) {
      expect(result.simulatedReturn).toBeGreaterThan(result.theoreticalReturn - 0.12);
      expect(result.simulatedReturn).toBeLessThan(result.theoreticalReturn + 0.12);
    }
  });

  it("starts below 100% and never exceeds the configured cap", () => {
    const [zeroLuck] = results;

    expect(zeroLuck.theoreticalReturn).toBeLessThan(1);

    for (const result of results) {
      expect(result.theoreticalReturn).toBeLessThanOrEqual(
        ECONOMY.gamblingMaxExpectedReturn + 1e-9,
      );
    }
  });

  it("rises monotonically with luck across the published curve", () => {
    const curve = slotReturnCurve(10);

    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index].expectedReturn).toBeGreaterThanOrEqual(
        curve[index - 1].expectedReturn - 1e-9,
      );
    }
  });

  it("caps the return a player can actually reach with three unique totems", () => {
    const best = maximumAttainableLuck();

    expect(best.luckPoints).toBeGreaterThan(0);
    expect(best.luckPoints).toBeLessThanOrEqual(ECONOMY.luckPointCap);
  });
});

describe("expedition simulation", () => {
  it("produces a spread of encounter families over many runs", () => {
    const distribution = simulateEncounterDistribution(12);

    expect(distribution.samples).toBeGreaterThan(20);
    expect(distribution.byFamily.ore).toBeGreaterThan(0);

    // Every generated encounter belongs to a known family.
    const total = Object.values(distribution.byFamily).reduce((sum, count) => sum + count, 0);

    expect(total).toBe(distribution.samples);
  });

  it("lets a cautious run bank loot without failing", () => {
    const outcome = simulateRun(1_234, 0.4);

    expect(outcome.failed).toBe(false);
    expect(outcome.chipsGained).toBeGreaterThan(0);
  });

  it("fails a reckless run that never returns", () => {
    const outcome = simulateRun(4_321, 0);

    expect(outcome.failed).toBe(true);
  });

  it("converges on the configured loss rate at base and with each retention totem", () => {
    for (const sample of simulateFailureLoss(20_000)) {
      expect(sample.observedLossRate).toBeGreaterThan(sample.lossChance - 0.02);
      expect(sample.observedLossRate).toBeLessThan(sample.lossChance + 0.02);
    }
  });
});

describe("progression pace", () => {
  it("reaches the first machine upgrade quickly on casino income alone", () => {
    const milestones = simulateCasinoProgression(30 * 60);

    expect(milestones.secondsToFirstUpgrade).not.toBeNull();
    expect(milestones.secondsToFirstUpgrade ?? Infinity).toBeLessThan(5 * 60);
  });

  it("reports offline income at common gaps and at the cap", () => {
    const samples = sampleOfflineIncome();
    const capped = samples.filter((sample) => sample.gapMinutes * 60_000 > ECONOMY.offlineCapMs);

    expect(samples[0].cash).toBeGreaterThan(0);
    expect(new Set(capped.map((sample) => sample.cash)).size).toBe(1);

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].cash).toBeGreaterThanOrEqual(samples[index - 1].cash);
    }
  });
});

describe("roulette return simulation", () => {
  const results = runRouletteSimulations(40_000);

  it("matches the analytic return at every bet type and luck breakpoint", () => {
    for (const result of results) {
      /*
       * A straight-up bet pays 36x on a 1-in-37 shot, so a forty-thousand-spin
       * sample swings far wider than an even-money one. The tolerance is scaled
       * by the payout rather than set to one number that would be either useless
       * for the outside bets or flaky for the straight.
       */
      const tolerance = result.betTypeId === "bet.straight" ? 0.6 : 0.06;

      expect(
        Math.abs(result.simulatedReturn - result.theoreticalReturn),
        `${result.label} simulated ${result.simulatedReturn.toFixed(4)} against ${result.theoreticalReturn.toFixed(4)}`,
      ).toBeLessThan(tolerance);
    }
  });

  it("starts below 100% and never exceeds the cap", () => {
    for (const result of results) {
      expect(result.theoreticalReturn).toBeLessThanOrEqual(
        ECONOMY.gamblingMaxExpectedReturn + 1e-9,
      );
    }

    for (const row of rouletteReturnByBet(0, [])) {
      // One green pocket of edge, and the same edge on every bet.
      expect(row.expectedReturn).toBeCloseTo(36 / 37, 9);
    }
  });
});

describe("blackjack return simulation", () => {
  /*
   * The check the plan asked for in as many words: the cap is calibrated against
   * realised basic-strategy play rather than a closed form on the opening deal,
   * because the player acts *after* seeing a card. If the two ever disagree, the
   * simulated figure is the real one — so it is the simulated figure that is
   * asserted against the cap here.
   */
  const results = runBlackjackSimulations(120_000);

  it("holds realised play inside the cap at every luck breakpoint", () => {
    for (const result of results) {
      expect(
        result.realisedReturn,
        `${result.label} realised ${result.realisedReturn.toFixed(4)}`,
      ).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 0.01);
    }
  });

  it("agrees with what the cap believes it is allowing", () => {
    for (const result of results) {
      expect(
        Math.abs(result.realisedReturn - result.cappedReturn),
        `${result.label}: realised ${result.realisedReturn.toFixed(4)} against a believed ${result.cappedReturn.toFixed(4)}`,
      ).toBeLessThan(0.01);
    }
  });

  it("starts below 100% and improves with luck", () => {
    const [zero, , best] = results;

    expect(zero.cappedReturn).toBeLessThan(1);
    expect(best.cappedReturn).toBeGreaterThan(zero.cappedReturn);
  }, 300_000);
}, 300_000);

describe("depth wager pricing", () => {
  it("keeps every offered target inside the cap, at every record and luck level", () => {
    for (const report of runDepthWagerSimulations()) {
      expect(report.points).toBeGreaterThan(0);
      expect(
        report.highestExpectedReturn,
        `${report.label} peaked at ${report.highestExpectedReturn.toFixed(4)}`,
      ).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 1e-9);
    }
  });

  it("prices deeper targets at longer odds, without exception", () => {
    for (const level of chipGameLuckLevels()) {
      const curve = depthWagerCurve(60, level.luckPoints, level.modifiers);

      for (let index = 1; index < curve.length; index += 1) {
        expect(curve[index].successChance).toBeLessThan(curve[index - 1].successChance);
        expect(curve[index].offeredMultiplier).toBeGreaterThanOrEqual(
          curve[index - 1].offeredMultiplier - 1e-9,
        );
      }
    }
  });
});

describe("balance chunks, measured together", () => {
  /*
   * §17 of the plan: chunks 3, 4 and 5 change different parts of one economy —
   * how much prestige costs, how fast cash grows, and what chips buy — and
   * measuring them in isolation misses what they do to each other. Each has its
   * own tests already; these are the ones only the combination can fail.
   */

  it("keeps caches affordable as the prestige wall rises", () => {
    /*
     * The coupled number, and the one that could have gone wrong quietly. A
     * cache costs thirty seconds of income (chunk 5) and the wall demands ever
     * more income (chunk 3), so the two scale together and cancel. If they ever
     * stop cancelling, this spreads out: a later cycle affording fewer caches
     * than an earlier one is the collectible economy going backwards while the
     * wall goes forwards.
     */
    const report = coupledBalanceReport(20);
    const affordable = report.map((cycle) => cycle.cachesPerCycle);
    const lowest = Math.min(...affordable);
    const highest = Math.max(...affordable);

    expect(lowest).toBeGreaterThan(0);
    // Flat to within the rounding the price quantiser introduces, across twenty
    // prestiges and a wall that grows more than three thousandfold.
    expect(highest / lowest).toBeLessThan(1.1);
  });

  it("keeps the perk tree advancing behind that wall", () => {
    const report = coupledBalanceReport(20);

    expect(report[0].awardAtDouble).toBeGreaterThan(0);
    // The award has to outgrow nothing in particular, but it must not be pinned:
    // a flat award behind a rising wall is a tree that has stopped.
    expect(report[report.length - 1].awardAtDouble).toBeGreaterThan(
      report[0].awardAtDouble * 5,
    );
  });

  it("leaves no dead heat anywhere on the machine ladder", () => {
    /*
     * Chunk 4 existed because Penny Reels and Vacuum Roulette sat 1.8% apart on
     * merit, which made the second machine permanently pointless. Asserting the
     * *weakest* step rather than that one pair is what stops the same bug
     * reappearing between two different machines.
     */
    const weakest = weakestLadderStep();

    expect(weakest).not.toBeNull();
    expect(weakest?.stepOverPrevious ?? 0).toBeGreaterThan(1.5);

    for (const step of machineLadderReport()) {
      expect(step.merit).toBeGreaterThan(0);
    }
  });

  it("prices a cache above the key that opens it, at every income", () => {
    const gate = cacheGateReport();

    expect(gate.priceFloor).toBeGreaterThan(ECONOMY.keyCashCost);
    expect(gate.depthsPerPurchase).toBe(ECONOMY.depthsPerCachePurchase);
    // The floor stops binding at a very modest income, so it protects the first
    // few minutes without distorting anything after them.
    expect(gate.incomeWhereFloorStopsBinding).toBeLessThan(100);
  });
});
