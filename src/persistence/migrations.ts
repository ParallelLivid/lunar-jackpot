/**
 * Sequential save migrations.
 *
 * Each migration is a pure function from one save version to the next and
 * operates on the raw stored shape, before normalization. Fixtures for each
 * step live in the unit tests.
 */

import { DEFAULT_CAT_SKIN_IDS } from "../content/catSkins";
import { createRngState } from "../domain/rng";
import { SAVE_VERSION } from "./saveSchema";

/**
 * Frozen at the values version 2 was written against. A migration must be a pure
 * function of the shape it was authored for: reading the live
 * `ECONOMY.trinketFragmentCosts` would let retuning the curve silently change
 * how old saves convert.
 */
const V2_TRINKET_FRAGMENT_COSTS = [3, 6];

/** The raw, still-untrusted shape read out of storage. */
export type RawEnvelope = Record<string, unknown>;

export type Migration = (envelope: RawEnvelope) => RawEnvelope;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * Version 1 predates the dedicated expedition-seed stream, the per-cycle
 * prestige metric, and the progression pity counters.
 */
const migrateOneToTwo: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const random = asRecord(game.random);
  const prestige = asRecord(game.prestige);

  if (random.expeditionSeeds === undefined) {
    const seed =
      typeof envelope.savedAtUnixMs === "number" ? Math.trunc(envelope.savedAtUnixMs) >>> 0 : 1;
    random.expeditionSeeds = createRngState(seed, "expedition-seeds");
  }

  if (prestige.cycleCashEarned === undefined) {
    // Before the split the only metric was lifetime cash. Crediting the full
    // total is the safe reading: it never moves a player backward.
    prestige.cycleCashEarned = prestige.lifetimeCashEarned ?? 0;
  }

  return {
    ...envelope,
    saveVersion: 2,
    game: {
      ...game,
      random,
      prestige,
      pity: game.pity ?? { encountersSinceRecipePiece: 0, encountersSinceRelic: 0 },
    },
  };
};

/**
 * Version 2 held a count per trinket per tier, so several copies at several
 * tiers could coexist. Version 3 keeps one entity per trinket plus a fragment
 * pool, and duplicates arrive as fragments.
 *
 * The fold keeps the player's best copy and converts everything else into the
 * fragments it would now be worth, so no value is lost across the change.
 */
const migrateTwoToThree: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const collection = asRecord(game.collection);
  const counts = asRecord(collection.trinketCounts);

  const trinkets: Record<string, unknown> = {};

  for (const [trinketId, rawTiers] of Object.entries(counts)) {
    const tiers = asRecord(rawTiers);
    const owned: Array<{ tier: number; count: number }> = [1, 2, 3]
      .map((tier) => ({ tier, count: Math.max(0, Math.trunc(Number(tiers[tier] ?? 0)) || 0) }))
      .filter((entry) => entry.count > 0);

    if (owned.length === 0) {
      trinkets[trinketId] = { owned: false, tier: 1, fragments: 0 };
      continue;
    }

    const best = owned.reduce((highest, entry) => (entry.tier > highest.tier ? entry : highest));

    // Every copy beyond the one kept becomes the fragments that tier is worth.
    const fragments = owned.reduce((total, entry) => {
      const spare = entry.tier === best.tier ? entry.count - 1 : entry.count;

      return total + spare * (V2_TRINKET_FRAGMENT_COSTS[entry.tier - 1] ?? 1);
    }, 0);

    trinkets[trinketId] = { owned: true, tier: best.tier, fragments };
  }

  // Slots held a full reference; they now hold only the id.
  const gear = asRecord(game.gear);

  const foldSlots = (value: unknown): Array<string | null> => {
    const list = Array.isArray(value) ? value : [];

    return [0, 1, 2].map((index) => {
      const entry: unknown = list[index];

      if (typeof entry === "object" && entry !== null && "trinketId" in entry) {
        const id = (entry as { trinketId?: unknown }).trinketId;

        return typeof id === "string" ? id : null;
      }

      return typeof entry === "string" ? entry : null;
    });
  };

  const totems = asRecord(collection.totems);
  const foldedTotems: Record<string, unknown> = {};

  for (const [totemId, rawProgress] of Object.entries(totems)) {
    const progress = asRecord(rawProgress);
    foldedTotems[totemId] = {
      owned: progress.owned ?? false,
      rank: progress.rank ?? 0,
      fragments: progress.duplicateProgress ?? progress.fragments ?? 0,
    };
  }

  return {
    ...envelope,
    saveVersion: 3,
    game: {
      ...game,
      gear: {
        ...gear,
        tankTrinketSlots: foldSlots(gear.tankTrinketSlots),
        pickaxeTrinketSlots: foldSlots(gear.pickaxeTrinketSlots),
      },
      collection: {
        ...collection,
        trinkets,
        totems: foldedTotems,
        trinketCounts: undefined,
      },
    },
  };
};

/**
 * Version 3 held a numeric tier (1-3) per trinket and rank (1-3) per totem.
 * Version 4 replaces both with the eight-step grade ladder, E through SSS.
 *
 * E/D/C is the closest mapping where no collectible is weakened, checked against
 * the real content:
 *
 *   tier 2 -> D   bladder 19.2 >= 18, regulator 19.2% >= 16%,
 *                 tungsten 7.2 >= 7, sieve 36% >= 30%
 *   tier 3 -> C   bladder 35.2 >= 32, regulator 35.2% >= 26%,
 *                 tungsten 13.2 >= 13, sieve 66% >= 50%
 *
 * The ballast anchor and the loaded die are the exception: their effects were
 * redesigned onto different stats rather than rescaled, so there is no numeric
 * comparison to make.
 *
 * Fragment balances are tripled because `fragmentsPerDuplicate` moved from 1 to
 * 3 in the same change.
 */
const V3_GRADE_BY_TIER: Record<number, string> = { 1: "E", 2: "D", 3: "C" };
const V3_FRAGMENT_SCALE = 3;

const migrateThreeToFour: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const collection = asRecord(game.collection);

  const regrade = (raw: unknown, levelKey: "tier" | "rank"): Record<string, unknown> => {
    const entries = asRecord(raw);
    const converted: Record<string, unknown> = {};

    for (const [id, rawProgress] of Object.entries(entries)) {
      const progress = asRecord(rawProgress);
      const level = Math.trunc(Number(progress[levelKey] ?? 1)) || 1;
      const fragments = Math.max(0, Math.trunc(Number(progress.fragments ?? 0)) || 0);

      converted[id] = {
        owned: progress.owned ?? false,
        grade: V3_GRADE_BY_TIER[Math.min(3, Math.max(1, level))] ?? "E",
        fragments: fragments * V3_FRAGMENT_SCALE,
      };
    }

    return converted;
  };

  return {
    ...envelope,
    saveVersion: 4,
    game: {
      ...game,
      collection: {
        ...collection,
        trinkets: regrade(collection.trinkets, "tier"),
        totems: regrade(collection.totems, "rank"),
      },
    },
  };
};

/**
 * Version 4 valued a duplicate find at three fragments; version 5 values it at
 * one, alongside a shallower Fibonacci cost curve.
 *
 * What is preserved is duplicate-equivalence rather than the raw number, so
 * balances are divided by the old rate and rounded up rather than confiscating a
 * partial fragment. The exact inverse of the tripling in the 3 -> 4 migration,
 * and both use frozen literals, so a save travelling the whole distance from
 * version 3 lands where one already at 4 does.
 */
const V4_FRAGMENTS_PER_DUPLICATE = 3;

const migrateFourToFive: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const collection = asRecord(game.collection);

  const rescale = (raw: unknown): Record<string, unknown> => {
    const entries = asRecord(raw);
    const converted: Record<string, unknown> = {};

    for (const [id, rawProgress] of Object.entries(entries)) {
      const progress = asRecord(rawProgress);
      const fragments = Math.max(0, Math.trunc(Number(progress.fragments ?? 0)) || 0);

      converted[id] = {
        ...progress,
        fragments: Math.ceil(fragments / V4_FRAGMENTS_PER_DUPLICATE),
      };
    }

    return converted;
  };

  return {
    ...envelope,
    saveVersion: 5,
    game: {
      ...game,
      collection: {
        ...collection,
        trinkets: rescale(collection.trinkets),
        totems: rescale(collection.totems),
      },
    },
  };
};

/**
 * Version 5 gated machine levels behind "upgrade band" research and stored
 * researched nodes as a flat id list. Version 6 removes the bands, makes levels
 * uncapped, and stores a rank per node so a node can be repeatable.
 *
 * Every surviving node folds to rank 1. The band nodes no longer exist and cost
 * up to 18,000 chips, so they are refunded rather than silently deleted.
 */
const V5_BAND_NODE_CHIP_COSTS: Record<string, number> = {
  "research.alpha.band-two": 40,
  "research.alpha.band-three": 320,
  "research.beta.band-two": 600,
  "research.beta.band-three": 2_600,
  "research.gamma.band-two": 5_200,
  "research.gamma.band-three": 18_000,
};

const migrateFiveToSix: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const casino = asRecord(game.casino);
  const machines = asRecord(casino.machines);
  const resources = asRecord(game.resources);

  const converted: Record<string, unknown> = {};
  let refund = 0;

  for (const [machineId, rawProgress] of Object.entries(machines)) {
    const progress = asRecord(rawProgress);
    const researched = Array.isArray(progress.researchedNodeIds)
      ? progress.researchedNodeIds
      : [];
    const researchRanks: Record<string, number> = {};

    for (const entry of researched) {
      if (typeof entry !== "string") {
        continue;
      }

      const bandCost = V5_BAND_NODE_CHIP_COSTS[entry];

      if (bandCost !== undefined) {
        refund += bandCost;
        continue;
      }

      researchRanks[entry] = 1;
    }

    converted[machineId] = {
      ...progress,
      researchRanks,
      researchedNodeIds: undefined,
    };
  }

  return {
    ...envelope,
    saveVersion: 6,
    game: {
      ...game,
      resources: {
        ...resources,
        chips: (Number(resources.chips ?? 0) || 0) + refund,
      },
      casino: { ...casino, machines: converted },
    },
  };
};

/**
 * Version 6 had a "Tempo" spec on every machine. Version 7 replaces it with
 * "Gambler" and adds "Flywheel", moving the spec and research ids. The rename is
 * carried rather than dropped, so a player who researched Tempo keeps an
 * unlocked third spec and one who had it equipped stays on its replacement.
 */
const V6_RENAMED_IDS: Record<string, string> = {
  "research.alpha.spec-tempo": "research.alpha.spec-gambler",
  "research.beta.spec-tempo": "research.beta.spec-gambler",
  "research.gamma.spec-tempo": "research.gamma.spec-gambler",
  "spec.alpha.tempo": "spec.alpha.gambler",
  "spec.beta.tempo": "spec.beta.gambler",
  "spec.gamma.tempo": "spec.gamma.gambler",
};

const migrateSixToSeven: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const casino = asRecord(game.casino);
  const machines = asRecord(casino.machines);
  const converted: Record<string, unknown> = {};

  for (const [machineId, rawProgress] of Object.entries(machines)) {
    const progress = asRecord(rawProgress);
    const ranks = asRecord(progress.researchRanks);
    const renamedRanks: Record<string, unknown> = {};

    for (const [nodeId, rank] of Object.entries(ranks)) {
      renamedRanks[V6_RENAMED_IDS[nodeId] ?? nodeId] = rank;
    }

    const activeSpecId =
      typeof progress.activeSpecId === "string"
        ? (V6_RENAMED_IDS[progress.activeSpecId] ?? progress.activeSpecId)
        : progress.activeSpecId;

    converted[machineId] = {
      ...progress,
      researchRanks: renamedRanks,
      activeSpecId,
      // The ramp is new, and starts cold for everyone.
      flywheelCycles: 0,
    };
  }

  return {
    ...envelope,
    saveVersion: 7,
    game: { ...game, casino: { ...casino, machines: converted } },
  };
};

/**
 * Version 7 had five one-shot prestige perks bought once each. Version 8
 * replaces them with a ranked tree, and three of the five no longer exist.
 * Surviving purchases fold to rank 1; the removed three refund their selenite,
 * since a purchase that vanishes without trace is worse than one repaid.
 */
const V7_PERK_RENAMES: Record<string, string> = {
  "perk.house-edge": "perk.house.edge",
  "perk.seed-capital": "perk.house.capital",
  "perk.lucky-charm": "perk.vault.charm",
};

const V7_REMOVED_PERK_COSTS: Record<string, number> = {
  "perk.relic-consignment": 4,
  "perk.refinery": 5,
};

const migrateSevenToEight: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const prestige = asRecord(game.prestige);
  const resources = asRecord(game.resources);
  const purchased = Array.isArray(prestige.purchasedPerkIds) ? prestige.purchasedPerkIds : [];

  const perkRanks: Record<string, number> = {};
  let refund = 0;

  for (const entry of purchased) {
    if (typeof entry !== "string") {
      continue;
    }

    const removed = V7_REMOVED_PERK_COSTS[entry];

    if (removed !== undefined) {
      refund += removed;
      continue;
    }

    perkRanks[V7_PERK_RENAMES[entry] ?? entry] = 1;
  }

  return {
    ...envelope,
    saveVersion: 8,
    game: {
      ...game,
      resources: {
        ...resources,
        selenite: (Number(resources.selenite ?? 0) || 0) + refund,
      },
      prestige: { ...prestige, perkRanks, purchasedPerkIds: undefined },
    },
  };
};

/**
 * Version 8 to 9: the cache gate moved from completed runs to depth descended.
 * The old stamp is discarded rather than converted, because no arithmetic
 * relates the two counters — 12 runs might be 30 depths or 300.
 *
 * Zero is both the honest and the safe starting value: `depthDescended` itself
 * starts at zero on an older save, so this puts the player a full gate away from
 * their next cache rather than handing them one immediately.
 */
const migrateEightToNine: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const purchase = asRecord(game.purchase);

  return {
    ...envelope,
    saveVersion: 9,
    game: {
      ...game,
      purchase: {
        ...purchase,
        depthAtLastCachePurchase: 0,
        runsAtLastCachePurchase: undefined,
      },
    },
  };
};

/**
 * Nine to ten: three new chip games, and the slot game's `spinId` becomes
 * `betId`. The rename has to happen here rather than in the normaliser, or a
 * save carrying an in-flight spin would arrive with no readable id, be discarded
 * as unreadable, and take the player's wager with it.
 *
 * The three new games are left absent: each normalises from nothing to its fresh
 * state, which is right for a save that has never played them.
 */
const migrateNineToTen: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const gambling = asRecord(game.gambling);
  const committedSpin = asRecord(gambling.committedSpin);
  const hadSpin = gambling.committedSpin !== null && gambling.committedSpin !== undefined;

  const recentResults = Array.isArray(gambling.recentResults)
    ? gambling.recentResults.map((entry) => {
        const summary = asRecord(entry);

        return {
          ...summary,
          betId: summary.betId ?? summary.spinId,
          gameId: "game.slots",
          spinId: undefined,
        };
      })
    : [];

  return {
    ...envelope,
    saveVersion: 10,
    game: {
      ...game,
      gambling: {
        ...gambling,
        committedSpin: hadSpin
          ? {
              ...committedSpin,
              betId: committedSpin.betId ?? committedSpin.spinId,
              gameId: "game.slots",
              spinId: undefined,
            }
          : null,
        recentResults,
      },
    },
  };
};

/**
 * Version 10 predates the developer-edit marker, so every existing save is
 * credited as clean: the flag records what this build saw, and it saw nothing
 * before it existed.
 */
const migrateTenToEleven: Migration = (envelope) => {
  const game = asRecord(envelope.game);

  return {
    ...envelope,
    saveVersion: 11,
    game: { ...game, devMenuUsed: false },
  };
};

/**
 * Version 11 predates the second kind of cache. The new fields are seeded
 * explicitly rather than left to the normaliser's defaults, so a migrated save
 * says what it holds instead of being repaired on every load.
 *
 * Nothing is moved: existing caches stay ordinary, and there are no deep ones
 * because there was no way to have earned any.
 */
const migrateElevenToTwelve: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const resources = asRecord(game.resources);
  const purchase = asRecord(game.purchase);
  const settings = asRecord(game.settings);
  const expedition = asRecord(game.expedition);
  const runInventory = asRecord(expedition.runInventory);

  return {
    ...envelope,
    saveVersion: 12,
    game: {
      ...game,
      resources: { ...resources, deepCaches: resources.deepCaches ?? 0 },
      purchase: {
        ...purchase,
        depthAtLastDeepCachePurchase: purchase.depthAtLastDeepCachePurchase ?? 0,
      },
      settings: {
        ...settings,
        cacheAutobuy: settings.cacheAutobuy ?? { enabled: false },
      },
      expedition: {
        ...expedition,
        runInventory: { ...runInventory, deepCaches: runInventory.deepCaches ?? 0 },
      },
    },
  };
};


/**
 * Cats become entities that wear a skin. An existing save holds only a count, so
 * one entry is generated per cat already met, with a default skin assigned
 * pseudo-randomly from the cat's own index rather than left uniform.
 *
 * `Math.random` is deliberately not used: a migration must produce the same
 * result every time it is applied to the same input, or a retried load would
 * produce different cats and two devices restoring one backup would disagree.
 */
const migrateTwelveToThirteen: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const collection = asRecord(game.collection);
  const statistics = asRecord(game.statistics);
  const catsFound = typeof statistics.catsFound === "number" ? statistics.catsFound : 0;
  const existing = Array.isArray(collection.cats) ? collection.cats : [];
  const count = Math.max(0, Math.floor(catsFound));

  return {
    ...envelope,
    saveVersion: 13,
    game: {
      ...game,
      collection: {
        ...collection,
        ownedCatSkinIds: Array.isArray(collection.ownedCatSkinIds)
          ? collection.ownedCatSkinIds
          : [...DEFAULT_CAT_SKIN_IDS],
        cats:
          existing.length >= count
            ? existing
            : Array.from({ length: count }, (_, index) => ({
                // A cheap integer hash of the index: stable, and spread across the
                // four defaults rather than cycling visibly.
                skinId:
                  DEFAULT_CAT_SKIN_IDS[
                    ((index * 2_654_435_761) >>> 0) % DEFAULT_CAT_SKIN_IDS.length
                  ],
              })),
      },
      expedition: {
        ...asRecord(game.expedition),
        pauseRemainingWallMs: 0,
      },
    },
  };
};


/**
 * Consumables. Nothing to convert, so this exists only to give the field a
 * value — explicit rather than left to `normalizeGameState`, because a skipped
 * version leaves a hole in the chain and the next migration would have to guess
 * its real predecessor.
 */
const migrateThirteenToFourteen: Migration = (envelope) => {
  const game = asRecord(envelope.game);

  return {
    ...envelope,
    saveVersion: 14,
    game: {
      ...game,
      heldConsumableIds: Array.isArray(game.heldConsumableIds) ? game.heldConsumableIds : [],
    },
  };
};

/**
 * 14 to 15: the casino has a name, and no save has one yet. `null` rather than a
 * generated name, so an existing save is asked once like a new one. Present for
 * the reason the 13-to-14 migration gives: the chain must have no holes.
 */
const migrateFourteenToFifteen: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const settings = asRecord(game.settings);

  return {
    ...envelope,
    saveVersion: 15,
    game: { ...game, settings: { ...settings, casinoName: null } },
  };
};

/**
 * 15 to 16: the Gilded suit is the Visitor. Unlike the sprite ids that moved with
 * it, this string is in the save — `collection.ownedMinerSkinIds` and
 * `activeMinerSkinId` — and `normalizeGameState` filters both through
 * `isMinerSkinId`. Without this, a save that bought the most expensive suit in
 * the shop would load back owning nothing, with no error to say why.
 */
const migrateFifteenToSixteen: Migration = (envelope) => {
  const game = asRecord(envelope.game);
  const collection = asRecord(game.collection);
  const renamed = (skinId: unknown): unknown =>
    skinId === "miner.gilded" ? "miner.visitor" : skinId;

  return {
    ...envelope,
    saveVersion: 16,
    game: {
      ...game,
      collection: {
        ...collection,
        ownedMinerSkinIds: Array.isArray(collection.ownedMinerSkinIds)
          ? collection.ownedMinerSkinIds.map(renamed)
          : collection.ownedMinerSkinIds,
        activeMinerSkinId: renamed(collection.activeMinerSkinId),
      },
    },
  };
};

/** Keyed by the version the migration upgrades *from*. */
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateOneToTwo,
  2: migrateTwoToThree,
  3: migrateThreeToFour,
  4: migrateFourToFive,
  5: migrateFiveToSix,
  6: migrateSixToSeven,
  7: migrateSevenToEight,
  8: migrateEightToNine,
  9: migrateNineToTen,
  10: migrateTenToEleven,
  11: migrateElevenToTwelve,
  12: migrateTwelveToThirteen,
  13: migrateThirteenToFourteen,
  14: migrateFourteenToFifteen,
  15: migrateFifteenToSixteen,
};

export interface MigrationResult {
  envelope: RawEnvelope;
  appliedVersions: number[];
}

export function runMigrations(envelope: RawEnvelope): MigrationResult {
  let current = envelope;
  const appliedVersions: number[] = [];

  let version = typeof current.saveVersion === "number" ? current.saveVersion : 0;

  // A save with no readable version is treated as the oldest known shape.
  if (version < 1) {
    version = 1;
    current = { ...current, saveVersion: 1 };
  }

  while (version < SAVE_VERSION) {
    const migration = MIGRATIONS[version];

    if (migration === undefined) {
      break;
    }

    current = migration(current);
    appliedVersions.push(version);

    const next = typeof current.saveVersion === "number" ? current.saveVersion : version + 1;

    if (next <= version) {
      break;
    }

    version = next;
  }

  return { envelope: { ...current, saveVersion: version }, appliedVersions };
}
