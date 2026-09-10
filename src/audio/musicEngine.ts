/**
 * The music sequencer. Separate from `AudioManager` — a cue is one oscillator
 * fired and forgotten, music is a clock that has to stay in time — though the
 * two share an audio context.
 *
 * Scheduling is lookahead rather than a timer per note: a slow timer wakes every
 * `scheduleIntervalMs` and queues every note starting within `lookaheadMs`
 * against `context.currentTime`, a hardware clock. The timer decides what to
 * schedule, never when a note sounds, so main-thread jitter is inaudible.
 *
 * The context and timer are injectable so the engine can be tested under Node.
 */

import { MUSIC_TRACKS, type MusicTrack, type MusicTrackId } from "../content/music";
import type { SettingsState } from "../domain/state";

/**
 * The part of `AudioContext` this needs. Structural, so a test can pass a fake
 * without Web Audio, which Node does not provide.
 */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNode;
  /**
   * "suspended" until a user gesture unlocks it. Optional because a fake has no
   * autoplay policy to model, and a missing state is treated as running.
   */
  readonly state?: string;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

export interface MusicEngineOptions {
  /** Returns the shared context, or null when audio is unavailable. */
  getContext: () => AudioContextLike | null;
  scheduleIntervalMs?: number;
  lookaheadMs?: number;
  crossfadeMs?: number;
  setTimer?: (callback: () => void, intervalMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface MusicEngine {
  /** Switches to a track, crossfading from whatever is playing. Null stops. */
  setTrack(trackId: MusicTrackId | null): void;
  /** Volume and mute. Muting tears the decks down rather than playing silence. */
  setSettings(settings: SettingsState): void;
  /** The document went away. Stops scheduling without forgetting the track. */
  pause(): void;
  resume(): void;
  /** What is playing, for tests and diagnostics. */
  currentTrackId(): MusicTrackId | null;
  isScheduling(): boolean;
  dispose(): void;
}

const DEFAULT_SCHEDULE_INTERVAL_MS = 25;
const DEFAULT_LOOKAHEAD_MS = 100;
const DEFAULT_CROSSFADE_MS = 1_500;

/** Headroom under the cues, so continuous music cannot bury the event sounds. */
const MUSIC_HEADROOM = 0.5;

/** A note's envelope, as fractions of its own length. */
const ATTACK_SECONDS = 0.008;
const RELEASE_FRACTION = 0.85;

/**
 * One track being played. Two exist during a crossfade, which is the whole
 * reason a deck is a thing rather than fields on the engine.
 */
interface Deck {
  track: MusicTrack;
  gain: GainNode;
  /** Next note start per voice, in context seconds. */
  cursors: number[];
  /** Next note index per voice. */
  indices: number[];
  /** Context time this deck finishes fading out, or null while it is the live one. */
  retiresAt: number | null;
}

function secondsPerSixteenth(track: MusicTrack): number {
  return 60 / track.bpm / 4;
}

function frequencyOf(track: MusicTrack, octave: number, semitones: number): number {
  return track.rootHz * 2 ** octave * 2 ** (semitones / 12);
}

export function createMusicEngine(options: MusicEngineOptions): MusicEngine {
  const scheduleIntervalMs = options.scheduleIntervalMs ?? DEFAULT_SCHEDULE_INTERVAL_MS;
  const lookaheadSeconds = (options.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS) / 1000;
  const crossfadeSeconds = (options.crossfadeMs ?? DEFAULT_CROSSFADE_MS) / 1000;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, intervalMs: number) => setInterval(callback, intervalMs));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => {
      clearInterval(handle as ReturnType<typeof setInterval>);
    });

  let decks: Deck[] = [];
  let timer: unknown = null;
  let paused = false;
  let disposed = false;
  let volume = 0;
  let wantedTrackId: MusicTrackId | null = null;

  const audible = (): boolean => volume > 0 && !paused && !disposed;

  /**
   * Whether the context can actually sound. A context exists as soon as anything
   * asks for one but stays suspended until a user gesture, and scheduling into a
   * suspended context silently burns notes: `currentTime` does not advance, so
   * the voice indices march on with nothing heard.
   */
  const ready = (): AudioContextLike | null => {
    const context = options.getContext();

    if (context === null || (context.state !== undefined && context.state !== "running")) {
      return null;
    }

    return context;
  };

  const liveDeck = (): Deck | null => decks.find((deck) => deck.retiresAt === null) ?? null;

  const stopTimer = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const tearDown = (): void => {
    for (const deck of decks) {
      try {
        deck.gain.disconnect();
      } catch {
        // A context that is already closed throws here; there is nothing to undo.
      }
    }

    decks = [];
    stopTimer();
  };

  /** Queues one note and returns when the next one on this voice begins. */
  const scheduleNote = (
    context: AudioContextLike,
    deck: Deck,
    voiceIndex: number,
    startAt: number,
  ): number => {
    const track = deck.track;
    const trackVoice = track.voices[voiceIndex];
    const note = trackVoice.notes[deck.indices[voiceIndex]];
    const lengthSeconds = note.duration * secondsPerSixteenth(track);

    if (note.pitch !== null) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      // Released before the next note starts, so repeated notes at one pitch
      // read as separate notes rather than a drone.
      const endsAt = startAt + lengthSeconds * RELEASE_FRACTION;

      oscillator.type = trackVoice.waveform;
      oscillator.frequency.setValueAtTime(
        frequencyOf(track, trackVoice.octave, note.pitch),
        startAt,
      );

      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.exponentialRampToValueAtTime(
        trackVoice.gain,
        startAt + Math.min(ATTACK_SECONDS, lengthSeconds / 4),
      );
      envelope.gain.exponentialRampToValueAtTime(0.0001, endsAt);

      oscillator.connect(envelope);
      envelope.connect(deck.gain);
      oscillator.start(startAt);
      oscillator.stop(endsAt);
    }

    deck.indices[voiceIndex] = (deck.indices[voiceIndex] + 1) % trackVoice.notes.length;

    return startAt + lengthSeconds;
  };

  const tick = (): void => {
    const context = ready();

    if (context === null || !audible()) {
      return;
    }

    const now = context.currentTime;
    const horizon = now + lookaheadSeconds;

    for (const deck of decks) {
      for (let voiceIndex = 0; voiceIndex < deck.track.voices.length; voiceIndex += 1) {
        // A cursor left behind by a hidden tab or a stall is moved up, not
        // caught up: replaying the gap at once would be thousands of oscillators.
        if (deck.cursors[voiceIndex] < now) {
          deck.cursors[voiceIndex] = now;
        }

        while (deck.cursors[voiceIndex] < horizon) {
          deck.cursors[voiceIndex] = scheduleNote(
            context,
            deck,
            voiceIndex,
            deck.cursors[voiceIndex],
          );
        }
      }
    }

    // A deck that has finished fading out is dropped, not left scheduling silence.
    const retired = decks.filter((deck) => deck.retiresAt !== null && deck.retiresAt <= now);

    if (retired.length > 0) {
      for (const deck of retired) {
        try {
          deck.gain.disconnect();
        } catch {
          // Already gone with the context.
        }
      }

      decks = decks.filter((deck) => !retired.includes(deck));
    }

    // Nothing left to feed, so the timer stops rather than waking forever on an
    // empty list. `ensurePlaying` starts it again once there is a track.
    if (decks.length === 0) {
      stopTimer();
    }
  };

  /**
   * Brings what is playing into line with what should be playing. Called from
   * every entry point and on every frame, because volume, pause and the unlock
   * state all change from elsewhere without announcing it. Cheap when there is
   * nothing to do.
   */
  const ensurePlaying = (): void => {
    const context = ready();

    if (context === null || !audible()) {
      return;
    }

    const live = liveDeck();

    if (wantedTrackId === null) {
      if (live !== null) {
        swapTo(context, null);
      }

      return;
    }

    if (live?.track.id === wantedTrackId) {
      return;
    }

    swapTo(context, MUSIC_TRACKS[wantedTrackId]);
    startTimer();
  };

  const startTimer = (): void => {
    if (timer === null && audible() && ready() !== null && decks.length > 0) {
      timer = setTimer(tick, scheduleIntervalMs);
      // Queued immediately as well as on the interval, so the first note is not
      // held back by a whole scheduling period.
      tick();
    }
  };

  /** Fades every live deck out, and opens a new one for `track` if given. */
  const swapTo = (context: AudioContextLike, track: MusicTrack | null): void => {
    const now = context.currentTime;

    for (const deck of decks) {
      if (deck.retiresAt === null) {
        deck.gain.gain.cancelScheduledValues(now);
        deck.gain.gain.setValueAtTime(deck.gain.gain.value, now);
        deck.gain.gain.linearRampToValueAtTime(0.0001, now + crossfadeSeconds);
        deck.retiresAt = now + crossfadeSeconds;
      }
    }

    if (track === null) {
      return;
    }

    const gain = context.createGain();

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume * MUSIC_HEADROOM, now + crossfadeSeconds);
    gain.connect(context.destination);

    decks.push({
      track,
      gain,
      cursors: track.voices.map(() => now),
      indices: track.voices.map(() => 0),
      retiresAt: null,
    });
  };

  return {
    setTrack(trackId) {
      if (disposed || trackId === wantedTrackId) {
        return;
      }

      // Recorded first, played second. Muted, paused, or not yet unlocked, the
      // track is remembered and opens when the obstacle goes away.
      wantedTrackId = trackId;
      ensurePlaying();
    },

    setSettings(settings) {
      if (disposed) {
        return;
      }

      const next = settings.muted ? 0 : settings.masterVolume * settings.musicVolume;
      const wasAudible = audible();

      volume = next;

      if (!audible()) {
        // Muting tears the decks down rather than scheduling at zero gain, which
        // would keep creating oscillators nobody can hear.
        tearDown();

        return;
      }

      if (!wasAudible || liveDeck() === null) {
        ensurePlaying();

        return;
      }

      // Already playing: move the live deck's level without restarting anything.
      const context = ready();

      if (context !== null) {
        const live = liveDeck();

        live?.gain.gain.cancelScheduledValues(context.currentTime);
        live?.gain.gain.linearRampToValueAtTime(
          volume * MUSIC_HEADROOM,
          context.currentTime + 0.05,
        );
      }
    },

    pause() {
      if (disposed || paused) {
        return;
      }

      paused = true;
      tearDown();
    },

    resume() {
      if (disposed || !paused) {
        return;
      }

      paused = false;
      ensurePlaying();
    },

    currentTrackId() {
      return wantedTrackId;
    },

    isScheduling() {
      return timer !== null;
    },

    dispose() {
      disposed = true;
      tearDown();
    },
  };
}
