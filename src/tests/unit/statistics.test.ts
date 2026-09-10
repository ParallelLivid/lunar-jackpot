/**
 * Coverage for lifetime statistics.
 *
 * A counter that quietly counts the wrong thing is worse than a missing one: it
 * is believed. So the load-bearing test here is not that each counter moves —
 * it is that **only** the counter named by an action moves, checked by diffing
 * the whole statistics record rather than by asserting field by field.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, TOTEM_IDS, TRINKET_IDS } from "../../content/catalog";
import { grantCollectible } from "../../domain/collections";
import { applyPrestige } from "../../domain/prestige";
import { reduce } from "../../domain/reducer";
import { selectStatsView } from "../../domain/selectors";
import {
  createFreshStatisticsState,
  createGameState,
  type GameState,
  type StatisticsState,
} from "../../domain/state";
import { applyTransaction } from "../../domain/transactions";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;

function fresh(seed = 5): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** Which statistics changed between two states, and by how much. */
function movement(before: GameState, after: GameState): Partial<StatisticsState> {
  const moved: Partial<StatisticsState> = {};

  for (const key of Object.keys(before.statistics) as Array<keyof StatisticsState>) {
    if (before.statistics[key] !== after.statistics[key]) {
      moved[key] = after.statistics[key] - before.statistics[key];
    }
  }

  return moved;
}

/**
 * Launches, walks to the first decision, and banks.
 *
 * Ticks in clamp-sized slices because a single oversized tick is capped, which
 * would silently make the run shorter than intended.
 */
function bankOneRun(state: GameState): GameState {
  let current = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

  for (let frame = 0; frame < 200; frame += 1) {
    if (current.expedition.status === "decision") {
      return reduce(current, { type: "RETURN_FROM_EXPEDITION" }).state;
    }

    current = reduce(current, {
      type: "TICK",
      casinoElapsedMs: 0,
      expeditionElapsedMs: 250,
      nowUnixMs: current.lastSettledAtUnixMs + 250,
    }).state;
  }

  throw new Error("the run never reached a decision");
}

describe("counting the right thing", () => {
  it("counts a launch, and nothing else", () => {
    const before = fresh();
    const after = reduce(before, { type: "LAUNCH_EXPEDITION" }).state;

    expect(movement(before, after)).toEqual({ runsLaunched: 1 });
  });

  it("counts a descent as one depth, not as a new deepest", () => {
    /*
     * The distinction chunk 5 depends on. A hundred runs to depth 10 and one run
     * to depth 100 leave the same `deepestDepth` and very different
     * `depthDescended`, which is why the cache gate uses the latter.
     */
    const launched = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;
    const deep: GameState = {
      ...launched,
      statistics: { ...launched.statistics, deepestDepth: 50, deepestDepthThisCycle: 50 },
      expedition: { ...launched.expedition, status: "decision", depth: 3 },
    };
    const after = reduce(deep, { type: "CONTINUE_EXPEDITION" }).state;

    // Depth 4 is well short of the deepest ever, so only the running total moves.
    expect(movement(deep, after)).toEqual({ depthDescended: 1 });
  });

  it("raises both deepest figures when the run goes past them", () => {
    const launched = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;
    const atEdge: GameState = {
      ...launched,
      expedition: { ...launched.expedition, status: "decision", depth: 0 },
    };
    const after = reduce(atEdge, { type: "CONTINUE_EXPEDITION" }).state;

    expect(after.statistics.deepestDepth).toBe(1);
    expect(after.statistics.deepestDepthThisCycle).toBe(1);
    expect(after.statistics.depthDescended).toBe(1);
  });

  it("counts spending at the transaction boundary, whatever the purchase was", () => {
    /*
     * Counted in `applyTransaction` rather than at each purchase site, so a new
     * kind of purchase cannot forget to report itself. This drives the boundary
     * directly with a plan no feature owns, which is the point: the counter
     * belongs to the boundary, not to any one caller.
     */
    const state: GameState = {
      ...fresh(),
      resources: { ...fresh().resources, cash: 1_000, chips: 500 },
    };
    const outcome = applyTransaction(state, {
      label: "test",
      costs: [
        { resource: "cash", amount: 250 },
        { resource: "chips", amount: 100 },
      ],
      grants: [],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? movement(state, outcome.state) : null).toEqual({
      cashSpent: 250,
      chipsSpent: 100,
    });
  });

  it("does not count a grant as spending", () => {
    const state = fresh();
    const outcome = applyTransaction(state, {
      label: "test",
      costs: [],
      grants: [{ resource: "cash", amount: 400 }],
    });

    expect(outcome.ok ? movement(state, outcome.state) : null).toEqual({});
  });

  it("does not add a statistic for something the collection already knows", () => {
    /*
     * Collectibles owned are read from the collection rather than counted as
     * they arrive. A running total would have started at zero on every save that
     * predates it — reporting "0 owned" to a player holding four — and since
     * nothing can ever be un-owned, the collection is both more accurate and
     * free of migration.
     */
    const first = grantCollectible(fresh(), { kind: "trinket", trinketId: "trinket.bladder" });

    expect(movement(fresh(), first)).toEqual({});

    const second = grantCollectible(first, { kind: "trinket", trinketId: "trinket.bladder" });

    expect(second.collection.trinkets["trinket.bladder"].fragments).toBe(
      ECONOMY.fragmentsPerDuplicate,
    );
  });

  it("counts a critical strike when one lands", () => {
    const launched = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;
    const striking: GameState = {
      ...launched,
      expedition: {
        ...launched.expedition,
        status: "resolving",
        oxygen: 100_000,
        maxOxygenSnapshot: 100_000,
        modifierSnapshot:
          launched.expedition.modifierSnapshot === null
            ? null
            : { ...launched.expedition.modifierSnapshot, pickaxeCritChance: 1 },
        currentEncounter: {
          encounterId: "encounter.ore.shelf.light",
          approachElapsedMs: 0,
          approachDurationMs: 0,
          resolveElapsedMs: 0,
          strikesTaken: 0,
          resolveDurationMs: null,
          durabilityRemaining: 1_000_000,
          oxygenDrainMultiplier: 1,
          chosenOptionId: null,
          committedReward: null,
        },
      },
    };

    /*
     * Two strike intervals, not three: `maxActiveTickMs` caps a single tick at
     * 1,000ms before any sub-stepping, so asking for 1,200ms in one frame would
     * be measuring the clamp rather than the counter.
     */
    const elapsedMs = ECONOMY.pickaxeStrikeIntervalMs * 2;

    expect(elapsedMs).toBeLessThanOrEqual(ECONOMY.maxActiveTickMs);

    const after = reduce(striking, {
      type: "TICK",
      casinoElapsedMs: 0,
      expeditionElapsedMs: elapsedMs,
      nowUnixMs: striking.lastSettledAtUnixMs + elapsedMs,
    }).state;

    expect(after.statistics.criticalStrikes).toBe(2);
  });

  it("records a best haul from a banked run, and keeps the larger of two", () => {
    // A haul lost to the tank running dry was never brought home, whatever it
    // was worth on the way down — so this only ever moves on a bank.
    const banked = bankOneRun(fresh(7));

    expect(banked.statistics.oreBanked).toBeGreaterThan(0);
    expect(banked.statistics.bestRunChips).toBe(banked.statistics.chipsEarned);

    // A smaller second haul must not overwrite the record.
    const pretendBigger: GameState = {
      ...banked,
      statistics: { ...banked.statistics, bestRunChips: 999_999 },
    };

    expect(bankOneRun(pretendBigger).statistics.bestRunChips).toBe(999_999);
  });
});

describe("what survives a prestige", () => {
  function earning(cash: number): GameState {
    const base = fresh();

    return {
      ...base,
      prestige: { ...base.prestige, cycleCashEarned: cash, lifetimeCashEarned: cash },
      statistics: {
        ...base.statistics,
        runsLaunched: 12,
        cashEarned: cash,
        depthDescended: 340,
        deepestDepth: 61,
        deepestDepthThisCycle: 61,
        catsFound: 2,
      },
    };
  }

  it("keeps every lifetime counter", () => {
    const outcome = applyPrestige(earning(5_000_000));

    expect(outcome.ok).toBe(true);

    const after = outcome.ok ? outcome.state.statistics : createFreshStatisticsState();

    expect(after.runsLaunched).toBe(12);
    expect(after.depthDescended).toBe(340);
    expect(after.deepestDepth).toBe(61);
    expect(after.catsFound).toBe(2);
  });

  it("resets the one figure that is about this cycle", () => {
    const outcome = applyPrestige(earning(5_000_000));

    expect(outcome.ok ? outcome.state.statistics.deepestDepthThisCycle : -1).toBe(0);
  });

  it("resets nothing else", () => {
    // The counterpart to the test above: exactly one field may differ.
    const before = earning(5_000_000);
    const outcome = applyPrestige(before);
    const moved = outcome.ok ? movement(before, outcome.state) : null;

    expect(Object.keys(moved ?? {})).toEqual(["deepestDepthThisCycle"]);
  });
});

describe("saving", () => {
  it("defaults every new counter for a save written before them", () => {
    /*
     * The normaliser walks the keys of a fresh statistics record, so a save that
     * predates these fields starts them at zero rather than needing a migration.
     * `depthDescended` in particular must not be guessed at from `deepestDepth`:
     * they measure different things.
     */
    const legacy = {
      resources: {},
      statistics: { runsLaunched: 9, deepestDepth: 44 },
    };
    const restored = normalizeGameState(legacy, NOW).state;

    expect(restored.statistics.runsLaunched).toBe(9);
    expect(restored.statistics.deepestDepth).toBe(44);
    expect(restored.statistics.depthDescended).toBe(0);
    expect(restored.statistics.criticalStrikes).toBe(0);
    expect(restored.statistics.bestRunChips).toBe(0);
  });

  it("round trips every counter unchanged", () => {
    const state: GameState = {
      ...fresh(),
      statistics: {
        ...fresh().statistics,
        depthDescended: 512,
        deepestDepthThisCycle: 30,
        cashSpent: 91_000,
        chipsSpent: 4_400,
        criticalStrikes: 210,
        bestRunChips: 8_800,
      },
    };
    const restored = normalizeGameState(createEnvelope(state, 1, NOW).game, NOW);

    expect(restored.report.repairs).toEqual([]);
    expect(restored.state.statistics).toEqual(state.statistics);
  });
});

describe("the window", () => {
  it("groups every counter under a heading", () => {
    const groups = selectStatsView(fresh());

    expect(groups.map((group) => group.title)).toEqual([
      "Expedition",
      "Casino",
      "Gambling",
      "Collection",
      "Lifetime",
    ]);

    for (const group of groups) {
      expect(group.entries.length, group.title).toBeGreaterThan(0);
    }
  });

  it("respects the number format setting", () => {
    /*
     * A stats window is exactly where somebody switches to exact mode, so a
     * hard-coded `formatCompact` would make the setting look broken in the one
     * place it matters most.
     */
    const rich: GameState = {
      ...fresh(),
      statistics: { ...fresh().statistics, cashEarned: 1_234_567 },
    };
    const cashIn = (state: GameState): string =>
      selectStatsView(state)
        .find((group) => group.title === "Casino")
        ?.entries.find((entry) => entry.label === "Cash earned")?.value ?? "";

    expect(cashIn(rich)).toBe("1.23M");
    expect(
      cashIn({ ...rich, settings: { ...rich.settings, numberFormat: "exact" } }),
    ).toBe("1,234,567");
  });

  it("reads collection progress from the collection itself", () => {
    // The reason this is derived: a save that predates the window still reports
    // what it actually owns, rather than zero.
    const owning = grantCollectible(
      grantCollectible(fresh(), { kind: "trinket", trinketId: "trinket.bladder" }),
      { kind: "totem", totemId: "totem.magpie" },
    );
    const collection = selectStatsView(owning).find((group) => group.title === "Collection");

    expect(collection?.entries.find((entry) => entry.label === "Trinkets owned")?.value).toBe(
      `1 / ${String(TRINKET_IDS.length)}`,
    );
    expect(collection?.entries.find((entry) => entry.label === "Totems owned")?.value).toBe(
      `1 / ${String(TOTEM_IDS.length)}`,
    );
  });

  it("says plainly that time played excludes offline", () => {
    // The label would otherwise be read as elapsed wall-clock time, which it is
    // not: production settles offline but this counter does not run.
    const lifetime = selectStatsView(fresh()).find((group) => group.title === "Lifetime");
    const played = lifetime?.entries.find((entry) => entry.label === "Time played");

    expect(played?.detail).toContain("Offline");
  });
});
