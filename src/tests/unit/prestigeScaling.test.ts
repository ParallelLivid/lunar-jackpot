/**
 * Coverage for the rising prestige wall and the offline cap.
 *
 * Both notes make progress slower and they land together, so the tests that
 * matter are not "does the threshold rise" — it plainly does — but whether the
 * curve leaves the perk tree able to advance. That is one number, measured
 * across twenty cycles, and it has a test of its own.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY } from "../../content/catalog";
import { prestigeCurveReport } from "../../dev/simulations/progression";
import { creditedOfflineMs, settleOfflineProduction } from "../../domain/offline";
import {
  applyPrestige,
  prestigeDivisorFor,
  prestigeProgressRatio,
  prestigeThreshold,
  prestigeThresholdFor,
  projectedSelenite,
} from "../../domain/prestige";
import { selectPrestigeView } from "../../domain/selectors";
import { PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY } from "../../domain/prestige";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

/** A state that has prestiged `count` times and earned `cash` this cycle. */
function cycle(count: number, cash = 0): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed: 4 });

  return {
    ...base,
    prestige: { ...base.prestige, count, cycleCashEarned: cash, lifetimeCashEarned: cash },
  };
}

describe("the rising wall", () => {
  it("asks for more after every prestige", () => {
    expect(prestigeThresholdFor(0)).toBe(ECONOMY.prestigeThresholdCash);

    for (let count = 0; count < 20; count += 1) {
      expect(prestigeThresholdFor(count + 1)).toBeGreaterThan(prestigeThresholdFor(count));
    }
  });

  it("leaves the first cycle exactly where it was", () => {
    // The wall only rises once you have already climbed it once, so nothing about
    // a brand new game changes.
    expect(prestigeThreshold(cycle(0))).toBe(250_000);
    expect(prestigeDivisorFor(0)).toBe(ECONOMY.prestigeSeleniteDivisor);
  });

  it("raises the divisor more slowly than the wall", () => {
    /*
     * The load-bearing constraint of this chunk, asserted on the constants rather
     * than only on their effects — see the next test for why it matters.
     */
    expect(ECONOMY.prestigeSeleniteDivisorGrowth).toBeLessThan(
      ECONOMY.prestigeThresholdGrowth,
    );
  });

  it("pays more for reaching the new wall than the old one paid", () => {
    /*
     * What the previous test buys, and the difference between a rising wall and a
     * treadmill. Measured with the two growth rates equal, the award sits at one
     * selenite from the first prestige to the twentieth while the threshold grows
     * twelve-thousandfold; here, clearing cycle 10's wall pays several times what
     * clearing cycle 0's did.
     */
    const atOwnThreshold = (count: number): number =>
      projectedSelenite(cycle(count, prestigeThresholdFor(count)));

    expect(atOwnThreshold(10)).toBeGreaterThan(atOwnThreshold(0));
    expect(atOwnThreshold(20)).toBeGreaterThan(atOwnThreshold(10));
  });

  it("keeps the perk tree advancing for twenty cycles", () => {
    /*
     * The number this chunk turns on. `advanceRatio` is the selenite a cycle
     * awards over the price of the cheapest thing left to buy; below 1 and
     * staying there, the tree has stopped and the game is a treadmill however
     * impressive the threshold looks.
     */
    const report = prestigeCurveReport(20);
    const ratios = report
      .map((row) => row.advanceRatio)
      .filter((ratio): ratio is number => ratio !== null);

    expect(ratios).toHaveLength(report.length);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(1);
    // And it should be getting easier, not merely surviving.
    expect(ratios[ratios.length - 1]).toBeGreaterThan(ratios[0]);
  });
});

describe("the selenite award", () => {
  it("never pays less for earning more, at any prestige count", () => {
    for (const count of [0, 5, 12]) {
      let previous = 0;

      for (let cash = prestigeThresholdFor(count); cash <= 1e12; cash *= 1.7) {
        const award = projectedSelenite(cycle(count, cash));

        expect(award, `count ${String(count)} at ${String(cash)}`).toBeGreaterThanOrEqual(
          previous,
        );
        previous = award;
      }
    }
  });

  it("pays no more for the same cash at a higher prestige count", () => {
    // The other direction. Identical cash is worth less once the divisor has
    // risen, which is the note's "requires more excess cash to increase".
    const cash = 5e9;
    let previous = projectedSelenite(cycle(0, cash));

    for (let count = 1; count <= 20; count += 1) {
      const award = projectedSelenite(cycle(count, cash));

      expect(award, `count ${String(count)}`).toBeLessThanOrEqual(previous);
      previous = award;
    }
  });

  it("pays nothing below this cycle's wall, even above the first cycle's", () => {
    // 300,000 clears the original flat threshold and not cycle 5's.
    expect(projectedSelenite(cycle(0, 300_000))).toBeGreaterThan(0);
    expect(projectedSelenite(cycle(5, 300_000))).toBe(0);
  });
});

describe("an existing save when this ships", () => {
  it("never shows a progress bar past full", () => {
    /*
     * A save sitting on cash that cleared the old flat threshold now finds the
     * wall has moved. The bar has to clamp, or the panel reads 340% until the
     * player catches up.
     */
    const wealthy = cycle(3, 100_000_000);

    expect(prestigeProgressRatio(wealthy)).toBe(1);
    expect(prestigeProgressRatio(cycle(3, 0))).toBe(0);

    const view = selectPrestigeView(wealthy, PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY);

    expect(view.progressRatio).toBeLessThanOrEqual(1);
  });

  it("shows this cycle's wall on the panel, not the first cycle's", () => {
    const view = selectPrestigeView(cycle(4), PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY);

    expect(view.threshold).toBe(prestigeThresholdFor(4));
    expect(view.threshold).toBeGreaterThan(ECONOMY.prestigeThresholdCash);
  });

  it("needs no migration, because the wall is derived from a count already saved", () => {
    // `prestige.count` has always been persisted, so nothing about the save
    // format changes; two states differing only in that count differ in wall.
    expect(prestigeThreshold(cycle(2))).not.toBe(prestigeThreshold(cycle(3)));
  });
});

describe("the offline cap", () => {
  it("credits ninety minutes and no more", () => {
    expect(ECONOMY.offlineCapMs).toBe(90 * 60 * 1000);
    expect(creditedOfflineMs(60 * 60 * 1000)).toBe(60 * 60 * 1000);
    expect(creditedOfflineMs(90 * 60 * 1000)).toBe(ECONOMY.offlineCapMs);
    expect(creditedOfflineMs(10 * 60 * 60 * 1000)).toBe(ECONOMY.offlineCapMs);
  });

  it("pays the same for ninety minutes as for ten hours", () => {
    const away = (ms: number) =>
      settleOfflineProduction(createGameState({ nowUnixMs: NOW, seed: 2 }), NOW + ms);

    const atCap = away(90 * 60 * 1000);
    const overnight = away(10 * 60 * 60 * 1000);

    expect(overnight.cashGranted).toBe(atCap.cashGranted);
    expect(overnight.creditedElapsedMs).toBe(atCap.creditedElapsedMs);
  });

  it("says when the cap bit, and not when it did not", () => {
    const away = (ms: number) =>
      settleOfflineProduction(createGameState({ nowUnixMs: NOW, seed: 2 }), NOW + ms);

    expect(away(30 * 60 * 1000).capped).toBe(false);
    expect(away(90 * 60 * 1000).capped).toBe(false);
    expect(away(91 * 60 * 1000).capped).toBe(true);
  });

  it("grants nothing for a clock that moved backwards", () => {
    expect(creditedOfflineMs(-5_000)).toBe(0);
  });
});

/**
 * The rail windows come down with the cycle.
 *
 * Asserted on the effect rather than on any window, because which windows are
 * open is React state in the dashboard and deliberately not in `GameState` —
 * the effect is the whole of the domain's part in this.
 */
describe("what a prestige tells the dashboard", () => {
  it("asks for the windows to be closed", () => {
    const outcome = applyPrestige(cycle(0, ECONOMY.prestigeThresholdCash * 10));

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.effects.map((effect) => effect.type)).toContain("CLOSE_WINDOWS");
    }
  });

  it("asks for nothing when the prestige is refused", () => {
    // A blocked prestige changed nothing, so there is nothing to close over.
    const outcome = applyPrestige(cycle(0, 0));

    expect(outcome.ok).toBe(false);
  });
});
