/**
 * Single-writer lease.
 *
 * Only one tab may dispatch material commands or write saves. A second tab
 * shows a read-only notice and may take control only once the holder's lease
 * expires or is explicitly released. This is what stops two tabs from awarding
 * offline cash twice or racing save revisions.
 *
 * The lease lives in `localStorage` rather than the IndexedDB metadata store
 * because it must be readable and writable synchronously: a tab closing or
 * reloading has to release the lease inside its `pagehide` handler, and an
 * asynchronous IndexedDB write is not guaranteed to complete there. A tab that
 * cannot reach `localStorage` still works; it simply falls back to an in-memory
 * lease that only guards its own session.
 */

export const LEASE_KEY = "lunar-jackpot:writer-lease";
export const LEASE_CHANNEL = "lunar-jackpot-writer";

export const LEASE_DURATION_MS = 6_000;
export const LEASE_RENEW_INTERVAL_MS = 2_000;

export interface LeaseRecord {
  ownerId: string;
  expiresAtUnixMs: number;
}

export type LeaseStatus = "writer" | "reader";

/** Synchronous storage for the lease record. */
export interface LeaseStorage {
  read(): LeaseRecord | null;
  write(record: LeaseRecord): void;
  clear(): void;
}

export interface LeaseHandle {
  readonly ownerId: string;
  status(): LeaseStatus;
  /** Acquires or renews the lease and returns the resulting status. */
  refresh(nowUnixMs: number): LeaseStatus;
  release(): void;
  onStatusChange(listener: (status: LeaseStatus) => void): () => void;
  stop(): void;
}

function isLeaseRecord(value: unknown): value is LeaseRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LeaseRecord).ownerId === "string" &&
    typeof (value as LeaseRecord).expiresAtUnixMs === "number" &&
    Number.isFinite((value as LeaseRecord).expiresAtUnixMs)
  );
}

export function createMemoryLeaseStorage(): LeaseStorage {
  let record: LeaseRecord | null = null;

  return {
    read: () => record,
    write: (next) => {
      record = next;
    },
    clear: () => {
      record = null;
    },
  };
}

/** Returns null when `localStorage` is unavailable or blocked. */
export function createLocalStorageLeaseStorage(key = LEASE_KEY): LeaseStorage | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }

    // Some privacy modes expose the object but throw on write.
    localStorage.setItem(`${key}:probe`, "1");
    localStorage.removeItem(`${key}:probe`);
  } catch {
    return null;
  }

  return {
    read() {
      try {
        const raw = localStorage.getItem(key);

        if (raw === null) {
          return null;
        }

        const parsed: unknown = JSON.parse(raw);

        return isLeaseRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    write(record) {
      try {
        localStorage.setItem(key, JSON.stringify(record));
      } catch {
        // A failed write simply means the lease cannot be shared across tabs.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing further to do.
      }
    },
  };
}

export function createLeaseStorage(): LeaseStorage {
  return createLocalStorageLeaseStorage() ?? createMemoryLeaseStorage();
}

export interface CreateLeaseOptions {
  storage: LeaseStorage;
  /** Injected so tests can run without a BroadcastChannel implementation. */
  channelFactory?: () => BroadcastChannel | null;
  ownerId?: string;
}

function createOwnerId(): string {
  const random = Math.floor(Math.random() * 0xffff_ffff).toString(16);

  return `tab-${Date.now().toString(36)}-${random}`;
}

function defaultChannelFactory(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }

  return new BroadcastChannel(LEASE_CHANNEL);
}

export function createSingleWriterLease(options: CreateLeaseOptions): LeaseHandle {
  const ownerId = options.ownerId ?? createOwnerId();
  const channel = (options.channelFactory ?? defaultChannelFactory)();
  const listeners = new Set<(status: LeaseStatus) => void>();

  let status: LeaseStatus = "reader";
  let stopped = false;

  const setStatus = (next: LeaseStatus): void => {
    if (next === status) {
      return;
    }

    status = next;

    for (const listener of listeners) {
      listener(status);
    }
  };

  if (channel !== null) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;

      if (
        typeof message === "object" &&
        message !== null &&
        (message as { type?: string }).type === "release" &&
        (message as { ownerId?: string }).ownerId !== ownerId &&
        status === "reader"
      ) {
        // The holder stepped down; try to take over without waiting for the
        // next renewal tick.
        handle.refresh(Date.now());
      }
    };
  }

  const handle: LeaseHandle = {
    ownerId,

    status() {
      return status;
    },

    refresh(nowUnixMs) {
      if (stopped) {
        return status;
      }

      const held = options.storage.read();
      const mine = held !== null && held.ownerId === ownerId;
      const expired = held === null || held.expiresAtUnixMs <= nowUnixMs;

      if (!mine && !expired) {
        setStatus("reader");

        return status;
      }

      options.storage.write({ ownerId, expiresAtUnixMs: nowUnixMs + LEASE_DURATION_MS });

      if (!mine) {
        channel?.postMessage({ type: "claim", ownerId });
      }

      setStatus("writer");

      return status;
    },

    release() {
      const held = options.storage.read();

      if (held !== null && held.ownerId === ownerId) {
        options.storage.clear();
        channel?.postMessage({ type: "release", ownerId });
      }

      setStatus("reader");
    },

    onStatusChange(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    stop() {
      stopped = true;
      listeners.clear();
      channel?.close();
    },
  };

  return handle;
}
