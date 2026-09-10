/** Numeric guards, clamping, and display formatting. */

import { ECONOMY } from "../content/economy";

export class NumericBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumericBoundsError";
  }
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * What a balance reads once it has rolled over the ceiling. A real `Infinity`
 * rather than a sentinel, so every comparison in the game behaves without a
 * special case: it affords every price, and spending or adding leaves it alone.
 */
export const INFINITE = Number.POSITIVE_INFINITY;

/** How an infinite balance is written. */
export const INFINITE_LABEL = "INF";

/**
 * A value a balance is allowed to hold: `INFINITE`, or a non-negative integer at
 * or below the ceiling.
 */
export function isSafeQuantity(value: unknown): value is number {
  if (value === INFINITE) {
    return true;
  }

  return isFiniteQuantity(value);
}

/**
 * The same test without the infinite case. Transaction deltas use this: a balance
 * may roll over to infinite, but no single grant or charge may claim to be.
 */
export function isFiniteQuantity(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= ECONOMY.safeMaximum
  );
}

/** Throws when a computed quantity leaves the range balances are allowed to hold. */
export function assertSafeQuantity(value: number, label: string): number {
  if (!isSafeQuantity(value)) {
    throw new NumericBoundsError(
      `${label} produced an unsafe quantity (${String(value)}). Expected a non-negative integer at or below ${ECONOMY.safeMaximum}, or ${INFINITE_LABEL}.`,
    );
  }

  return value;
}

/**
 * Adds to a balance, rolling over to {@link INFINITE} rather than overflowing —
 * the one place a total may become infinite. Reaching the ceiling rolls over
 * rather than pinning to it: at a googol the gap between representable doubles
 * is about 1e84, so `1e100 + 1` is exactly `1e100` and a strict "exceeds" test
 * would absorb every payout forever without ever rolling.
 */
export function addQuantity(current: number, amount: number): number {
  const next = current + amount;

  return next >= ECONOMY.safeMaximum ? INFINITE : next;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  if (!isFiniteNumber(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

/** Divides safely, returning the fallback when the divisor cannot be used. */
export function safeDivide(numerator: number, divisor: number, fallback = 0): number {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(divisor) || divisor === 0) {
    return fallback;
  }

  const result = numerator / divisor;

  return isFiniteNumber(result) ? result : fallback;
}

const COMPACT_UNITS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp"] as const;

/**
 * Compact notation for high-volume currencies. The exact value always remains
 * available through {@link formatExact} for tooltips.
 */
export function formatCompact(value: number, fractionDigits = 2): string {
  if (value === INFINITE) {
    return INFINITE_LABEL;
  }

  if (!isFiniteNumber(value)) {
    return "0";
  }

  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);

  if (magnitude < 1_000) {
    return `${sign}${Math.floor(magnitude).toString()}`;
  }

  let unitIndex = 0;
  let scaled = magnitude;

  while (scaled >= 1_000 && unitIndex < COMPACT_UNITS.length - 1) {
    scaled /= 1_000;
    unitIndex += 1;
  }

  /*
   * Rounding happens before the unit and digit count are settled, because
   * `toFixed` can carry across the boundary the choice was made on: 999,999 has
   * to become "1.00M" rather than "1000K", which means a carry advances the
   * suffix and not just the decimal.
   */
  let digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : fractionDigits;
  let rounded = Number(scaled.toFixed(digits));

  if (rounded >= 1_000 && unitIndex < COMPACT_UNITS.length - 1) {
    rounded /= 1_000;
    unitIndex += 1;
    // A promoted value is always in [1, 10), so it takes the full fraction.
    digits = fractionDigits;
  } else if (rounded >= 100 && digits > 0) {
    digits = 0;
  } else if (rounded >= 10 && digits > 1) {
    digits = 1;
  }

  // Past the last suffix, exponential rather than a longer table: the ceiling is
  // a googol, and thirty more two-letter abbreviations would be unreadable.
  if (rounded >= 1_000) {
    return `${sign}${magnitude.toExponential(fractionDigits)}`;
  }

  return `${sign}${rounded.toFixed(digits)}${COMPACT_UNITS[unitIndex]}`;
}

/**
 * A per-second rate, the one quantity in the game routinely between zero and
 * one. {@link formatCompact} floors below a thousand, which would report a
 * producing floor as "0", so sub-unit rates read "<1" instead. Zero stays "0",
 * and at or above one the usual compact notation applies. A wrapper rather than
 * a change to `formatCompact`, which prints balances, prices and payouts.
 */
export function formatRate(value: number): string {
  return value > 0 && value < 1 ? "<1" : formatCompact(value);
}

export function formatExact(value: number): string {
  if (value === INFINITE) {
    return INFINITE_LABEL;
  }

  if (!isFiniteNumber(value)) {
    return "0";
  }

  // Above `MAX_SAFE_INTEGER` the trailing digits are an artefact of the binary
  // representation, so exponential says what is actually known.
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    return value.toExponential(3);
  }

  return Math.trunc(value).toLocaleString("en-US");
}

export type NumberFormatMode = "compact" | "exact";

/**
 * A quantity in whichever notation the player asked for, and the only place that
 * decision is made, so no display can invent a rule of its own. Counts are the
 * deliberate exception and call {@link formatExact} directly: "1,203 runs" beats
 * "1.2K runs". See `selectStatsView`.
 */
export function formatQuantity(value: number, mode: NumberFormatMode): string {
  return mode === "compact" ? formatCompact(value) : formatExact(value);
}

export function formatPercent(ratio: number, fractionDigits = 1): string {
  if (!isFiniteNumber(ratio)) {
    return "0%";
  }

  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

export function formatDuration(milliseconds: number): string {
  if (!isFiniteNumber(milliseconds) || milliseconds < 0) {
    return "0s";
  }

  const totalSeconds = milliseconds / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds < 10 ? totalSeconds.toFixed(1) : Math.round(totalSeconds).toString()}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes - hours * 60}m`;
}

const ROMAN_NUMERALS = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
] as const;

/**
 * A rank as a numeral: roman up to ten, arabic beyond it. Repeatable research
 * has no maximum rank, and "Overclock XLVII" does not read at a glance.
 */
export function formatRankNumeral(rank: number): string {
  const value = Math.max(1, Math.trunc(isFiniteNumber(rank) ? rank : 1));

  return ROMAN_NUMERALS[value - 1] ?? String(value);
}
