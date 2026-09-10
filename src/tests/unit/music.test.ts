/**
 * Coverage for procedural music. `AudioManager` builds its own `AudioContext`
 * and offers no way to see what it scheduled; the music engine takes its context
 * as an argument, so a fake can record every oscillator. That makes the useful
 * questions answerable: did it schedule the right notes for this window, did a
 * track change fade or cut, does muting actually stop the clock.
 */

import { describe, expect, it } from "vitest";
import { DEPTH_BANDS, DEPTH_BAND_IDS } from "../../content/depthBands";
import {
  BAR_SIXTEENTHS,
  MUSIC_TRACKS,
  MUSIC_TRACK_IDS,
  trackLoopInSixteenths,
  voiceLengthInSixteenths,
  type MusicTrackId,
} from "../../content/music";
import { createMusicEngine, type AudioContextLike } from "../../audio/musicEngine";
import { ECONOMY } from "../../content/catalog";
import { selectMusicTrackId } from "../../domain/selectors";
import { JUKEBOX_UNLOCK_NOTICE, reduce } from "../../domain/reducer";
import {
  createFreshSettingsState,
  createGameState,
  type ExpeditionStatus,
  type GameState,
} from "../../domain/state";

// ---------------------------------------------------------------------------
// A fake Web Audio context that records rather than sounds.

interface ScheduledNote {
  waveform: string;
  frequency: number;
  startAt: number;
  endsAt: number;
}

interface GainRamp {
  value: number;
  atTime: number;
}

interface FakeContext extends AudioContextLike {
  notes: ScheduledNote[];
  /** Every gain node created that was connected to the destination — one per deck. */
  deckGains: GainRamp[][];
  advance(seconds: number): void;
  /** The autoplay policy: a real context is suspended until a user gesture. */
  unlock(): void;
}

function createFakeContext(startSuspended = false): FakeContext {
  const notes: ScheduledNote[] = [];
  const deckGains: GainRamp[][] = [];
  const destination = {} as AudioNode;

  let time = 0;
  let state = startSuspended ? "suspended" : "running";

  const makeParam = (ramps: GainRamp[] | null) => ({
    value: 0,
    setValueAtTime(value: number, atTime: number) {
      ramps?.push({ value, atTime });

      return this;
    },
    linearRampToValueAtTime(value: number, atTime: number) {
      ramps?.push({ value, atTime });

      return this;
    },
    exponentialRampToValueAtTime(value: number, atTime: number) {
      ramps?.push({ value, atTime });

      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  });

  return {
    get currentTime() {
      return time;
    },
    destination,
    notes,
    deckGains,
    get state() {
      return state;
    },
    advance(seconds: number) {
      // A suspended context's clock does not run, which is why scheduling into
      // one goes wrong so quietly.
      if (state === "running") {
        time += seconds;
      }
    },
    unlock() {
      state = "running";
    },
    createGain() {
      // A deck's gain connects straight to the destination and a note's envelope
      // connects to a deck, so which is which is decided at connection time.
      const ramps: GainRamp[] = [];

      return {
        gain: makeParam(ramps),
        connect(target: unknown) {
          if (target === destination) {
            deckGains.push(ramps);
          }
        },
        disconnect() {
          /* nothing to undo in a fake */
        },
      } as unknown as GainNode;
    },
    createOscillator() {
      const note: ScheduledNote = { waveform: "", frequency: 0, startAt: 0, endsAt: 0 };

      return {
        set type(value: string) {
          note.waveform = value;
        },
        get type() {
          return note.waveform;
        },
        frequency: {
          setValueAtTime(value: number) {
            note.frequency = value;
          },
          linearRampToValueAtTime() {
            /* music holds a pitch; only cues glide */
          },
        },
        connect() {
          /* the envelope, which the deck gain already accounts for */
        },
        start(atTime: number) {
          note.startAt = atTime;
        },
        stop(atTime: number) {
          note.endsAt = atTime;
          notes.push(note);
        },
      } as unknown as OscillatorNode;
    },
  };
}

/** A manual timer, so a test decides when the scheduler wakes up. */
function createFakeTimer() {
  const callbacks: (() => void)[] = [];

  return {
    setTimer: (callback: () => void) => {
      callbacks.push(callback);

      return callbacks.length - 1;
    },
    clearTimer: (handle: unknown) => {
      callbacks[handle as number] = () => undefined;
    },
    /** Runs every live scheduler callback once. */
    fire() {
      for (const callback of [...callbacks]) {
        callback();
      }
    },
  };
}

function engineOn(context: FakeContext, timer: ReturnType<typeof createFakeTimer>) {
  return createMusicEngine({
    getContext: () => context,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    lookaheadMs: 100,
    crossfadeMs: 1_500,
  });
}

const LOUD = { ...createFreshSettingsState(), masterVolume: 1, musicVolume: 1, muted: false };

// ---------------------------------------------------------------------------

describe("the track content", () => {
  it("has a track for the casino and for every band, and nothing spare", () => {
    // Templated over `DepthBandId`, as the payout cues are over `MachineId`, so
    // a new band cannot arrive silent.
    expect(MUSIC_TRACK_IDS).toHaveLength(DEPTH_BAND_IDS.length + 1);

    for (const trackId of MUSIC_TRACK_IDS) {
      expect(MUSIC_TRACKS[trackId], trackId).toBeDefined();
      expect(MUSIC_TRACKS[trackId].id, trackId).toBe(trackId);
    }

    expect(Object.keys(MUSIC_TRACKS)).toHaveLength(MUSIC_TRACK_IDS.length);
  });

  it("slows and drops in pitch as the bands get deeper", () => {
    // The property the whole set exists for: six tracks that merely differed
    // would say nothing, while six that descend say how deep you are.
    const bandTracks = DEPTH_BAND_IDS.map(
      (bandId) => MUSIC_TRACKS[`music.${bandId}` as MusicTrackId],
    );

    for (let index = 1; index < bandTracks.length; index += 1) {
      const previous = bandTracks[index - 1];
      const current = bandTracks[index];

      expect(current.bpm, current.id).toBeLessThan(previous.bpm);
      expect(current.rootHz, current.id).toBeLessThan(previous.rootHz);
    }

    // And the casino is brighter and faster than anything below it.
    expect(MUSIC_TRACKS["music.casino"].bpm).toBeGreaterThan(bandTracks[0].bpm);
    expect(MUSIC_TRACKS["music.casino"].rootHz).toBeGreaterThan(bandTracks[0].rootHz);
  });

  it("loops for long enough not to be a jingle", () => {
    // Voices are deliberately unequal so the effective loop is their least
    // common multiple: equal lengths silently make the track four bars.
    for (const trackId of MUSIC_TRACK_IDS) {
      const track = MUSIC_TRACKS[trackId];
      const bars = trackLoopInSixteenths(track) / 16;

      expect(bars, `${trackId} loops every ${String(bars)} bars`).toBeGreaterThanOrEqual(12);

      for (const trackVoice of track.voices) {
        expect(voiceLengthInSixteenths(trackVoice), trackId).toBeGreaterThan(0);
        expect(trackVoice.gain, trackId).toBeGreaterThan(0);
        // Music sits under the cues; a voice louder than an effect would bury it.
        expect(trackVoice.gain, trackId).toBeLessThan(0.15);
      }
    }
  });

  /**
   * The Shelf's third voice. Two arithmetic faults are pinned below, both
   * audible as "not quite matching": a note length of 3 against a bar of 16, so
   * accents never land on the beat, and a 60-sixteenth cycle slipping a
   * quarter-bar per pass against a 64-sixteenth bass that changes chord each bar.
   */
  describe("The Shelf's arpeggio", () => {
    const shelf = MUSIC_TRACKS["music.band.shelf"];
    const [lead, bass, arpeggio] = shelf.voices;

    it("lands on the beat rather than walking around it", () => {
      // Every note starts on a sixteenth the bar also starts on. Stated as the
      // length dividing the bar, since the voice is a steady run.
      for (const note of arpeggio.notes) {
        expect(BAR_SIXTEENTHS % note.duration, `duration ${String(note.duration)}`).toBe(0);
      }
    });

    it("phases against the bass by whole bars, not by fractions of one", () => {
      const arpBars = voiceLengthInSixteenths(arpeggio) / BAR_SIXTEENTHS;
      const bassBars = voiceLengthInSixteenths(bass) / BAR_SIXTEENTHS;

      // A whole number of bars each, so a pass never lands mid-chord...
      expect(Number.isInteger(arpBars)).toBe(true);
      expect(Number.isInteger(bassBars)).toBe(true);
      // ...and unequal, so the figure moves over the progression rather than
      // sitting on it. Equal lengths would also drop the loop under 12 bars.
      expect(arpBars).not.toBe(bassBars);
      expect(arpBars % bassBars).not.toBe(0);
    });

    it("uses only notes that fit every chord the bass plays", () => {
      // The consequence of phasing: a voice sitting over I, IV, vi and V in turn
      // cannot be chordal, so it is modal. F major pentatonic fights none of the
      // four, which is why this voice's slip is inaudible.
      const pentatonic = new Set([0, 2, 4, 7, 9]);

      for (const note of arpeggio.notes) {
        if (note.pitch === null) {
          continue;
        }

        expect(pentatonic.has(((note.pitch % 12) + 12) % 12), `pitch ${String(note.pitch)}`).toBe(
          true,
        );
      }
    });

    it("leaves the lead and the bass alone", () => {
      // The lead and bass are untouched: lengths are the cheapest proof that
      // nothing was rewritten while the quiet voice was fixed.
      expect(voiceLengthInSixteenths(lead)).toBe(128);
      expect(voiceLengthInSixteenths(bass)).toBe(64);
    });
  });

  /**
   * The rule the two rewrites satisfy, applied to every track. Two voices ran
   * between the beats — a note length of 3 and one of 6 — and both were audible
   * as "not quite matching" long before anyone counted them.
   */
  it("keeps every note on a bar boundary", () => {
    /*
     * Not "the duration divides a bar": that fails three innocent voices whose
     * notes run 32 and 48 sixteenths — whole bars, as on the beat as it is
     * possible to be. What separates the good from the bad is landing on a bar
     * boundary at all: a length either divides a bar or is made of them.
     */
    for (const trackId of MUSIC_TRACK_IDS) {
      for (const trackVoice of MUSIC_TRACKS[trackId].voices) {
        for (const note of trackVoice.notes) {
          const onGrid =
            BAR_SIXTEENTHS % note.duration === 0 || note.duration % BAR_SIXTEENTHS === 0;

          expect(onGrid, `${trackId}: a note of ${String(note.duration)} sixteenths`).toBe(true);
        }
      }
    }
  });

  /**
   * The two deepest tracks. Density, register and mode carry them rather than
   * tempo, which descends by design and is held to it by the test above. Mode is
   * the assertable part, and it is also what makes "unique" a claim rather than
   * an adjective: neither mode appears anywhere else in the set.
   */
  describe("the two deepest tracks", () => {
    const pitchClass = (semitones: number): number => ((semitones % 12) + 12) % 12;

    const pitchClassesIn = (trackId: MusicTrackId): Set<number> =>
      new Set(
        MUSIC_TRACKS[trackId].voices
          .flatMap((trackVoice) => trackVoice.notes)
          .filter((note) => note.pitch !== null)
          .map((note) => pitchClass(note.pitch as number)),
      );

    it("writes The Hollows in Lydian, raised fourth and all", () => {
      // The #4 is the ethereal interval, and why this mode was chosen over any
      // other bright one.
      const lydian = new Set([0, 2, 4, 6, 7, 9, 11]);
      const used = pitchClassesIn("music.band.hollow");

      for (const degree of used) {
        expect(lydian.has(degree), `Lydian has no ${String(degree)}`).toBe(true);
      }

      expect(used.has(6), "the raised fourth is what makes it Lydian").toBe(true);
    });

    it("writes the Core in whole tones, so it can never settle", () => {
      // No leading tone and no perfect fifth above the root, so nothing in the
      // mode resolves: the track cannot arrive anywhere, which sounds weightless
      // rather than sad.
      const used = pitchClassesIn("music.band.core");

      for (const degree of used) {
        expect(degree % 2, `${String(degree)} is not a whole tone from the root`).toBe(0);
      }

      // And it really is the whole mode rather than a triad that happens to fit.
      expect(used.size).toBeGreaterThanOrEqual(5);
    });

    it("gives each of them a fourth voice, and a colour nothing else uses", () => {
      for (const trackId of ["music.band.hollow", "music.band.core"] as const) {
        const track = MUSIC_TRACKS[trackId];

        expect(track.voices, trackId).toHaveLength(4);
        // `sine` is used nowhere else in the set, so the shimmer is a new timbre
        // rather than a fourth copy of an existing one.
        expect(
          track.voices.some((trackVoice) => trackVoice.waveform === "sine"),
          trackId,
        ).toBe(true);
      }
    });

    it("buys motion with the fourth voice, not volume", () => {
      // Not "no louder than the casino", which would fail The Dark at 0.175
      // against the casino's 0.165. What matters is that a fourth voice added no
      // loudness: the two four-voice tracks sit at or below the loudest
      // three-voice one.
      const sum = (trackId: MusicTrackId): number =>
        MUSIC_TRACKS[trackId].voices.reduce((total, trackVoice) => total + trackVoice.gain, 0);

      const loudestOfThree = Math.max(
        ...MUSIC_TRACK_IDS.filter((trackId) => MUSIC_TRACKS[trackId].voices.length === 3).map(sum),
      );

      for (const trackId of ["music.band.hollow", "music.band.core"] as const) {
        expect(sum(trackId), trackId).toBeLessThanOrEqual(loudestOfThree);
      }
    });
  });
});

describe("which track plays", () => {
  const NOW = 1_700_000_000_000;

  function atDepth(depth: number): GameState {
    const base = createGameState({ nowUnixMs: NOW, seed: 3 });

    return {
      ...base,
      expedition: { ...base.expedition, status: "approaching", depth },
    };
  }

  it("plays the casino on the surface", () => {
    expect(selectMusicTrackId(createGameState({ nowUnixMs: NOW, seed: 1 }))).toBe("music.casino");
  });

  it("follows the band a run is in, at every band", () => {
    for (const bandId of DEPTH_BAND_IDS) {
      expect(selectMusicTrackId(atDepth(DEPTH_BANDS[bandId].minimum)), bandId).toBe(
        `music.${bandId}`,
      );
    }
  });

  it("goes quiet through the transitions rather than cutting between tracks", () => {
    // Launching and extracting are moments rather than places: a track that
    // started on one and stopped on the next would be a stab.
    const base = createGameState({ nowUnixMs: NOW, seed: 1 });
    const launching = reduce(base, { type: "LAUNCH_EXPEDITION" }).state;

    expect(launching.expedition.status).toBe("launching");
    expect(selectMusicTrackId(launching)).toBeNull();
  });

  it("names a track that exists, for every state it can return", () => {
    for (const depth of [0, 24, 25, 74, 99, 100, 5_000]) {
      const trackId = selectMusicTrackId(atDepth(depth));

      expect(trackId, `depth ${String(depth)}`).not.toBeNull();
      expect(MUSIC_TRACKS[trackId as MusicTrackId], `depth ${String(depth)}`).toBeDefined();
    }
  });
});

/**
 * The jukebox. One promise: while it is on, nothing the game does changes the
 * track. So the interesting cases are the states that would change it — every
 * expedition status, including the three that normally return null — and the
 * unlock, which has to hold against a save that was not honestly earned.
 */
describe("the jukebox", () => {
  const NOW = 1_700_000_000_000;
  const UNLOCK = ECONOMY.jukeboxUnlockDepth;

  function withJukebox(
    trackId: MusicTrackId,
    deepestDepth: number,
    status: ExpeditionStatus = "surface",
    depth = 0,
  ): GameState {
    const base = createGameState({ nowUnixMs: NOW, seed: 5 });

    return {
      ...base,
      expedition: { ...base.expedition, status, depth },
      statistics: { ...base.statistics, deepestDepth },
      settings: { ...base.settings, jukebox: { enabled: true, trackId } },
    };
  }

  it("holds the chosen track through every expedition status", () => {
    // Table-driven over the whole union rather than the three interesting ones,
    // so the compiler points here when a status is added.
    const statuses: ExpeditionStatus[] = [
      "surface",
      "launching",
      "approaching",
      "resolving",
      "choice",
      "decision",
      "extracting",
      "failed",
    ];

    for (const status of statuses) {
      expect(selectMusicTrackId(withJukebox("music.band.dark", UNLOCK, status, 4)), status).toBe(
        "music.band.dark",
      );
    }
  });

  it("holds the track across a band boundary the scene would have crossed", () => {
    // Descending past 25 normally swaps the Shelf for Deep Seams, and with the
    // jukebox on it must not.
    for (const depth of [0, 24, 25, 99, 100, 5_000]) {
      expect(
        selectMusicTrackId(withJukebox("music.casino", UNLOCK, "approaching", depth)),
        `depth ${String(depth)}`,
      ).toBe("music.casino");
    }
  });

  it("is ignored one depth short of the unlock", () => {
    // The guard against an edited or imported save, and the test that fails if
    // the unlock check moves out of the selector into the window.
    const state = withJukebox("music.band.core", UNLOCK - 1, "approaching", 30);

    expect(selectMusicTrackId(state)).toBe("music.band.seams");
  });

  it("takes effect exactly at the unlock depth", () => {
    expect(selectMusicTrackId(withJukebox("music.band.core", UNLOCK, "approaching", 30))).toBe(
      "music.band.core",
    );
  });

  it("follows the scene while it is switched off, keeping the chosen track", () => {
    const base = withJukebox("music.band.core", UNLOCK, "approaching", 30);
    const off: GameState = {
      ...base,
      settings: { ...base.settings, jukebox: { ...base.settings.jukebox, enabled: false } },
    };

    expect(selectMusicTrackId(off)).toBe("music.band.seams");
    // The track is remembered, so switching back does not land on the default.
    expect(off.settings.jukebox.trackId).toBe("music.band.core");
  });

  it("refuses to switch on below the unlock, and repairs an unknown track", () => {
    const short = createGameState({ nowUnixMs: NOW, seed: 6 });
    const rejected = reduce(short, {
      type: "UPDATE_SETTINGS",
      patch: { jukebox: { enabled: true, trackId: "music.band.dark" } },
    }).state;

    expect(rejected.settings.jukebox.enabled).toBe(false);

    const earned: GameState = {
      ...short,
      statistics: { ...short.statistics, deepestDepth: UNLOCK },
    };
    const repaired = reduce(earned, {
      type: "UPDATE_SETTINGS",
      // A track from a build that no longer ships it.
      patch: { jukebox: { enabled: true, trackId: "music.band.retired" as MusicTrackId } },
    }).state;

    expect(repaired.settings.jukebox.enabled).toBe(true);
    expect(repaired.settings.jukebox.trackId).toBe("music.casino");
  });

  it("announces the unlock once, on the descent that crosses it", () => {
    // Driven through a real `CONTINUE_EXPEDITION` rather than by writing the
    // statistic, because which command moves it is the point: `deepestDepth`
    // advances on the press-on and on auto-continue, never on a plain tick.
    const base = createGameState({ nowUnixMs: NOW, seed: 7 });
    const atTheEdge: GameState = {
      ...base,
      expedition: {
        ...base.expedition,
        status: "decision",
        depth: UNLOCK - 1,
        oxygen: 500,
        maxOxygenSnapshot: 500,
      },
      statistics: { ...base.statistics, deepestDepth: UNLOCK - 1 },
    };

    const notices = (result: ReturnType<typeof reduce>): number =>
      result.effects.filter(
        (effect) => effect.type === "SHOW_FEEDBACK" && effect.message === JUKEBOX_UNLOCK_NOTICE,
      ).length;

    const crossed = reduce(atTheEdge, { type: "CONTINUE_EXPEDITION" });

    expect(crossed.state.statistics.deepestDepth).toBe(UNLOCK);
    expect(notices(crossed)).toBe(1);
  });

  it("says it once and never again", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 8 });
    const past: GameState = {
      ...base,
      expedition: {
        ...base.expedition,
        status: "decision",
        depth: UNLOCK + 4,
        oxygen: 500,
        maxOxygenSnapshot: 500,
      },
      statistics: { ...base.statistics, deepestDepth: UNLOCK + 4 },
    };

    const again = reduce(past, { type: "CONTINUE_EXPEDITION" });

    expect(again.state.statistics.deepestDepth).toBe(UNLOCK + 5);
    expect(
      again.effects.filter(
        (effect) => effect.type === "SHOW_FEEDBACK" && effect.message === JUKEBOX_UNLOCK_NOTICE,
      ),
    ).toHaveLength(0);
  });

  it("stays quiet on a descent that does not reach the gate", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 9 });
    const shallow: GameState = {
      ...base,
      expedition: {
        ...base.expedition,
        status: "decision",
        depth: 10,
        oxygen: 500,
        maxOxygenSnapshot: 500,
      },
      statistics: { ...base.statistics, deepestDepth: 10 },
    };

    expect(
      reduce(shallow, { type: "CONTINUE_EXPEDITION" }).effects.filter(
        (effect) => effect.type === "SHOW_FEEDBACK" && effect.message === JUKEBOX_UNLOCK_NOTICE,
      ),
    ).toHaveLength(0);
  });
});

/**
 * The sequencer itself. Everything goes through the fake context and manual
 * timer above, so a test decides when the scheduler wakes and reads back every
 * note and gain ramp: does it schedule the right notes for the window, does a
 * track change fade rather than cut, does silencing it stop the clock.
 */
describe("the music engine", () => {
  it("schedules a lookahead window and no further", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    expect(context.notes.length).toBeGreaterThan(0);

    // The horizon is what makes this a scheduler rather than a render: nothing
    // may be queued past it, or a track change would have to cancel notes
    // already committed to the hardware clock.
    for (const note of context.notes) {
      expect(note.startAt).toBeLessThan(0.1);
    }
  });

  it("plays the track's own pitches, one voice at a time", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    // The casino's root is 220Hz and its three voices sit an octave apart, each
    // opening on the root — so the first window is 110, 440 and 880, which
    // checks the octave and semitone maths in one assertion.
    const opening = context.notes.map((note) => Math.round(note.frequency));

    expect(opening).toContain(110);
    expect(opening).toContain(440);
    expect(opening).toContain(880);
  });

  it("releases a note before the next one starts, so a repeat is two notes", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    // Without the early release a repeated pitch is one long drone: the gap is
    // what the ear hears as articulation.
    for (const note of context.notes) {
      expect(note.endsAt).toBeGreaterThan(note.startAt);
    }
  });

  it("schedules nothing into a suspended context, and opens when it is unlocked", () => {
    const context = createFakeContext(true);
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    // The failure this guards is silent: a suspended context accepts everything
    // and advances no clock, so the voices march on against a stopped time and
    // the first audible note lands somewhere in the middle of the track.
    expect(context.notes).toHaveLength(0);
    expect(engine.isScheduling()).toBe(false);

    context.unlock();
    // What the app does every frame, and how the engine learns that an obstacle
    // it never saw has gone away.
    engine.setSettings(LOUD);

    expect(context.notes.length).toBeGreaterThan(0);
  });

  it("remembers a track set while it could not play, rather than dropping it", () => {
    const context = createFakeContext(true);
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.band.dark");

    expect(engine.currentTrackId()).toBe("music.band.dark");

    context.unlock();
    engine.setSettings(LOUD);

    // 130.81Hz root, one octave down on the bass voice.
    expect(context.notes.map((note) => Math.round(note.frequency))).toContain(65);
  });

  it("crossfades between tracks rather than cutting", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    expect(context.deckGains).toHaveLength(1);

    engine.setTrack("music.band.shelf");

    // Two decks, because both are sounding: a cut would replace one in place.
    expect(context.deckGains).toHaveLength(2);

    const [outgoing, incoming] = context.deckGains;
    const lastOf = (ramps: GainRamp[]) => ramps[ramps.length - 1];

    expect(lastOf(outgoing).value).toBeLessThan(0.01);
    expect(lastOf(outgoing).atTime).toBeCloseTo(1.5, 3);
    // Music sits at half gain under the cues, so full volume is 0.5 here.
    expect(lastOf(incoming).value).toBeCloseTo(0.5, 3);
    expect(lastOf(incoming).atTime).toBeCloseTo(1.5, 3);
  });

  it("drops a faded-out deck instead of scheduling silence forever", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");
    engine.setTrack("music.band.shelf");

    // Past the crossfade, so the outgoing deck has finished retiring.
    context.advance(2);
    timer.fire();
    context.notes.length = 0;
    context.advance(1);
    timer.fire();

    // The two tracks are rooted differently, so every frequency identifies the
    // deck that produced it: nothing from the casino may still be queued once
    // its deck is gone.
    const casinoPitches = context.notes.filter(
      (note) => Math.round(note.frequency) === 110 || Math.round(note.frequency) === 440,
    );

    expect(casinoPitches).toHaveLength(0);
    expect(context.notes.length).toBeGreaterThan(0);
  });

  it("stops on a null track and stops waking up afterwards", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    expect(engine.isScheduling()).toBe(true);

    engine.setTrack(null);
    // Past the fade, so the last deck retires and there is nothing left to feed.
    context.advance(2);
    timer.fire();

    expect(engine.isScheduling()).toBe(false);
    expect(engine.currentTrackId()).toBeNull();
  });

  it("tears the decks down when silenced rather than playing at zero", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    expect(engine.isScheduling()).toBe(true);

    engine.setSettings({ ...LOUD, muted: true });

    // Silent scheduling would still build oscillators every 25ms for the rest of
    // the session, for something nobody can hear.
    expect(engine.isScheduling()).toBe(false);

    context.notes.length = 0;
    timer.fire();

    expect(context.notes).toHaveLength(0);
  });

  it("comes back after being silenced", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");
    engine.setSettings({ ...LOUD, muted: true });
    engine.setSettings(LOUD);

    expect(engine.isScheduling()).toBe(true);
    expect(engine.currentTrackId()).toBe("music.casino");
  });

  it("moves a live deck's level without restarting it", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");

    const decksBefore = context.deckGains.length;

    engine.setSettings({ ...LOUD, musicVolume: 0.5 });

    // A volume change is a ramp on the deck already playing; a second deck would
    // restart the track from its first bar.
    expect(context.deckGains).toHaveLength(decksBefore);

    const ramps = context.deckGains[0];

    expect(ramps[ramps.length - 1].value).toBeCloseTo(0.25, 3);
  });

  it("ignores a track it is already playing", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");
    engine.setTrack("music.casino");

    // The app pushes this every frame, so a repeat has to be free: a second deck
    // would be a crossfade from a track to itself.
    expect(context.deckGains).toHaveLength(1);
  });

  it("pauses without forgetting what was playing", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");
    engine.pause();

    expect(engine.isScheduling()).toBe(false);
    expect(engine.currentTrackId()).toBe("music.casino");

    engine.resume();

    expect(engine.isScheduling()).toBe(true);
  });

  it("moves a stale cursor up instead of catching it up", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");
    context.notes.length = 0;

    // A minute passed with the tab hidden and the scheduler asleep.
    context.advance(60);
    timer.fire();

    // Playing the missed minute at once would be thousands of oscillators in one
    // call. The cursor jumps to now, so the catch-up is one window's worth.
    expect(context.notes.length).toBeLessThan(20);

    for (const note of context.notes) {
      expect(note.startAt).toBeGreaterThanOrEqual(60);
    }
  });

  it("goes quiet and stays quiet once disposed", () => {
    const context = createFakeContext();
    const timer = createFakeTimer();
    const engine = engineOn(context, timer);

    engine.setSettings(LOUD);
    engine.setTrack("music.casino");
    engine.dispose();

    expect(engine.isScheduling()).toBe(false);

    context.notes.length = 0;
    engine.setTrack("music.band.dark");
    timer.fire();

    expect(context.notes).toHaveLength(0);
  });
});
