/**
 * Chip slot game definition.
 *
 * Each reel draws independently from the same weighted symbol list. Payout is
 * fixed and published: three matching symbols pay the symbol's triple
 * multiplier, exactly two matching symbols pay its pair multiplier. Luck never
 * changes a multiplier, only the symbol weights.
 */

import { CHIP_WAGERS, DEFAULT_CHIP_WAGER } from "./chipGames";

export const SLOT_SYMBOL_IDS = [
  "symbol.moon",
  "symbol.chip",
  "symbol.drill",
  "symbol.relic",
  "symbol.cache",
  "symbol.jackpot",
] as const;

export type SlotSymbolId = (typeof SLOT_SYMBOL_IDS)[number];

export interface SlotSymbolDefinition {
  id: SlotSymbolId;
  displayName: string;
  glyph: string;
  baseWeight: number;
  /**
   * Signed weight response to luck. Negative values shrink a symbol's share as
   * luck rises; positive values grow it. Applied as
   * `baseWeight * (1 + luckWeightBias * luckFactor)`.
   */
  luckWeightBias: number;
  tripleMultiplier: number;
  pairMultiplier: number;
  /** Tags matched by `gambling.outcomeWeight` modifiers. */
  tags: string[];
}

export const SLOT_SYMBOLS: Record<SlotSymbolId, SlotSymbolDefinition> = {
  "symbol.moon": {
    id: "symbol.moon",
    displayName: "Moon",
    glyph: "O",
    baseWeight: 34,
    luckWeightBias: -0.45,
    tripleMultiplier: 4,
    pairMultiplier: 0.4,
    tags: [],
  },
  "symbol.chip": {
    id: "symbol.chip",
    displayName: "Chip",
    glyph: "C",
    baseWeight: 26,
    luckWeightBias: -0.25,
    tripleMultiplier: 8,
    pairMultiplier: 0.65,
    tags: ["paying"],
  },
  "symbol.drill": {
    id: "symbol.drill",
    displayName: "Drill",
    glyph: "D",
    baseWeight: 18,
    luckWeightBias: 0.25,
    tripleMultiplier: 15,
    pairMultiplier: 1,
    tags: ["paying"],
  },
  "symbol.relic": {
    id: "symbol.relic",
    displayName: "Relic",
    glyph: "R",
    baseWeight: 12,
    luckWeightBias: 0.55,
    tripleMultiplier: 32,
    pairMultiplier: 1.5,
    tags: ["paying"],
  },
  "symbol.cache": {
    id: "symbol.cache",
    displayName: "Cache",
    glyph: "B",
    baseWeight: 7,
    luckWeightBias: 0.9,
    tripleMultiplier: 90,
    pairMultiplier: 2.5,
    tags: ["paying"],
  },
  "symbol.jackpot": {
    id: "symbol.jackpot",
    displayName: "Jackpot",
    glyph: "J",
    baseWeight: 3,
    luckWeightBias: 1.1,
    tripleMultiplier: 400,
    pairMultiplier: 4,
    tags: ["paying"],
  },
};

export const SLOT_REEL_COUNT = 3;

/**
 * The shared chip-game wager ladder, under the slot game's original name.
 *
 * Kept as an alias rather than a second list: roulette and blackjack offer the
 * same stakes, and two ladders would be two places a balance change has to land.
 */
export const SLOT_WAGERS = CHIP_WAGERS;

export const SLOT_DEFAULT_WAGER = DEFAULT_CHIP_WAGER;

/** Reel spin-up time. Purely presentational; the result is committed first. */
export const SLOT_SPIN_DURATION_MS = 1_400;
