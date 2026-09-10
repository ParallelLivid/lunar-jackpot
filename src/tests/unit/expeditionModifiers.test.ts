/**
 * Coverage for run modifiers.
 *
 * The rules worth pinning are the ones a player would notice being broken: that
 * a condition is occasional rather than routine, that it cannot change under
 * them mid-run, and that the stranger ones stay locked until they have earned
 * them.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, EXPEDITION_MODIFIERS } from "../../content/catalog";
import { DEPTH_BANDS, DEPTH_BAND_IDS } from "../../content/depthBands";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectExpeditionView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;

function launched(seed: number, deepestDepth = 0): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });

  return reduce(
    { ...base, statistics: { ...base.statistics, deepestDepth } },
    { type: "LAUNCH_EXPEDITION" },
  ).state;
}

/** How many of `count` launches rolled a condition. */
function rollRate(count: number, deepestDepth = 0): number {
  let hits = 0;

  for (let seed = 1; seed <= count; seed += 1) {
    if (launched(seed, deepestDepth).expedition.activeModifierId !== null) {
      hits += 1;
    }
  }

  return hits / count;
}

describe("rolling a run modifier", () => {
  it("is occasional, and never guaranteed", () => {
    const rate = rollRate(1_200);

    // Within a couple of points of the configured chance over a large sample.
    expect(rate).toBeGreaterThan(ECONOMY.expeditionModifierChance - 0.04);
    expect(rate).toBeLessThan(ECONOMY.expeditionModifierChance + 0.04);

    // The point of the feature is that most runs are ordinary.
    expect(rate).toBeLessThan(0.5);
  });

  it("gives the same run the same condition for the same seed", () => {
    for (const seed of [7, 19, 44, 61]) {
      expect(launched(seed).expedition.activeModifierId).toBe(
        launched(seed).expedition.activeModifierId,
      );
    }
  });

  it("only offers what the player has already reached", () => {
    /*
     * The roll happens at depth zero, so gating on the run's own band would gate
     * nothing. It gates on how deep the player has ever been instead.
     */
    const shallow = new Set<string>();

    for (let seed = 1; seed <= 600; seed += 1) {
      const id = launched(seed, 0).expedition.activeModifierId;

      if (id !== null) {
        shallow.add(id);
      }
    }

    expect(shallow.size).toBeGreaterThan(0);

    for (const id of shallow) {
      expect(
        EXPEDITION_MODIFIERS[id as keyof typeof EXPEDITION_MODIFIERS].requiredBand,
        `${id} was offered to a player who has never left the first band`,
      ).toBe(DEPTH_BAND_IDS[0]);
    }
  });

  it("opens the deeper conditions once the player has been deep", () => {
    const deep = new Set<string>();

    for (let seed = 1; seed <= 600; seed += 1) {
      const id = launched(seed, DEPTH_BANDS["band.core"].minimum).expedition.activeModifierId;

      if (id !== null) {
        deep.add(id);
      }
    }

    const bands = new Set(
      [...deep].map(
        (id) => EXPEDITION_MODIFIERS[id as keyof typeof EXPEDITION_MODIFIERS].requiredBand,
      ),
    );

    expect(bands.size).toBeGreaterThan(1);
  });
});

describe("a rolled condition during the run", () => {
  /** A seed whose launch rolls a condition, so the test is not hunting for one. */
  function seedWithModifier(): number {
    for (let seed = 1; seed <= 400; seed += 1) {
      if (launched(seed).expedition.activeModifierId !== null) {
        return seed;
      }
    }

    throw new Error("no seed rolled a run modifier");
  }

  it("is folded into the loadout before anything is snapshotted", () => {
    const seed = seedWithModifier();
    const state = launched(seed);
    const id = state.expedition.activeModifierId;
    const sources = new Set(
      (state.expedition.modifierSnapshot?.modifiers ?? []).map((entry) => entry.sourceId),
    );

    expect(id).not.toBeNull();
    expect(sources.has(id ?? "")).toBe(true);
  });

  it("cannot change under the player mid-run", () => {
    let state = launched(seedWithModifier());
    const original = state.expedition.activeModifierId;

    for (let tick = 0; tick < 400; tick += 1) {
      state = reduce(state, {
        type: "TICK",
        casinoElapsedMs: 0,
        expeditionElapsedMs: 200,
        nowUnixMs: state.lastSettledAtUnixMs + 200,
      }).state;

      if (state.expedition.status === "surface") {
        break;
      }

      expect(state.expedition.activeModifierId).toBe(original);
    }
  });

  it("survives a reload", () => {
    const state = launched(seedWithModifier());
    const envelope = createEnvelope(state, 1, NOW);
    const restored = normalizeGameState(envelope.game, NOW).state;

    expect(restored.expedition.activeModifierId).toBe(state.expedition.activeModifierId);
    // And its effects come back with it, since they live in the snapshot.
    expect(restored.expedition.modifierSnapshot?.modifiers.length).toBe(
      state.expedition.modifierSnapshot?.modifiers.length,
    );
  });

  it("is named on the expedition view, since launch is the only moment to show it", () => {
    const state = launched(seedWithModifier());
    const view = selectExpeditionView(deriveContext(state));

    expect(view.activeModifier).not.toBeNull();
    expect(view.activeModifier?.displayName.length).toBeGreaterThan(0);
    expect(view.activeModifier?.description.length).toBeGreaterThan(0);
  });

  it("leaves an ordinary run with nothing to report", () => {
    let seed = 1;

    while (launched(seed).expedition.activeModifierId !== null) {
      seed += 1;
    }

    expect(selectExpeditionView(deriveContext(launched(seed))).activeModifier).toBeNull();
  });
});

describe("what the conditions actually do", () => {
  it("revives the failure-loss stat, which nothing else touches", () => {
    /*
     * No collectible touches `expedition.failureLossChance`. Two run modifiers
     * are the only things that move it, which is worth pinning: if they go, the
     * clamp and its tests are guarding a constant.
     */
    const touching = Object.values(EXPEDITION_MODIFIERS).filter((modifier) =>
      modifier.modifiers.some(
        (entry) => entry.targetStat === "expedition.failureLossChance",
      ),
    );

    expect(touching.length).toBeGreaterThan(0);
  });

  it("keeps the mixed ones genuinely mixed", () => {
    // A condition that is purely good is a bonus, not a condition.
    const thinAir = EXPEDITION_MODIFIERS["modifier.thin-air"];
    const gives = thinAir.modifiers.some(
      (entry) => entry.operation === "multiply" && entry.value > 1,
    );
    const takes = thinAir.modifiers.some(
      (entry) => entry.operation === "multiply" && entry.value < 1,
    );

    expect(gives && takes).toBe(true);
  });
});
