/**
 * Sound definitions. No external audio assets ship, so each cue is a short
 * synthesized tone; swapping in real samples only changes this catalog.
 */

import { MACHINES } from "../content/machines";
import type { MachineId } from "../content/machines";
import type { MachineSoundId, SoundId } from "../domain/commands";

export type SoundChannel = "sfx" | "music";

/**
 * Where a cue comes from. Only the machine source is separately mutable today;
 * this is the extension point if per-source mixing is wanted later.
 */
export type SoundSource = "machine" | "expedition" | "gambling" | "ui";

export interface SoundDefinition {
  id: SoundId;
  channel: SoundChannel;
  /** Base frequency in hertz. */
  frequency: number;
  /** Second frequency for a two-note cue; equal to `frequency` for one note. */
  endFrequency: number;
  durationMs: number;
  gain: number;
  waveform: OscillatorType;
  /** Cues below this spacing are dropped so rapid ticks do not stack. */
  minimumSpacingMs: number;
  /**
   * How far the pitch may wander per playback, as a fraction of the cue's own
   * frequencies. Omitted means `DEFAULT_PITCH_VARIANCE`.
   */
  pitchVariance?: number;
  source: SoundSource;
}

/**
 * About three quarters of a semitone either way: enough that a repeated cue does
 * not sound like a stuck key, and under the 5.95% that would change the note, so
 * a cue keeps the identity players recognise it by.
 */
export const DEFAULT_PITCH_VARIANCE = 0.045;

export function pitchVarianceOf(definition: SoundDefinition): number {
  return definition.pitchVariance ?? DEFAULT_PITCH_VARIANCE;
}

/**
 * A payout cue per machine, generated from the cue each one declares in content,
 * so a new machine is never silent. Spacing scales with the cue's own length: a
 * long, low cue cannot retrigger over itself while short ones stay responsive.
 */
const MACHINE_CUES = (Object.keys(MACHINES) as MachineId[]).reduce(
  (cues, machineId) => {
    const cue = MACHINES[machineId].payoutCue;
    const id: MachineSoundId = `sound.payout.${machineId}`;

    cues[id] = {
      id,
      channel: "sfx",
      frequency: cue.frequency,
      endFrequency: cue.endFrequency,
      durationMs: cue.durationMs,
      gain: cue.gain,
      waveform: "square",
      minimumSpacingMs: Math.max(160, cue.durationMs * 2),
      // Wider than the default: ten machines each firing every 160ms is where
      // audio fatigue comes from.
      pitchVariance: 0.05,
      source: "machine",
    };

    return cues;
  },
  {} as Record<MachineSoundId, SoundDefinition>,
);

export const SOUND_CATALOG: Record<SoundId, SoundDefinition> = {
  ...MACHINE_CUES,
  "sound.pickaxe.impact": {
    id: "sound.pickaxe.impact",
    channel: "sfx",
    frequency: 180,
    endFrequency: 120,
    durationMs: 60,
    gain: 0.16,
    waveform: "triangle",
    minimumSpacingMs: 260,
    // The most repeated cue in the game, so it gets twice the wander.
    pitchVariance: 0.06,
    source: "expedition",
  },
  // The impact, but bright and rising where the plain strike is dull and
  // falling, and spaced tighter so it sounds over a strike moments earlier.
  "sound.pickaxe.critical": {
    id: "sound.pickaxe.critical",
    channel: "sfx",
    frequency: 300,
    endFrequency: 660,
    durationMs: 90,
    gain: 0.18,
    waveform: "square",
    minimumSpacingMs: 120,
    source: "expedition",
  },
  "sound.reward.pickup": {
    id: "sound.reward.pickup",
    channel: "sfx",
    frequency: 520,
    endFrequency: 1_040,
    durationMs: 140,
    gain: 0.18,
    waveform: "square",
    minimumSpacingMs: 120,
    source: "expedition",
  },
  // A cache latch. Fired once per batch rather than per cache, so it can afford
  // to be long and widely spaced.
  "sound.cache.open": {
    id: "sound.cache.open",
    channel: "sfx",
    frequency: 220,
    endFrequency: 880,
    durationMs: 200,
    gain: 0.19,
    waveform: "triangle",
    minimumSpacingMs: 150,
    source: "ui",
  },
  // Banking ends a run, so it falls heavily where the pickup is short and rising.
  "sound.expedition.bank": {
    id: "sound.expedition.bank",
    channel: "sfx",
    frequency: 420,
    endFrequency: 210,
    durationMs: 340,
    gain: 0.2,
    waveform: "triangle",
    minimumSpacingMs: 300,
    source: "expedition",
  },
  /*
   * The cat jingle, for the rarest event in the game: a clean octave on a sine
   * no other expedition cue uses, and the longest cue in the catalogue, so it
   * fills part of the pause the run takes at the same moment.
   */
  "sound.cat.meet": {
    id: "sound.cat.meet",
    channel: "sfx",
    frequency: 587.33,
    endFrequency: 1_174.66,
    durationMs: 420,
    gain: 0.2,
    waveform: "sine",
    minimumSpacingMs: 400,
    source: "expedition",
  },
  "sound.expedition.failed": {
    id: "sound.expedition.failed",
    channel: "sfx",
    frequency: 320,
    endFrequency: 90,
    durationMs: 420,
    gain: 0.2,
    waveform: "sawtooth",
    minimumSpacingMs: 400,
    source: "expedition",
  },
  /*
   * The four games, one pair of cues each, distinguished on two axes. Timbre
   * says which game: slots square, roulette triangle, blackjack sawtooth, the
   * depth wager sine. Direction says what happened: a start cue is short and
   * level or falling, a win longer and rising.
   */
  "sound.slots.spin": {
    id: "sound.slots.spin",
    channel: "sfx",
    frequency: 240,
    endFrequency: 420,
    durationMs: 180,
    gain: 0.14,
    waveform: "square",
    minimumSpacingMs: 120,
    source: "gambling",
  },
  "sound.slots.win": {
    id: "sound.slots.win",
    channel: "sfx",
    frequency: 620,
    endFrequency: 1_240,
    durationMs: 260,
    gain: 0.2,
    waveform: "square",
    minimumSpacingMs: 120,
    source: "gambling",
  },
  /* Falling, because a wheel arrives by slowing down. */
  "sound.roulette.spin": {
    id: "sound.roulette.spin",
    channel: "sfx",
    frequency: 340,
    endFrequency: 190,
    durationMs: 300,
    gain: 0.14,
    waveform: "triangle",
    minimumSpacingMs: 200,
    source: "gambling",
  },
  // Longer than its own spin, which is already the longest start in the game.
  "sound.roulette.win": {
    id: "sound.roulette.win",
    channel: "sfx",
    frequency: 500,
    endFrequency: 1_000,
    durationMs: 360,
    gain: 0.2,
    waveform: "triangle",
    minimumSpacingMs: 200,
    source: "gambling",
  },
  /* Short and dry: a card leaving the shoe, not a machine starting up. */
  "sound.blackjack.deal": {
    id: "sound.blackjack.deal",
    channel: "sfx",
    frequency: 380,
    endFrequency: 300,
    durationMs: 90,
    gain: 0.13,
    waveform: "sawtooth",
    minimumSpacingMs: 70,
    source: "gambling",
  },
  "sound.blackjack.win": {
    id: "sound.blackjack.win",
    channel: "sfx",
    frequency: 560,
    endFrequency: 1_120,
    durationMs: 220,
    gain: 0.2,
    waveform: "sawtooth",
    minimumSpacingMs: 120,
    source: "gambling",
  },
  // A sine, used by no table: the wager is placed in the casino but settles on
  // an expedition, so it should sound like neither.
  "sound.wager.place": {
    id: "sound.wager.place",
    channel: "sfx",
    frequency: 330,
    endFrequency: 460,
    durationMs: 110,
    gain: 0.12,
    waveform: "sine",
    minimumSpacingMs: 100,
    source: "gambling",
  },
  "sound.wager.win": {
    id: "sound.wager.win",
    channel: "sfx",
    frequency: 700,
    endFrequency: 1_400,
    durationMs: 320,
    gain: 0.2,
    waveform: "sine",
    minimumSpacingMs: 200,
    source: "gambling",
  },
  // Spending resources on anything — a machine level, gear, a key, a cache, a
  // perk — is one act and makes one noise, distinct from interface controls.
  "sound.purchase": {
    id: "sound.purchase",
    channel: "sfx",
    frequency: 660,
    endFrequency: 990,
    durationMs: 80,
    gain: 0.13,
    waveform: "triangle",
    minimumSpacingMs: 70,
    source: "ui",
  },
  /* A short click-in. Equipping costs nothing, so it must not sound like buying. */
  "sound.gear.equip": {
    id: "sound.gear.equip",
    channel: "sfx",
    frequency: 520,
    endFrequency: 700,
    durationMs: 70,
    gain: 0.11,
    waveform: "sine",
    minimumSpacingMs: 60,
    source: "ui",
  },
  // Upgrading a trinket or totem a tier: a workbench action, so it must not
  // borrow an expedition cue.
  "sound.gear.upgrade": {
    id: "sound.gear.upgrade",
    channel: "sfx",
    frequency: 440,
    endFrequency: 880,
    durationMs: 180,
    gain: 0.17,
    waveform: "triangle",
    minimumSpacingMs: 150,
    source: "ui",
  },
  "sound.control.confirm": {
    id: "sound.control.confirm",
    channel: "sfx",
    frequency: 440,
    endFrequency: 560,
    durationMs: 60,
    gain: 0.1,
    waveform: "square",
    minimumSpacingMs: 60,
    source: "ui",
  },
  "sound.control.reject": {
    id: "sound.control.reject",
    channel: "sfx",
    frequency: 200,
    endFrequency: 150,
    durationMs: 90,
    gain: 0.12,
    waveform: "sawtooth",
    minimumSpacingMs: 120,
    source: "ui",
  },
  "sound.prestige": {
    id: "sound.prestige",
    channel: "sfx",
    frequency: 300,
    endFrequency: 1_500,
    durationMs: 700,
    gain: 0.22,
    waveform: "triangle",
    minimumSpacingMs: 500,
    source: "ui",
  },
};
