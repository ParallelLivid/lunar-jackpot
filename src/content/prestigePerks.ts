/**
 * The prestige perk tree: three branches from a shared root, so a prestige cycle
 * has a direction rather than a shopping list. A rank scales the perk's authored
 * effect through `scaleModifierBy`, the same rules the collectible grade ladder
 * uses but linear — a perk reaches its rank count where the ladder reaches 100x.
 *
 * Costs rise geometrically per rank, so a branch's last rank is a multi-cycle
 * goal while its first is affordable on a first prestige.
 */

import type { Modifier } from "./economy";

export const PRESTIGE_PERK_IDS = [
  "perk.foothold",
  "perk.house.edge",
  "perk.house.tempo",
  "perk.house.capital",
  "perk.house.syndicate",
  "perk.deep.lungs",
  "perk.deep.bite",
  "perk.deep.haul",
  "perk.deep.ballast",
  "perk.deep.pace",
  "perk.vault.charm",
  "perk.vault.refinery",
  "perk.vault.prospect",
  "perk.vault.dividend",
  "perk.apex",
] as const;

export type PrestigePerkId = (typeof PRESTIGE_PERK_IDS)[number];

export const PERK_BRANCH_IDS = ["branch.root", "branch.house", "branch.deep", "branch.vault"] as const;

export type PerkBranchId = (typeof PERK_BRANCH_IDS)[number];

export interface PerkBranchDefinition {
  id: PerkBranchId;
  displayName: string;
  description: string;
}

export const PERK_BRANCHES: Record<PerkBranchId, PerkBranchDefinition> = {
  "branch.root": {
    id: "branch.root",
    displayName: "Foothold",
    description: "Where every cycle starts.",
  },
  "branch.house": {
    id: "branch.house",
    displayName: "The House",
    description: "The casino floor, and what it pays.",
  },
  "branch.deep": {
    id: "branch.deep",
    displayName: "The Deep",
    description: "How far down you can get, and what you bring back.",
  },
  "branch.vault": {
    id: "branch.vault",
    displayName: "The Vault",
    description: "Luck, value, and what carries between cycles.",
  },
};

export interface PrestigePerkDefinition {
  id: PrestigePerkId;
  branch: PerkBranchId;
  displayName: string;
  description: string;
  /** Selenite for the first rank. */
  seleniteCost: number;
  /** Applied per rank already held, so later ranks cost more. */
  costGrowth: number;
  /** Ranks available. Meaningless, and ignored, when `repeatable` is set. */
  maximumRank: number;
  /**
   * No maximum: buyable forever at an unchanging price. A flag rather than an
   * enormous `maximumRank`, because that number sizes the rank pips, clamps a
   * loaded save and bounds the developer menu's estimate.
   *
   * A repeatable perk must have `costGrowth` of 1, or the price compounds
   * without limit into a wall.
   */
  repeatable?: boolean;
  prerequisitePerkIds: PrestigePerkId[];
  /**
   * Every prerequisite must be at its maximum, not merely bought. A flag, because
   * changing what `prerequisitePerkIds` means would move every other perk's gate.
   */
  requiresMaxedPrerequisites?: boolean;
  /**
   * A capability the rank unlocks rather than a stat it scales. A speed control
   * has no stat to modify — the rank is the effect — so a perk with a capability
   * may carry no modifiers.
   */
  capability?: "expedition-speed";
  /** Rank 1. Every higher rank is this, scaled by the rank number. */
  modifiers: Modifier[];
}

/**
 * Expedition speed unlocked by a rank of the pace perk: 1x, then 2x through 32x.
 * Doubling per rank, which linear perk scaling cannot express, so it is read from
 * the rank directly. The ceiling lives here because the perk's `maximumRank` and
 * this clamp must agree, or a rank would be sold that does nothing.
 */
export const MAXIMUM_PACE_RANK = 5;

export function expeditionSpeedForRank(rank: number): number {
  return 2 ** Math.max(0, Math.min(MAXIMUM_PACE_RANK, Math.trunc(rank)));
}

/** Every speed the pace perk can unlock, in order. 1x through 32x. */
export function expeditionSpeeds(): number[] {
  return Array.from({ length: MAXIMUM_PACE_RANK + 1 }, (_, rank) => 2 ** rank);
}

export const PRESTIGE_PERKS: Record<PrestigePerkId, PrestigePerkDefinition> = {
  "perk.foothold": {
    id: "perk.foothold",
    branch: "branch.root",
    displayName: "Foothold",
    description: "A standing arrangement with the Company. Every machine pays more.",
    seleniteCost: 1,
    costGrowth: 1.6,
    maximumRank: 5,
    prerequisitePerkIds: [],
    modifiers: [
      // `machine.payout` floors, and the starter machine pays 5 a cycle at level
      // 1, which is where a player stands just after their first prestige. A 10%
      // boost rounds straight back to 5, so this has to clear that floor.
      {
        sourceId: "perk.foothold",
        targetStat: "machine.payout",
        operation: "multiply",
        value: 1.2,
      },
    ],
  },

  // The House.
  "perk.house.edge": {
    id: "perk.house.edge",
    branch: "branch.house",
    displayName: "House edge",
    description: "Every casino machine pays more.",
    seleniteCost: 1,
    costGrowth: 1.45,
    maximumRank: 10,
    prerequisitePerkIds: ["perk.foothold"],
    modifiers: [
      {
        sourceId: "perk.house.edge",
        targetStat: "machine.payout",
        operation: "multiply",
        value: 1.12,
      },
    ],
  },
  "perk.house.tempo": {
    id: "perk.house.tempo",
    branch: "branch.house",
    displayName: "Shift work",
    description: "Machines complete their cycles faster.",
    seleniteCost: 3,
    costGrowth: 1.5,
    maximumRank: 8,
    prerequisitePerkIds: ["perk.house.edge"],
    modifiers: [
      {
        // Below 1, so it compounds rather than scaling its excess.
        sourceId: "perk.house.tempo",
        targetStat: "machine.cycleMs",
        operation: "multiply",
        value: 0.96,
      },
    ],
  },
  "perk.house.capital": {
    id: "perk.house.capital",
    branch: "branch.house",
    displayName: "Seed capital",
    description: "Start each cycle with cash in hand, advanced against the one after it.",
    seleniteCost: 2,
    costGrowth: 1.45,
    maximumRank: 8,
    prerequisitePerkIds: ["perk.house.edge"],
    modifiers: [
      {
        sourceId: "perk.house.capital",
        targetStat: "prestige.startingCash",
        operation: "add",
        value: 2_500,
      },
    ],
  },
  "perk.house.syndicate": {
    id: "perk.house.syndicate",
    branch: "branch.house",
    displayName: "Syndicate",
    description: "The Company stops pretending it is a casino. Payouts climb sharply.",
    seleniteCost: 8,
    costGrowth: 1.6,
    maximumRank: 6,
    prerequisitePerkIds: ["perk.house.capital"],
    modifiers: [
      {
        sourceId: "perk.house.syndicate",
        targetStat: "machine.payout",
        operation: "multiply",
        value: 1.3,
      },
    ],
  },

  // The Deep.
  "perk.deep.lungs": {
    id: "perk.deep.lungs",
    branch: "branch.deep",
    displayName: "Lung capacity",
    description: "Every tank holds more.",
    seleniteCost: 1,
    costGrowth: 1.45,
    maximumRank: 10,
    prerequisitePerkIds: ["perk.foothold"],
    modifiers: [
      {
        sourceId: "perk.deep.lungs",
        targetStat: "gear.tankOxygen",
        operation: "multiply",
        value: 1.08,
      },
    ],
  },
  "perk.deep.bite": {
    id: "perk.deep.bite",
    branch: "branch.deep",
    displayName: "Bite",
    description: "Pickaxes break rock faster, whatever their level.",
    seleniteCost: 2,
    costGrowth: 1.45,
    maximumRank: 8,
    prerequisitePerkIds: ["perk.deep.lungs"],
    modifiers: [
      {
        sourceId: "perk.deep.bite",
        targetStat: "gear.pickaxeDamage",
        operation: "multiply",
        value: 1.09,
      },
    ],
  },
  "perk.deep.haul": {
    id: "perk.deep.haul",
    branch: "branch.deep",
    displayName: "Deep haul",
    description: "Every encounter pays out larger quantities.",
    seleniteCost: 3,
    costGrowth: 1.5,
    maximumRank: 8,
    prerequisitePerkIds: ["perk.deep.lungs"],
    modifiers: [
      {
        sourceId: "perk.deep.haul",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 1.1,
      },
    ],
  },
  "perk.deep.ballast": {
    id: "perk.deep.ballast",
    branch: "branch.deep",
    displayName: "Ballast",
    description: "Less of an unbanked haul is lost when the air runs out.",
    seleniteCost: 6,
    costGrowth: 1.55,
    maximumRank: 6,
    prerequisitePerkIds: ["perk.deep.haul"],
    modifiers: [
      {
        sourceId: "perk.deep.ballast",
        targetStat: "expedition.failureLossChance",
        operation: "add",
        value: -0.04,
      },
    ],
  },

  "perk.deep.pace": {
    id: "perk.deep.pace",
    branch: "branch.deep",
    displayName: "Fast paced",
    description:
      "Runs may be simulated faster, doubling with every rank to 32x. The outcome is unchanged; only the waiting is.",
    seleniteCost: 12,
    costGrowth: 3,
    maximumRank: MAXIMUM_PACE_RANK,
    prerequisitePerkIds: ["perk.deep.lungs"],
    capability: "expedition-speed",
    modifiers: [],
  },

  // The Vault.
  "perk.vault.charm": {
    id: "perk.vault.charm",
    branch: "branch.vault",
    displayName: "Lucky charm",
    description: "Permanently adds luck.",
    seleniteCost: 1,
    costGrowth: 1.45,
    maximumRank: 10,
    prerequisitePerkIds: ["perk.foothold"],
    modifiers: [
      // Sized against the luck half-point of 250; a flat 10 would be negligible.
      { sourceId: "perk.vault.charm", targetStat: "luck", operation: "add", value: 90 },
    ],
  },
  "perk.vault.refinery": {
    id: "perk.vault.refinery",
    branch: "branch.vault",
    displayName: "Company refinery",
    description: "Ore converts to more chips at extraction, at a rate The Company has revised in your favour.",
    seleniteCost: 2,
    costGrowth: 1.45,
    maximumRank: 8,
    prerequisitePerkIds: ["perk.vault.charm"],
    modifiers: [
      {
        sourceId: "perk.vault.refinery",
        targetStat: "economy.oreChipValue",
        operation: "multiply",
        value: 1.12,
      },
    ],
  },
  "perk.vault.prospect": {
    id: "perk.vault.prospect",
    branch: "branch.vault",
    displayName: "Prospectus",
    description: "Rare encounters turn up more often.",
    seleniteCost: 3,
    costGrowth: 1.5,
    maximumRank: 8,
    prerequisitePerkIds: ["perk.vault.charm"],
    modifiers: [
      {
        sourceId: "perk.vault.prospect",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 1.15,
        tags: ["rare"],
      },
    ],
  },
  "perk.vault.dividend": {
    id: "perk.vault.dividend",
    branch: "branch.vault",
    displayName: "Dividend",
    description: "Every prestige awards more selenite, which buys the next one faster.",
    seleniteCost: 6,
    costGrowth: 1.6,
    maximumRank: 6,
    prerequisitePerkIds: ["perk.vault.refinery"],
    modifiers: [
      {
        sourceId: "perk.vault.dividend",
        targetStat: "prestige.seleniteGain",
        operation: "multiply",
        value: 1.1,
      },
    ],
  },

  /*
   * The capstone: appears only once every other perk is at its maximum, and then
   * never runs out. Linear rather than compounding — `scaleModifierBy` scales a
   * growth multiplier's excess over 1 by the rank, so rank N is x(1 + 0.01N).
   * Paired with a flat price that makes it a linear sink, which stays a real
   * purchase forever; compounding at a flat price would overtake everything.
   */
  "perk.apex": {
    id: "perk.apex",
    branch: "branch.root",
    displayName: "The long arrangement",
    description:
      "Nothing left to negotiate. Every machine pays one percent more, again, for as long as you keep asking.",
    seleniteCost: 50,
    // Flat: `perkRankCost` multiplies by this per rank already held.
    costGrowth: 1,
    maximumRank: 1,
    repeatable: true,
    requiresMaxedPrerequisites: true,
    prerequisitePerkIds: PRESTIGE_PERK_IDS.filter(
      (id) => id !== "perk.apex",
    ) as PrestigePerkId[],
    modifiers: [
      {
        sourceId: "perk.apex",
        targetStat: "machine.payout",
        operation: "multiply",
        value: 1.01,
      },
    ],
  },
};

/**
 * Selenite for the next rank of a perk, or null when it is already maxed. Rank 1
 * costs the authored price and each further rank multiplies by `costGrowth`.
 */
export function perkRankCost(perk: PrestigePerkDefinition, currentRank: number): number | null {
  if (perk.repeatable !== true && currentRank >= perk.maximumRank) {
    return null;
  }

  return Math.max(1, Math.round(perk.seleniteCost * perk.costGrowth ** currentRank));
}

export function isPrestigePerkId(value: unknown): value is PrestigePerkId {
  return typeof value === "string" && (PRESTIGE_PERK_IDS as readonly string[]).includes(value);
}
