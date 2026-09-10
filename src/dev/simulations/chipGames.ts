/**
 * Balance simulations for roulette, blackjack and the depth wager. These run the
 * real content and the real domain code, so a tuning change is reflected without
 * touching the simulation. One question per game:
 *
 * - Roulette: does the analytic return match what the wheel actually pays, at
 *   every bet type and luck level?
 * - Blackjack: what does a leaning shoe return to a player who plays well? This
 *   is the number the cap is calibrated against, and the only one of the four
 *   that cannot be derived.
 * - Depth wager: does the priced curve stay inside the cap across every target a
 *   player can compose?
 */

import { ECONOMY, ROULETTE_BET_IDS } from "../../content/catalog";
import type { Modifier, RouletteBetId } from "../../content/catalog";
import {
  cappedBiasStrength,
  measureBlackjackReturn,
  selectBlackjackExpectedReturn,
} from "../../domain/blackjack";
import {
  maximumWagerTarget,
  minimumWagerTarget,
  offeredWagerMultiplier,
  wagerSuccessProbability,
} from "../../domain/depthWager";
import {
  roulettePayoutMultiplier,
  selectRouletteExpectedReturn,
  selectWheelWeights,
  spinWheel,
} from "../../domain/roulette";
import { createRngState } from "../../domain/rng";
import { maximumAttainableLuck } from "./gambling";

export interface ChipGameLuckLevel {
  label: string;
  luckPoints: number;
  modifiers: Modifier[];
}

/** The three luck levels every chip game is measured at. */
export function chipGameLuckLevels(): ChipGameLuckLevel[] {
  const best = maximumAttainableLuck();

  return [
    { label: "zero luck", luckPoints: 0, modifiers: [] },
    { label: "typical luck", luckPoints: 120, modifiers: [] },
    { label: "maximum attainable luck", luckPoints: best.luckPoints, modifiers: best.modifiers },
  ];
}

// ---------------------------------------------------------------------------
// Roulette
// ---------------------------------------------------------------------------

export interface RouletteSimulationResult {
  label: string;
  betTypeId: RouletteBetId;
  luckPoints: number;
  theoreticalReturn: number;
  simulatedReturn: number;
  spins: number;
}

export function simulateRouletteReturn(
  label: string,
  betTypeId: RouletteBetId,
  luckPoints: number,
  modifiers: readonly Modifier[],
  spins: number,
  seed: number,
): RouletteSimulationResult {
  const straightNumber = 17;
  const weights = selectWheelWeights(modifiers, luckPoints, betTypeId, straightNumber);
  let rngState = createRngState(seed, "gambling");
  let returned = 0;

  for (let spin = 0; spin < spins; spin += 1) {
    const draw = spinWheel(rngState, weights);

    rngState = draw.rngState;
    returned += roulettePayoutMultiplier(betTypeId, straightNumber, draw.pocket);
  }

  return {
    label,
    betTypeId,
    luckPoints,
    theoreticalReturn: selectRouletteExpectedReturn(
      modifiers,
      luckPoints,
      betTypeId,
      straightNumber,
    ),
    simulatedReturn: spins === 0 ? 0 : returned / spins,
    spins,
  };
}

export function runRouletteSimulations(spins = 100_000): RouletteSimulationResult[] {
  const results: RouletteSimulationResult[] = [];
  let seed = 401;

  for (const level of chipGameLuckLevels()) {
    // Two bets at opposite ends of how cheap they are to bias: an even-money
    // outside bet and a single pocket. If the cap is wrong for one bet and right
    // for another, these two will show it.
    for (const betTypeId of ["bet.red", "bet.straight"] as RouletteBetId[]) {
      results.push(
        simulateRouletteReturn(
          `${level.label} — ${betTypeId}`,
          betTypeId,
          level.luckPoints,
          level.modifiers,
          spins,
          seed,
        ),
      );
      seed += 1;
    }
  }

  return results;
}

/** Every bet's analytic return, for the balance report. */
export function rouletteReturnByBet(
  luckPoints = 0,
  modifiers: readonly Modifier[] = [],
): Array<{ betTypeId: RouletteBetId; expectedReturn: number }> {
  return ROULETTE_BET_IDS.map((betTypeId) => ({
    betTypeId,
    expectedReturn: selectRouletteExpectedReturn(modifiers, luckPoints, betTypeId, 17),
  }));
}

// ---------------------------------------------------------------------------
// Blackjack
// ---------------------------------------------------------------------------

export interface BlackjackSimulationResult {
  label: string;
  luckPoints: number;
  /** What the cap believes, from the interpolated measurement table. */
  cappedReturn: number;
  /** What a basic-strategy bot actually took away, at that capped lean. */
  realisedReturn: number;
  hands: number;
}

/**
 * Plays the bot at each luck level, at the lean the cap actually allows. The cap
 * must be measured against realised play rather than a closed-form edge on the
 * opening deal; where the two disagree, the simulated figure is the real one.
 */
export function runBlackjackSimulations(hands = 200_000): BlackjackSimulationResult[] {
  let seed = 501;

  return chipGameLuckLevels().map((level) => {
    const cappedReturn = selectBlackjackExpectedReturn(level.modifiers, level.luckPoints);
    // The lean the cap allows, not the one luck asked for: the latter would
    // report a return the game never deals.
    const strength = cappedBiasStrength(level.modifiers, level.luckPoints);
    const measured = measureBlackjackReturn(strength, hands, seed);

    seed += 1;

    return {
      label: level.label,
      luckPoints: level.luckPoints,
      cappedReturn,
      realisedReturn: measured.realisedReturn,
      hands,
    };
  });
}

// ---------------------------------------------------------------------------
// The depth wager
// ---------------------------------------------------------------------------

export interface DepthWagerCurvePoint {
  targetDepth: number;
  successChance: number;
  offeredMultiplier: number;
  expectedReturn: number;
}

/**
 * The whole offered board at one record depth and one luck level. Every point is
 * a bet a player can compose, so every point has to sit inside the cap: an
 * unpriced corner of this range is a chip printer waiting to be found.
 */
export function depthWagerCurve(
  referenceDepth: number,
  luckPoints = 0,
  modifiers: readonly Modifier[] = [],
): DepthWagerCurvePoint[] {
  const points: DepthWagerCurvePoint[] = [];

  for (
    let targetDepth = minimumWagerTarget(referenceDepth);
    targetDepth <= maximumWagerTarget(referenceDepth);
    targetDepth += 1
  ) {
    const successChance = wagerSuccessProbability(targetDepth, referenceDepth);
    const offeredMultiplier = offeredWagerMultiplier(
      targetDepth,
      referenceDepth,
      modifiers,
      luckPoints,
    );

    points.push({
      targetDepth,
      successChance,
      offeredMultiplier,
      expectedReturn: offeredMultiplier * successChance,
    });
  }

  return points;
}

export interface DepthWagerReport {
  label: string;
  referenceDepth: number;
  luckPoints: number;
  /** The worst point on the board, which is the only one the cap can fail at. */
  highestExpectedReturn: number;
  cap: number;
  points: number;
}

export function runDepthWagerSimulations(
  referenceDepths: readonly number[] = [10, 25, 60, 150],
): DepthWagerReport[] {
  const reports: DepthWagerReport[] = [];

  for (const level of chipGameLuckLevels()) {
    for (const referenceDepth of referenceDepths) {
      const curve = depthWagerCurve(referenceDepth, level.luckPoints, level.modifiers);

      reports.push({
        label: `${level.label} — best ${String(referenceDepth)}`,
        referenceDepth,
        luckPoints: level.luckPoints,
        highestExpectedReturn: curve.reduce(
          (highest, point) => Math.max(highest, point.expectedReturn),
          0,
        ),
        cap: ECONOMY.gamblingMaxExpectedReturn,
        points: curve.length,
      });
    }
  }

  return reports;
}
