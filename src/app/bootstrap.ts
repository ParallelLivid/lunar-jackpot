/**
 * Application startup: validate content, acquire the writer lease, load and
 * migrate the save, settle offline cash once, mount the dashboard, then start
 * the clock and autosave. Failed content validation leaves storage untouched.
 */

import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CONTENT_VERSION, ECONOMY } from "../content/catalog";
import { validateContent } from "../content/validateContent";
import { createAudioManager, type AudioManager } from "../audio/audioManager";
import { createMusicEngine, type MusicEngine } from "../audio/musicEngine";
import type { DomainEffect, GameCommand, RunSummary } from "../domain/commands";
import type { CacheOpenBatch } from "../domain/collections";
import { settleOfflineProduction, type OfflineSettlement } from "../domain/offline";
import { selectMusicTrackId } from "../domain/selectors";
import { createGameState, type GameState, type SpinSummary } from "../domain/state";
import {
  createIndexedDbSaveStore,
  createMemorySaveStore,
  loadLatestSave,
  type SaveStore,
} from "../persistence/indexedDbSaveStore";
import {
  describeImport,
  exportGameState,
  parseImport,
  EXPORT_FILE_NAME,
  EXPORT_MIME_TYPE,
} from "../persistence/exportImport";
import { createEnvelope } from "../persistence/saveSchema";
import {
  createLeaseStorage,
  createSingleWriterLease,
  LEASE_RENEW_INTERVAL_MS,
  type LeaseHandle,
  type LeaseStatus,
} from "../persistence/singleWriterLease";
import { GameApp } from "./GameApp";
import { createCommandQueue, type CommandQueue } from "./commandQueue";
import {
  appendCriticalPop,
  appendFeedback,
  appendLogEntry,
  appendRewardPop,
  hasExpired,
  pruneCriticalPops,
  pruneFeedback,
  pruneRewardPops,
  startDissolve,
  type CriticalPop,
  type EncounterDissolve,
  type FeedbackMessage,
  type FeedbackTone,
  type LogEntry,
  type RewardPop,
} from "./feedback";
import { startRuntimeClock, type RuntimeClock } from "./runtimeClock";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export type { FeedbackMessage, FeedbackTone, LogEntry, RewardPop } from "./feedback";

export interface RuntimeStatus {
  leaseStatus: LeaseStatus;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAtUnixMs: number | null;
  revision: number;
  bootNotices: string[];
  feedback: FeedbackMessage[];
  /** Running history, newest first. Session-only; never saved. */
  log: LogEntry[];
  /** Floating gain indicators over the expedition scene. */
  rewardPops: RewardPop[];
  /** Critical-strike indicators, on their own lane so they cannot evict a reward. */
  criticalPops: CriticalPop[];
  /** The encounter currently dissolving, if one just finished. */
  encounterDissolve: EncounterDissolve | null;
  welcomeBack: OfflineSettlement | null;
  runSummary: RunSummary | null;
  /** What the last opened caches produced, until the player dismisses them. */
  cacheResults: CacheOpenBatch | null;
  spinResult: SpinSummary | null;
  contentIssues: string[] | null;
  /**
   * Bumped whenever the rail windows should be taken down. A counter rather
   * than a flag or timestamp, because two closes can land in the same tick.
   */
  windowsClosedAt: number;
}

export interface ImportOutcome {
  ok: boolean;
  message: string;
}

export interface GameRuntime {
  getState(): GameState;
  subscribe(listener: (state: GameState) => void): () => void;
  dispatch(command: GameCommand): void;
  getStatus(): RuntimeStatus;
  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void;
  /** Called from the first user gesture so the audio context may start. */
  unlockAudio(): void;
  dismissWelcomeBack(): void;
  dismissRunSummary(): void;
  dismissCacheResults(): void;
  dismissSpinResult(): void;
  saveNow(): Promise<void>;
  exportSave(): { text: string; fileName: string; mimeType: string };
  importSave(text: string): Promise<ImportOutcome>;
  resetSave(): Promise<void>;
  stop(): void;
}

async function openStore(notices: string[]): Promise<SaveStore> {
  try {
    return await createIndexedDbSaveStore();
  } catch (error) {
    notices.push(
      `Saving to this browser is unavailable, so progress will not persist: ${String(error)}`,
    );

    return createMemorySaveStore();
  }
}

interface RuntimeDependencies {
  store: SaveStore;
  lease: LeaseHandle;
  initialState: GameState;
  revision: number;
  bootNotices: string[];
  welcomeBack: OfflineSettlement | null;
  audio: AudioManager;
  now: () => number;
}

function createRuntime(dependencies: RuntimeDependencies): GameRuntime {
  const statusListeners = new Set<(status: RuntimeStatus) => void>();

  let feedbackCounter = 0;
  let logCounter = 0;
  let rewardPopCounter = 0;
  let criticalPopCounter = 0;
  let dissolveCounter = 0;
  let revision = dependencies.revision;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let activeSave: Promise<void> | null = null;
  let replacingSave = false;
  let reloadingForLease = false;
  const canWrite = (): boolean =>
    !reloadingForLease && !replacingSave && dependencies.lease.status() === "writer";
  let clock: RuntimeClock | null = null;
  let music: MusicEngine | null = null;
  let leaseTimer: ReturnType<typeof setInterval> | null = null;

  let status: RuntimeStatus = {
    leaseStatus: dependencies.lease.status(),
    saveState: "idle",
    saveError: null,
    lastSavedAtUnixMs: null,
    revision,
    bootNotices: dependencies.bootNotices,
    feedback: [],
    log: [],
    rewardPops: [],
    criticalPops: [],
    encounterDissolve: null,
    welcomeBack: dependencies.welcomeBack,
    runSummary: null,
    cacheResults: null,
    spinResult: null,
    contentIssues: null,
    windowsClosedAt: 0,
  };

  const publishStatus = (patch: Partial<RuntimeStatus>): void => {
    status = { ...status, ...patch };

    for (const listener of statusListeners) {
      listener(status);
    }
  };

  /**
   * Asks the dashboard to take the rail windows down. Called by the prestige
   * `CLOSE_WINDOWS` effect and by the reset, both of which leave open windows
   * describing a save that no longer exists.
   */
  const closeWindows = (): void => {
    publishStatus({ windowsClosedAt: status.windowsClosedAt + 1 });
  };

  const pushFeedback = (tone: FeedbackTone, text: string): void => {
    const nowMs = Date.now();
    const appended = appendFeedback(
      pruneFeedback(status.feedback, nowMs),
      { tone, text },
      nowMs,
      feedbackCounter,
    );
    const logged = appendLogEntry(status.log, { tone, text }, nowMs, logCounter);

    feedbackCounter = appended.nextId;
    logCounter = logged.nextId;
    publishStatus({ feedback: appended.messages, log: logged.log });
  };

  // Expired messages are swept on a single timer rather than one per message,
  // and the status is only republished when the list actually changes.
  const feedbackTimer = setInterval(() => {
    const nowMs = Date.now();
    const patch: Partial<RuntimeStatus> = {};

    if (hasExpired(status.feedback, nowMs)) {
      patch.feedback = pruneFeedback(status.feedback, nowMs);
    }

    if (status.rewardPops.some((pop) => pop.expiresAtMs <= nowMs)) {
      patch.rewardPops = pruneRewardPops(status.rewardPops, nowMs);
    }

    if (status.criticalPops.some((pop) => pop.expiresAtMs <= nowMs)) {
      patch.criticalPops = pruneCriticalPops(status.criticalPops, nowMs);
    }

    if (status.encounterDissolve !== null && status.encounterDissolve.endsAtMs <= nowMs) {
      patch.encounterDissolve = null;
    }

    if (Object.keys(patch).length > 0) {
      publishStatus(patch);
    }
  }, 250);

  const writeSave = (): Promise<void> => {
    if (activeSave !== null) {
      return activeSave;
    }
    if (!canWrite()) {
      return Promise.resolve();
    }

    dirty = false;
    publishStatus({ saveState: "saving" });

    activeSave = (async () => {
      try {
        revision += 1;
        const savedAtUnixMs = Date.now();
        const state = queue.getState();
        await dependencies.store.write(createEnvelope(state, revision, savedAtUnixMs));
        publishStatus({
          saveState: "saved",
          saveError: null,
          lastSavedAtUnixMs: savedAtUnixMs,
          revision,
        });
      } catch (error) {
        // The write failed, so the state is still unsaved.
        dirty = true;
        publishStatus({ saveState: "error", saveError: String(error) });
      }
    })().finally(() => {
      activeSave = null;
    });
    return activeSave;
  };

  const replaceSavedGame = async (game: GameState): Promise<void> => {
    replacingSave = true;
    try {
      // Finish any autosave, then preserve the current state before replacing
      // it. Keep commands paused until storage accepts the replacement.
      await activeSave;
      if (reloadingForLease || dependencies.lease.status() !== "writer") {
        throw new Error("This tab no longer controls the save.");
      }
      await dependencies.store.write(createEnvelope(queue.getState(), ++revision, Date.now()));
      const savedAtUnixMs = Date.now();
      await dependencies.store.write(createEnvelope(game, ++revision, savedAtUnixMs));
      queue.replaceState(game);
      dirty = false;
      publishStatus({ revision, saveState: "saved", saveError: null, lastSavedAtUnixMs: savedAtUnixMs });
    } catch (error) {
      publishStatus({ saveState: "error", saveError: String(error) });
      throw error;
    } finally {
      replacingSave = false;
    }
  };

  const scheduleSave = (immediate: boolean): void => {
    dirty = true;
    publishStatus({ saveState: "pending" });

    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (immediate) {
      void writeSave();

      return;
    }

    saveTimer = setTimeout(() => {
      saveTimer = null;
      void writeSave();
    }, ECONOMY.autosaveDebounceMs);
  };

  const handleEffects = (effects: DomainEffect[]): void => {
    let immediateSave = false;
    let requestedSave = false;

    for (const effect of effects) {
      switch (effect.type) {
        case "PLAY_SOUND":
          dependencies.audio.play(effect.soundId, queue.getState().settings);
          break;
        case "SHOW_FEEDBACK":
          pushFeedback(effect.tone, effect.message);
          break;
        case "COMMAND_REJECTED":
          pushFeedback("negative", effect.message);
          break;
        case "SHOW_RUN_SUMMARY":
          publishStatus({ runSummary: effect.summary });
          pushFeedback(
            effect.summary.outcome === "returned" ? "positive" : "negative",
            effect.summary.outcome === "returned"
              ? `Returned from depth ${effect.summary.depth} with ${effect.summary.chipsFromOre} chips of ore.`
              : `Oxygen ran out at depth ${effect.summary.depth}. Recovered what survived the roll.`,
          );
          break;

        case "SHOW_CACHE_RESULTS":
          publishStatus({ cacheResults: effect.batch });
          break;
        case "CLEAR_RUN_SUMMARY":
          publishStatus({ runSummary: null });
          break;
        case "CLOSE_WINDOWS":
          closeWindows();
          break;
        case "SHOW_SPIN_RESULT":
          publishStatus({ spinResult: effect.summary });
          break;
        case "SHOW_ENCOUNTER_REWARD": {
          const nowMs = Date.now();
          const appended = appendRewardPop(
            pruneRewardPops(status.rewardPops, nowMs),
            { grants: effect.grants, oxygenDelta: effect.oxygenDelta },
            nowMs,
            rewardPopCounter,
          );

          rewardPopCounter = appended.nextId;
          publishStatus({ rewardPops: appended.pops });
          break;
        }
        case "SHOW_CRITICAL_STRIKE": {
          const nowMs = Date.now();
          const appended = appendCriticalPop(
            pruneCriticalPops(status.criticalPops, nowMs),
            { count: effect.count, damage: effect.damage },
            nowMs,
            criticalPopCounter,
          );

          criticalPopCounter = appended.nextId;
          publishStatus({ criticalPops: appended.pops });
          break;
        }
        case "SHOW_ENCOUNTER_COMPLETE": {
          const started = startDissolve(effect.spriteId, Date.now(), dissolveCounter);

          dissolveCounter = started.nextId;
          publishStatus({ encounterDissolve: started.dissolve });
          break;
        }
        case "REQUEST_SAVE":
          requestedSave = true;
          immediateSave = immediateSave || effect.immediate;
          break;
        default:
          break;
      }
    }

    if (requestedSave) {
      scheduleSave(immediateSave);
    }
  };

  const queue: CommandQueue = createCommandQueue({
    initialState: dependencies.initialState,
    onEffects: (effects) => {
      handleEffects(effects);
    },
    canDispatch: canWrite,
  });

  music = createMusicEngine({ getContext: () => dependencies.audio.context() });

  // Both engine inputs derive from state, so they are pushed from one place.
  // The engine ignores a track or volume it already has, making this cheap to
  // call every frame.
  const syncMusic = (): void => {
    const state = queue.getState();

    music?.setSettings(state.settings);
    music?.setTrack(selectMusicTrackId(state));
  };

  queue.subscribe(() => {
    syncMusic();
  });

  // Periodic autosave while active, independent of the debounce.
  const periodicSave = setInterval(() => {
    if (dirty) {
      void writeSave();
    }
  }, ECONOMY.autosaveIntervalMs);

  dependencies.lease.onStatusChange((leaseStatus) => {
    if (leaseStatus === "writer") {
      // A reader's state predates the previous writer's last save. Reload
      // through bootstrap before allowing commands or autosaves, so takeover
      // loads that save and settles offline production against its timestamp.
      reloadingForLease = true;
      window.location.reload();
      return;
    }

    publishStatus({ leaseStatus });

    if (leaseStatus === "reader") {
      pushFeedback("negative", "Another tab took over the save. This tab is read-only.");
    }
  });

  leaseTimer = setInterval(() => {
    dependencies.lease.refresh(Date.now());
  }, LEASE_RENEW_INTERVAL_MS);

  // Releasing on unload lets a plain reload take the lease straight back
  // instead of waiting for the previous holder to expire.
  const releaseOnUnload = (): void => {
    // Releasing changes status to reader. Stop renewal first so the outgoing
    // document cannot reacquire the lease while the next document is loading.
    if (leaseTimer !== null) {
      clearInterval(leaseTimer);
      leaseTimer = null;
    }
    dependencies.lease.release();
    dependencies.lease.stop();
  };

  const reloadOnRestore = (event: PageTransitionEvent): void => {
    // A back/forward-cache restore revives a runtime whose lease was stopped.
    if (event.persisted) {
      window.location.reload();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", releaseOnUnload);
    window.addEventListener("pageshow", reloadOnRestore);
  }

  clock = startRuntimeClock({
    onFrame: (frame) => {
      // A read-only tab simulates nothing; the writer owns the clock.
      if (frame.casinoElapsedMs <= 0 || !canWrite()) {
        return;
      }

      queue.dispatch({
        type: "TICK",
        casinoElapsedMs: frame.casinoElapsedMs,
        expeditionElapsedMs: frame.expeditionElapsedMs,
        nowUnixMs: frame.nowUnixMs,
      });
    },
    onHidden: () => {
      // Audio stops with the simulation rather than playing to a hidden tab.
      music?.pause();

      if (dirty) {
        void writeSave();
      }
    },
    onVisible: (hiddenElapsedMs) => {
      music?.resume();

      // The hidden interval is settled as inactive casino production. The
      // expedition does not advance while the document is hidden.
      if (hiddenElapsedMs <= 0 || !canWrite()) {
        return;
      }

      queue.dispatch({
        type: "TICK",
        casinoElapsedMs: hiddenElapsedMs,
        expeditionElapsedMs: 0,
        nowUnixMs: Date.now(),
      });
    },
    now: dependencies.now,
  });

  return {
    getState() {
      return queue.getState();
    },

    subscribe(listener) {
      return queue.subscribe(listener);
    },

    dispatch(command) {
      queue.dispatch(command);
    },

    getStatus() {
      return status;
    },

    subscribeStatus(listener) {
      statusListeners.add(listener);

      return () => {
        statusListeners.delete(listener);
      };
    },

    unlockAudio() {
      dependencies.audio.unlock();
      // First moment the audio context exists for the engine to attach to.
      syncMusic();
    },

    dismissWelcomeBack() {
      publishStatus({ welcomeBack: null });
    },

    dismissCacheResults() {
      publishStatus({ cacheResults: null });
    },

    dismissRunSummary() {
      publishStatus({ runSummary: null });
    },

    dismissSpinResult() {
      publishStatus({ spinResult: null });
    },

    async saveNow() {
      await writeSave();
    },

    exportSave() {
      return {
        text: exportGameState(queue.getState(), revision, Date.now()),
        fileName: EXPORT_FILE_NAME,
        mimeType: EXPORT_MIME_TYPE,
      };
    },

    async importSave(text) {
      if (!canWrite()) {
        return { ok: false, message: "This tab is read-only, so it cannot import a save." };
      }

      const parsed = parseImport(text, Date.now());

      if (!parsed.ok) {
        return { ok: false, message: parsed.reason };
      }

      await replaceSavedGame(parsed.envelope.game);

      // Unlike a reset, an import leaves the windows open: the Save window
      // prints the only confirmation, and `unlockedRailEntries` already drops
      // any window the imported save has not unlocked.

      return { ok: true, message: `Imported save: ${describeImport(parsed.envelope)}` };
    },

    async resetSave() {
      if (!canWrite()) {
        throw new Error("This tab is read-only, so it cannot reset the save.");
      }

      const fresh = createGameState({ nowUnixMs: Date.now() });
      await replaceSavedGame(fresh);
      publishStatus({
        revision,
        saveState: "saved",
        lastSavedAtUnixMs: Date.now(),
        welcomeBack: null,
        runSummary: null,
        cacheResults: null,
        spinResult: null,
      });
      closeWindows();
      pushFeedback("neutral", "Save reset. Nothing was retained.");
    },

    stop() {
      clock?.stop();
      music?.dispose();
      dependencies.audio.dispose();
      clearInterval(periodicSave);
      clearInterval(feedbackTimer);

      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", releaseOnUnload);
        window.removeEventListener("pageshow", reloadOnRestore);
      }

      if (leaseTimer !== null) {
        clearInterval(leaseTimer);
      }

      if (saveTimer !== null) {
        clearTimeout(saveTimer);
      }

      dependencies.lease.stop();
      dependencies.store.close();
    },
  };
}

function renderFatalContentError(rootElement: HTMLElement, issues: string[]): void {
  rootElement.innerHTML = "";

  const container = document.createElement("main");
  container.className = "fatal-error";

  const heading = document.createElement("h1");
  heading.textContent = "Lunar Jackpot cannot start";
  container.append(heading);

  const explanation = document.createElement("p");
  explanation.textContent =
    "The game content failed validation. No save data has been read or written. Report the issues below.";
  container.append(explanation);

  const list = document.createElement("ul");

  for (const issue of issues) {
    const item = document.createElement("li");
    item.textContent = issue;
    list.append(item);
  }

  container.append(list);
  rootElement.append(container);
}

export async function bootstrap(): Promise<GameRuntime | null> {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    throw new Error("Missing #root application mount point.");
  }

  // Content validation happens before any save is touched.
  const validation = validateContent();

  if (!validation.valid) {
    renderFatalContentError(rootElement, validation.issues);

    return null;
  }

  const bootNotices: string[] = [];
  const store = await openStore(bootNotices);
  const lease = createSingleWriterLease({ storage: createLeaseStorage() });
  const leaseStatus = lease.refresh(Date.now());

  if (leaseStatus === "reader") {
    bootNotices.push(
      "Another tab already holds this save. This tab is read-only until that tab closes.",
    );
  }

  const nowUnixMs = Date.now();
  const loaded = await loadLatestSave(store, nowUnixMs, () =>
    createGameState({ nowUnixMs }),
  );

  bootNotices.push(...loaded.notices);

  if (loaded.source === "backup") {
    bootNotices.push("The most recent save was unreadable, so the previous one was restored.");
  }

  if (loaded.envelope.contentVersion !== CONTENT_VERSION) {
    bootNotices.push(
      `This save was written for content version ${loaded.envelope.contentVersion}; it now runs on ${CONTENT_VERSION}.`,
    );
  }

  // Offline cash is settled exactly once, before the player can act, and only
  // by the tab that holds the writer lease.
  let initialState = loaded.envelope.game;
  let welcomeBack: OfflineSettlement | null = null;
  let revision = loaded.envelope.revision;

  if (leaseStatus === "writer") {
    const settlement = settleOfflineProduction(initialState, nowUnixMs);
    initialState = settlement.state;

    if (settlement.cashGranted > 0) {
      welcomeBack = settlement;
    }

    revision += 1;
    await store.write(createEnvelope(initialState, revision, nowUnixMs));
  }

  const runtime = createRuntime({
    store,
    lease,
    initialState,
    revision,
    bootNotices,
    welcomeBack,
    audio: createAudioManager(),
    now: () => performance.now(),
  });

  createRoot(rootElement).render(
    createElement(StrictMode, null, createElement(GameApp, { runtime })),
  );

  return runtime;
}
