import { describe, expect, it } from "vitest";
import { SOUND_CATALOG } from "../../audio/soundCatalog";
import { ECONOMY } from "../../content/catalog";
import { createFreshSettingsState, createGameState } from "../../domain/state";
import { reduce } from "../../domain/reducer";
import { normalizeGameState } from "../../persistence/saveSchema";
import {
  appendFeedback,
  feedbackLifetimeMs,
  hasExpired,
  pruneFeedback,
  type FeedbackMessage,
} from "../../app/feedback";

const NOW = 1_000;

function append(
  messages: FeedbackMessage[],
  text: string,
  tone: FeedbackMessage["tone"] = "neutral",
  nowMs = NOW,
  nextId = 1,
) {
  return appendFeedback(messages, { tone, text }, nowMs, nextId);
}

describe("feedback queue", () => {
  it("gives each message an expiry from its tone", () => {
    const positive = append([], "banked", "positive").messages[0];
    const negative = append([], "rejected", "negative").messages[0];

    expect(positive.expiresAtMs).toBe(NOW + feedbackLifetimeMs("positive"));
    expect(negative.expiresAtMs).toBe(NOW + feedbackLifetimeMs("negative"));
    expect(negative.expiresAtMs).toBeGreaterThan(positive.expiresAtMs);
  });

  it("drops messages once they expire", () => {
    const { messages } = append([], "banked");
    const expiry = messages[0].expiresAtMs;

    expect(pruneFeedback(messages, expiry - 1)).toHaveLength(1);
    expect(pruneFeedback(messages, expiry)).toHaveLength(0);
    expect(hasExpired(messages, expiry - 1)).toBe(false);
    expect(hasExpired(messages, expiry)).toBe(true);
  });

  it("collapses a repeated message into a count and refreshes its expiry", () => {
    const first = append([], "Not enough resources.", "negative", NOW, 1);
    const second = append(first.messages, "Not enough resources.", "negative", NOW + 500, first.nextId);
    const third = append(second.messages, "Not enough resources.", "negative", NOW + 900, second.nextId);

    expect(third.messages).toHaveLength(1);
    expect(third.messages[0].count).toBe(3);
    expect(third.messages[0].expiresAtMs).toBe(NOW + 900 + feedbackLifetimeMs("negative"));
    // A collapsed repeat must not burn an id.
    expect(third.nextId).toBe(2);
  });

  it("does not collapse a repeat that is no longer the newest message", () => {
    const first = append([], "same", "neutral", NOW, 1);
    const other = append(first.messages, "different", "neutral", NOW, first.nextId);
    const again = append(other.messages, "same", "neutral", NOW, other.nextId);

    expect(again.messages).toHaveLength(3);
  });

  it("never shows more than the configured maximum", () => {
    let messages: FeedbackMessage[] = [];
    let nextId = 1;

    for (let index = 0; index < ECONOMY.feedbackMaxVisible + 4; index += 1) {
      const result = append(messages, `message ${index}`, "neutral", NOW, nextId);
      messages = result.messages;
      nextId = result.nextId;
    }

    expect(messages).toHaveLength(ECONOMY.feedbackMaxVisible);
    // The oldest are the ones dropped.
    expect(messages[messages.length - 1].text).toBe(
      `message ${ECONOMY.feedbackMaxVisible + 3}`,
    );
  });
});

describe("the machine volume setting", () => {
  /**
   * The adapter's own mixing line, over the catalog data it really reads.
   *
   * `AudioManager.play` multiplies the cue's gain by master, by its channel, and
   * by the machine level where the cue is a machine's — then drops anything that
   * comes out at zero. That last step is what makes a slider at zero exactly the
   * old `machineSounds` switch turned off, so it is the arithmetic rather than a
   * special case that has to be tested.
   */
  const volumeOf = (
    soundId: keyof typeof SOUND_CATALOG,
    settings: ReturnType<typeof createFreshSettingsState>,
  ): number => {
    const definition = SOUND_CATALOG[soundId];
    const channelVolume =
      definition.channel === "music" ? settings.musicVolume : settings.sfxVolume;
    const sourceVolume = definition.source === "machine" ? settings.machineVolume : 1;

    return definition.gain * settings.masterVolume * channelVolume * sourceVolume;
  };

  const idsOf = (): Array<keyof typeof SOUND_CATALOG> =>
    Object.keys(SOUND_CATALOG) as Array<keyof typeof SOUND_CATALOG>;

  it("silences only the machine cues at zero, and leaves the rest audible", () => {
    const played: string[] = [];
    const settings = { ...createFreshSettingsState(), machineVolume: 0 };

    for (const soundId of idsOf()) {
      if (volumeOf(soundId, settings) > 0) {
        played.push(soundId);
      }
    }

    /*
     * Every machine cue is silenced, not just the one generic cue this setting
     * was written against. Asserted over the whole set rather than by name: the
     * previous version named `sound.machine.payout`, and when that id was
     * replaced by ten per-machine cues the assertion started passing because the
     * id no longer existed at all.
     */
    const machineCues = (Object.keys(SOUND_CATALOG) as Array<keyof typeof SOUND_CATALOG>).filter(
      (soundId) => SOUND_CATALOG[soundId].source === "machine",
    );

    expect(machineCues.length).toBeGreaterThan(1);

    for (const soundId of machineCues) {
      expect(played, soundId).not.toContain(soundId);
    }

    /*
     * And everything else still plays — the setting silences machines, not the
     * game.
     *
     * Over the set for the same reason the machine half is: a named assertion
     * goes wrong in both directions as cue ids move, so neither half names one.
     */
    const otherCues = (Object.keys(SOUND_CATALOG) as Array<keyof typeof SOUND_CATALOG>).filter(
      (soundId) => SOUND_CATALOG[soundId].source !== "machine",
    );

    expect(otherCues.length).toBeGreaterThan(machineCues.length);

    for (const soundId of otherCues) {
      expect(played, soundId).toContain(soundId);
    }
  });

  it("turns the cue down without turning it off", () => {
    /*
     * What the switch could not do, and the whole reason for the change. A
     * machine cue at half volume is quieter than the same cue at full; every
     * other cue is untouched by the setting at any level.
     */
    const machine = idsOf().find((soundId) => SOUND_CATALOG[soundId].source === "machine");
    const other = idsOf().find((soundId) => SOUND_CATALOG[soundId].source !== "machine");

    expect(machine).toBeDefined();
    expect(other).toBeDefined();

    const loud = { ...createFreshSettingsState(), machineVolume: 1 };
    const quiet = { ...createFreshSettingsState(), machineVolume: 0.25 };

    expect(volumeOf(machine!, quiet)).toBeGreaterThan(0);
    expect(volumeOf(machine!, quiet)).toBeLessThan(volumeOf(machine!, loud));
    expect(volumeOf(other!, quiet)).toBe(volumeOf(other!, loud));
  });

  it("starts audible, and inside the range the reducer clamps to", () => {
    const fresh = createFreshSettingsState().machineVolume;

    expect(fresh).toBeGreaterThan(0);
    expect(fresh).toBeLessThanOrEqual(1);
  });

  it("clamps a level from outside the range rather than trusting it", () => {
    // The same guard `masterVolume` and the rest have had; a hand-edited save or
    // a stale client must not be able to hand the mixer a negative gain.
    const tooLoud = reduce(createGameState({ nowUnixMs: 0, seed: 1 }), {
      type: "UPDATE_SETTINGS",
      patch: { machineVolume: 4 },
    }).state;
    const tooQuiet = reduce(createGameState({ nowUnixMs: 0, seed: 1 }), {
      type: "UPDATE_SETTINGS",
      patch: { machineVolume: -1 },
    }).state;

    expect(tooLoud.settings.machineVolume).toBe(1);
    expect(tooQuiet.settings.machineVolume).toBe(0);
  });

  it("carries an old save's silenced machines across as a level of zero", () => {
    /*
     * Save migration is not a priority in development, but a player who
     * deliberately turned the cue off is the one case where the default would
     * read as the setting having been ignored rather than replaced.
     *
     * Not hypothetical: `src/tests/fixtures/import-sample.json` is a version 3
     * save and still carries `machineSounds`, because it is checksummed over its
     * own body and predates the slider by six versions. Rewriting the field in
     * it would only have invalidated the checksum, which is how this reader
     * earned its keep.
     */
    const silenced = normalizeGameState({ settings: { machineSounds: false } }, NOW);
    const untouched = normalizeGameState({ settings: { machineSounds: true } }, NOW);

    expect(silenced.state.settings.machineVolume).toBe(0);
    expect(untouched.state.settings.machineVolume).toBe(
      createFreshSettingsState().machineVolume,
    );
  });

  it("gives every cue a source so nothing escapes the mixer", () => {
    for (const definition of Object.values(SOUND_CATALOG)) {
      expect(["machine", "expedition", "gambling", "ui"]).toContain(definition.source);
    }
  });
});
