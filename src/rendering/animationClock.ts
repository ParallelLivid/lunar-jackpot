/**
 * A presentation-only animation loop.
 *
 * It never dispatches commands and never decides rewards, damage, or oxygen.
 * It exists so the canvas can interpolate between the domain states the
 * runtime clock produces.
 */

export interface AnimationClock {
  stop(): void;
}

export function startAnimationClock(onFrame: (timeMs: number) => void): AnimationClock {
  let handle: number | null = null;
  let running = true;

  const frame = (timestamp: number): void => {
    if (!running) {
      return;
    }

    onFrame(timestamp);
    handle = requestAnimationFrame(frame);
  };

  handle = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;

      if (handle !== null) {
        cancelAnimationFrame(handle);
        handle = null;
      }
    },
  };
}
