/**
 * Coverage for the banded encounter table.
 *
 * The table is generated per band from a shared shape, so these tests guard the
 * properties that shape has to hold — every band playable, value rising with
 * depth, and collectibles resolving the way a cache open does — rather than
 * restating forty encounters as a fixture.
 */

import { describe, expect, it } from "vitest";
import { CACHE_REWARDS, ECONOMY, ENCOUNTERS, REWARD_TABLES } from "../../content/catalog";
import type { EncounterFamily, EncounterId, RewardTableId } from "../../content/catalog";
import { DEPTH_BANDS, DEPTH_BAND_IDS, type DepthBandId } from "../../content/depthBands";
import { eligibleEncounters, encounterCanGrant, resolveRewardTable } from "../../domain/encounters";
import { createRngState } from "../../domain/rng";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(seed = 5): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** Every table an encounter can pay from, including its choice options. */
function tablesOf(encounterId: EncounterId): RewardTableId[] {
  const definition = ENCOUNTERS[encounterId];

  return [
    ...(definition.rewardTableId ? [definition.rewardTableId] : []),
    ...(definition.choiceOptions ?? []).map((option) => option.rewardTableId),
  ];
}

/**
 * A crude value score for a band, used only to compare bands with each other.
 * The weights are arbitrary but consistent, which is all a monotonicity check
 * needs — it is asking "does depth pay better", not "is this balanced".
 */
function bandValue(bandId: DepthBandId): number {
  const weights: Record<string, number> = {
    ore: 1,
    components: 3,
    relics: 12,
    caches: 40,
    recipePiece: 25,
    oxygen: 1,
    collectible: 60,
  };

  let total = 0;

  for (const encounter of Object.values(ENCOUNTERS)) {
    if (!encounter.bands.includes(bandId)) {
      continue;
    }

    for (const tableId of tablesOf(encounter.id)) {
      for (const entry of REWARD_TABLES[tableId].entries) {
        for (const grant of entry.grants) {
          // Neither a collectible nor a contract has a range: one is a single
          // item drawn from a pool, the other a single goal offered.
          const midpoint =
            grant.kind === "collectible" || grant.kind === "contract"
              ? 1
              : (grant.minimum + grant.maximum) / 2;

          total += midpoint * (weights[grant.kind] ?? 1) * entry.weight;
        }
      }
    }
  }

  return total;
}

/** Total weight of entries that can pay a collectible, within one band. */
function collectibleWeight(bandId: DepthBandId): number {
  let total = 0;

  for (const encounter of Object.values(ENCOUNTERS)) {
    if (!encounter.bands.includes(bandId)) {
      continue;
    }

    for (const tableId of tablesOf(encounter.id)) {
      for (const entry of REWARD_TABLES[tableId].entries) {
        if (entry.grants.some((grant) => grant.kind === "collectible")) {
          total += entry.weight;
        }
      }
    }
  }

  return total;
}

describe("the banded encounter table", () => {
  it("gives every band a full set of families", () => {
    /*
     * `oxygen` is required of every band except the core, which deliberately has
     * none. The exception is spelled out here rather than dropped from the
     * required list, so removing an oxygen encounter from any *other* band still
     * fails.
     */
    const required: EncounterFamily[] = ["ore", "oxygen", "supply", "hazard", "rare", "choice"];

    for (const bandId of DEPTH_BAND_IDS) {
      const families = new Set(
        Object.values(ENCOUNTERS)
          .filter((encounter) => encounter.bands.includes(bandId))
          .map((encounter) => encounter.family),
      );

      for (const family of required) {
        if (family === "oxygen" && bandId === "band.core") {
          expect(families.has(family), "the core must not have an oxygen encounter").toBe(false);
          continue;
        }

        expect(families.has(family), `band ${bandId} has no ${family} encounter`).toBe(true);
      }
    }
  });

  it("keeps every band deep enough to draw from", () => {
    for (const bandId of DEPTH_BAND_IDS) {
      const inBand = Object.values(ENCOUNTERS).filter((encounter) =>
        encounter.bands.includes(bandId),
      );

      expect(inBand.length, `band ${bandId}`).toBeGreaterThanOrEqual(6);
    }
  });

  it("never offers an encounter outside its band", () => {
    for (const bandId of DEPTH_BAND_IDS) {
      const band = DEPTH_BANDS[bandId];

      for (const depth of [band.minimum, band.maximum ?? band.minimum + 40]) {
        for (const encounter of eligibleEncounters(depth)) {
          expect(encounter.bands, `${encounter.id} at depth ${depth}`).toContain(bandId);
        }
      }
    }
  });

  it("pays more the deeper the band", () => {
    const values = DEPTH_BAND_IDS.map((bandId) => bandValue(bandId));

    values.forEach((value, index) => {
      if (index > 0) {
        expect(
          value,
          `${DEPTH_BAND_IDS[index]} pays no more than the band above it`,
        ).toBeGreaterThan(values[index - 1]);
      }
    });
  });

  it("only offers collectibles from The Dark downward, and more of them deeper", () => {
    // The shallow bands are the Company store's territory.
    expect(collectibleWeight("band.shelf")).toBe(0);
    expect(collectibleWeight("band.seams")).toBe(0);

    expect(collectibleWeight("band.dark")).toBeGreaterThan(0);
    expect(collectibleWeight("band.hollow")).toBeGreaterThan(collectibleWeight("band.dark"));
    expect(collectibleWeight("band.core")).toBeGreaterThan(collectibleWeight("band.hollow"));
  });

  it("still lets every band supply a recipe piece", () => {
    // A machine whose band never pays a piece could never be built.
    for (const bandId of DEPTH_BAND_IDS) {
      const grantsPieces = Object.values(ENCOUNTERS)
        .filter((encounter) => encounter.bands.includes(bandId))
        .some((encounter) =>
          tablesOf(encounter.id).some((tableId) =>
            REWARD_TABLES[tableId].entries.some((entry) =>
              entry.grants.some((grant) => grant.kind === "recipePiece"),
            ),
          ),
        );

      expect(grantsPieces, `band ${bandId} never pays a recipe piece`).toBe(true);
    }
  });
});

describe("collectible rewards", () => {
  /** The deepest table that can pay a collectible, which is the best to sample. */
  const TABLE: RewardTableId = "reward.rare.core";

  function drawUntilCollectible(state: GameState, seeds = 400) {
    for (let seed = 1; seed <= seeds; seed += 1) {
      const resolution = resolveRewardTable(
        state,
        createRngState(seed, "expedition-rewards"),
        TABLE,
        [],
        120,
      );

      const grant = resolution.reward?.grants.find((entry) => entry.kind === "collectible");

      if (grant !== undefined && grant.kind === "collectible") {
        return grant;
      }
    }

    return null;
  }

  it("draws a real collectible from the shared cache pool", () => {
    const grant = drawUntilCollectible(fresh());

    expect(grant).not.toBeNull();
    expect(
      CACHE_REWARDS.some(
        (entry) => JSON.stringify(entry.reward) === JSON.stringify(grant?.reward),
      ),
    ).toBe(true);
  });

  it("reports how each find landed: the item, then fragments", () => {
    expect(drawUntilCollectible(fresh())?.arrival).toBe("item");

    /*
     * Owning everything makes every further find arrive as fragments, exactly as
     * a cache open does. That shared rule is the point of routing both through
     * the same pool.
     */
    const base = fresh();
    const owned: GameState = {
      ...base,
      collection: {
        ...base.collection,
        trinkets: Object.fromEntries(
          Object.entries(base.collection.trinkets).map(([id, progress]) => [
            id,
            { ...progress, owned: true },
          ]),
        ) as typeof base.collection.trinkets,
        totems: Object.fromEntries(
          Object.entries(base.collection.totems).map(([id, progress]) => [
            id,
            { ...progress, owned: true },
          ]),
        ) as typeof base.collection.totems,
      },
    };

    expect(drawUntilCollectible(owned)?.arrival).toBe("fragments");
  });

  it("lands in the collection rather than the run inventory", () => {
    /*
     * A collectible is permanent progression, not cargo — losing a trinket to an
     * oxygen failure on the way out would be a different game. The run inventory
     * has no shape for one, and this pins that it stays that way.
     */
    const inventory = fresh().expedition.runInventory;

    expect(Object.keys(inventory)).not.toContain("collectibles");
    expect(ECONOMY.fragmentsPerDuplicate).toBeGreaterThan(0);
  });
});

describe("the Selenite Core gives no air back", () => {
  /*
   * Every band above the core has an oxygen encounter, so a well-geared run can
   * refill its way downward and how deep it gets is decided by draw luck rather
   * than gear. The core removes the refill, which is the one place the game
   * guarantees a run ends.
   *
   * Asserted by walking the tables rather than by naming the encounter that was
   * deleted. An id-based assertion passes forever after the deletion and catches
   * none of the ways the invariant actually gets broken later: an oxygen entry
   * added to a rare table, a choice branch that hands air back, a shallower
   * encounter widened to `bandsFrom` a band it did not used to reach.
   */
  const CORE_DEPTHS = [
    DEPTH_BANDS["band.core"].minimum,
    DEPTH_BANDS["band.core"].minimum + 1,
    250,
    5_000,
  ];

  it("has no encounter that can grant oxygen at any core depth", () => {
    for (const depth of CORE_DEPTHS) {
      for (const encounter of eligibleEncounters(depth)) {
        expect(encounterCanGrant(encounter, "oxygen"), `${encounter.id} at depth ${depth}`).toBe(
          false,
        );
      }
    }
  });

  it("still lets every band above the core refill", () => {
    /*
     * The control. Without it the walk above would pass just as happily if
     * `encounterCanGrant` were quietly broken, or if oxygen stopped being a
     * grant kind at all.
     */
    for (const bandId of DEPTH_BAND_IDS) {
      if (bandId === "band.core") {
        continue;
      }

      const refills = eligibleEncounters(DEPTH_BANDS[bandId].minimum).filter((encounter) =>
        encounterCanGrant(encounter, "oxygen"),
      );

      expect(refills.length, bandId).toBeGreaterThan(0);
    }
  });

  it("never hands oxygen back through a negative choice cost", () => {
    // `oxygenCost` is subtracted, so a negative one is a grant wearing a cost's
    // clothes and would slip past a walk of the reward tables entirely.
    for (const encounter of eligibleEncounters(DEPTH_BANDS["band.core"].minimum)) {
      for (const option of encounter.choiceOptions ?? []) {
        expect(option.oxygenCost, `${encounter.id}/${option.id}`).toBeGreaterThanOrEqual(0);
        expect(option.oxygenDrainMultiplier, `${encounter.id}/${option.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("leaves the core a playable table after the removal", () => {
    /*
     * Deleting an encounter from the deepest band could have thinned it to the
     * point of monotony, or emptied it — `validateContent` catches empty, but not
     * "three encounters and one of them is 60% of the draws".
     */
    const core = eligibleEncounters(DEPTH_BANDS["band.core"].minimum);
    const families = new Set(core.map((encounter) => encounter.family));
    const total = core.reduce((sum, encounter) => sum + encounter.baseWeight, 0);
    const heaviest = Math.max(...core.map((encounter) => encounter.baseWeight));

    expect(core.length).toBeGreaterThanOrEqual(6);
    expect(families.size).toBeGreaterThanOrEqual(4);
    expect(heaviest / total).toBeLessThan(0.5);
  });
});
