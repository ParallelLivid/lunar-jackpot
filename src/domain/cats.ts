/**
 * Cats, as owned things rather than as a number: which skin each cat wears,
 * which skins are owned, and the commands that change either.
 * `statistics.catsFound` remains the authority for the luck bonus.
 *
 * The count and `collection.cats` must not drift. They are kept in step in the
 * cat-met branch of `expedition.ts`, which appends as it increments, and in
 * `reconcileCats` below, which repairs a mismatch on load.
 */

import { CAT_SKINS, DEFAULT_CAT_SKIN_IDS, type CatSkinId } from "../content/catSkins";
import type { CollectionBlock, CollectionPlan } from "./collections";
import type { CatRecord, GameState } from "./state";

export type CatBlock = CollectionBlock;

/**
 * Forces `collection.cats` to hold exactly `catsFound` entries, filling missing
 * ones with default skins rather than dropping them. Deterministic, because it
 * runs on load and a save must not change when it is read; the migration passes
 * its own draws in where a random assignment is wanted.
 */
export function reconcileCats(
  cats: CatRecord[],
  catsFound: number,
  ownedSkinIds: CatSkinId[] = DEFAULT_CAT_SKIN_IDS,
): CatRecord[] {
  if (cats.length === catsFound) {
    return cats;
  }

  if (cats.length > catsFound) {
    return cats.slice(0, catsFound);
  }

  const pool = ownedSkinIds.length > 0 ? ownedSkinIds : DEFAULT_CAT_SKIN_IDS;

  return [
    ...cats,
    ...Array.from({ length: catsFound - cats.length }, (_, index) => ({
      // Cycled rather than drawn, so the fill is stable across loads and a
      // player who never met these cats still gets a varied shelf.
      skinId: pool[(cats.length + index) % pool.length],
    })),
  ];
}

export function ownsCatSkin(state: GameState, skinId: CatSkinId): boolean {
  return state.collection.ownedCatSkinIds.includes(skinId);
}

/** Buys a skin with chips, through `applyTransaction` like every other purchase. */
export function planCatSkinPurchase(state: GameState, skinId: CatSkinId): CollectionPlan {
  const definition = CAT_SKINS[skinId];

  if (definition === undefined || definition.chipCost === null) {
    // A default skin is owned from the start; there is nothing to sell.
    return { ok: false, block: { kind: "not-owned" } };
  }

  if (ownsCatSkin(state, skinId)) {
    return { ok: false, block: { kind: "already-equipped" } };
  }

  return {
    ok: true,
    plan: {
      label: `buy-cat-skin:${skinId}`,
      costs: [{ resource: "chips", amount: definition.chipCost }],
      grants: [],
      inventoryMutations: [],
      stateMutations: [
        (current) => ({
          ...current,
          collection: {
            ...current.collection,
            // Added to the pool and nothing else: buying a skin does not re-dress
            // a cat already met.
            ownedCatSkinIds: [...current.collection.ownedCatSkinIds, skinId],
          },
        }),
      ],
    },
  };
}

/**
 * Advances one cat to the next skin it is allowed to wear, cycling the owned
 * list in catalogue order. A cat wearing a skin that is not owned restarts from
 * the beginning rather than sticking.
 */
export function cycleCatSkin(state: GameState, index: number): CollectionPlan {
  const cats = state.collection.cats;

  if (!Number.isInteger(index) || index < 0 || index >= cats.length) {
    return { ok: false, block: { kind: "slot-out-of-range" } };
  }

  const owned = state.collection.ownedCatSkinIds;

  if (owned.length === 0) {
    return { ok: false, block: { kind: "not-owned" } };
  }

  const position = owned.indexOf(cats[index].skinId);
  const nextSkinId = owned[(position + 1) % owned.length];

  return {
    ok: true,
    plan: {
      label: `cycle-cat-skin:${String(index)}`,
      costs: [],
      grants: [],
      inventoryMutations: [],
      stateMutations: [
        (current) => ({
          ...current,
          collection: {
            ...current.collection,
            cats: current.collection.cats.map((cat, position2) =>
              position2 === index ? { ...cat, skinId: nextSkinId } : cat,
            ),
          },
        }),
      ],
    },
  };
}
