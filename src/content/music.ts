/**
 * Music tracks, as note data: one for the casino and one per depth band.
 * Procedural chiptune rather than audio files, so a track is diffable and
 * tunable like any other content. `audio/musicEngine.ts` decides how to make the
 * noise; this decides what it is.
 *
 * The ladder descends: tempo and root pitch both fall as the bands get deeper,
 * so the music says how far down you are before the header does. Asserted in
 * `music.test.ts`.
 *
 * Voices loop independently at different lengths, so the effective loop is their
 * least common multiple and twenty-odd bars of music fit in a screenful of data.
 * The lengths are chosen so the harmonic voices realign quickly and only the
 * texture phases.
 */

import { DEPTH_BAND_IDS, type DepthBandId } from "./depthBands";

export type MusicTrackId = "music.casino" | `music.${DepthBandId}`;

export interface TrackNote {
  /** Semitones from the track's root, or null for a rest. */
  pitch: number | null;
  /** In sixteenths. */
  duration: number;
}

export interface TrackVoice {
  waveform: OscillatorType;
  gain: number;
  /** Octaves from the track's root. */
  octave: number;
  notes: TrackNote[];
}

export interface MusicTrack {
  id: MusicTrackId;
  displayName: string;
  bpm: number;
  rootHz: number;
  voices: TrackVoice[];
}

/**
 * `[semitones, sixteenths]`, with a null pitch for a rest. A voice is dozens of
 * these, and the pairs stay legible in a row where objects would not.
 */
type NoteSpec = readonly [number | null, number];

function voice(
  waveform: OscillatorType,
  gain: number,
  octave: number,
  specs: readonly NoteSpec[],
): TrackVoice {
  return {
    waveform,
    gain,
    octave,
    notes: specs.map(([pitch, duration]) => ({ pitch, duration })),
  };
}

/** A steady run of equal-length notes, for arpeggios and pulses. */
function run(pitches: readonly (number | null)[], duration: number): NoteSpec[] {
  return pitches.map((pitch) => [pitch, duration] as NoteSpec);
}

export const MUSIC_TRACK_IDS: MusicTrackId[] = [
  "music.casino",
  ...DEPTH_BAND_IDS.map((bandId): MusicTrackId => `music.${bandId}`),
];

/**
 * Whether a value names a track this build ships. The jukebox stores a track id
 * in the save, so a renamed track would leave it asking for music that no longer
 * exists. Checked against the id list so it cannot drift from it.
 */
export function isMusicTrackId(value: unknown): value is MusicTrackId {
  return typeof value === "string" && (MUSIC_TRACK_IDS as string[]).includes(value);
}

export const MUSIC_TRACKS: Record<MusicTrackId, MusicTrack> = {
  // The casino: brightest and fastest of the six, major throughout, with the
  // only walking bass. Nothing is running out up here.
  "music.casino": {
    id: "music.casino",
    displayName: "The floor",
    bpm: 128,
    rootHz: 220,
    voices: [
      // Lead, eight bars: a four-bar phrase and its answer, so the tune has a
      // shape rather than a single repeating hook.
      voice("square", 0.05, 1, [
        [0, 2], [4, 2], [7, 2], [4, 2], [12, 4], [9, 4],
        [7, 2], [9, 2], [11, 2], [9, 2], [7, 4], [null, 4],
        [5, 2], [9, 2], [12, 2], [9, 2], [14, 4], [12, 4],
        [7, 4], [4, 4], [0, 4], [null, 4],
        [0, 2], [4, 2], [7, 2], [12, 2], [16, 4], [14, 4],
        [12, 2], [11, 2], [9, 2], [7, 2], [9, 4], [null, 4],
        [5, 2], [7, 2], [9, 2], [11, 2], [12, 8],
        [7, 4], [5, 4], [0, 8],
      ]),
      // Bass, four bars: I - vi - IV - V, the oldest progression there is.
      voice("triangle", 0.09, -1, [
        [0, 4], [0, 4], [7, 4], [0, 4],
        [-3, 4], [-3, 4], [4, 4], [-3, 4],
        [5, 4], [5, 4], [0, 4], [5, 4],
        [7, 4], [7, 4], [2, 4], [7, 4],
      ]),
      // Arpeggio, three bars against the bass's four, so its phasing is texture.
      voice("square", 0.025, 2, run([0, 4, 7, 12, 7, 4, 0, 4, 7, 12, 7, 4, 0, 4, 7, 12, 9, 7, 4, 2, 0, 4, 7, 12], 2)),
    ],
  },
  /*
   * The Shelf. Still bright and major, but slower and an octave down from the
   * floor — the same music heard from outside. Lead and bass realign every eight
   * bars, which is why they sound settled.
   *
   * The arpeggio is eighty sixteenths at duration 2, F major pentatonic. The
   * duration divides the bar, so every note lands on a beat or an off-beat;
   * eighty against the sixty-four bass phases by a whole bar per pass rather
   * than a quarter, so the figure always states a chord tone on the beat and
   * only which chord it sits over changes. Pentatonic because a phasing voice
   * has to be: 0, 2, 4, 7, 9 fights none of F, Bb, Dm or C. The loop is
   * LCM(128, 64, 80) = 640 sixteenths, forty bars.
   */
  "music.band.shelf": {
    id: "music.band.shelf",
    displayName: "The Shelf",
    bpm: 112,
    rootHz: 174.61,
    voices: [
      voice("square", 0.05, 1, [
        [0, 4], [7, 4], [4, 4], [7, 4],
        [9, 4], [7, 4], [4, 8],
        [2, 4], [5, 4], [9, 4], [5, 4],
        [4, 8], [null, 8],
        [0, 4], [7, 4], [12, 4], [7, 4],
        [9, 4], [11, 4], [12, 8],
        [7, 4], [4, 4], [2, 4], [0, 4],
        [null, 16],
      ]),
      voice("triangle", 0.09, -1, [
        [0, 8], [0, 8],
        [5, 8], [5, 8],
        [-3, 8], [-3, 8],
        [7, 8], [7, 8],
      ]),
      // Five bars of eight, so it turns over against the bass's four.
      voice("square", 0.022, 2, run([
        0, 4, 7, 12, 9, 7, 4, 2,
        4, 7, 12, 14, 12, 9, 7, 4,
        7, 9, 12, 16, 14, 12, 9, 7,
        0, 4, 9, 12, 9, 4, 2, 0,
        2, 4, 7, 9, 7, 4, 2, 0,
      ], 2)),
    ],
  },
  // Deep Seams: the first minor track, and where the arpeggio starts moving
  // faster than the lead. Busier underfoot, not yet dangerous.
  "music.band.seams": {
    id: "music.band.seams",
    displayName: "Deep Seams",
    bpm: 104,
    rootHz: 155.56,
    voices: [
      voice("square", 0.05, 1, [
        [0, 4], [3, 2], [5, 2], [7, 8],
        [5, 4], [3, 4], [0, 8],
        [-2, 4], [0, 4], [3, 8],
        [2, 4], [0, 4], [null, 8],
        [7, 4], [10, 2], [12, 2], [10, 8],
        [7, 4], [5, 4], [3, 8],
        [0, 4], [3, 4], [7, 4], [3, 4],
        [0, 16],
      ]),
      voice("triangle", 0.095, -1, [
        [0, 4], [0, 4], [0, 4], [7, 4],
        [-2, 4], [-2, 4], [-2, 4], [5, 4],
        [3, 4], [3, 4], [3, 4], [10, 4],
        [-5, 4], [-5, 4], [-5, 4], [2, 4],
      ]),
      voice("square", 0.02, 2, run([0, 3, 7, 10, 7, 3, 0, 3, 7, 12, 7, 3, 0, 3, 7, 10, 5, 3], 2)),
    ],
  },
  // The Dark: slow, minor, the lead thinned to held notes, with a low pulse in
  // place of the arpeggio.
  "music.band.dark": {
    id: "music.band.dark",
    displayName: "The Dark",
    bpm: 88,
    rootHz: 130.81,
    voices: [
      voice("square", 0.045, 1, [
        [0, 8], [3, 8],
        [7, 8], [3, 8],
        [-2, 8], [0, 8],
        [null, 16],
        [3, 8], [7, 8],
        [10, 8], [7, 8],
        [3, 8], [0, 8],
        [null, 16],
      ]),
      voice("triangle", 0.1, -1, [
        [0, 16],
        [-4, 16],
        [-5, 16],
        [-2, 16],
      ]),
      // A pulse rather than an arpeggio: two notes, low and slow, marking time.
      voice("triangle", 0.03, 0, run([0, null, 7, null, 0, null, 3, null, 0, null, 7, null], 4)),
    ],
  },
  /*
   * The Hollows. Lydian (0 2 4 6 7 9 11), whose raised fourth is the ethereal
   * interval no other track in the set uses. Density rather than tempo carries
   * it: the band tracks descend in tempo by design, so this one is written busy
   * instead of fast.
   *
   * The fourth voice is a `sine`, the one waveform the set had not used — a
   * shimmer an octave above the lead, moving in sixteenths, quiet enough to be
   * air rather than melody. Gains sum to 0.162, so it buys motion, not volume.
   *
   * Lengths 96 / 128 / 48 / 80 are whole bars and deliberately unequal, giving a
   * loop of 1,920 sixteenths, 120 bars.
   */
  "music.band.hollow": {
    id: "music.band.hollow",
    displayName: "The Hollows",
    bpm: 76,
    rootHz: 110,
    voices: [
      // Lead, six bars: a rising shape and its fall, the #4 at the top of both.
      voice("square", 0.042, 1, [
        [0, 4], [7, 4], [11, 4], [12, 4],
        [9, 8], [6, 8],
        [7, 4], [11, 4], [14, 8],
        [12, 4], [9, 4], [6, 4], [4, 4],
        [2, 8], [6, 8],
        [7, 4], [4, 4], [0, 8],
      ]),
      // Bass, four whole bars: A - E - F# - B, all inside the mode.
      voice("triangle", 0.082, -1, [
        [0, 32],
        [-5, 32],
        [-3, 32],
        [2, 32],
      ]),
      // Pulse, three bars, on the beat at last.
      voice("triangle", 0.022, 0, run([0, null, 7, null, 9, null, 7, null, 4, null, 2, null], 4)),
      // Shimmer, five bars of sixteenths, an octave over the lead.
      voice("sine", 0.016, 2, run([
        0, 2, 4, 7, 6, 4, 2, 0,
        2, 4, 6, 7, 9, 7, 6, 4,
        4, 6, 7, 11, 9, 7, 6, 4,
        0, 4, 7, 9, 7, 4, 2, 0,
        2, 4, 6, 4, 2, 0, 11, 12,
      ], 2)),
    ],
  },
  /*
   * The Selenite Core. Whole tone (0 2 4 6 8 10), which has no leading tone and
   * no perfect fifth above the root, so nothing in it can resolve — the track
   * cannot settle, and that sounds weightless rather than sad. Nothing else in
   * the set uses it. The bass descends through it in whole steps.
   *
   * Four voices: a lead with a contour, an arpeggio at octave 2 for motion, and
   * a `sine` at octave 3 ringing above, closer to a bell than a melody. The long
   * bass holds are the floor of the deepest band. Gains sum to 0.162, quieter
   * than The Dark two bands above.
   *
   * Lengths 96 / 192 / 80 / 64 give a loop of 960 sixteenths, sixty bars.
   */
  "music.band.core": {
    id: "music.band.core",
    displayName: "Selenite Core",
    bpm: 64,
    rootHz: 82.41,
    voices: [
      // Lead, six bars, out of the holds and into a contour.
      voice("square", 0.04, 1, [
        [0, 4], [4, 4], [8, 8],
        [6, 8], [10, 8],
        [12, 4], [10, 4], [8, 8],
        [6, 4], [4, 4], [2, 8],
        [0, 8], [6, 8],
        [4, 4], [2, 4], [0, 8],
      ]),
      // Bass, four whole-bar-and-a-half holds, descending in whole steps.
      voice("triangle", 0.088, -1, [
        [0, 48],
        [-2, 48],
        [-4, 48],
        [-6, 48],
      ]),
      // The third voice this track never had: five bars of sixteenths.
      voice("square", 0.02, 2, run([
        0, 4, 8, 12, 10, 8, 4, 2,
        4, 8, 12, 14, 12, 10, 8, 6,
        8, 12, 14, 18, 16, 14, 12, 10,
        0, 6, 10, 12, 10, 6, 4, 2,
        2, 4, 8, 10, 8, 4, 2, 0,
      ], 2)),
      // Shimmer, four bars, slow and high — a bell rather than a melody.
      voice("sine", 0.014, 3, run([
        0, 4, 8, 6,
        10, 8, 4, 2,
        0, 6, 10, 12,
        10, 6, 4, 0,
      ], 4)),
    ],
  },
};

/**
 * Sixteenths in a bar, the grid everything here is measured against. Four-four
 * throughout, and named because the loop and phasing arguments are all stated in
 * bars.
 */
export const BAR_SIXTEENTHS = 16;

/** Total length of a voice, in sixteenths. */
export function voiceLengthInSixteenths(voice: TrackVoice): number {
  return voice.notes.reduce((total, note) => total + note.duration, 0);
}

/**
 * How long a track takes to come all the way round, in sixteenths: the least
 * common multiple of its voices, since they loop independently.
 */
export function trackLoopInSixteenths(track: MusicTrack): number {
  const lengths = track.voices.map(voiceLengthInSixteenths);

  return lengths.reduce((left, right) => {
    const greatestCommonDivisor = (a: number, b: number): number =>
      b === 0 ? a : greatestCommonDivisor(b, a % b);

    return (left * right) / greatestCommonDivisor(left, right);
  }, 1);
}
