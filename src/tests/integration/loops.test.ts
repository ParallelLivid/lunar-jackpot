/**
 * Integration coverage for the cross-loop economy.
 *
 * Each test drives the real reducer end to end, so a break anywhere between
 * content, transactions, and state transitions shows up here.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, ENCOUNTERS, MACHINES, STARTER_MACHINE_ID } from "../../content/catalog";
import type { MachineId } from "../../content/catalog";
import { evaluateMachineLevel } from "../../content/machines";
import { selectCyclePayout } from "../../domain/casino";
import { reduce } from "../../domain/reducer";
import { settleOfflineProduction } from "../../domain/offline";
import { createGameState, type GameState } from "../../domain/state";
import { createMemorySaveStore, loadLatestSave } from "../../persistence/indexedDbSaveStore";
import { createEnvelope } from "../../persistence/saveSchema";

function fresh(seed = 21): GameState {
  return createGameState({ nowUnixMs: 0, seed });
}

function tick(state: GameState, casinoElapsedMs: number, expeditionElapsedMs = 0): GameState {
  // The wall clock advances with the simulated time, exactly as it would live.
  return reduce(state, {
    type: "TICK",
    casinoElapsedMs,
    expeditionElapsedMs,
    nowUnixMs: state.lastSettledAtUnixMs + Math.max(casinoElapsedMs, expeditionElapsedMs),
  }).state;
}

/** Runs the expedition greedily until it returns to the surface. */
function playRun(
  state: GameState,
  options: { returnAtOxygenRatio: number; maxSteps?: number },
): GameState {
  let current = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

  for (let index = 0; index < (options.maxSteps ?? 200_000); index += 1) {
    if (current.expedition.status === "surface") {
      return current;
    }

    const ratio =
      current.expedition.maxOxygenSnapshot > 0
        ? current.expedition.oxygen / current.expedition.maxOxygenSnapshot
        : 0;

    if (current.expedition.status === "decision") {
      current =
        ratio <= options.returnAtOxygenRatio
          ? reduce(current, { type: "RETURN_FROM_EXPEDITION" }).state
          : reduce(current, { type: "CONTINUE_EXPEDITION" }).state;
      continue;
    }

    if (current.expedition.status === "choice") {
      const encounterId = current.expedition.currentEncounter?.encounterId;
      const optionId =
        encounterId === undefined ? "" : (ENCOUNTERS[encounterId].choiceOptions?.[0]?.id ?? "");
      current = reduce(current, { type: "CHOOSE_ENCOUNTER_OPTION", optionId }).state;
      continue;
    }

    current = tick(current, 0, 100);
  }

  return current;
}

describe("casino to purchase", () => {
  it("turns machine payouts into a level purchase and a faster rate", () => {
    let state = fresh();
    const definition = MACHINES[STARTER_MACHINE_ID];

    state = tick(state, definition.baseCycleMs * 20);

    const secondLevel = evaluateMachineLevel(definition, 2)!;

    expect(state.resources.cash).toBeGreaterThanOrEqual(secondLevel.cashCost);

    const before = state.casino.machines[STARTER_MACHINE_ID].level;
    const result = reduce(state, { type: "BUY_MACHINE_LEVEL", machineId: STARTER_MACHINE_ID });

    expect(result.materialChange).toBe(true);
    expect(result.state.casino.machines[STARTER_MACHINE_ID].level).toBe(before + 1);
    expect(result.state.resources.cash).toBe(state.resources.cash - secondLevel.cashCost);
    expect(result.state.onboarding.hasPurchasedMachineLevel).toBe(true);
  });
});

describe("expedition to chips to research", () => {
  it("banks ore as chips and spends them on research", () => {
    let state = playRun(fresh(31), { returnAtOxygenRatio: 0.35 });

    expect(state.resources.chips).toBeGreaterThan(0);
    expect(state.statistics.runsReturned).toBe(1);

    // Grant enough chips to reach the first research rank deterministically.
    state = { ...state, resources: { ...state.resources, chips: 10_000 } };

    const before = selectCyclePayout(state, STARTER_MACHINE_ID, []);

    const researched = reduce(state, {
      type: "RESEARCH_NODE",
      nodeId: "research.alpha.overclock",
    });

    expect(researched.materialChange).toBe(true);
    expect(
      researched.state.casino.machines[STARTER_MACHINE_ID].researchRanks[
        "research.alpha.overclock"
      ],
    ).toBe(1);

    // Overclock is a flat doubling, not a gate on anything.
    expect(selectCyclePayout(researched.state, STARTER_MACHINE_ID, [])).toBe(before * 2);

    // It is repeatable, and the second rank costs more than the first.
    const firstCost = 10_000 - researched.state.resources.chips;
    const twice = reduce(
      { ...researched.state, resources: { ...researched.state.resources, chips: 10_000 } },
      { type: "RESEARCH_NODE", nodeId: "research.alpha.overclock" },
    );

    expect(
      twice.state.casino.machines[STARTER_MACHINE_ID].researchRanks["research.alpha.overclock"],
    ).toBe(2);
    expect(10_000 - twice.state.resources.chips).toBeGreaterThan(firstCost);
    expect(selectCyclePayout(twice.state, STARTER_MACHINE_ID, [])).toBe(before * 4);

    // Levels are no longer gated behind research, and no longer capped.
    let levelled: GameState = {
      ...researched.state,
      resources: {
        ...researched.state.resources,
        cash: Number.MAX_SAFE_INTEGER,
        components: 1_000_000,
      },
    };

    for (let level = 1; level < 20; level += 1) {
      levelled = reduce(levelled, {
        type: "BUY_MACHINE_LEVEL",
        machineId: STARTER_MACHINE_ID,
      }).state;
    }

    expect(levelled.casino.machines[STARTER_MACHINE_ID].level).toBe(20);
  });
});

describe("relics to gear to expedition", () => {
  it("makes a tank upgrade measurably lengthen the next run", () => {
    const base = fresh(41);
    const upgraded = reduce(
      { ...base, resources: { ...base.resources, relics: 50 } },
      { type: "BUY_GEAR_LEVEL", gearId: "tank" },
    ).state;

    const baseline = reduce(base, { type: "LAUNCH_EXPEDITION" }).state;
    const improved = reduce(upgraded, { type: "LAUNCH_EXPEDITION" }).state;

    expect(improved.expedition.maxOxygenSnapshot).toBeGreaterThan(
      baseline.expedition.maxOxygenSnapshot,
    );
  });

  it("unlocks the second trinket slot at the configured level", () => {
    let state: GameState = { ...fresh(42), resources: { ...fresh(42).resources, relics: 100 } };

    state = {
      ...state,
      collection: {
        ...state.collection,
        trinkets: {
          ...state.collection.trinkets,
          "trinket.tungsten-head": { owned: true, grade: "E" as const, fragments: 0 },
        },
      },
    };

    state = reduce(state, { type: "BUY_GEAR_LEVEL", gearId: "pickaxe" }).state;
    expect(
      reduce(state, {
        type: "EQUIP_TRINKET",
        gearId: "pickaxe",
        slot: 1,
        trinketId: "trinket.tungsten-head",
      }).materialChange,
    ).toBe(false);

    state = reduce(state, { type: "BUY_GEAR_LEVEL", gearId: "pickaxe" }).state;

    expect(
      reduce(state, {
        type: "EQUIP_TRINKET",
        gearId: "pickaxe",
        slot: 1,
        trinketId: "trinket.tungsten-head",
      }).materialChange,
    ).toBe(true);
  });
});

describe("cash to key to cache to collection", () => {
  it("consumes one key and one cache and produces exactly one item", () => {
    const base = fresh(51);
    let state: GameState = {
      ...base,
      resources: { ...base.resources, cash: ECONOMY.keyCashCost, caches: 1 },
    };

    state = reduce(state, { type: "BUY_KEY", quantity: 1 }).state;

    expect(state.resources.keys).toBe(1);
    expect(state.resources.cash).toBe(0);

    const opened = reduce(state, { type: "OPEN_CACHES", quantity: 1, cacheTypeId: "cache.standard" });

    expect(opened.materialChange).toBe(true);
    expect(opened.state.resources.keys).toBe(0);
    expect(opened.state.resources.caches).toBe(0);

    const trinkets = Object.values(opened.state.collection.trinkets).filter(
      (trinket) => trinket.owned,
    ).length;
    const totems = Object.values(opened.state.collection.totems).filter(
      (totem) => totem.owned,
    ).length;

    expect(trinkets + totems).toBe(1);

    // With no key left, a second attempt changes nothing.
    expect(reduce(opened.state, { type: "OPEN_CACHES", quantity: 1, cacheTypeId: "cache.standard" }).materialChange).toBe(false);
  });
});

describe("gambling settlement", () => {
  it("deducts the wager, commits the result, and pays exactly once", () => {
    const base = fresh(61);
    const state: GameState = { ...base, resources: { ...base.resources, chips: 1_000 } };

    const spun = reduce(state, { type: "START_SLOT_SPIN", wager: 10 });
    const committed = spun.state.gambling.committedSpin;

    expect(committed).not.toBeNull();
    expect(spun.state.resources.chips).toBe(990);

    // A second spin is refused while one is committed.
    expect(reduce(spun.state, { type: "START_SLOT_SPIN", wager: 10 }).materialChange).toBe(false);

    const settled = reduce(spun.state, {
      type: "COMPLETE_SLOT_SPIN",
      betId: committed?.betId ?? "",
    });

    expect(settled.state.gambling.committedSpin).toBeNull();
    expect(settled.state.resources.chips).toBe(990 + (committed?.payout ?? 0));

    // Settling again pays nothing.
    const again = reduce(settled.state, {
      type: "COMPLETE_SLOT_SPIN",
      betId: committed?.betId ?? "",
    });

    expect(again.state.resources.chips).toBe(settled.state.resources.chips);
  });

  it("leaves the settled reels somewhere the panel can still read them", () => {
    /*
     * Settling clears `committedSpin`, so a panel drawing only from that blanks
     * the reels the instant the animation finishes. The result is not lost — it
     * lands on `recentResults` — so this pins the two facts the panel relies on:
     * the summary keeps the symbols, and the multiplier that explains them.
     */
    const base = fresh(61);
    const state: GameState = { ...base, resources: { ...base.resources, chips: 1_000 } };
    const spun = reduce(state, { type: "START_SLOT_SPIN", wager: 10 });
    const committed = spun.state.gambling.committedSpin;
    const settled = reduce(spun.state, {
      type: "COMPLETE_SLOT_SPIN",
      betId: committed?.betId ?? "",
    });

    const latest = settled.state.gambling.recentResults[0];

    expect(settled.state.gambling.committedSpin).toBeNull();
    expect(latest.betId).toBe(committed?.betId);
    expect(latest.symbolIds).toEqual(committed?.symbolIds);
    expect(latest.multiplier).toBe(committed?.multiplier);
  });
});

describe("prestige acceleration", () => {
  it("resets the run, retains the collection, and speeds up the second cycle", () => {
    const base = fresh(71);
    const ready: GameState = {
      ...base,
      resources: { ...base.resources, cash: 500_000, chips: 900, relics: 12, components: 6 },
      prestige: { ...base.prestige, cycleCashEarned: 600_000, lifetimeCashEarned: 600_000 },
      collection: {
        ...base.collection,
        trinkets: {
          ...base.collection.trinkets,
          "trinket.bladder": { owned: true, grade: "D" as const, fragments: 4 },
          "trinket.regulator": { owned: true, grade: "E" as const, fragments: 0 },
        },
        totems: {
          ...base.collection.totems,
          "totem.prospector": { owned: true, grade: "D" as const, fragments: 1 },
        },
        activeTotemIds: ["totem.prospector", null, null],
      },
      gear: {
        ...base.gear,
        tankLevel: 3,
        tankTrinketSlots: ["trinket.bladder", "trinket.regulator", null],
      },
    };

    const prestiged = reduce(ready, { type: "PRESTIGE" });

    expect(prestiged.materialChange).toBe(true);

    const after = prestiged.state;

    // Reset.
    expect(after.resources.chips).toBe(0);
    expect(after.resources.relics).toBe(0);
    expect(after.resources.components).toBe(0);
    expect(after.gear.tankLevel).toBe(1);
    expect(after.prestige.cycleCashEarned).toBe(0);
    expect(after.prestige.count).toBe(1);

    // Retained.
    expect(after.resources.selenite).toBeGreaterThan(0);
    expect(after.collection.trinkets["trinket.bladder"]).toEqual({
      owned: true,
      grade: "D",
      fragments: 4,
    });
    expect(after.collection.trinkets["trinket.regulator"].owned).toBe(true);
    expect(after.collection.totems["totem.prospector"].grade).toBe("D");
    expect(after.collection.activeTotemIds[0]).toBe("totem.prospector");

    // Slot one keeps its trinket; the relocked slot returns its item safely.
    expect(after.gear.tankTrinketSlots[0]).toBe("trinket.bladder");
    expect(after.gear.tankTrinketSlots[1]).toBeNull();

    // A perk makes the next cycle measurably faster. The root is the only perk
    // available on a first prestige; everything else hangs off it.
    const withPerk = reduce(after, { type: "BUY_PRESTIGE_PERK", perkId: "perk.foothold" });

    expect(withPerk.materialChange).toBe(true);
    expect(withPerk.state.prestige.perkRanks["perk.foothold"]).toBe(1);

    const cycleMs = MACHINES[STARTER_MACHINE_ID].baseCycleMs;
    const withoutPerkCash = tick(after, cycleMs * 10).resources.cash;
    const withPerkCash = tick(withPerk.state, cycleMs * 10).resources.cash;

    expect(withPerkCash).toBeGreaterThan(withoutPerkCash);

    // Buying the root opens its branches, which were blocked a moment ago.
    expect(
      reduce(after, { type: "BUY_PRESTIGE_PERK", perkId: "perk.house.edge" }).materialChange,
    ).toBe(false);

    const funded: GameState = {
      ...withPerk.state,
      resources: { ...withPerk.state.resources, selenite: 500 },
    };

    expect(
      reduce(funded, { type: "BUY_PRESTIGE_PERK", perkId: "perk.house.edge" }).materialChange,
    ).toBe(true);
  });
});

describe("save and reload across committed transactions", () => {
  it("restores a mid-run expedition exactly where it left off", async () => {
    let state = reduce(fresh(81), { type: "LAUNCH_EXPEDITION" }).state;

    for (let index = 0; index < 40; index += 1) {
      state = tick(state, 0, 100);
    }

    expect(state.expedition.status).not.toBe("surface");

    const store = createMemorySaveStore();
    await store.write(createEnvelope(state, 1, 1_000));

    const loaded = await loadLatestSave(store, 1_000, () => fresh(0));

    expect(loaded.source).toBe("primary");
    expect(loaded.envelope.game.expedition.status).toBe(state.expedition.status);
    expect(loaded.envelope.game.expedition.runId).toBe(state.expedition.runId);
    expect(loaded.envelope.game.expedition.oxygen).toBeCloseTo(state.expedition.oxygen, 6);
    expect(loaded.envelope.game.expedition.currentEncounter?.encounterId).toBe(
      state.expedition.currentEncounter?.encounterId,
    );
  });

  it("keeps a committed spin so a reload settles it once instead of rerolling", async () => {
    const base = fresh(91);
    const state = reduce(
      { ...base, resources: { ...base.resources, chips: 500 } },
      { type: "START_SLOT_SPIN", wager: 50 },
    ).state;

    const store = createMemorySaveStore();
    await store.write(createEnvelope(state, 1, 2_000));

    const loaded = await loadLatestSave(store, 2_000, () => fresh(0));
    const restored = loaded.envelope.game;

    expect(restored.gambling.committedSpin?.betId).toBe(state.gambling.committedSpin?.betId);
    expect(restored.gambling.committedSpin?.symbolIds).toEqual(
      state.gambling.committedSpin?.symbolIds,
    );

    const settled = reduce(restored, {
      type: "COMPLETE_SLOT_SPIN",
      betId: restored.gambling.committedSpin?.betId ?? "",
    });

    expect(settled.state.resources.chips).toBe(
      restored.resources.chips + (restored.gambling.committedSpin?.payout ?? 0),
    );
  });

  it("credits offline cash once across a save and reload", async () => {
    const state = fresh(101);
    const store = createMemorySaveStore();
    await store.write(createEnvelope(state, 1, 0));

    const loaded = await loadLatestSave(store, 60_000, () => fresh(0));
    const first = settleOfflineProduction(loaded.envelope.game, 60_000);

    expect(first.cashGranted).toBeGreaterThan(0);

    await store.write(createEnvelope(first.state, 2, 60_000));

    const reloaded = await loadLatestSave(store, 60_000, () => fresh(0));
    const second = settleOfflineProduction(reloaded.envelope.game, 60_000);

    expect(second.cashGranted).toBe(0);
    expect(second.state.resources.cash).toBe(first.state.resources.cash);
  });
});

describe("recipe pieces to a new machine", () => {
  it("unlocks a locked machine once its recipe is complete", () => {
    const target: MachineId = "machine.beta";
    const base = fresh(111);
    const state: GameState = {
      ...base,
      casino: {
        ...base.casino,
        machines: {
          ...base.casino.machines,
          [target]: {
            ...base.casino.machines[target],
            recipePieces: MACHINES[target].recipePiecesRequired,
          },
        },
      },
    };

    const unlocked = reduce(state, { type: "UNLOCK_MACHINE", machineId: target });

    expect(unlocked.materialChange).toBe(true);
    expect(unlocked.state.casino.machines[target].unlocked).toBe(true);
    expect(unlocked.state.casino.machines[target].recipePieces).toBe(0);

    // It now contributes to production.
    const produced = tick(unlocked.state, MACHINES[target].baseCycleMs);

    expect(produced.resources.cash).toBeGreaterThan(0);
  });
});
