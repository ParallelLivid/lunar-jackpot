/**
 * Coverage for the machine ladder's pricing.
 *
 * The bug this chunk fixed was invisible in any single machine's numbers. Penny
 * Reels and Vacuum Roulette differ in payout by 3.9x and in Overclock price by
 * 15x, and both look entirely reasonable written down — but those two figures
 * combine into a dead heat, which rank rounding then settled in favour of the
 * cheaper machine. Nothing read wrong; only the comparison did.
 *
 * So the tests here are all comparisons.
 */

import { describe, expect, it } from "vitest";
import {
  ECONOMY,
  MACHINES,
  MACHINE_IDS,
  RESEARCH_NODES,
  STARTER_MACHINE_ID,
} from "../../content/catalog";
import {
  OVERCLOCK_CHIP_GROWTH,
  OVERCLOCK_PAYOUT_PER_RANK,
  evaluateMachineLevel,
  machineMerit,
  overclockNodeFor,
} from "../../content/machines";
import type { MachineId } from "../../content/catalog";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectMachineView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";

/**
 * Cash per second a machine reaches after spending `budget` chips on Overclock,
 * simulated rank by rank.
 *
 * `machineMerit` is the continuous approximation of this; buying whole ranks is
 * what a player actually does, and the difference between the two is exactly the
 * rounding that let the starter machine win a tie.
 */
function cashPerSecondAtBudget(machineId: MachineId, budget: number): number {
  const definition = MACHINES[machineId];
  const overclock = overclockNodeFor(machineId);

  if (overclock === null) {
    return 0;
  }

  let spent = 0;
  let rank = 0;

  while (spent + overclock.chipCost * OVERCLOCK_CHIP_GROWTH ** rank <= budget) {
    spent += overclock.chipCost * OVERCLOCK_CHIP_GROWTH ** rank;
    rank += 1;
  }

  const baseRate = definition.basePayout / (definition.baseCycleMs / 1000);

  return baseRate * OVERCLOCK_PAYOUT_PER_RANK ** rank;
}

/**
 * The fraction of chip budgets at which `machineId` out-earns `against`.
 *
 * Log-spaced over a window measured *relative to the machine's own first rank*
 * rather than an absolute ceiling: the Selenite Vault's Overclock costs 1.6
 * billion chips, so any fixed upper bound generous enough for Penny Reels is
 * below where the Vault's window even begins. Six orders of magnitude is roughly
 * ten ranks, which is more than a player will ever buy on one machine.
 */
function shareOfBudgetsWon(machineId: MachineId, against: MachineId): number {
  const start = overclockNodeFor(machineId)?.chipCost ?? 1;
  let won = 0;
  let total = 0;

  for (let exponent = 0; exponent <= Math.log(1e6); exponent += 0.02) {
    const budget = start * Math.exp(exponent);

    total += 1;
    won += cashPerSecondAtBudget(machineId, budget) > cashPerSecondAtBudget(against, budget) ? 1 : 0;
  }

  return won / total;
}

describe("every rung is worth climbing", () => {
  it("gains at least half again per chip over the machine below it", () => {
    for (let index = 1; index < MACHINE_IDS.length; index += 1) {
      const previous = MACHINE_IDS[index - 1];
      const current = MACHINE_IDS[index];
      const gain = machineMerit(current) / machineMerit(previous);

      expect(gain, `${current} over ${previous}`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("wins the large majority of chip budgets against the machine below it", () => {
    /*
     * Not *every* budget, and asserting that would be asserting something
     * unachievable. Ranks cost four times the last, so there are always narrow
     * windows where the cheaper machine has just bought a rank the dearer one
     * cannot yet afford, and it leads until the dearer one catches up. Pricing
     * cannot remove those; only a different rank curve could.
     *
     * What pricing decides is how wide those windows are, and that is the
     * difference between a working ladder and a broken one. Measured over
     * log-spaced budgets, Penny Reels at its old 40-chip price led or tied Vacuum
     * Roulette at **92%** of budgets — it was simply the better machine, forever.
     * At 110 that falls to **20%**.
     */
    for (let index = 1; index < MACHINE_IDS.length; index += 1) {
      const previous = MACHINE_IDS[index - 1];
      const current = MACHINE_IDS[index];
      const share = shareOfBudgetsWon(current, previous);

      expect(share, `${current} over ${previous}`).toBeGreaterThan(0.6);
    }
  });

  it("would have failed before the retune", () => {
    /*
     * A guard nobody has seen bite is not a guard. Penny Reels' Overclock cost
     * 40 chips, and at that price its merit sat 1.8% *above* Vacuum Roulette's
     * rather than well below it.
     */
    const penny = MACHINES[MACHINE_IDS[0]];
    const baseRate = penny.basePayout / (penny.baseCycleMs / 1000);
    const exponent = Math.log(OVERCLOCK_PAYOUT_PER_RANK) / Math.log(OVERCLOCK_CHIP_GROWTH);
    const meritAtOldPrice = baseRate / 40 ** exponent;

    expect(machineMerit(MACHINE_IDS[1]) / meritAtOldPrice).toBeLessThan(1.5);
    // And the shipped price clears the bar the old one failed.
    expect(machineMerit(MACHINE_IDS[1]) / machineMerit(MACHINE_IDS[0])).toBeGreaterThanOrEqual(
      1.5,
    );
    // The starter also stopped winning most budgets, which is the same fact read
    // the way a player would experience it.
    expect(shareOfBudgetsWon(MACHINE_IDS[1], MACHINE_IDS[0])).toBeGreaterThan(0.6);
  });
});

describe("the Overclock node", () => {
  it("is found structurally, not by its name", () => {
    // A display name is a string somebody may reword; the balance rule must not
    // quietly stop checking anything if they do.
    for (const machineId of MACHINE_IDS) {
      const node = overclockNodeFor(machineId);

      expect(node, machineId).not.toBeNull();
      expect(node?.maximumRank).toBeNull();
      expect(node?.payoutMultiplierPerRank).toBeGreaterThan(1);
      expect(node?.machineId).toBe(machineId);
    }
  });

  it("is the only repeatable payout research on each machine", () => {
    // If a second one appeared, `machineMerit` would silently measure whichever
    // came first in the list.
    for (const machineId of MACHINE_IDS) {
      const repeatable = MACHINES[machineId].researchNodeIds
        .map((nodeId) => RESEARCH_NODES[nodeId])
        .filter((node) => node.maximumRank === null && node.payoutMultiplierPerRank > 1);

      expect(repeatable, machineId).toHaveLength(1);
    }
  });

  it("keeps the shared growth constants that make the other nine rungs work", () => {
    expect(OVERCLOCK_CHIP_GROWTH).toBe(4);
    expect(OVERCLOCK_PAYOUT_PER_RANK).toBe(2);
  });
});

describe("the cost to the opening", () => {
  it("keeps the starter Overclock inside a couple of runs", () => {
    /*
     * Measured: a run on starter gear banks 39-52 chips. The first Overclock
     * moves from one run to two or three, which is the entire early-game cost of
     * this change — and the reason the plan's fallback lever was not needed.
     */
    const starter = overclockNodeFor(MACHINE_IDS[0]);

    expect(starter?.chipCost).toBeLessThanOrEqual(120);
    expect(starter?.chipCost).toBeGreaterThan(40);
  });
});

describe("the retuned curve", () => {
  /*
   * A curve where cost grows ~13% faster than payout per level walls off in the
   * low tens: every level pays back slower than the last, and the ladder stops
   * being buyable within an hour.
   *
   * The lever is the ratio between the two growths rather than either one. These
   * pin the shape rather than the numbers, so a retune that keeps the shape does
   * not fail them.
   */
  const RATIO_CEILING = 1.02;

  it("keeps cost growing faster than payout, but only just", () => {
    for (const machine of Object.values(MACHINES)) {
      const { cashGrowth, payoutGrowth } = machine.curve;

      // The invariant the curve's own doc comment states: without it every level
      // pays back in the same time and depth means nothing.
      expect(cashGrowth, machine.id).toBeGreaterThan(payoutGrowth);

      /*
       * And the new part. `(cashGrowth / payoutGrowth) ** level` is what decides
       * how long a level takes to earn out, so a ratio much above 1 is a wall a
       * few dozen levels along however cheap the first level is.
       */
      expect(cashGrowth / payoutGrowth, machine.id).toBeLessThan(RATIO_CEILING);
    }
  });

  it("lets a lower tier climb faster than a deeper one", () => {
    // "Lower tier machines first, and higher obviously", which falls out of each
    // machine's ratio being a little wider than the one above it.
    const ratios = MACHINE_IDS.map(
      (id) => MACHINES[id].curve.cashGrowth / MACHINES[id].curve.payoutGrowth,
    );

    ratios.forEach((ratio, index) => {
      if (index > 0) {
        expect(ratio, MACHINE_IDS[index]).toBeGreaterThan(ratios[index - 1]);
      }
    });
  });

  it("prices a level against the machine's own income, not an independent ladder", () => {
    /*
     * Base payouts span 5 to over a billion. Charging the deep machines
     * proportionally more cash *as well* is what pinned them at level 1 forever,
     * so a first level now costs a comparable amount of time on every machine.
     */
    const seconds = MACHINE_IDS.map((id) => {
      const machine = MACHINES[id];

      return machine.curve.firstCashCost / (machine.basePayout / (machine.baseCycleMs / 1000));
    });

    for (const value of seconds) {
      expect(value).toBeGreaterThan(30);
      expect(value).toBeLessThan(120);
    }
  });

  it("puts the first prestige under a hundred levels", () => {
    // The owner's target: early machines under 100 on a first cycle.
    let level = 1;
    let spent = 0;

    for (let next = 2; next <= 20_000; next += 1) {
      const evaluated = evaluateMachineLevel(MACHINES[STARTER_MACHINE_ID], next);

      if (evaluated === null || spent + evaluated.cashCost > ECONOMY.prestigeThresholdCash) {
        break;
      }

      spent += evaluated.cashCost;
      level = next;
    }

    expect(level).toBeGreaterThan(50);
    expect(level).toBeLessThan(100);
  });

  it("keeps components off the critical path", () => {
    /*
     * Components come only from expeditions, and that supply barely grows with
     * prestige — so if the component charge tracked cash it would become the
     * binding constraint and the ladder would be gated on expedition throughput
     * rather than on cash. It grows far more slowly on purpose.
     */
    for (const machine of Object.values(MACHINES)) {
      const perCharge = machine.curve.componentGrowth;
      const cashPerCharge = machine.curve.cashGrowth ** machine.curve.componentEveryNLevels;

      expect(perCharge, machine.id).toBeGreaterThan(1);
      expect(perCharge, machine.id).toBeLessThan(cashPerCharge);
    }
  });
});

describe("spec research", () => {
  it("offers the three specs as alternatives rather than a chain", () => {
    // Requiring one spec before another makes it a toll rather than a choice: a
    // player who wants the third pays for one they do not want first.
    for (const machineId of MACHINE_IDS) {
      for (const nodeId of MACHINES[machineId].researchNodeIds) {
        const node = RESEARCH_NODES[nodeId];

        if (node.unlocksSpecId !== undefined) {
          expect(node.prerequisiteNodeIds, nodeId).toEqual([]);
        }
      }
    }
  });
});

/**
 * Buying levels in batches.
 *
 * The rule under test is that a batch is exactly the single purchases it
 * replaces — same cost, same destination — and that it is all or nothing. The
 * curve is not linear, so "ten levels" is a sum rather than a multiplication,
 * and a panel or a test that multiplied would be wrong in the player's favour
 * at low levels and against them at high ones.
 */
describe("buying levels in batches", () => {
  const NOW = 1_700_000_000_000;

  function loaded(cash = 1e12, components = 1e9): GameState {
    const base = createGameState({ nowUnixMs: NOW, seed: 11 });

    return {
      ...base,
      resources: { ...base.resources, cash, components },
      casino: {
        ...base.casino,
        machines: {
          ...base.casino.machines,
          [STARTER_MACHINE_ID]: {
            ...base.casino.machines[STARTER_MACHINE_ID],
            unlocked: true,
          },
        },
      },
    };
  }

  function buy(state: GameState, quantity?: number): GameState {
    return reduce(state, {
      type: "BUY_MACHINE_LEVEL",
      machineId: STARTER_MACHINE_ID,
      ...(quantity === undefined ? {} : { quantity }),
    }).state;
  }

  it("costs exactly what the same levels cost one at a time", () => {
    const start = loaded();

    let stepwise = start;

    for (let index = 0; index < 10; index += 1) {
      stepwise = buy(stepwise);
    }

    const batched = buy(start, 10);

    expect(batched.casino.machines[STARTER_MACHINE_ID].level).toBe(
      stepwise.casino.machines[STARTER_MACHINE_ID].level,
    );
    expect(batched.resources.cash).toBe(stepwise.resources.cash);
    expect(batched.resources.components).toBe(stepwise.resources.components);
  });

  it("buys nothing at all when the whole batch is unaffordable", () => {
    /*
     * The decision this chunk turns on. "As many as you can afford" was
     * rejected: a button labelled x100 that sometimes buys seven cannot be read
     * before it is pressed.
     */
    const start = loaded();
    const tenLevels = start.resources.cash - buy(start, 10).resources.cash;
    const thin: GameState = {
      ...start,
      resources: { ...start.resources, cash: tenLevels - 1 },
    };

    const after = buy(thin, 10);

    expect(after.casino.machines[STARTER_MACHINE_ID].level).toBe(
      thin.casino.machines[STARTER_MACHINE_ID].level,
    );
    expect(after.resources.cash).toBe(thin.resources.cash);
  });

  it("reports the batch as unavailable rather than letting it fail", () => {
    const start = loaded();
    const tenLevels = start.resources.cash - buy(start, 10).resources.cash;
    const thin: GameState = {
      ...start,
      resources: { ...start.resources, cash: tenLevels - 1 },
    };

    const view = selectMachineView(deriveContext(thin), STARTER_MACHINE_ID);
    const ten = view.bulkLevels.find((batch) => batch.quantity === 10);

    expect(ten?.purchase.available).toBe(false);
    expect(view.bulkLevels.find((batch) => batch.quantity === 1)?.purchase.available).toBe(true);
  });

  it("prices each batch as the sum of its own levels", () => {
    // Not a multiple of the next level's price: the curve grows per level, so a
    // batch of ten costs more than ten of the cheapest one in it.
    const view = selectMachineView(deriveContext(loaded()), STARTER_MACHINE_ID);
    const [one, ten, hundred] = view.bulkLevels;

    expect(one.quantity).toBe(1);
    expect(ten.quantity).toBe(10);
    expect(hundred.quantity).toBe(100);

    expect(ten.cashCost).toBeGreaterThan(one.cashCost * 10);
    expect(hundred.cashCost).toBeGreaterThan(ten.cashCost);
    expect(ten.targetLevel).toBe(one.targetLevel + 9);
  });

  it("refuses a quantity that is not a whole number of levels", () => {
    for (const quantity of [0, -5, 1.5, Number.NaN]) {
      const after = buy(loaded(), quantity);

      expect(after.casino.machines[STARTER_MACHINE_ID].level).toBe(
        loaded().casino.machines[STARTER_MACHINE_ID].level,
      );
    }
  });

  it("still buys exactly one level when no quantity is given", () => {
    // The regression guard for every existing call site, the panel's own single
    // button included.
    const before = loaded();
    const after = buy(before);

    expect(after.casino.machines[STARTER_MACHINE_ID].level).toBe(
      before.casino.machines[STARTER_MACHINE_ID].level + 1,
    );
  });
});
