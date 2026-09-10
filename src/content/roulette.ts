/**
 * Vacuum roulette: European single-zero, thirty-seven pockets, outside bets plus
 * straight numbers. Payout multipliers are the published ones and luck never
 * moves them — it weights the pockets that win the bet actually placed, capped
 * through the same pathway as every other game and disclosed in the panel.
 *
 * No splits, streets or corners: they multiply the bet-placement surface without
 * adding a decision the player does not already have.
 */

export const ROULETTE_POCKET_COUNT = 37;

/** The standard European red set. Everything else from 1 to 36 is black. */
export const ROULETTE_RED_POCKETS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

const RED = new Set(ROULETTE_RED_POCKETS);

export type RouletteColour = "green" | "red" | "black";

export function pocketColour(pocket: number): RouletteColour {
  if (pocket === 0) {
    return "green";
  }

  return RED.has(pocket) ? "red" : "black";
}

export const ROULETTE_BET_IDS = [
  "bet.red",
  "bet.black",
  "bet.green",
  "bet.odd",
  "bet.even",
  "bet.low",
  "bet.high",
  "bet.dozen1",
  "bet.dozen2",
  "bet.dozen3",
  "bet.column1",
  "bet.column2",
  "bet.column3",
  "bet.straight",
] as const;

export type RouletteBetId = (typeof ROULETTE_BET_IDS)[number];

export interface RouletteBetDefinition {
  id: RouletteBetId;
  displayName: string;
  /** Short line describing which pockets win, for the published bet table. */
  description: string;
  /**
   * Total returned per chip staked on a win, stake included — the same
   * convention the slot game's multipliers use, so `net = payout - wager`
   * reads the same in both games. Even money is 2, a dozen is 3, a straight 36.
   */
  multiplier: number;
  /**
   * Which pockets win. `null` means the bet needs a number, and
   * `winningPockets` supplies it.
   */
  pockets: readonly number[] | null;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const column = (offset: number): number[] =>
  range(1, 36).filter((pocket) => pocket % 3 === offset);

export const ROULETTE_BETS: Record<RouletteBetId, RouletteBetDefinition> = {
  "bet.red": {
    id: "bet.red",
    displayName: "Red",
    description: "The eighteen red pockets.",
    multiplier: 2,
    pockets: ROULETTE_RED_POCKETS,
  },
  "bet.black": {
    id: "bet.black",
    displayName: "Black",
    description: "The eighteen black pockets.",
    multiplier: 2,
    pockets: range(1, 36).filter((pocket) => !RED.has(pocket)),
  },
  /*
   * Zero, alone. It pays 36, the same as any straight-up: thirty-seven would be
   * the whole wheel and would give green a positive expectation, making it the
   * only correct bet on the table. A separate bet rather than a straight-up on
   * zero, because "back the green" is the one single-pocket bet players name.
   */
  "bet.green": {
    id: "bet.green",
    displayName: "Green",
    description: "Zero alone.",
    multiplier: 36,
    pockets: [0],
  },
  "bet.odd": {
    id: "bet.odd",
    displayName: "Odd",
    description: "Any odd number. Zero loses.",
    multiplier: 2,
    pockets: range(1, 36).filter((pocket) => pocket % 2 === 1),
  },
  "bet.even": {
    id: "bet.even",
    displayName: "Even",
    description: "Any even number. Zero loses.",
    multiplier: 2,
    pockets: range(1, 36).filter((pocket) => pocket % 2 === 0),
  },
  "bet.low": {
    id: "bet.low",
    displayName: "1 to 18",
    description: "The lower half. Zero loses.",
    multiplier: 2,
    pockets: range(1, 18),
  },
  "bet.high": {
    id: "bet.high",
    displayName: "19 to 36",
    description: "The upper half. Zero loses.",
    multiplier: 2,
    pockets: range(19, 36),
  },
  "bet.dozen1": {
    id: "bet.dozen1",
    displayName: "1st dozen",
    description: "Numbers 1 to 12.",
    multiplier: 3,
    pockets: range(1, 12),
  },
  "bet.dozen2": {
    id: "bet.dozen2",
    displayName: "2nd dozen",
    description: "Numbers 13 to 24.",
    multiplier: 3,
    pockets: range(13, 24),
  },
  "bet.dozen3": {
    id: "bet.dozen3",
    displayName: "3rd dozen",
    description: "Numbers 25 to 36.",
    multiplier: 3,
    pockets: range(25, 36),
  },
  "bet.column1": {
    id: "bet.column1",
    displayName: "1st column",
    description: "1, 4, 7 and every third number after.",
    multiplier: 3,
    pockets: column(1),
  },
  "bet.column2": {
    id: "bet.column2",
    displayName: "2nd column",
    description: "2, 5, 8 and every third number after.",
    multiplier: 3,
    pockets: column(2),
  },
  "bet.column3": {
    id: "bet.column3",
    displayName: "3rd column",
    description: "3, 6, 9 and every third number after.",
    multiplier: 3,
    pockets: column(0),
  },
  "bet.straight": {
    id: "bet.straight",
    displayName: "Straight up",
    description: "One number, including zero.",
    multiplier: 36,
    pockets: null,
  },
};

/**
 * The colour a bet backs, when it backs exactly one. Derived from the pockets
 * rather than listed, so it cannot fall out of step with them; everything
 * spanning colours has none to show.
 */
export function betColour(betId: RouletteBetId): RouletteColour | null {
  const pockets = ROULETTE_BETS[betId].pockets;

  if (pockets === null || pockets.length === 0) {
    return null;
  }

  const first = pocketColour(pockets[0]);

  return pockets.every((pocket) => pocketColour(pocket) === first) ? first : null;
}

export function isRouletteBetId(value: unknown): value is RouletteBetId {
  return typeof value === "string" && (ROULETTE_BET_IDS as readonly string[]).includes(value);
}

export function isRoulettePocket(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < ROULETTE_POCKET_COUNT
  );
}

/**
 * The pockets that pay this bet. `straightNumber` is ignored by every bet that
 * names its own pockets, so a stale selection cannot change an outside bet.
 */
export function winningPockets(betId: RouletteBetId, straightNumber: number): readonly number[] {
  const definition = ROULETTE_BETS[betId];

  if (definition.pockets !== null) {
    return definition.pockets;
  }

  return isRoulettePocket(straightNumber) ? [straightNumber] : [0];
}

/** Wheel spin-up time. Purely presentational; the pocket is committed first. */
export const ROULETTE_SPIN_DURATION_MS = 1_800;

/**
 * How hard full luck may lean the wheel toward the pockets the player backed,
 * before the cap. Set well above what the cap allows, so the cap decides the
 * ceiling and is exercised rather than silently untested.
 */
export const ROULETTE_LUCK_POCKET_BIAS = 0.35;
