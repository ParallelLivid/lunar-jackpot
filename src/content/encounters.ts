/**
 * Expedition encounter and reward-table definitions.
 *
 * The table is banded: each depth band has its own encounters and reward tables,
 * so a Selenite Core ore node is a different grant from a Shelf one rather than
 * the same grant with a multiplier. Only the deepest band is open-ended.
 *
 * Reward value scales about 2.2x per band, roughly matching the pace at which
 * gear opens the next one. Collectibles appear from The Dark downward and get
 * steadily likelier, which is the second route into the fragment economy.
 */

import type { DepthBandId } from "./depthBands";
import { bandsFrom } from "./depthBands";
import type { ContractId } from "./contracts";
import type { OreGradeId } from "./economy";

export const ENCOUNTER_FAMILIES = [
  "ore",
  "oxygen",
  "supply",
  "rare",
  "hazard",
  "choice",
] as const;

export type EncounterFamily = (typeof ENCOUNTER_FAMILIES)[number];

/**
 * What a family is called when named on its own rather than through a specific
 * encounter's `rewardSummary`. Only the Cartographer's eye forecast uses these,
 * and they are deliberately vague: "Something rare" covers a supply cache and a
 * cat alike.
 */
export const ENCOUNTER_FAMILY_LABELS: Record<EncounterFamily, string> = {
  ore: "A seam of ore",
  oxygen: "Breathable air",
  supply: "Salvage",
  rare: "Something rare",
  hazard: "Something hostile",
  choice: "A fork",
};

export type EncounterResolutionMode = "automatic" | "choice";

export const ENCOUNTER_IDS = [
  "encounter.cat",
  "encounter.ore.shelf.light",
  "encounter.ore.shelf.rich",
  "encounter.oxygen.shelf",
  "encounter.supply.shelf",
  "encounter.hazard.shelf",
  "encounter.rare.shelf",
  "encounter.choice.shelf.fissure",
  "encounter.choice.shelf.stake",
  "encounter.ore.seams.light",
  "encounter.ore.seams.rich",
  "encounter.oxygen.seams",
  "encounter.supply.seams",
  "encounter.hazard.seams",
  "encounter.rare.seams",
  "encounter.choice.seams.lift",
  "encounter.choice.seams.signal",
  "encounter.ore.dark.light",
  "encounter.ore.dark.rich",
  "encounter.oxygen.dark",
  "encounter.supply.dark",
  "encounter.hazard.dark",
  "encounter.rare.dark",
  "encounter.choice.dark.breach",
  "encounter.choice.dark.shaft",
  "encounter.ore.hollow.light",
  "encounter.ore.hollow.rich",
  "encounter.oxygen.hollow",
  "encounter.supply.hollow",
  "encounter.hazard.hollow",
  "encounter.rare.hollow",
  "encounter.choice.hollow.gallery",
  "encounter.choice.hollow.cache",
  "encounter.ore.core.light",
  "encounter.ore.core.rich",
  "encounter.supply.core",
  "encounter.hazard.core",
  "encounter.rare.core",
  "encounter.choice.core.quiet",
  "encounter.choice.core.lode",
] as const;

export type EncounterId = (typeof ENCOUNTER_IDS)[number];

export const REWARD_TABLE_IDS = [
  "reward.ore.shelf.light",
  "reward.ore.shelf.rich",
  "reward.oxygen.shelf",
  "reward.contract.survey",
  "reward.contract.core-sample",
  "reward.contract.deep-lease",
  "reward.supply.shelf",
  "reward.hazard.shelf",
  "reward.rare.shelf",
  "reward.choice.shelf.fissure.commit",
  "reward.choice.shelf.fissure.avoid",
  "reward.choice.shelf.stake.take",
  "reward.choice.shelf.stake.work",
  "reward.choice.shelf.stake.leave",
  "reward.ore.seams.light",
  "reward.ore.seams.rich",
  "reward.oxygen.seams",
  "reward.supply.seams",
  "reward.hazard.seams",
  "reward.rare.seams",
  "reward.choice.seams.lift.commit",
  "reward.choice.seams.lift.avoid",
  "reward.choice.seams.signal.take",
  "reward.choice.seams.signal.work",
  "reward.choice.seams.signal.leave",
  "reward.ore.dark.light",
  "reward.ore.dark.rich",
  "reward.oxygen.dark",
  "reward.supply.dark",
  "reward.hazard.dark",
  "reward.rare.dark",
  "reward.choice.dark.breach.commit",
  "reward.choice.dark.breach.avoid",
  "reward.choice.dark.shaft.take",
  "reward.choice.dark.shaft.work",
  "reward.choice.dark.shaft.leave",
  "reward.ore.hollow.light",
  "reward.ore.hollow.rich",
  "reward.oxygen.hollow",
  "reward.supply.hollow",
  "reward.hazard.hollow",
  "reward.rare.hollow",
  "reward.choice.hollow.gallery.commit",
  "reward.choice.hollow.gallery.avoid",
  "reward.choice.hollow.cache.take",
  "reward.choice.hollow.cache.work",
  "reward.choice.hollow.cache.leave",
  "reward.ore.core.light",
  "reward.ore.core.rich",
  "reward.supply.core",
  "reward.hazard.core",
  "reward.rare.core",
  "reward.choice.core.quiet.commit",
  "reward.choice.core.quiet.avoid",
  "reward.choice.core.lode.take",
  "reward.choice.core.lode.work",
  "reward.choice.core.lode.leave",
] as const;

export type RewardTableId = (typeof REWARD_TABLE_IDS)[number];

export type ChoiceId = string;

export type RewardGrant =
  | { kind: "ore"; grade: OreGradeId; minimum: number; maximum: number }
  | { kind: "oxygen"; minimum: number; maximum: number }
  | { kind: "components"; minimum: number; maximum: number }
  | { kind: "relics"; minimum: number; maximum: number }
  | { kind: "recipePiece"; minimum: number; maximum: number }
  | { kind: "caches"; minimum: number; maximum: number }
  /**
   * A deep cache, which only the dark and below ever gives up. Its own grant kind
   * rather than a field on `caches`, so the switch that applies grants stays
   * exhaustive and a third kind would fail to compile until handled.
   */
  | { kind: "deepCaches"; minimum: number; maximum: number }
  /**
   * A trinket or totem found in the rock rather than bought from a cache,
   * resolved through the same path a cache open takes, so a duplicate arrives as
   * fragments rather than a second copy.
   */
  | { kind: "collectible"; pool: "trinket" | "totem" | "any" }
  /**
   * A depth contract offered rather than a reward handed over — the only grant
   * that pays later. Its reward is drawn and committed at acceptance, so it
   * cannot be rerolled by reloading at the target.
   */
  | { kind: "contract"; contractId: ContractId };

export interface RewardTableEntry {
  id: string;
  weight: number;
  /** Tags used by reward-quantity and encounter-weight modifiers. */
  tags: string[];
  grants: RewardGrant[];
}

export interface RewardTableDefinition {
  id: RewardTableId;
  entries: RewardTableEntry[];
}

export interface EncounterChoiceDefinition {
  id: ChoiceId;
  label: string;
  description: string;
  /** Oxygen deducted immediately when the option is committed. */
  oxygenCost: number;
  resolveDurationMs: number;
  oxygenDrainMultiplier: number;
  rewardTableId: RewardTableId;
}

export interface EncounterDefinition {
  id: EncounterId;
  displayName: string;
  family: EncounterFamily;
  spriteId: string;
  resolutionMode: EncounterResolutionMode;
  /**
   * Bands this encounter can appear in. Most declare `bandsFrom(x)` — "this band
   * and everything deeper" — which is the behaviour the old `minimumDepth` floor
   * produced. A future table may narrow them so encounters rotate out again.
   */
  bands: DepthBandId[];
  /**
   * True for an encounter the weighted table never draws. The cat is the only
   * one: weights are relative, so a table entry could not hold its odds fixed at
   * 1 in 1000.
   */
  outsideTable?: boolean;
  baseWeight: number;
  /** Tags that luck-driven encounter-weight modifiers may match. */
  beneficialTags: string[];
  difficultyLabel: string;
  rewardSummary: string;
  approachDurationMs: number;
  /** Absent for ore encounters, whose duration derives from durability. */
  resolveDurationMs?: number;
  durability?: number;
  oxygenDrainMultiplier: number;
  rewardTableId?: RewardTableId;
  choiceOptions?: EncounterChoiceDefinition[];
}

export const REWARD_TABLES: Record<RewardTableId, RewardTableDefinition> = {
  "reward.ore.shelf.light": {
    id: "reward.ore.shelf.light",
    entries: [
      {
        id: "dust",
        weight: 66,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "dust", minimum: 6, maximum: 10 }],
      },
      {
        id: "seam",
        weight: 34,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 1, maximum: 2 }],
      },
    ],
  },
  "reward.ore.shelf.rich": {
    id: "reward.ore.shelf.rich",
    entries: [
      {
        id: "seam",
        weight: 58,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 3, maximum: 5 }],
      },
      {
        id: "core",
        weight: 42,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 1, maximum: 2 }],
      },
    ],
  },
  "reward.oxygen.shelf": {
    id: "reward.oxygen.shelf",
    entries: [
      {
        id: "pocket",
        weight: 70,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 8, maximum: 14 }],
      },
      {
        id: "vent",
        weight: 30,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 15, maximum: 24 }],
      },
    ],
  },
  /*
   * Contract payouts, in their own tables: what a contract pays is a decision
   * about the contract, and a contract must never draw from a table that offers
   * contracts. Scaled to the walk each one asks for: three depths, five, eight.
   */
  "reward.contract.survey": {
    id: "reward.contract.survey",
    entries: [
      {
        id: "parts",
        weight: 60,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 3, maximum: 6 }],
      },
      {
        id: "relics",
        weight: 40,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 2, maximum: 3 }],
      },
    ],
  },
  "reward.contract.core-sample": {
    id: "reward.contract.core-sample",
    entries: [
      {
        id: "relics",
        weight: 55,
        tags: ["rare"],
        grants: [{ kind: "relics", minimum: 5, maximum: 9 }],
      },
      {
        id: "cache",
        weight: 45,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.contract.deep-lease": {
    id: "reward.contract.deep-lease",
    entries: [
      {
        id: "haul",
        weight: 50,
        tags: ["rare"],
        grants: [
          { kind: "relics", minimum: 10, maximum: 16 },
          { kind: "components", minimum: 8, maximum: 14 },
        ],
      },
      {
        id: "collectible",
        weight: 50,
        tags: ["rare", "cache"],
        grants: [{ kind: "collectible", pool: "any" }],
      },
    ],
  },
  "reward.supply.shelf": {
    id: "reward.supply.shelf",
    entries: [
      {
        // An offer rather than a payout: it pays nothing now and costs nothing to
        // ignore. Weighted low, or it would be a chore rather than a decision.
        id: "contract",
        weight: 14,
        tags: ["supply"],
        grants: [{ kind: "contract", contractId: "contract.survey" }],
      },
      {
        id: "parts",
        weight: 56,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 2, maximum: 4 }],
      },
      {
        id: "relic",
        weight: 30,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 14,
        tags: ["supply", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.hazard.shelf": {
    id: "reward.hazard.shelf",
    entries: [
      {
        id: "haul",
        weight: 62,
        tags: ["ore", "hazard"],
        grants: [{ kind: "ore", grade: "core", minimum: 2, maximum: 4 }],
      },
      {
        id: "salvage",
        weight: 38,
        tags: ["supply", "hazard"],
        grants: [{ kind: "components", minimum: 4, maximum: 7 }, { kind: "relics", minimum: 1, maximum: 2 }],
      },
    ],
  },
  "reward.rare.shelf": {
    id: "reward.rare.shelf",
    entries: [
      {
        id: "cache",
        weight: 46,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 32,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
      {
        id: "relics",
        weight: 22,
        tags: ["rare"],
        grants: [{ kind: "relics", minimum: 2, maximum: 4 }],
      },
    ],
  },
  "reward.choice.shelf.fissure.commit": {
    id: "reward.choice.shelf.fissure.commit",
    entries: [
      {
        id: "haul",
        weight: 60,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 3, maximum: 6 }],
      },
      {
        id: "relics",
        weight: 40,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 3 }],
      },
    ],
  },
  "reward.choice.shelf.fissure.avoid": {
    id: "reward.choice.shelf.fissure.avoid",
    entries: [
      {
        id: "parts",
        weight: 100,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 1, maximum: 3 }],
      },
    ],
  },
  "reward.choice.shelf.stake.take": {
    id: "reward.choice.shelf.stake.take",
    entries: [
      {
        id: "cache",
        weight: 54,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 46,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.choice.shelf.stake.work": {
    id: "reward.choice.shelf.stake.work",
    entries: [
      {
        id: "parts",
        weight: 62,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 3, maximum: 6 }],
      },
      {
        id: "relic",
        weight: 38,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 2 }],
      },
    ],
  },
  "reward.choice.shelf.stake.leave": {
    id: "reward.choice.shelf.stake.leave",
    entries: [
      {
        id: "reserve",
        weight: 100,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 5, maximum: 9 }],
      },
    ],
  },
  "reward.ore.seams.light": {
    id: "reward.ore.seams.light",
    entries: [
      {
        id: "dust",
        weight: 66,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "dust", minimum: 14, maximum: 24 }],
      },
      {
        id: "seam",
        weight: 34,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 2, maximum: 5 }],
      },
    ],
  },
  "reward.ore.seams.rich": {
    id: "reward.ore.seams.rich",
    entries: [
      {
        id: "seam",
        weight: 58,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 7, maximum: 12 }],
      },
      {
        id: "core",
        weight: 42,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 2, maximum: 5 }],
      },
    ],
  },
  "reward.oxygen.seams": {
    id: "reward.oxygen.seams",
    entries: [
      {
        id: "pocket",
        weight: 70,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 12, maximum: 21 }],
      },
      {
        id: "vent",
        weight: 30,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 22, maximum: 36 }],
      },
    ],
  },
  "reward.supply.seams": {
    id: "reward.supply.seams",
    entries: [
      {
        // An offer rather than a payout: it pays nothing now and costs nothing to
        // ignore. Weighted low, or it would be a chore rather than a decision.
        id: "contract",
        weight: 14,
        tags: ["supply"],
        grants: [{ kind: "contract", contractId: "contract.core-sample" }],
      },
      {
        id: "parts",
        weight: 56,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 5, maximum: 10 }],
      },
      {
        id: "relic",
        weight: 30,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 2 }],
      },
      {
        id: "recipe",
        weight: 14,
        tags: ["supply", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.hazard.seams": {
    id: "reward.hazard.seams",
    entries: [
      {
        id: "haul",
        weight: 62,
        tags: ["ore", "hazard"],
        grants: [{ kind: "ore", grade: "core", minimum: 5, maximum: 10 }],
      },
      {
        id: "salvage",
        weight: 38,
        tags: ["supply", "hazard"],
        grants: [{ kind: "components", minimum: 10, maximum: 17 }, { kind: "relics", minimum: 1, maximum: 5 }],
      },
    ],
  },
  "reward.rare.seams": {
    id: "reward.rare.seams",
    entries: [
      {
        id: "cache",
        weight: 46,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 32,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
      {
        id: "relics",
        weight: 22,
        tags: ["rare"],
        grants: [{ kind: "relics", minimum: 5, maximum: 10 }],
      },
    ],
  },
  "reward.choice.seams.lift.commit": {
    id: "reward.choice.seams.lift.commit",
    entries: [
      {
        id: "haul",
        weight: 60,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 7, maximum: 14 }],
      },
      {
        id: "relics",
        weight: 40,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 2, maximum: 7 }],
      },
    ],
  },
  "reward.choice.seams.lift.avoid": {
    id: "reward.choice.seams.lift.avoid",
    entries: [
      {
        id: "parts",
        weight: 100,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 2, maximum: 7 }],
      },
    ],
  },
  "reward.choice.seams.signal.take": {
    id: "reward.choice.seams.signal.take",
    entries: [
      {
        id: "cache",
        weight: 54,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 46,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.choice.seams.signal.work": {
    id: "reward.choice.seams.signal.work",
    entries: [
      {
        id: "parts",
        weight: 62,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 7, maximum: 14 }],
      },
      {
        id: "relic",
        weight: 38,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 5 }],
      },
    ],
  },
  "reward.choice.seams.signal.leave": {
    id: "reward.choice.seams.signal.leave",
    entries: [
      {
        id: "reserve",
        weight: 100,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 8, maximum: 14 }],
      },
    ],
  },
  "reward.ore.dark.light": {
    id: "reward.ore.dark.light",
    entries: [
      {
        id: "dust",
        weight: 66,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "dust", minimum: 33, maximum: 55 }],
      },
      {
        id: "seam",
        weight: 34,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 6, maximum: 11 }],
      },
    ],
  },
  "reward.ore.dark.rich": {
    id: "reward.ore.dark.rich",
    entries: [
      {
        id: "seam",
        weight: 58,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 16, maximum: 28 }],
      },
      {
        id: "core",
        weight: 42,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 6, maximum: 11 }],
      },
    ],
  },
  "reward.oxygen.dark": {
    id: "reward.oxygen.dark",
    entries: [
      {
        id: "pocket",
        weight: 70,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 18, maximum: 32 }],
      },
      {
        id: "vent",
        weight: 30,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 34, maximum: 55 }],
      },
    ],
  },
  "reward.supply.dark": {
    id: "reward.supply.dark",
    entries: [
      {
        // An offer rather than a payout: it pays nothing now and costs nothing to
        // ignore. Weighted low, or it would be a chore rather than a decision.
        id: "contract",
        weight: 14,
        tags: ["supply"],
        grants: [{ kind: "contract", contractId: "contract.deep-lease" }],
      },
      {
        id: "parts",
        weight: 56,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 11, maximum: 22 }],
      },
      {
        id: "relic",
        weight: 30,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 6 }],
      },
      {
        id: "recipe",
        weight: 14,
        tags: ["supply", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.hazard.dark": {
    id: "reward.hazard.dark",
    entries: [
      {
        id: "haul",
        weight: 62,
        tags: ["ore", "hazard"],
        grants: [{ kind: "ore", grade: "core", minimum: 11, maximum: 22 }],
      },
      {
        id: "salvage",
        weight: 38,
        tags: ["supply", "hazard"],
        grants: [{ kind: "components", minimum: 22, maximum: 38 }, { kind: "relics", minimum: 1, maximum: 11 }],
      },
    ],
  },
  "reward.rare.dark": {
    id: "reward.rare.dark",
    entries: [
      {
        id: "cache",
        weight: 46,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "deep-cache",
        weight: 11,
        tags: ["rare", "cache"],
        grants: [{ kind: "deepCaches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 32,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 2 }],
      },
      {
        id: "relics",
        weight: 22,
        tags: ["rare"],
        grants: [{ kind: "relics", minimum: 11, maximum: 22 }],
      },
      {
        id: "collectible",
        weight: 5,
        tags: ["rare", "collectible"],
        grants: [{ kind: "collectible", pool: "any" }],
      },
    ],
  },
  "reward.choice.dark.breach.commit": {
    id: "reward.choice.dark.breach.commit",
    entries: [
      {
        id: "haul",
        weight: 60,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 16, maximum: 33 }],
      },
      {
        id: "relics",
        weight: 40,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 6, maximum: 16 }],
      },
    ],
  },
  "reward.choice.dark.breach.avoid": {
    id: "reward.choice.dark.breach.avoid",
    entries: [
      {
        id: "parts",
        weight: 100,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 6, maximum: 16 }],
      },
    ],
  },
  "reward.choice.dark.shaft.take": {
    id: "reward.choice.dark.shaft.take",
    entries: [
      {
        id: "cache",
        weight: 54,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 46,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 2 }],
      },
      {
        id: "collectible",
        weight: 10,
        tags: ["rare", "collectible"],
        grants: [{ kind: "collectible", pool: "any" }],
      },
    ],
  },
  "reward.choice.dark.shaft.work": {
    id: "reward.choice.dark.shaft.work",
    entries: [
      {
        id: "parts",
        weight: 62,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 16, maximum: 33 }],
      },
      {
        id: "relic",
        weight: 38,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 11 }],
      },
    ],
  },
  "reward.choice.dark.shaft.leave": {
    id: "reward.choice.dark.shaft.leave",
    entries: [
      {
        id: "reserve",
        weight: 100,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 12, maximum: 21 }],
      },
    ],
  },
  "reward.ore.hollow.light": {
    id: "reward.ore.hollow.light",
    entries: [
      {
        id: "dust",
        weight: 66,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "dust", minimum: 72, maximum: 120 }],
      },
      {
        id: "seam",
        weight: 34,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 12, maximum: 24 }],
      },
    ],
  },
  "reward.ore.hollow.rich": {
    id: "reward.ore.hollow.rich",
    entries: [
      {
        id: "seam",
        weight: 58,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 36, maximum: 60 }],
      },
      {
        id: "core",
        weight: 42,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 12, maximum: 24 }],
      },
    ],
  },
  "reward.oxygen.hollow": {
    id: "reward.oxygen.hollow",
    entries: [
      {
        id: "pocket",
        weight: 70,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 28, maximum: 49 }],
      },
      {
        id: "vent",
        weight: 30,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 52, maximum: 84 }],
      },
    ],
  },
  "reward.supply.hollow": {
    id: "reward.supply.hollow",
    entries: [
      {
        id: "parts",
        weight: 56,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 24, maximum: 48 }],
      },
      {
        id: "relic",
        weight: 30,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 12 }],
      },
      {
        id: "recipe",
        weight: 14,
        tags: ["supply", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.hazard.hollow": {
    id: "reward.hazard.hollow",
    entries: [
      {
        id: "haul",
        weight: 62,
        tags: ["ore", "hazard"],
        grants: [{ kind: "ore", grade: "core", minimum: 24, maximum: 48 }],
      },
      {
        id: "salvage",
        weight: 38,
        tags: ["supply", "hazard"],
        grants: [{ kind: "components", minimum: 48, maximum: 84 }, { kind: "relics", minimum: 1, maximum: 24 }],
      },
    ],
  },
  "reward.rare.hollow": {
    id: "reward.rare.hollow",
    entries: [
      {
        id: "cache",
        weight: 46,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "deep-cache",
        weight: 11,
        tags: ["rare", "cache"],
        grants: [{ kind: "deepCaches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 32,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 5 }],
      },
      {
        id: "relics",
        weight: 22,
        tags: ["rare"],
        grants: [{ kind: "relics", minimum: 24, maximum: 48 }],
      },
      {
        id: "collectible",
        weight: 9,
        tags: ["rare", "collectible"],
        grants: [{ kind: "collectible", pool: "any" }],
      },
    ],
  },
  "reward.choice.hollow.gallery.commit": {
    id: "reward.choice.hollow.gallery.commit",
    entries: [
      {
        id: "haul",
        weight: 60,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 36, maximum: 72 }],
      },
      {
        id: "relics",
        weight: 40,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 12, maximum: 36 }],
      },
    ],
  },
  "reward.choice.hollow.gallery.avoid": {
    id: "reward.choice.hollow.gallery.avoid",
    entries: [
      {
        id: "parts",
        weight: 100,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 12, maximum: 36 }],
      },
    ],
  },
  "reward.choice.hollow.cache.take": {
    id: "reward.choice.hollow.cache.take",
    entries: [
      {
        id: "cache",
        weight: 54,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 46,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 5 }],
      },
      {
        id: "collectible",
        weight: 18,
        tags: ["rare", "collectible"],
        grants: [{ kind: "collectible", pool: "any" }],
      },
    ],
  },
  "reward.choice.hollow.cache.work": {
    id: "reward.choice.hollow.cache.work",
    entries: [
      {
        id: "parts",
        weight: 62,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 36, maximum: 72 }],
      },
      {
        id: "relic",
        weight: 38,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 24 }],
      },
    ],
  },
  "reward.choice.hollow.cache.leave": {
    id: "reward.choice.hollow.cache.leave",
    entries: [
      {
        id: "reserve",
        weight: 100,
        tags: ["oxygen"],
        grants: [{ kind: "oxygen", minimum: 18, maximum: 32 }],
      },
    ],
  },
  "reward.ore.core.light": {
    id: "reward.ore.core.light",
    entries: [
      {
        id: "dust",
        weight: 66,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "dust", minimum: 156, maximum: 260 }],
      },
      {
        id: "seam",
        weight: 34,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 26, maximum: 52 }],
      },
    ],
  },
  "reward.ore.core.rich": {
    id: "reward.ore.core.rich",
    entries: [
      {
        id: "seam",
        weight: 58,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "seam", minimum: 78, maximum: 130 }],
      },
      {
        id: "core",
        weight: 42,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 26, maximum: 52 }],
      },
    ],
  },
  "reward.supply.core": {
    id: "reward.supply.core",
    entries: [
      {
        id: "parts",
        weight: 56,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 52, maximum: 104 }],
      },
      {
        id: "relic",
        weight: 30,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 26 }],
      },
      {
        id: "recipe",
        weight: 14,
        tags: ["supply", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 1 }],
      },
    ],
  },
  "reward.hazard.core": {
    id: "reward.hazard.core",
    entries: [
      {
        id: "haul",
        weight: 62,
        tags: ["ore", "hazard"],
        grants: [{ kind: "ore", grade: "core", minimum: 52, maximum: 104 }],
      },
      {
        id: "salvage",
        weight: 38,
        tags: ["supply", "hazard"],
        grants: [{ kind: "components", minimum: 104, maximum: 182 }, { kind: "relics", minimum: 1, maximum: 52 }],
      },
    ],
  },
  "reward.rare.core": {
    id: "reward.rare.core",
    entries: [
      {
        id: "cache",
        weight: 46,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "deep-cache",
        weight: 11,
        tags: ["rare", "cache"],
        grants: [{ kind: "deepCaches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 32,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 10 }],
      },
      {
        id: "relics",
        weight: 22,
        tags: ["rare"],
        grants: [{ kind: "relics", minimum: 52, maximum: 104 }],
      },
      {
        id: "collectible",
        weight: 16,
        tags: ["rare", "collectible"],
        grants: [{ kind: "collectible", pool: "any" }],
      },
    ],
  },
  "reward.choice.core.quiet.commit": {
    id: "reward.choice.core.quiet.commit",
    entries: [
      {
        id: "haul",
        weight: 60,
        tags: ["ore"],
        grants: [{ kind: "ore", grade: "core", minimum: 78, maximum: 156 }],
      },
      {
        id: "relics",
        weight: 40,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 26, maximum: 78 }],
      },
    ],
  },
  "reward.choice.core.quiet.avoid": {
    id: "reward.choice.core.quiet.avoid",
    entries: [
      {
        id: "parts",
        weight: 100,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 26, maximum: 78 }],
      },
    ],
  },
  "reward.choice.core.lode.take": {
    id: "reward.choice.core.lode.take",
    entries: [
      {
        id: "cache",
        weight: 54,
        tags: ["rare", "cache"],
        grants: [{ kind: "caches", minimum: 1, maximum: 1 }],
      },
      {
        id: "recipe",
        weight: 46,
        tags: ["rare", "recipe"],
        grants: [{ kind: "recipePiece", minimum: 1, maximum: 10 }],
      },
      {
        id: "collectible",
        weight: 32,
        tags: ["rare", "collectible"],
        grants: [{ kind: "collectible", pool: "any" }],
      },
    ],
  },
  "reward.choice.core.lode.work": {
    id: "reward.choice.core.lode.work",
    entries: [
      {
        id: "parts",
        weight: 62,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 78, maximum: 156 }],
      },
      {
        id: "relic",
        weight: 38,
        tags: ["supply"],
        grants: [{ kind: "relics", minimum: 1, maximum: 52 }],
      },
    ],
  },
  /*
   * The cheap way out of the Mother lode. It pays a token supply rather than
   * oxygen, which the core must never give back (see the band note in
   * `depthBands`), at roughly half the quantity of
   * `reward.choice.core.quiet.avoid` because it is also the cheapest resolve in
   * the game. Its value is the low drain rather than the payout, and without it
   * the Mother lode is two heavy options and no decision.
   */
  "reward.choice.core.lode.leave": {
    id: "reward.choice.core.lode.leave",
    entries: [
      {
        id: "notes",
        weight: 100,
        tags: ["supply"],
        grants: [{ kind: "components", minimum: 13, maximum: 39 }],
      },
    ],
  },
};

export const ENCOUNTERS: Record<EncounterId, EncounterDefinition> = {
  // Never drawn from the table: `generateEncounter` pre-rolls it at a fixed
  // probability, the only way "1 in 1000, and never more with luck" holds.
  "encounter.cat": {
    id: "encounter.cat",
    displayName: "A cat",
    family: "rare",
    spriteId: "sprite.cat.rest",
    resolutionMode: "automatic",
    bands: [],
    outsideTable: true,
    baseWeight: 0,
    beneficialTags: [],
    difficultyLabel: "Impossible",
    rewardSummary: "It watches you work, then follows you home.",
    approachDurationMs: 1_800,
    resolveDurationMs: 2_600,
    oxygenDrainMultiplier: 0.5,
  },
  "encounter.ore.shelf.light": {
    id: "encounter.ore.shelf.light",
    displayName: "Shallow seam",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.shelf"],
    baseWeight: 42,
    beneficialTags: ["ore"],
    difficultyLabel: "Light",
    rewardSummary: "Ore",
    approachDurationMs: 2_200,
    durability: 48,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.ore.shelf.light",
  },
  "encounter.ore.shelf.rich": {
    id: "encounter.ore.shelf.rich",
    displayName: "Bright vein",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.shelf"],
    baseWeight: 26,
    beneficialTags: ["ore"],
    difficultyLabel: "Heavy",
    rewardSummary: "Ore",
    approachDurationMs: 2_200,
    durability: 96,
    oxygenDrainMultiplier: 1.15,
    rewardTableId: "reward.ore.shelf.rich",
  },
  "encounter.oxygen.shelf": {
    id: "encounter.oxygen.shelf",
    displayName: "Oxygen pocket",
    family: "oxygen",
    spriteId: "sprite.encounter.oxygen",
    resolutionMode: "automatic",
    bands: ["band.shelf"],
    baseWeight: 20,
    beneficialTags: ["oxygen", "beneficial"],
    difficultyLabel: "Light",
    rewardSummary: "Oxygen",
    approachDurationMs: 2_000,
    resolveDurationMs: 2_400,
    oxygenDrainMultiplier: 0.6,
    rewardTableId: "reward.oxygen.shelf",
  },
  "encounter.supply.shelf": {
    id: "encounter.supply.shelf",
    displayName: "Toppled crate",
    family: "supply",
    spriteId: "sprite.encounter.supply",
    resolutionMode: "automatic",
    bands: ["band.shelf"],
    baseWeight: 22,
    beneficialTags: ["supply", "beneficial"],
    difficultyLabel: "Moderate",
    rewardSummary: "Salvage",
    approachDurationMs: 2_300,
    resolveDurationMs: 3_200,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.supply.shelf",
  },
  "encounter.hazard.shelf": {
    id: "encounter.hazard.shelf",
    displayName: "Dust fall",
    family: "hazard",
    spriteId: "sprite.encounter.hazard",
    resolutionMode: "automatic",
    bands: ["band.shelf"],
    baseWeight: 11,
    beneficialTags: ["hazard"],
    difficultyLabel: "Severe",
    rewardSummary: "Heavy oxygen cost. Loose regolith, and nowhere to shelter.",
    approachDurationMs: 2_200,
    resolveDurationMs: 4_600,
    oxygenDrainMultiplier: 2.4,
    rewardTableId: "reward.hazard.shelf",
  },
  "encounter.rare.shelf": {
    id: "encounter.rare.shelf",
    displayName: "Sealed locker",
    family: "rare",
    spriteId: "sprite.encounter.rare",
    resolutionMode: "automatic",
    bands: ["band.shelf"],
    baseWeight: 7,
    beneficialTags: ["rare", "beneficial"],
    difficultyLabel: "Uncommon",
    rewardSummary: "Rare find",
    approachDurationMs: 2_600,
    resolveDurationMs: 4_000,
    oxygenDrainMultiplier: 1.2,
    rewardTableId: "reward.rare.shelf",
  },
  "encounter.choice.shelf.fissure": {
    id: "encounter.choice.shelf.fissure",
    displayName: "Open fissure",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.shelf"],
    baseWeight: 10,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Ore below, or a quick way round.",
    approachDurationMs: 2_200,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "commit",
        label: "Descend",
        description: "Expensive in oxygen. The ore is worth it.",
        oxygenCost: 6,
        resolveDurationMs: 5_000,
        oxygenDrainMultiplier: 1.6,
        rewardTableId: "reward.choice.shelf.fissure.commit",
      },
      {
        id: "avoid",
        label: "Skirt the edge",
        description: "Cheap and quick. A little salvage.",
        oxygenCost: 0,
        resolveDurationMs: 1_800,
        oxygenDrainMultiplier: 0.8,
        rewardTableId: "reward.choice.shelf.fissure.avoid",
      },
    ],
  },
  "encounter.choice.shelf.stake": {
    id: "encounter.choice.shelf.stake",
    displayName: "Survey stake",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.shelf"],
    baseWeight: 8,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Log the claim, or press on.",
    approachDurationMs: 2_400,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "take",
        label: "Log the claim",
        description: "Slow, and the Company pays for paperwork.",
        oxygenCost: 8,
        resolveDurationMs: 5_500,
        oxygenDrainMultiplier: 1.5,
        rewardTableId: "reward.choice.shelf.stake.take",
      },
      {
        id: "work",
        label: "Pull the marker",
        description: "Scrap metal, and whatever is under it.",
        oxygenCost: 2,
        resolveDurationMs: 3_000,
        oxygenDrainMultiplier: 1.1,
        rewardTableId: "reward.choice.shelf.stake.work",
      },
      {
        id: "leave",
        label: "Walk on",
        description: "Leave it standing. Save the air.",
        oxygenCost: 0,
        resolveDurationMs: 1_200,
        oxygenDrainMultiplier: 0.4,
        rewardTableId: "reward.choice.shelf.stake.leave",
      },
    ],
  },
  "encounter.ore.seams.light": {
    id: "encounter.ore.seams.light",
    displayName: "Deep seam",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.seams"],
    baseWeight: 42,
    beneficialTags: ["ore"],
    difficultyLabel: "Light",
    rewardSummary: "Ore",
    approachDurationMs: 2_300,
    durability: 165,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.ore.seams.light",
  },
  "encounter.ore.seams.rich": {
    id: "encounter.ore.seams.rich",
    displayName: "Glittering seam",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.seams"],
    baseWeight: 26,
    beneficialTags: ["ore"],
    difficultyLabel: "Heavy",
    rewardSummary: "Ore",
    approachDurationMs: 2_300,
    durability: 330,
    oxygenDrainMultiplier: 1.15,
    rewardTableId: "reward.ore.seams.rich",
  },
  "encounter.oxygen.seams": {
    id: "encounter.oxygen.seams",
    displayName: "Vent field",
    family: "oxygen",
    spriteId: "sprite.encounter.oxygen",
    resolutionMode: "automatic",
    bands: ["band.seams"],
    baseWeight: 20,
    beneficialTags: ["oxygen", "beneficial"],
    difficultyLabel: "Light",
    rewardSummary: "Oxygen",
    approachDurationMs: 2_000,
    resolveDurationMs: 2_400,
    oxygenDrainMultiplier: 0.6,
    rewardTableId: "reward.oxygen.seams",
  },
  "encounter.supply.seams": {
    id: "encounter.supply.seams",
    displayName: "Supply wreck",
    family: "supply",
    spriteId: "sprite.encounter.supply",
    resolutionMode: "automatic",
    bands: ["band.seams"],
    baseWeight: 22,
    beneficialTags: ["supply", "beneficial"],
    difficultyLabel: "Moderate",
    rewardSummary: "Salvage",
    approachDurationMs: 2_300,
    resolveDurationMs: 3_200,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.supply.seams",
  },
  "encounter.hazard.seams": {
    id: "encounter.hazard.seams",
    displayName: "Rockfall",
    family: "hazard",
    spriteId: "sprite.encounter.hazard",
    resolutionMode: "automatic",
    bands: ["band.seams"],
    baseWeight: 11,
    beneficialTags: ["hazard"],
    difficultyLabel: "Severe",
    rewardSummary: "Heavy oxygen cost. The roof gives, and keeps giving.",
    approachDurationMs: 2_200,
    resolveDurationMs: 4_600,
    oxygenDrainMultiplier: 2.4,
    rewardTableId: "reward.hazard.seams",
  },
  "encounter.rare.seams": {
    id: "encounter.rare.seams",
    displayName: "Prospector's cairn",
    family: "rare",
    spriteId: "sprite.encounter.rare",
    resolutionMode: "automatic",
    bands: ["band.seams"],
    baseWeight: 7,
    beneficialTags: ["rare", "beneficial"],
    difficultyLabel: "Uncommon",
    rewardSummary: "Rare find",
    approachDurationMs: 2_600,
    resolveDurationMs: 4_000,
    oxygenDrainMultiplier: 1.2,
    rewardTableId: "reward.rare.seams",
  },
  "encounter.choice.seams.lift": {
    id: "encounter.choice.seams.lift",
    displayName: "Collapsed lift",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.seams"],
    baseWeight: 10,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Climb the shaft, or strip the cable.",
    approachDurationMs: 2_200,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "commit",
        label: "Climb the shaft",
        description: "Down the broken lift. Rich, and a long way back.",
        oxygenCost: 9,
        resolveDurationMs: 5_000,
        oxygenDrainMultiplier: 1.6,
        rewardTableId: "reward.choice.seams.lift.commit",
      },
      {
        id: "avoid",
        label: "Strip the cable",
        description: "Cut what is reachable and move on.",
        oxygenCost: 0,
        resolveDurationMs: 1_800,
        oxygenDrainMultiplier: 0.8,
        rewardTableId: "reward.choice.seams.lift.avoid",
      },
    ],
  },
  "encounter.choice.seams.signal": {
    id: "encounter.choice.seams.signal",
    displayName: "Repeating signal",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.seams"],
    baseWeight: 8,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Answer it, salvage it, or walk on.",
    approachDurationMs: 2_400,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "take",
        label: "Answer it",
        description: "Long and costly. The best odds of a rare find.",
        oxygenCost: 12,
        resolveDurationMs: 5_500,
        oxygenDrainMultiplier: 1.5,
        rewardTableId: "reward.choice.seams.signal.take",
      },
      {
        id: "work",
        label: "Salvage the transmitter",
        description: "Moderate. Components, sometimes a relic.",
        oxygenCost: 3,
        resolveDurationMs: 3_000,
        oxygenDrainMultiplier: 1.1,
        rewardTableId: "reward.choice.seams.signal.work",
      },
      {
        id: "leave",
        label: "Ignore it",
        description: "Walk on and tap the emergency reserve.",
        oxygenCost: 0,
        resolveDurationMs: 1_200,
        oxygenDrainMultiplier: 0.4,
        rewardTableId: "reward.choice.seams.signal.leave",
      },
    ],
  },
  "encounter.ore.dark.light": {
    id: "encounter.ore.dark.light",
    displayName: "Cold core",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.dark"],
    baseWeight: 42,
    beneficialTags: ["ore"],
    difficultyLabel: "Light",
    rewardSummary: "Ore",
    approachDurationMs: 2_400,
    durability: 300,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.ore.dark.light",
  },
  "encounter.ore.dark.rich": {
    id: "encounter.ore.dark.rich",
    displayName: "Frozen slurry",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.dark"],
    baseWeight: 26,
    beneficialTags: ["ore"],
    difficultyLabel: "Heavy",
    rewardSummary: "Ore",
    approachDurationMs: 2_400,
    durability: 600,
    oxygenDrainMultiplier: 1.15,
    rewardTableId: "reward.ore.dark.rich",
  },
  "encounter.oxygen.dark": {
    id: "encounter.oxygen.dark",
    displayName: "Deep vent",
    family: "oxygen",
    spriteId: "sprite.encounter.oxygen",
    resolutionMode: "automatic",
    bands: ["band.dark"],
    baseWeight: 20,
    beneficialTags: ["oxygen", "beneficial"],
    difficultyLabel: "Light",
    rewardSummary: "Oxygen",
    approachDurationMs: 2_000,
    resolveDurationMs: 2_400,
    oxygenDrainMultiplier: 0.6,
    rewardTableId: "reward.oxygen.dark",
  },
  "encounter.supply.dark": {
    id: "encounter.supply.dark",
    displayName: "Company wreck",
    family: "supply",
    spriteId: "sprite.encounter.supply",
    resolutionMode: "automatic",
    bands: ["band.dark"],
    baseWeight: 22,
    beneficialTags: ["supply", "beneficial"],
    difficultyLabel: "Moderate",
    rewardSummary: "Salvage",
    approachDurationMs: 2_300,
    resolveDurationMs: 3_200,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.supply.dark",
  },
  "encounter.hazard.dark": {
    id: "encounter.hazard.dark",
    displayName: "The silence",
    family: "hazard",
    spriteId: "sprite.encounter.hazard",
    resolutionMode: "automatic",
    bands: ["band.dark"],
    baseWeight: 11,
    beneficialTags: ["hazard"],
    difficultyLabel: "Severe",
    rewardSummary: "Heavy oxygen cost. No sound carries. Nothing moves but the gauge.",
    approachDurationMs: 2_200,
    resolveDurationMs: 4_600,
    oxygenDrainMultiplier: 2.4,
    rewardTableId: "reward.hazard.dark",
  },
  "encounter.rare.dark": {
    id: "encounter.rare.dark",
    displayName: "Sealed vault",
    family: "rare",
    spriteId: "sprite.encounter.rare",
    resolutionMode: "automatic",
    bands: ["band.dark"],
    baseWeight: 7,
    beneficialTags: ["rare", "beneficial"],
    difficultyLabel: "Uncommon",
    rewardSummary: "Rare find, sometimes a collectible",
    approachDurationMs: 2_600,
    resolveDurationMs: 4_000,
    oxygenDrainMultiplier: 1.2,
    rewardTableId: "reward.rare.dark",
  },
  "encounter.choice.dark.breach": {
    id: "encounter.choice.dark.breach",
    displayName: "Hull breach",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.dark"],
    baseWeight: 10,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Breach the hull, or cut the plating.",
    approachDurationMs: 2_200,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "commit",
        label: "Breach the hull",
        description: "Cut in. Whatever is sealed inside is still sealed.",
        oxygenCost: 14,
        resolveDurationMs: 5_000,
        oxygenDrainMultiplier: 1.6,
        rewardTableId: "reward.choice.dark.breach.commit",
      },
      {
        id: "avoid",
        label: "Cut the plating",
        description: "Take the outer sheets and leave the rest.",
        oxygenCost: 0,
        resolveDurationMs: 1_800,
        oxygenDrainMultiplier: 0.8,
        rewardTableId: "reward.choice.dark.breach.avoid",
      },
    ],
  },
  "encounter.choice.dark.shaft": {
    id: "encounter.choice.dark.shaft",
    displayName: "Blind shaft",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.dark"],
    baseWeight: 8,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Drop blind, or sound it first.",
    approachDurationMs: 2_400,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "take",
        label: "Drop blind",
        description: "No sounding, no rope. The fastest way down.",
        oxygenCost: 18,
        resolveDurationMs: 5_500,
        oxygenDrainMultiplier: 1.5,
        rewardTableId: "reward.choice.dark.shaft.take",
      },
      {
        id: "work",
        label: "Sound it first",
        description: "Slower, safer, and it pays less.",
        oxygenCost: 5,
        resolveDurationMs: 3_000,
        oxygenDrainMultiplier: 1.1,
        rewardTableId: "reward.choice.dark.shaft.work",
      },
      {
        id: "leave",
        label: "Rope it off",
        description: "Mark the hazard and breathe easy for a moment.",
        oxygenCost: 0,
        resolveDurationMs: 1_200,
        oxygenDrainMultiplier: 0.4,
        rewardTableId: "reward.choice.dark.shaft.leave",
      },
    ],
  },
  "encounter.ore.hollow.light": {
    id: "encounter.ore.hollow.light",
    displayName: "Glasswork cavern",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.hollow"],
    baseWeight: 42,
    beneficialTags: ["ore"],
    difficultyLabel: "Light",
    rewardSummary: "Ore",
    approachDurationMs: 2_500,
    durability: 390,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.ore.hollow.light",
  },
  "encounter.ore.hollow.rich": {
    id: "encounter.ore.hollow.rich",
    displayName: "Buried lode",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: ["band.hollow"],
    baseWeight: 26,
    beneficialTags: ["ore"],
    difficultyLabel: "Heavy",
    rewardSummary: "Ore",
    approachDurationMs: 2_500,
    durability: 780,
    oxygenDrainMultiplier: 1.15,
    rewardTableId: "reward.ore.hollow.rich",
  },
  "encounter.oxygen.hollow": {
    id: "encounter.oxygen.hollow",
    displayName: "Ice seam",
    family: "oxygen",
    spriteId: "sprite.encounter.oxygen",
    resolutionMode: "automatic",
    bands: ["band.hollow"],
    baseWeight: 20,
    beneficialTags: ["oxygen", "beneficial"],
    difficultyLabel: "Light",
    rewardSummary: "Oxygen",
    approachDurationMs: 2_000,
    resolveDurationMs: 2_400,
    oxygenDrainMultiplier: 0.6,
    rewardTableId: "reward.oxygen.hollow",
  },
  "encounter.supply.hollow": {
    id: "encounter.supply.hollow",
    displayName: "Abandoned rig",
    family: "supply",
    spriteId: "sprite.encounter.supply",
    resolutionMode: "automatic",
    bands: ["band.hollow"],
    baseWeight: 22,
    beneficialTags: ["supply", "beneficial"],
    difficultyLabel: "Moderate",
    rewardSummary: "Salvage",
    approachDurationMs: 2_300,
    resolveDurationMs: 3_200,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.supply.hollow",
  },
  "encounter.hazard.hollow": {
    id: "encounter.hazard.hollow",
    displayName: "The sump",
    family: "hazard",
    spriteId: "sprite.encounter.hazard",
    resolutionMode: "automatic",
    bands: ["band.hollow"],
    baseWeight: 11,
    beneficialTags: ["hazard"],
    difficultyLabel: "Severe",
    rewardSummary: "Heavy oxygen cost. Slurry to the knees, and the pump long dead.",
    approachDurationMs: 2_200,
    resolveDurationMs: 4_600,
    oxygenDrainMultiplier: 2.4,
    rewardTableId: "reward.hazard.hollow",
  },
  "encounter.rare.hollow": {
    id: "encounter.rare.hollow",
    displayName: "Ossuary",
    family: "rare",
    spriteId: "sprite.encounter.rare",
    resolutionMode: "automatic",
    bands: ["band.hollow"],
    baseWeight: 7,
    beneficialTags: ["rare", "beneficial"],
    difficultyLabel: "Uncommon",
    rewardSummary: "Rare find, sometimes a collectible",
    approachDurationMs: 2_600,
    resolveDurationMs: 4_000,
    oxygenDrainMultiplier: 1.2,
    rewardTableId: "reward.rare.hollow",
  },
  "encounter.choice.hollow.gallery": {
    id: "encounter.choice.hollow.gallery",
    displayName: "The Long Gallery",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.hollow"],
    baseWeight: 10,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Every chamber pays more. Every chamber costs more.",
    approachDurationMs: 2_200,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "commit",
        label: "Walk the gallery",
        description: "Every chamber pays more. Every chamber costs more.",
        oxygenCost: 21,
        resolveDurationMs: 5_000,
        oxygenDrainMultiplier: 1.6,
        rewardTableId: "reward.choice.hollow.gallery.commit",
      },
      {
        id: "avoid",
        label: "Take the first chamber",
        description: "One room, then out.",
        oxygenCost: 0,
        resolveDurationMs: 1_800,
        oxygenDrainMultiplier: 0.8,
        rewardTableId: "reward.choice.hollow.gallery.avoid",
      },
    ],
  },
  "encounter.choice.hollow.cache": {
    id: "encounter.choice.hollow.cache",
    displayName: "Cached supply",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: ["band.hollow"],
    baseWeight: 8,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Take the crate, or take the whole rig.",
    approachDurationMs: 2_400,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "take",
        label: "Take the whole rig",
        description: "Hours of cutting for everything it holds.",
        oxygenCost: 28,
        resolveDurationMs: 5_500,
        oxygenDrainMultiplier: 1.5,
        rewardTableId: "reward.choice.hollow.cache.take",
      },
      {
        id: "work",
        label: "Strip the crate",
        description: "The obvious haul, quickly.",
        oxygenCost: 7,
        resolveDurationMs: 3_000,
        oxygenDrainMultiplier: 1.1,
        rewardTableId: "reward.choice.hollow.cache.work",
      },
      {
        id: "leave",
        label: "Mark it and go",
        description: "Log the position and keep your air.",
        oxygenCost: 0,
        resolveDurationMs: 1_200,
        oxygenDrainMultiplier: 0.4,
        rewardTableId: "reward.choice.hollow.cache.leave",
      },
    ],
  },
  "encounter.ore.core.light": {
    id: "encounter.ore.core.light",
    displayName: "Selenite bloom",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: bandsFrom("band.core"),
    baseWeight: 42,
    beneficialTags: ["ore"],
    difficultyLabel: "Light",
    rewardSummary: "Ore",
    approachDurationMs: 2_600,
    durability: 525,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.ore.core.light",
  },
  "encounter.ore.core.rich": {
    id: "encounter.ore.core.rich",
    displayName: "Core sample",
    family: "ore",
    spriteId: "sprite.encounter.ore",
    resolutionMode: "automatic",
    bands: bandsFrom("band.core"),
    baseWeight: 26,
    beneficialTags: ["ore"],
    difficultyLabel: "Heavy",
    rewardSummary: "Ore",
    approachDurationMs: 2_600,
    durability: 1_050,
    oxygenDrainMultiplier: 1.15,
    rewardTableId: "reward.ore.core.rich",
  },
  // No oxygen encounter here: the Selenite Core gives no air back, so a run
  // entering it is on a clock that only runs down. See `depthBands.ts`.
  "encounter.supply.core": {
    id: "encounter.supply.core",
    displayName: "Vault stores",
    family: "supply",
    spriteId: "sprite.encounter.supply",
    resolutionMode: "automatic",
    bands: bandsFrom("band.core"),
    baseWeight: 22,
    beneficialTags: ["supply", "beneficial"],
    difficultyLabel: "Moderate",
    rewardSummary: "Salvage",
    approachDurationMs: 2_300,
    resolveDurationMs: 3_200,
    oxygenDrainMultiplier: 1.0,
    rewardTableId: "reward.supply.core",
  },
  "encounter.hazard.core": {
    id: "encounter.hazard.core",
    displayName: "Starfall",
    family: "hazard",
    spriteId: "sprite.encounter.hazard",
    resolutionMode: "automatic",
    bands: bandsFrom("band.core"),
    baseWeight: 11,
    beneficialTags: ["hazard"],
    difficultyLabel: "Severe",
    rewardSummary: "Heavy oxygen cost. Something falls, very far away, for a very long time.",
    approachDurationMs: 2_200,
    resolveDurationMs: 4_600,
    oxygenDrainMultiplier: 2.4,
    rewardTableId: "reward.hazard.core",
  },
  "encounter.rare.core": {
    id: "encounter.rare.core",
    displayName: "Reliquary",
    family: "rare",
    spriteId: "sprite.encounter.rare",
    resolutionMode: "automatic",
    bands: bandsFrom("band.core"),
    baseWeight: 7,
    beneficialTags: ["rare", "beneficial"],
    difficultyLabel: "Uncommon",
    rewardSummary: "Rare find, sometimes a collectible",
    approachDurationMs: 2_600,
    resolveDurationMs: 4_000,
    oxygenDrainMultiplier: 1.2,
    rewardTableId: "reward.rare.core",
  },
  "encounter.choice.core.quiet": {
    id: "encounter.choice.core.quiet",
    displayName: "The Quiet Room",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: bandsFrom("band.core"),
    baseWeight: 10,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "Stay in the quiet, or leave while you can.",
    approachDurationMs: 2_200,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "commit",
        label: "Stay in the quiet",
        description: "Nothing moves here but the gauge. It pays like nothing else.",
        oxygenCost: 30,
        resolveDurationMs: 5_000,
        oxygenDrainMultiplier: 1.6,
        rewardTableId: "reward.choice.core.quiet.commit",
      },
      {
        id: "avoid",
        label: "Leave while you can",
        description: "Back out with what you have.",
        oxygenCost: 0,
        resolveDurationMs: 1_800,
        oxygenDrainMultiplier: 0.8,
        rewardTableId: "reward.choice.core.quiet.avoid",
      },
    ],
  },
  "encounter.choice.core.lode": {
    id: "encounter.choice.core.lode",
    displayName: "Mother lode",
    family: "choice",
    spriteId: "sprite.encounter.choice",
    resolutionMode: "choice",
    bands: bandsFrom("band.core"),
    baseWeight: 8,
    beneficialTags: ["choice"],
    difficultyLabel: "Your call",
    rewardSummary: "The seam runs out of sight.",
    approachDurationMs: 2_400,
    oxygenDrainMultiplier: 1.0,
    choiceOptions: [
      {
        id: "take",
        label: "Work the face",
        description: "The seam runs out of sight. So does the oxygen.",
        oxygenCost: 40,
        resolveDurationMs: 5_500,
        oxygenDrainMultiplier: 1.5,
        rewardTableId: "reward.choice.core.lode.take",
      },
      {
        id: "work",
        label: "Chip the edge",
        description: "Take the loose selenite and go.",
        oxygenCost: 10,
        resolveDurationMs: 3_000,
        oxygenDrainMultiplier: 1.1,
        rewardTableId: "reward.choice.core.lode.work",
      },
      {
        id: "leave",
        label: "Note the seam",
        description: "Record it for next time. Take the loose parts and go.",
        oxygenCost: 0,
        resolveDurationMs: 1_200,
        oxygenDrainMultiplier: 0.4,
        rewardTableId: "reward.choice.core.lode.leave",
      },
    ],
  },
};

/**
 * Every run opens on this one. The whole first band is eligible at depth 0, so
 * `generateEncounter` pins it rather than leaving the opening to a draw.
 */
export const FIRST_ENCOUNTER_ID: EncounterId = "encounter.ore.shelf.light";

/** Pre-rolled outside the table, at a probability nothing in the game can move. */
export const CAT_ENCOUNTER_ID: EncounterId = "encounter.cat";
