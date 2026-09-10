/**
 * One application clock driven by monotonic browser time. Casino production
 * consumes the full elapsed value; the expedition value is clamped so a
 * renderer stall cannot burn an unreasonable amount of oxygen. While the
 * document is hidden the expedition stops and the gap is settled afterwards as
 * inactive casino production.
 */

import { ECONOMY } from "../content/catalog";

export interface ClockFrame {
  casinoElapsedMs: number;
  expeditionElapsedMs: number;
  /** Wall clock, kept separate from the monotonic elapsed values above. */
  nowUnixMs: number;
}

export interface RuntimeClockOptions {
  onFrame: (frame: ClockFrame) => void;
  /** Called when the document is hidden, so the caller can flush a save. */
  onHidden?: () => void;
  /**
   * Called on return with the hidden interval in milliseconds. The caller
   * settles it as inactive casino production; the expedition does not advance.
   */
  onVisible?: (hiddenElapsedMs: number) => void;
  now?: () => number;
  /** Wall clock, injected so tests can drive settlement deterministically. */
  wallClock?: () => number;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface RuntimeClock {
  stop(): void;
  isRunning(): boolean;
}

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function startRuntimeClock(options: RuntimeClockOptions): RuntimeClock {
  const now = options.now ?? monotonicNow;
  const wallClock = options.wallClock ?? (() => Date.now());
  const requestFrame =
    options.requestFrame ??
    ((callback: (timestamp: number) => void) => requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle: number) => { cancelAnimationFrame(handle); });

  let lastTimestamp = now();
  let hiddenAt: number | null = null;
  let handle: number | null = null;
  let running = true;

  const frame = (): void => {
    if (!running) {
      return;
    }

    const timestamp = now();
    // A backward clock reading contributes nothing rather than negative time.
    const elapsedMs = Math.max(0, timestamp - lastTimestamp);
    lastTimestamp = timestamp;

    if (hiddenAt === null) {
      options.onFrame({
        casinoElapsedMs: elapsedMs,
        expeditionElapsedMs: Math.min(elapsedMs, ECONOMY.maxActiveTickMs),
        nowUnixMs: wallClock(),
      });
    }

    handle = requestFrame(frame);
  };

  const handleVisibility = (): void => {
    if (typeof document === "undefined") {
      return;
    }

    if (document.hidden) {
      hiddenAt = now();
      options.onHidden?.();

      return;
    }

    const hiddenElapsedMs = hiddenAt === null ? 0 : Math.max(0, now() - hiddenAt);
    hiddenAt = null;
    lastTimestamp = now();
    options.onVisible?.(hiddenElapsedMs);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  handle = requestFrame(frame);

  return {
    stop() {
      running = false;

      if (handle !== null) {
        cancelFrame(handle);
        handle = null;
      }

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    },

    isRunning() {
      return running;
    },
  };
}
