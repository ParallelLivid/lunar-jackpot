/**
 * Coverage for the collectibles that reach into the expedition loop.
 *
 * Four of the five new effects reach into the expedition loop rather than into
 * a number on a panel, so the tests that matter are the ones that watch a run:
 * that a strike is a discrete event whose timing does not depend on the frame
 * rate, that a drain reduction still leaves a run finite, that speed shortens
 * the walk and not the work, and that a totem answering a fork answers it the
 * same way on a reload as it did before one.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, ENCOUNTERS, TOTEMS, TRINKETS } from "../../content/catalog";
import type { TotemId, TrinketId } from "../../content/catalog";
import { scaleModifiers } from "../../content/grades";
import { createActiveEncounter } from "../../domain/encounters";
import { createRunModifierSnapshot } from "../../domain/expedition";
import { collectActiveModifiers, evaluateStat, selectResolvesChoices } from "../../domain/modifiers";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;

/** A state with the given collectibles owned at grade E and equipped. */
function equipped(ids: { trinkets?: TrinketId[]; totems?: TotemId[] }, seed = 7): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });
  const trinkets = ids.trinkets ?? [];
  const totems = ids.totems ?? [];

  return {
    ...base,
    gear: {
      ...base.gear,
      // Both new tank trinkets and both new pickaxe ones go in the tank slots:
      // nothing in the modifier pipeline reads which side a slot is on, so the
      // helper stays indifferent to what a trinket targets.
      tankTrinketSlots: [...trinkets, null, null].slice(0, 3),
      pickaxeTrinketSlots: [null, null, null],
    },
    collection: {
      ...base.collection,
      trinkets: {
        ...base.collection.trinkets,
        ...Object.fromEntries(
          trinkets.map((id) => [id, { owned: true, grade: "E" as const, fragments: 0 }]),
        ),
      },
      totems: {
        ...base.collection.totems,
        ...Object.fromEntries(
          totems.map((id) => [id, { owned: true, grade: "E" as const, fragments: 0 }]),
        ),
      },
      activeTotemIds: [...totems, null, null].slice(0, 3),
    },
    settings: {
      ...base.settings,
      autoContinue: { enabled: true, oxygenThresholdRatio: 0.1 },
    },
  };
}

/**
 * Strikes taken to break one seam at a given crit chance.
 *
 * Drives a single encounter rather than a whole run: the crit rate is a property
 * of the strike loop, and a full run would fold in encounter generation and
 * oxygen failure, which have nothing to do with it.
 */
function strikesToBreak(critChance: number, seed: number): number {
  const launched = reduce(equipped({}, seed), { type: "LAUNCH_EXPEDITION" }).state;
  const definition = ENCOUNTERS["encounter.ore.shelf.light"];

  let current: GameState = {
    ...launched,
    expedition: {
      ...launched.expedition,
      status: "resolving",
      // Deep enough that no realistic number of strikes runs the tank dry, so
      // every sample ends in a broken seam rather than a failed run.
      oxygen: 100_000,
      maxOxygenSnapshot: 100_000,
      modifierSnapshot:
        launched.expedition.modifierSnapshot === null
          ? null
          : { ...launched.expedition.modifierSnapshot, pickaxeCritChance: critChance },
      currentEncounter: createActiveEncounter(definition, 1, 1),
    },
  };

  for (let frame = 0; frame < 2_000; frame += 1) {
    const encounter = current.expedition.currentEncounter;

    if (encounter === null || encounter.encounterId !== definition.id) {
      break;
    }

    current = reduce(current, {
      type: "TICK",
      casinoElapsedMs: 100,
      expeditionElapsedMs: 100,
      nowUnixMs: current.lastSettledAtUnixMs + 100,
    }).state;

    if (current.expedition.currentEncounter?.durabilityRemaining === 0) {
      return current.expedition.currentEncounter.strikesTaken;
    }
  }

  return Number.NaN;
}

/** Every option a run committed to, in the order it committed to them. */
function choicesTaken(state: GameState): string[] {
  let current = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;
  const taken: string[] = [];
  let last: string | null = null;

  for (let frame = 0; frame < 400; frame += 1) {
    current = reduce(current, {
      type: "TICK",
      casinoElapsedMs: 250,
      expeditionElapsedMs: 250,
      nowUnixMs: current.lastSettledAtUnixMs + 250,
    }).state;

    const chosen = current.expedition.currentEncounter?.chosenOptionId ?? null;

    if (chosen !== null && chosen !== last) {
      taken.push(chosen);
    }

    last = chosen;
  }

  return taken;
}

/** Launches and ticks a run in slices of `frameMs`. */
function runFrames(state: GameState, frames: number, frameMs: number): GameState {
  let current = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

  for (let frame = 0; frame < frames; frame += 1) {
    current = reduce(current, {
      type: "TICK",
      casinoElapsedMs: frameMs,
      expeditionElapsedMs: frameMs,
      nowUnixMs: current.lastSettledAtUnixMs + frameMs,
    }).state;
  }

  return current;
}

describe("striking rock", () => {
  it("counts the same strikes however the time is sliced", () => {
    /*
     * Strikes are derived from total elapsed resolve time rather than
     * accumulated per frame, so a 60fps client and a 2fps one break the same
     * rock at the same moment. Counting per slice would round down once per
     * frame instead, and the fast client would mine measurably slower.
     */
    const coarse = runFrames(equipped({}), 4, 500);
    const fine = runFrames(equipped({}), 40, 50);

    expect(fine.expedition.depth).toBe(coarse.expedition.depth);
    expect(fine.expedition.currentEncounter?.strikesTaken).toBe(
      coarse.expedition.currentEncounter?.strikesTaken,
    );
    expect(fine.expedition.currentEncounter?.durabilityRemaining ?? 0).toBeCloseTo(
      coarse.expedition.currentEncounter?.durabilityRemaining ?? 0,
      6,
    );
  });

  it("takes a whole strike interval to land the first blow", () => {
    // The observable difference between an event and a rate: part-way into the
    // first interval nothing has been struck yet.
    const partial = runFrames(equipped({}), 1, ECONOMY.pickaxeStrikeIntervalMs / 4);
    const encounter = partial.expedition.currentEncounter;

    expect(encounter?.strikesTaken ?? 0).toBe(0);
  });

  it("reads the impact fuse as a real crit chance", () => {
    expect(
      evaluateStat(0, collectActiveModifiers(equipped({ trinkets: ["trinket.impact-fuse"] })), {
        targetStat: "gear.pickaxeCritChance",
      }),
    ).toBeCloseTo(0.05, 6);
  });

  it("crits at close to the rate it advertises", () => {
    /*
     * Measured rather than asserted from the formula: a seam is broken to
     * completion at 0% and at 50%, over enough seeds that the mean is stable,
     * and 50% has to buy about 50% more damage per strike — which shows as
     * about two thirds of the strikes.
     *
     * Uses `toBeCloseTo(..., 1)` on the ratio because these are 120 sampled runs
     * and not an integral; the point is that the rate is what the trinket says,
     * not that the sampler is exact.
     */
    const meanStrikes = (critChance: number): number => {
      let total = 0;

      for (let seed = 1; seed <= 120; seed += 1) {
        total += strikesToBreak(critChance, seed);
      }

      return total / 120;
    };

    expect(meanStrikes(0.5) / meanStrikes(0)).toBeCloseTo(1 / 1.5, 1);
  });

  it("never makes every strike a critical one, at any grade", () => {
    // The clamp is what keeps a crit an event. At SSS the fuse is still a roll,
    // not a flat damage multiplier that happens to play a sound.
    const definition = TRINKETS["trinket.impact-fuse"];
    const chance = evaluateStat(0, scaleModifiers(definition.baseModifiers, "SSS"), {
      targetStat: "gear.pickaxeCritChance",
    });

    expect(chance).toBeGreaterThan(0.05);
    expect(chance).toBeLessThan(1);
  });
});

describe("the scrubber coil", () => {
  it("leaves more air after the same run", () => {
    const plain = runFrames(equipped({}, 33), 30, 250);
    const scrubbed = runFrames(equipped({ trinkets: ["trinket.scrubber-coil"] }, 33), 30, 250);

    expect(scrubbed.expedition.oxygen).toBeGreaterThan(plain.expedition.oxygen);
  });

  it("compounds across grades without ever reaching zero drain", () => {
    /*
     * The first content authored below 1, so this pins the compounding branch:
     * eight grades of a 6% reduction must stay a reduction rather than crossing
     * into negative drain, which would be a run that gains air by descending.
     */
    const definition = TRINKETS["trinket.scrubber-coil"];
    const rateAt = (grade: Parameters<typeof scaleModifiers>[1]): number =>
      evaluateStat(1, scaleModifiers(definition.baseModifiers, grade), {
        targetStat: "expedition.oxygenDrainRate",
      });

    expect(rateAt("SSS")).toBeLessThan(rateAt("E"));
    expect(rateAt("SSS")).toBeGreaterThan(0);
  });
});

describe("the ballast harness", () => {
  it("shortens the walk to an encounter", () => {
    const definition = ENCOUNTERS["encounter.ore.shelf.light"];
    const speed = evaluateStat(
      1,
      collectActiveModifiers(equipped({ trinkets: ["trinket.ballast-harness"] })),
      { targetStat: "expedition.approachSpeed" },
    );

    expect(speed).toBeGreaterThan(1);
    expect(createActiveEncounter(definition, 1, speed).approachDurationMs).toBeLessThan(
      createActiveEncounter(definition, 1, 1).approachDurationMs,
    );
  });

  it("leaves the encounter itself exactly as long", () => {
    // Speed buys back travel time, not work time — otherwise it is a damage
    // stat and a reward-rate stat wearing a movement name.
    const definition = ENCOUNTERS["encounter.ore.shelf.light"];
    const fast = createActiveEncounter(definition, 1, 4);
    const slow = createActiveEncounter(definition, 1, 1);

    expect(fast.durabilityRemaining).toBe(slow.durabilityRemaining);
    expect(fast.resolveDurationMs).toBe(slow.resolveDurationMs);
  });
});

describe("the dowsing bone", () => {
  // Seed 2 is one that reaches a fork on starter gear, which is what makes the
  // pair of tests below a comparison rather than a coincidence.
  const CHOICE_SEED = 2;
  const carrying = (seed = CHOICE_SEED): GameState =>
    equipped({ totems: ["totem.dowsing-bone"] }, seed);

  it("is the only totem that resolves choices", () => {
    // Capabilities are one-per-totem by content rule — a second bone would be a
    // wasted slot — so this checks the rule holds for this capability rather
    // than that the bone is the only totem carrying any capability at all.
    const resolving = Object.values(TOTEMS).filter(
      (totem) => totem.capability === "resolve-choices",
    );

    expect(resolving.map((totem) => totem.id)).toEqual(["totem.dowsing-bone"]);
    expect(selectResolvesChoices(carrying())).toBe(true);
    expect(selectResolvesChoices(equipped({}))).toBe(false);
    // The eye is equipped in the same kind of slot and must not resolve forks.
    expect(selectResolvesChoices(equipped({ totems: ["totem.cartographer"] }))).toBe(false);
  });

  it("answers a fork without the player being asked", () => {
    /*
     * A run carrying the bone must never come to rest in `choice`. Long enough
     * to pass several encounters, and with auto-continue on, so nothing else can
     * be what is keeping the run moving.
     */
    let current = reduce(carrying(), { type: "LAUNCH_EXPEDITION" }).state;
    let sawChoice = false;

    for (let frame = 0; frame < 400; frame += 1) {
      current = reduce(current, {
        type: "TICK",
        casinoElapsedMs: 250,
        expeditionElapsedMs: 250,
        nowUnixMs: current.lastSettledAtUnixMs + 250,
      }).state;
      sawChoice ||= current.expedition.status === "choice";
    }

    expect(sawChoice).toBe(false);
  });

  it("leaves a fork standing without one", () => {
    // The other half of the previous test: the same seed does stop to ask when
    // nothing is equipped, so it is the totem doing the work and not the seed.
    let current = reduce(equipped({}, CHOICE_SEED), { type: "LAUNCH_EXPEDITION" }).state;
    let sawChoice = false;

    for (let frame = 0; frame < 400; frame += 1) {
      current = reduce(current, {
        type: "TICK",
        casinoElapsedMs: 250,
        expeditionElapsedMs: 250,
        nowUnixMs: current.lastSettledAtUnixMs + 250,
      }).state;
      sawChoice ||= current.expedition.status === "choice";
    }

    expect(sawChoice).toBe(true);
  });

  it("draws without preference rather than always taking the first option", () => {
    /*
     * The trade the totem sells. A bone that quietly took option one every time
     * would be strictly better than one that gambles, and the note that it "does
     * not play it well" would be false — so this checks the distribution, not
     * just that something got picked.
     */
    const picks = new Map<string, number>();

    for (let seed = 1; seed <= 150; seed += 1) {
      for (const option of choicesTaken(carrying(seed))) {
        picks.set(option, (picks.get(option) ?? 0) + 1);
      }
    }

    const counts = [...picks.values()];
    const total = counts.reduce((sum, count) => sum + count, 0);

    expect(total).toBeGreaterThan(50);
    expect(picks.size).toBeGreaterThan(1);
    // No option may take more than three quarters of the draws. Loose, because
    // several different forks contribute and they do not share option ids.
    expect(Math.max(...counts) / total).toBeLessThan(0.75);
  });

  it("makes the same picks from the same seed", () => {
    // The draw comes off the run's own generation stream, so it is part of the
    // seed rather than of when a frame happened to land.
    expect(choicesTaken(carrying(CHOICE_SEED))).toEqual(choicesTaken(carrying(CHOICE_SEED)));
    expect(choicesTaken(carrying(CHOICE_SEED)).length).toBeGreaterThan(0);
  });

  it("still carries an effect for its grades to scale", () => {
    // A capability is the same at every grade. Without a modifier alongside it,
    // grades D through SSS would buy nothing at all.
    const definition = TOTEMS["totem.dowsing-bone"];

    expect(definition.baseModifiers.length).toBeGreaterThan(0);
    expect(
      evaluateStat(1, scaleModifiers(definition.baseModifiers, "SSS"), {
        targetStat: "expedition.oreYield",
      }),
    ).toBeGreaterThan(
      evaluateStat(1, scaleModifiers(definition.baseModifiers, "E"), {
        targetStat: "expedition.oreYield",
      }),
    );
  });

  it("commits the capability at launch, so unequipping cannot strand a run", () => {
    const launched = reduce(carrying(), { type: "LAUNCH_EXPEDITION" }).state;
    const unequipped: GameState = {
      ...launched,
      collection: { ...launched.collection, activeTotemIds: [null, null, null] },
    };

    expect(unequipped.expedition.modifierSnapshot?.resolvesChoices).toBe(true);
    expect(selectResolvesChoices(unequipped)).toBe(false);
  });

  it("survives a reload mid-run", () => {
    const launched = reduce(carrying(), { type: "LAUNCH_EXPEDITION" }).state;
    const restored = normalizeGameState(createEnvelope(launched, 1, NOW).game, NOW).state;

    expect(restored.expedition.modifierSnapshot?.resolvesChoices).toBe(true);
  });
});

describe("the run snapshot", () => {
  it("defaults every chunk 11 field for a run that predates them", () => {
    // Defaulted rather than recomputed: a run in flight when the update landed
    // finishes under the rules it started on.
    const snapshot = createRunModifierSnapshot([]);

    expect(snapshot.oxygenDrainRate).toBe(1);
    expect(snapshot.approachSpeed).toBe(1);
    expect(snapshot.pickaxeCritChance).toBe(0);
    expect(snapshot.resolvesChoices).toBe(false);
  });
});
