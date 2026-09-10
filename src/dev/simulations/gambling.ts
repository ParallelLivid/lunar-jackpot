/**
 * Slot-game balance simulations.
 *
 * These run the real content and the real domain code, so a tuning change is
 * reflected here without touching the simulation.
 */

import { ECONOMY, HIGHEST_GRADE, TOTEMS, scaleModifiers } from "../../content/catalog";
import type { Modifier } from "../../content/catalog";
import {
  cappedSlotWeights,
  drawSpin,
  expectedReturn,
  payoutMultiplier,
  selectExpectedReturn,
} from "../../domain/gambling";
import { createRngState } from "../../domain/rng";

export interface SlotSimulationResult {
  label: string;
  luckPoints: number;
  theoreticalReturn: number;
  simulatedReturn: number;
  spins: number;
  largestMultiplier: number;
}

/**
 * Plays `spins` wagers at a fixed luck level and reports the measured return
 * against the analytic one.
 */
export function simulateSlotReturn(
  label: string,
  luckPoints: number,
  modifiers: readonly Modifier[],
  spins: number,
  seed: number,
): SlotSimulationResult {
  const weights = cappedSlotWeights(modifiers, luckPoints);
  let rngState = createRngState(seed, "gambling");
  let wagered = 0;
  let won = 0;
  let largestMultiplier = 0;

  for (let index = 0; index < spins; index += 1) {
    const draw = drawSpin(rngState, weights);
    rngState = draw.rngState;

    const multiplier = payoutMultiplier(draw.symbolIds);
    wagered += 1;
    won += multiplier;
    largestMultiplier = Math.max(largestMultiplier, multiplier);
  }

  return {
    label,
    luckPoints,
    theoreticalReturn: expectedReturn(weights),
    simulatedReturn: wagered === 0 ? 0 : won / wagered,
    spins,
    largestMultiplier,
  };
}

/** The highest luck a player can actually reach with three unique totems. */
export function maximumAttainableLuck(): { luckPoints: number; modifiers: Modifier[] } {
  const luckSources = Object.values(TOTEMS)
    .map((totem) => {
      // Every totem is measured at the top of the ladder, which is where the
      // expected-return cap is most likely to be tested.
      const scaled = scaleModifiers(totem.baseModifiers, HIGHEST_GRADE);
      const luck = scaled
        .filter((modifier) => modifier.targetStat === "luck")
        .reduce((total, modifier) => total + modifier.value, 0);

      return { totem, scaled, luck };
    })
    .sort((left, right) => right.luck - left.luck)
    .slice(0, ECONOMY.activeTotemSlots);

  const modifiers = luckSources.flatMap((entry) => entry.scaled);

  return {
    luckPoints: luckSources.reduce((total, entry) => total + entry.luck, 0),
    modifiers,
  };
}

export function runSlotSimulations(spins = 200_000): SlotSimulationResult[] {
  const best = maximumAttainableLuck();

  return [
    simulateSlotReturn("zero luck", 0, [], spins, 101),
    simulateSlotReturn("typical luck", 20, [], spins, 202),
    simulateSlotReturn(
      "maximum attainable luck",
      best.luckPoints,
      best.modifiers,
      spins,
      303,
    ),
  ];
}

/** The published return curve, for the balance report and the payout panel. */
export function slotReturnCurve(step = 5): Array<{ luckPoints: number; expectedReturn: number }> {
  const points: Array<{ luckPoints: number; expectedReturn: number }> = [];

  for (let luck = 0; luck <= ECONOMY.luckPointCap; luck += step) {
    points.push({ luckPoints: luck, expectedReturn: selectExpectedReturn([], luck) });
  }

  return points;
}
