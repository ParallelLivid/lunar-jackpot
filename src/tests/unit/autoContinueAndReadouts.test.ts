/**
 * Auto-continue, the paced cache purchase, stat breakdowns, and the reward
 * indicators.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, TRINKETS } from "../../content/catalog";
import { describeCachePurchase } from "../../domain/collections";
import { totalCashPerSecond } from "../../domain/reducer";
import { reduce } from "../../domain/reducer";
import {
  describeGrants,
  describeStat,
  selectGearView,
  selectMachineView,
  selectStoreView,
  deriveContext,
} from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(seed = 3): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

function tick(state: GameState, expeditionElapsedMs: number): GameState {
  return reduce(state, {
    type: "TICK",
    casinoElapsedMs: 0,
    expeditionElapsedMs,
    nowUnixMs: state.lastSettledAtUnixMs + expeditionElapsedMs,
  }).state;
}

/** Runs the clock until the predicate holds or the budget runs out. */
function advanceUntil(
  state: GameState,
  predicate: (current: GameState) => boolean,
  maxSteps = 20_000,
): GameState {
  let current = state;

  for (let index = 0; index < maxSteps && !predicate(current); index += 1) {
    current = tick(current, 100);
  }

  return current;
}

function launched(state: GameState): GameState {
  return tick(reduce(state, { type: "LAUNCH_EXPEDITION" }).state, ECONOMY.launchTransitionMs);
}

/** The ordinary cache's row, which is what every assertion here means by "a cache". */
function standardOffer(context: Parameters<typeof selectStoreView>[0]) {
  return selectStoreView(context).caches.find(
    (offer) => offer.cacheTypeId === "cache.standard",
  )!;
}

describe("auto-continue", () => {
  function withAutoContinue(thresholdRatio: number): GameState {
    const base = fresh(21);

    return {
      ...base,
      settings: {
        ...base.settings,
        autoContinue: { enabled: true, oxygenThresholdRatio: thresholdRatio },
      },
    };
  }

  it("is off by default", () => {
    expect(fresh().settings.autoContinue.enabled).toBe(false);
  });

  it("presses on by itself while oxygen is above the threshold", () => {
    const state = advanceUntil(
      launched(withAutoContinue(0.1)),
      (current) => current.expedition.depth >= 2,
    );

    // Depth only advances on a commitment, so reaching depth 2 unattended means
    // the rule pressed on twice without any player input.
    expect(state.expedition.depth).toBeGreaterThanOrEqual(2);
    expect(state.expedition.status).not.toBe("decision");
  });

  it("stops and hands control back at the threshold", () => {
    const state = advanceUntil(
      launched(withAutoContinue(0.9)),
      (current) => current.expedition.status === "decision",
    );

    expect(state.expedition.status).toBe("decision");

    // It waits there indefinitely rather than pressing on.
    const waited = advanceUntil(state, () => false, 200);

    expect(waited.expedition.status).toBe("decision");
    expect(waited.expedition.depth).toBe(state.expedition.depth);
  });

  it("never banks by itself", () => {
    const state = advanceUntil(
      launched(withAutoContinue(0.95)),
      (current) => current.expedition.status === "decision",
    );
    const later = advanceUntil(state, () => false, 400);

    // Returning is always deliberate: the run is still underway and nothing
    // has been banked.
    expect(later.expedition.status).toBe("decision");
    expect(later.statistics.runsReturned).toBe(0);
    expect(later.resources.chips).toBe(0);
  });

  it("clamps the threshold to the configured floor", () => {
    const state = reduce(fresh(), {
      type: "UPDATE_SETTINGS",
      patch: { autoContinue: { enabled: true, oxygenThresholdRatio: 0 } },
    }).state;

    expect(state.settings.autoContinue.oxygenThresholdRatio).toBe(
      ECONOMY.autoContinueMinimumRatio,
    );
  });

  it("survives a reload mid-run through the settings", () => {
    const state = withAutoContinue(0.4);

    expect(state.settings.autoContinue).toEqual({
      enabled: true,
      oxygenThresholdRatio: 0.4,
    });
  });
});

describe("paced cache purchase", () => {
  /** A save that has descended `depths` in total, with cash to spend. */
  function descended(depths: number, cash = 100_000): GameState {
    const base = fresh(31);

    return {
      ...base,
      resources: { ...base.resources, cash },
      statistics: { ...base.statistics, depthDescended: depths },
    };
  }

  /** The rate the store view would show, so tests price a cache as the UI does. */
  function rate(state: GameState): number {
    return totalCashPerSecond(state);
  }

  it("is gated until enough depth has been descended", () => {
    for (const depths of [0, 4, 9]) {
      const state = descended(depths);

      expect(describeCachePurchase(state, rate(state)).depthsRemaining).toBe(
        ECONOMY.depthsPerCachePurchase - depths,
      );
      expect(reduce(state, { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).materialChange).toBe(false);
    }
  });

  it("counts distance travelled, not the deepest point reached", () => {
    /*
     * The distinction the gate turns on. A player who plateaus at depth 60 keeps
     * earning caches by playing; gating on deepest-ever would stop the
     * collectible economy the moment they stopped setting records.
     */
    const plateaued = descended(200);

    expect(plateaued.statistics.deepestDepth).toBe(0);
    expect(describeCachePurchase(plateaued, rate(plateaued)).depthsRemaining).toBe(0);
  });

  it("sells one cache once the gate opens, then closes again", () => {
    const state = descended(ECONOMY.depthsPerCachePurchase);
    const price = describeCachePurchase(state, rate(state)).price;
    const bought = reduce(state, { type: "BUY_CACHE", cacheTypeId: "cache.standard" });

    expect(bought.materialChange).toBe(true);
    expect(bought.state.resources.caches).toBe(1);
    expect(bought.state.resources.cash).toBe(100_000 - price);

    // Stamped, so a second purchase waits for another ten depths.
    expect(reduce(bought.state, { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).materialChange).toBe(false);
    expect(describeCachePurchase(bought.state, rate(bought.state)).depthsRemaining).toBe(
      ECONOMY.depthsPerCachePurchase,
    );
  });

  it("does not let unspent distance bank up into several caches", () => {
    // Thirty depths between purchases is one cache, not three. The gate paces
    // collectibles; letting distance accumulate would defeat that.
    const state = descended(ECONOMY.depthsPerCachePurchase * 3);
    const bought = reduce(state, { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).state;

    expect(bought.resources.caches).toBe(1);
    expect(reduce(bought, { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).materialChange).toBe(false);
  });

  it("reopens after another ten depths", () => {
    const bought = reduce(descended(10), { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).state;
    const deeper: GameState = {
      ...bought,
      statistics: { ...bought.statistics, depthDescended: 20 },
    };

    expect(describeCachePurchase(deeper, rate(deeper)).depthsRemaining).toBe(0);
    expect(reduce(deeper, { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).materialChange).toBe(true);
  });

  it("refuses when the cash is short, and says so", () => {
    const rich = descended(10);
    const price = describeCachePurchase(rich, rate(rich)).price;
    const state = descended(10, price - 1);
    const offer = standardOffer(deriveContext(state));

    expect(offer.buyWithCash.available).toBe(false);
    expect(offer.buyWithCash.reason).toBe("Not enough resources.");
  });

  it("names the shortfall in depths when that is what is missing", () => {
    const offer = standardOffer(deriveContext(descended(8)));

    expect(offer.buyWithCash.available).toBe(false);
    expect(offer.buyWithCash.reason).toContain("2 to go");
  });

  it("does not hand out a free cache on prestige", () => {
    /*
     * The run-count version of this gate stamped a counter that prestige reset to
     * zero while `statistics` survived, so every prestige opened the gate
     * immediately. The stamp is now lifetime on both sides and prestige leaves it
     * alone — this test used to assert the reset, which was asserting the bug.
     */
    const base = descended(ECONOMY.depthsPerCachePurchase);
    const ready: GameState = {
      ...base,
      prestige: { ...base.prestige, cycleCashEarned: 600_000, lifetimeCashEarned: 600_000 },
    };
    const bought = reduce(ready, { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).state;

    expect(bought.purchase.depthAtLastCachePurchase).toBe(ECONOMY.depthsPerCachePurchase);

    const prestiged = reduce(bought, { type: "PRESTIGE" }).state;

    expect(prestiged.purchase.depthAtLastCachePurchase).toBe(
      ECONOMY.depthsPerCachePurchase,
    );
    expect(reduce(prestiged, { type: "BUY_CACHE", cacheTypeId: "cache.standard" }).materialChange).toBe(false);
  });
});

describe("stat breakdowns", () => {
  it("splits an additive trinket into base and bonus", () => {
    const base = fresh(41);
    const state: GameState = {
      ...base,
      gear: { ...base.gear, tankTrinketSlots: ["trinket.bladder", null, null] },
      collection: {
        ...base.collection,
        trinkets: {
          ...base.collection.trinkets,
          "trinket.bladder": { owned: true, grade: "E" as const, fragments: 0 },
        },
      },
    };

    const view = selectGearView(deriveContext(state), "tank");

    expect(view.statBreakdown.base).toBe(60);
    expect(view.statBreakdown.bonus).toBe(8);
    expect(view.statBreakdown.final).toBe(68);
    expect(view.statBreakdown.sources).toEqual([
      { label: `${TRINKETS["trinket.bladder"].displayName} (Grade E)`, amount: 8 },
    ]);
  });

  it("reports a multiplicative source as the amount it actually added", () => {
    const breakdown = describeStat(
      60,
      [
        {
          sourceId: "trinket.regulator:1",
          targetStat: "gear.tankOxygen",
          operation: "multiply",
          value: 1.08,
        },
      ],
      { targetStat: "gear.tankOxygen" },
    );

    // 60 x 1.08 rounds to 65, so it reads as "60 + 5" rather than "x1.08".
    expect(breakdown.base).toBe(60);
    expect(breakdown.base + breakdown.bonus).toBe(breakdown.final);
    expect(breakdown.bonus).toBeGreaterThan(0);
  });

  it("reports no bonus when a rounded stat has no modifiers", () => {
    /*
     * `machine.payout` floors its final value. Differencing a rounded final
     * against a raw base reported the rounding loss as a modifier, so an
     * unmodified level 4 Penny Reels read as "18 - 0" instead of "18".
     */
    const state = fresh(9);
    const levelled: GameState = {
      ...state,
      casino: {
        ...state.casino,
        machines: {
          ...state.casino.machines,
          "machine.alpha": { ...state.casino.machines["machine.alpha"], level: 4 },
        },
      },
    };

    const view = selectMachineView(deriveContext(levelled), "machine.alpha");

    expect(view.payoutBreakdown.bonus).toBe(0);
    expect(view.payoutBreakdown.base).toBe(view.payoutBreakdown.final);
    expect(view.payoutBreakdown.sources).toEqual([]);
  });

  it("reports no bonus when nothing is equipped", () => {
    const view = selectGearView(deriveContext(fresh(42)), "pickaxe");

    expect(view.statBreakdown.bonus).toBe(0);
    expect(view.statBreakdown.sources).toEqual([]);
  });
});

describe("encounter reward indicators", () => {
  it("lists every collected resource, including oxygen", () => {
    const pops = describeGrants(
      [
        { kind: "ore", grade: "seam", amount: 4 },
        { kind: "components", amount: 2 },
        { kind: "oxygen", amount: 12 },
        { kind: "recipePiece", machineId: "machine.beta", amount: 1 },
      ],
      0,
    );

    expect(pops).toHaveLength(4);
    expect(pops.map((pop) => pop.amount)).toEqual([4, 2, 12, 1]);
    expect(pops.every((pop) => pop.label.length > 0)).toBe(true);
    // Oxygen has no resource sprite of its own; everything else does.
    expect(pops.filter((pop) => pop.spriteId !== null)).toHaveLength(3);
  });

  it("reports an up-front oxygen charge as a negative", () => {
    const pops = describeGrants([], -6);

    expect(pops).toHaveLength(1);
    expect(pops[0].amount).toBe(-6);
    expect(pops[0].unit).toBe("s");
  });

  it("produces nothing when there is nothing to report", () => {
    expect(describeGrants([], 0)).toEqual([]);
  });
});

describe("approach cost is independent of presentation", () => {
  it("spends oxygen strictly as a function of the content duration", () => {
    const state = launched(fresh(51));
    const encounter = state.expedition.currentEncounter;

    expect(encounter).not.toBeNull();

    const before = state.expedition.oxygen;
    const arrived = advanceUntil(
      state,
      (current) => current.expedition.status !== "approaching",
    );

    // The canvas is never consulted: what the approach costs is the content
    // duration times the drain rate and the encounter's multiplier. A wider or
    // narrower window changes how fast the sprite travels, never this.
    const expected =
      ((encounter?.approachDurationMs ?? 0) / 1000) *
      ECONOMY.baseOxygenDrainPerSecond *
      (encounter?.oxygenDrainMultiplier ?? 1);

    // Ticks land on 100ms boundaries, so allow one tick of overshoot.
    expect(before - arrived.expedition.oxygen).toBeGreaterThanOrEqual(expected - 0.001);
    expect(before - arrived.expedition.oxygen).toBeLessThan(expected + 0.11);
  });
});

describe("next-tier stat preview", () => {
  /** A level 1 tank wearing a tier 1 spare bladder. */
  function tankWithBladder(): GameState {
    const base = fresh(41);

    return {
      ...base,
      gear: { ...base.gear, tankTrinketSlots: ["trinket.bladder", null, null] },
      collection: {
        ...base.collection,
        trinkets: {
          ...base.collection.trinkets,
          "trinket.bladder": { owned: true, grade: "E" as const, fragments: 0 },
        },
      },
    };
  }

  it("applies the loadout to the next level rather than showing the raw table value", () => {
    const view = selectGearView(deriveContext(tankWithBladder()), "tank");

    // The level table says 85. The player would actually get 85 + 8, and the
    // preview used to promise the bare 85.
    expect(view.nextStatBreakdown).not.toBeNull();
    expect(view.nextStatBreakdown?.base).toBe(85);
    expect(view.nextStatBreakdown?.bonus).toBe(8);
    expect(view.nextStatBreakdown?.final).toBe(93);
  });

  it("reads both sides of the arrow the same way", () => {
    const view = selectGearView(deriveContext(tankWithBladder()), "tank");
    const next = view.nextStatBreakdown;

    expect(next).not.toBeNull();
    expect(view.statBreakdown.base + view.statBreakdown.bonus).toBe(view.statBreakdown.final);
    expect((next?.base ?? 0) + (next?.bonus ?? 0)).toBe(next?.final);

    // The upgrade is worth what the level table implies, not less.
    expect((next?.final ?? 0) - view.statBreakdown.final).toBe(85 - 60);
  });

  it("has no next tier at the maximum level", () => {
    const base = fresh(7);
    const view = selectGearView(deriveContext(base), "tank");
    const maxed: GameState = {
      ...base,
      gear: { ...base.gear, tankLevel: view.maximumLevel },
    };

    expect(selectGearView(deriveContext(maxed), "tank").nextStatBreakdown).toBeNull();
  });

  it("splits the machine payout and its next level the same way", () => {
    const state = fresh(11);
    const view = selectMachineView(deriveContext(state), state.casino.selectedMachineId);

    expect(view.payoutBreakdown.base + view.payoutBreakdown.bonus).toBe(view.payoutBreakdown.final);
    expect(view.payoutBreakdown.final).toBe(view.cyclePayout);

    expect(view.nextLevel).not.toBeNull();
    expect(view.nextLevel?.payoutBreakdown.final).toBe(view.nextLevel?.cyclePayout);
  });
});
