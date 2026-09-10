import { describe, expect, it } from "vitest";
import { ECONOMY, MACHINES, STARTER_MACHINE_ID } from "../../content/catalog";
import { advanceMachines, rescaleCycleProgress, selectCycleMs, selectCyclePayout } from "../../domain/casino";
import { collectActiveModifiers } from "../../domain/modifiers";
import { settleOfflineProduction } from "../../domain/offline";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";

function starterState(): GameState {
  return createGameState({ nowUnixMs: 0, seed: 3 });
}

const starter = MACHINES[STARTER_MACHINE_ID];

describe("casino production", () => {
  it("grants nothing before a cycle completes", () => {
    const state = starterState();
    const advance = advanceMachines(state, starter.baseCycleMs - 1, []);

    expect(advance.cashGranted).toBe(0);
    expect(advance.machines[STARTER_MACHINE_ID].cycleProgressMs).toBe(starter.baseCycleMs - 1);
  });

  it("grants exactly one cycle at the boundary", () => {
    const state = starterState();
    const advance = advanceMachines(state, starter.baseCycleMs, []);

    expect(advance.cashGranted).toBe(starter.basePayout);
    expect(advance.machines[STARTER_MACHINE_ID].cycleProgressMs).toBe(0);
  });

  it("catches up on multiple cycles and keeps the remainder", () => {
    const state = starterState();
    const elapsed = starter.baseCycleMs * 3 + 500;
    const advance = advanceMachines(state, elapsed, []);

    expect(advance.cashGranted).toBe(starter.basePayout * 3);
    expect(advance.machines[STARTER_MACHINE_ID].cycleProgressMs).toBe(500);
  });

  it("produces the same total regardless of tick size", () => {
    const totalMs = starter.baseCycleMs * 10;

    const oneStep = advanceMachines(starterState(), totalMs, []);

    let state = starterState();
    let granted = 0;

    for (let index = 0; index < 600; index += 1) {
      const step = advanceMachines(state, totalMs / 600, []);
      granted += step.cashGranted;
      state = { ...state, casino: { ...state.casino, machines: step.machines } };
    }

    expect(granted).toBe(oneStep.cashGranted);
  });

  it("leaves locked machines idle", () => {
    const state = starterState();
    const advance = advanceMachines(state, 60_000, []);

    expect(advance.machines["machine.beta"].cycleProgressMs).toBe(0);
  });
});

describe("spec switching", () => {
  it("keeps normalized progress across a duration change", () => {
    expect(rescaleCycleProgress(1_500, 3_000, 6_000)).toBe(3_000);
    expect(rescaleCycleProgress(1_500, 3_000, 1_800)).toBe(900);
    expect(rescaleCycleProgress(500, 0, 1_000)).toBe(0);
  });

  it("applies the spec tradeoff to payout and duration", () => {
    let state = starterState();
    state = {
      ...state,
      resources: { ...state.resources, chips: 10_000 },
    };

    state = reduce(state, { type: "RESEARCH_NODE", nodeId: "research.alpha.spec-endurance" }).state;
    state = reduce(state, {
      type: "SET_MACHINE_SPEC",
      machineId: STARTER_MACHINE_ID,
      specId: "spec.alpha.endurance",
    }).state;

    const modifiers = collectActiveModifiers(state);

    expect(selectCyclePayout(state, STARTER_MACHINE_ID, modifiers)).toBe(starter.basePayout * 3);
    expect(selectCycleMs(state, STARTER_MACHINE_ID, modifiers)).toBe(starter.baseCycleMs * 2);
  });

  it("refuses an unresearched spec", () => {
    const result = reduce(starterState(), {
      type: "SET_MACHINE_SPEC",
      machineId: STARTER_MACHINE_ID,
      specId: "spec.alpha.gambler",
    });

    expect(result.materialChange).toBe(false);
    expect(result.state.casino.machines[STARTER_MACHINE_ID].activeSpecId).toBeNull();
  });
});

describe("offline production", () => {
  it("grants nothing for zero elapsed time", () => {
    const settlement = settleOfflineProduction(starterState(), 0);

    expect(settlement.cashGranted).toBe(0);
  });

  it("grants nothing when the clock moves backward", () => {
    const state = { ...starterState(), lastSettledAtUnixMs: 10_000 };
    const settlement = settleOfflineProduction(state, 5_000);

    expect(settlement.creditedElapsedMs).toBe(0);
    expect(settlement.cashGranted).toBe(0);
    expect(settlement.state.lastSettledAtUnixMs).toBe(5_000);
  });

  it("clamps an extreme gap to the configured cap", () => {
    const settlement = settleOfflineProduction(starterState(), ECONOMY.offlineCapMs * 20);

    expect(settlement.capped).toBe(true);
    expect(settlement.creditedElapsedMs).toBe(ECONOMY.offlineCapMs);
    expect(settlement.cashGranted).toBe(
      Math.floor(ECONOMY.offlineCapMs / starter.baseCycleMs) * starter.basePayout,
    );
  });

  it("settles exactly once for the same window", () => {
    const first = settleOfflineProduction(starterState(), 60_000);
    const second = settleOfflineProduction(first.state, 60_000);

    expect(first.cashGranted).toBeGreaterThan(0);
    expect(second.cashGranted).toBe(0);
  });

  it("does not re-credit an active session as offline time", () => {
    // The defect this guards: nothing advanced the settlement stamp while the
    // game was running, so every reload paid for the whole previous session a
    // second time on top of what the ticks had already paid.
    const start = 1_700_000_000_000;
    let state: GameState = createGameState({ nowUnixMs: start, seed: 1 });

    const sessionMs = 10 * 60_000;
    const stepMs = 1_000;

    for (let elapsed = stepMs; elapsed <= sessionMs; elapsed += stepMs) {
      state = reduce(state, {
        type: "TICK",
        casinoElapsedMs: stepMs,
        expeditionElapsedMs: 0,
        nowUnixMs: start + elapsed,
      }).state;
    }

    const earnedWhilePlaying = state.resources.cash;

    expect(earnedWhilePlaying).toBe(
      Math.floor(sessionMs / starter.baseCycleMs) * starter.basePayout,
    );

    const settlement = settleOfflineProduction(state, start + sessionMs);

    expect(settlement.creditedElapsedMs).toBe(0);
    expect(settlement.cashGranted).toBe(0);
    expect(settlement.state.resources.cash).toBe(earnedWhilePlaying);
  });

  it("credits only the gap between the last tick and the next load", () => {
    const start = 1_700_000_000_000;
    let state: GameState = createGameState({ nowUnixMs: start, seed: 1 });

    state = reduce(state, {
      type: "TICK",
      casinoElapsedMs: 60_000,
      expeditionElapsedMs: 0,
      nowUnixMs: start + 60_000,
    }).state;

    const awayMs = 30 * 60_000;
    const settlement = settleOfflineProduction(state, start + 60_000 + awayMs);

    expect(settlement.creditedElapsedMs).toBe(awayMs);
  });

  it("never lets a backward system clock rewind the settlement stamp", () => {
    const start = 1_700_000_000_000;
    let state: GameState = createGameState({ nowUnixMs: start, seed: 1 });

    state = reduce(state, {
      type: "TICK",
      casinoElapsedMs: 1_000,
      expeditionElapsedMs: 0,
      nowUnixMs: start + 1_000,
    }).state;

    state = reduce(state, {
      type: "TICK",
      casinoElapsedMs: 1_000,
      expeditionElapsedMs: 0,
      nowUnixMs: start - 500_000,
    }).state;

    expect(state.lastSettledAtUnixMs).toBe(start + 1_000);
  });

  it("credits lifetime cash so prestige progress tracks production", () => {
    const settlement = settleOfflineProduction(starterState(), 60_000);

    expect(settlement.state.prestige.cycleCashEarned).toBe(settlement.cashGranted);
    expect(settlement.state.prestige.lifetimeCashEarned).toBe(settlement.cashGranted);
  });
});
