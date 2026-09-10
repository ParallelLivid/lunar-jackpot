/**
 * Blackjack: a reduced rule set, stated in full so the panel can publish it.
 * Single hand against the dealer, six-deck shoe reshuffled every hand, dealer
 * stands on all 17, blackjack pays 3:2. Hit, stand and double only — splitting
 * turns one hand into a tree, and insurance is a side bet most players decline.
 */

export const BLACKJACK_DECKS = 6;

/** Ranks 1 to 13, ace low. Ten, jack, queen and king all count ten. */
export const BLACKJACK_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

export const BLACKJACK_RANK_NAMES: Record<number, string> = {
  1: "A",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
};

export function cardValue(rank: number): number {
  return rank >= 10 ? 10 : rank;
}

/** Four of each rank per deck. Ten-value ranks therefore total four times as many. */
export const BLACKJACK_RANK_WEIGHT = 4 * BLACKJACK_DECKS;

/**
 * How luck leans the shoe, per rank, before the cap has its say. High cards
 * favour the player and low cards the dealer, so aces and tens are shaded up,
 * the dealer's bust cards down, and the neutral middle left alone.
 */
export const BLACKJACK_LUCK_SHAPE: Record<number, number> = {
  1: 1,
  2: -0.7,
  3: -0.7,
  4: -0.7,
  5: -0.7,
  6: -0.7,
  7: 0,
  8: 0,
  9: 0,
  10: 0.5,
  11: 0.5,
  12: 0.5,
  13: 0.5,
};

/**
 * The strongest lean full luck may ask for, before the cap. Deliberately larger
 * than the cap allows, so the cap is exercised rather than decorative.
 */
export const BLACKJACK_LUCK_BIAS = 0.5;

/**
 * How many cards are committed when a hand is dealt: enough for the worst hand
 * the rules permit, since neither side can exceed 21 before its twenty-second
 * card. Committing the whole shoe at the deal is not an optimisation but the
 * rule that stops a player reloading before a hit until the card is good.
 */
export const BLACKJACK_SHOE_SIZE = 48;

/** Total returned per chip staked, stake included. */
export const BLACKJACK_BLACKJACK_MULTIPLIER = 2.5;
export const BLACKJACK_WIN_MULTIPLIER = 2;
export const BLACKJACK_PUSH_MULTIPLIER = 1;

/**
 * Realised return per chip staked, measured rather than derived. In the other
 * three games luck shifts a distribution the player has already bet against;
 * here they act after seeing a card, so the same weight bias is worth more than
 * any closed form on the opening deal would predict.
 *
 * Each row is `[bias strength, realised return]` from `measureBlackjackReturn`
 * over a basic-strategy bot, reproduced by `blackjack.test.ts`. The cap
 * interpolates this table, so blackjack is capped against how it actually plays.
 */
export const BLACKJACK_MEASURED_RETURN: ReadonlyArray<readonly [number, number]> = [
  [0, 0.9889],
  [0.05, 0.9946],
  [0.1, 0.9989],
  [0.15, 1.0042],
  [0.2, 1.0089],
  [0.25, 1.0134],
  [0.3, 1.0182],
  [0.4, 1.0264],
  [0.5, 1.0322],
];

/**
 * Where the cap actually bites. The measured base return is 0.9889 — a 1.1%
 * house edge against basic strategy — and the cap is 1.0, so luck may lean the
 * shoe to about 0.113 of the 0.5 it asks for before being held there.
 */
export const BLACKJACK_BASE_RETURN = BLACKJACK_MEASURED_RETURN[0][1];
