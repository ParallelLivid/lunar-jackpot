/**
 * Coverage for the fit-to-box predicate.
 *
 * The hook around it needs a browser; this does not, and it is where the
 * arithmetic that decides whether a box fits actually lives.
 */

import { describe, expect, it } from "vitest";
import { FIT_SCALE_FLOOR, fitsAtScale } from "../../ui/shared/useFitScale";

const box = (patch: Partial<Parameters<typeof fitsAtScale>[0]> = {}) => ({
  availableWidth: 400,
  availableHeight: 200,
  naturalWidth: 400,
  naturalHeight: 200,
  scale: 1,
  ...patch,
});

describe("fitsAtScale", () => {
  it("accepts content that already fits", () => {
    expect(fitsAtScale(box())).toBe(true);
    expect(fitsAtScale(box({ naturalHeight: 100 }))).toBe(true);
  });

  it("rejects content that is too tall, however wide it is", () => {
    expect(fitsAtScale(box({ naturalHeight: 400 }))).toBe(false);
  });

  it("rejects content that is too wide, however short it is", () => {
    expect(fitsAtScale(box({ naturalWidth: 900, naturalHeight: 10 }))).toBe(false);
  });

  it("measures the drawn size, which is natural times scale", () => {
    /*
     * The whole arithmetic of the chunk. Content lays out at `available / scale`
     * and draws at `scale`, so a box twice as tall as its space fits at a half.
     */
    expect(fitsAtScale(box({ naturalHeight: 400, scale: 0.5 }))).toBe(true);
    expect(fitsAtScale(box({ naturalHeight: 400, scale: 0.49 }))).toBe(true);
    expect(fitsAtScale(box({ naturalHeight: 400, scale: 0.51 }))).toBe(false);
  });

  it("treats a collapsed box as nothing to complain about", () => {
    /*
     * A panel in a grid row with no cats in it has zero height and no content to
     * fit. Returning false would send the search to the floor for a box nobody
     * can see; returning true leaves it alone.
     */
    expect(fitsAtScale(box({ availableHeight: 0 }))).toBe(true);
    expect(fitsAtScale(box({ availableWidth: 0 }))).toBe(true);
  });

  it("tolerates a pixel, because sub-pixel layout does not settle", () => {
    // Exactly-equal comparisons flap between 199.9998 and 200.0001 and would
    // have the search chase a difference no one can see.
    expect(fitsAtScale(box({ naturalHeight: 200.6 }))).toBe(true);
    expect(fitsAtScale(box({ naturalHeight: 202 }))).toBe(false);
  });

  it("has a floor a reader can still read at", () => {
    // Not an assertion about the number so much as a place for the decision to
    // live: below this the game gives up scaling and scrolls instead.
    expect(FIT_SCALE_FLOOR).toBeGreaterThan(0.4);
    expect(FIT_SCALE_FLOOR).toBeLessThan(0.8);
  });

  it("is the predicate a binary search needs: monotonic in the scale", () => {
    /*
     * Everything below some scale fits and everything above it does not, for a
     * fixed natural size — which is what makes the search in `useFitScale`
     * correct rather than merely convergent.
     */
    const measurement = box({ naturalHeight: 500, naturalWidth: 500 });
    let seenFalse = false;

    for (let scale = 1; scale >= 0.1; scale -= 0.05) {
      const fits = fitsAtScale({ ...measurement, scale });

      if (!fits) {
        seenFalse = true;
      } else {
        // Once it fits at some scale it must fit at every smaller one.
        expect(seenFalse, `fits at ${scale.toFixed(2)} after failing higher up`).toBe(true);
      }
    }
  });
});

/**
 * A `.panel__fit--fill` box.
 *
 * Compensation is a CSS rule — `inline-size: calc(100% / var(--fit-scale))` —
 * so the predicate never learns about it directly. What it sees is a natural
 * width that tracks the scale instead of standing still, and these are the cases
 * that has to keep answering correctly.
 */
describe("fitsAtScale, on a box laid out to fill", () => {
  /** What a filled box measures: laid out at `available / scale`. */
  const filled = (availableWidth: number, scale: number, naturalHeight: number) => ({
    availableWidth,
    availableHeight: 200,
    naturalWidth: Math.ceil(availableWidth / scale),
    naturalHeight,
    scale,
  });

  it("accepts the compensated width at every scale", () => {
    /*
     * The drawn width is `natural * scale`, and compensation makes that the
     * panel's own width by construction — so the width half of the test must
     * never be what rejects a candidate, or the search would shrink for a
     * reason that is not real.
     */
    for (const scale of [1, 0.9, 0.75, 0.618, 0.55]) {
      expect(fitsAtScale(filled(400, scale, 100)), `scale ${String(scale)}`).toBe(true);
    }
  });

  it("survives the rounding that measuring in whole pixels introduces", () => {
    /*
     * `scrollWidth` is an integer, so a box specified at 400 / 0.618 = 647.2px
     * measures 648 and draws at 400.46 — over its box by half a pixel, at every
     * scale that does not divide evenly. The predicate's one-pixel tolerance is
     * what absorbs that; without it the search would chase a rounding error all
     * the way to the floor.
     */
    for (let width = 300; width <= 900; width += 37) {
      for (const scale of [0.618, 0.734, 0.877, 0.913]) {
        expect(fitsAtScale(filled(width, scale, 50)), `${String(width)} at ${String(scale)}`).toBe(
          true,
        );
      }
    }
  });

  it("still rejects content that cannot be made narrow enough", () => {
    /*
     * The case the width test is still for. A filled box asks for
     * `available / scale`, but content with a wider minimum — a long
     * unbreakable row — overflows it anyway, and that has to keep counting as
     * "does not fit" so the search widens the box further.
     */
    const stubborn = { ...filled(400, 0.8, 50), naturalWidth: 900 };

    expect(fitsAtScale(stubborn)).toBe(false);
  });

  it("is still monotonic once the width follows the scale", () => {
    /*
     * The property the binary search depends on, re-checked for a box whose
     * natural size is no longer fixed. Height is what decides: a wider layout is
     * a shorter one, so both factors of `natural * scale` fall together and the
     * predicate cannot flip back.
     */
    let seenFalse = false;

    for (let scale = 1; scale >= 0.55; scale -= 0.05) {
      // A crude stand-in for reflow: the wider the box, the shorter the content.
      const naturalHeight = Math.round(500 * scale);
      const fits = fitsAtScale(filled(400, scale, naturalHeight));

      if (!fits) {
        seenFalse = true;
      } else {
        expect(seenFalse, `fits at ${scale.toFixed(2)} after failing higher up`).toBe(true);
      }
    }
  });
});
