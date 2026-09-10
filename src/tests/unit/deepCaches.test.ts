/**
 * Coverage for the second kind of cache.
 *
 * The cache used to be one thing, so nothing needed a name. Two kinds makes
 * every question about it a question with two answers — which balance holds it,
 * which table it draws from, which gate paces it — and the failure worth
 * guarding is the two quietly sharing one where they should not.
 */

import { describe, expect, it } from "vitest";
import {
  CACHE_TYPES,
  DEEP_CACHE_TYPE_ID,
  ECONOMY,
  STANDARD_CACHE_TYPE_ID,
} from "../../content/catalog";
import {
  MAXIMUM_CACHE_BATCH,
  affordableQuantity,
  cacheChipPrice,
  openableCacheCount,
} from "../../domain/collections";
import { reduce } from "../../domain/reducer";
import {
  deriveContext,
  selectCacheResultsView,
  selectStoreView,
} from "../../domain/selectors";
import { commitFailureResult } from "../../domain/expedition";
import { createRngState } from "../../domain/rng";
import {
  createEmptyRunInventory,
  createGameState,
  type GameState,
} from "../../domain/state";
import { runMigrations } from "../../persistence/migrations";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;

function fresh(seed = 17): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

function offersOf(state: GameState) {
  return selectStoreView(deriveContext(state)).caches;
}

function offerOf(state: GameState, cacheTypeId: string) {
  return offersOf(state).find((offer) => offer.cacheTypeId === cacheTypeId)!;
}

describe("two kinds of cache", () => {
  it("counts them in separate balances", () => {
    // Not a typed count inside one number: each kind is a resource, which is what
    // gets it onto the resource bar and through the transaction layer unaided.
    expect(CACHE_TYPES[STANDARD_CACHE_TYPE_ID].resourceId).toBe("caches");
    expect(CACHE_TYPES[DEEP_CACHE_TYPE_ID].resourceId).toBe("deepCaches");
  });

  it("inverts the odds rather than inventing a second table", () => {
    const standard = CACHE_TYPES[STANDARD_CACHE_TYPE_ID].rewards;
    const deep = CACHE_TYPES[DEEP_CACHE_TYPE_ID].rewards;

    // Same entries, opposite weights. Built from the id lists, so a collectible
    // cannot exist in one table and be missing from the other.
    expect(deep.map((entry) => entry.id).sort()).toEqual(
      standard.map((entry) => entry.id).sort(),
    );

    const weightOf = (table: typeof standard, kind: "trinket" | "totem"): number =>
      table.find((entry) => entry.reward.kind === kind)!.weight;

    expect(weightOf(standard, "trinket")).toBe(weightOf(deep, "totem"));
    expect(weightOf(standard, "totem")).toBe(weightOf(deep, "trinket"));
    expect(weightOf(deep, "totem")).toBeGreaterThan(weightOf(deep, "trinket"));
  });

  it("draws a deep cache mostly as totems", () => {
    let state: GameState = {
      ...fresh(3),
      resources: { ...fresh(3).resources, keys: 200, deepCaches: 200 },
    };

    for (let index = 0; index < 200; index += 1) {
      state = reduce(state, { type: "OPEN_CACHES", quantity: 1, cacheTypeId: DEEP_CACHE_TYPE_ID }).state;
    }

    const totems = Object.values(state.collection.totems).filter((totem) => totem.owned).length;
    const trinkets = Object.values(state.collection.trinkets).filter(
      (trinket) => trinket.owned,
    ).length;

    expect(totems).toBeGreaterThan(trinkets);
  });

  it("spends the balance the kind belongs to, and only that one", () => {
    const base = fresh(5);
    const state: GameState = {
      ...base,
      resources: { ...base.resources, keys: 1, caches: 1, deepCaches: 1 },
    };

    const opened = reduce(state, { type: "OPEN_CACHES", quantity: 1, cacheTypeId: DEEP_CACHE_TYPE_ID }).state;

    expect(opened.resources.deepCaches).toBe(0);
    expect(opened.resources.caches).toBe(1);
    expect(opened.resources.keys).toBe(0);
  });

  it("refuses a kind the player does not hold", () => {
    const base = fresh(6);
    const state: GameState = { ...base, resources: { ...base.resources, keys: 1, caches: 1 } };

    expect(
      reduce(state, { type: "OPEN_CACHES", quantity: 1, cacheTypeId: DEEP_CACHE_TYPE_ID }).materialChange,
    ).toBe(false);
  });
});

describe("buying with chips", () => {
  it("is ungated, unlimited, and flat-priced", () => {
    const base = fresh(7);
    const state: GameState = { ...base, resources: { ...base.resources, chips: 1_000 } };

    const bought = reduce(state, {
      type: "BUY_CACHE_WITH_CHIPS",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 10,
    });

    expect(bought.materialChange).toBe(true);
    expect(bought.state.resources.caches).toBe(10);
    expect(bought.state.resources.chips).toBe(1_000 - ECONOMY.cacheChipCost * 10);
    // No depth gate touched: the counter is the cash cache's, not this one's.
    expect(bought.state.purchase.depthAtLastCachePurchase).toBe(
      state.purchase.depthAtLastCachePurchase,
    );
  });

  it("prices the deep cache higher, in chips as in cash", () => {
    expect(cacheChipPrice(DEEP_CACHE_TYPE_ID)).toBeGreaterThan(
      cacheChipPrice(STANDARD_CACHE_TYPE_ID),
    );

    const rich: GameState = { ...fresh(8), resources: { ...fresh(8).resources, cash: 1e9 } };
    const context = deriveContext(rich);
    const [standard, deep] = selectStoreView(context).caches;

    expect(deep.cashPrice).toBeGreaterThan(standard.cashPrice);
    expect(deep.depthsPerRestock).toBeGreaterThan(standard.depthsPerRestock);
  });

  it("refuses more than the chips cover", () => {
    const base = fresh(9);
    const state: GameState = { ...base, resources: { ...base.resources, chips: 49 } };

    expect(
      reduce(state, {
        type: "BUY_CACHE_WITH_CHIPS",
        cacheTypeId: STANDARD_CACHE_TYPE_ID,
        quantity: 1,
      }).materialChange,
    ).toBe(false);
  });

  it("runs the two cash gates independently", () => {
    /*
     * Sharing one stamp would mean buying either kind reset the other's restock,
     * which is the sort of thing that only shows up as "the store feels wrong".
     */
    const base = fresh(10);
    const state: GameState = {
      ...base,
      resources: { ...base.resources, cash: 1e9 },
      statistics: { ...base.statistics, depthDescended: 1_000 },
    };

    const bought = reduce(state, {
      type: "BUY_CACHE",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
    }).state;

    expect(bought.purchase.depthAtLastCachePurchase).toBe(1_000);
    expect(bought.purchase.depthAtLastDeepCachePurchase).toBe(0);
    // And the deep one is still in stock, because its own counter never moved.
    expect(offerOf(bought, DEEP_CACHE_TYPE_ID).depthsUntilRestock).toBe(0);
  });
});

describe("bulk quantities", () => {
  it("offers what the balance actually covers", () => {
    const base = fresh(11);
    const state: GameState = { ...base, resources: { ...base.resources, chips: 175 } };

    // 175 chips at 50 each buys three, so the rungs stop there rather than
    // offering a 10 the player cannot pay for.
    expect(offerOf(state, STANDARD_CACHE_TYPE_ID).chipOffers.map((offer) => offer.quantity)).toEqual(
      [1, 3],
    );
  });

  it("never offers a quantity twice", () => {
    const base = fresh(12);
    const state: GameState = { ...base, resources: { ...base.resources, chips: 500 } };

    const quantities = offerOf(state, STANDARD_CACHE_TYPE_ID).chipOffers.map(
      (offer) => offer.quantity,
    );

    expect(new Set(quantities).size).toBe(quantities.length);
    expect([...quantities].sort((a, b) => a - b)).toEqual(quantities);
  });

  /**
   * Every button in a bulk row states its own price and greys out when it cannot
   * be paid for. A row rendering bare quantities with no availability leaves its
   * buttons live on an empty balance and the click refused instead.
   */
  it("prices every button and grants it the plan's own availability", () => {
    const base = fresh(13);
    const broke: GameState = { ...base, resources: { ...base.resources, chips: 0 } };
    const offers = offerOf(broke, STANDARD_CACHE_TYPE_ID).chipOffers;

    expect(offers).toHaveLength(1);
    expect(offers[0].quantity).toBe(1);
    expect(offers[0].totalPrice).toBe(offerOf(broke, STANDARD_CACHE_TYPE_ID).chipPrice);
    expect(offers[0].purchase.available).toBe(false);
    expect(offers[0].purchase.reason).not.toBeNull();

    const rich: GameState = { ...base, resources: { ...base.resources, chips: 175 } };

    for (const offer of offerOf(rich, STANDARD_CACHE_TYPE_ID).chipOffers) {
      expect(offer.purchase.available).toBe(true);
      expect(offer.totalPrice).toBe(offer.quantity * 50);
    }
  });

  it("prices and gates the key row the same way", () => {
    const base = fresh(14);
    const broke: GameState = { ...base, resources: { ...base.resources, cash: 0 } };
    const keys = selectStoreView(deriveContext(broke)).keyOffers;

    expect(keys.every((offer) => !offer.purchase.available)).toBe(true);

    const rich: GameState = { ...base, resources: { ...base.resources, cash: 1_000 } };

    for (const offer of selectStoreView(deriveContext(rich)).keyOffers) {
      expect(offer.purchase.available).toBe(true);
      expect(offer.totalPrice).toBe(offer.quantity * 250);
    }
  });

  it("gives an infinite balance a number somebody can be charged", () => {
    // `Infinity / 50` is `Infinity`, which is not a quantity any command can take.
    expect(affordableQuantity(Number.POSITIVE_INFINITY, 50)).toBeGreaterThan(0);
    expect(Number.isFinite(affordableQuantity(Number.POSITIVE_INFINITY, 50))).toBe(true);
  });
});

describe("the standing order", () => {
  function ticked(state: GameState): GameState {
    return reduce(state, {
      type: "TICK",
      casinoElapsedMs: 1_000,
      expeditionElapsedMs: 0,
      nowUnixMs: NOW + 1_000,
    }).state;
  }

  /** Enough cash and depth that only the toggle decides whether it fires. */
  function ready(): GameState {
    const base = fresh(13);

    return {
      ...base,
      resources: { ...base.resources, cash: 1e9 },
      statistics: { ...base.statistics, depthDescended: 500 },
      settings: { ...base.settings, cacheAutobuy: { enabled: true } },
    };
  }

  it("buys the restocked cache without being asked", () => {
    const after = ticked(ready());

    expect(after.resources.caches).toBe(1);
    expect(after.purchase.depthAtLastCachePurchase).toBe(500);
  });

  it("does nothing until it is switched on", () => {
    const off = ready();
    const disabled: GameState = {
      ...off,
      settings: { ...off.settings, cacheAutobuy: { enabled: false } },
    };

    expect(ticked(disabled).resources.caches).toBe(0);
  });

  it("is paced by the Company's restock counter and nothing else", () => {
    /*
     * Exactly one gate remains, and it is the Company's restock — a player-set
     * depth floor would be a second gate layered over the first.
     *
     * The second assertion is the one such a floor would fail: a save ten depths
     * old with a restock due buys immediately.
     */
    const base = ready();
    const gate = offerOf(base, STANDARD_CACHE_TYPE_ID).depthsPerRestock;

    const descended = (depth: number): GameState => ({
      ...base,
      statistics: { ...base.statistics, depthDescended: depth },
      purchase: { ...base.purchase, depthAtLastCachePurchase: 0 },
    });

    expect(ticked(descended(gate - 1)).resources.caches).toBe(0);
    expect(ticked(descended(gate)).resources.caches).toBe(1);
  });

  it("never spends the last of the cash", () => {
    /*
     * The rule that keeps this from ending the game in the background: without a
     * floor it would hold the balance at zero forever and no machine level could
     * ever be bought again.
     */
    const base = ready();
    const price = offerOf(base, STANDARD_CACHE_TYPE_ID).cashPrice;
    const thin: GameState = { ...base, resources: { ...base.resources, cash: price } };

    expect(ticked(thin).resources.caches).toBe(0);
    expect(ticked(thin).resources.cash).toBeGreaterThanOrEqual(price);
  });

  it("says what it spent", () => {
    // An unexplained drop in cash is worse than no automation at all.
    const result = reduce(ready(), {
      type: "TICK",
      casinoElapsedMs: 1_000,
      expeditionElapsedMs: 0,
      nowUnixMs: NOW + 1_000,
    });

    expect(
      result.effects.some(
        (effect) => effect.type === "SHOW_FEEDBACK" && effect.message.includes("Standing order"),
      ),
    ).toBe(true);
  });

  it("fires once per restock rather than every tick", () => {
    const first = ticked(ready());
    const second = ticked(first);

    expect(second.resources.caches).toBe(1);
  });
});

describe("carrying one out of a run", () => {
  const inventory = {
    ...createEmptyRunInventory(),
    deepCaches: 3,
  };

  it("banks into its own balance on a safe return", () => {
    // The whole reason a deep cache is a resource: banking is the transaction
    // layer's job, and it only knows how to move things that are.
    const base = fresh(14);
    const launched = reduce(base, { type: "LAUNCH_EXPEDITION" }).state;
    const carrying: GameState = {
      ...launched,
      expedition: { ...launched.expedition, status: "decision", runInventory: inventory },
    };

    const banked = reduce(carrying, { type: "RETURN_FROM_EXPEDITION" }).state;

    expect(banked.resources.deepCaches).toBe(3);
    expect(banked.resources.caches).toBe(0);
  });

  it("is rolled for loss on its own, like everything else carried", () => {
    // No safer coming out of the dark than an ordinary cache is.
    const outcomes = new Set<number>();

    for (let seed = 0; seed < 200; seed += 1) {
      const result = commitFailureResult(
        inventory,
        createRngState(seed, "expedition-failure"),
        ECONOMY.failureLossChanceBase,
      );

      outcomes.add(result.result.recovered.deepCaches);
      expect(result.result.recovered.deepCaches + result.result.lost.deepCaches).toBe(3);
    }

    expect(outcomes.has(0)).toBe(true);
    expect(outcomes.has(3)).toBe(true);
  });
});

describe("the version 11 to 12 migration", () => {
  it("leaves existing caches ordinary and starts deep ones at zero", () => {
    const migrated = runMigrations({
      saveVersion: 11,
      contentVersion: "0.1.0",
      revision: 1,
      savedAtUnixMs: NOW,
      checksum: "ignored",
      game: { resources: { caches: 4 } },
    });

    const game = migrated.envelope.game as Record<string, Record<string, unknown>>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(11));
    expect(game.resources.caches).toBe(4);
    expect(game.resources.deepCaches).toBe(0);
    expect(game.purchase.depthAtLastDeepCachePurchase).toBe(0);
    // `minimumDepth` no longer exists on this object, so there is nothing to
    // default; the migration credits an older save with the order switched off.
    expect(game.settings.cacheAutobuy).toEqual({ enabled: false });
  });
});

describe("opening in bulk", () => {
  function stocked(keys: number, caches: number): GameState {
    const base = fresh(21);

    return { ...base, resources: { ...base.resources, keys, caches } };
  }

  it("spends exactly one key and one cache per open", () => {
    const opened = reduce(stocked(10, 10), {
      type: "OPEN_CACHES",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 6,
    }).state;

    expect(opened.resources.keys).toBe(4);
    expect(opened.resources.caches).toBe(4);
    expect(opened.statistics.cachesOpened).toBe(6);
  });

  it("opens as many as it can and says how many it could not", () => {
    /*
     * Not a refusal. Asking for ten with three keys should open three and
     * account for the rest — failing the whole command would leave the player
     * with their keys and no explanation.
     */
    const result = reduce(stocked(3, 10), {
      type: "OPEN_CACHES",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 10,
    });

    const batch = result.effects.find((effect) => effect.type === "SHOW_CACHE_RESULTS");

    expect(result.state.resources.keys).toBe(0);
    expect(result.state.resources.caches).toBe(7);
    expect(batch?.type === "SHOW_CACHE_RESULTS" ? batch.batch.results.length : 0).toBe(3);
    expect(batch?.type === "SHOW_CACHE_RESULTS" ? batch.batch.shortfall : 0).toBe(7);
  });

  it("refuses, rather than opening nothing, when it cannot open one", () => {
    const result = reduce(stocked(0, 10), {
      type: "OPEN_CACHES",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 5,
    });

    expect(result.materialChange).toBe(false);
    expect(result.state.resources.caches).toBe(10);
  });

  it("reports once for the whole batch, not once per cache", () => {
    // Twenty feedback lines and twenty save requests is what a per-cache dispatch
    // would have produced, and is the reason this is one command.
    const result = reduce(stocked(20, 20), {
      type: "OPEN_CACHES",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 20,
    });

    const count = (type: string): number =>
      result.effects.filter((effect) => effect.type === type).length;

    expect(count("SHOW_FEEDBACK")).toBe(1);
    expect(count("REQUEST_SAVE")).toBe(1);
    expect(count("SHOW_CACHE_RESULTS")).toBe(1);
  });

  it("draws each open against the state the last one left", () => {
    /*
     * The reason the batch is sequential. Resolving every draw against the
     * starting state would report the first find over and over — the second copy
     * of a trinket is fragments *because* the first one made it owned.
     */
    const result = reduce(stocked(30, 30), {
      type: "OPEN_CACHES",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 30,
    });

    const batch = result.effects.find((effect) => effect.type === "SHOW_CACHE_RESULTS");
    const arrivals = new Set(
      batch?.type === "SHOW_CACHE_RESULTS"
        ? batch.batch.results.map((entry) => entry.arrival)
        : [],
    );

    expect(arrivals.has("item")).toBe(true);
    expect(arrivals.has("fragments")).toBe(true);
  });

  it("caps a batch so an endless balance cannot ask for endless work", () => {
    const endless = stocked(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

    expect(openableCacheCount(endless, STANDARD_CACHE_TYPE_ID)).toBe(MAXIMUM_CACHE_BATCH);

    const result = reduce(endless, {
      type: "OPEN_CACHES",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 10_000,
    });

    const batch = result.effects.find((effect) => effect.type === "SHOW_CACHE_RESULTS");

    expect(batch?.type === "SHOW_CACHE_RESULTS" ? batch.batch.results.length : 0).toBe(
      MAXIMUM_CACHE_BATCH,
    );
  });

  it("groups the summary rather than listing every cache", () => {
    // Opening a hundred and reading a hundred rows is not a summary.
    const result = reduce(stocked(40, 40), {
      type: "OPEN_CACHES",
      cacheTypeId: STANDARD_CACHE_TYPE_ID,
      quantity: 40,
    });

    const batch = result.effects.find((effect) => effect.type === "SHOW_CACHE_RESULTS");
    const view =
      batch?.type === "SHOW_CACHE_RESULTS"
        ? selectCacheResultsView(result.state, batch.batch)
        : null;

    expect(view?.opened).toBe(40);
    expect(view?.rows.length).toBeLessThan(40);
    expect(view?.rows.reduce((total, row) => total + row.count, 0)).toBe(40);
    expect(view?.announcement).toContain("Opened 40");
  });
});
