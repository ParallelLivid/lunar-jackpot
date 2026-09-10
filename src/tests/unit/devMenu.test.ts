/**
 * Coverage for the developer menu. Two things pull in opposite directions: the
 * menu can genuinely set anything, because a cheat that silently fails to apply
 * wastes the time of whoever is using it — and nothing it produces can be
 * illegal, because it is the only producer of arbitrary state besides a
 * hand-edited save, and every value has to survive the loader.
 */

import { describe, expect, it } from "vitest";
import {
  ECONOMY,
  GEAR,
  MACHINES,
  MACHINE_IDS,
  PRESTIGE_PERKS,
  PRESTIGE_PERK_IDS,
  RESOURCE_IDS,
} from "../../content/catalog";
import { HIGHEST_GRADE } from "../../content/grades";
import { evaluateMachineLevel } from "../../content/machines";
import {
  DEV_MAX_MACHINE_LEVEL,
  describeDevPatch,
  devMaximumMachineLevel,
  devPerkRank,
  maxOutPatch,
} from "../../domain/devEdits";
import { INFINITE, isFiniteQuantity } from "../../domain/numbers";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";
import { runMigrations } from "../../persistence/migrations";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;

function fresh(seed = 3): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/**
 * Applies a patch through the reducer. Typed loosely on purpose: several tests
 * feed ids that do not exist, and what the runtime does with them is the point.
 */
function edit(state: GameState, patch: Record<string, unknown>): GameState {
  return reduce(state, { type: "DEV_SET_STATE", patch } as never).state;
}

describe("editing state", () => {
  it("sets every resource", () => {
    const state = edit(fresh(), {
      resources: Object.fromEntries(RESOURCE_IDS.map((id, index) => [id, (index + 1) * 100])),
    });

    RESOURCE_IDS.forEach((id, index) => {
      expect(state.resources[id], id).toBe((index + 1) * 100);
    });
  });

  it("sets the things that are otherwise unreachable", () => {
    // Cats are a 1-in-1000 roll and deepest depth takes hours of play, which is
    // most of the reason this menu exists.
    const state = edit(fresh(), { catsFound: 9, deepestDepth: 140, prestigeCount: 6 });

    expect(state.statistics.catsFound).toBe(9);
    expect(state.statistics.deepestDepth).toBe(140);
    expect(state.prestige.count).toBe(6);
  });

  it("grants a collectible at a chosen grade", () => {
    const state = edit(fresh(), {
      trinkets: { "trinket.impact-fuse": { owned: true, grade: "SSS", fragments: 4 } },
      totems: { "totem.cartographer": { owned: true, grade: "A" } },
    });

    expect(state.collection.trinkets["trinket.impact-fuse"]).toEqual({
      owned: true,
      grade: "SSS",
      fragments: 4,
    });
    expect(state.collection.totems["totem.cartographer"].grade).toBe("A");
  });

  it("sets gear, machines, research and perks", () => {
    const state = edit(fresh(), {
      tankLevel: 9,
      pickaxeLevel: 12,
      machines: {
        "machine.beta": {
          unlocked: true,
          level: 14,
          recipePieces: 4,
          researchRanks: { "research.beta.overclock": 5 },
        },
      },
      perkRanks: { "perk.deep.pace": 3 },
    });

    expect(state.gear.tankLevel).toBe(9);
    expect(state.gear.pickaxeLevel).toBe(12);
    expect(state.casino.machines["machine.beta"].unlocked).toBe(true);
    expect(state.casino.machines["machine.beta"].level).toBe(14);
    expect(state.casino.machines["machine.beta"].researchRanks["research.beta.overclock"]).toBe(5);
    expect(state.prestige.perkRanks["perk.deep.pace"]).toBe(3);
  });

  it("reports what it changed", () => {
    // A silent cheat is indistinguishable from a broken one.
    const result = reduce(fresh(), {
      type: "DEV_SET_STATE",
      patch: { resources: { relics: 40 }, catsFound: 2 },
    });
    const feedback = result.effects.find((effect) => effect.type === "SHOW_FEEDBACK");

    expect(result.materialChange).toBe(true);
    expect(feedback?.type === "SHOW_FEEDBACK" ? feedback.message : "").toContain("relics = 40");
    expect(describeDevPatch({})).toBe("nothing");
  });

  it("saves immediately", () => {
    // An edit that is lost on reload is a worse waste of time than no edit.
    const result = reduce(fresh(), { type: "DEV_SET_STATE", patch: { catsFound: 1 } });
    const save = result.effects.find((effect) => effect.type === "REQUEST_SAVE");

    expect(save?.type === "REQUEST_SAVE" ? save.immediate : false).toBe(true);
  });
});

describe("refusing the impossible", () => {
  it("clamps a negative resource to zero", () => {
    expect(edit(fresh(), { resources: { relics: -50 } }).resources.relics).toBe(0);
  });

  it("drops a grade outside the ladder rather than clamping to the top", () => {
    // "SSSS" is a typo, and reading it as SSS would hand out the top grade in
    // the game for a slip of the keyboard.
    const state = edit(fresh(), {
      trinkets: { "trinket.bladder": { owned: true, grade: "SSSS", fragments: 2 } },
    });

    expect(state.collection.trinkets["trinket.bladder"].grade).toBe("E");
    expect(state.collection.trinkets["trinket.bladder"].owned).toBe(true);
  });

  it("clamps gear to the ladder its content defines", () => {
    const state = edit(fresh(), { tankLevel: 999, pickaxeLevel: 0 });

    expect(state.gear.tankLevel).toBe(GEAR.tank.levels.length);
    expect(state.gear.pickaxeLevel).toBe(1);
  });

  it("clamps a perk to its maximum rank", () => {
    const state = edit(fresh(), { perkRanks: { "perk.foothold": 99 } });

    expect(state.prestige.perkRanks["perk.foothold"]).toBe(
      PRESTIGE_PERKS["perk.foothold"].maximumRank,
    );
  });

  it("keeps the current machine level when the requested one is not representable", () => {
    // Machine levels are uncapped, so the only ceiling is what the curve can
    // express finitely. Past it the level is refused, since the save normaliser
    // would otherwise reset the machine to level 1 over one extra digit.
    const state = edit(fresh(), { machines: { "machine.alpha": { level: 999_999 } } });

    expect(state.casino.machines["machine.alpha"].level).toBe(1);
  });

  it("ignores unknown ids instead of storing them", () => {
    const state = edit(fresh(), {
      resources: { "resource.invented": 10 },
      trinkets: { "trinket.invented": { owned: true } },
      machines: { "machine.invented": { level: 4 } },
      perkRanks: { "perk.invented": 3 },
    });

    expect(Object.keys(state.resources).sort()).toEqual([...RESOURCE_IDS].sort());
    expect("trinket.invented" in state.collection.trinkets).toBe(false);
    expect("machine.invented" in state.casino.machines).toBe(false);
    expect("perk.invented" in state.prestige.perkRanks).toBe(false);
  });

  it("files a research rank under the machine that owns it, or not at all", () => {
    const state = edit(fresh(), {
      machines: { "machine.alpha": { researchRanks: { "research.beta.overclock": 3 } } },
    });

    expect(state.casino.machines["machine.alpha"].researchRanks["research.beta.overclock"]).toBeUndefined();
  });

  it("returns a trinket to the collection when a level change relocks its slot", () => {
    // Dropping the tank to level 1 relocks slots two and three, so anything in
    // one has to come back rather than vanish.
    const equipped: GameState = {
      ...fresh(),
      gear: {
        ...fresh().gear,
        tankLevel: 5,
        tankTrinketSlots: ["trinket.bladder", "trinket.regulator", null],
      },
    };
    const state = edit(equipped, { tankLevel: 1 });

    expect(state.gear.tankTrinketSlots[1]).toBeNull();
    expect(state.gear.tankLevel).toBe(1);
  });
});

describe("what the menu produces is always loadable", () => {
  it("survives a save round trip unchanged", () => {
    // Why edits go through the reducer rather than writing state directly: a
    // hand-made state the loader rejects later is worse than one repaired now.
    const state = edit(fresh(), {
      resources: { cash: 1_000_000, relics: 500, selenite: 40 },
      catsFound: 7,
      deepestDepth: 120,
      prestigeCount: 4,
      tankLevel: 9,
      pickaxeLevel: 12,
      trinkets: { "trinket.impact-fuse": { owned: true, grade: "SSS", fragments: 3 } },
      totems: { "totem.cartographer": { owned: true, grade: "A" } },
      machines: {
        "machine.alpha": { level: 20, researchRanks: { "research.alpha.overclock": 4 } },
      },
      perkRanks: { "perk.deep.pace": 3 },
    });

    const round = normalizeGameState(createEnvelope(state, 1, NOW).game, NOW);

    expect(round.report.repairs).toEqual([]);
    expect(round.state.resources).toEqual(state.resources);
    expect(round.state.collection.trinkets).toEqual(state.collection.trinkets);
    expect(round.state.collection.totems).toEqual(state.collection.totems);
    expect(round.state.casino.machines).toEqual(state.casino.machines);
    expect(round.state.prestige.perkRanks).toEqual(state.prestige.perkRanks);
    expect(round.state.gear).toEqual(state.gear);
    expect(round.state.statistics).toEqual(state.statistics);
  });

  it("leaves a run in flight alone", () => {
    // The patch cannot reach the expedition at all, which stops the menu putting
    // a run into a state its own machine could not produce. Asserted rather than
    // trusted to the type.
    const launched = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;
    const state = edit(launched, { resources: { cash: 5_000 } });

    expect(state.expedition).toEqual(launched.expedition);
    expect(state.random).toEqual(launched.random);
  });
});

describe("max me out", () => {
  it("produces a state the loader accepts without repairing anything", () => {
    // The most useful assertion here, because the failure mode is a cheat the
    // normaliser silently undoes: the button appears to work, and three sessions
    // later the save comes back different.
    const maxed = edit(fresh(), maxOutPatch() as unknown as Record<string, unknown>);
    const reloaded = normalizeGameState(maxed, NOW);

    expect(reloaded.report.repairs).toEqual([]);
    expect(reloaded.state.resources).toEqual(maxed.resources);
    expect(reloaded.state.casino.machines).toEqual(maxed.casino.machines);
    expect(reloaded.state.prestige.perkRanks).toEqual(maxed.prestige.perkRanks);
  });

  it("leaves the record alone: depth, prestiges and cats", () => {
    /*
     * The line is between what a save has and what it has done. Everything the
     * button sets is an inventory; deepest depth, prestige count and cats found
     * are the history of how far the save got, and rewriting history makes every
     * later reading of it a lie.
     *
     * Asserted against a save that has already done some of each rather than a
     * fresh one: `toBe(0)` would also pass if the patch set them to zero.
     */
    const played: GameState = {
      ...fresh(),
      statistics: { ...fresh().statistics, deepestDepth: 37, catsFound: 2 },
      prestige: { ...fresh().prestige, count: 3 },
    };

    const maxed = edit(played, maxOutPatch() as unknown as Record<string, unknown>);

    expect(maxed.statistics.deepestDepth).toBe(37);
    expect(maxed.statistics.catsFound).toBe(2);
    expect(maxed.prestige.count).toBe(3);

    // And the patch never names them at all, so there is nothing for a future
    // `applyDevPatch` change to clamp or repair.
    const patch = maxOutPatch();

    expect(patch.deepestDepth).toBeUndefined();
    expect(patch.catsFound).toBeUndefined();
    expect(patch.prestigeCount).toBeUndefined();

    // The cost of the rule: a max-out does not unlock the jukebox, which is
    // gated on depth. The Progress section's field is how a tester gets there.
    expect(maxed.statistics.deepestDepth).toBeLessThan(ECONOMY.jukeboxUnlockDepth);
  });

  it("maxes every collectible, gear ladder and perk", () => {
    const maxed = edit(fresh(), maxOutPatch() as unknown as Record<string, unknown>);

    for (const progress of Object.values(maxed.collection.trinkets)) {
      expect(progress).toMatchObject({ owned: true, grade: HIGHEST_GRADE });
    }

    for (const progress of Object.values(maxed.collection.totems)) {
      expect(progress).toMatchObject({ owned: true, grade: HIGHEST_GRADE });
    }

    expect(maxed.gear.tankLevel).toBe(GEAR.tank.levels.length);
    expect(maxed.gear.pickaxeLevel).toBe(GEAR.pickaxe.levels.length);

    for (const [perkId, perk] of Object.entries(PRESTIGE_PERKS)) {
      const rank = maxed.prestige.perkRanks[perkId as keyof typeof maxed.prestige.perkRanks];

      if (perk.repeatable === true) {
        // No maximum to reach for, so the menu picks a number that looks like a
        // lot — the same answer Overclock gets.
        expect(rank ?? 0, perkId).toBeGreaterThan(1);
        continue;
      }

      expect(rank, perkId).toBe(perk.maximumRank);
    }

    for (const machine of Object.values(maxed.casino.machines)) {
      expect(machine.unlocked).toBe(true);
    }
  });

  it("keeps the economy inside the range the transaction layer will accept", () => {
    /*
     * What this guards: an over-generous max-out produces machines that pay
     * nothing, because a grant past `safeMaximum` is refused — and a casino that
     * has silently stopped paying looks exactly like the bug somebody is using
     * this menu to chase.
     *
     * Ticked rather than computed, because the property is that real production
     * lands, twice, from a state the button actually produced. Not asserted as
     * `Number.isSafeInteger`: a maxed save passes 2^53 within a minute,
     * legitimately, as a finite integer far below the ceiling.
     */
    const maxed = edit(fresh(), maxOutPatch() as unknown as Record<string, unknown>);
    const tick = (from: GameState, elapsedMs: number): GameState =>
      reduce(from, {
        type: "TICK",
        casinoElapsedMs: elapsedMs,
        expeditionElapsedMs: 0,
        nowUnixMs: NOW + elapsedMs,
      }).state;

    const once = tick(maxed, 60_000);
    const twice = tick(once, 60_000);

    // Production lands, and keeps landing rather than stalling at a ceiling.
    expect(once.resources.cash).toBeGreaterThan(maxed.resources.cash);
    expect(twice.resources.cash).toBeGreaterThan(once.resources.cash);

    // And every balance is still something the transaction layer will take: a
    // whole number at or below the ceiling, or `INF` once it rolls over.
    for (const balance of Object.values(twice.resources)) {
      expect(balance === INFINITE || isFiniteQuantity(balance)).toBe(true);
    }
  });

  it("sets every machine to the level it reports, and reports a high one", () => {
    // A floor, so a retune that drops the max-out below a genuinely late-game
    // level fails here rather than six weeks later. An income budget deciding
    // the answer once produced level 39 with nothing to say it had gone wrong.
    const level = devMaximumMachineLevel();

    expect(level).toBeGreaterThanOrEqual(100);
    expect(level).toBeLessThanOrEqual(DEV_MAX_MACHINE_LEVEL);

    // And the patch actually uses it, for every machine rather than the starter.
    const machines = maxOutPatch().machines ?? {};

    expect(Object.keys(machines)).toHaveLength(MACHINE_IDS.length);

    for (const machineId of MACHINE_IDS) {
      expect(machines[machineId]?.level, machineId).toBe(level);
    }
  });

  it("labels a repeatable perk as having no maximum, and maxes it anyway", () => {
    // Two different facts: `maximumRank` is a placeholder of 1 on a repeatable
    // perk, and `devPerkRank` is what the button hands out.
    const ranks = maxOutPatch().perkRanks ?? {};

    for (const perkId of PRESTIGE_PERK_IDS) {
      const perk = PRESTIGE_PERKS[perkId];

      expect(ranks[perkId], perkId).toBe(devPerkRank(perk));

      if (perk.repeatable === true) {
        // The placeholder is 1; what it is given must be plainly more than that.
        expect(perk.maximumRank, perkId).toBe(1);
        expect(devPerkRank(perk), perkId).toBeGreaterThan(1);
      } else {
        expect(devPerkRank(perk), perkId).toBe(perk.maximumRank);
      }
    }
  });

  it("gives the machines a level above the one they start at", () => {
    // The level has to be large enough as well as small enough, and only the
    // small side is obvious: too low and "Max me out" quietly stops levelling
    // anything, with a tile reading "Level 1" as the only symptom.
    expect(devMaximumMachineLevel()).toBeGreaterThan(1);
  });

  it("refuses to run a maxed machine level the curve cannot represent", () => {
    // The search stops at the first level any machine cannot express, so what it
    // returns is always a level every machine can hold.
    const level = devMaximumMachineLevel();

    expect(level).toBeGreaterThanOrEqual(1);

    for (const definition of Object.values(MACHINES)) {
      expect(evaluateMachineLevel(definition, level)).not.toBeNull();
    }
  });
});

describe("the developer-edit marker", () => {
  it("is set by using the menu and not by anything else", () => {
    const clean = fresh();

    expect(clean.devMenuUsed).toBe(false);

    // An ordinary command must not trip it.
    expect(reduce(clean, { type: "LAUNCH_EXPEDITION" }).state.devMenuUsed).toBe(false);

    expect(edit(clean, { resources: { cash: 1 } }).devMenuUsed).toBe(true);
  });

  it("survives a save round trip in both states", () => {
    // A marker a file round-trip could launder would not be a marker.
    const marked = edit(fresh(), { resources: { cash: 1 } });

    expect(normalizeGameState(createEnvelope(marked, 1, NOW).game, NOW).state.devMenuUsed).toBe(
      true,
    );
    expect(normalizeGameState(createEnvelope(fresh(), 1, NOW).game, NOW).state.devMenuUsed).toBe(
      false,
    );
  });

  it("is never cleared by later play", () => {
    const marked = edit(fresh(), { resources: { cash: 1 } });
    const played = reduce(marked, {
      type: "TICK",
      casinoElapsedMs: 1_000,
      expeditionElapsedMs: 0,
      nowUnixMs: NOW + 1_000,
    }).state;

    expect(played.devMenuUsed).toBe(true);
  });

  it("credits an existing save as clean when it migrates", () => {
    // The flag records what this build observed, and it observed nothing before
    // it existed: marking older saves as edited would accuse the innocent.
    const migrated = runMigrations({
      saveVersion: 10,
      contentVersion: "0.1.0",
      revision: 1,
      savedAtUnixMs: NOW,
      checksum: "ignored",
      game: {},
    });

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(10));
    expect((migrated.envelope.game as Record<string, unknown>).devMenuUsed).toBe(false);
  });
});

describe("the simulations never cheat", () => {
  it("does not dispatch the developer command anywhere in the balance harness", () => {
    /*
     * The simulations only use domain commands, so they can never reach a state
     * the player could not — a claim `DEV_SET_STATE` would break, and a balance
     * number measured from a cheated state is worse than no number.
     *
     * A source scan rather than a mock, because the point is that nobody can add
     * the call later. The glob is eager and resolved by the bundler, so a new
     * file in that directory is picked up automatically.
     */
    const sources = import.meta.glob("../../dev/simulations/*.ts", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;

    expect(Object.keys(sources).length).toBeGreaterThan(0);

    for (const [path, source] of Object.entries(sources)) {
      expect(source, `${path} dispatches DEV_SET_STATE`).not.toContain("DEV_SET_STATE");
    }
  });

  it("keeps the machine catalogue and the menu's ceilings in agreement", () => {
    // The menu reads its ceilings from content rather than repeating them, so
    // this fails loudly if a gear ladder is re-cut.
    expect(GEAR.tank.levels.length).toBeGreaterThan(1);
    expect(GEAR.pickaxe.levels.length).toBeGreaterThan(1);
    expect(Object.keys(MACHINES).length).toBeGreaterThan(1);
  });
});

/**
 * The chord, as a command. Two jobs in one place because they are the same
 * event: the menu is shut while a run is in flight, with the refusal putting the
 * reason in the log, and pressing the chord records that the console has been
 * seen, which is the gate the tutorial act triggers on.
 */
describe("opening the developer menu", () => {
  it("is refused while an expedition is under way, with a reason", () => {
    // The whole menu follows the rule its most dangerous button already did: a
    // patch that relocks a gear slot under a run that has snapshotted its
    // loadout is worse to debug than a disabled button.
    const run = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;

    expect(run.expedition.status).not.toBe("surface");

    const result = reduce(run, { type: "OPEN_DEV_MENU" });
    const rejection = result.effects.find((effect) => effect.type === "COMMAND_REJECTED");

    expect(rejection).toBeDefined();
    expect(rejection?.type === "COMMAND_REJECTED" ? rejection.message : "").toContain(
      "expedition is under way",
    );
    // Refused means refused: the gate does not latch from a run either.
    expect(result.state.onboarding.hasOpenedDevMenu).toBe(false);
  });

  it("records that the console has been seen, on the surface", () => {
    const opened = reduce(fresh(), { type: "OPEN_DEV_MENU" }).state;

    expect(opened.onboarding.hasOpenedDevMenu).toBe(true);
  });

  it("does not brand the save the way an edit does", () => {
    // Opening the console and closing it again earns a lecture, not a mark: the
    // permanent DEV badge is for edits, and this is not one.
    const opened = reduce(fresh(), { type: "OPEN_DEV_MENU" }).state;

    expect(opened.devMenuUsed).toBe(false);
    expect(edit(opened, { resources: { cash: 1 } }).devMenuUsed).toBe(true);
  });

  it("is a no-op the second time", () => {
    // Pressing the chord again is not a mistake; it just has nothing to record.
    const opened = reduce(fresh(), { type: "OPEN_DEV_MENU" }).state;
    const again = reduce(opened, { type: "OPEN_DEV_MENU" });

    expect(again.materialChange).toBe(false);
    expect(again.effects).toEqual([]);
  });

  it("survives a save round trip", () => {
    const opened = reduce(fresh(), { type: "OPEN_DEV_MENU" }).state;

    expect(
      normalizeGameState(createEnvelope(opened, 1, NOW).game, NOW).state.onboarding
        .hasOpenedDevMenu,
    ).toBe(true);
  });
});
