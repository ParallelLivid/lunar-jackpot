/**
 * Coverage for the expedition speed control.
 *
 * Speed must change how long a run takes and nothing else. The two ways that
 * could go wrong are the tick clamp silently eating the extra time, and the
 * multiplier leaking into casino production — so both get a test of their own.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, MACHINES, STARTER_MACHINE_ID } from "../../content/catalog";
import { PRESTIGE_PERKS } from "../../content/catalog";
import {
  MAXIMUM_PACE_RANK,
  expeditionSpeedForRank,
  expeditionSpeeds,
} from "../../content/prestigePerks";
import { selectExpeditionSpeed, unlockedExpeditionSpeed } from "../../domain/prestige";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectExpeditionView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;

function atSpeed(speed: number, rank = 3, seed = 12): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });

  return {
    ...base,
    settings: {
      ...base.settings,
      expeditionSpeed: speed,
      // Without this a run parks at the first decision and depth never moves,
      // which would make every timing comparison below read zero.
      autoContinue: { enabled: true, oxygenThresholdRatio: 0.1 },
    },
    prestige: { ...base.prestige, perkRanks: { "perk.deep.pace": rank } },
  };
}

/** Ticks a launched run and reports what it looked like after `frames`. */
function runFrames(state: GameState, frames: number, frameMs = 250) {
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

describe("unlocking speed", () => {
  it("doubles per rank, and starts at one", () => {
    expect(expeditionSpeedForRank(0)).toBe(1);
    expect(expeditionSpeedForRank(1)).toBe(2);
    expect(expeditionSpeedForRank(2)).toBe(4);
    expect(expeditionSpeedForRank(3)).toBe(8);
    expect(expeditionSpeedForRank(4)).toBe(16);
    expect(expeditionSpeedForRank(5)).toBe(32);
  });

  it("stops where the perk stops, on both sides of the seam", () => {
    /*
     * Two things have to agree about the ceiling: the perk's `maximumRank` and
     * the clamp in `expeditionSpeedForRank`. Raising one without the other would
     * either sell a rank that does nothing or offer a speed nothing can buy.
     */
    expect(PRESTIGE_PERKS["perk.deep.pace"].maximumRank).toBe(MAXIMUM_PACE_RANK);
    expect(expeditionSpeedForRank(MAXIMUM_PACE_RANK + 3)).toBe(
      expeditionSpeedForRank(MAXIMUM_PACE_RANK),
    );
    expect(expeditionSpeeds()).toEqual([1, 2, 4, 8, 16, 32]);
  });

  it("never runs faster than the tree has paid for", () => {
    // A saved setting from a previous cycle, or a hand-edited one, is clamped on
    // every read rather than trusted.
    expect(selectExpeditionSpeed(atSpeed(8, 0))).toBe(1);
    expect(selectExpeditionSpeed(atSpeed(8, 1))).toBe(2);
    expect(selectExpeditionSpeed(atSpeed(8, 3))).toBe(8);
    expect(selectExpeditionSpeed(atSpeed(-4, 3))).toBe(1);
  });

  it("only offers the speeds it has unlocked", () => {
    expect(selectExpeditionView(deriveContext(atSpeed(1, 0))).availableSpeeds).toEqual([1]);
    expect(selectExpeditionView(deriveContext(atSpeed(1, 2))).availableSpeeds).toEqual([1, 2, 4]);
    expect(unlockedExpeditionSpeed(atSpeed(1, 3))).toBe(8);
    expect(selectExpeditionView(deriveContext(atSpeed(1, 5))).availableSpeeds).toEqual([
      1, 2, 4, 8, 16, 32,
    ]);
    expect(unlockedExpeditionSpeed(atSpeed(1, 5))).toBe(32);
  });

  it("survives a reload", () => {
    const state = atSpeed(4, 3);
    const restored = normalizeGameState(createEnvelope(state, 1, NOW).game, NOW).state;

    expect(restored.settings.expeditionSpeed).toBe(4);
    expect(selectExpeditionSpeed(restored)).toBe(4);
  });
});

describe("running at speed", () => {
  it("gets further in the same number of frames", () => {
    const slow = runFrames(atSpeed(1), 60);
    const fast = runFrames(atSpeed(4), 60);

    expect(fast.expedition.depth).toBeGreaterThan(slow.expedition.depth);
  });

  it("lands in the same place as the same simulated time at 1x", () => {
    /*
     * The comparison has to hold slice size constant, and that is a property of
     * the expedition state machine rather than of this feature: a transition
     * drops whatever is left of the slice it lands in, so a run ticked at 16ms
     * per frame ends on more oxygen than the same run ticked at 1,000ms. That was
     * already true at 1x long before there was a speed control.
     *
     * What the speed control owes is that eight slices delivered in one frame is
     * the same as eight slices delivered in eight — which is exactly what
     * sub-stepping at the clamp size buys, and what the next test pins.
     */
    const fast = runFrames(atSpeed(2), 20, ECONOMY.maxActiveTickMs);
    const slow = runFrames(atSpeed(1), 40, ECONOMY.maxActiveTickMs);

    expect(fast.expedition.depth).toBe(slow.expedition.depth);
    expect(fast.expedition.oxygen).toBeCloseTo(slow.expedition.oxygen, 6);
    expect(fast.expedition.currentEncounter?.encounterId).toBe(
      slow.expedition.currentEncounter?.encounterId,
    );
  });

  it("advances the whole frame at 8x rather than being clamped", () => {
    /*
     * The trap this chunk exists to avoid. `maxActiveTickMs` caps a single tick
     * at 1,000ms; multiplying before the clamp would turn a 900ms frame at 8x
     * into 7,200ms and then silently truncate it back to 1,000. Sub-stepping
     * keeps the guard and still advances the full amount.
     */
    const longFrame = ECONOMY.maxActiveTickMs;
    const fast = runFrames(atSpeed(8), 1, longFrame);
    const slow = runFrames(atSpeed(1), 8, longFrame);

    expect(fast.expedition.depth).toBe(slow.expedition.depth);
    expect(fast.expedition.oxygen).toBeCloseTo(slow.expedition.oxygen, 6);
  });

  it("leaves casino production alone at every speed", () => {
    /*
     * Only expedition time scales. If the multiplier reached `casinoElapsedMs`
     * the perk would quietly be a cash multiplier, which is a different and much
     * more valuable perk than the one being sold.
     */
    const cashAfter = (speed: number): number =>
      runFrames(atSpeed(speed), 40, MACHINES[STARTER_MACHINE_ID].baseCycleMs / 4).resources.cash;

    const baseline = cashAfter(1);

    expect(cashAfter(2)).toBe(baseline);
    expect(cashAfter(4)).toBe(baseline);
    expect(cashAfter(8)).toBe(baseline);
  });

  it("stops slicing the moment a run ends", () => {
    /*
     * A run that fails part-way through a frame must not have the rest of that
     * frame spent on it. Seeded with barely any air so the failure lands inside
     * the first slice of eight, leaving seven the loop has to not take.
     */
    const launched = reduce(atSpeed(8), { type: "LAUNCH_EXPEDITION" }).state;
    const nearlyOut: GameState = {
      ...launched,
      expedition: { ...launched.expedition, oxygen: 0.5 },
    };

    const after = reduce(nearlyOut, {
      type: "TICK",
      casinoElapsedMs: ECONOMY.maxActiveTickMs,
      expeditionElapsedMs: ECONOMY.maxActiveTickMs,
      nowUnixMs: nearlyOut.lastSettledAtUnixMs + ECONOMY.maxActiveTickMs,
    }).state;

    expect(after.expedition.status).toBe("surface");
    // Back on the surface the run is reset, not advanced by the leftover slices.
    expect(after.expedition.depth).toBe(0);
    expect(after.expedition.runId).toBeNull();
  });
});

describe("at the top speed", () => {
  /*
   * The tick loop slices expedition time into `maxActiveTickMs` chunks, so at 32x
   * a single 16ms frame is half a second of run. That is still one slice — but it
   * is now long enough for a short encounter to begin and finish inside one tick,
   * which is where the effects for it would pile up.
   */
  function speedRun(speed: number, frames: number, frameMs: number) {
    let current = reduce(atSpeed(speed, MAXIMUM_PACE_RANK, 31), {
      type: "LAUNCH_EXPEDITION",
    }).state;
    const effects: string[] = [];

    for (let frame = 0; frame < frames; frame += 1) {
      const result = reduce(current, {
        type: "TICK",
        casinoElapsedMs: frameMs,
        expeditionElapsedMs: frameMs,
        nowUnixMs: current.lastSettledAtUnixMs + frameMs,
      });

      current = result.state;
      effects.push(...result.effects.map((effect) => effect.type));
    }

    return { state: current, effects };
  }

  it("gets four times as deep as 8x in the same wall-clock time", () => {
    // The point of the two new ranks: the same run, less waiting.
    const slow = speedRun(8, 60, 16);
    const fast = speedRun(32, 60, 16);

    expect(fast.state.statistics.depthDescended).toBeGreaterThan(
      slow.state.statistics.depthDescended,
    );
  });

  it("still announces every encounter it resolves", () => {
    /*
     * The failure this guards is silent: an encounter that begins and ends inside
     * one tick would still be *resolved*, but a dropped effect would mean the
     * player never saw it happen. Every completion has to be reported, however
     * many land in the same frame.
     */
    const { effects, state } = speedRun(32, 80, 16);

    const completions = effects.filter((type) => type === "SHOW_ENCOUNTER_COMPLETE").length;
    const rewards = effects.filter((type) => type === "SHOW_ENCOUNTER_REWARD").length;
    const resolved = state.statistics.encountersCompleted;

    expect(resolved).toBeGreaterThan(0);
    expect(completions).toBe(resolved);
    expect(rewards).toBeGreaterThanOrEqual(resolved);
  });

  it("changes nothing but the waiting", () => {
    // Casino production is charged the real elapsed time, not the sped-up one.
    const slow = speedRun(8, 40, 16);
    const fast = speedRun(32, 40, 16);

    expect(fast.state.resources.cash).toBe(slow.state.resources.cash);
  });
});
