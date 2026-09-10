/**
 * The single boundary through which every cost and grant passes. A transaction
 * verifies the whole plan before mutating anything, so a partial apply is
 * impossible and balances can never go negative.
 */

import { ECONOMY, RESOURCE_IDS } from "../content/catalog";
import type { MachineId, ResourceId, TotemId, TrinketId } from "../content/catalog";
import { addQuantity, isFiniteQuantity, isSafeQuantity } from "./numbers";
import type { GameState } from "./state";

export interface ResourceDelta {
  resource: ResourceId;
  amount: number;
}

export type InventoryMutation =
  | { kind: "trinketFragments"; trinketId: TrinketId; delta: number }
  | { kind: "recipePieces"; machineId: MachineId; delta: number }
  | { kind: "totemFragments"; totemId: TotemId; delta: number };

/** A pure follow-up applied only after costs and grants have been verified. */
export type StateMutation = (state: GameState) => GameState;

export interface TransactionPlan {
  label: string;
  costs: ResourceDelta[];
  grants: ResourceDelta[];
  inventoryMutations?: InventoryMutation[];
  stateMutations?: StateMutation[];
}

export type TransactionFailureReason =
  | "unknown-resource"
  | "invalid-amount"
  | "insufficient-resource"
  | "unknown-item"
  | "insufficient-item"
  | "numeric-bounds";

export type TransactionOutcome =
  | { ok: true; state: GameState; transactionId: string; plan: TransactionPlan }
  | { ok: false; reason: TransactionFailureReason; message: string };

const RESOURCE_ID_SET = new Set<string>(RESOURCE_IDS);

let transactionCounter = 0;

function nextTransactionId(label: string): string {
  transactionCounter += 1;

  return `${label}#${transactionCounter}`;
}

/** Exposed so tests can assert on a stable sequence. */
export function resetTransactionCounter(): void {
  transactionCounter = 0;
}

function validateDeltas(
  deltas: readonly ResourceDelta[],
  role: "cost" | "grant",
): { reason: TransactionFailureReason; message: string } | null {
  for (const delta of deltas) {
    if (!RESOURCE_ID_SET.has(delta.resource)) {
      return {
        reason: "unknown-resource",
        message: `Unknown resource "${delta.resource}" in a ${role}.`,
      };
    }

    if (!isFiniteQuantity(delta.amount)) {
      return {
        reason: "invalid-amount",
        message: `The ${role} for ${delta.resource} must be a non-negative integer within safe bounds (received ${String(delta.amount)}).`,
      };
    }
  }

  return null;
}

function totalByResource(deltas: readonly ResourceDelta[]): Map<ResourceId, number> {
  const totals = new Map<ResourceId, number>();

  for (const delta of deltas) {
    totals.set(delta.resource, (totals.get(delta.resource) ?? 0) + delta.amount);
  }

  return totals;
}

export function canAfford(state: GameState, costs: readonly ResourceDelta[]): boolean {
  if (validateDeltas(costs, "cost") !== null) {
    return false;
  }

  for (const [resource, amount] of totalByResource(costs)) {
    if (state.resources[resource] < amount) {
      return false;
    }
  }

  return true;
}

/** Costs the player cannot currently pay, for disabled-state messaging. */
export function unmetCosts(state: GameState, costs: readonly ResourceDelta[]): ResourceDelta[] {
  const unmet: ResourceDelta[] = [];

  for (const [resource, amount] of totalByResource(costs)) {
    const shortfall = amount - state.resources[resource];

    if (shortfall > 0) {
      unmet.push({ resource, amount: shortfall });
    }
  }

  return unmet;
}

function applyInventoryMutation(
  state: GameState,
  mutation: InventoryMutation,
): { ok: true; state: GameState } | { ok: false; reason: TransactionFailureReason; message: string } {
  switch (mutation.kind) {
    case "trinketFragments": {
      const trinket = state.collection.trinkets[mutation.trinketId];

      if (trinket === undefined) {
        return {
          ok: false,
          reason: "unknown-item",
          message: `Unknown trinket "${mutation.trinketId}".`,
        };
      }

      if (!Number.isInteger(mutation.delta)) {
        return {
          ok: false,
          reason: "invalid-amount",
          message: `Fragment counts must be integers (received ${String(mutation.delta)}).`,
        };
      }

      const next = trinket.fragments + mutation.delta;

      if (!isSafeQuantity(next)) {
        return {
          ok: false,
          reason: next < 0 ? "insufficient-item" : "numeric-bounds",
          message: `Fragments for "${mutation.trinketId}" cannot move to ${String(next)}.`,
        };
      }

      return {
        ok: true,
        state: {
          ...state,
          collection: {
            ...state.collection,
            trinkets: {
              ...state.collection.trinkets,
              [mutation.trinketId]: { ...trinket, fragments: next },
            },
          },
        },
      };
    }

    case "recipePieces": {
      const machine = state.casino.machines[mutation.machineId];

      if (machine === undefined) {
        return {
          ok: false,
          reason: "unknown-item",
          message: `Unknown machine "${mutation.machineId}".`,
        };
      }

      const next = machine.recipePieces + mutation.delta;

      if (!isSafeQuantity(next)) {
        return {
          ok: false,
          reason: next < 0 ? "insufficient-item" : "numeric-bounds",
          message: `Recipe pieces for "${mutation.machineId}" cannot move to ${String(next)}.`,
        };
      }

      return {
        ok: true,
        state: {
          ...state,
          casino: {
            ...state.casino,
            machines: {
              ...state.casino.machines,
              [mutation.machineId]: { ...machine, recipePieces: next },
            },
          },
        },
      };
    }

    case "totemFragments": {
      const totem = state.collection.totems[mutation.totemId];

      if (totem === undefined) {
        return {
          ok: false,
          reason: "unknown-item",
          message: `Unknown totem "${mutation.totemId}".`,
        };
      }

      const next = totem.fragments + mutation.delta;

      if (!isSafeQuantity(next)) {
        return {
          ok: false,
          reason: next < 0 ? "insufficient-item" : "numeric-bounds",
          message: `Fragments for "${mutation.totemId}" cannot move to ${String(next)}.`,
        };
      }

      return {
        ok: true,
        state: {
          ...state,
          collection: {
            ...state.collection,
            totems: {
              ...state.collection.totems,
              [mutation.totemId]: { ...totem, fragments: next },
            },
          },
        },
      };
    }

    default: {
      const exhaustive: never = mutation;

      return {
        ok: false,
        reason: "unknown-item",
        message: `Unhandled inventory mutation ${JSON.stringify(exhaustive)}.`,
      };
    }
  }
}

export function applyTransaction(state: GameState, plan: TransactionPlan): TransactionOutcome {
  const costIssue = validateDeltas(plan.costs, "cost");

  if (costIssue !== null) {
    return { ok: false, ...costIssue };
  }

  const grantIssue = validateDeltas(plan.grants, "grant");

  if (grantIssue !== null) {
    return { ok: false, ...grantIssue };
  }

  const costTotals = totalByResource(plan.costs);
  const grantTotals = totalByResource(plan.grants);

  // Verify every cost before applying anything.
  for (const [resource, amount] of costTotals) {
    if (state.resources[resource] < amount) {
      return {
        ok: false,
        reason: "insufficient-resource",
        message: `${plan.label} needs ${amount} ${resource} but only ${state.resources[resource]} is available.`,
      };
    }
  }

  const resources = { ...state.resources };

  for (const [resource, amount] of costTotals) {
    resources[resource] -= amount;
  }

  // A grant past the ceiling rolls the balance over to `INF` rather than being
  // refused, which would make a saturated floor silently stop paying.
  for (const [resource, amount] of grantTotals) {
    resources[resource] = addQuantity(resources[resource], amount);
  }

  for (const resource of RESOURCE_IDS) {
    if (!isSafeQuantity(resources[resource])) {
      return {
        ok: false,
        reason: "numeric-bounds",
        message: `${plan.label} left ${resource} at ${String(resources[resource])}.`,
      };
    }
  }

  // Spending is counted here rather than at each purchase site, so a new kind of
  // purchase cannot forget to report itself. Only cash and chips, the two
  // currencies a player spends continuously.
  const cashSpent = costTotals.get("cash") ?? 0;
  const chipsSpent = costTotals.get("chips") ?? 0;

  let nextState: GameState = {
    ...state,
    resources,
    statistics:
      cashSpent === 0 && chipsSpent === 0
        ? state.statistics
        : {
            ...state.statistics,
            cashSpent: state.statistics.cashSpent + cashSpent,
            chipsSpent: state.statistics.chipsSpent + chipsSpent,
          },
  };

  for (const mutation of plan.inventoryMutations ?? []) {
    const outcome = applyInventoryMutation(nextState, mutation);

    if (!outcome.ok) {
      return outcome;
    }

    nextState = outcome.state;
  }

  for (const mutation of plan.stateMutations ?? []) {
    nextState = mutation(nextState);
  }

  return {
    ok: true,
    state: nextState,
    transactionId: nextTransactionId(plan.label),
    plan,
  };
}

/** Convenience for the common single-resource grant. */
export function grantResource(resource: ResourceId, amount: number): ResourceDelta[] {
  return amount > 0 ? [{ resource, amount }] : [];
}

export const SAFE_MAXIMUM = ECONOMY.safeMaximum;
