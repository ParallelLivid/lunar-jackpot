/**
 * The tutorial act machine. Written against the real script in
 * `content/tutorial.ts` rather than a fixture, because the rules under test are
 * the engine's and the script is what exercises them. Every assertion reads the
 * act it needs by id, so rewriting the prose does not break them.
 */

import { describe, expect, it } from "vitest";
import { TUTORIAL_ACTS, TUTORIAL_GATES, type TutorialGateId } from "../../content/tutorial";
import { ECONOMY, TOTEMS, TRINKETS } from "../../content/catalog";
import { HIGHEST_GRADE } from "../../content/grades";
import { reduce } from "../../domain/reducer";
import { applyPrestige } from "../../domain/prestige";
import {
  advanceTutorial,
  isTutorialGateMet,
  selectTutorialStep,
} from "../../domain/tutorial";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(seed = 1): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A tick, which is the cheapest way to let the engine run a pass. */
function tick(state: GameState): GameState {
  return reduce(state, {
    type: "TICK",
    casinoElapsedMs: 100,
    expeditionElapsedMs: 0,
    nowUnixMs: NOW,
  }).state;
}

function withTutorial(state: GameState, patch: Partial<GameState["onboarding"]["tutorial"]>): GameState {
  return {
    ...state,
    onboarding: {
      ...state.onboarding,
      tutorial: { ...state.onboarding.tutorial, ...patch },
    },
  };
}

describe("where the tutorial starts and stops", () => {
  it("greets a save that has never been played, before anything runs", () => {
    // Open in the state itself rather than after the first tick: the engine
    // would open it a frame later, which is a flicker for a player and a race
    // for anything measuring the dashboard.
    const state = fresh();

    expect(state.onboarding.tutorial.status).toBe("running");
    expect(state.onboarding.tutorial.activeActId).toBe(TUTORIAL_ACTS[0].id);
    expect(state.onboarding.tutorial.completedActIds).toEqual([]);
    expect(selectTutorialStep(state)?.step.id).toBe(TUTORIAL_ACTS[0].steps[0].id);
  });

  it("stays on that first card when the clock starts", () => {
    const opened = tick(fresh());

    expect(opened.onboarding.tutorial.activeActId).toBe(TUTORIAL_ACTS[0].id);
    expect(selectTutorialStep(opened)?.step.id).toBe(TUTORIAL_ACTS[0].steps[0].id);
  });

  it("survives a prestige exactly where it was", () => {
    // Not on prestige: one act triggers on prestige eligibility, so a reset here
    // would replay the whole tutorial every cycle.
    const ready: GameState = {
      ...tick(fresh()),
      prestige: {
        ...fresh().prestige,
        count: 0,
        lifetimeCashEarned: ECONOMY.prestigeThresholdCash * 4,
        cycleCashEarned: ECONOMY.prestigeThresholdCash * 4,
        perkRanks: {},
      },
    };

    const outcome = applyPrestige(ready);

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.onboarding.tutorial).toEqual(ready.onboarding.tutorial);
    }
  });

  it("plays again from a fresh state, which is what a save reset builds", () => {
    // `resetSave` calls `createGameState`, so replaying on a reset needs no code
    // of its own. This is what keeps it that way.
    expect(fresh(9).onboarding.tutorial.status).toBe("running");
  });
});

describe("the gate resolver", () => {
  it("answers every gate false on a fresh save", () => {
    const state = fresh();

    for (const gateId of TUTORIAL_GATES) {
      expect(isTutorialGateMet(state, gateId), gateId).toBe(false);
    }
  });

  it("answers each gate true from the minimal state that satisfies it", () => {
    const base = fresh();
    const cases: Array<[TutorialGateId, GameState]> = [
      [
        "gate.machine-purchased",
        { ...base, onboarding: { ...base.onboarding, hasPurchasedMachineLevel: true } },
      ],
      [
        "gate.expedition-launched",
        { ...base, onboarding: { ...base.onboarding, hasLaunchedExpedition: true } },
      ],
      ["gate.run-banked", { ...base, onboarding: { ...base.onboarding, hasBankedRun: true } }],
      ["gate.chips-held", { ...base, resources: { ...base.resources, chips: 1 } }],
      ["gate.cache-held", { ...base, resources: { ...base.resources, caches: 1 } }],
      ["gate.cache-held", { ...base, resources: { ...base.resources, deepCaches: 1 } }],
      ["gate.relics-held", { ...base, resources: { ...base.resources, relics: 1 } }],
      [
        "gate.trinket-owned",
        {
          ...base,
          collection: {
            ...base.collection,
            trinkets: {
              ...base.collection.trinkets,
              [TRINKETS[Object.keys(TRINKETS)[0] as keyof typeof TRINKETS].id]: {
                owned: true,
                grade: HIGHEST_GRADE,
                fragments: 0,
              },
            },
          },
        },
      ],
      [
        "gate.totem-owned",
        {
          ...base,
          collection: {
            ...base.collection,
            totems: {
              ...base.collection.totems,
              [TOTEMS[Object.keys(TOTEMS)[0] as keyof typeof TOTEMS].id]: {
                owned: true,
                grade: HIGHEST_GRADE,
                fragments: 0,
              },
            },
          },
        },
      ],
      ["gate.consumable-held", { ...base, heldConsumableIds: ["consumable.stimulant"] }],
      [
        "gate.modifier-seen",
        { ...base, expedition: { ...base.expedition, activeModifierId: "modifier.rich-vein" } },
      ],
      // The failure gate reads the lifetime counter rather than a flag of its
      // own, so it survives a prestige: the act is worth playing once per save.
      ["gate.run-failed", { ...base, statistics: { ...base.statistics, runsFailed: 1 } }],
      [
        "gate.dev-menu-opened",
        { ...base, onboarding: { ...base.onboarding, hasOpenedDevMenu: true } },
      ],
    ];

    for (const [gateId, state] of cases) {
      expect(isTutorialGateMet(state, gateId), gateId).toBe(true);
    }
  });

  it("never answers the two gates only the UI can see", () => {
    // Which rail windows are open is React state rather than `GameState`. If
    // these returned true the latch pass would claim they happened on the first
    // tick, skipping the steps waiting on them.
    const anything = tick(fresh());

    expect(isTutorialGateMet(anything, "gate.window-opened.gambling")).toBe(false);
    expect(isTutorialGateMet(anything, "gate.window-opened.store")).toBe(false);
  });
});

describe("latching", () => {
  it("records a gate that is true for one moment and false afterwards", () => {
    // The reason the latch exists: a run condition is true for the length of a
    // run and gone the moment it ends, while the act about it must wait for the
    // surface — by which time a live read would find nothing.
    const mid: GameState = {
      ...tick(fresh()),
      expedition: {
        ...fresh().expedition,
        status: "approaching",
        activeModifierId: "modifier.rich-vein",
      },
    };

    const latched = tick(mid);

    expect(latched.onboarding.tutorial.latchedGateIds).toContain("gate.modifier-seen");

    // The run ends; the condition goes; the latch stays.
    const after: GameState = {
      ...latched,
      expedition: { ...fresh().expedition, status: "surface", activeModifierId: null },
    };
    const later = tick(after);

    expect(isTutorialGateMet(later, "gate.modifier-seen")).toBe(false);
    expect(later.onboarding.tutorial.latchedGateIds).toContain("gate.modifier-seen");
  });

  it("does not latch on a command that was refused", () => {
    // A refused command did nothing and must look like it. The latch is lazily
    // initialised, so without the guard the first command of a session would
    // write tutorial state and report a material change even when rejected.
    const withChips: GameState = { ...fresh(), resources: { ...fresh().resources, chips: 50 } };
    const refused = reduce(withChips, { type: "CHOOSE_ENCOUNTER_OPTION", optionId: "nope" });

    expect(refused.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
    expect(refused.state).toEqual(withChips);
    expect(refused.materialChange).toBe(false);
  });
});

describe("advancing", () => {
  /**
   * Presses Next until the opening act reaches the step that waits on a gate.
   * Walked rather than indexed, so an engine test does not break when the prose
   * is rewritten.
   */
  function walkToGatedStep(state: GameState): GameState {
    let current = state;

    for (let guard = 0; guard < 10; guard += 1) {
      const step = selectTutorialStep(current)?.step;

      if (step === undefined || step.advance !== "next") {
        return current;
      }

      current = reduce(current, { type: "ADVANCE_TUTORIAL", stepId: step.id }).state;
    }

    return current;
  }

  it("does not advance a gated step on Next, or a Next step on the gate", () => {
    const opened = tick(fresh());
    const first = selectTutorialStep(opened);

    expect(first?.step.advance).toBe("next");

    // A Next step does not move when an unrelated gate latches.
    const withChips: GameState = { ...opened, resources: { ...opened.resources, chips: 5 } };
    const ticked = tick(withChips);

    expect(selectTutorialStep(ticked)?.step.id).toBe(first?.step.id);

    // And a gated step does not move on a tick that does not satisfy it.
    const atGate = walkToGatedStep(ticked);
    const gated = selectTutorialStep(atGate);

    expect(gated?.step.advance).not.toBe("next");
    expect(selectTutorialStep(tick(atGate))?.step.id).toBe(gated?.step.id);
  });

  it("advances a gated step when its gate latches, and closes the act after the last one", () => {
    const atGate = walkToGatedStep(tick(fresh()));
    const gate = selectTutorialStep(atGate)?.step.advance;

    expect(gate).toBe("gate.machine-purchased");

    const purchased: GameState = {
      ...atGate,
      onboarding: { ...atGate.onboarding, hasPurchasedMachineLevel: true },
    };
    const closed = tick(purchased);

    expect(closed.onboarding.tutorial.completedActIds).toContain(TUTORIAL_ACTS[0].id);
  });

  it("refuses a stale step id and changes nothing", () => {
    const opened = tick(fresh());
    const refused = reduce(opened, { type: "ADVANCE_TUTORIAL", stepId: "step.does-not-exist" });

    expect(refused.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
    expect(refused.state.onboarding.tutorial).toEqual(opened.onboarding.tutorial);
  });
});

describe("decision 3: an act waits for the surface", () => {
  /** Everything before the descent act done, and a run under way. */
  function midRun(status: GameState["expedition"]["status"] = "approaching"): GameState {
    const base = tick(fresh());

    return {
      ...base,
      expedition: { ...base.expedition, status, depth: 40 },
      onboarding: {
        ...base.onboarding,
        hasLaunchedExpedition: true,
        tutorial: {
          ...base.onboarding.tutorial,
          // The opening act is out of the way, so the descent act is next up.
          activeActId: null,
          completedActIds: [TUTORIAL_ACTS[0].id],
        },
      },
    };
  }

  it("opens the descent act during a run, because it is the one that may", () => {
    // Checked before the deferral case below, which would otherwise pass against
    // an engine that never presents anything at all.
    const descent = TUTORIAL_ACTS.find((act) => act.presentsDuringRun);

    expect(descent).toBeDefined();

    const running = tick(midRun());

    expect(running.onboarding.tutorial.activeActId).toBe(descent?.id);
  });

  it("holds an act back while a run is in flight, and opens it on the surface", () => {
    const descent = TUTORIAL_ACTS.find((act) => act.presentsDuringRun);
    const deferred = TUTORIAL_ACTS.find((act) => !act.presentsDuringRun && act.trigger !== "start");

    // The script has one act of each kind; if that changes, this test needs a
    // fixture rather than the script.
    if (deferred === undefined) {
      expect(descent).toBeDefined();

      return;
    }

    const held = tick({
      ...midRun(),
      onboarding: {
        ...midRun().onboarding,
        tutorial: {
          ...midRun().onboarding.tutorial,
          completedActIds: [TUTORIAL_ACTS[0].id, descent?.id ?? ""],
          latchedGateIds: [deferred.trigger as TutorialGateId],
        },
      },
    });

    expect(held.onboarding.tutorial.activeActId).toBeNull();

    const surfaced = tick({
      ...held,
      expedition: { ...held.expedition, status: "surface" },
    });

    expect(surfaced.onboarding.tutorial.activeActId).toBe(deferred.id);
  });

  it("opens a held act after a failed run as readily as a banked one", () => {
    // Both put the player back where they can read the screen, which is all
    // "wait for the surface" is about.
    const descent = TUTORIAL_ACTS.find((act) => act.presentsDuringRun);
    const failed = tick({
      ...midRun("failed"),
      onboarding: {
        ...midRun("failed").onboarding,
        tutorial: { ...midRun("failed").onboarding.tutorial, completedActIds: [TUTORIAL_ACTS[0].id] },
      },
    });

    // Still not on the surface, so nothing but the descent act may open.
    expect(failed.onboarding.tutorial.activeActId).toBe(descent?.id);
  });
});

describe("skipping and stopping", () => {
  /**
   * Skip ends the act rather than the script: a player dismissing a card about
   * totems is saying they do not want that one, not that they want nothing.
   */
  it("puts the open act away and leaves the script running", () => {
    const opened = tick(fresh());
    const openAct = opened.onboarding.tutorial.activeActId;

    expect(openAct).not.toBeNull();

    const skipped = reduce(opened, { type: "SKIP_TUTORIAL" }).state;

    expect(skipped.onboarding.tutorial.status).toBe("running");
    expect(skipped.onboarding.tutorial.completedActIds).toContain(openAct);
    expect(skipped.onboarding.tutorial.activeActId).not.toBe(openAct);
  });

  it("does not reopen the act it just closed", () => {
    // Why the act is recorded as completed rather than merely closed:
    // `openNextAct` walks the remaining acts, and only an act that is no longer
    // remaining will not reopen on the very next command.
    const opened = tick(fresh());
    const openAct = opened.onboarding.tutorial.activeActId;
    const later = tick(reduce(opened, { type: "SKIP_TUTORIAL" }).state);

    expect(later.onboarding.tutorial.activeActId).not.toBe(openAct);
    expect(later.onboarding.tutorial.status).toBe("running");
  });

  it("still delivers a later act once its trigger latches", () => {
    // A player who skipped the opening act still gets told what prestige does.
    const skipped = reduce(tick(fresh()), { type: "SKIP_TUTORIAL" }).state;
    const earned: GameState = {
      ...skipped,
      resources: { ...skipped.resources, relics: 5 },
    };
    const later = tick(earned);

    expect(later.onboarding.tutorial.latchedGateIds).toContain("gate.relics-held");
    expect(later.onboarding.tutorial.status).toBe("running");
  });

  it("is refused when nothing is showing", () => {
    // Skip is a button on a card: with no card there is no act to put away, and
    // silently doing nothing would leave the caller believing it worked.
    const between = withTutorial(fresh(), { status: "running", activeActId: null });
    const result = reduce(between, { type: "SKIP_TUTORIAL" });

    expect(result.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("stops for good only when asked to, and stays stopped", () => {
    const opened = tick(fresh());
    const stopped = reduce(opened, { type: "STOP_TUTORIAL" }).state;

    expect(stopped.onboarding.tutorial.status).toBe("skipped");
    expect(selectTutorialStep(stopped)).toBeNull();

    // Inert afterwards: no latching, and no act ever opens again.
    const busy: GameState = {
      ...stopped,
      resources: { ...stopped.resources, chips: 100, relics: 5 },
      onboarding: { ...stopped.onboarding, hasBankedRun: true },
    };
    const later = tick(busy);

    expect(later.onboarding.tutorial.activeActId).toBeNull();
    expect(later.onboarding.tutorial.latchedGateIds).toEqual(
      stopped.onboarding.tutorial.latchedGateIds,
    );
  });

  it("refuses to stop a tutorial that is not running", () => {
    const stopped = reduce(tick(fresh()), { type: "STOP_TUTORIAL" }).state;
    const again = reduce(stopped, { type: "STOP_TUTORIAL" });

    expect(again.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("replays without asking the player to earn the triggers again", () => {
    const done = withTutorial(fresh(), {
      status: "finished",
      completedActIds: TUTORIAL_ACTS.map((act) => act.id),
      latchedGateIds: [...TUTORIAL_GATES],
    });

    const replayed = reduce(done, { type: "REPLAY_TUTORIAL" }).state;

    expect(replayed.onboarding.tutorial.status).toBe("running");
    expect(replayed.onboarding.tutorial.completedActIds).toEqual([]);
    // The latches are what make this a replay rather than a second playthrough.
    expect(replayed.onboarding.tutorial.latchedGateIds).toEqual([...TUTORIAL_GATES]);

    const opened = tick(replayed);

    expect(opened.onboarding.tutorial.activeActId).toBe(TUTORIAL_ACTS[0].id);
  });
});

describe("queueing", () => {
  it("opens one act at a time, in declaration order", () => {
    // Two triggers can latch on the same command — a cache and the trinket that
    // came out of it — and a card must never be replaced by another card.
    const everything = withTutorial(fresh(), {
      latchedGateIds: [...TUTORIAL_GATES],
    });
    const opened = tick(everything);

    expect(opened.onboarding.tutorial.activeActId).toBe(TUTORIAL_ACTS[0].id);

    // Only when the first is finished does the second open.
    const closed = withTutorial(opened, {
      activeActId: null,
      completedActIds: [TUTORIAL_ACTS[0].id],
    });

    expect(tick(closed).onboarding.tutorial.activeActId).toBe(TUTORIAL_ACTS[1].id);
  });

  it("finishes once every act has played", () => {
    const done = withTutorial(fresh(), {
      // Cleared as well as completed: an act that is both open and completed is
      // not a state play can reach.
      activeActId: null,
      completedActIds: TUTORIAL_ACTS.map((act) => act.id),
    });

    expect(tick(done).onboarding.tutorial.status).toBe("finished");
  });
});

describe("the engine costs nothing when it is not running", () => {
  it("is a no-op on a finished save", () => {
    const done = withTutorial(fresh(), { status: "finished" });
    const result = reduce(done, {
      type: "TICK",
      casinoElapsedMs: 100,
      expeditionElapsedMs: 0,
      nowUnixMs: NOW,
    });

    expect(advanceTutorial(result)).toBe(result);
  });
});

/**
 * Three acts and the moments they are for, asserted through the engine rather
 * than by reading the array: what each is for is a claim about when it opens —
 * after the first payday, after the first failure, after the chord.
 */
describe("the payday, failure and console acts", () => {
  it("sends the player down once the first run has been banked", () => {
    /*
     * Note 7: "after the expedition tutorial, there doesn't seem to be much
     * direction." The first complete loop now ends with a target, and it is
     * declared after Payday so the order reads: here is what you were paid,
     * here is where to take it.
     */
    const banked = withTutorial(fresh(), {
      activeActId: null,
      completedActIds: ["act.arrival", "act.machine", "act.descent"],
      latchedGateIds: ["gate.run-banked"],
    });

    expect(tick(banked).onboarding.tutorial.activeActId).toBe("act.payday");

    const afterPayday = withTutorial(banked, {
      completedActIds: ["act.arrival", "act.machine", "act.descent", "act.payday"],
    });

    expect(tick(afterPayday).onboarding.tutorial.activeActId).toBe("act.deeper");
  });

  it("explains a failure the first time one happens", () => {
    // Note 4. The run summary lists what the roll took; nothing told the player
    // whether that was a rule or a punishment.
    const failed: GameState = {
      ...fresh(),
      statistics: { ...fresh().statistics, runsFailed: 1 },
    };
    const opened = tick(
      withTutorial(failed, {
        activeActId: null,
        completedActIds: ["act.arrival", "act.machine", "act.descent"],
      }),
    );

    expect(opened.onboarding.tutorial.latchedGateIds).toContain("gate.run-failed");
    expect(opened.onboarding.tutorial.activeActId).toBe("act.stranded");
  });

  it("opens the stranded act before the player has ever banked", () => {
    // A first run that fails arrives before Payday can, and the act ahead of it
    // is not eligible, so nothing queues in front.
    const failed: GameState = {
      ...fresh(),
      statistics: { ...fresh().statistics, runsFailed: 1 },
    };
    const opened = tick(
      withTutorial(failed, {
        activeActId: null,
        completedActIds: ["act.arrival"],
        latchedGateIds: ["gate.machine-purchased", "gate.expedition-launched"],
      }),
    );

    // The machine and descent acts are still due and still come first.
    expect(opened.onboarding.tutorial.activeActId).toBe("act.machine");

    const later = tick(
      withTutorial(opened, {
        activeActId: null,
        completedActIds: ["act.arrival", "act.machine", "act.descent"],
      }),
    );

    expect(later.onboarding.tutorial.activeActId).toBe("act.stranded");
  });

  it("notices the developer console, last and only on the surface", () => {
    // Declared last so a keystroke never queues in front of an act the player
    // earned, and needing no exemption from the surface rule: `OPEN_DEV_MENU`
    // is refused during a run, so its gate cannot latch below.
    const seen: GameState = {
      ...fresh(),
      onboarding: { ...fresh().onboarding, hasOpenedDevMenu: true },
    };
    const everythingElseDone = withTutorial(seen, {
      activeActId: null,
      completedActIds: TUTORIAL_ACTS.filter((act) => act.id !== "act.devmenu").map(
        (act) => act.id,
      ),
    });

    expect(tick(everythingElseDone).onboarding.tutorial.activeActId).toBe("act.devmenu");

    // And it is last: with everything latched, every other act plays first.
    const all = withTutorial(seen, { activeActId: null, latchedGateIds: [...TUTORIAL_GATES] });

    expect(tick(all).onboarding.tutorial.activeActId).not.toBe("act.devmenu");
  });
});

/**
 * The cat and jukebox acts, asserted through the engine rather than by reading
 * the array: what an act is for is a claim about when it opens.
 *
 * Both gates read lifetime statistics rather than flags, which buys two things
 * the tests below pin — they survive a prestige, and a save that had already met
 * a cat or reached the depth latches on its first command rather than being
 * asked to earn it again.
 */
describe("the cat and jukebox acts", () => {
  /** Everything before the two new acts, so the engine has nothing else to open. */
  const earlier = TUTORIAL_ACTS.map((act) => act.id).filter(
    (id) => id !== "act.cat" && id !== "act.jukebox" && id !== "act.devmenu",
  );

  it("introduces the cat once one has been met", () => {
    const met: GameState = {
      ...fresh(),
      statistics: { ...fresh().statistics, catsFound: 1 },
    };

    expect(
      tick(withTutorial(met, { activeActId: null, completedActIds: earlier })).onboarding.tutorial
        .activeActId,
    ).toBe("act.cat");

    // And not before: no cat, no card, however much else is done.
    expect(
      tick(withTutorial(fresh(), { activeActId: null, completedActIds: earlier })).onboarding
        .tutorial.activeActId,
    ).not.toBe("act.cat");
  });

  it("holds the cat's card back until the run that met it is over", () => {
    // A cat is met underground, so the gate latches mid-run and the card must
    // wait: the litterbox it points at is a dashboard panel.
    const base = fresh();
    const underground: GameState = {
      ...base,
      statistics: { ...base.statistics, catsFound: 1 },
      expedition: { ...base.expedition, status: "approaching", depth: 4 },
    };
    const mid = tick(withTutorial(underground, { activeActId: null, completedActIds: earlier }));

    // Latched, so nothing is lost — but not presenting.
    expect(mid.onboarding.tutorial.latchedGateIds).toContain("gate.cat-met");
    expect(mid.onboarding.tutorial.activeActId).toBeNull();

    const surfaced: GameState = {
      ...mid,
      expedition: { ...mid.expedition, status: "surface", depth: 0 },
    };

    expect(tick(surfaced).onboarding.tutorial.activeActId).toBe("act.cat");
  });

  it("announces the jukebox exactly at the depth that unlocks it", () => {
    // The same constant `unlockedRailEntries` reads: one depth short and the
    // card would point at a rail button that is not there.
    const atDepth = (deepestDepth: number): GameState => ({
      ...fresh(),
      statistics: { ...fresh().statistics, deepestDepth },
    });

    const short = tick(
      withTutorial(atDepth(ECONOMY.jukeboxUnlockDepth - 1), {
        activeActId: null,
        completedActIds: earlier,
      }),
    );

    expect(short.onboarding.tutorial.activeActId).toBeNull();

    const earned = tick(
      withTutorial(atDepth(ECONOMY.jukeboxUnlockDepth), {
        activeActId: null,
        completedActIds: earlier,
      }),
    );

    expect(earned.onboarding.tutorial.activeActId).toBe("act.jukebox");
  });

  it("plays each of them once per save, not once per cycle", () => {
    // Both gates read statistics that survive `applyPrestige`, so without
    // `completedActIds` a prestige would replay both — for a cat still owned and
    // a window still on the rail.
    const done: GameState = {
      ...tick(fresh()),
      statistics: {
        ...fresh().statistics,
        catsFound: 1,
        deepestDepth: ECONOMY.jukeboxUnlockDepth,
      },
      prestige: {
        ...fresh().prestige,
        count: 0,
        lifetimeCashEarned: ECONOMY.prestigeThresholdCash * 4,
        cycleCashEarned: ECONOMY.prestigeThresholdCash * 4,
        perkRanks: {},
      },
    };
    const seen = withTutorial(done, {
      activeActId: null,
      completedActIds: [...earlier, "act.cat", "act.jukebox"],
    });
    const outcome = applyPrestige(seen);

    expect(outcome.ok).toBe(true);

    if (!outcome.ok) {
      return;
    }

    // The statistics survived, which is what makes the guard necessary.
    expect(outcome.state.statistics.catsFound).toBe(1);
    expect(outcome.state.statistics.deepestDepth).toBe(ECONOMY.jukeboxUnlockDepth);

    const activeActId = tick(outcome.state).onboarding.tutorial.activeActId;

    expect(activeActId).not.toBe("act.cat");
    expect(activeActId).not.toBe("act.jukebox");
  });

  it("keeps both behind the acts a player earned", () => {
    // Declaration order decides which act wins when several triggers latch at
    // once. Neither of these is progression, so neither may queue in front of an
    // act about the system the player was working on.
    const everything = withTutorial(fresh(), {
      activeActId: null,
      latchedGateIds: [...TUTORIAL_GATES],
    });
    const opened = tick(everything).onboarding.tutorial.activeActId;

    expect(opened).not.toBe("act.cat");
    expect(opened).not.toBe("act.jukebox");

    // But ahead of the console, which is not part of the script at all.
    const indexOf = (id: string): number => TUTORIAL_ACTS.findIndex((act) => act.id === id);

    expect(indexOf("act.cat")).toBeLessThan(indexOf("act.devmenu"));
    expect(indexOf("act.jukebox")).toBeLessThan(indexOf("act.devmenu"));
  });
});
