/**
 * Cache kinds, and what each one is likely to hold.
 *
 * There were two things called "a cache" before this: the object and the reward
 * table it drew from. They were the same thing, so neither needed a name. A
 * second kind with different odds makes the distinction real.
 *
 * **The tables are built from the id lists rather than written out.** A trinket
 * added to one table and forgotten in the other would be a bug nobody would find
 * for months — it would simply never turn up in deep caches.
 */

import type { ResourceId } from "./economy";
import { TOTEM_IDS, type TotemId } from "./totems";
import { TRINKET_IDS, type TrinketId } from "./trinkets";

export const CACHE_TYPE_IDS = ["cache.standard", "cache.deep"] as const;

export type CacheTypeId = (typeof CACHE_TYPE_IDS)[number];

export type CacheReward =
  | { kind: "trinket"; trinketId: TrinketId }
  | { kind: "totem"; totemId: TotemId };

export interface CacheRewardEntry {
  id: string;
  weight: number;
  reward: CacheReward;
}

export interface CacheTypeDefinition {
  id: CacheTypeId;
  /** The balance that holds them. Each kind is counted separately. */
  resourceId: ResourceId;
  displayName: string;
  description: string;
  spriteId: string;
  rewards: CacheRewardEntry[];
}

/**
 * The two weights, and the only difference between the tables.
 *
 * Totems are the rarer half of the collection — ten of them against eight
 * trinkets, at a seventh of the weight — so a cache that inverts the odds is
 * worth going deep for without being strictly better: it is much worse at
 * finishing a trinket set.
 */
const COMMON_WEIGHT = 22;
const RARE_WEIGHT = 3;

function tableOf(trinketWeight: number, totemWeight: number): CacheRewardEntry[] {
  return [
    ...TRINKET_IDS.map((trinketId) => ({
      id: trinketId,
      weight: trinketWeight,
      reward: { kind: "trinket" as const, trinketId },
    })),
    ...TOTEM_IDS.map((totemId) => ({
      id: totemId,
      weight: totemWeight,
      reward: { kind: "totem" as const, totemId },
    })),
  ];
}

export const CACHE_TYPES: Record<CacheTypeId, CacheTypeDefinition> = {
  "cache.standard": {
    id: "cache.standard",
    resourceId: "caches",
    displayName: "Cache",
    description: "Usually a trinket. Sold by The Company, or found on a run and sealed until you buy the key.",
    spriteId: "sprite.resource.caches",
    rewards: tableOf(COMMON_WEIGHT, RARE_WEIGHT),
  },
  "cache.deep": {
    id: "cache.deep",
    resourceId: "deepCaches",
    displayName: "Deep cache",
    description: "Usually a totem. The odds of an ordinary cache, the other way up, at a price to match.",
    spriteId: "sprite.resource.deep-caches",
    rewards: tableOf(RARE_WEIGHT, COMMON_WEIGHT),
  },
};

/** The ordinary cache, which is what every existing caller means by "a cache". */
export const STANDARD_CACHE_TYPE_ID: CacheTypeId = "cache.standard";

export const DEEP_CACHE_TYPE_ID: CacheTypeId = "cache.deep";

export function isCacheTypeId(value: unknown): value is CacheTypeId {
  return typeof value === "string" && (CACHE_TYPE_IDS as readonly string[]).includes(value);
}
