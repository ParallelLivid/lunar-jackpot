/**
 * Coverage for the income-scaled cache price.
 *
 * The gate is exercised in `autoContinueAndReadouts.test.ts`.
 * What is new here is the price, and the reason it needs tests of its own is
 * that it is **the first price in the game that moves on its own** — every other
 * cost is a constant or a function of a level that only changes when the player
 * buys something.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, MACHINE_IDS } from "../../content/catalog";
import { cachePrice, describeCachePurchase } from "../../domain/collections";
import { reduce, totalCashPerSecond } from "../../domain/reducer";
import { deriveContext, selectStoreView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { runMigrations } from "../../persistence/migrations";
import { SAVE_VERSION } from "../../persistence/saveSchema";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;

function fresh(seed = 9): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A save earning roughly the given rate, by levelling the starter machine. */
function earning(level: number, cash = 100_000_000): GameState {
  const base = fresh();

  return {
    ...base,
    resources: { ...base.resources, cash },
    statistics: { ...base.statistics, depthDescended: 1_000 },
    casino: {
      ...base.casino,
      machines: {
        ...base.casino.machines,
        [MACHINE_IDS[0]]: { ...base.casino.machines[MACHINE_IDS[0]], level },
      },
    },
  };
}

/** The ordinary cache's row, which is what every assertion here means by "a cache". */
function standardOffer(context: Parameters<typeof selectStoreView>[0]) {
  return selectStoreView(context).caches.find(
    (offer) => offer.cacheTypeId === "cache.standard",
  )!;
}

describe("pricing a cache against income", () => {
  it("charges the configured number of seconds of income", () => {
    // 30 seconds of 400 cash/s is 12,000 — and quantisation leaves that alone,
    // because it already has two significant figures.
    expect(cachePrice(fresh(), 400)).toBe(400 * ECONOMY.cacheIncomeSeconds);
  });

  it("rises as the machines do", () => {
    const rates = [10, 100, 1_000, 100_000];
    const prices = rates.map((rate) => cachePrice(fresh(), rate));

    for (let index = 1; index < prices.length; index += 1) {
      expect(prices[index]).toBeGreaterThan(prices[index - 1]);
    }
  });

  it("never falls below the key that opens it", () => {
    /*
     * The floor exists because thirty seconds of a *starting* income is a few
     * dozen cash — a cache would cost less than the key needed to open it, which
     * reads as broken rather than generous.
     */
    const floor = ECONOMY.keyCashCost * ECONOMY.cacheMinimumKeyMultiple;

    expect(cachePrice(fresh(), 0)).toBe(floor);
    expect(cachePrice(fresh(), 1)).toBe(floor);
    expect(floor).toBeGreaterThan(ECONOMY.keyCashCost);
  });

  it("survives a nonsensical rate rather than pricing at NaN", () => {
    expect(cachePrice(fresh(), Number.NaN)).toBeGreaterThan(0);
    expect(cachePrice(fresh(), -50)).toBeGreaterThan(0);
    expect(cachePrice(fresh(), Number.POSITIVE_INFINITY)).toBeGreaterThan(0);
  });

  it("quantises, so the number stops moving while it is being read", () => {
    /*
     * Income is not static: a flywheel machine's cycle shortens with every cycle
     * it completes, so an unrounded price would tick while the player decides.
     * Two significant figures means it only changes when income has changed
     * meaningfully.
     */
    expect(cachePrice(fresh(), 12_345)).toBe(370_000);
    expect(cachePrice(fresh(), 12_400)).toBe(370_000);
    expect(cachePrice(fresh(), 12_500)).toBe(380_000);
  });
});

describe("what is shown is what is charged", () => {
  it("charges exactly the price the store displayed", () => {
    /*
     * The property that makes a moving price acceptable. Both the view and the
     * purchase plan derive the price from the same state through the same
     * function, so they cannot disagree for a given state.
     */
    const state = earning(8);
    const shown = standardOffer(deriveContext(state)).cashPrice;
    const bought = reduce(state, { type: "BUY_CACHE", cacheTypeId: "cache.standard" });

    expect(bought.materialChange).toBe(true);
    expect(state.resources.cash - bought.state.resources.cash).toBe(shown);
  });

  it("shows the same price the domain would charge, at every income", () => {
    for (const level of [1, 5, 10, 15]) {
      const state = earning(level);
      const shown = standardOffer(deriveContext(state)).cashPrice;

      expect(shown, `level ${String(level)}`).toBe(
        describeCachePurchase(state, totalCashPerSecond(state)).price,
      );
    }
  });

  it("prices against every unlocked machine, not just the selected one", () => {
    /*
     * The store sits beside the whole casino; pricing off one machine would make
     * the cache cheaper the moment a player switched their selection.
     *
     * Levelled high enough that the price is off its floor. The retune made a
     * level worth far less on its own — the ladder is longer and flatter now —
     * so a level-10 machine alone quotes the minimum, and a comparison against a
     * floor compares nothing.
     */
    const one = earning(120);
    const two: GameState = {
      ...one,
      casino: {
        ...one.casino,
        machines: {
          ...one.casino.machines,
          [MACHINE_IDS[1]]: { ...one.casino.machines[MACHINE_IDS[1]], unlocked: true, level: 90 },
        },
      },
    };

    expect(standardOffer(deriveContext(two)).cashPrice).toBeGreaterThan(
      standardOffer(deriveContext(one)).cashPrice,
    );
  });
});

describe("the version 8 to 9 migration", () => {
  const legacy = (runsAtLastCachePurchase: number) => ({
    saveVersion: 8,
    contentVersion: "0.1.0",
    revision: 4,
    savedAtUnixMs: NOW,
    game: {
      resources: { cash: 5_000, caches: 2 },
      purchase: { runsAtLastCachePurchase },
      statistics: { runsReturned: 12, runsFailed: 3 },
    },
  });

  it("replaces the run stamp with a depth stamp", () => {
    const migrated = runMigrations(legacy(9));
    const purchase = (migrated.envelope.game as Record<string, Record<string, unknown>>).purchase;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(8));
    expect(migrated.envelope.saveVersion).toBe(SAVE_VERSION);
    expect(purchase.depthAtLastCachePurchase).toBe(0);
    expect(purchase.runsAtLastCachePurchase).toBeUndefined();
  });

  it("neither grants nor takes away a cache", () => {
    const migrated = runMigrations(legacy(9));
    const resources = (migrated.envelope.game as Record<string, Record<string, unknown>>).resources;

    expect(resources.caches).toBe(2);
    expect(resources.cash).toBe(5_000);
  });

  it("stamps zero rather than converting the old count", () => {
    /*
     * The two counters measure different things and no arithmetic relates them —
     * twelve runs might be thirty depths or three hundred. Zero is both the
     * honest value and the safe one: `depthDescended` also starts at zero on a
     * save predating chunk 2, so the player waits a full gate rather than being
     * handed a cache.
     */
    for (const stamp of [0, 3, 99]) {
      const migrated = runMigrations(legacy(stamp));
      const purchase = (migrated.envelope.game as Record<string, Record<string, unknown>>).purchase;

      expect(purchase.depthAtLastCachePurchase, `stamp ${String(stamp)}`).toBe(0);
    }
  });

  it("leaves an already-current save alone", () => {
    expect(runMigrations({ ...legacy(0), saveVersion: SAVE_VERSION }).appliedVersions).toEqual([]);
  });
});
