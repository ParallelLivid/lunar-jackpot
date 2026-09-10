/**
 * What the four chip games have in common. The wager ladder is shared so a
 * player learns it once, and so a balance change cannot miss one game.
 */

export const CHIP_GAME_IDS = [
  "game.slots",
  "game.roulette",
  "game.blackjack",
  "game.depthWager",
] as const;

export type ChipGameId = (typeof CHIP_GAME_IDS)[number];

export const CHIP_GAME_NAMES: Record<ChipGameId, string> = {
  "game.slots": "Slots",
  "game.roulette": "Roulette",
  "game.blackjack": "Blackjack",
  "game.depthWager": "Depth wager",
};

/**
 * The offered rungs: the lowest affordable from a single small ore haul, the
 * highest a late-game bet. These are what the buttons offer, not what the games
 * accept — a stake only has to be a positive whole number the player can cover
 * (see {@link isStakeable}), which is what lets "Bet it all" exist.
 */
export const CHIP_WAGERS = [10, 50, 250, 1_000, 10_000, 100_000, 1_000_000] as const;

export const DEFAULT_CHIP_WAGER = CHIP_WAGERS[0];

/**
 * Whether a wager is one of the offered rungs. Used for selection — which button
 * is pressed, and what a stored selection repairs to — never for whether a stake
 * may be played.
 */
export function isChipWager(wager: number): boolean {
  return (CHIP_WAGERS as readonly number[]).includes(wager);
}

/**
 * What a game's stake selection may be: a rung, or everything. "Everything"
 * cannot be stored as a number, because the balance moves between the click that
 * selects and the click that plays. It is stored as a mode and resolved against
 * the balance at the moment of play, once, in the selectors — so every consumer
 * downstream still sees a plain number.
 */
export type ChipStake = number | "all";

/** The sentinel, named rather than spelled out at each of its call sites. */
export const STAKE_EVERYTHING = "all";

export function isChipStake(value: unknown): value is ChipStake {
  return value === STAKE_EVERYTHING || (typeof value === "number" && isChipWager(value));
}

/**
 * Whether an amount can be staked at all: any positive whole number.
 * Affordability is checked separately by each game at the moment of play.
 *
 * `Number.isInteger` also rejects an infinite stake, which matters once a balance
 * can roll over to `INF`: "bet everything" has no meaning when everything is
 * unbounded, so the panels refuse it.
 */
export function isStakeable(wager: number): boolean {
  return Number.isInteger(wager) && wager > 0;
}
