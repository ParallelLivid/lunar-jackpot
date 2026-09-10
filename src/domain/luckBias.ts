/**
 * The single luck-and-cap pathway every chip game routes through, so the
 * expected-return cap has one implementation rather than one per game.
 *
 * - `luckBiasedWeights` applies the luck curve and any tagged
 *   `gambling.outcomeWeight` modifier to a weighted outcome set.
 * - `blendToCap` walks the biased configuration back toward the base one until
 *   the expected return sits at the cap.
 *
 * `blendToCap` is generic over what is blended rather than over a weight map:
 * three games bias a set of weights, while the depth wager biases a single
 * payout multiplier and must be capped by the same search.
 */

import { evaluateStat, luckFactor, type Modifier } from "./modifiers";

/**
 * One outcome in a set luck is allowed to reweight. `luckWeightBias` is signed —
 * negative shrinks an outcome's share as luck rises, positive grows it — and is
 * applied as `baseWeight * (1 + luckWeightBias * luckFactor)`.
 */
export interface BiasableOutcome<Id extends string> {
  id: Id;
  baseWeight: number;
  luckWeightBias: number;
  /** Tags matched by `gambling.outcomeWeight` modifiers. */
  tags?: readonly string[];
}

export type WeightMap<Id extends string> = Record<Id, number>;

/** Expected return per chip staked, for one configuration of a game. */
export type ExpectedReturnOf<T> = (configuration: T) => number;

export function baseWeightsOf<Id extends string>(
  outcomes: ReadonlyArray<BiasableOutcome<Id>>,
): WeightMap<Id> {
  return outcomes.reduce((weights, outcome) => {
    weights[outcome.id] = Math.max(0, outcome.baseWeight);

    return weights;
  }, {} as WeightMap<Id>);
}

/** Weights after the luck curve and any tagged outcome-weight modifiers. */
export function luckBiasedWeights<Id extends string>(
  outcomes: ReadonlyArray<BiasableOutcome<Id>>,
  modifiers: readonly Modifier[],
  luckPoints: number,
): WeightMap<Id> {
  const factor = luckFactor(luckPoints);

  return outcomes.reduce((weights, outcome) => {
    const biased = outcome.baseWeight * (1 + outcome.luckWeightBias * factor);

    weights[outcome.id] = Math.max(
      0,
      evaluateStat(biased, modifiers, {
        targetStat: "gambling.outcomeWeight",
        tags: outcome.tags,
      }),
    );

    return weights;
  }, {} as WeightMap<Id>);
}

export function blendWeightMaps<Id extends string>(
  base: WeightMap<Id>,
  target: WeightMap<Id>,
  t: number,
): WeightMap<Id> {
  return (Object.keys(base) as Id[]).reduce((weights, id) => {
    weights[id] = base[id] * (1 - t) + target[id] * t;

    return weights;
  }, {} as WeightMap<Id>);
}

export function weightProbabilities<Id extends string>(
  weights: WeightMap<Id>,
): Record<Id, number> {
  const ids = Object.keys(weights) as Id[];
  const total = ids.reduce((sum, id) => sum + Math.max(0, weights[id]), 0);

  return ids.reduce(
    (probabilities, id) => {
      probabilities[id] = total > 0 ? Math.max(0, weights[id]) / total : 0;

      return probabilities;
    },
    {} as Record<Id, number>,
  );
}

/**
 * Applies the expected-return cap by blending the luck-adjusted configuration
 * back toward the base one. Blending rather than clipping keeps the published
 * multipliers untouched and moves only how often each outcome comes up. The
 * search assumes the return is monotonic in `t`, which holds because every bias
 * here moves weight in a single direction.
 */
export function blendToCap<T>(
  base: T,
  adjusted: T,
  cap: number,
  blend: (base: T, adjusted: T, t: number) => T,
  expectedReturn: ExpectedReturnOf<T>,
): T {
  if (expectedReturn(adjusted) <= cap) {
    return adjusted;
  }

  // The base is already at or over the cap, so hand it back unblended.
  if (expectedReturn(base) >= cap) {
    return base;
  }

  let low = 0;
  let high = 1;

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;

    if (expectedReturn(blend(base, adjusted, middle)) > cap) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return blend(base, adjusted, low);
}

/** Blends two scalars, for a game whose luck shades a single number. */
export function blendScalar(base: number, adjusted: number, t: number): number {
  return base * (1 - t) + adjusted * t;
}
