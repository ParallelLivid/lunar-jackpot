import { describe, expect, it } from "vitest";
import { DEPTH_BANDS, bandForDepth } from "../../content/depthBands";
import {
  ECONOMY,
  ENCOUNTERS,
  FIRST_ENCOUNTER_ID,
  GEAR,
  TRINKET_IDS,
} from "../../content/catalog";
import { CAT_SKINS, DEFAULT_CAT_SKIN_IDS } from "../../content/catSkins";
import { HIGHEST_GRADE } from "../../content/grades";
import { deriveContext, selectExpeditionView } from "../../domain/selectors";
import { createActiveEncounter } from "../../domain/encounters";
import { commitFailureResult } from "../../domain/expedition";
import { reduce } from "../../domain/reducer";
import { createRngState } from "../../domain/rng";
import { createEmptyRunInventory, createGameState, type ActiveEncounter, type GameState } from "../../domain/state";

function launched(seed = 11): GameState {
  const state = createGameState({ nowUnixMs: 0, seed });
  const afterLaunch = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

  return tick(afterLaunch, ECONOMY.launchTransitionMs);
}

/** Advances one tick, carrying the wall clock forward with the simulated time. */
function tick(state: GameState, expeditionElapsedMs: number): GameState {
  return reduce(state, {
    type: "TICK",
    casinoElapsedMs: 0,
    expeditionElapsedMs,
    nowUnixMs: state.lastSettledAtUnixMs + expeditionElapsedMs,
  }).state;
}

/** Advances the run in fixed steps until the predicate holds or steps run out. */
function tickUntil(
  state: GameState,
  predicate: (current: GameState) => boolean,
  stepMs = 100,
  maxSteps = 20_000,
): GameState {
  let current = state;

  for (let index = 0; index < maxSteps && !predicate(current); index += 1) {
    current = tick(current, stepMs);
  }

  return current;
}

/** Plays a run greedily: engage every encounter, always take the first option. */
function playUntilDepth(state: GameState, depth: number, maxSteps = 40_000): GameState {
  let current = state;

  for (let index = 0; index < maxSteps; index += 1) {
    if (current.expedition.status === "surface" || current.expedition.depth >= depth) {
      return current;
    }

    if (current.expedition.status === "decision") {
      current = reduce(current, { type: "CONTINUE_EXPEDITION" }).state;
      continue;
    }

    if (current.expedition.status === "choice") {
      const definition = ENCOUNTERS[current.expedition.currentEncounter!.encounterId];
      const optionId = definition.choiceOptions?.[0]?.id ?? "";
      current = reduce(current, { type: "CHOOSE_ENCOUNTER_OPTION", optionId }).state;
      continue;
    }

    current = tick(current, 100);
  }

  return current;
}

describe("expedition transitions", () => {
  it("starts on the surface and only launches from there", () => {
    const state = createGameState({ nowUnixMs: 0, seed: 1 });

    expect(state.expedition.status).toBe("surface");

    const first = reduce(state, { type: "LAUNCH_EXPEDITION" });

    expect(first.state.expedition.status).toBe("launching");

    const second = reduce(first.state, { type: "LAUNCH_EXPEDITION" });

    expect(second.materialChange).toBe(false);
    expect(second.state.expedition.runId).toBe(first.state.expedition.runId);
  });

  it("guarantees a low-durability ore node as the first encounter", () => {
    const state = tickUntil(launched(), (current) => current.expedition.currentEncounter !== null);

    expect(state.expedition.currentEncounter?.encounterId).toBe(FIRST_ENCOUNTER_ID);
    expect(state.expedition.depth).toBe(0);
  });

  it("commits the player to an encounter on arrival, with no chance to decline", () => {
    const approaching = launched();

    expect(reduce(approaching, { type: "CONTINUE_EXPEDITION" }).materialChange).toBe(false);
    expect(reduce(approaching, { type: "RETURN_FROM_EXPEDITION" }).materialChange).toBe(false);

    // Arriving goes straight into resolution; there is no accept-or-decline step.
    const resolving = tickUntil(approaching, (current) => current.expedition.status !== "approaching");

    expect(resolving.expedition.status).toBe("resolving");
    expect(reduce(resolving, { type: "RETURN_FROM_EXPEDITION" }).materialChange).toBe(false);
    expect(reduce(resolving, { type: "CONTINUE_EXPEDITION" }).materialChange).toBe(false);
  });

  it("offers the decision only once the reward has landed", () => {
    const decision = tickUntil(launched(), (current) => current.expedition.status === "decision");

    // Loot from the encounter just resolved is already banked into the run.
    expect(
      Object.values(decision.expedition.runInventory.ore).reduce((sum, count) => sum + count, 0),
    ).toBeGreaterThan(0);
    expect(decision.expedition.history).toHaveLength(1);
    expect(reduce(decision, { type: "RETURN_FROM_EXPEDITION" }).materialChange).toBe(true);
    expect(reduce(decision, { type: "CONTINUE_EXPEDITION" }).materialChange).toBe(true);
  });

  it("commits the reward when resolution begins, not when it completes", () => {
    const approaching = launched();

    expect(approaching.expedition.currentEncounter?.committedReward ?? null).toBeNull();

    const resolving = tickUntil(
      approaching,
      (current) => current.expedition.status === "resolving",
    );

    expect(resolving.expedition.currentEncounter?.committedReward).not.toBeNull();
  });

  it("pauses oxygen during the decision state", () => {
    const decision = tickUntil(launched(), (current) => current.expedition.status === "decision");
    const waited = tick(decision, 500);

    expect(waited.expedition.oxygen).toBe(decision.expedition.oxygen);
  });

  it("hides what is coming next by advancing depth only on a commitment", () => {
    const decision = tickUntil(launched(), (current) => current.expedition.status === "decision");

    expect(decision.expedition.depth).toBe(0);

    const pressedOn = reduce(decision, { type: "CONTINUE_EXPEDITION" }).state;

    expect(pressedOn.expedition.depth).toBe(1);
    expect(pressedOn.expedition.status).toBe("approaching");
  });

  it("drains oxygen while approaching", () => {
    const state = launched();
    const after = tick(state, 1_000);

    expect(after.expedition.oxygen).toBeLessThan(state.expedition.oxygen);
  });

  it("produces the same encounter sequence from the same seed", () => {
    const runA = playUntilDepth(launched(5), 4);
    const runB = playUntilDepth(launched(5), 4);

    expect(runA.expedition.history.map((entry) => entry.encounterId)).toEqual(
      runB.expedition.history.map((entry) => entry.encounterId),
    );
    expect(runA.expedition.history.length).toBeGreaterThan(0);
  });
});

describe("banking and failure", () => {
  it("banks the run inventory exactly once on a voluntary return", () => {
    const state = tickUntil(launched(), (current) => current.expedition.status === "decision");

    const oreHeld = Object.values(state.expedition.runInventory.ore).reduce(
      (sum, count) => sum + count,
      0,
    );

    expect(oreHeld).toBeGreaterThan(0);

    const returned = reduce(state, { type: "RETURN_FROM_EXPEDITION" });

    expect(returned.state.expedition.status).toBe("surface");
    expect(returned.state.resources.chips).toBeGreaterThan(0);

    const again = reduce(returned.state, { type: "RETURN_FROM_EXPEDITION" });

    expect(again.state.resources.chips).toBe(returned.state.resources.chips);
  });

  it("fails the run when oxygen reaches zero on the tick an encounter would finish", () => {
    const state = tickUntil(launched(), (current) => current.expedition.status === "resolving");

    const encounter = state.expedition.currentEncounter as ActiveEncounter;

    expect(encounter.durabilityRemaining).toBeGreaterThan(0);

    // Leave exactly enough oxygen for this tick and no more.
    const tickMs = 500;
    const drain =
      (tickMs / 1000) * ECONOMY.baseOxygenDrainPerSecond * encounter.oxygenDrainMultiplier;

    const starved: GameState = {
      ...state,
      expedition: {
        ...state.expedition,
        oxygen: drain,
        currentEncounter: { ...encounter, durabilityRemaining: 0.0001 },
      },
    };

    const result = reduce(starved, {
      type: "TICK",
      casinoElapsedMs: 0,
      expeditionElapsedMs: tickMs,
      nowUnixMs: starved.lastSettledAtUnixMs + tickMs,
    });

    expect(result.state.expedition.status).toBe("surface");
    expect(result.state.statistics.runsFailed).toBe(1);
    expect(result.state.statistics.encountersCompleted).toBe(0);
  });

  it("restores no more oxygen than the launch snapshot", () => {
    const state = launched();
    const full = state.expedition.maxOxygenSnapshot;

    const topped = reduce(
      {
        ...state,
        expedition: {
          ...state.expedition,
          status: "resolving",
          oxygen: full - 1,
          currentEncounter: {
            encounterId: "encounter.oxygen.shelf",
            approachElapsedMs: 0,
            approachDurationMs: 0,
            resolveElapsedMs: 0,
            strikesTaken: 0,
            resolveDurationMs: 100,
            durabilityRemaining: null,
            oxygenDrainMultiplier: 0.0001,
            chosenOptionId: null,
            committedReward: {
              tableId: "reward.oxygen.small",
              entryId: "pocket",
              tags: ["oxygen"],
              grants: [{ kind: "oxygen", amount: 999 }],
            },
          },
        },
      },
      { type: "TICK", casinoElapsedMs: 0, expeditionElapsedMs: 200, nowUnixMs: 200 },
    ).state;

    expect(topped.expedition.oxygen).toBe(full);
  });
});

describe("oxygen-failure loss rolls", () => {
  const inventory = {
    ore: { dust: 0, seam: 0, core: 0 },
    components: 0,
    relics: 0,
    recipePieces: createEmptyRunInventory().recipePieces,
    caches: 0,
    deepCaches: 0,
  };

  it("loses about half of a large haul at the base 50% chance", () => {
    const stack = 4_000;
    const result = commitFailureResult(
      { ...inventory, ore: { ...inventory.ore, dust: stack } },
      createRngState(99, "expedition-failure"),
      ECONOMY.failureLossChanceBase,
    );

    const lost = result.result.lost.ore.dust;

    expect(lost + result.result.recovered.ore.dust).toBe(stack);
    expect(lost / stack).toBeGreaterThan(0.44);
    expect(lost / stack).toBeLessThan(0.56);
  });

  it("permits both all-lost and all-recovered results, with no pity floor", () => {
    const outcomes = new Set<number>();

    for (let seed = 0; seed < 400; seed += 1) {
      const result = commitFailureResult(
        { ...inventory, relics: 2 },
        createRngState(seed, "expedition-failure"),
        ECONOMY.failureLossChanceBase,
      );

      outcomes.add(result.result.recovered.relics);
    }

    expect(outcomes.has(0)).toBe(true);
    expect(outcomes.has(2)).toBe(true);
  });

  it("retains more when a totem lowers the loss chance", () => {
    const stack = 4_000;
    const modified = commitFailureResult(
      { ...inventory, ore: { ...inventory.ore, dust: stack } },
      createRngState(99, "expedition-failure"),
      ECONOMY.failureLossChanceBase - 0.3,
    );

    expect(modified.result.lost.ore.dust / stack).toBeGreaterThan(0.14);
    expect(modified.result.lost.ore.dust / stack).toBeLessThan(0.26);
  });

  it("clamps a loss chance below the configured minimum", () => {
    const result = commitFailureResult(
      { ...inventory, relics: 500 },
      createRngState(4, "expedition-failure"),
      -5,
    );

    expect(result.result.lost.relics).toBeGreaterThan(0);
  });

  it("commits one result that a repeated roll cannot change", () => {
    const first = commitFailureResult(
      { ...inventory, components: 20 },
      createRngState(12, "expedition-failure"),
      ECONOMY.failureLossChanceBase,
    );
    const second = commitFailureResult(
      { ...inventory, components: 20 },
      createRngState(12, "expedition-failure"),
      ECONOMY.failureLossChanceBase,
    );

    expect(first.result).toEqual(second.result);
  });
});

describe("encounter content reachability", () => {
  it("keeps every encounter family reachable by depth eight", () => {
    const families = new Set(
      Object.values(ENCOUNTERS)
        .filter((encounter) => encounter.bands.includes(bandForDepth(8).id))
        .map((encounter) => encounter.family),
    );

    expect(families).toEqual(new Set(["ore", "oxygen", "supply", "rare", "hazard", "choice"]));
  });
});

describe("no encounter can stall a run", () => {
  /**
   * A launched run one millisecond from arriving at `definition`.
   *
   * Deliberately built for every encounter rather than the one that broke. The
   * cat's shape — automatic resolution, no reward table — was unique to it, and
   * a test written about cats would not catch the next one.
   */
  const approaching = (definition: (typeof ENCOUNTERS)[keyof typeof ENCOUNTERS]): GameState => {
    const running = launched(11);
    const encounter = createActiveEncounter(definition);

    return {
      ...running,
      expedition: {
        ...running.expedition,
        status: "approaching",
        depth: 4,
        currentEncounter: { ...encounter, approachElapsedMs: encounter.approachDurationMs - 1 },
      },
    };
  };

  it("leaves the approach on arrival, for every encounter in the catalog", () => {
    /*
     * The invariant the cat broke. `beginResolution` used to return the state
     * unchanged when an encounter declared no reward table, and the approach's
     * arrival condition stays true once met — so the run re-tried the same
     * transition on every tick, forever, while oxygen drained. The status is
     * what says whether a transition happened at all.
     */
    for (const definition of Object.values(ENCOUNTERS)) {
      const arrived = tick(approaching(definition), 100);

      expect(arrived.expedition.status, definition.id).not.toBe("approaching");
    }
  });

  it("carries every encounter through to a decision, given time and oxygen", () => {
    /*
     * The other half: leaving the approach is not enough if the next state has
     * no way out either. Oxygen is topped up so this measures the state machine
     * rather than the tank — a run that fails is a run that ended, which is not
     * what is being tested here.
     */
    for (const definition of Object.values(ENCOUNTERS)) {
      const start = approaching(definition);
      const roomy: GameState = {
        ...start,
        expedition: { ...start.expedition, oxygen: start.expedition.maxOxygenSnapshot },
      };
      const settled = tickUntil(
        roomy,
        (current) =>
          current.expedition.status === "decision" ||
          current.expedition.status === "choice" ||
          current.expedition.status === "surface",
        100,
        2_000,
      );

      expect(settled.expedition.status, definition.id).not.toBe("approaching");
      expect(settled.expedition.status, definition.id).not.toBe("resolving");
    }
  });
});

describe("encounter duration variance", () => {
  /** Collects the committed duration of the first encounter for many seeds. */
  function firstEncounterCosts(seeds: number[]): Array<{ durability: number | null; resolve: number | null }> {
    return seeds.map((seed) => {
      const state = tickUntil(
        launched(seed),
        (current) => current.expedition.currentEncounter !== null,
      );
      const encounter = state.expedition.currentEncounter as ActiveEncounter;

      return {
        durability: encounter.durabilityRemaining,
        resolve: encounter.resolveDurationMs,
      };
    });
  }

  it("varies the ore node's durability rather than a fixed duration", () => {
    const costs = firstEncounterCosts([1, 2, 3, 4, 5, 6, 7, 8]);
    const durabilities = costs.map((cost) => cost.durability ?? 0);

    // The first encounter is always the shallow ore node, so any spread here is
    // the committed variance and nothing else.
    expect(new Set(durabilities).size).toBeGreaterThan(1);
    // Ore has no fixed resolve duration; break time comes from durability.
    expect(costs.every((cost) => cost.resolve === null)).toBe(true);
  });

  it("keeps every varied duration inside the configured band", () => {
    const base = ENCOUNTERS[FIRST_ENCOUNTER_ID].durability ?? 0;
    const spread = ECONOMY.encounterDurationVariance;

    for (const cost of firstEncounterCosts([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])) {
      expect(cost.durability).toBeGreaterThanOrEqual(base * (1 - spread) - 1e-6);
      expect(cost.durability).toBeLessThanOrEqual(base * (1 + spread) + 1e-6);
    }
  });

  it("commits the duration once, so the same seed always costs the same", () => {
    const [first] = firstEncounterCosts([42]);
    const [again] = firstEncounterCosts([42]);

    expect(first.durability).toBe(again.durability);
  });

  it("varies a chosen option's duration at the moment it is committed", () => {
    const durations = new Set<number>();

    for (const seed of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const base = createGameState({ nowUnixMs: 0, seed });
      const definition = ENCOUNTERS["encounter.choice.shelf.fissure"];
      const staged: GameState = {
        ...reduce(base, { type: "LAUNCH_EXPEDITION" }).state,
      };

      const withChoice: GameState = {
        ...staged,
        expedition: {
          ...staged.expedition,
          status: "choice",
          currentEncounter: {
            encounterId: definition.id,
            approachElapsedMs: definition.approachDurationMs,
            approachDurationMs: definition.approachDurationMs,
            resolveElapsedMs: 0,
            strikesTaken: 0,
            resolveDurationMs: null,
            durabilityRemaining: null,
            oxygenDrainMultiplier: definition.oxygenDrainMultiplier,
            chosenOptionId: null,
            committedReward: null,
          },
        },
      };

      const chosen = reduce(withChoice, {
        type: "CHOOSE_ENCOUNTER_OPTION",
        optionId: "commit",
      }).state;

      durations.add(chosen.expedition.currentEncounter?.resolveDurationMs ?? 0);
    }

    expect(durations.size).toBeGreaterThan(1);
  });
});

describe("a run in the Selenite Core is on a clock", () => {
  /*
   * With an oxygen encounter in the core, a maxed run could refill faster than
   * it drained and never come back.
   *
   * It plays the *most* oxygen-efficient line available rather than the greedy
   * one `playUntilDepth` takes, because the greedy line terminates trivially.
   * The claim being pinned is that the core terminates under optimal play, not
   * that it terminates under careless play.
   */
  const CORE_DEPTH = DEPTH_BANDS["band.core"].minimum;
  const MAX_TANK = GEAR.tank.levels[GEAR.tank.levels.length - 1].level;
  const MAX_PICKAXE = GEAR.pickaxe.levels[GEAR.pickaxe.levels.length - 1].level;

  /**
   * A launched run with maxed gear, dropped into the core with a full tank.
   *
   * The pickaxe matters as much as the tank here, which was not obvious. Core
   * ore has the durability the deepest band deserves, so a level-1 pickaxe
   * spends minutes of oxygen on a single seam and the run dies of the tool
   * rather than of the band. Measured on seed 3: 15 depths past the core on the
   * starting pickaxe against 135 on a maxed one, which is a fact about the tool
   * and not about what this test is trying to say.
   */
  function inTheCore(seed: number): GameState {
    const base = createGameState({ nowUnixMs: 0, seed });
    const geared: GameState = {
      ...base,
      gear: { ...base.gear, tankLevel: MAX_TANK, pickaxeLevel: MAX_PICKAXE },
    };
    const launched = tick(
      reduce(geared, { type: "LAUNCH_EXPEDITION" }).state,
      ECONOMY.launchTransitionMs,
    );

    return {
      ...launched,
      expedition: {
        ...launched.expedition,
        depth: CORE_DEPTH,
        oxygen: launched.expedition.maxOxygenSnapshot,
      },
    };
  }

  /**
   * Plays on forever, always choosing the branch that costs the least oxygen.
   *
   * Returns how many depths it managed and the lowest oxygen seen, plus whether
   * oxygen ever went *up* — which in the core is the invariant failing rather
   * than the run doing well.
   */
  function surviveAsLongAsPossible(state: GameState, maxSteps = 400_000) {
    let current = state;
    let previousOxygen = current.expedition.oxygen;
    let refilled = false;
    // Recorded as it goes: banking or failing returns to the surface and resets
    // depth to zero, so reading it from the final state measures nothing.
    let deepest = current.expedition.depth;

    for (let step = 0; step < maxSteps; step += 1) {
      if (current.expedition.status === "surface") {
        return { current, refilled, deepest, ended: true };
      }

      if (current.expedition.status === "decision") {
        current = reduce(current, { type: "CONTINUE_EXPEDITION" }).state;
      } else if (current.expedition.status === "choice") {
        const definition = ENCOUNTERS[current.expedition.currentEncounter!.encounterId];
        const cheapest = [...(definition.choiceOptions ?? [])].sort(
          (left, right) =>
            left.oxygenCost +
            (left.oxygenDrainMultiplier * left.resolveDurationMs) / 1000 -
            (right.oxygenCost + (right.oxygenDrainMultiplier * right.resolveDurationMs) / 1000),
        )[0];

        current = reduce(current, {
          type: "CHOOSE_ENCOUNTER_OPTION",
          optionId: cheapest?.id ?? "",
        }).state;
      } else {
        current = tick(current, 100);
      }

      deepest = Math.max(deepest, current.expedition.depth);

      /*
       * Read after every transition, not once per depth: a grant lands inside an
       * encounter, so sampling per depth could step straight over one.
       *
       * Only while the run is still underway. Coming back to the surface is not
       * a refill, and counting it as one would make this assertion pass for the
       * wrong reason on the tick that ends the run.
       */
      if (
        current.expedition.status !== "surface" &&
        current.expedition.oxygen > previousOxygen + 1e-9
      ) {
        refilled = true;
      }

      previousOxygen = current.expedition.oxygen;
    }

    return { current, refilled, deepest, ended: false };
  }

  it("ends the run rather than running forever, on every seed tried", () => {
    for (const seed of [3, 17, 101, 4_242, 90_210]) {
      const { current, ended, deepest } = surviveAsLongAsPossible(inTheCore(seed));

      expect(ended, `seed ${seed} never came back`).toBe(true);
      expect(current.expedition.status, `seed ${seed}`).toBe("surface");
      // And it got somewhere first, rather than "terminating" by failing on the
      // step it entered the core.
      expect(deepest, `seed ${seed}`).toBeGreaterThan(CORE_DEPTH);
    }
  });

  it("never lets oxygen rise once the core is reached", () => {
    /*
     * The property underneath the termination. Monotone decrease is what makes
     * ending inevitable rather than merely likely on the seeds that were tried,
     * so this is the assertion that would survive a table reweighting.
     */
    for (const seed of [3, 17, 101, 4_242, 90_210]) {
      expect(surviveAsLongAsPossible(inTheCore(seed)).refilled, `seed ${seed}`).toBe(false);
    }
  });

  it("bounds how far past the core a full maxed tank reaches", () => {
    /*
     * A number worth knowing rather than a rule: it is how much the deepest gear
     * actually buys, and a change that moves it a long way has changed what the
     * core is for.
     *
     * Measured across these seeds: 135, 125, 148, 44, 98 depths past the core,
     * so a maxed run entering at 100 with a full tank finishes somewhere around
     * 145-250. The bounds are wide of that on purpose — the spread across seeds
     * is already 3x, so a tight bound would be pinning the seeds rather than the
     * band.
     */
    const depths = [3, 17, 101, 4_242, 90_210].map(
      (seed) => surviveAsLongAsPossible(inTheCore(seed)).deepest - CORE_DEPTH,
    );

    for (const depth of depths) {
      expect(depth).toBeGreaterThan(25);
      expect(depth).toBeLessThan(300);
    }
  });
});

/**
 * What a run keeps rather than carries.
 *
 * Two things a run produces are not cargo: selenite from a find that could no
 * longer improve the item it duplicated, and a cat. Both land permanently the
 * moment they happen. The risk this covers is that they get treated as cargo
 * anyway — counted toward the chips a safe return pays, or lost when the air
 * runs out — either of which would be a lie the panel tells.
 */
describe("run keepsakes", () => {
  const maxedTrinketReward = (state: GameState): GameState => ({
    ...state,
    collection: {
      ...state.collection,
      trinkets: Object.fromEntries(
        Object.entries(state.collection.trinkets).map(([id, progress]) => [
          id,
          { ...progress, owned: true, grade: HIGHEST_GRADE },
        ]),
      ) as GameState["collection"]["trinkets"],
    },
  });

  it("starts every run at zero", () => {
    const run = launched();

    expect(run.expedition.runKeepsakes).toEqual({ selenite: 0, cats: 0 });
  });

  it("counts selenite from a find that was already at its best", () => {
    /*
     * The reward is staged rather than played for. A first version ran a real
     * expedition and asserted inside an `if` — and measured across four seeds,
     * those runs reach depth 5 and find no collectible at all, so the assertion
     * never fired and the test passed by doing nothing.
     *
     * What is under test is that `grant.arrival === "selenite"` is what feeds
     * the counter, so `arrival` is what the test sets.
     */
    const resolving = tickUntil(
      launched(3),
      (current) => current.expedition.status === "resolving",
    );
    const encounter = resolving.expedition.currentEncounter as ActiveEncounter;
    const staged: GameState = {
      ...maxedTrinketReward(resolving),
      expedition: {
        ...resolving.expedition,
        currentEncounter: {
          ...encounter,
          // One millisecond short, so the very next tick completes it.
          resolveElapsedMs: (encounter.resolveDurationMs ?? 0) - 1,
          durabilityRemaining: null,
          committedReward: {
            tableId: "test",
            entryId: "test",
            tags: [],
            grants: [
              {
                kind: "collectible",
                reward: { kind: "trinket", trinketId: TRINKET_IDS[0] },
                arrival: "selenite",
              },
            ],
          },
        },
      },
    };

    const seleniteBefore = staged.resources.selenite;
    const after = tick(staged, 1_000);

    expect(after.expedition.runKeepsakes.selenite).toBe(ECONOMY.selenitePerMaxedDuplicate);
    // Counted once, and matching what the balance actually gained.
    expect(after.resources.selenite - seleniteBefore).toBe(
      after.expedition.runKeepsakes.selenite,
    );
  });

  it("leaves the counter alone for a find that was not maxed", () => {
    // The other half: fragments and first finds are progression too, but they
    // are not selenite and must not be reported as it.
    const resolving = tickUntil(
      launched(3),
      (current) => current.expedition.status === "resolving",
    );
    const encounter = resolving.expedition.currentEncounter as ActiveEncounter;
    const staged: GameState = {
      ...resolving,
      expedition: {
        ...resolving.expedition,
        currentEncounter: {
          ...encounter,
          resolveElapsedMs: (encounter.resolveDurationMs ?? 0) - 1,
          durabilityRemaining: null,
          committedReward: {
            tableId: "test",
            entryId: "test",
            tags: [],
            grants: [
              {
                kind: "collectible",
                reward: { kind: "trinket", trinketId: TRINKET_IDS[0] },
                arrival: "item",
              },
            ],
          },
        },
      },
    };

    expect(tick(staged, 1_000).expedition.runKeepsakes.selenite).toBe(0);
  });

  it("shows what is kept apart from what is carried", () => {
    const run = launched(3);
    const carrying: GameState = {
      ...run,
      expedition: {
        ...run.expedition,
        status: "decision",
        runInventory: { ...createEmptyRunInventory(), ore: { dust: 40, seam: 0, core: 0 } },
        runKeepsakes: { selenite: 2, cats: 1 },
      },
      collection: { ...run.collection, cats: [{ skinId: DEFAULT_CAT_SKIN_IDS[0] }] },
    };

    const view = selectExpeditionView(deriveContext(carrying)).runInventory;

    expect(view.items.every((item) => !item.secured)).toBe(true);
    expect(view.secured.map((item) => item.key)).toEqual([
      "keepsake:selenite",
      "keepsake:cats",
    ]);

    /*
     * The chips line is about the cargo, and must stay about only the cargo.
     * Compared against the same run with nothing kept rather than against a
     * number written here — a literal would have been a second copy of the ore
     * price, and a first attempt at one used a constant that does not exist and
     * passed by falling back to 1.
     */
    const withoutKeepsakes: GameState = {
      ...carrying,
      expedition: { ...carrying.expedition, runKeepsakes: { selenite: 0, cats: 0 } },
    };

    expect(view.chipsIfBanked).toBe(
      selectExpeditionView(deriveContext(withoutKeepsakes)).runInventory.chipsIfBanked,
    );
    expect(view.chipsIfBanked).toBeGreaterThan(0);
    expect(view.isEmpty).toBe(false);
  });

  it("draws the cat it actually met", () => {
    // Not a generic cat icon: the shelf downstairs will show this same one.
    const run = launched(3);
    const withCat: GameState = {
      ...run,
      expedition: { ...run.expedition, runKeepsakes: { selenite: 0, cats: 1 } },
      collection: { ...run.collection, cats: [{ skinId: "cat.tophat" }] },
    };

    const secured = selectExpeditionView(deriveContext(withCat)).runInventory.secured;

    expect(secured[0].spriteId).toBe(CAT_SKINS["cat.tophat"].restSpriteId);
  });

  it("says nothing at all when a run has produced nothing", () => {
    const view = selectExpeditionView(deriveContext(launched())).runInventory;

    expect(view.items).toEqual([]);
    expect(view.secured).toEqual([]);
    expect(view.isEmpty).toBe(true);
  });

  it("keeps them through an oxygen failure that takes the cargo", () => {
    /*
     * The whole point of the split. A failure rolls every unbanked unit; these
     * were never unbanked, so they must survive a run that comes home with
     * nothing.
     */
    // Resolving, not deciding: oxygen only drains while the run is moving, so a
    // run parked at a decision never fails however little air it has.
    const resolving = tickUntil(
      launched(3),
      (current) => current.expedition.status === "resolving",
    );
    const doomed: GameState = {
      ...resolving,
      expedition: {
        ...resolving.expedition,
        oxygen: 1,
        runInventory: { ...createEmptyRunInventory(), ore: { dust: 25, seam: 0, core: 0 } },
        runKeepsakes: { selenite: 4, cats: 1 },
      },
    };

    const failed = tickUntil(doomed, (current) => current.expedition.status === "surface");

    expect(failed.expedition.status).toBe("surface");
    // The counters reset with the run, but the *progression* they described is
    // in the balances, which the failure never touched.
    expect(failed.expedition.runKeepsakes).toEqual({ selenite: 0, cats: 0 });
    expect(failed.resources.selenite).toBe(doomed.resources.selenite);
  });

  it("resets on the next launch", () => {
    const run = launched(3);
    const used: GameState = {
      ...run,
      expedition: { ...run.expedition, runKeepsakes: { selenite: 9, cats: 2 } },
    };
    const home = { ...used, expedition: { ...used.expedition, status: "surface" as const } };
    const again = reduce(home, { type: "LAUNCH_EXPEDITION" }).state;

    expect(again.expedition.runKeepsakes).toEqual({ selenite: 0, cats: 0 });
  });
});

/**
 * The launch button waits for the first machine level.
 *
 * A view rule rather than a domain rule, and the tests say so: `canLaunch`
 * refuses, `LAUNCH_EXPEDITION` does not. That split is deliberate — this is
 * first-run pacing, and putting it in the reducer would make every balance
 * simulation buy a machine level to satisfy an onboarding concern.
 */
describe("the first descent waits for the first upgrade", () => {
  const canLaunch = (state: GameState) => selectExpeditionView(deriveContext(state)).canLaunch;

  const played = (state: GameState): GameState => ({
    ...state,
    onboarding: { ...state.onboarding, hasPurchasedMachineLevel: true },
  });

  it("refuses on a save that has never bought a level, and says why", () => {
    const fresh = createGameState({ nowUnixMs: 0, seed: 5 });

    expect(fresh.onboarding.hasPurchasedMachineLevel).toBe(false);
    expect(canLaunch(fresh)).toEqual({
      available: false,
      reason: "Buy your first machine level before you go down.",
    });
  });

  it("allows it once a level has been bought", () => {
    expect(canLaunch(played(createGameState({ nowUnixMs: 0, seed: 5 })))).toEqual({
      available: true,
      reason: null,
    });
  });

  it("is the purchase that opens it, not the tutorial", () => {
    /*
     * `TECHNICAL_IMPLEMENTATION.md` forbids tutorial state from gating
     * progression. This gate reads a flag the purchase sets, so a save whose
     * tutorial was skipped is gated identically — and opens identically.
     */
    const fresh = createGameState({ nowUnixMs: 0, seed: 5 });
    const skipped: GameState = {
      ...fresh,
      onboarding: {
        ...fresh.onboarding,
        tutorial: { ...fresh.onboarding.tutorial, status: "skipped", activeActId: null },
      },
    };

    expect(canLaunch(skipped).available).toBe(false);
    expect(canLaunch(played(skipped)).available).toBe(true);
  });

  it("still reports a run in flight ahead of the upgrade", () => {
    // Both conditions can hold at once on a hand-edited save, and "an expedition
    // is already under way" is the one the player needs.
    const run = launched();
    const never: GameState = {
      ...run,
      onboarding: { ...run.onboarding, hasPurchasedMachineLevel: false },
    };

    expect(canLaunch(played(run)).reason).toBe("An expedition is already under way.");
    expect(canLaunch(never).reason).toBe("An expedition is already under way.");
  });

  it("does not stop the command, which is a rule about the button", () => {
    const fresh = createGameState({ nowUnixMs: 0, seed: 5 });
    const result = reduce(fresh, { type: "LAUNCH_EXPEDITION" });

    expect(result.state.expedition.status).not.toBe("surface");
    expect(result.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(false);
  });
});
