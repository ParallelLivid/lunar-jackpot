/**
 * IndexedDB save store with a primary record, a backup, and a metadata store.
 *
 * A write copies the current valid primary into the backup and writes the new
 * primary inside one transaction, so an interrupted write can never destroy
 * both records.
 */

import { runMigrations, type RawEnvelope } from "./migrations";
import {
  SAVE_VERSION,
  createEnvelope,
  validateEnvelope,
  verifyEnvelopeChecksum,
  type SaveEnvelope,
} from "./saveSchema";
import type { GameState } from "../domain/state";

export const DATABASE_NAME = "lunar-jackpot";
export const DATABASE_VERSION = 1;

export const SAVE_STORE = "saves";
export const METADATA_STORE = "metadata";

export const PRIMARY_KEY = "primary";
export const BACKUP_KEY = "backup";

export type SaveSlot = typeof PRIMARY_KEY | typeof BACKUP_KEY;

export interface SaveStore {
  read(slot: SaveSlot): Promise<unknown>;
  write(envelope: SaveEnvelope): Promise<void>;
  readMetadata<T>(key: string): Promise<T | undefined>;
  writeMetadata(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export class SaveStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveStoreUnavailableError";
  }
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => {
      resolve(source.result);
    };
    source.onerror = () => {
      reject(source.error ?? new Error("IndexedDB request failed."));
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new SaveStoreUnavailableError("This browser has no IndexedDB support."));

      return;
    }

    const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    open.onupgradeneeded = () => {
      const database = open.result;

      if (!database.objectStoreNames.contains(SAVE_STORE)) {
        database.createObjectStore(SAVE_STORE);
      }

      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE);
      }
    };

    open.onsuccess = () => {
      resolve(open.result);
    };
    open.onerror = () => {
      reject(open.error ?? new SaveStoreUnavailableError("IndexedDB could not be opened."));
    };
    open.onblocked = () => {
      reject(new SaveStoreUnavailableError("Another tab is blocking the database upgrade."));
    };
  });
}

export async function createIndexedDbSaveStore(): Promise<SaveStore> {
  const database = await openDatabase();

  return {
    async read(slot) {
      const transaction = database.transaction(SAVE_STORE, "readonly");

      return request(transaction.objectStore(SAVE_STORE).get(slot));
    },

    async write(envelope) {
      const transaction = database.transaction(SAVE_STORE, "readwrite");
      const store = transaction.objectStore(SAVE_STORE);
      const existing = await request(store.get(PRIMARY_KEY));

      // Only a record that still verifies is worth keeping as the backup.
      if (existing !== undefined && verifyEnvelopeChecksum(existing).ok) {
        store.put(existing, BACKUP_KEY);
      }

      store.put(envelope, PRIMARY_KEY);

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error("The save transaction failed."));
        };
        transaction.onabort = () => {
          reject(transaction.error ?? new Error("The save transaction was aborted."));
        };
      });
    },

    async readMetadata<T>(key: string) {
      const transaction = database.transaction(METADATA_STORE, "readonly");

      return (await request(transaction.objectStore(METADATA_STORE).get(key))) as T | undefined;
    },

    async writeMetadata(key, value) {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      transaction.objectStore(METADATA_STORE).put(value, key);

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error("The metadata transaction failed."));
        };
      });
    },

    async clear() {
      const transaction = database.transaction(SAVE_STORE, "readwrite");
      transaction.objectStore(SAVE_STORE).clear();

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error("Clearing the save store failed."));
        };
      });
    },

    close() {
      database.close();
    },
  };
}

/** An in-memory store used by tests and as a fallback when IndexedDB is absent. */
export function createMemorySaveStore(): SaveStore {
  const saves = new Map<string, unknown>();
  const metadata = new Map<string, unknown>();

  return {
    async read(slot) {
      return saves.get(slot);
    },
    async write(envelope) {
      const existing = saves.get(PRIMARY_KEY);

      if (existing !== undefined && verifyEnvelopeChecksum(existing).ok) {
        saves.set(BACKUP_KEY, existing);
      }

      /*
       * `structuredClone`, not a JSON round trip: IndexedDB stores by
       * structured clone, and a JSON round trip would drop the `Infinity` a
       * rolled-over balance holds — making this double behave unlike the store
       * it stands in for, in exactly the case worth testing.
       */
      saves.set(PRIMARY_KEY, structuredClone(envelope) as unknown);
    },
    async readMetadata<T>(key: string) {
      return metadata.get(key) as T | undefined;
    },
    async writeMetadata(key, value) {
      metadata.set(key, value);
    },
    async clear() {
      saves.clear();
    },
    close() {
      // Nothing to release.
    },
  };
}

export type LoadSource = "primary" | "backup" | "fresh";

export interface LoadResult {
  envelope: SaveEnvelope;
  source: LoadSource;
  /** Notes about repaired fields and applied migrations, for the save panel. */
  notices: string[];
  /** True when neither record was usable but at least one record existed. */
  recoveredFromDamage: boolean;
}

/**
 * Reads the primary record, falling back to the backup, then to a fresh game.
 * Neither stored record is overwritten while recovery is being decided.
 */
export async function loadLatestSave(
  store: SaveStore,
  nowUnixMs: number,
  createFresh: () => GameState,
): Promise<LoadResult> {
  const notices: string[] = [];
  let sawDamagedRecord = false;

  for (const slot of [PRIMARY_KEY, BACKUP_KEY] as const) {
    let raw: unknown;

    try {
      raw = await store.read(slot);
    } catch (error) {
      notices.push(`The ${slot} save could not be read: ${String(error)}`);
      continue;
    }

    if (raw === undefined) {
      continue;
    }

    // The checksum covers the stored body, so it must be checked before any
    // migration rewrites that body.
    const verified = verifyEnvelopeChecksum(raw);

    if (!verified.ok) {
      sawDamagedRecord = true;
      notices.push(`The ${slot} save was rejected: ${verified.reason}`);
      continue;
    }

    const migrated = runMigrations(raw as RawEnvelope);

    if (migrated.appliedVersions.length > 0) {
      notices.push(
        `Migrated the ${slot} save from version ${migrated.appliedVersions[0]} to version ${SAVE_VERSION}.`,
      );
    }

    const validation = validateEnvelope(migrated.envelope, nowUnixMs, { verifyChecksum: false });

    if (!validation.ok) {
      sawDamagedRecord = true;
      notices.push(`The ${slot} save was rejected: ${validation.reason}`);
      continue;
    }

    notices.push(...validation.report.repairs);

    return {
      envelope: validation.envelope,
      source: slot,
      notices,
      recoveredFromDamage: slot === BACKUP_KEY,
    };
  }

  return {
    envelope: createEnvelope(createFresh(), 0, nowUnixMs),
    source: "fresh",
    notices,
    recoveredFromDamage: sawDamagedRecord,
  };
}
