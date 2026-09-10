/**
 * The collectible grade ladder. Trinkets and totems each declare one authored
 * effect — grade E — and every higher grade is that effect scaled by a shared
 * curve, so retuning the ladder is a single edit here.
 *
 * The bottom of the curve is not free: the coarsest base value in the content
 * (+3) sets a floor of 7/3 at grade D and 13/3 at C. Above C the curve is
 * geometric at about 1.85 per grade.
 */

import type { Modifier } from "./economy";

export const GRADE_IDS = ["E", "D", "C", "B", "A", "S", "SS", "SSS"] as const;

export type GradeId = (typeof GRADE_IDS)[number];

/** Multiplies a collectible's authored base effect. Index matches `GRADE_IDS`. */
export const GRADE_SCALARS = [1, 2.4, 4.4, 8, 15, 28, 52, 100] as const;

export const LOWEST_GRADE: GradeId = GRADE_IDS[0];

export const HIGHEST_GRADE: GradeId = GRADE_IDS[GRADE_IDS.length - 1];

export function gradeIndex(grade: GradeId): number {
  const index = GRADE_IDS.indexOf(grade);

  return index < 0 ? 0 : index;
}

export function gradeScalar(grade: GradeId): number {
  return GRADE_SCALARS[gradeIndex(grade)] ?? 1;
}

/** The grade one step up, or null at the top of the ladder. */
export function nextGrade(grade: GradeId): GradeId | null {
  return GRADE_IDS[gradeIndex(grade) + 1] ?? null;
}

export function isGradeId(value: unknown): value is GradeId {
  return typeof value === "string" && (GRADE_IDS as readonly string[]).includes(value);
}

/**
 * Scales one authored modifier to a grade. The three operations differ:
 *
 * - Additive values scale linearly.
 * - Growth multipliers scale their excess over 1, so 1.08 at 100 is +800% rather
 *   than +9,900%.
 * - Reduction multipliers compound: `0.7 ** scalar` asymptotes toward zero,
 *   where linear excess-scaling would go negative past scalar 3.3.
 *
 * No rounding here. `STAT_RULES` rounds each stat at the end of `explainStat`,
 * and rounding a fractional multiplier at this point would collapse 1.12 to 1.
 */
export function scaleModifier(modifier: Modifier, grade: GradeId): Modifier {
  return scaleModifierBy(modifier, gradeScalar(grade), grade);
}

/**
 * The scaling itself, independent of grades. Prestige perks rank up on the same
 * three rules but a gentler curve, so they share this function rather than the
 * grade table.
 */
export function scaleModifierBy(
  modifier: Modifier,
  scalar: number,
  sourceSuffix: string,
): Modifier {
  const value =
    modifier.operation === "add"
      ? modifier.value * scalar
      : modifier.value >= 1
        ? 1 + (modifier.value - 1) * scalar
        : modifier.value ** scalar;

  return { ...modifier, sourceId: `${modifier.sourceId}:${sourceSuffix}`, value };
}

export function scaleModifiers(
  modifiers: readonly Modifier[],
  grade: GradeId,
): Modifier[] {
  return modifiers.map((modifier) => scaleModifier(modifier, grade));
}

// ---------------------------------------------------------------------------
// Effect summary helpers
// ---------------------------------------------------------------------------

/** Drops a trailing ".0" so 7.2 stays readable but 24.0 reads as 24. */
export function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;

  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

/** A growth multiplier as the percentage it adds: 1.12 -> "12". */
export function percentAdded(value: number): string {
  return Math.round((value - 1) * 100).toString();
}
