/**
 * Web Audio adapter. Every sound goes through here so settings apply in one
 * place. The context is unlocked on the first user gesture, and audio failures
 * are swallowed: nothing in the game may depend on sound to be understandable.
 */

import type { SoundId } from "../domain/commands";
import type { SettingsState } from "../domain/state";
import { SOUND_CATALOG, pitchVarianceOf } from "./soundCatalog";

export interface AudioManager {
  play(soundId: SoundId, settings: SettingsState): void;
  /** Called from the first user gesture to satisfy autoplay policies. */
  unlock(): void;
  /**
   * The shared context, created on demand, or null when audio is unavailable.
   * Exposed for the music engine, which needs the same context and clock rather
   * than one of its own.
   */
  context(): AudioContext | null;
  dispose(): void;
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContext(): AudioContextConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;

  return candidate ?? null;
}

export function createAudioManager(): AudioManager {
  const Constructor = resolveAudioContext();
  const lastPlayedAt = new Map<SoundId, number>();

  let context: AudioContext | null = null;
  let failed = Constructor === null;

  const ensureContext = (): AudioContext | null => {
    if (failed) {
      return null;
    }

    if (context === null && Constructor !== null) {
      try {
        context = new Constructor();
      } catch {
        failed = true;

        return null;
      }
    }

    return context;
  };

  return {
    play(soundId, settings) {
      if (failed || settings.muted) {
        return;
      }

      const definition = SOUND_CATALOG[soundId];

      if (definition === undefined) {
        return;
      }

      const channelVolume =
        definition.channel === "music" ? settings.musicVolume : settings.sfxVolume;
      // The machine cue is a sub-mix of the effects channel, not a switch on it;
      // the `volume <= 0` guard below covers a slider dragged to zero.
      const sourceVolume = definition.source === "machine" ? settings.machineVolume : 1;
      const volume =
        definition.gain * settings.masterVolume * channelVolume * sourceVolume;

      if (volume <= 0) {
        return;
      }

      const audio = ensureContext();

      if (audio === null || audio.state === "closed") {
        return;
      }

      const now = audio.currentTime * 1000;
      const previous = lastPlayedAt.get(soundId);

      if (previous !== undefined && now - previous < definition.minimumSpacingMs) {
        return;
      }

      lastPlayedAt.set(soundId, now);

      try {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const startedAt = audio.currentTime;
        const endsAt = startedAt + definition.durationMs / 1000;

        /*
         * A little pitch wander per playback, so a repeated cue sounds like a
         * thing happening again rather than a sample being retriggered.
         *
         * `Math.random` is deliberate: sound is presentation and must never draw
         * from the seeded run streams, or audio settings would change outcomes.
         * Applied to both ends so a two-note cue keeps its shape.
         */
        const variance = pitchVarianceOf(definition);
        const detune = 1 + (Math.random() - 0.5) * 2 * variance;

        oscillator.type = definition.waveform;
        oscillator.frequency.setValueAtTime(definition.frequency * detune, startedAt);
        oscillator.frequency.linearRampToValueAtTime(definition.endFrequency * detune, endsAt);

        gain.gain.setValueAtTime(volume, startedAt);
        gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);

        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(startedAt);
        oscillator.stop(endsAt);
      } catch {
        // Audio is decorative; a failure must never interrupt play.
        failed = true;
      }
    },

    context() {
      const audio = ensureContext();

      return audio !== null && audio.state !== "closed" ? audio : null;
    },

    unlock() {
      const audio = ensureContext();

      if (audio !== null && audio.state === "suspended") {
        void audio.resume().catch(() => {
          failed = true;
        });
      }
    },

    dispose() {
      void context?.close().catch(() => undefined);
      context = null;
    },
  };
}
