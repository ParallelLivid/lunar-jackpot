/**
 * The inline feedback queue. Messages expire on their own so the strip never
 * accumulates, and repeats collapse into a count rather than stacking. Pure and
 * free of React so the expiry rules can be tested directly.
 */

import { ECONOMY } from "../content/catalog";
import type { ResolvedGrant } from "../domain/state";

export type FeedbackTone = "positive" | "negative" | "neutral";

export interface FeedbackMessage {
  id: number;
  tone: FeedbackTone;
  text: string;
  /** Repeats of the same message collapse into this count. */
  count: number;
  createdAtMs: number;
  expiresAtMs: number;
}

export function feedbackLifetimeMs(tone: FeedbackTone): number {
  return tone === "negative"
    ? ECONOMY.feedbackErrorDurationMs
    : ECONOMY.feedbackDurationMs;
}

export interface AppendResult {
  messages: FeedbackMessage[];
  nextId: number;
}

/**
 * Adds a message, collapsing it into the newest entry when that entry says the
 * same thing. Collapsing refreshes the expiry so a burst stays readable.
 */
export function appendFeedback(
  messages: readonly FeedbackMessage[],
  entry: { tone: FeedbackTone; text: string },
  nowMs: number,
  nextId: number,
): AppendResult {
  const lifetime = feedbackLifetimeMs(entry.tone);
  const newest = messages[messages.length - 1];

  if (newest !== undefined && newest.text === entry.text && newest.tone === entry.tone) {
    const collapsed: FeedbackMessage = {
      ...newest,
      count: newest.count + 1,
      expiresAtMs: nowMs + lifetime,
    };

    return {
      messages: [...messages.slice(0, -1), collapsed],
      nextId,
    };
  }

  const message: FeedbackMessage = {
    id: nextId,
    tone: entry.tone,
    text: entry.text,
    count: 1,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + lifetime,
  };

  return {
    messages: [...messages, message].slice(-ECONOMY.feedbackMaxVisible),
    nextId: nextId + 1,
  };
}

export function pruneFeedback(
  messages: readonly FeedbackMessage[],
  nowMs: number,
): FeedbackMessage[] {
  return messages.filter((message) => message.expiresAtMs > nowMs);
}

/** True when pruning would change the list, so the runtime can skip a publish. */
export function hasExpired(messages: readonly FeedbackMessage[], nowMs: number): boolean {
  return messages.some((message) => message.expiresAtMs <= nowMs);
}

export interface LogEntry {
  id: number;
  tone: FeedbackTone;
  text: string;
  /** Repeats collapse rather than filling the log with the same line. */
  count: number;
  /** Formatted once on arrival, so the list never re-renders on the clock. */
  time: string;
}

/** Appends to the log, collapsing an immediate repeat into a count. */
export function appendLogEntry(
  log: readonly LogEntry[],
  entry: { tone: FeedbackTone; text: string },
  nowMs: number,
  nextId: number,
): { log: LogEntry[]; nextId: number } {
  const newest = log[0];

  if (newest !== undefined && newest.text === entry.text && newest.tone === entry.tone) {
    return {
      log: [{ ...newest, count: newest.count + 1 }, ...log.slice(1)],
      nextId,
    };
  }

  const created: LogEntry = {
    id: nextId,
    tone: entry.tone,
    text: entry.text,
    count: 1,
    time: new Date(nowMs).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  return {
    log: [created, ...log].slice(0, ECONOMY.logMaxEntries),
    nextId: nextId + 1,
  };
}

/**
 * A floating indicator over the expedition scene reporting what an encounter
 * just paid, or what an option charged up front.
 */
export interface RewardPop {
  id: number;
  grants: ResolvedGrant[];
  oxygenDelta: number;
  createdAtMs: number;
  expiresAtMs: number;
}

export function appendRewardPop(
  pops: readonly RewardPop[],
  entry: { grants: ResolvedGrant[]; oxygenDelta: number },
  nowMs: number,
  nextId: number,
): { pops: RewardPop[]; nextId: number } {
  return {
    pops: [
      ...pops,
      {
        id: nextId,
        grants: entry.grants,
        oxygenDelta: entry.oxygenDelta,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + ECONOMY.rewardPopDurationMs,
      },
    ].slice(-4),
    nextId: nextId + 1,
  };
}

export function pruneRewardPops(pops: readonly RewardPop[], nowMs: number): RewardPop[] {
  return pops.filter((pop) => pop.expiresAtMs > nowMs);
}

/**
 * A critical strike landing, over the encounter that took it. Kept in its own
 * lane so a burst of crits cannot evict the reward pops, which report actual
 * gains.
 */
export interface CriticalPop {
  id: number;
  count: number;
  damage: number;
  createdAtMs: number;
  expiresAtMs: number;
}

export function appendCriticalPop(
  pops: readonly CriticalPop[],
  entry: { count: number; damage: number },
  nowMs: number,
  nextId: number,
): { pops: CriticalPop[]; nextId: number } {
  return {
    pops: [
      ...pops,
      {
        id: nextId,
        count: entry.count,
        damage: entry.damage,
        createdAtMs: nowMs,
        // Shorter than a reward pop so crits do not pile up at high strike rates.
        expiresAtMs: nowMs + ECONOMY.criticalPopDurationMs,
      },
    ].slice(-3),
    nextId: nextId + 1,
  };
}

export function pruneCriticalPops(pops: readonly CriticalPop[], nowMs: number): CriticalPop[] {
  return pops.filter((pop) => pop.expiresAtMs > nowMs);
}

/**
 * An encounter dissolving after it finished. Held separately from the scene
 * because the animation outlives the state that caused it; only one is kept,
 * since two encounters cannot finish at once.
 */
export interface EncounterDissolve {
  id: number;
  spriteId: string;
  startedAtMs: number;
  endsAtMs: number;
}

export function startDissolve(
  spriteId: string,
  nowMs: number,
  nextId: number,
): { dissolve: EncounterDissolve; nextId: number } {
  return {
    dissolve: {
      id: nextId,
      spriteId,
      startedAtMs: nowMs,
      endsAtMs: nowMs + ECONOMY.encounterDissolveMs,
    },
    nextId: nextId + 1,
  };
}

export function pruneDissolve(
  dissolve: EncounterDissolve | null,
  nowMs: number,
): EncounterDissolve | null {
  return dissolve !== null && dissolve.endsAtMs > nowMs ? dissolve : null;
}
