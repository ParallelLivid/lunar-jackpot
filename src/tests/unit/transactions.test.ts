import { beforeEach, describe, expect, it } from "vitest";
import { ECONOMY } from "../../content/catalog";
import { INFINITE } from "../../domain/numbers";
import { createGameState } from "../../domain/state";
import {
  applyTransaction,
  canAfford,
  resetTransactionCounter,
  unmetCosts,
} from "../../domain/transactions";

function freshState() {
  const state = createGameState({ nowUnixMs: 1_000, seed: 7 });

  return {
    ...state,
    resources: { ...state.resources, cash: 100, chips: 40, components: 3 },
  };
}

describe("transactions", () => {
  beforeEach(() => {
    resetTransactionCounter();
  });

  it("allows an exact-cost purchase and leaves zero", () => {
    const outcome = applyTransaction(freshState(), {
      label: "exact",
      costs: [{ resource: "cash", amount: 100 }],
      grants: [],
    });

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.resources.cash).toBe(0);
      expect(outcome.transactionId).toBe("exact#1");
    }
  });

  it("changes nothing when one cost of several is unaffordable", () => {
    const state = freshState();
    const outcome = applyTransaction(state, {
      label: "multi",
      costs: [
        { resource: "cash", amount: 100 },
        { resource: "components", amount: 4 },
      ],
      grants: [],
    });

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.reason).toBe("insufficient-resource");
    }

    expect(state.resources.cash).toBe(100);
    expect(state.resources.components).toBe(3);
  });

  it("rejects negative, fractional, and non-finite amounts", () => {
    const state = freshState();

    for (const amount of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = applyTransaction(state, {
        label: "bad",
        costs: [{ resource: "cash", amount }],
        grants: [],
      });

      expect(outcome.ok).toBe(false);
    }
  });

  it("rejects unknown resources", () => {
    const outcome = applyTransaction(freshState(), {
      label: "unknown",
      costs: [],
      grants: [{ resource: "ore" as never, amount: 1 }],
    });

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.reason).toBe("unknown-resource");
    }
  });

  it("rolls a balance over to INF rather than refusing the grant", () => {
    /*
     * The old behaviour was to refuse, which meant a saturated balance made every
     * machine silently stop paying — a finished game that reads as a broken one.
     * Past the ceiling there is no number left worth keeping, so the total stops
     * counting and says so.
     */
    const base = freshState();
    const brimming = {
      ...base,
      resources: { ...base.resources, cash: ECONOMY.safeMaximum },
    };

    const outcome = applyTransaction(brimming, {
      label: "rollover",
      costs: [],
      grants: [{ resource: "cash", amount: 1 }],
    });

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.resources.cash).toBe(INFINITE);
    }
  });

  it("keeps an infinite balance infinite, and affords anything from it", () => {
    // Every comparison does the right thing on its own, which is the whole
    // reason this is a real `Infinity` rather than a flag beside the number.
    const base = freshState();
    const endless = { ...base, resources: { ...base.resources, cash: INFINITE } };

    const spent = applyTransaction(endless, {
      label: "spend",
      costs: [{ resource: "cash", amount: 1_000_000 }],
      grants: [],
    });

    expect(spent.ok).toBe(true);
    expect(spent.ok && spent.state.resources.cash).toBe(INFINITE);
  });

  it("refuses a grant that claims to be infinite", () => {
    // A *total* may roll over; a single payout may not claim to. Otherwise any
    // one reward could end the economy in a step.
    const outcome = applyTransaction(freshState(), {
      label: "absurd",
      costs: [],
      grants: [{ resource: "cash", amount: INFINITE }],
    });

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.reason).toBe("invalid-amount");
    }
  });

  it("refuses to drive an item count below zero", () => {
    const outcome = applyTransaction(freshState(), {
      label: "items",
      costs: [],
      grants: [],
      inventoryMutations: [{ kind: "trinketFragments", trinketId: "trinket.bladder", delta: -1 }],
    });

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.reason).toBe("insufficient-item");
    }
  });

  it("reports affordability and the exact shortfall", () => {
    const state = freshState();

    expect(canAfford(state, [{ resource: "cash", amount: 100 }])).toBe(true);
    expect(canAfford(state, [{ resource: "cash", amount: 101 }])).toBe(false);
    expect(unmetCosts(state, [{ resource: "chips", amount: 55 }])).toEqual([
      { resource: "chips", amount: 15 },
    ]);
  });
});
