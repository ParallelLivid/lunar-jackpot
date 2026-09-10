/**
 * The litterbox's share of the casino column.
 *
 * The hook around this is measurement and `ResizeObserver`; the decision it
 * makes is these two functions, and they are where the rule can be stated
 * exactly: the floor asks for what it needs, the shelf takes what is left, and
 * one row is the floor rather than zero.
 */

import { describe, expect, it } from "vitest";
import {
  CAT_GAP,
  CAT_SPRITE_SIZE,
  availableLitterboxRows,
  catShelfHeight,
} from "../../ui/layout/useLitterboxRows";

/** The measurements taken from a real 1440x900 dashboard, as the baseline. */
const ROOMY = {
  columnHeight: 699,
  gap: 12,
  casinoNeededHeight: 379,
  litterboxChromeHeight: 64,
};

describe("a shelf of cats", () => {
  it("measures a row of sprites plus the gaps between rows", () => {
    expect(catShelfHeight(1)).toBe(CAT_SPRITE_SIZE);
    expect(catShelfHeight(2)).toBe(2 * CAT_SPRITE_SIZE + CAT_GAP);
    expect(catShelfHeight(3)).toBe(3 * CAT_SPRITE_SIZE + 2 * CAT_GAP);
  });

  it("never reports a negative height", () => {
    expect(catShelfHeight(0)).toBe(0);
  });
});

describe("how many rows the leftover holds", () => {
  it("gives the shelf every row that fits beside an unscaled floor", () => {
    const rows = availableLitterboxRows(ROOMY);

    // 699 - 12 - 379 - 64 = 244px of leftover, which is 8 rows and a remainder.
    expect(rows).toBe(8);
    expect(catShelfHeight(rows)).toBeLessThanOrEqual(244);
    expect(catShelfHeight(rows + 1)).toBeGreaterThan(244);
  });

  it("falls as the column shortens", () => {
    const heights = [699, 600, 520, 470];
    const rows = heights.map((columnHeight) =>
      availableLitterboxRows({ ...ROOMY, columnHeight }),
    );

    // Strictly decreasing: a shorter dashboard is a shorter shelf, every time.
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index], `${String(heights[index])}px`).toBeLessThan(rows[index - 1]);
    }
  });

  it("rises as the floor asks for less", () => {
    /*
     * The other direction, and the one the note is really about: the shelf grows
     * into space the floor does not want. A floor with fewer machines unlocked
     * is a shorter floor.
     */
    const tall = availableLitterboxRows({ ...ROOMY, casinoNeededHeight: 379 });
    const short = availableLitterboxRows({ ...ROOMY, casinoNeededHeight: 200 });

    expect(short).toBeGreaterThan(tall);
  });

  it("keeps one row when there is no room for it", () => {
    /*
     * At 1280x720 with the floor wanting more than the column has, the honest
     * answer is one row and a floor that scales — not a heading with an empty
     * shelf under it, and not a shelf that pushes the floor into a scrollbar.
     */
    for (const columnHeight of [470, 300, 100, 0]) {
      expect(availableLitterboxRows({ ...ROOMY, columnHeight })).toBeGreaterThanOrEqual(1);
    }

    expect(availableLitterboxRows({ ...ROOMY, columnHeight: 0 })).toBe(1);
  });

  it("hands the floor a buffer rather than the exact pixel it asked for", () => {
    /*
     * A shelf sized to the last pixel would leave the floor on the boundary
     * where a rounding difference flips it between scale 1 and 0.99 on every
     * re-measure. `CASINO_BUFFER` is already inside `casinoNeededHeight` by the
     * time it reaches here, so this asserts the shape that makes that possible:
     * the rows chosen always leave the floor at least what it asked for.
     */
    const rows = availableLitterboxRows(ROOMY);
    const used = ROOMY.gap + ROOMY.litterboxChromeHeight + catShelfHeight(rows);

    expect(ROOMY.columnHeight - used).toBeGreaterThanOrEqual(ROOMY.casinoNeededHeight);
  });
});
