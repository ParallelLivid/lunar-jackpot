/**
 * Buying and spending consumables: a purchase through `applyTransaction`, and a
 * hand-off at launch that folds the held modifiers into the run snapshot and
 * empties the list in the same expression, so one can never happen without the
 * other.
 */

import { CONSUMABLES, consumableModifiers, type ConsumableId } from "../content/consumables";
import type { CollectionPlan } from "./collections";
import type { GameState } from "./state";

export function holdsConsumable(state: GameState, consumableId: ConsumableId): boolean {
  return state.heldConsumableIds.includes(consumableId);
}

export function planConsumablePurchase(
  state: GameState,
  consumableId: ConsumableId,
): CollectionPlan {
  const definition = CONSUMABLES[consumableId];

  if (definition === undefined) {
    return { ok: false, block: { kind: "not-owned" } };
  }

  // Not while a run is under way: the item affects the next run, and buying one
  // mid-run would look broken.
  if (state.expedition.status !== "surface") {
    return { ok: false, block: { kind: "expedition-active" } };
  }

  // Non-stackable, so a second one is refused rather than silently charged for.
  if (holdsConsumable(state, consumableId)) {
    return { ok: false, block: { kind: "already-equipped" } };
  }

  return {
    ok: true,
    plan: {
      label: `buy-consumable:${consumableId}`,
      costs: [{ resource: "chips", amount: definition.chipCost }],
      grants: [],
      inventoryMutations: [],
      stateMutations: [
        (current) => ({
          ...current,
          heldConsumableIds: [...current.heldConsumableIds, consumableId],
        }),
      ],
    },
  };
}

/**
 * What the held consumables contribute to a run about to launch. Returned rather
 * than applied, so `launchExpedition` folds them into the same modifier list it
 * builds the snapshot from and nothing downstream needs to know they exist.
 */
export function heldConsumableModifiers(state: GameState) {
  return consumableModifiers(state.heldConsumableIds);
}
