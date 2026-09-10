/**
 * Coverage for per-machine payout cues.
 *
 * Ten cues instead of one is only worth anything if the set is *ordered* — the
 * floor should tell you how much just paid without looking. So most of these
 * tests are about the set rather than about any one sound, and about the two ways
 * ten cues can be worse than one: all firing at once, and firing for ten hours of
 * offline production on load.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, MACHINES, MACHINE_IDS } from "../../content/catalog";
import type { MachineId } from "../../content/catalog";
import {
  DEFAULT_PITCH_VARIANCE,
  SOUND_CATALOG,
  pitchVarianceOf,
} from "../../audio/soundCatalog";
import { STATIC_SOUND_IDS } from "../../domain/commands";
import { advanceMachines } from "../../domain/casino";
import { collectActiveModifiers } from "../../domain/modifiers";
import { settleOfflineProduction } from "../../domain/offline";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(seed = 6): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A state with the given machines unlocked and mid-cycle, ready to pay. */
function running(machineIds: MachineId[]): GameState {
  const base = fresh();

  return {
    ...base,
    casino: {
      ...base.casino,
      machines: MACHINE_IDS.reduce(
        (machines, machineId) => ({
          ...machines,
          [machineId]: {
            ...base.casino.machines[machineId],
            unlocked: machineIds.includes(machineId),
          },
        }),
        base.casino.machines,
      ),
    },
  };
}

function soundsFrom(result: ReturnType<typeof reduce>): string[] {
  return result.effects
    .filter((effect) => effect.type === "PLAY_SOUND")
    .map((effect) => (effect.type === "PLAY_SOUND" ? effect.soundId : ""))
    .filter((soundId) => soundId.startsWith("sound.payout."));
}

describe("the set of cues", () => {
  it("gives every machine one, and no two the same", () => {
    const ids = MACHINE_IDS.map((machineId) => `sound.payout.${machineId}`);

    for (const id of ids) {
      expect(SOUND_CATALOG[id as keyof typeof SOUND_CATALOG], id).toBeDefined();
    }

    expect(new Set(ids).size).toBe(MACHINE_IDS.length);
  });

  it("descends in pitch and lengthens as the ladder climbs", () => {
    /*
     * The only reason to have ten. If the order were scrambled the set would
     * still sound fine one cue at a time and would say nothing as a whole.
     */
    for (let index = 1; index < MACHINE_IDS.length; index += 1) {
      const previous = MACHINES[MACHINE_IDS[index - 1]].payoutCue;
      const current = MACHINES[MACHINE_IDS[index]].payoutCue;

      expect(current.frequency, MACHINE_IDS[index]).toBeLessThan(previous.frequency);
      expect(current.durationMs, MACHINE_IDS[index]).toBeGreaterThan(previous.durationMs);
    }
  });

  it("files every cue under the machine source, so one setting still mutes them", () => {
    // "Mute the machines without muting everything else" was a single generic cue
    // when it was written; it has to keep working now that there are ten.
    for (const machineId of MACHINE_IDS) {
      const definition = SOUND_CATALOG[`sound.payout.${machineId}`];

      expect(definition.source, machineId).toBe("machine");
    }
  });

  it("spaces a long cue further apart than a short one", () => {
    // A low, long cue retriggering over itself is a drone rather than a payout.
    const first = SOUND_CATALOG[`sound.payout.${MACHINE_IDS[0]}`];
    const last = SOUND_CATALOG[`sound.payout.${MACHINE_IDS[MACHINE_IDS.length - 1]}`];

    expect(last.minimumSpacingMs).toBeGreaterThan(first.minimumSpacingMs);
    expect(last.minimumSpacingMs).toBeGreaterThanOrEqual(last.durationMs);
  });
});

describe("which cues a tick plays", () => {
  const tick = (state: GameState, elapsedMs: number) =>
    reduce(state, {
      type: "TICK",
      casinoElapsedMs: elapsedMs,
      expeditionElapsedMs: 0,
      nowUnixMs: state.lastSettledAtUnixMs + elapsedMs,
    });

  it("plays the cue of the machine that actually paid", () => {
    const starter = MACHINE_IDS[0];
    const played = soundsFrom(tick(running([starter]), MACHINES[starter].baseCycleMs));

    expect(played).toEqual([`sound.payout.${starter}`]);
  });

  it("says nothing when no cycle completed", () => {
    const starter = MACHINE_IDS[0];

    expect(soundsFrom(tick(running([starter]), 10))).toEqual([]);
  });

  it("caps how many sound at once, and keeps the most valuable", () => {
    /*
     * Late on every machine is unlocked and the fast ones complete constantly.
     * Ten cues in one tick is a chord, not information — worse than the single
     * generic cue this replaced. The tail of the ladder is kept because those are
     * the machines whose payout is worth hearing about.
     */
    const all = running([...MACHINE_IDS]);
    const played = soundsFrom(tick(all, ECONOMY.maxActiveTickMs * 100));

    expect(played.length).toBeLessThanOrEqual(ECONOMY.machineCuesPerTick);
    expect(played.length).toBeGreaterThan(0);

    const expected = MACHINE_IDS.slice(-played.length).map((id) => `sound.payout.${id}`);

    expect(played).toEqual(expected);
  });

  it("reports the machines that paid, in ladder order", () => {
    const all = running([...MACHINE_IDS]);
    const advance = advanceMachines(all, 600_000, collectActiveModifiers(all));

    expect(advance.completedMachineIds.length).toBeGreaterThan(1);
    expect(advance.completedMachineIds).toEqual(
      MACHINE_IDS.filter((machineId) => advance.completedMachineIds.includes(machineId)),
    );
  });
});

describe("coming back to a settled game", () => {
  it("plays nothing for offline production", () => {
    /*
     * Eight hours of cycles would be thousands of cues if settlement went through
     * the reducer. It does not — `settleOfflineProduction` advances the machines
     * itself and returns a settlement rather than effects — and this pins that,
     * because "it happens not to emit" and "it cannot emit" look identical until
     * somebody routes it through `reduce`.
     */
    const away: GameState = {
      ...running([...MACHINE_IDS]),
      lastSettledAtUnixMs: NOW - 8 * 60 * 60 * 1000,
    };
    const settlement = settleOfflineProduction(away, NOW);

    expect(settlement.cashGranted).toBeGreaterThan(0);
    expect(Object.keys(settlement)).not.toContain("effects");
  });
});

describe("one cue per thing", () => {
  /*
   * One cue per thing that happens. Three cues covering most of the game sound
   * fine individually and leave the ear unable to tell events apart.
   *
   * `SoundId` is a union and `SOUND_CATALOG` is keyed by it, so a missing
   * definition is a compile error. These are about the part the type cannot
   * check: whether the cues are actually distinguishable.
   */
  const NON_MACHINE = (Object.keys(SOUND_CATALOG) as Array<keyof typeof SOUND_CATALOG>)
    .map((soundId) => SOUND_CATALOG[soundId])
    .filter((definition) => definition.source !== "machine");

  it("has a runtime entry for every id, not only a type-level one", () => {
    /*
     * The compiler already proves this for the catalogue literal. What it cannot
     * prove is the other direction: that the catalogue holds nothing the list has
     * not heard of. The union is derived from the list, so a stray catalogue key
     * is the one drift the compiler cannot see.
     */
    for (const soundId of STATIC_SOUND_IDS) {
      expect(SOUND_CATALOG[soundId], soundId).toBeDefined();
      expect(SOUND_CATALOG[soundId].id, soundId).toBe(soundId);
    }

    expect(new Set(STATIC_SOUND_IDS).size).toBe(STATIC_SOUND_IDS.length);
    expect(STATIC_SOUND_IDS.length).toBe(NON_MACHINE.length);
  });

  it("gives no two cues the same shape", () => {
    /*
     * Frequency, waveform and duration together. Two cues may share any one of
     * them — several share a waveform on purpose, since timbre is what groups a
     * game's pair — but sharing all three makes them the same sound with two
     * names, which is the bug this chunk fixed rather than a new way to have it.
     */
    const shapes = new Map<string, string>();

    for (const definition of NON_MACHINE) {
      const shape = `${String(definition.frequency)}/${definition.waveform}/${String(definition.durationMs)}`;
      const owner = shapes.get(shape);

      expect(owner, `${definition.id} sounds exactly like ${String(owner)}`).toBeUndefined();
      shapes.set(shape, definition.id);
    }
  });

  it("gives each of the four games its own pair", () => {
    // The specific split note 23 asked for, checked as a property of the set:
    // four distinct start cues and four distinct wins, one timbre per game.
    const games = [
      ["sound.slots.spin", "sound.slots.win"],
      ["sound.roulette.spin", "sound.roulette.win"],
      ["sound.blackjack.deal", "sound.blackjack.win"],
      ["sound.wager.place", "sound.wager.win"],
    ] as const;
    const waveforms = new Set<string>();

    for (const [start, win] of games) {
      const startCue = SOUND_CATALOG[start];
      const winCue = SOUND_CATALOG[win];

      // Timbre says which game, so a game's two cues share one and no two games do.
      expect(winCue.waveform, win).toBe(startCue.waveform);
      expect(waveforms.has(startCue.waveform), startCue.waveform).toBe(false);
      waveforms.add(startCue.waveform);

      // Direction says what happened: a win rises, and lasts longer than the start.
      expect(winCue.endFrequency, win).toBeGreaterThan(winCue.frequency);
      expect(winCue.durationMs, win).toBeGreaterThan(startCue.durationMs);
    }

    expect(waveforms.size).toBe(games.length);
  });

  it("keeps every cue quiet enough to sit under the others", () => {
    // A split that made one of the new cues twice as loud as everything else
    // would be a regression the shape checks above cannot see.
    for (const definition of NON_MACHINE) {
      expect(definition.gain, definition.id).toBeGreaterThan(0);
      expect(definition.gain, definition.id).toBeLessThanOrEqual(0.25);
    }
  });
});

describe("pitch variance", () => {
  /*
   * The other half of note 23: the same cue fifty times in a row reads as a stuck
   * key rather than as fifty things happening. A few cents of wander per playback
   * fixes that without touching what the cue *is*.
   */
  it("defaults to most of a semitone, and never more than one anywhere", () => {
    // A semitone is ~5.95%. Past that a cue is a different note, and a machine's
    // payout stops being how you recognise which machine paid.
    expect(DEFAULT_PITCH_VARIANCE).toBeLessThan(0.0595);

    /*
     * And a floor. A wander of 0.03 reaches every cue and is simply not heard,
     * which `> 0` cannot catch — so the requirement that it be most of a
     * semitone is written down as an assertion rather than a comment.
     */
    expect(DEFAULT_PITCH_VARIANCE).toBeGreaterThanOrEqual(0.04);

    for (const soundId of STATIC_SOUND_IDS) {
      const variance = pitchVarianceOf(SOUND_CATALOG[soundId]);

      expect(variance, soundId).toBeGreaterThan(0);
      expect(variance, soundId).toBeLessThanOrEqual(0.0595 * 2);
    }
  });

  it("stays inside its declared bound over many draws, and actually varies", () => {
    /*
     * The manager's own line, reproduced. Testing it through `AudioManager` would
     * need a Web Audio stub deep enough to read a scheduled frequency back, which
     * would be testing the stub; this pins the arithmetic, and the manager is one
     * expression away from it.
     */
    const detune = (variance: number): number => 1 + (Math.random() - 0.5) * 2 * variance;
    const variance = pitchVarianceOf(SOUND_CATALOG["sound.reward.pickup"]);
    const draws = Array.from({ length: 5_000 }, () => detune(variance));

    for (const value of draws) {
      expect(value).toBeGreaterThanOrEqual(1 - variance);
      expect(value).toBeLessThanOrEqual(1 + variance);
    }

    // And it is variance rather than a constant: both halves of the range get used.
    expect(Math.min(...draws)).toBeLessThan(1 - variance * 0.9);
    expect(Math.max(...draws)).toBeGreaterThan(1 + variance * 0.9);
  });

  it("gives the most repeated cue more wander than the default", () => {
    // The pickaxe fires dozens of times inside one ore encounter. If any cue
    // needs the feature it is that one, so the exception is asserted rather than
    // left to a comment.
    expect(pitchVarianceOf(SOUND_CATALOG["sound.pickaxe.impact"])).toBeGreaterThan(
      DEFAULT_PITCH_VARIANCE,
    );
  });

  it("gives every machine payout more wander still, as the loudest case of all", () => {
    /*
     * Ten machines on a full floor, each free to fire every 160ms, is where the
     * fatigue the note is about actually comes from — more repetition than the
     * pickaxe, whose exception was written before the floor had ten machines on
     * it to compare against.
     *
     * Strictly greater, not "at least": a machine cue that declared nothing
     * would fall back to the default and satisfy a `>=` without the declaration
     * existing at all. Asserted over the generated set rather than by name, so a
     * new machine cannot arrive at the default by omission either.
     */
    const machineCues = (Object.keys(SOUND_CATALOG) as Array<keyof typeof SOUND_CATALOG>).filter(
      (soundId) => SOUND_CATALOG[soundId].source === "machine",
    );

    expect(machineCues.length).toBeGreaterThan(1);

    for (const soundId of machineCues) {
      expect(pitchVarianceOf(SOUND_CATALOG[soundId]), soundId).toBeGreaterThan(
        DEFAULT_PITCH_VARIANCE,
      );
    }
  });
});
