/** Keys, caches, and the trinket and totem collections. */

import {
  CACHE_TYPES,
  DEEP_CACHE_TYPE_ID,
  ECONOMY,
  STANDARD_CACHE_TYPE_ID,
  TOTEMS,
  TRINKETS,
} from "../content/catalog";
import type { CacheReward, CacheTypeId, GradeId, TotemId } from "../content/catalog";
import { HIGHEST_GRADE, LOWEST_GRADE, gradeIndex, nextGrade } from "../content/grades";
import type { DomainEffect } from "./commands";
import { addQuantity } from "./numbers";
import { nextWeighted } from "./rng";
import type { GameState, TotemProgress } from "./state";
import { applyTransaction, type ResourceDelta, type TransactionPlan } from "./transactions";

export type CollectionBlock =
  | { kind: "invalid-quantity" }
  | { kind: "insufficient-resources"; missing: ResourceDelta[] }
  | { kind: "no-key" }
  | { kind: "no-cache" }
  | { kind: "no-reward-available" }
  | { kind: "expedition-active" }
  | { kind: "slot-out-of-range" }
  | { kind: "not-owned" }
  | { kind: "already-equipped" }
  | { kind: "max-grade" }
  | { kind: "depths-required"; required: number; remaining: number }
  | { kind: "insufficient-fragments"; available: number; required: number }
  | { kind: "transaction-failed"; message: string };

export type CollectionOutcome =
  | { ok: true; state: GameState; effects: DomainEffect[] }
  | { ok: false; block: CollectionBlock };

export type CollectionPlan =
  | { ok: true; plan: TransactionPlan }
  | { ok: false; block: CollectionBlock };

export function keyCost(quantity: number): number {
  return ECONOMY.keyCashCost * quantity;
}

export function planKeyPurchase(state: GameState, quantity: number): CollectionPlan {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, block: { kind: "invalid-quantity" } };
  }

  const cost = keyCost(quantity);

  if (state.resources.cash < cost) {
    return {
      ok: false,
      block: {
        kind: "insufficient-resources",
        missing: [{ resource: "cash", amount: cost - state.resources.cash }],
      },
    };
  }

  return {
    ok: true,
    plan: {
      label: `buy-keys:${quantity}`,
      costs: [{ resource: "cash", amount: cost }],
      grants: [{ resource: "keys", amount: quantity }],
    },
  };
}

/**
 * Applies one cache reward. A first find grants the item itself; every later
 * find grants fragments instead, so two tiers of one trinket cannot coexist.
 */
export function grantCollectible(state: GameState, reward: CacheReward): GameState {
  // A find that can no longer improve the item pays selenite instead. Handled
  // before either branch, so trinkets and totems cannot drift apart.
  if (isEffectivelyMaxed(state, reward)) {
    return {
      ...state,
      resources: {
        ...state.resources,
        selenite: addQuantity(state.resources.selenite, ECONOMY.selenitePerMaxedDuplicate),
      },
    };
  }

  if (reward.kind === "trinket") {
    const current = state.collection.trinkets[reward.trinketId];

    if (current === undefined) {
      return state;
    }

    const next = current.owned
      ? { ...current, fragments: current.fragments + ECONOMY.fragmentsPerDuplicate }
      : { owned: true, grade: LOWEST_GRADE, fragments: 0 };

    return {
      ...state,
      collection: {
        ...state.collection,
        trinkets: { ...state.collection.trinkets, [reward.trinketId]: next },
      },
    };
  }

  const current: TotemProgress = state.collection.totems[reward.totemId] ?? {
    owned: false,
    grade: LOWEST_GRADE,
    fragments: 0,
  };

  const next: TotemProgress = current.owned
    ? { ...current, fragments: current.fragments + ECONOMY.fragmentsPerDuplicate }
    : { owned: true, grade: LOWEST_GRADE, fragments: 0 };

  return {
    ...state,
    collection: {
      ...state.collection,
      totems: { ...state.collection.totems, [reward.totemId]: next },
    },
  };
}

/** True when the reward will arrive as fragments rather than as a new item. */
export function isDuplicateReward(state: GameState, reward: CacheReward): boolean {
  return reward.kind === "trinket"
    ? (state.collection.trinkets[reward.trinketId]?.owned ?? false)
    : (state.collection.totems[reward.totemId]?.owned ?? false);
}

/**
 * Every fragment still needed to carry a collectible from `grade` to the top.
 * The trinket and totem ladders are read separately although they hold the same
 * numbers today, since they are separate constants so they can diverge.
 */
export function remainingFragmentCost(kind: CacheReward["kind"], grade: GradeId): number {
  const costs =
    kind === "trinket" ? ECONOMY.trinketFragmentCosts : ECONOMY.totemFragmentCosts;

  return costs.slice(gradeIndex(grade)).reduce((total, cost) => total + cost, 0);
}

/**
 * True when another fragment would be worth nothing: the item is at the top of
 * the ladder, or its banked fragments already cover every remaining upgrade.
 */
export function isEffectivelyMaxed(state: GameState, reward: CacheReward): boolean {
  const progress =
    reward.kind === "trinket"
      ? state.collection.trinkets[reward.trinketId]
      : state.collection.totems[reward.totemId];

  if (progress === undefined || !progress.owned) {
    return false;
  }

  if (progress.grade === HIGHEST_GRADE) {
    return true;
  }

  return progress.fragments >= remainingFragmentCost(reward.kind, progress.grade);
}

/** How a collectible find lands: as the item, as fragments, or as selenite. */
export type CollectibleArrival = "item" | "fragments" | "selenite";

export function collectibleArrival(state: GameState, reward: CacheReward): CollectibleArrival {
  if (!isDuplicateReward(state, reward)) {
    return "item";
  }

  return isEffectivelyMaxed(state, reward) ? "selenite" : "fragments";
}

export function describeCacheReward(state: GameState, reward: CacheReward): string {
  const name =
    reward.kind === "trinket"
      ? (TRINKETS[reward.trinketId]?.displayName ?? reward.trinketId)
      : (TOTEMS[reward.totemId]?.displayName ?? reward.totemId);

  switch (collectibleArrival(state, reward)) {
    case "item":
      return name;
    case "fragments":
      return `${ECONOMY.fragmentsPerDuplicate} ${name} fragment${
        ECONOMY.fragmentsPerDuplicate === 1 ? "" : "s"
      }`;
    default:
      // Named, or "1 selenite" alone leaves the drawn collectible unaccounted for.
      return `${ECONOMY.selenitePerMaxedDuplicate} selenite (${name} is maxed)`;
  }
}

/** Fragments needed to move a totem from its current rank to the next. */
export function totemUpgradeCost(grade: GradeId): number | null {
  return ECONOMY.totemFragmentCosts[gradeIndex(grade)] ?? null;
}

export function planTotemUpgrade(state: GameState, totemId: TotemId): CollectionPlan {
  const progress = state.collection.totems[totemId];

  if (progress === undefined || !progress.owned) {
    return { ok: false, block: { kind: "not-owned" } };
  }

  const upgraded = nextGrade(progress.grade);

  if (upgraded === null) {
    return { ok: false, block: { kind: "max-grade" } };
  }

  const required = totemUpgradeCost(progress.grade);

  if (required === null) {
    return { ok: false, block: { kind: "max-grade" } };
  }

  if (progress.fragments < required) {
    return {
      ok: false,
      block: { kind: "insufficient-fragments", available: progress.fragments, required },
    };
  }

  return {
    ok: true,
    plan: {
      label: `upgrade-totem:${totemId}`,
      costs: [],
      grants: [],
      inventoryMutations: [{ kind: "totemFragments", totemId, delta: -required }],
      stateMutations: [
        (current) => ({
          ...current,
          collection: {
            ...current.collection,
            totems: {
              ...current.collection.totems,
              [totemId]: { ...current.collection.totems[totemId], grade: upgraded },
            },
          },
        }),
      ],
    },
  };
}

/** What one opened cache produced, in the order it was opened. */
export interface CacheOpenResult {
  cacheTypeId: CacheTypeId;
  reward: CacheReward;
  /** The item, fragments, or selenite — decided before the grant landed. */
  arrival: CollectibleArrival;
}

export interface CacheOpenBatch {
  cacheTypeId: CacheTypeId;
  results: CacheOpenResult[];
  /** How many were asked for but could not be opened, so the panel can say. */
  shortfall: number;
}

/**
 * Opens exactly one cache, returning the next state and what came out. Emits no
 * effects: the caller decides how many to open and reports once at the end.
 */
function openOne(
  state: GameState,
  cacheTypeId: CacheTypeId,
):
  | { ok: true; state: GameState; result: CacheOpenResult }
  | { ok: false; block: CollectionBlock } {
  const type = CACHE_TYPES[cacheTypeId];

  if (state.resources.keys < 1) {
    return { ok: false, block: { kind: "no-key" } };
  }

  if (state.resources[type.resourceId] < 1) {
    return { ok: false, block: { kind: "no-cache" } };
  }

  // Both kinds draw from the same stream: only the weights differ, so a second
  // stream would buy nothing and add a field to every save.
  const draw = nextWeighted(
    state.random.cacheRewards,
    type.rewards.map((entry) => ({ value: entry, weight: entry.weight })),
  );

  if (draw.value === null) {
    return { ok: false, block: { kind: "no-reward-available" } };
  }

  const entry = draw.value;
  // Decided before the grant lands, so it reports what was received rather than
  // what the state looks like afterwards.
  const arrival = collectibleArrival(state, entry.reward);

  const plan: TransactionPlan = {
    label: `open-cache:${cacheTypeId}:${entry.id}`,
    costs: [
      { resource: "keys", amount: 1 },
      { resource: type.resourceId, amount: 1 },
    ],
    grants: [],
    stateMutations: [
      (current) =>
        grantCollectible(
          {
            ...current,
            random: { ...current.random, cacheRewards: draw.state },
            statistics: {
              ...current.statistics,
              cachesOpened: current.statistics.cachesOpened + 1,
            },
          },
          entry.reward,
        ),
    ],
  };

  const outcome = applyTransaction(state, plan);

  if (!outcome.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: outcome.message } };
  }

  return { ok: true, state: outcome.state, result: { cacheTypeId, reward: entry.reward, arrival } };
}

/**
 * The most caches one command will open. A maxed save holds trillions of keys
 * and caches, so "open all" needs a bound; the panel reports what is left.
 */
export const MAXIMUM_CACHE_BATCH = 100;

/**
 * Opens up to `quantity` caches of one kind, sequentially rather than as one
 * combined transaction: each open depends on the state the previous one left,
 * since a second copy is fragments only because the first made it owned.
 *
 * Each open is atomic on its own, so a refusal part-way through stops cleanly
 * with everything before it applied and `shortfall` says how many did not happen.
 */
export function openCaches(
  state: GameState,
  cacheTypeId: CacheTypeId = STANDARD_CACHE_TYPE_ID,
  quantity = 1,
): CollectionOutcome {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, block: { kind: "invalid-quantity" } };
  }

  const wanted = Math.min(quantity, MAXIMUM_CACHE_BATCH);
  const results: CacheOpenResult[] = [];

  let current = state;
  let firstBlock: CollectionBlock | null = null;

  for (let index = 0; index < wanted; index += 1) {
    const opened = openOne(current, cacheTypeId);

    if (!opened.ok) {
      firstBlock = opened.block;
      break;
    }

    current = opened.state;
    results.push(opened.result);
  }

  // Nothing opened at all is a refusal, and the player is told why.
  if (results.length === 0) {
    return { ok: false, block: firstBlock ?? { kind: "no-cache" } };
  }

  const batch: CacheOpenBatch = {
    cacheTypeId,
    results,
    shortfall: wanted - results.length,
  };

  return {
    ok: true,
    state: current,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.cache.open" },
      { type: "SHOW_CACHE_RESULTS", batch },
      // One line for the batch rather than twenty near-identical entries. A
      // single open still names what it produced.
      {
        type: "SHOW_FEEDBACK",
        tone: "positive",
        message:
          results.length === 1
            ? `Cache opened: ${describeCacheReward(state, results[0].reward)}.`
            : `Opened ${String(results.length)} ${CACHE_TYPES[cacheTypeId].displayName.toLowerCase()}s.`,
      },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

/** The largest batch the player could actually open right now. */
export function openableCacheCount(state: GameState, cacheTypeId: CacheTypeId): number {
  return Math.min(
    MAXIMUM_CACHE_BATCH,
    state.resources.keys,
    state.resources[CACHE_TYPES[cacheTypeId].resourceId],
  );
}

/**
 * Equips or clears one of the three active totem slots. The same totem may not
 * occupy two slots, and the loadout cannot change during a run.
 */
export function planTotemEquip(
  state: GameState,
  slotIndex: number,
  totemId: TotemId | null,
): CollectionPlan {
  if (state.expedition.status !== "surface") {
    return { ok: false, block: { kind: "expedition-active" } };
  }

  if (
    !Number.isInteger(slotIndex) ||
    slotIndex < 0 ||
    slotIndex >= ECONOMY.activeTotemSlots
  ) {
    return { ok: false, block: { kind: "slot-out-of-range" } };
  }

  if (totemId !== null) {
    if (!state.collection.totems[totemId]?.owned) {
      return { ok: false, block: { kind: "not-owned" } };
    }

    const occupiedElsewhere = state.collection.activeTotemIds.some(
      (id, index) => index !== slotIndex && id === totemId,
    );

    if (occupiedElsewhere) {
      return { ok: false, block: { kind: "already-equipped" } };
    }
  }

  return {
    ok: true,
    plan: {
      label: `equip-totem:${slotIndex}:${totemId ?? "none"}`,
      costs: [],
      grants: [],
      stateMutations: [
        (current) => {
          const slots = [...current.collection.activeTotemIds];
          slots[slotIndex] = totemId;

          return { ...current, collection: { ...current.collection, activeTotemIds: slots } };
        },
      ],
    },
  };
}

/**
 * Rounds to two significant figures. The price is derived from income, which
 * moves on its own, so quantising keeps the number still while the player reads
 * it rather than ticking as they decide.
 */
function quantisePrice(value: number): number {
  if (value <= 0) {
    return 0;
  }

  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);

  return Math.round(value / magnitude) * magnitude;
}

/**
 * What a cache costs right now: a fixed number of seconds of current income, and
 * the only place that price is computed, so the store view and the purchase plan
 * cannot disagree. Floored at a multiple of a key, or a starting income would
 * make a cache cheaper than the key that opens it.
 */
export function cachePrice(
  state: GameState,
  cashPerSecond: number,
  cacheTypeId: CacheTypeId = STANDARD_CACHE_TYPE_ID,
): number {
  const income = Number.isFinite(cashPerSecond) ? Math.max(0, cashPerSecond) : 0;
  // A deep cache is priced as a multiple of the ordinary one rather than on a
  // curve of its own.
  const multiple = cacheTypeId === DEEP_CACHE_TYPE_ID ? ECONOMY.deepCacheCashMultiple : 1;

  return Math.max(
    ECONOMY.keyCashCost * ECONOMY.cacheMinimumKeyMultiple * multiple,
    quantisePrice(income * ECONOMY.cacheIncomeSeconds * multiple),
  );
}

/** The gate width and the stamp each cache kind is paced by. */
function cacheGateOf(cacheTypeId: CacheTypeId): {
  depths: number;
  stampOf: (state: GameState) => number;
  stamp: (state: GameState, at: number) => GameState;
} {
  if (cacheTypeId === DEEP_CACHE_TYPE_ID) {
    return {
      depths: ECONOMY.depthsPerDeepCachePurchase,
      stampOf: (state) => state.purchase.depthAtLastDeepCachePurchase,
      stamp: (state, at) => ({
        ...state,
        purchase: { ...state.purchase, depthAtLastDeepCachePurchase: at },
      }),
    };
  }

  return {
    depths: ECONOMY.depthsPerCachePurchase,
    stampOf: (state) => state.purchase.depthAtLastCachePurchase,
    stamp: (state, at) => ({
      ...state,
      purchase: { ...state.purchase, depthAtLastCachePurchase: at },
    }),
  };
}

export interface CachePurchaseAvailability {
  price: number;
  depthsRequired: number;
  depthsRemaining: number;
  affordable: boolean;
}

export function describeCachePurchase(
  state: GameState,
  cashPerSecond: number,
  cacheTypeId: CacheTypeId = STANDARD_CACHE_TYPE_ID,
): CachePurchaseAvailability {
  const gate = cacheGateOf(cacheTypeId);
  const since = state.statistics.depthDescended - gate.stampOf(state);
  const price = cachePrice(state, cashPerSecond, cacheTypeId);

  return {
    price,
    depthsRequired: gate.depths,
    depthsRemaining: Math.max(0, gate.depths - since),
    affordable: state.resources.cash >= price,
  };
}

/**
 * What a cache of either kind costs in chips. Flat: the cash price paces
 * collectibles through a restock schedule, while this is buying one off the
 * floor, limited only by how many chips the player will spend.
 */
export function cacheChipPrice(cacheTypeId: CacheTypeId): number {
  return cacheTypeId === DEEP_CACHE_TYPE_ID
    ? ECONOMY.deepCacheChipCost
    : ECONOMY.cacheChipCost;
}

/** Buys caches with chips: no gate, no restock, however many are affordable. */
export function planCacheChipPurchase(
  state: GameState,
  cacheTypeId: CacheTypeId,
  quantity: number,
): CollectionPlan {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, block: { kind: "invalid-quantity" } };
  }

  const cost = cacheChipPrice(cacheTypeId) * quantity;

  if (state.resources.chips < cost) {
    return {
      ok: false,
      block: {
        kind: "insufficient-resources",
        missing: [{ resource: "chips", amount: cost - state.resources.chips }],
      },
    };
  }

  return {
    ok: true,
    plan: {
      label: `buy-cache-chips:${cacheTypeId}:${String(quantity)}`,
      costs: [{ resource: "chips", amount: cost }],
      grants: [{ resource: CACHE_TYPES[cacheTypeId].resourceId, amount: quantity }],
    },
  };
}

/**
 * The largest quantity of something the player could pay for right now. Computed
 * here rather than in the panel, so the "Max" button and the charge agree.
 */
export function affordableQuantity(balance: number, unitPrice: number): number {
  if (unitPrice <= 0 || balance <= 0) {
    return 0;
  }

  // An infinite balance affords any amount, so the answer must still be a number.
  return Number.isFinite(balance) ? Math.floor(balance / unitPrice) : DEV_BULK_LIMIT;
}

/** The most any one bulk purchase will buy, so an infinite balance has an answer. */
export const DEV_BULK_LIMIT = 1_000;

/**
 * Buys one cache with cash, gated to once per configured number of completed
 * runs so it paces collectibles rather than replacing the expedition find.
 */
export function planCachePurchase(
  state: GameState,
  cashPerSecond: number,
  cacheTypeId: CacheTypeId = STANDARD_CACHE_TYPE_ID,
): CollectionPlan {
  const availability = describeCachePurchase(state, cashPerSecond, cacheTypeId);

  if (availability.depthsRemaining > 0) {
    return {
      ok: false,
      block: {
        kind: "depths-required",
        required: availability.depthsRequired,
        remaining: availability.depthsRemaining,
      },
    };
  }

  if (!availability.affordable) {
    return {
      ok: false,
      block: {
        kind: "insufficient-resources",
        missing: [{ resource: "cash", amount: availability.price - state.resources.cash }],
      },
    };
  }

  // Stamped to the counter's value now rather than advanced by the gate width,
  // so distance cannot bank up into several caches at once.
  const stampedAt = state.statistics.depthDescended;

  return {
    ok: true,
    plan: {
      label: `buy-cache:${cacheTypeId}`,
      costs: [{ resource: "cash", amount: availability.price }],
      grants: [{ resource: CACHE_TYPES[cacheTypeId].resourceId, amount: 1 }],
      stateMutations: [(current) => cacheGateOf(cacheTypeId).stamp(current, stampedAt)],
    },
  };
}
