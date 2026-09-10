/**
 * Coverage for the depth wager.
 *
 * The first thing in the game that couples the casino to the expedition, and the
 * design is shaped by one exploit: betting *under* is free money, won by
 * launching and banking immediately. So the wager is over-only, and the tests
 * that matter are the ones guarding the two edges the plan named — a price that
 * could be re-derived after the fact, and a wager that never resolves.
 *
 * This is also where the shared run-status surface is proved to hold three
 * commitments at once, which is what chunk 11 built it for.
 */

import { describe, expect, it } from "vitest";
import { CONTRACTS, ECONOMY } from "../../content/catalog";
import type { ContractId, ExpeditionModifierId } from "../../content/catalog";
import {
  baseWagerMultiplier,
  maximumWagerTarget,
  minimumWagerTarget,
  offeredWagerMultiplier,
  settleDepthWager,
  wagerReferenceDepth,
  wagerSuccessProbability,
} from "../../domain/depthWager";
import { maximumAttainableLuck } from "../../dev/simulations/gambling";
import { reduce } from "../../domain/reducer";
import { bankingLockedUntil } from "../../domain/expedition";
import {
  deriveContext,
  selectDepthWagerView,
  selectRailAttention,
  selectRunCommitments,
} from "../../domain/selectors";
import { createGameState, type DepthWager, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;
const MAXIMUM_LUCK = maximumAttainableLuck();
const CONTRACT: ContractId = "contract.core-sample";
const SEALED: ExpeditionModifierId = "modifier.sealed-orders";

function fresh(chips = 100_000, deepestDepth = 40, seed = 51): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });

  return {
    ...base,
    resources: { ...base.resources, chips },
    statistics: { ...base.statistics, deepestDepth, deepestDepthThisCycle: deepestDepth },
  };
}

function withPending(state: GameState, wager: Partial<DepthWager> = {}): GameState {
  return {
    ...state,
    gambling: {
      ...state.gambling,
      depthWager: {
        ...state.gambling.depthWager,
        pending: {
          wagerId: "wager-1",
          stake: 1_000,
          targetDepth: 30,
          multiplier: 4,
          bestDepthAtPlacement: 40,
          luckPoints: 0,
          ...wager,
        },
      },
    },
  };
}

describe("the published curve", () => {
  it("falls continuously and never reaches zero or one", () => {
    let previous = Number.POSITIVE_INFINITY;

    for (let target = 1; target <= 120; target += 1) {
      const chance = wagerSuccessProbability(target, 40);

      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThanOrEqual(1);
      expect(chance).toBeLessThan(previous);
      previous = chance;
    }
  });

  it("prices a personal best at the configured probability", () => {
    // The whole curve is anchored here: reaching your own all-time best again.
    expect(wagerSuccessProbability(40, 40)).toBeCloseTo(ECONOMY.depthWagerBestProbability, 9);
    expect(wagerSuccessProbability(100, 100)).toBeCloseTo(ECONOMY.depthWagerBestProbability, 9);
  });

  it("matches the multiplier the panel publishes, at every offered target", () => {
    const reference = 40;

    for (
      let target = minimumWagerTarget(reference);
      target <= maximumWagerTarget(reference);
      target += 1
    ) {
      const chance = wagerSuccessProbability(target, reference);
      const expected = Math.min(
        ECONOMY.depthWagerMaximumMultiplier,
        ECONOMY.depthWagerBaseReturn / chance,
      );

      expect(baseWagerMultiplier(target, reference)).toBeCloseTo(expected, 9);
    }
  });

  it("floors the reference depth so a fresh save cannot bet on depth one", () => {
    /*
     * Without the floor, `best` on a brand-new save is 1 and the very first
     * encounter of the game wins a wager priced as though it were a record.
     */
    const brandNew = fresh(1_000, 0);

    expect(wagerReferenceDepth(brandNew)).toBe(ECONOMY.depthWagerReferenceFloor);
    expect(minimumWagerTarget(wagerReferenceDepth(brandNew))).toBeGreaterThan(1);
  });

  it("refuses to price a bet it would nearly always lose", () => {
    const reference = 40;
    const minimum = minimumWagerTarget(reference);

    expect(baseWagerMultiplier(minimum, reference)).toBeGreaterThanOrEqual(
      ECONOMY.depthWagerMinimumMultiplier,
    );
    expect(baseWagerMultiplier(minimum - 1, reference)).toBeLessThan(
      ECONOMY.depthWagerMinimumMultiplier,
    );
  });
});

describe("luck shades the price, and the cap holds it", () => {
  it("keeps the expected return inside the cap across the whole target range", () => {
    const reference = 40;

    for (const [label, luckPoints, modifiers] of [
      ["no luck", 0, []],
      ["typical luck", 120, []],
      ["maximum luck", MAXIMUM_LUCK.luckPoints, MAXIMUM_LUCK.modifiers],
    ] as const) {
      for (
        let target = minimumWagerTarget(reference);
        target <= maximumWagerTarget(reference);
        target += 1
      ) {
        const chance = wagerSuccessProbability(target, reference);
        const offered = offeredWagerMultiplier(target, reference, modifiers, luckPoints);

        expect(
          offered * chance,
          `${label} at depth ${String(target)} returned ${String(offered * chance)}`,
        ).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 1e-9);
      }
    }
  });

  it("improves the price with luck without ever improving the run", () => {
    const lucky = offeredWagerMultiplier(40, 40, MAXIMUM_LUCK.modifiers, MAXIMUM_LUCK.luckPoints);
    const plain = offeredWagerMultiplier(40, 40, [], 0);

    expect(lucky).toBeGreaterThan(plain);
    // The chance itself is untouched: luck already improves encounter draws, and
    // biasing the run would pay the player twice for the same stat.
    expect(wagerSuccessProbability(40, 40)).toBe(wagerSuccessProbability(40, 40));
  });
});

describe("placing a wager", () => {
  it("takes the stake and records the price at placement", () => {
    const before = fresh();
    const after = reduce(before, {
      type: "PLACE_DEPTH_WAGER",
      targetDepth: 40,
      stake: 1_000,
    }).state;
    const pending = after.gambling.depthWager.pending;

    expect(after.resources.chips).toBe(before.resources.chips - 1_000);
    expect(pending?.targetDepth).toBe(40);
    expect(pending?.bestDepthAtPlacement).toBe(40);
    expect(pending?.multiplier).toBeCloseTo(baseWagerMultiplier(40, 40), 6);
    expect(after.statistics.depthWagersPlaced).toBe(1);
    expect(after.statistics.chipsWagered).toBe(1_000);
  });

  it("refuses a second wager while one is pending", () => {
    const pending = withPending(fresh());
    const refused = reduce(pending, {
      type: "PLACE_DEPTH_WAGER",
      targetDepth: 40,
      stake: 250,
    });

    expect(refused.state.resources.chips).toBe(pending.resources.chips);
    expect(refused.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("cannot be placed mid-run", () => {
    /*
     * A bet placed part-way down is a bet on a run whose depth is already partly
     * known, which is the same free-money shape as betting under.
     */
    const running = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;
    const refused = reduce(running, {
      type: "PLACE_DEPTH_WAGER",
      targetDepth: 40,
      stake: 250,
    });

    expect(refused.state.gambling.depthWager.pending).toBeNull();
    expect(refused.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("refuses a target the house does not offer, on either side", () => {
    const state = fresh();
    const reference = wagerReferenceDepth(state);

    for (const target of [minimumWagerTarget(reference) - 1, maximumWagerTarget(reference) + 1]) {
      const refused = reduce(state, {
        type: "PLACE_DEPTH_WAGER",
        targetDepth: target,
        stake: 250,
      });

      expect(refused.state.gambling.depthWager.pending).toBeNull();
      expect(refused.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
    }
  });

  it("blocks prestige, because the reset would take the gear it was priced against", () => {
    const rich = withPending({
      ...fresh(),
      prestige: { ...fresh().prestige, cycleCashEarned: 1e9, lifetimeCashEarned: 1e9 },
    });

    expect(reduce(rich, { type: "PRESTIGE" }).state.prestige.count).toBe(0);
  });
});

describe("settling", () => {
  it("pays a met target on a run that came home", () => {
    const pending = withPending(fresh(), { targetDepth: 12, stake: 1_000, multiplier: 3 });
    const settled = settleDepthWager(pending, 15);

    expect(settled.summary?.won).toBe(true);
    expect(settled.summary?.payout).toBe(3_000);
    expect(settled.state.resources.chips).toBe(pending.resources.chips + 3_000);
    expect(settled.state.gambling.depthWager.pending).toBeNull();
    expect(settled.state.statistics.depthWagersWon).toBe(1);
  });

  it("pays a met target on a run that died past it", () => {
    /*
     * The bet is on depth reached, not on coming home. Failing at depth 40 still
     * wins a bet on depth 30 — ruled on directly, and it points the same way as
     * sealed orders and depth contracts.
     */
    const pending = withPending(fresh(), { targetDepth: 30, stake: 250, multiplier: 5 });
    const settled = settleDepthWager(pending, 40);

    expect(settled.summary?.won).toBe(true);
    expect(settled.state.resources.chips).toBe(pending.resources.chips + 1_250);
  });

  it("loses a target the run fell short of, and keeps nothing back", () => {
    const pending = withPending(fresh(), { targetDepth: 30, stake: 250, multiplier: 5 });
    const settled = settleDepthWager(pending, 29);

    expect(settled.summary?.won).toBe(false);
    expect(settled.summary?.payout).toBe(0);
    expect(settled.state.resources.chips).toBe(pending.resources.chips);
    expect(settled.state.gambling.depthWager.pending).toBeNull();
  });

  it("settles at the committed price even after the all-time best has moved", () => {
    /*
     * The edge that shapes the whole design: the record it was priced against
     * updates *during the run being bet on*, so a payout re-derived at
     * settlement would quietly shorten the odds on exactly the runs that won.
     */
    const pending = withPending(fresh(1_000, 40), {
      targetDepth: 40,
      stake: 1_000,
      multiplier: 2.71,
      bestDepthAtPlacement: 40,
    });
    const recordBroken: GameState = {
      ...pending,
      statistics: { ...pending.statistics, deepestDepth: 55, deepestDepthThisCycle: 55 },
    };

    const settled = settleDepthWager(recordBroken, 55);

    expect(settled.summary?.multiplier).toBe(2.71);
    expect(settled.summary?.payout).toBe(2_710);
  });

  it("survives a reload with its price intact", () => {
    const pending = withPending(fresh(), { multiplier: 7.25, targetDepth: 44 });
    const restored = normalizeGameState(
      JSON.parse(JSON.stringify(createEnvelope(pending, 1, NOW).game)) as unknown,
      NOW,
    ).state;

    expect(restored.gambling.depthWager.pending?.multiplier).toBe(7.25);
    expect(restored.gambling.depthWager.pending?.targetDepth).toBe(44);
  });

  it("waits for a run when one was never launched, and settles on the next", () => {
    // A wager placed and then left alone does not expire; it rides the next run
    // that actually finishes, which is exactly what the panel says it will do.
    const placed = reduce(fresh(), {
      type: "PLACE_DEPTH_WAGER",
      targetDepth: 40,
      stake: 250,
    }).state;

    const reloaded = normalizeGameState(
      JSON.parse(JSON.stringify(createEnvelope(placed, 1, NOW).game)) as unknown,
      NOW,
    ).state;

    expect(reloaded.gambling.depthWager.pending).not.toBeNull();

    const launched = reduce(reloaded, { type: "LAUNCH_EXPEDITION" }).state;

    expect(launched.gambling.depthWager.pending).not.toBeNull();

    const banked = reduce(
      { ...launched, expedition: { ...launched.expedition, status: "decision", depth: 41 } },
      { type: "RETURN_FROM_EXPEDITION" },
    ).state;

    expect(banked.gambling.depthWager.pending).toBeNull();
    expect(banked.gambling.depthWager.recentResults[0]?.won).toBe(true);
  });

  it("settles exactly once through a completed run", () => {
    const launched = reduce(withPending(fresh(), { targetDepth: 5, multiplier: 2 }), {
      type: "LAUNCH_EXPEDITION",
    }).state;
    const banked = reduce(
      { ...launched, expedition: { ...launched.expedition, status: "decision", depth: 9 } },
      { type: "RETURN_FROM_EXPEDITION" },
    ).state;

    expect(banked.gambling.depthWager.recentResults).toHaveLength(1);
    expect(banked.gambling.depthWager.pending).toBeNull();
  });
});

describe("the shared run-status surface", () => {
  it("shows a wager, a contract and a held exit together, each with its own tone", () => {
    /*
     * The case chunk 11 built the surface for and chunk 13 was asked to prove:
     * three separate systems live on one descent, each with a depth target, and
     * each meaning something different by it.
     */
    const launched = reduce(withPending(fresh(), { targetDepth: 30 }), {
      type: "LAUNCH_EXPEDITION",
    }).state;

    const loaded: GameState = {
      ...launched,
      expedition: {
        ...launched.expedition,
        status: "decision",
        depth: 6,
        activeModifierId: SEALED,
        activeContract: {
          contractId: CONTRACT,
          startedAtDepth: 4,
          targetDepth: 4 + CONTRACTS[CONTRACT].span,
          reward: null,
        },
      },
    };

    const commitments = selectRunCommitments(loaded, bankingLockedUntil(loaded));
    const tones = commitments.map((commitment) => commitment.tone);

    expect(commitments).toHaveLength(3);
    expect(tones).toContain("imposed");
    expect(tones).toContain("offered");
    expect(tones).toContain("staked");

    const staked = commitments.find((commitment) => commitment.tone === "staked");

    expect(staked?.targetDepth).toBe(30);
    expect(staked?.depthsRemaining).toBe(24);
  });

  it("orders the surface by what failing to reach the target actually costs", () => {
    /*
     * The panel header shows the first commitment and counts the rest, so the
     * order is a decision rather than the sequence they were pushed in.
     *
     * Tone leads because it says what is at stake: an imposed lock is holding
     * the exit shut now, a staked wager has already taken chips, and an offered
     * contract merely declines to pay if it is missed.
     */
    const launched = reduce(withPending(fresh(), { targetDepth: 30 }), {
      type: "LAUNCH_EXPEDITION",
    }).state;

    const loaded: GameState = {
      ...launched,
      expedition: {
        ...launched.expedition,
        status: "decision",
        depth: 6,
        activeModifierId: SEALED,
        activeContract: {
          contractId: CONTRACT,
          startedAtDepth: 4,
          targetDepth: 4 + CONTRACTS[CONTRACT].span,
          reward: null,
        },
      },
    };

    expect(
      selectRunCommitments(loaded, bankingLockedUntil(loaded)).map(
        (commitment) => commitment.tone,
      ),
    ).toEqual(["imposed", "staked", "offered"]);
  });

  it("breaks a tone tie on whichever target is nearer", () => {
    // Two staked-or-offered commitments cannot both be imposed, so the tie that
    // actually happens is distance. Nearest first: it is the one about to matter.
    const launched = reduce(withPending(fresh(), { targetDepth: 30 }), {
      type: "LAUNCH_EXPEDITION",
    }).state;

    const near: GameState = {
      ...launched,
      expedition: {
        ...launched.expedition,
        status: "decision",
        depth: 6,
        activeContract: {
          contractId: CONTRACT,
          startedAtDepth: 4,
          targetDepth: 4 + CONTRACTS[CONTRACT].span,
          reward: null,
        },
      },
    };

    const commitments = selectRunCommitments(near, null);

    // The contract is offered and the wager staked, so tone still decides here;
    // what this pins is that the sort is total and stable rather than incidental.
    expect(commitments.map((commitment) => commitment.tone)).toEqual(["staked", "offered"]);
    expect(selectRunCommitments(near, null).map((commitment) => commitment.key)).toEqual(
      commitments.map((commitment) => commitment.key),
    );
  });

  it("keeps a placed wager off the surface until a run is under way", () => {
    /*
     * A wager can be placed and then left sitting. The other two commitments
     * cannot exist outside a run at all, so without a status guard the panel
     * showed a progress bar pinned at zero and "40 to depth 40" under a header
     * reading "Surface" — progress toward a target on a run that had not begun.
     */
    const placed = reduce(fresh(), {
      type: "PLACE_DEPTH_WAGER",
      targetDepth: 40,
      stake: 1_000,
    }).state;

    expect(placed.expedition.status).toBe("surface");
    expect(placed.gambling.depthWager.pending).not.toBeNull();
    expect(selectRunCommitments(placed, null)).toEqual([]);

    const launched = reduce(placed, { type: "LAUNCH_EXPEDITION" }).state;
    const commitments = selectRunCommitments(launched, null);

    expect(commitments).toHaveLength(1);
    expect(commitments[0].tone).toBe("staked");
  });

  it("shows nothing at all when a run carries no commitment", () => {
    const launched = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;
    const plain: GameState = {
      ...launched,
      expedition: { ...launched.expedition, status: "decision", depth: 3, activeModifierId: null },
    };

    expect(selectRunCommitments(plain, null)).toEqual([]);
  });
});

describe("the rail marker", () => {
  it("reports a pending wager as running rather than as an action", () => {
    /*
     * The rail said nothing at all about gambling, which was right while it was
     * purely voluntary and wrong once a wager could refuse a prestige. "Running"
     * rather than "action available": there is nothing to do but launch.
     */
    const placed = reduce(fresh(), {
      type: "PLACE_DEPTH_WAGER",
      targetDepth: 40,
      stake: 1_000,
    }).state;

    expect(selectRailAttention(deriveContext(placed)).gambling).toBe("busy");
    expect(selectRailAttention(deriveContext(fresh())).gambling).toBe("none");
  });
});

describe("the panel", () => {
  it("opens on the player's own record and states the formula it used", () => {
    const view = selectDepthWagerView(deriveContext(fresh()));

    expect(view.selectedTarget).toBe(40);
    expect(view.referenceDepth).toBe(40);
    expect(view.referenceIsFloor).toBe(false);
    expect(view.formula).toContain(String(ECONOMY.depthWagerBestProbability));
    expect(view.formula).toContain("40");
  });

  it("says when the price is riding on the house minimum rather than a record", () => {
    const view = selectDepthWagerView(deriveContext(fresh(1_000, 0)));

    expect(view.referenceIsFloor).toBe(true);
    expect(view.referenceDepth).toBe(ECONOMY.depthWagerReferenceFloor);
  });

  it("refuses to offer a wager during a run, and says why", () => {
    const running = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;
    const view = selectDepthWagerView(deriveContext(running));

    expect(view.place.available).toBe(false);
    expect(view.place.reason).toContain("before you launch");
  });
});
