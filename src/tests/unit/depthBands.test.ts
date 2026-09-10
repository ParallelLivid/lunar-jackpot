/**
 * Coverage for depth bands.
 *
 * Bands are the shared gate that recipe pieces, the encounter table, and run
 * modifiers will all point at, so the properties worth pinning are structural:
 * the axis is fully tiled, every band can actually generate something, and the
 * opening encounter of a run is still deterministic.
 */

import { describe, expect, it } from "vitest";
import { ENCOUNTERS, FIRST_ENCOUNTER_ID } from "../../content/catalog";
import {
  DEPTH_BANDS,
  DEPTH_BAND_IDS,
  bandForDepth,
  bandsFrom,
  isDepthBandId,
} from "../../content/depthBands";
import { eligibleEncounters, generateEncounter } from "../../domain/encounters";
import { deriveContext, selectExpeditionView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { createRngState } from "../../domain/rng";

describe("depth bands", () => {
  it("tiles the depth axis with no gap and no overlap", () => {
    DEPTH_BAND_IDS.forEach((id, index) => {
      const band = DEPTH_BANDS[id];

      if (index === 0) {
        expect(band.minimum).toBe(0);
      } else {
        const previous = DEPTH_BANDS[DEPTH_BAND_IDS[index - 1]];

        expect(previous.maximum).not.toBeNull();
        expect(band.minimum).toBe((previous.maximum ?? 0) + 1);
      }

      if (index === DEPTH_BAND_IDS.length - 1) {
        // Exactly one open-ended band, or deep runs would fall off the end.
        expect(band.maximum).toBeNull();
      } else {
        expect(band.maximum).not.toBeNull();
        expect(band.maximum ?? 0).toBeGreaterThanOrEqual(band.minimum);
      }
    });
  });

  it("resolves every depth to exactly one band", () => {
    for (let depth = 0; depth <= 60; depth += 1) {
      const band = bandForDepth(depth);

      expect(depth).toBeGreaterThanOrEqual(band.minimum);

      if (band.maximum !== null) {
        expect(depth).toBeLessThanOrEqual(band.maximum);
      }
    }

    // Absurd and malformed depths still answer, rather than throwing mid-run.
    expect(bandForDepth(10_000).id).toBe(DEPTH_BAND_IDS[DEPTH_BAND_IDS.length - 1]);
    expect(bandForDepth(-5).id).toBe(DEPTH_BAND_IDS[0]);
    expect(bandForDepth(Number.NaN).id).toBe(DEPTH_BAND_IDS[0]);
  });

  it("gives every band at least one encounter", () => {
    for (const id of DEPTH_BAND_IDS) {
      const inBand = Object.values(ENCOUNTERS).filter((encounter) =>
        encounter.bands.includes(id),
      );

      expect(inBand.length, `band ${id}`).toBeGreaterThan(0);
    }
  });

  it("only offers encounters that belong to the current band", () => {
    for (const id of DEPTH_BAND_IDS) {
      const band = DEPTH_BANDS[id];
      const eligible = eligibleEncounters(band.minimum);

      expect(eligible.length, `band ${id}`).toBeGreaterThan(0);

      for (const encounter of eligible) {
        expect(encounter.bands, `${encounter.id} in ${id}`).toContain(id);
      }
    }
  });

  it("builds a downward range from a starting band", () => {
    expect(bandsFrom(DEPTH_BAND_IDS[0])).toEqual([...DEPTH_BAND_IDS]);
    expect(bandsFrom("band.dark")).toEqual(["band.dark", "band.hollow", "band.core"]);
    expect(bandsFrom(DEPTH_BAND_IDS[DEPTH_BAND_IDS.length - 1])).toHaveLength(1);
  });

  it("recognises its own ids and nothing else", () => {
    expect(isDepthBandId("band.dark")).toBe(true);
    expect(isDepthBandId("band.nowhere")).toBe(false);
    expect(isDepthBandId(3)).toBe(false);
  });
});

describe("the opening encounter", () => {
  /**
   * A run used to open on the shallow seam because it was the only encounter with
   * a depth floor of zero. Bands are coarser, so the guarantee is now explicit —
   * and it is worth a test, because nothing else in the content would catch it
   * being lost.
   */
  it("is always the same ore node, whatever the seed", () => {
    const state = createGameState({ nowUnixMs: 0, seed: 1 });

    for (let seed = 1; seed <= 200; seed += 1) {
      const generated = generateEncounter(
        state,
        createRngState(seed, "expedition-generation"),
        0,
        [],
        0,
      );

      expect(generated.encounter?.encounterId).toBe(FIRST_ENCOUNTER_ID);
    }

    expect(ENCOUNTERS[FIRST_ENCOUNTER_ID].family).toBe("ore");
  });

  it("stops pinning past the first encounter", () => {
    const state = createGameState({ nowUnixMs: 0, seed: 1 });
    const seen = new Set<string>();

    for (let seed = 1; seed <= 200; seed += 1) {
      const generated = generateEncounter(
        state,
        createRngState(seed, "expedition-generation"),
        3,
        [],
        0,
      );

      if (generated.encounter !== null) {
        seen.add(generated.encounter.encounterId);
      }
    }

    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("the expedition view", () => {
  it("names the band the run is currently in", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 4 });

    for (const [depth, expected] of [
      [0, "The Shelf"],
      [24, "The Shelf"],
      [25, "Deep Seams"],
      [50, "The Dark"],
      [75, "The Hollows"],
      [100, "Selenite Core"],
      [500, "Selenite Core"],
    ] as const) {
      const state: GameState = {
        ...base,
        expedition: { ...base.expedition, depth },
      };

      expect(selectExpeditionView(deriveContext(state)).depthBandName).toBe(expected);
    }
  });
});
