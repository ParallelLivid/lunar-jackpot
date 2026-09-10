/**
 * Names the Company would give a casino, for a player who leaves the field
 * blank. Content rather than a list in the dialogue, so `validateContent` can
 * walk every combination against `MAXIMUM_CASINO_NAME`.
 *
 * The register is a filing cabinet, not a casino: these are the names the
 * Company would have used on the paperwork.
 */

/** The Company's adjectives. */
export const CASINO_NAME_QUALIFIERS = [
  "Subsidiary",
  "Provisional",
  "Consolidated",
  "Reclassified",
  "Interim",
  "Auxiliary",
] as const;

// Kept short on purpose: the pair has to fit `MAXIMUM_CASINO_NAME` with the
// space between them, which the content test walks every combination to check.
export const CASINO_NAME_NOUNS = [
  "Holdings",
  "Amenity",
  "Recreation",
  "Morale Unit",
  "Leisure",
  "Wellness",
] as const;

/**
 * One name, drawn with the caller's own randomness. `pick` is passed in so the
 * content test can walk every combination deterministically, and so this never
 * reaches for a game RNG stream: the naming prompt is presentation, and a draw
 * from `state.random` would perturb a sequence a run is reproduced from.
 */
export function suggestCasinoName(pick: () => number = Math.random): string {
  const qualifier =
    CASINO_NAME_QUALIFIERS[Math.floor(pick() * CASINO_NAME_QUALIFIERS.length)] ??
    CASINO_NAME_QUALIFIERS[0];
  const noun = CASINO_NAME_NOUNS[Math.floor(pick() * CASINO_NAME_NOUNS.length)] ??
    CASINO_NAME_NOUNS[0];

  return `${qualifier} ${noun}`;
}
