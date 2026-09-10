/**
 * Coverage for the Gambler and Flywheel specs.
 *
 * Both are the first specs whose effect is not a flat multiplier, so the things
 * worth pinning are the ones a flat multiplier gets for free: that the average
 * is what the interface claims, that eight hours offline pays the same as eight
 * hours watched, and that a ramp earned by patience is actually lost when the
 * spec is swapped.
 */

import { describe, expect, it } from "vitest";
import { MACHINES, SPECS, STARTER_MACHINE_ID } from "../../content/catalog";
import {
  FLYWHEEL_FLOOR,
  GAMBLER_MAXIMUM,
  GAMBLER_MEAN,
  GAMBLER_MINIMUM,
  GAMBLER_VARIANCE,
} from "../../content/machines";
import {
  FLYWHEEL_CYCLES_TO_FLOOR,
  advanceMachines,
  flywheelDurationMultiplier,
  selectCashPerSecond,
  selectCycleMs,
  selectCyclePayout,
  selectExpectedCyclePayout,
} from "../../domain/casino";
import { reduce } from "../../domain/reducer";
import { createRngState, nextPowerCurveSum } from "../../domain/rng";
import { createGameState, type GameState } from "../../domain/state";
import { runMigrations } from "../../persistence/migrations";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;
const STARTER = MACHINES[STARTER_MACHINE_ID];

/** A machine with the given spec researched and equipped. */
function withSpec(specId: keyof typeof SPECS | null, seed = 3): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });
  const spec = specId === null ? null : SPECS[specId];

  return {
    ...base,
    casino: {
      ...base.casino,
      machines: {
        ...base.casino.machines,
        [STARTER_MACHINE_ID]: {
          ...base.casino.machines[STARTER_MACHINE_ID],
          activeSpecId: specId,
          researchRanks:
            spec === null ? {} : { [spec.requiredResearchNodeId]: 1 },
        },
      },
    },
  };
}

describe("the gambler draw", () => {
  it("stays inside its range and averages what the content claims", () => {
    let state = createRngState(7, "machine-payout");
    let total = 0;
    const samples = 40_000;

    for (let index = 0; index < samples; index += 1) {
      // One cycle at a time, so this is the true distribution rather than the
      // approximation the offline path uses.
      const draw = nextPowerCurveSum(
        state,
        1,
        GAMBLER_MINIMUM,
        GAMBLER_MAXIMUM,
        3,
        GAMBLER_MEAN,
        GAMBLER_VARIANCE,
      );

      expect(draw.value).toBeGreaterThanOrEqual(GAMBLER_MINIMUM);
      expect(draw.value).toBeLessThanOrEqual(GAMBLER_MAXIMUM);
      total += draw.value;
      state = draw.state;
    }

    expect(total / samples).toBeCloseTo(GAMBLER_MEAN, 1);
  });

  it("is skewed low, so a big cycle stays an event", () => {
    let state = createRngState(11, "machine-payout");
    let below = 0;
    const samples = 20_000;

    for (let index = 0; index < samples; index += 1) {
      const draw = nextPowerCurveSum(state, 1, GAMBLER_MINIMUM, GAMBLER_MAXIMUM, 3, GAMBLER_MEAN, GAMBLER_VARIANCE);

      if (draw.value < 1) {
        below += 1;
      }

      state = draw.state;
    }

    // A uniform draw would put ~14% of cycles under 1x. Cubing puts most there.
    expect(below / samples).toBeGreaterThan(0.5);
  });

  it("approximates a long stretch with the same mean as rolling it out", () => {
    /*
     * Eight hours offline at a three-second cycle is nearly ten thousand
     * cycles. The approximation exists so that load does not roll them one by
     * one, and it is only correct if it agrees with the path it replaces.
     */
    const cycles = 9_600;
    let state = createRngState(23, "machine-payout");
    let total = 0;
    const trials = 60;

    for (let trial = 0; trial < trials; trial += 1) {
      const draw = nextPowerCurveSum(
        state,
        cycles,
        GAMBLER_MINIMUM,
        GAMBLER_MAXIMUM,
        3,
        GAMBLER_MEAN,
        GAMBLER_VARIANCE,
      );

      expect(draw.value).toBeGreaterThanOrEqual(cycles * GAMBLER_MINIMUM);
      expect(draw.value).toBeLessThanOrEqual(cycles * GAMBLER_MAXIMUM);
      total += draw.value;
      state = draw.state;
    }

    expect(total / trials / cycles).toBeCloseTo(GAMBLER_MEAN, 1);
  });

  it("agrees with the path it replaces, on mean and on spread", () => {
    /*
     * The approximation only earns its place if it is indistinguishable from
     * rolling the cycles out. Both paths are sampled at the same count, just
     * either side of the threshold, and compared on mean and variance.
     */
    const cycles = 400;
    const trials = 400;
    const exact: number[] = [];
    const approximate: number[] = [];

    let exactState = createRngState(31, "machine-payout");
    let approximateState = createRngState(37, "machine-payout");

    for (let trial = 0; trial < trials; trial += 1) {
      let total = 0;

      for (let cycle = 0; cycle < cycles; cycle += 1) {
        const draw = nextPowerCurveSum(exactState, 1, GAMBLER_MINIMUM, GAMBLER_MAXIMUM, 3, GAMBLER_MEAN, GAMBLER_VARIANCE);

        total += draw.value;
        exactState = draw.state;
      }

      exact.push(total);

      const approximated = nextPowerCurveSum(
        approximateState,
        cycles,
        GAMBLER_MINIMUM,
        GAMBLER_MAXIMUM,
        3,
        GAMBLER_MEAN,
        GAMBLER_VARIANCE,
      );

      approximate.push(approximated.value);
      approximateState = approximated.state;
    }

    const average = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const spread = (values: number[]): number => {
      const mean = average(values);

      return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
    };

    // Within a percent of each other on the mean.
    expect(average(approximate) / average(exact)).toBeCloseTo(1, 1);

    // And the same order of spread, rather than a flat line pretending to vary.
    const ratio = spread(approximate) / spread(exact);

    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });

  it("reports an average rather than a next-cycle payout", () => {
    const gambler = withSpec("spec.alpha.gambler");
    const plain = withSpec(null);

    // The flat multiplier is 1, so the deterministic payout is unchanged...
    expect(selectCyclePayout(gambler, STARTER_MACHINE_ID, [])).toBe(
      selectCyclePayout(plain, STARTER_MACHINE_ID, []),
    );

    // ...but everything the player reads folds the average back in.
    expect(selectExpectedCyclePayout(gambler, STARTER_MACHINE_ID, [])).toBeCloseTo(
      selectCyclePayout(plain, STARTER_MACHINE_ID, []) * GAMBLER_MEAN,
      6,
    );
    expect(selectCashPerSecond(gambler, STARTER_MACHINE_ID, [])).toBeGreaterThan(
      selectCashPerSecond(plain, STARTER_MACHINE_ID, []),
    );
  });

  it("pays a varying amount for identical elapsed time", () => {
    let state = withSpec("spec.alpha.gambler");
    const payouts = new Set<number>();

    for (let index = 0; index < 12; index += 1) {
      const advance = advanceMachines(state, STARTER.baseCycleMs * 3, []);

      payouts.add(advance.cashGranted);
      state = { ...state, random: { ...state.random, machinePayout: advance.payoutRng } };
    }

    // A static spec would return the same number every time.
    expect(payouts.size).toBeGreaterThan(1);
  });

  it("advances its own stream and leaves the others alone", () => {
    const state = withSpec("spec.alpha.gambler");
    const advance = advanceMachines(state, STARTER.baseCycleMs * 4, []);

    expect(advance.payoutRng).not.toEqual(state.random.machinePayout);
    expect(advance.payoutRng.draws).toBeGreaterThan(state.random.machinePayout.draws);
  });
});

describe("the flywheel spec", () => {
  it("shortens the cycle toward the floor and stops there", () => {
    expect(flywheelDurationMultiplier(0)).toBe(1);
    expect(flywheelDurationMultiplier(10)).toBeLessThan(1);
    expect(flywheelDurationMultiplier(FLYWHEEL_CYCLES_TO_FLOOR)).toBe(FLYWHEEL_FLOOR);
    expect(flywheelDurationMultiplier(10_000)).toBe(FLYWHEEL_FLOOR);

    // Monotonically decreasing on the way down.
    for (let cycles = 1; cycles < FLYWHEEL_CYCLES_TO_FLOOR; cycles += 1) {
      expect(flywheelDurationMultiplier(cycles)).toBeLessThan(
        flywheelDurationMultiplier(cycles - 1),
      );
    }
  });

  it("winds up as cycles complete, and shows in the cycle time", () => {
    let state = withSpec("spec.alpha.flywheel");

    expect(selectCycleMs(state, STARTER_MACHINE_ID, [])).toBe(STARTER.baseCycleMs);

    const advance = advanceMachines(state, STARTER.baseCycleMs * 10, []);

    state = {
      ...state,
      casino: { ...state.casino, machines: advance.machines },
    };

    expect(state.casino.machines[STARTER_MACHINE_ID].flywheelCycles).toBeGreaterThan(0);
    expect(selectCycleMs(state, STARTER_MACHINE_ID, [])).toBeLessThan(STARTER.baseCycleMs);
  });

  it("fits more cycles into the same time than a plain machine", () => {
    const flywheel = advanceMachines(withSpec("spec.alpha.flywheel"), 10 * 60_000, []);
    const plain = advanceMachines(withSpec(null), 10 * 60_000, []);

    expect(flywheel.cashGranted).toBeGreaterThan(plain.cashGranted);
  });

  it("never winds past the floor, however long it runs", () => {
    const advance = advanceMachines(withSpec("spec.alpha.flywheel"), 8 * 60 * 60_000, []);
    const progress = advance.machines[STARTER_MACHINE_ID];

    expect(flywheelDurationMultiplier(progress.flywheelCycles)).toBe(FLYWHEEL_FLOOR);
    // The remainder still has to be a real partial cycle, not a negative one.
    expect(progress.cycleProgressMs).toBeGreaterThanOrEqual(0);
    expect(progress.cycleProgressMs).toBeLessThan(STARTER.baseCycleMs);
  });

  it("loses the ramp when the spec is swapped away and back", () => {
    let state = withSpec("spec.alpha.flywheel");
    const advance = advanceMachines(state, STARTER.baseCycleMs * 20, []);

    state = { ...state, casino: { ...state.casino, machines: advance.machines } };
    expect(state.casino.machines[STARTER_MACHINE_ID].flywheelCycles).toBeGreaterThan(0);

    const cleared = reduce(state, {
      type: "SET_MACHINE_SPEC",
      machineId: STARTER_MACHINE_ID,
      specId: null,
    }).state;

    expect(cleared.casino.machines[STARTER_MACHINE_ID].flywheelCycles).toBe(0);
  });
});

describe("the version 6 to 7 migration", () => {
  it("carries a Tempo purchase across to the spec that replaced it", () => {
    const legacy = {
      saveVersion: 6,
      contentVersion: "0.1.0",
      revision: 14,
      savedAtUnixMs: NOW,
      game: {
        casino: {
          machines: {
            "machine.alpha": {
              unlocked: true,
              level: 6,
              activeSpecId: "spec.alpha.tempo",
              researchRanks: {
                "research.alpha.overclock": 3,
                "research.alpha.spec-endurance": 1,
                "research.alpha.spec-tempo": 1,
              },
            },
          },
        },
      },
    };

    const migrated = runMigrations(legacy);
    const casino = (migrated.envelope.game as Record<string, unknown>).casino as Record<
      string,
      unknown
    >;
    const alpha = (casino.machines as Record<string, Record<string, unknown>>)["machine.alpha"];

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(6));

    // A rename, not a deletion: the spec they paid for is still unlocked, and
    // still the one they are running.
    expect(alpha.activeSpecId).toBe("spec.alpha.gambler");
    expect(alpha.researchRanks).toEqual({
      "research.alpha.overclock": 3,
      "research.alpha.spec-endurance": 1,
      "research.alpha.spec-gambler": 1,
    });

    // The new ramp starts cold for everyone.
    expect(alpha.flywheelCycles).toBe(0);
  });
});
