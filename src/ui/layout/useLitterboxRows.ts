/**
 * How many rows of cats the litterbox may show. One rule: the casino floor asks
 * for what it needs, and the shelf gets what is left, down to a minimum of one
 * row.
 *
 * Why this cannot oscillate, which is the only interesting thing about it.
 * Changing the row count changes how much room the floor has, which changes the
 * scale `useFitScale` draws it at — and `transform` does not affect layout
 * metrics, so `scrollHeight` still reports the floor's natural height and this
 * reads the same numbers it read before. Every input is invariant to the change
 * it causes, so one pass settles. The panel chrome is measured the same way, as
 * a difference between two boxes that move together.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** A cat sprite at scale 2. Matches `.cat-box__shelf`'s own arithmetic. */
export const CAT_SPRITE_SIZE = 24;
/** The shelf's flex gap, in both directions. Matches `.cat-box__shelf`. */
export const CAT_GAP = 4;

/**
 * A little room between the last row of machines and the bottom of the floor.
 * Also keeps the floor off the boundary where a pixel of rounding would flip it
 * between scale 1 and 0.99 on every re-measure.
 */
export const CASINO_BUFFER = 8;

/**
 * Used only in the frame where the first cat appears and the panel does not yet
 * exist to be measured. A seed, not a second source of truth: the layout effect
 * corrects it before paint.
 */
const LITTERBOX_CHROME_FALLBACK = 64;

export interface LitterboxSpace {
  /** The whole column: the floor, the gap, and the shelf. */
  columnHeight: number;
  /** The column's own row gap, between the two panels. */
  gap: number;
  /** What the floor needs to draw unscaled: its chrome, its content, the buffer. */
  casinoNeededHeight: number;
  /** The shelf panel's header, padding and borders — everything but the rows. */
  litterboxChromeHeight: number;
}

/** The height a shelf of `rows` rows occupies. The last row carries no gap. */
export function catShelfHeight(rows: number): number {
  return Math.max(0, rows * CAT_SPRITE_SIZE + (rows - 1) * CAT_GAP);
}

/**
 * The rows the leftover space can hold, never fewer than one: a litterbox
 * showing no cats is a panel of nothing but a heading. Where there is not even
 * room for one row, the floor scales instead, which is `useFitScale`'s job.
 */
export function availableLitterboxRows(space: LitterboxSpace): number {
  const leftover =
    space.columnHeight - space.gap - space.casinoNeededHeight - space.litterboxChromeHeight;

  // Inverts `catShelfHeight`: n rows need `n * size + (n - 1) * gap`.
  return Math.max(1, Math.floor((leftover + CAT_GAP) / (CAT_SPRITE_SIZE + CAT_GAP)));
}

export interface LitterboxRows {
  columnRef: (element: HTMLDivElement | null) => void;
  /**
   * The most rows the space allows. The shelf shows this or the rows its cats
   * actually fill, whichever is fewer; only `CatBox` knows how many there are.
   */
  maximumRows: number;
}

export function useLitterboxRows(): LitterboxRows {
  const columnElement = useRef<HTMLDivElement | null>(null);
  const [maximumRows, setMaximumRows] = useState(1);

  // The two panels are found by class rather than by ref: `Panel` is shared by
  // eight callers, and the classes are already load-bearing in `styles.css`, so
  // reading them here adds no coupling that was not there.
  const measure = useCallback((): void => {
    const column = columnElement.current;

    if (column === null) {
      return;
    }

    const casino = column.querySelector<HTMLElement>(".panel--casino");
    const casinoBody = casino?.querySelector<HTMLElement>(".panel__body") ?? null;
    const casinoContent = casino?.querySelector<HTMLElement>(".panel__fit") ?? null;

    if (casino === null || casinoBody === null || casinoContent === null) {
      return;
    }

    // Chrome is a difference between two boxes that move together — the panel's
    // border box against its body's content box — so it is the same number at
    // any panel height, and safe to feed back into a calculation that changes it.
    const casinoChrome = casino.getBoundingClientRect().height - casinoBody.clientHeight;
    const litterbox = column.querySelector<HTMLElement>(".panel--cats");
    const shelf = litterbox?.querySelector<HTMLElement>(".cat-box__shelf") ?? null;

    setMaximumRows(
      availableLitterboxRows({
        columnHeight: column.clientHeight,
        gap: Number.parseFloat(getComputedStyle(column).rowGap) || 0,
        // `scrollHeight` is the content's natural height, unaffected by the scale
        // the fit hook draws it at, which is why this does not chase its own tail.
        casinoNeededHeight: casinoChrome + casinoContent.scrollHeight + CASINO_BUFFER,
        litterboxChromeHeight:
          litterbox === null || shelf === null
            ? LITTERBOX_CHROME_FALLBACK
            : litterbox.getBoundingClientRect().height - shelf.clientHeight,
      }),
    );
  }, []);

  /*
   * After every render, and again whenever a box changes size without one — the
   * same pairing `useFitScale` uses, for the same reasons. `setMaximumRows` with
   * the value already in state is a no-op, so running it every render does not
   * loop. A layout effect, so the first pass lands before paint.
   */
  useLayoutEffect(measure);

  useEffect(() => {
    const column = columnElement.current;

    if (column === null) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(column);

    const casinoContent = column.querySelector<HTMLElement>(".panel--casino .panel__fit");

    // The floor's content as well as the column: a machine unlocking wants more
    // room without changing the space available.
    if (casinoContent !== null) {
      observer.observe(casinoContent);
    }

    return () => {
      observer.disconnect();
    };
  }, [measure]);

  return {
    columnRef: useCallback((element: HTMLDivElement | null) => {
      columnElement.current = element;
    }, []),
    maximumRows,
  };
}
