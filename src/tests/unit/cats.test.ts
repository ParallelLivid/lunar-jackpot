/**
 * Coverage for cats.
 *
 * The one rule that matters is that the rate is genuinely fixed. Everything else
 * in the encounter system is weighted, luck-boosted, or pity-adjusted, so the
 * tests here are mostly about proving that none of that reaches the cat.
 */

import { describe, expect, it } from "vitest";
import { CAT_ENCOUNTER_ID, ECONOMY, ENCOUNTERS } from "../../content/catalog";
import { CAT_SKINS, CAT_SKIN_IDS, DEFAULT_CAT_SKIN_IDS } from "../../content/catSkins";
import { MAXIMUM_PACE_RANK } from "../../content/prestigePerks";
import { selectExpeditionSpeed } from "../../domain/prestige";
import { reconcileCats } from "../../domain/cats";
import { createActiveEncounter } from "../../domain/encounters";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectExpeditionView } from "../../domain/selectors";
import { SPRITES } from "../../rendering/sprites";
import { runMigrations } from "../../persistence/migrations";
import { SAVE_VERSION, normalizeGameState } from "../../persistence/saveSchema";
import { generateEncounter } from "../../domain/encounters";
import { collectActiveModifiers, selectLuckPoints } from "../../domain/modifiers";
import { applyPrestige } from "../../domain/prestige";
import { createRngState } from "../../domain/rng";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(seed = 5): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** Observed cat rate over `samples` generations at a given luck and depth. */
function catRate(state: GameState, samples: number, luckPoints: number, depth: number): number {
  let cats = 0;

  for (let seed = 1; seed <= samples; seed += 1) {
    const generated = generateEncounter(
      state,
      createRngState(seed, "expedition-generation"),
      depth,
      collectActiveModifiers(state),
      luckPoints,
    );

    if (generated.encounter?.encounterId === CAT_ENCOUNTER_ID) {
      cats += 1;
    }
  }

  return cats / samples;
}

describe("meeting a cat", () => {
  it("happens at the configured rate", () => {
    const samples = 60_000;
    const rate = catRate(fresh(), samples, 0, 5);

    expect(ECONOMY.catEncounterChance).toBe(0.001);
    // Within a factor that a 60k sample can actually resolve.
    expect(rate).toBeGreaterThan(0.0005);
    expect(rate).toBeLessThan(0.0018);
  });

  it("is no commoner with luck, however much of it there is", () => {
    /*
     * This is the whole point of the pre-roll. As a table entry the cat would be
     * a relative weight, so luck, totems, pity and the size of the eligible pool
     * would all move it; drawn on its own constant, none of them can.
     */
    const state = fresh();
    const samples = 40_000;

    const none = catRate(state, samples, 0, 5);
    const plenty = catRate(state, samples, ECONOMY.luckPointCap, 5);

    expect(none).toBe(plenty);
  });

  it("is no commoner deeper down", () => {
    const state = fresh();
    const samples = 40_000;

    expect(catRate(state, samples, 0, 0)).toBe(catRate(state, samples, 0, 120));
  });

  it("is never drawn from the weighted table", () => {
    // Inert in the table, so the pre-roll is its only route in.
    const definition = ENCOUNTERS[CAT_ENCOUNTER_ID];

    expect(definition.outsideTable).toBe(true);
    expect(definition.baseWeight).toBe(0);
    expect(definition.beneficialTags).toEqual([]);
    expect(definition.bands).toEqual([]);
  });
});

describe("what a cat is worth", () => {
  function withCats(count: number): GameState {
    const base = fresh();

    return { ...base, statistics: { ...base.statistics, catsFound: count } };
  }

  it("adds its luck permanently, and exactly", () => {
    expect(selectLuckPoints(collectActiveModifiers(withCats(0)))).toBe(0);

    for (const count of [1, 3, 10, 40]) {
      expect(selectLuckPoints(collectActiveModifiers(withCats(count)))).toBe(
        count * ECONOMY.luckPerCat,
      );
    }
  });

  it("survives prestige", () => {
    /*
     * Load-bearing, and it rests on an omission: `applyPrestige` spreads the
     * previous state and never overrides `statistics`. Worth a test precisely
     * because nothing in that function mentions cats.
     */
    const base = withCats(7);
    const ready: GameState = {
      ...base,
      resources: { ...base.resources, cash: 400_000 },
      prestige: { ...base.prestige, cycleCashEarned: 600_000, lifetimeCashEarned: 600_000 },
    };

    const outcome = applyPrestige(ready);

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.statistics.catsFound).toBe(7);
      expect(selectLuckPoints(collectActiveModifiers(outcome.state))).toBe(
        7 * ECONOMY.luckPerCat,
      );
    }
  });

  it("is worth enough to be a mechanic rather than a trophy", () => {
    // Ten cats should be a real share of the luck curve, not a rounding error.
    const factorAt = (count: number): number => {
      const points = count * ECONOMY.luckPerCat;

      return points / (points + ECONOMY.luckDiminishingHalfPoint);
    };

    expect(factorAt(10)).toBeGreaterThan(0.4);
  });
});

// ---------------------------------------------------------------------------
// Cats as entities that wear a skin.

/**
 * A run under way, at the speed asked for.
 *
 * The pace perk has to be granted as well as the setting chosen.
 * `selectExpeditionSpeed` clamps the setting to what the tree has paid for on
 * every read, so setting `expeditionSpeed: 32` on a fresh save runs at 1x — and
 * a speed test that quietly runs at 1x twice passes while proving nothing.
 * Confirmed the hard way: the pause test below passed against a deliberately
 * broken, run-time pause until the perk was added.
 */
function launchedRun(state: GameState, speed = 1): GameState {
  const launched = reduce(
    {
      ...state,
      settings: { ...state.settings, expeditionSpeed: speed },
      prestige: { ...state.prestige, perkRanks: { ...state.prestige.perkRanks, "perk.deep.pace": MAXIMUM_PACE_RANK } },
    },
    { type: "LAUNCH_EXPEDITION" },
  ).state;

  return tick(launched, ECONOMY.launchTransitionMs);
}

/** A launched run parked on the cat encounter, ready for the next tick to resolve it. */
function atTheCat(state: GameState, speed = 1): GameState {
  const running = launchedRun(state, speed);
  const encounter = createActiveEncounter(ENCOUNTERS[CAT_ENCOUNTER_ID]);

  return {
    ...running,
    expedition: {
      ...running.expedition,
      status: "resolving",
      depth: 4,
      currentEncounter: {
        ...encounter,
        approachElapsedMs: encounter.approachDurationMs,
        // One millisecond short, so the very next tick completes it.
        resolveElapsedMs: (encounter.resolveDurationMs ?? 0) - 1,
        committedReward: { tableId: "", entryId: "cat", tags: [], grants: [] },
      },
    },
  };
}

/**
 * A launched run one millisecond from *arriving* at the cat.
 *
 * `atTheCat` seeds `status: "resolving"` with a reward already committed, which
 * is right for testing what happens after an encounter completes — and steps
 * straight over `beginResolution`, where a cat can stall the run forever because
 * it declares no reward table. Without walking the approach, the pause every
 * test below asserts is unreachable in a real run.
 */
function approachingTheCat(state: GameState, speed = 1): GameState {
  const running = launchedRun(state, speed);
  const encounter = createActiveEncounter(ENCOUNTERS[CAT_ENCOUNTER_ID]);

  return {
    ...running,
    expedition: {
      ...running.expedition,
      status: "approaching",
      depth: 4,
      currentEncounter: {
        ...encounter,
        approachElapsedMs: encounter.approachDurationMs - 1,
      },
    },
  };
}

function tick(state: GameState, expeditionElapsedMs: number, casinoElapsedMs = 0): GameState {
  return reduce(state, {
    type: "TICK",
    casinoElapsedMs,
    expeditionElapsedMs,
    nowUnixMs: state.lastSettledAtUnixMs + expeditionElapsedMs,
  }).state;
}

describe("a cat is a thing you own", () => {
  it("appends exactly one entry, wearing a skin that is owned", () => {
    const before = fresh(21);
    const after = tick(atTheCat(before), 200);

    expect(after.statistics.catsFound).toBe(1);
    expect(after.collection.cats).toHaveLength(1);
    expect(after.collection.ownedCatSkinIds).toContain(after.collection.cats[0].skinId);
  });

  it("keeps the list and the count equal, whatever happened", () => {
    /*
     * Two fields for one fact, and `catsFound` is the one the luck modifier
     * reads — so a drift between them is a silent balance change rather than a
     * cosmetic one. Checked across a meeting, a developer edit, a prestige and a
     * save round-trip, which is every path that touches either.
     */
    let state = tick(atTheCat(fresh(7)), 200);

    expect(state.collection.cats).toHaveLength(state.statistics.catsFound);

    state = reduce(state, { type: "DEV_SET_STATE", patch: { catsFound: 40 } }).state;
    expect(state.collection.cats).toHaveLength(40);
    expect(state.statistics.catsFound).toBe(40);

    state = reduce(state, { type: "DEV_SET_STATE", patch: { catsFound: 3 } }).state;
    expect(state.collection.cats).toHaveLength(3);

    const prestiged = applyPrestige({
      ...state,
      resources: { ...state.resources, cash: ECONOMY.prestigeThresholdCash * 10 },
    });

    if (prestiged.ok) {
      expect(prestiged.state.collection.cats).toHaveLength(
        prestiged.state.statistics.catsFound,
      );
      // Cosmetic, so it survives — the whole point of putting it in `collection`.
      expect(prestiged.state.collection.cats).toHaveLength(3);
    }

    const round = normalizeGameState(JSON.parse(JSON.stringify(state)) as unknown, NOW);

    expect(round.state.collection.cats).toHaveLength(round.state.statistics.catsFound);
  });

  it("repairs a save whose count and list disagree", () => {
    // Both directions, because a save can be short *or* long — the second is what
    // a rolled-back count looks like.
    expect(reconcileCats([], 3)).toHaveLength(3);
    expect(reconcileCats([{ skinId: "cat.tabby" }], 0)).toHaveLength(0);

    for (const cat of reconcileCats([], 9)) {
      expect(DEFAULT_CAT_SKIN_IDS).toContain(cat.skinId);
    }

    // Stable: reading a save twice must not produce two different shelves.
    expect(reconcileCats([], 5)).toEqual(reconcileCats([], 5));
  });
});

describe("skins", () => {
  const rich = (): GameState => {
    const base = fresh(3);

    return { ...base, resources: { ...base.resources, chips: 1e15 } };
  };

  it("gives every skin a sprite pair that actually exists", () => {
    // A missing sprite renders a labelled placeholder rather than failing, so
    // nothing else in the game would ever complain about a typo here.
    for (const skinId of CAT_SKIN_IDS) {
      const skin = CAT_SKINS[skinId];

      expect(SPRITES[skin.restSpriteId], skin.restSpriteId).toBeDefined();
      expect(SPRITES[skin.flickSpriteId], skin.flickSpriteId).toBeDefined();
      expect(skin.restSpriteId, skinId).not.toBe(skin.flickSpriteId);
    }

    // Every sprite is the same 12x12 grid; a ragged row draws a broken cat.
    for (const skinId of CAT_SKIN_IDS) {
      for (const spriteId of [CAT_SKINS[skinId].restSpriteId, CAT_SKINS[skinId].flickSpriteId]) {
        expect(SPRITES[spriteId], spriteId).toHaveLength(12);

        for (const row of SPRITES[spriteId]) {
          expect(row.length, `${spriteId}: "${row}"`).toBe(12);
        }
      }
    }
  });

  it("prices the ladder so each rung is a real step up", () => {
    const costs = CAT_SKIN_IDS.map((skinId) => CAT_SKINS[skinId].chipCost).filter(
      (cost): cost is number => cost !== null,
    );

    expect(DEFAULT_CAT_SKIN_IDS).toHaveLength(4);
    expect(costs).toHaveLength(6);

    for (let index = 1; index < costs.length; index += 1) {
      // Ten times at minimum. These buy nothing, so the only thing a price can
      // mean is how far you have got.
      expect(costs[index] / costs[index - 1]).toBeGreaterThanOrEqual(10);
    }

    // And it ends absurdly, on purpose.
    expect(costs[costs.length - 1]).toBe(1e12);
  });

  it("deducts chips and widens the pool, without redressing any cat", () => {
    const met = tick(atTheCat(rich()), 200);
    const wornBefore = met.collection.cats[0].skinId;
    const bought = reduce(met, { type: "BUY_CAT_SKIN", skinId: "cat.tophat" }).state;

    expect(bought.resources.chips).toBe(met.resources.chips - 1e12);
    expect(bought.collection.ownedCatSkinIds).toContain("cat.tophat");
    // The cat you met is the cat you met.
    expect(bought.collection.cats[0].skinId).toBe(wornBefore);
  });

  it("refuses a skin there are no chips for, and one already owned", () => {
    const poor = fresh(4);
    const refused = reduce(poor, { type: "BUY_CAT_SKIN", skinId: "cat.scarf" });

    expect(refused.state.collection.ownedCatSkinIds).not.toContain("cat.scarf");
    expect(refused.state.resources.chips).toBe(poor.resources.chips);

    const owned = reduce(rich(), { type: "BUY_CAT_SKIN", skinId: "cat.scarf" }).state;
    const again = reduce(owned, { type: "BUY_CAT_SKIN", skinId: "cat.scarf" }).state;

    expect(again.resources.chips).toBe(owned.resources.chips);
    expect(again.collection.ownedCatSkinIds.filter((id) => id === "cat.scarf")).toHaveLength(1);
  });

  it("cycles a cat only through owned skins, and wraps", () => {
    let state = tick(atTheCat(rich()), 200);
    const owned = state.collection.ownedCatSkinIds;
    const seen: string[] = [state.collection.cats[0].skinId];

    for (let step = 0; step < owned.length; step += 1) {
      state = reduce(state, { type: "CYCLE_CAT_SKIN", index: 0 }).state;
      seen.push(state.collection.cats[0].skinId);
    }

    for (const skinId of seen) {
      expect(owned).toContain(skinId);
    }

    // Every owned skin was offered exactly once before coming back round.
    expect(new Set(seen.slice(0, owned.length)).size).toBe(owned.length);
    expect(seen[seen.length - 1]).toBe(seen[0]);
  });

  it("cycles into a skin only after it is bought", () => {
    let state = tick(atTheCat(rich()), 200);

    for (let step = 0; step < 12; step += 1) {
      state = reduce(state, { type: "CYCLE_CAT_SKIN", index: 0 }).state;
      expect(state.collection.cats[0].skinId).not.toBe("cat.crown");
    }

    state = reduce(state, { type: "BUY_CAT_SKIN", skinId: "cat.crown" }).state;

    const reached = Array.from({ length: 12 }, () => {
      state = reduce(state, { type: "CYCLE_CAT_SKIN", index: 0 }).state;

      return state.collection.cats[0].skinId;
    });

    expect(reached).toContain("cat.crown");
  });

  it("refuses an index that is not a cat", () => {
    const met = tick(atTheCat(rich()), 200);

    for (const index of [-1, 1, 99, 1.5]) {
      expect(reduce(met, { type: "CYCLE_CAT_SKIN", index }).state.collection.cats).toEqual(
        met.collection.cats,
      );
    }
  });
});

describe("reaching a cat", () => {
  /*
   * The pause is not what breaks a run at a cat; never reaching it is.
   * `beginResolution` returning the state unchanged for an encounter with no
   * reward table leaves the status on `approaching` with its arrival condition
   * still true, so every tick retries the encounter and only the oxygen moves.
   */
  it("begins the encounter on arrival rather than stalling on the approach", () => {
    const arrived = tick(approachingTheCat(fresh(21)), 100);

    expect(arrived.expedition.status).toBe("resolving");
  });

  it("meets the cat by walking to it, and starts the pause", () => {
    let state = approachingTheCat(fresh(21));

    for (let step = 0; step < 100 && state.statistics.catsFound === 0; step += 1) {
      state = tick(state, 100);
    }

    expect(state.statistics.catsFound).toBe(1);
    expect(state.collection.cats).toHaveLength(1);
    expect(state.expedition.status).toBe("reward");
    expect(state.expedition.pauseRemainingWallMs).toBe(ECONOMY.catPauseWallMs);
  });

  it("does not drain the run dry on the way", () => {
    /*
     * The visible symptom, asserted as a whole run rather than as a transition.
     * A stalled approach drains at the cat's multiplier until oxygen reaches
     * zero, so ninety seconds — comfortably longer than a fresh tank lasts —
     * used to end in `failed` with no cat and no explanation on screen.
     */
    let state = approachingTheCat(fresh(21));

    for (let step = 0; step < 900; step += 1) {
      state = tick(state, 100);
    }

    expect(state.statistics.catsFound).toBe(1);
    expect(state.expedition.status).toBe("decision");
    expect(state.expedition.oxygen).toBeGreaterThan(0);
  });
});

describe("the pause when a cat is met", () => {
  it("lasts the same wall-clock time at 1x and at 32x", () => {
    /*
     * The assertion note 29 is really asking for.
     *
     * The expedition advances by `elapsedMs * speed`, so a pause counted in run
     * time would be 37ms at 32x — invisible exactly when a player is most likely
     * to be skimming. This drives the reducer at both speeds in identical
     * wall-clock steps and requires the run to be held for the same number of
     * them.
     */
    const held = (speed: number): number => {
      let state = tick(atTheCat(fresh(21), speed), 200);

      // The run really is going that fast. Without this the test can pass at 1x
      // twice and prove nothing at all, which is exactly what it did at first.
      expect(selectExpeditionSpeed(state), `speed ${String(speed)}`).toBe(speed);
      expect(state.statistics.catsFound, `speed ${String(speed)}`).toBe(1);
      expect(state.expedition.pauseRemainingWallMs).toBeGreaterThan(0);

      let frames = 0;

      // 100ms of wall clock per frame, whatever the speed multiplier is.
      while (state.expedition.pauseRemainingWallMs > 0 && frames < 1_000) {
        state = tick(state, 100);
        frames += 1;
      }

      return frames;
    };

    const slow = held(1);
    const fast = held(32);

    expect(slow).toBe(fast);
    // And it is the configured length, not an accident of the frame size.
    expect(slow * 100).toBeGreaterThanOrEqual(ECONOMY.catPauseWallMs);
    expect((slow - 1) * 100).toBeLessThan(ECONOMY.catPauseWallMs);
  });

  it("holds the run still while it lasts, at any speed", () => {
    for (const speed of [1, 8, 32]) {
      const met = tick(atTheCat(fresh(21), speed), 200);
      const depth = met.expedition.depth;
      const oxygen = met.expedition.oxygen;
      const paused = tick(met, 100);

      expect(paused.expedition.pauseRemainingWallMs, `speed ${String(speed)}`).toBeGreaterThan(0);
      expect(paused.expedition.depth, `speed ${String(speed)}`).toBe(depth);
      // Not even oxygen: a cat should not cost anything to look at.
      expect(paused.expedition.oxygen, `speed ${String(speed)}`).toBe(oxygen);
    }
  });

  it("lets the run continue once it expires", () => {
    /*
     * Asserted on the reward transition rather than on oxygen. A cat resolves
     * into `reward`, and drain is deliberately paused through the reward and the
     * decision that follows it — so "oxygen fell" would be the wrong evidence
     * here and would have failed for a reason that has nothing to do with the
     * pause. The transition timer is what is actually held.
     */
    let state = tick(atTheCat(fresh(21)), 200);

    expect(state.expedition.status).toBe("reward");

    const heldAt = state.expedition.transitionRemainingMs;

    while (state.expedition.pauseRemainingWallMs > 0) {
      state = tick(state, 100);

      // Held for every frame the pause survives. The frame that *ends* it spends
      // only its remainder on the run, which here is zero — the pause length
      // divides evenly by 100 — so the transition is untouched to the last one.
      if (state.expedition.pauseRemainingWallMs > 0) {
        expect(state.expedition.transitionRemainingMs).toBe(heldAt);
      }
    }

    expect(state.expedition.transitionRemainingMs).toBe(heldAt);

    state = tick(state, 100);

    expect(state.expedition.transitionRemainingMs).toBeLessThan(heldAt);
  });

  it("says what happened, for as long as it holds", () => {
    /*
     * The half of this the pause was missing. None of the encounter card's
     * blocks match `"reward"`, so the run held still for three seconds behind a
     * card showing a name and nothing else — which reads as a hang rather than a
     * beat, and at 1.2s nobody had looked long enough to say so.
     */
    let state = tick(atTheCat(fresh(21)), 200);

    expect(state.expedition.status).toBe("reward");
    expect(selectExpeditionView(deriveContext(state)).metCat).toBe(true);

    while (state.expedition.pauseRemainingWallMs > 0) {
      expect(selectExpeditionView(deriveContext(state)).metCat).toBe(true);
      state = tick(state, 100);
    }

    // Once the run moves on it is a decision like any other, and the line goes.
    let moved = state;

    for (let step = 0; step < 200 && moved.expedition.status !== "decision"; step += 1) {
      moved = tick(moved, 100);
    }

    expect(moved.expedition.status).toBe("decision");
    expect(selectExpeditionView(deriveContext(moved)).metCat).toBe(false);
  });

  it("stops a stuttering frame from running on through the pause", () => {
    /*
     * The pause is spent out of the frame's unscaled time *before* the reducer
     * starts slicing, so a pause created inside the loop is not seen until the
     * next frame. At 32x a one-second frame is 32 slices: without a guard the
     * run advances through the reward and out to the decision on the very frame
     * the cat was met, which is the one beat the pause exists to make visible.
     */
    const met = tick(atTheCat(fresh(21), 32), 1_000);

    expect(met.statistics.catsFound).toBe(1);
    expect(met.expedition.status).toBe("reward");
    expect(met.expedition.pauseRemainingWallMs).toBe(ECONOMY.catPauseWallMs);
    // The reward transition has not been touched either.
    expect(met.expedition.transitionRemainingMs).toBe(ECONOMY.rewardTransitionMs);
  });

  it("plays its own jingle rather than the reward pickup", () => {
    const played = reduce(atTheCat(fresh(21)), {
      type: "TICK",
      casinoElapsedMs: 0,
      expeditionElapsedMs: 200,
      nowUnixMs: 1,
    }).effects.flatMap((effect) => (effect.type === "PLAY_SOUND" ? [effect.soundId] : []));

    expect(played).toContain("sound.cat.meet");
    expect(played).not.toContain("sound.reward.pickup");
  });
});

describe("the version 12 to 13 migration", () => {
  it("gives an existing player's cats skins rather than losing them", () => {
    const legacy = {
      saveVersion: 12,
      contentVersion: "0.1.0",
      revision: 4,
      savedAtUnixMs: NOW,
      game: {
        statistics: { catsFound: 7 },
        collection: {},
      },
    };

    const migrated = runMigrations(legacy);
    const game = migrated.envelope.game as Record<string, unknown>;
    const collection = game.collection as Record<string, unknown>;
    const cats = collection.cats as Array<{ skinId: string }>;

    expect(migrated.envelope.saveVersion).toBe(SAVE_VERSION);
    expect(cats).toHaveLength(7);
    expect(collection.ownedCatSkinIds).toEqual(DEFAULT_CAT_SKIN_IDS);

    for (const cat of cats) {
      expect(DEFAULT_CAT_SKIN_IDS).toContain(cat.skinId);
    }

    // Varied rather than seven identical cats, which is the thing the chunk exists
    // to stop — an existing player should not be the only one who still sees it.
    expect(new Set(cats.map((cat) => cat.skinId)).size).toBeGreaterThan(1);
  });

  it("produces the same cats every time it runs", () => {
    /*
     * A migration reads a file and must be reproducible: a load that failed
     * half-way and retried, or two devices restoring one backup, must not end up
     * with different cats. `Math.random` here would be a bug that only ever
     * showed up as "my cats changed".
     */
    const legacy = {
      saveVersion: 12,
      contentVersion: "0.1.0",
      revision: 4,
      savedAtUnixMs: NOW,
      game: { statistics: { catsFound: 12 }, collection: {} },
    };

    const first = runMigrations(legacy).envelope.game as Record<string, unknown>;
    const second = runMigrations(legacy).envelope.game as Record<string, unknown>;

    expect((first.collection as Record<string, unknown>).cats).toEqual(
      (second.collection as Record<string, unknown>).cats,
    );
  });
});
