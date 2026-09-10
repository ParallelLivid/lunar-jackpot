/**
 * The miner's look: which skins are owned, and which one is worn. Separate from
 * `cats.ts` because a cat skin is drawn at random and belongs to an instance,
 * while the miner's is chosen and belongs to the save. Presentation only —
 * nothing here affects a run.
 */

import { MINER_SKINS, type MinerSkinId } from "../content/minerSkins";
import type { CollectionPlan } from "./collections";
import type { GameState } from "./state";

export function ownsMinerSkin(state: GameState, skinId: MinerSkinId): boolean {
  return state.collection.ownedMinerSkinIds.includes(skinId);
}

/** Buys a miner skin with chips, through `applyTransaction` like every purchase. */
export function planMinerSkinPurchase(state: GameState, skinId: MinerSkinId): CollectionPlan {
  const definition = MINER_SKINS[skinId];

  if (definition === undefined || definition.chipCost === null) {
    // The default is owned from the start; there is nothing to sell.
    return { ok: false, block: { kind: "not-owned" } };
  }

  if (ownsMinerSkin(state, skinId)) {
    return { ok: false, block: { kind: "already-equipped" } };
  }

  return {
    ok: true,
    plan: {
      label: `buy-miner-skin:${skinId}`,
      costs: [{ resource: "chips", amount: definition.chipCost }],
      grants: [],
      inventoryMutations: [],
      stateMutations: [
        (current) => ({
          ...current,
          collection: {
            ...current.collection,
            // Bought, not worn: wearing it is a separate choice on the same tile.
            ownedMinerSkinIds: [...current.collection.ownedMinerSkinIds, skinId],
          },
        }),
      ],
    },
  };
}

/** Wears an owned skin. A skin that is not owned is refused rather than bought. */
export function planMinerSkinChange(state: GameState, skinId: MinerSkinId): CollectionPlan {
  if (MINER_SKINS[skinId] === undefined || !ownsMinerSkin(state, skinId)) {
    return { ok: false, block: { kind: "not-owned" } };
  }

  return {
    ok: true,
    plan: {
      label: `wear-miner-skin:${skinId}`,
      costs: [],
      grants: [],
      inventoryMutations: [],
      stateMutations: [
        (current) => ({
          ...current,
          collection: { ...current.collection, activeMinerSkinId: skinId },
        }),
      ],
    },
  };
}
