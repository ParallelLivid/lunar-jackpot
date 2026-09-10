import { describe, expect, it } from "vitest";
import { ECONOMY } from "../../content/catalog";
import { TUTORIAL_ACTS } from "../../content/tutorial";
import { createRngState } from "../../domain/rng";
import { createGameState } from "../../domain/state";
import {
  BACKUP_KEY,
  PRIMARY_KEY,
  createMemorySaveStore,
  loadLatestSave,
} from "../../persistence/indexedDbSaveStore";
import { runMigrations } from "../../persistence/migrations";
import {
  SAVE_VERSION,
  checksumOf,
  createEnvelope,
  normalizeGameState,
  validateEnvelope,
  verifyEnvelopeChecksum,
} from "../../persistence/saveSchema";
import {
  createMemoryLeaseStorage,
  createSingleWriterLease,
  LEASE_DURATION_MS,
} from "../../persistence/singleWriterLease";
import { describeImport, exportSave, parseImport } from "../../persistence/exportImport";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;

function freshEnvelope(revision = 1) {
  return createEnvelope(createGameState({ nowUnixMs: NOW, seed: 42 }), revision, NOW);
}

describe("save envelope", () => {
  it("round-trips through validation unchanged", () => {
    const envelope = freshEnvelope();
    const validation = validateEnvelope(JSON.parse(JSON.stringify(envelope)), NOW);

    expect(validation.ok).toBe(true);

    if (validation.ok) {
      expect(validation.envelope.game).toEqual(envelope.game);
      expect(validation.report.repairs).toEqual([]);
    }
  });

  it("rejects a tampered record", () => {
    const envelope = freshEnvelope();
    const tampered = {
      ...envelope,
      game: { ...envelope.game, resources: { ...envelope.game.resources, cash: 999_999 } },
    };

    expect(verifyEnvelopeChecksum(tampered).ok).toBe(false);
  });

  it("rejects a save from a newer build", () => {
    const envelope = freshEnvelope();
    const future = { ...envelope, saveVersion: SAVE_VERSION + 1 };

    expect(verifyEnvelopeChecksum(future).ok).toBe(false);
  });
});

describe("normalization", () => {
  it("rebuilds a fresh game from unusable data", () => {
    const { state, report } = normalizeGameState("not a save", NOW);

    expect(state.expedition.status).toBe("surface");
    expect(report.repairs.length).toBeGreaterThan(0);
  });

  it("clamps out-of-range numbers and drops unknown ids", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 1 });
    const raw = {
      ...base,
      resources: { ...base.resources, cash: -50, chips: Number.NaN },
      casino: {
        ...base.casino,
        machines: {
          ...base.casino.machines,
          "machine.alpha": {
            ...base.casino.machines["machine.alpha"],
            level: 99,
            researchRanks: { "research.alpha.overclock": 4, "research.removed": 2 },
            activeSpecId: "spec.removed",
          },
        },
      },
    };

    const { state, report } = normalizeGameState(raw, NOW);

    expect(state.resources.cash).toBe(0);
    expect(state.resources.chips).toBe(0);
    // Levels are uncapped now, so 99 is a legitimate level rather than something
    // to clamp back to a table's last row.
    expect(state.casino.machines["machine.alpha"].level).toBe(99);
    expect(state.casino.machines["machine.alpha"].researchRanks).toEqual({
      "research.alpha.overclock": 4,
    });
    expect(state.casino.machines["machine.alpha"].activeSpecId).toBeNull();
    expect(report.repairs.length).toBeGreaterThan(0);
  });

  it("seats only one copy of a trinket, since only one exists", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 1 });
    const raw = {
      ...base,
      collection: {
        ...base.collection,
        trinkets: {
          ...base.collection.trinkets,
          "trinket.bladder": { owned: true, tier: 1, fragments: 0 },
        },
      },
      gear: {
        ...base.gear,
        tankTrinketSlots: ["trinket.bladder", "trinket.bladder", null],
      },
    };

    const { state, report } = normalizeGameState(raw, NOW);

    expect(state.gear.tankTrinketSlots).toEqual(["trinket.bladder", null, null]);
    expect(report.repairs.some((note) => note.includes("only one exists"))).toBe(true);
  });

  it("unequips a trinket that is not owned or does not fit the gear", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 1 });
    const raw = {
      ...base,
      collection: {
        ...base.collection,
        trinkets: {
          ...base.collection.trinkets,
          "trinket.tungsten-head": { owned: true, tier: 1, fragments: 0 },
        },
      },
      gear: {
        ...base.gear,
        // Not owned, and a pickaxe trinket in a tank slot.
        tankTrinketSlots: ["trinket.bladder", "trinket.tungsten-head", null],
      },
    };

    const { state, report } = normalizeGameState(raw, NOW);

    expect(state.gear.tankTrinketSlots).toEqual([null, null, null]);
    expect(report.repairs.some((note) => note.includes("it is not owned"))).toBe(true);
    expect(report.repairs.some((note) => note.includes("does not fit"))).toBe(true);
  });

  it("snaps a stale settlement stamp forward to the save time", () => {
    // Saves written before the settlement stamp advanced per tick carry a stamp
    // from the start of that session. Trusting it would re-credit the session.
    const savedAt = NOW;
    const base = createGameState({ nowUnixMs: savedAt - 45 * 60_000, seed: 1 });

    const { state } = normalizeGameState(base, savedAt, { savedAtUnixMs: savedAt });

    expect(state.lastSettledAtUnixMs).toBe(savedAt);
  });

  it("keeps a fresh settlement stamp untouched", () => {
    const savedAt = NOW;
    const base = {
      ...createGameState({ nowUnixMs: savedAt, seed: 1 }),
      lastSettledAtUnixMs: savedAt - 5_000,
    };

    const { state } = normalizeGameState(base, savedAt, { savedAtUnixMs: savedAt });

    expect(state.lastSettledAtUnixMs).toBe(savedAt - 5_000);
  });

  it("refuses a settlement stamp that sits after the save", () => {
    const savedAt = NOW;
    const base = {
      ...createGameState({ nowUnixMs: savedAt, seed: 1 }),
      lastSettledAtUnixMs: savedAt + 60 * 60_000,
    };

    const { state } = normalizeGameState(base, savedAt, { savedAtUnixMs: savedAt });

    expect(state.lastSettledAtUnixMs).toBe(savedAt);
  });

  it("abandons an in-progress run whose random streams are missing", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 1 });
    const raw = {
      ...base,
      expedition: { ...base.expedition, status: "resolving", rngStreams: null },
    };

    const { state, report } = normalizeGameState(raw, NOW);

    expect(state.expedition.status).toBe("surface");
    expect(report.repairs.some((note) => note.includes("could not be resumed"))).toBe(true);
  });
});

describe("migrations", () => {
  it("upgrades a version 1 save to the current version", () => {
    const legacy = {
      saveVersion: 1,
      contentVersion: "0.1.0",
      revision: 4,
      savedAtUnixMs: NOW,
      game: {
        random: {
          gambling: createRngState(1, "gambling"),
          cacheRewards: createRngState(1, "cache-rewards"),
          nextExpeditionSeedCounter: 3,
        },
        prestige: { count: 1, lifetimeCashEarned: 500_000, purchasedPerkIds: [] },
      },
    };

    const migrated = runMigrations(legacy);
    const game = migrated.envelope.game as Record<string, unknown>;
    const random = game.random as Record<string, unknown>;
    const prestige = game.prestige as Record<string, unknown>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(1));
    expect(migrated.envelope.saveVersion).toBe(SAVE_VERSION);
    expect(random.expeditionSeeds).toBeDefined();
    expect(prestige.cycleCashEarned).toBe(500_000);
    expect(game.pity).toEqual({ encountersSinceRecipePiece: 0, encountersSinceRelic: 0 });
  });

  it("folds version 2 trinket counts into one entity plus fragments", () => {
    const legacy = {
      saveVersion: 2,
      contentVersion: "0.1.0",
      revision: 7,
      savedAtUnixMs: NOW,
      game: {
        gear: {
          tankLevel: 3,
          pickaxeLevel: 1,
          tankTrinketSlots: [{ trinketId: "trinket.bladder", tier: 2 }, null, null],
          pickaxeTrinketSlots: [null, null, null],
        },
        collection: {
          trinketCounts: {
            // One tier 2 kept, plus a spare tier 2 and two tier 1 as fragments.
            "trinket.bladder": { 1: 2, 2: 2, 3: 0 },
            "trinket.regulator": { 1: 0, 2: 0, 3: 0 },
          },
          totems: {
            "totem.prospector": { owned: true, rank: 2, duplicateProgress: 1 },
          },
        },
      },
    };

    const migrated = runMigrations(legacy);
    const game = migrated.envelope.game as Record<string, unknown>;
    const collection = game.collection as Record<string, unknown>;
    const trinkets = collection.trinkets as Record<string, Record<string, unknown>>;
    const totems = collection.totems as Record<string, Record<string, unknown>>;
    const gear = game.gear as Record<string, unknown>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(2));
    // The best copy is kept and everything spare becomes fragments, so no value
    // is lost across the change.
    //
    // The numbers are frozen literals, not `ECONOMY.trinketFragmentCosts`, for
    // the same reason the migration itself freezes them: a migration converts a
    // historical shape, so pinning it to the live curve would make this
    // assertion drift every time the curve is retuned. Version 2 was written
    // against [3, 6], so one tier-2 spare and two tier-1 spares fold to
    // 6 + 2 x 3 = 12 fragments. Version 4 triples that to 36 and version 5
    // divides it back by the same three, so 12 is what survives the full chain.
    expect(trinkets["trinket.bladder"]).toEqual({
      owned: true,
      grade: "D",
      fragments: 12,
    });
    expect(trinkets["trinket.regulator"]).toEqual({ owned: false, grade: "E", fragments: 0 });
    expect(totems["totem.prospector"]).toEqual({ owned: true, grade: "D", fragments: 1 });
    // Slots now carry only the id.
    expect(gear.tankTrinketSlots).toEqual(["trinket.bladder", null, null]);
  });

  it("regrades a version 3 save and preserves its fragment buying power", () => {
    const legacy = {
      saveVersion: 3,
      contentVersion: "0.1.0",
      revision: 9,
      savedAtUnixMs: NOW,
      game: {
        collection: {
          trinkets: {
            "trinket.bladder": { owned: true, tier: 3, fragments: 4 },
            "trinket.regulator": { owned: true, tier: 1, fragments: 0 },
            "trinket.ore-sieve": { owned: false, tier: 1, fragments: 0 },
          },
          totems: {
            "totem.prospector": { owned: true, rank: 2, fragments: 5 },
            "totem.anchor": { owned: false, rank: 0, fragments: 0 },
          },
        },
      },
    };

    const migrated = runMigrations(legacy);
    const collection = (migrated.envelope.game as Record<string, unknown>)
      .collection as Record<string, unknown>;
    const trinkets = collection.trinkets as Record<string, Record<string, unknown>>;
    const totems = collection.totems as Record<string, Record<string, unknown>>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(3));
    expect(migrated.envelope.saveVersion).toBe(SAVE_VERSION);

    // Tier 1/2/3 map to E/D/C. Even spacing would not do: grade C is +14s on the
    // bladder against tier 2's +18s, so it would have weakened people.
    expect(trinkets["trinket.bladder"].grade).toBe("C");
    expect(trinkets["trinket.regulator"].grade).toBe("E");
    expect(totems["totem.prospector"].grade).toBe("D");

    // Version 4 tripled fragments when a duplicate became worth three, and
    // version 5 divided them back when it returned to one. A version 3 balance
    // therefore arrives unchanged, which is the point: it is still worth the
    // same number of duplicate finds it always was.
    expect(trinkets["trinket.bladder"].fragments).toBe(4);
    expect(totems["totem.prospector"].fragments).toBe(5);

    // An unowned collectible stays unowned and sits at the bottom of the ladder.
    expect(trinkets["trinket.ore-sieve"]).toEqual({
      owned: false,
      grade: "E",
      fragments: 0,
    });
    expect(totems["totem.anchor"].owned).toBe(false);
  });

  it("returns fragments to a one-per-duplicate scale without shorting anyone", () => {
    const legacy = {
      saveVersion: 4,
      contentVersion: "0.1.0",
      revision: 11,
      savedAtUnixMs: NOW,
      game: {
        collection: {
          trinkets: {
            // Exactly four duplicates' worth at the old rate.
            "trinket.bladder": { owned: true, grade: "C", fragments: 12 },
            // Not a whole multiple: rounding must go up, never down, or a
            // player loses part of a find they already made.
            "trinket.regulator": { owned: true, grade: "E", fragments: 7 },
            "trinket.ore-sieve": { owned: false, grade: "E", fragments: 0 },
          },
          totems: {
            "totem.magpie": { owned: true, grade: "D", fragments: 1 },
          },
        },
      },
    };

    const migrated = runMigrations(legacy);
    const collection = (migrated.envelope.game as Record<string, unknown>)
      .collection as Record<string, unknown>;
    const trinkets = collection.trinkets as Record<string, Record<string, unknown>>;
    const totems = collection.totems as Record<string, Record<string, unknown>>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(4));
    expect(trinkets["trinket.bladder"].fragments).toBe(4);
    expect(trinkets["trinket.regulator"].fragments).toBe(3);
    expect(trinkets["trinket.ore-sieve"].fragments).toBe(0);
    expect(totems["totem.magpie"].fragments).toBe(1);

    // Grades are untouched by this step.
    expect(trinkets["trinket.bladder"].grade).toBe("C");
    expect(totems["totem.magpie"].grade).toBe("D");
  });

  it("carries a bought Gilded suit over to the Visitor", () => {
    /*
     * Renaming the sixth miner skin moves an id that is in the save. Without the
     * migration the failure is silent and expensive: `normalizeGameState`
     * filters `ownedMinerSkinIds` through `isMinerSkinId`, so an unrecognised id
     * is dropped rather than repaired or reported, and the purchase goes with it.
     */
    const legacy = {
      saveVersion: 15,
      contentVersion: "0.1.0",
      revision: 4,
      savedAtUnixMs: NOW,
      game: {
        collection: {
          ownedMinerSkinIds: ["miner.standard", "miner.gilded"],
          activeMinerSkinId: "miner.gilded",
        },
      },
    };

    const migrated = runMigrations(legacy);
    const collection = (migrated.envelope.game as Record<string, unknown>)
      .collection as Record<string, unknown>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(15));
    expect(collection.ownedMinerSkinIds).toEqual(["miner.standard", "miner.visitor"]);
    expect(collection.activeMinerSkinId).toBe("miner.visitor");

    // And it survives the normalizer, which is where the id would have been
    // dropped: owning it is what makes wearing it stick.
    const { state } = normalizeGameState(migrated.envelope.game, NOW);

    expect(state.collection.ownedMinerSkinIds).toContain("miner.visitor");
    expect(state.collection.activeMinerSkinId).toBe("miner.visitor");
  });

  it("leaves a save that never bought the sixth suit alone", () => {
    const legacy = {
      saveVersion: 15,
      contentVersion: "0.1.0",
      revision: 4,
      savedAtUnixMs: NOW,
      game: {
        collection: {
          ownedMinerSkinIds: ["miner.standard", "miner.veteran"],
          activeMinerSkinId: "miner.veteran",
        },
      },
    };

    const collection = (runMigrations(legacy).envelope.game as Record<string, unknown>)
      .collection as Record<string, unknown>;

    expect(collection.ownedMinerSkinIds).toEqual(["miner.standard", "miner.veteran"]);
    expect(collection.activeMinerSkinId).toBe("miner.veteran");
  });

  it("leaves a current save untouched", () => {
    const envelope = freshEnvelope();
    const migrated = runMigrations(JSON.parse(JSON.stringify(envelope)));

    expect(migrated.appliedVersions).toEqual([]);
    expect(checksumOf(migrated.envelope as never)).toBe(envelope.checksum);
  });
});

describe("save store", () => {
  it("keeps the previous valid record as a backup", async () => {
    const store = createMemorySaveStore();

    await store.write(freshEnvelope(1));
    await store.write(freshEnvelope(2));

    const primary = (await store.read(PRIMARY_KEY)) as { revision: number };
    const backup = (await store.read(BACKUP_KEY)) as { revision: number };

    expect(primary.revision).toBe(2);
    expect(backup.revision).toBe(1);
  });

  it("recovers from the backup when the primary is corrupt", async () => {
    const store = createMemorySaveStore();

    await store.write(freshEnvelope(1));
    await store.write(freshEnvelope(2));

    const corrupted = { ...(await store.read(PRIMARY_KEY) as object), checksum: "deadbeef" };
    await store.writeMetadata("unused", null);
    // Overwrite the primary directly, bypassing the backup rotation.
    (store as unknown as { read: unknown }).read = async (slot: string) =>
      slot === PRIMARY_KEY ? corrupted : freshEnvelope(1);

    const loaded = await loadLatestSave(store, NOW, () =>
      createGameState({ nowUnixMs: NOW }),
    );

    expect(loaded.source).toBe(BACKUP_KEY);
    expect(loaded.recoveredFromDamage).toBe(true);
    expect(loaded.envelope.revision).toBe(1);
  });

  it("starts a fresh game when nothing is stored", async () => {
    const store = createMemorySaveStore();
    const loaded = await loadLatestSave(store, NOW, () => createGameState({ nowUnixMs: NOW }));

    expect(loaded.source).toBe("fresh");
    expect(loaded.recoveredFromDamage).toBe(false);
  });
});

describe("export and import", () => {
  it("round-trips an exported save", () => {
    const envelope = freshEnvelope(7);
    const imported = parseImport(exportSave(envelope), NOW);

    expect(imported.ok).toBe(true);

    if (imported.ok) {
      expect(imported.envelope.revision).toBe(7);
      expect(imported.envelope.game).toEqual(envelope.game);
    }
  });

  it("rejects malformed and tampered files without touching stored data", () => {
    expect(parseImport("{ not json", NOW).ok).toBe(false);

    const envelope = freshEnvelope();
    const tampered = JSON.stringify({ ...envelope, revision: envelope.revision + 5 });

    expect(parseImport(tampered, NOW).ok).toBe(false);
  });

  it("describes an import for the confirmation copy", () => {
    expect(describeImport(freshEnvelope(3))).toContain("revision 3");
  });
});

describe("single-writer lease", () => {
  function pair() {
    const storage = createMemoryLeaseStorage();

    return {
      first: createSingleWriterLease({
        storage,
        ownerId: "tab-one",
        channelFactory: () => null,
      }),
      second: createSingleWriterLease({
        storage,
        ownerId: "tab-two",
        channelFactory: () => null,
      }),
    };
  }

  it("grants the first tab write access and holds the second as a reader", () => {
    const { first, second } = pair();

    expect(first.refresh(NOW)).toBe("writer");
    expect(second.refresh(NOW)).toBe("reader");
  });

  it("lets a second tab take over once the lease expires", () => {
    const { first, second } = pair();

    first.refresh(NOW);

    expect(second.refresh(NOW + LEASE_DURATION_MS + 1)).toBe("writer");
  });

  it("frees the lease on an explicit release", () => {
    const { first, second } = pair();

    first.refresh(NOW);
    first.release();

    expect(first.status()).toBe("reader");
    expect(second.refresh(NOW)).toBe("writer");
  });

  it("keeps renewing for the holder without interrupting it", () => {
    const { first, second } = pair();

    expect(first.refresh(NOW)).toBe("writer");
    expect(first.refresh(NOW + 1_000)).toBe("writer");
    expect(second.refresh(NOW + 1_000)).toBe("reader");
  });
});

/**
 * The jukebox's own save block (final features, chunk 1).
 *
 * Covered here rather than end to end, and the reason is in `shell.spec.ts`: an
 * unlocked jukebox needs a save 250 depths deep, which only a seeded fixture can
 * produce — and the e2e seed re-installs itself on every navigation, so a reload
 * there re-seeds the fixture over whatever the app wrote. That makes this the
 * only place the round-trip is actually observable.
 */
describe("the jukebox save block", () => {
  const deepSave = (jukebox: unknown, deepestDepth = ECONOMY.jukeboxUnlockDepth) => {
    const base = createGameState({ nowUnixMs: NOW, seed: 3 });

    return {
      ...base,
      statistics: { ...base.statistics, deepestDepth },
      settings: { ...base.settings, jukebox },
    };
  };

  it("keeps an earned choice across a load", () => {
    const { state } = normalizeGameState(
      deepSave({ enabled: true, trackId: "music.band.core" }),
      NOW,
    );

    expect(state.settings.jukebox).toEqual({ enabled: true, trackId: "music.band.core" });
  });

  it("switches off a jukebox the save never earned", () => {
    /*
     * The hand-edited-save case. `selectMusicTrackId` gates on the same
     * condition every time it reads, so nothing audible depends on this — but a
     * save that stores a state it is not entitled to is a save that will
     * eventually be trusted by something that does not re-check.
     */
    const { state } = normalizeGameState(
      deepSave({ enabled: true, trackId: "music.band.core" }, ECONOMY.jukeboxUnlockDepth - 1),
      NOW,
    );

    expect(state.settings.jukebox.enabled).toBe(false);
    // The choice itself is kept, so earning the unlock restores it rather than
    // resetting it.
    expect(state.settings.jukebox.trackId).toBe("music.band.core");
  });

  it("repairs a track this build no longer ships, and says so", () => {
    const { state, report } = normalizeGameState(
      deepSave({ enabled: true, trackId: "music.band.retired" }),
      NOW,
    );

    expect(state.settings.jukebox.trackId).toBe("music.casino");
    expect(report.repairs.some((repair) => repair.includes("jukebox"))).toBe(true);
  });

  it("defaults a save written before the jukebox existed", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 4 });
    const { settings, ...withoutJukebox } = base;
    const raw = {
      ...withoutJukebox,
      settings: Object.fromEntries(
        Object.entries(settings).filter(([key]) => key !== "jukebox"),
      ),
    };

    const { state } = normalizeGameState(raw, NOW);

    // Off, and pointed at the track such a save was already hearing. No
    // migration: the reader builds the block from what it recognises.
    expect(state.settings.jukebox).toEqual({ enabled: false, trackId: "music.casino" });
  });

  it("survives a full envelope round-trip", () => {
    const envelope = createEnvelope(
      normalizeGameState(deepSave({ enabled: true, trackId: "music.band.hollow" }), NOW).state,
      1,
      NOW,
    );

    expect(verifyEnvelopeChecksum(envelope).ok).toBe(true);

    const { state } = normalizeGameState(JSON.parse(JSON.stringify(envelope.game)), NOW);

    expect(state.settings.jukebox).toEqual({ enabled: true, trackId: "music.band.hollow" });
  });
});

/**
 * The tutorial's save block (final features, chunk 3).
 *
 * The interesting case is the save that predates the feature. Defaulting a
 * missing block to `running` would start the tutorial mid-game on every existing
 * save, which is worse than not shipping one — so the reader asks whether the
 * save has been played, and only an untouched one starts the script.
 */
describe("the tutorial save block", () => {
  it("starts the script on a save that has never been played", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 11 });
    const { tutorial: _dropped, ...onboarding } = base.onboarding;
    const { state } = normalizeGameState({ ...base, onboarding }, NOW);

    expect(state.onboarding.tutorial.status).toBe("running");
  });

  it("treats a save with play behind it as finished", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 12 });
    const { tutorial: _dropped, ...onboarding } = base.onboarding;
    const played = {
      ...base,
      onboarding,
      statistics: { ...base.statistics, playTimeMs: 60_000 },
    };

    expect(normalizeGameState(played, NOW).state.onboarding.tutorial.status).toBe("finished");

    // Runs launched counts as play too, for a save that was closed quickly.
    const launched = {
      ...base,
      onboarding,
      statistics: { ...base.statistics, runsLaunched: 1 },
    };

    expect(normalizeGameState(launched, NOW).state.onboarding.tutorial.status).toBe("finished");
  });

  it("round-trips an act in progress", () => {
    const base = createGameState({ nowUnixMs: NOW, seed: 13 });
    const saved = {
      ...base,
      onboarding: {
        ...base.onboarding,
        tutorial: {
          status: "running" as const,
          activeActId: TUTORIAL_ACTS[0].id,
          stepIndex: 1,
          completedActIds: [],
          latchedGateIds: ["gate.chips-held" as const],
          dismissedStepId: null,
        },
      },
    };

    const { state } = normalizeGameState(JSON.parse(JSON.stringify(saved)), NOW);

    expect(state.onboarding.tutorial).toEqual(saved.onboarding.tutorial);
  });

  it("drops an act or a gate this build no longer ships", () => {
    /*
     * A script edit must not strand a save on a step that is gone. The act is
     * dropped and the step index goes with it, so the engine simply opens
     * whatever is next rather than reading `steps[4]` of a three-step act.
     */
    const base = createGameState({ nowUnixMs: NOW, seed: 14 });
    const saved = {
      ...base,
      onboarding: {
        ...base.onboarding,
        tutorial: {
          status: "running",
          activeActId: "act.retired",
          stepIndex: 7,
          completedActIds: ["act.retired", TUTORIAL_ACTS[0].id],
          latchedGateIds: ["gate.chips-held", "gate.retired"],
        },
      },
    };

    const { state } = normalizeGameState(saved, NOW);

    expect(state.onboarding.tutorial.activeActId).toBeNull();
    expect(state.onboarding.tutorial.stepIndex).toBe(0);
    expect(state.onboarding.tutorial.completedActIds).toEqual([TUTORIAL_ACTS[0].id]);
    expect(state.onboarding.tutorial.latchedGateIds).toEqual(["gate.chips-held"]);
  });
});
