/**
 * Shrinking a box's contents until they fit it, so a panel scales rather than
 * scrolling and nothing has to be hidden.
 *
 * `transform`, not `zoom`: transform does not affect layout metrics, so
 * `scrollHeight` reports the natural unscaled height and the measurement below
 * is possible at all. `zoom` would change the very numbers it is measured by.
 *
 * A uniform scale, with no width compensation — widening the content by the
 * reciprocal of the scale defeats every width-driven layout in the game.
 *
 * Synchronous, not `requestAnimationFrame`: reading `scrollHeight` after a style
 * write forces the reflow the next pass needs, and rAF does nothing at all in a
 * hidden tab.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How far a box may be shrunk before scrolling is the better answer. */
export const FIT_SCALE_FLOOR = 0.55;

export interface FitMeasurement {
  availableWidth: number;
  availableHeight: number;
  /** The content's own width and height, unscaled, at the compensated width. */
  naturalWidth: number;
  naturalHeight: number;
  /** The scale the natural size above was measured at. */
  scale: number;
}

/**
 * Whether the content fits its box at a given scale. The content lays out at
 * `available / scale` and draws at `scale`, so its drawn size is
 * `natural * scale`. A tolerance of a pixel, because sub-pixel layout makes
 * exact comparisons flap.
 *
 * A predicate rather than a formula, because the formula is not stable: natural
 * height is measured at a width that itself depends on the scale, so solving
 * `available / natural` changes the number it was solved from. Searching for the
 * largest scale that fits asks about the layout that will really be drawn.
 */
export function fitsAtScale({
  availableHeight,
  availableWidth,
  naturalHeight,
  naturalWidth,
  scale,
}: FitMeasurement): boolean {
  if (availableWidth <= 0 || availableHeight <= 0) {
    // A collapsed box has nothing to fit anything to, and nothing to complain of.
    return true;
  }

  return (
    naturalHeight * scale <= availableHeight + 1 && naturalWidth * scale <= availableWidth + 1
  );
}

/**
 * Steps of binary search between the floor and 1. Six halvings of a 0.45-wide
 * range settle to under a percent, finer than a reader can see, at a cost of six
 * forced reflows per resize.
 */
const SEARCH_STEPS = 6;
/** Close enough to the floor to call it the floor. */
const SETTLED = 0.01;

export interface FitScale {
  containerRef: (element: HTMLDivElement | null) => void;
  contentRef: (element: HTMLDivElement | null) => void;
  /**
   * The scale in force. Reported for tests and inspection; the hook writes the
   * custom property itself rather than handing it back to be rendered.
   */
  scale: number;
  /**
   * True when the content could not be made to fit above the floor. The caller
   * gives the box its scrollbar back rather than clipping.
   */
  atFloor: boolean;
}

export function useFitScale(enabled: boolean, minimum = FIT_SCALE_FLOOR): FitScale {
  const containerElement = useRef<HTMLDivElement | null>(null);
  const contentElement = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [atFloor, setAtFloor] = useState(false);
  // Guards the observer against the reflows the pass itself causes.
  const settling = useRef(false);
  /*
   * The box the current scale was settled for, used as a "has anything changed"
   * key. Natural size comes from `scrollHeight`, which `transform` does not
   * affect, so these numbers do not move when the scale does.
   *
   * A `.panel__fit--fill` box is the exception — its width is `100% / scale`, so
   * its natural size follows the scale. The key still works, since it is written
   * at the end of a settle and compared afterwards; the cost is one extra
   * `ResizeObserver` callback per settle, which finds nothing and returns.
   */
  const settledFor = useRef({ availableWidth: -1, availableHeight: -1, naturalWidth: -1, naturalHeight: -1 });

  const settle = useCallback((): void => {
    const container = containerElement.current;
    const content = contentElement.current;

    if (!enabled || container === null || content === null || settling.current) {
      return;
    }

    settling.current = true;

    const measureAt = (candidate: number): boolean => {
      content.style.setProperty("--fit-scale", String(candidate));

      // Reading these forces the reflow the write above needs.
      return fitsAtScale({
        availableWidth: container.clientWidth,
        availableHeight: container.clientHeight,
        naturalWidth: content.scrollWidth,
        naturalHeight: content.scrollHeight,
        scale: candidate,
      });
    };

    let current = 1;

    if (!measureAt(1)) {
      // Binary search rather than solving for a scale: `low` always fits and
      // `high` never does, so the answer converges from a side that is true.
      let low = minimum;
      let high = 1;

      for (let step = 0; step < SEARCH_STEPS; step += 1) {
        const middle = (low + high) / 2;

        if (measureAt(middle)) {
          low = middle;
        } else {
          high = middle;
        }
      }

      current = low;
    }

    let fits = measureAt(current);

    // At the floor and still too tall: give up and scroll at full size.
    // Shrinking and keeping a scrollbar is the worst of both, so if a box cannot
    // fit legibly, scaling it has bought nothing.
    if (!fits && current <= minimum + SETTLED) {
      current = 1;
      measureAt(1);
      fits = false;
    }

    // The custom property is left on the element and React never sets it. Both
    // writing it is a fight this loop loses: it runs in a layout effect after
    // every render, so it would clear React's value on the render React did
    // because of it, and every box would draw at 1.
    settling.current = false;
    settledFor.current = {
      availableWidth: container.clientWidth,
      availableHeight: container.clientHeight,
      naturalWidth: content.scrollWidth,
      naturalHeight: content.scrollHeight,
    };

    setScale(current);
    // `atFloor` means "gave up and scrolls", the only state showing a scrollbar.
    setAtFloor(!fits);
  }, [enabled, minimum]);

  /**
   * The cheap check that decides whether the expensive one is needed. Four reads
   * and no writes, so it does not invalidate layout. The search itself writes a
   * style per step and forces a full reflow each time, which measured at 107ms
   * for one pass over four boxes on a maxed save.
   */
  const settleIfChanged = useCallback((): void => {
    const container = containerElement.current;
    const content = contentElement.current;

    if (!enabled || container === null || content === null || settling.current) {
      return;
    }

    const measurement = {
      availableWidth: container.clientWidth,
      availableHeight: container.clientHeight,
      naturalWidth: content.scrollWidth,
      naturalHeight: content.scrollHeight,
    };
    const last = settledFor.current;

    if (
      measurement.availableWidth === last.availableWidth &&
      measurement.availableHeight === last.availableHeight &&
      measurement.naturalWidth === last.naturalWidth &&
      measurement.naturalHeight === last.naturalHeight
    ) {
      return;
    }

    settle();
  }, [enabled, settle]);

  /*
   * Checked after every render, and re-settled only when a box actually moved.
   * Running the full search per render costs several hundred forced reflows a
   * second on a dashboard that re-renders every tick; relying on the
   * `ResizeObserver` alone is untestable, since it delivers no callbacks in the
   * preview pane. So both: the guard is four reads and catches everything, and
   * the observer catches a box that changes without a render.
   *
   * A layout effect, so the first pass lands before paint and a box is never
   * shown at the wrong size and then corrected.
   */
  useLayoutEffect(settleIfChanged);

  useEffect(() => {
    const container = containerElement.current;
    const content = contentElement.current;

    if (!enabled || container === null || content === null) {
      return;
    }

    // Both boxes: the container reports the space available, and the content its
    // own layout size, which `transform` does not change — so observing it is
    // safe and catches content growing without a re-render.
    const observer = new ResizeObserver(() => {
      settleIfChanged();
    });

    observer.observe(container);
    observer.observe(content);

    return () => {
      observer.disconnect();
    };
  }, [enabled, settleIfChanged]);

  return {
    containerRef: useCallback((element: HTMLDivElement | null) => {
      containerElement.current = element;
    }, []),
    contentRef: useCallback((element: HTMLDivElement | null) => {
      contentElement.current = element;
    }, []),
    scale,
    atFloor,
  };
}
