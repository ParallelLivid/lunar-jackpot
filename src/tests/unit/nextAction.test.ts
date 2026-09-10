/**
 * The Help window's recommendation.
 *
 * These were the contextual callouts under the resource bar. Moving them into
 * the manual changed three things about them, and each has a test here because
 * each is a property the old version deliberately did not have: there is no
 * dismissal, the tutorial does not silence it, and it always has an answer.
 *
 * That last one is the load-bearing property. The pane that renders this is on
 * screen whenever the window is open, so a selector that could return null would
 * be a blank panel — and the case it would be blank in is the *late* save, where
 * "what now" is the hardest question the game has.
 */

import { describe, expect, it } from "vitest";
import { HELP_TOPICS } from "../../content/help";
import { deriveContext, selectNextAction } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(): GameState {
  return createGameState({ nowUnixMs: NOW, seed: 3 });
}

function recommend(state: GameState) {
  return selectNextAction(deriveContext(state));
}

/** A save past every first-time condition the recommendations are ordered by. */
function veteran(): GameState {
  const base = fresh();

  return {
    ...base,
    resources: { ...base.resources, chips: 0, caches: 0, keys: 5 },
    onboarding: {
      ...base.onboarding,
      hasPurchasedMachineLevel: true,
      hasLaunchedExpedition: true,
      hasBankedRun: true,
    },
  };
}

describe("what to do next", () => {
  it("opens on the first machine level", () => {
    const action = recommend(fresh());

    expect(action.id).toBe("next.first-upgrade");
    expect(action.title).toBe("Buy your first machine level");
  });

  it("says the same thing differently once the level is affordable", () => {
    // Both wordings are the same recommendation: the difference is whether the
    // player is waiting for the floor or can act now.
    const poor = recommend(fresh());
    const rich = recommend({
      ...fresh(),
      resources: { ...fresh().resources, cash: 100_000 },
    });

    expect(rich.id).toBe(poor.id);
    expect(rich.body).not.toBe(poor.body);
    expect(rich.body).toContain("the expedition waits until you have");
  });

  it("moves on as each first time passes", () => {
    const state = fresh();
    const bought: GameState = {
      ...state,
      onboarding: { ...state.onboarding, hasPurchasedMachineLevel: true },
    };

    expect(recommend(bought).id).toBe("next.first-expedition");

    const launched: GameState = {
      ...bought,
      onboarding: { ...bought.onboarding, hasLaunchedExpedition: true },
    };

    expect(recommend(launched).id).not.toBe("next.first-expedition");
  });

  it("asks for a key when a cache cannot be opened", () => {
    const base = veteran();
    const sealed: GameState = {
      ...base,
      resources: { ...base.resources, caches: 2, keys: 0 },
    };

    expect(recommend(sealed).id).toBe("next.buy-key");
  });

  /**
   * The property the pane depends on. A `null` here is a blank panel.
   */
  it("always has an answer, and it is depth once the rest have passed", () => {
    const action = recommend(veteran());

    expect(action.id).toBe("next.go-deeper");
    expect(action.title).toBe("Go deeper");
    expect(action.body.length).toBeGreaterThan(0);
  });

  it("points every recommendation at a topic that exists", () => {
    const states: GameState[] = [
      fresh(),
      veteran(),
      { ...veteran(), resources: { ...veteran().resources, caches: 1, keys: 0 } },
      { ...veteran(), resources: { ...veteran().resources, chips: 500 } },
      {
        ...fresh(),
        onboarding: { ...fresh().onboarding, hasPurchasedMachineLevel: true },
      },
    ];

    for (const state of states) {
      const action = recommend(state);

      expect(HELP_TOPICS[action.topicId], action.id).toBeDefined();
      expect(action.title.length, action.id).toBeGreaterThan(0);
    }
  });

  it("is the same answer whatever the tutorial is doing", () => {
    /*
     * The callout returned null for the whole script. This does not: a panel the
     * player opened deliberately is not the game speaking over itself, and the
     * player most likely to go looking for it is the one who skipped.
     */
    const base = fresh();
    const running = recommend(base);

    for (const status of ["skipped", "finished"] as const) {
      const other: GameState = {
        ...base,
        onboarding: {
          ...base.onboarding,
          tutorial: { ...base.onboarding.tutorial, status, activeActId: null },
        },
      };

      expect(recommend(other).id).toBe(running.id);
      expect(recommend(other).body).toBe(running.body);
    }
  });
});
