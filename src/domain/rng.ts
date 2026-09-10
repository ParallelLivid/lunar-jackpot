/**
 * Deterministic, seedable pseudo-random generation with serializable state.
 *
 * Streams are named and independent: drawing from one never advances another.
 * This is a local virtual-currency game; no cryptographic fairness is claimed.
 */

import { isFiniteNumber } from "./numbers";

export const RNG_STREAM_NAMES = [
  "expedition-generation",
  "expedition-rewards",
  "expedition-failure",
  "gambling",
  "cache-rewards",
  "machine-payout",
] as const;

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number];

/** The complete serialized state of one stream. */
export interface RngState {
  /** sfc32 keeps four 32-bit words of state. */
  a: number;
  b: number;
  c: number;
  d: number;
  /** Number of values drawn, kept for diagnostics and reproduction. */
  draws: number;
}

export interface RunRngStreams {
  "expedition-generation": RngState;
  "expedition-rewards": RngState;
  "expedition-failure": RngState;
}

const UINT32 = 0x1_0000_0000;

function hashString(text: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

/** Expands one integer seed into four well-mixed words. */
export function createRngState(seed: number, streamName: string): RngState {
  const base = (Math.trunc(seed) >>> 0) ^ hashString(streamName);
  let value = base === 0 ? 0x9e37_79b9 : base;

  const next = (): number => {
    value = (value + 0x6d2b_79f5) | 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    return (mixed ^ (mixed >>> 14)) >>> 0;
  };

  const state: RngState = { a: next(), b: next(), c: next(), d: next(), draws: 0 };

  // Discard a short warm-up run so nearby seeds diverge immediately.
  return advance(state, 12).state;
}

function step(state: RngState): { state: RngState; value: number } {
  const a = state.a >>> 0;
  const b = state.b >>> 0;
  const c = state.c >>> 0;
  const d = state.d >>> 0;

  const t = (a + b) >>> 0;
  const nextD = (d + 1) >>> 0;
  const sum = (t + nextD) >>> 0;
  const nextA = (b ^ (b >>> 9)) >>> 0;
  const nextB = (c + ((c << 3) >>> 0)) >>> 0;
  const nextC = (((c << 21) >>> 0) | (c >>> 11)) >>> 0;
  const finalC = (nextC + sum) >>> 0;

  return {
    state: { a: nextA, b: nextB, c: finalC, d: nextD, draws: state.draws + 1 },
    value: sum / UINT32,
  };
}

function advance(state: RngState, count: number): { state: RngState; value: number } {
  let current = state;
  let value = 0;

  for (let index = 0; index < count; index += 1) {
    const result = step(current);
    current = result.state;
    value = result.value;
  }

  return { state: current, value };
}

export interface RngDraw<T> {
  state: RngState;
  value: T;
}

/** Returns a value in [0, 1). */
export function nextFloat(state: RngState): RngDraw<number> {
  const result = step(state);

  return { state: result.state, value: result.value };
}

/** Returns an integer in [minimum, maximum] inclusive. */
export function nextIntegerInclusive(
  state: RngState,
  minimum: number,
  maximum: number,
): RngDraw<number> {
  if (!isFiniteNumber(minimum) || !isFiniteNumber(maximum) || maximum < minimum) {
    return { state, value: Math.trunc(minimum) };
  }

  const low = Math.ceil(minimum);
  const high = Math.floor(maximum);

  if (high <= low) {
    return { state, value: low };
  }

  const draw = nextFloat(state);
  const span = high - low + 1;

  return { state: draw.state, value: low + Math.min(span - 1, Math.floor(draw.value * span)) };
}

/** Returns true with the given probability. */
export function nextChance(state: RngState, probability: number): RngDraw<boolean> {
  const draw = nextFloat(state);

  return { state: draw.state, value: draw.value < probability };
}

export interface WeightedOption<T> {
  value: T;
  weight: number;
}

/**
 * Cumulative weighted draw over non-negative weights. Weights are used raw;
 * normalization is only needed for display.
 */
export function nextWeighted<T>(
  state: RngState,
  options: ReadonlyArray<WeightedOption<T>>,
): RngDraw<T | null> {
  const usable = options.filter(
    (option) => isFiniteNumber(option.weight) && option.weight > 0,
  );

  if (usable.length === 0) {
    return { state, value: null };
  }

  const total = usable.reduce((sum, option) => sum + option.weight, 0);
  const draw = nextFloat(state);
  let threshold = draw.value * total;

  for (const option of usable) {
    threshold -= option.weight;

    if (threshold < 0) {
      return { state: draw.state, value: option.value };
    }
  }

  return { state: draw.state, value: usable[usable.length - 1].value };
}

/**
 * Counts successes over `trials` independent rolls at `probability`.
 *
 * Small stacks roll individually so tests observe the exact per-unit
 * distribution. Large stacks use the same distribution through a normal
 * approximation, keeping one draw per stack instead of thousands.
 */
export function nextBinomial(
  state: RngState,
  trials: number,
  probability: number,
): RngDraw<number> {
  const count = Math.max(0, Math.trunc(trials));

  if (count === 0 || probability <= 0) {
    return { state, value: 0 };
  }

  if (probability >= 1) {
    return { state, value: count };
  }

  if (count <= 256) {
    let current = state;
    let successes = 0;

    for (let index = 0; index < count; index += 1) {
      const roll = nextChance(current, probability);
      current = roll.state;

      if (roll.value) {
        successes += 1;
      }
    }

    return { state: current, value: successes };
  }

  const draw = nextFloat(state);
  const mean = count * probability;
  const deviation = Math.sqrt(count * probability * (1 - probability));
  // Box-Muller needs a second uniform; take it from the advanced state.
  const second = nextFloat(draw.state);
  const radius = Math.sqrt(-2 * Math.log(Math.max(draw.value, Number.EPSILON)));
  const normal = radius * Math.cos(2 * Math.PI * second.value);
  const sampled = Math.round(mean + normal * deviation);

  return { state: second.state, value: Math.min(count, Math.max(0, sampled)) };
}

/** Draws `count` independent values from the same weighted list. */
export function nextWeightedSequence<T>(
  state: RngState,
  options: ReadonlyArray<WeightedOption<T>>,
  count: number,
): RngDraw<Array<T | null>> {
  let current = state;
  const values: Array<T | null> = [];

  for (let index = 0; index < count; index += 1) {
    const draw = nextWeighted(current, options);
    current = draw.state;
    values.push(draw.value);
  }

  return { state: current, value: values };
}

export function createRunRngStreams(seed: number): RunRngStreams {
  return {
    "expedition-generation": createRngState(seed, "expedition-generation"),
    "expedition-rewards": createRngState(seed, "expedition-rewards"),
    "expedition-failure": createRngState(seed, "expedition-failure"),
  };
}

export function isRngState(value: unknown): value is RngState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RngState>;

  return (
    Number.isInteger(candidate.a) &&
    Number.isInteger(candidate.b) &&
    Number.isInteger(candidate.c) &&
    Number.isInteger(candidate.d) &&
    Number.isInteger(candidate.draws)
  );
}

/**
 * Sum of `count` independent draws of `minimum + span * u ** exponent`. The
 * Gambler spec redraws its payout every cycle, so settling offline time can mean
 * thousands of draws. Like `nextBinomial`: individual rolls while the count is
 * small, then a normal approximation matched on mean and variance and clamped to
 * the range the true sum can occupy.
 */
export function nextPowerCurveSum(
  state: RngState,
  count: number,
  minimum: number,
  maximum: number,
  exponent: number,
  mean: number,
  variance: number,
): RngDraw<number> {
  const cycles = Math.max(0, Math.trunc(count));

  if (cycles === 0) {
    return { state, value: 0 };
  }

  const span = maximum - minimum;

  if (cycles <= 256) {
    let current = state;
    let total = 0;

    for (let index = 0; index < cycles; index += 1) {
      const draw = nextFloat(current);
      current = draw.state;
      total += minimum + span * draw.value ** exponent;
    }

    return { state: current, value: total };
  }

  const draw = nextFloat(state);
  const second = nextFloat(draw.state);
  const radius = Math.sqrt(-2 * Math.log(Math.max(draw.value, Number.EPSILON)));
  const normal = radius * Math.cos(2 * Math.PI * second.value);
  const sampled = cycles * mean + normal * Math.sqrt(variance * cycles);

  return {
    state: second.state,
    value: Math.min(cycles * maximum, Math.max(cycles * minimum, sampled)),
  };
}
