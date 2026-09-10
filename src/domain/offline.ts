/**
 * Capped offline casino production.
 *
 * Settlement runs once during bootstrap, after load and migration and before
 * the player can issue any command. Expeditions never advance offline.
 */

import { ECONOMY } from "../content/catalog";
import { advanceMachines, planCashProduction } from "./casino";
import { collectActiveModifiers } from "./modifiers";
import { clamp } from "./numbers";
import type { GameState } from "./state";
import { applyTransaction } from "./transactions";

export interface OfflineSettlement {
  state: GameState;
  rawElapsedMs: number;
  creditedElapsedMs: number;
  cashGranted: number;
  /** True when the elapsed time exceeded the configured cap. */
  capped: boolean;
}

export function creditedOfflineMs(rawElapsedMs: number): number {
  // Negative clock movement grants nothing.
  return clamp(rawElapsedMs, 0, ECONOMY.offlineCapMs);
}

export function settleOfflineProduction(
  state: GameState,
  nowUnixMs: number,
): OfflineSettlement {
  const rawElapsedMs = nowUnixMs - state.lastSettledAtUnixMs;
  const creditedElapsedMs = creditedOfflineMs(rawElapsedMs);
  const modifiers = collectActiveModifiers(state);
  const advance = advanceMachines(state, creditedElapsedMs, modifiers);

  const outcome = applyTransaction(
    state,
    planCashProduction(advance.cashGranted, advance.machines, advance.payoutRng),
  );

  const settled: GameState = outcome.ok ? outcome.state : state;

  return {
    state: { ...settled, lastSettledAtUnixMs: nowUnixMs },
    rawElapsedMs,
    creditedElapsedMs,
    cashGranted: outcome.ok ? advance.cashGranted : 0,
    capped: rawElapsedMs > ECONOMY.offlineCapMs,
  };
}
