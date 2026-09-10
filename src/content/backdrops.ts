/**
 * The silhouettes drawn behind an expedition, one set per depth band. Content
 * rather than renderer constants, because what a band looks like is a design
 * decision and the five places can then be retuned without touching the drawing
 * code.
 *
 * Silhouettes, not colour: the palette is greys on black, so a band is told apart
 * by shape and density — an open shelf, then struts, then hanging cables, then
 * vaulted hollows, then the crowded core.
 *
 * Each layer is a repeating strip of a handful of columns, scrolling slower than
 * the terrain. Two layers is enough to read as depth without turning the
 * renderer into a scene graph.
 */

import type { DepthBandId } from "./depthBands";

export interface BackdropColumn {
  /** Where the column sits in the strip, as a fraction of the strip's width. */
  at: number;
  /** How tall it stands, as a fraction of the horizon height. */
  height: number;
  /** How wide it is, as a fraction of the strip's width. */
  width: number;
}

export interface BackdropLayer {
  /**
   * How fast this layer scrolls against the terrain. The far layer barely moves
   * and the mid layer runs at about half speed, so distance reads as the
   * difference between them rather than any one rate.
   */
  scrollRate: number;
  /** Repeating strip width in pixels, before any scaling. */
  stridepx: number;
  /** How far up the canvas the layer's baseline sits, as a fraction of height. */
  baseline: number;
  columns: BackdropColumn[];
}

export interface BackdropDefinition {
  bandId: DepthBandId;
  far: BackdropLayer;
  mid: BackdropLayer;
}

export const BACKDROPS: Record<DepthBandId, BackdropDefinition> = {
  // Open sky over a shallow shelf: a few low mounds, far apart.
  "band.shelf": {
    bandId: "band.shelf",
    far: {
      scrollRate: 0.2,
      stridepx: 220,
      baseline: 0.72,
      columns: [
        { at: 0.05, height: 0.16, width: 0.22 },
        { at: 0.48, height: 0.1, width: 0.3 },
        { at: 0.82, height: 0.2, width: 0.14 },
      ],
    },
    mid: {
      scrollRate: 0.5,
      stridepx: 150,
      baseline: 0.72,
      columns: [
        { at: 0.2, height: 0.09, width: 0.18 },
        { at: 0.66, height: 0.13, width: 0.1 },
      ],
    },
  },

  // Cut seams: regular pit props, taller and closer together.
  "band.seams": {
    bandId: "band.seams",
    far: {
      scrollRate: 0.2,
      stridepx: 190,
      baseline: 0.72,
      columns: [
        { at: 0.08, height: 0.34, width: 0.07 },
        { at: 0.34, height: 0.27, width: 0.07 },
        { at: 0.62, height: 0.38, width: 0.07 },
        { at: 0.86, height: 0.3, width: 0.07 },
      ],
    },
    mid: {
      scrollRate: 0.5,
      stridepx: 110,
      baseline: 0.72,
      columns: [
        { at: 0.12, height: 0.2, width: 0.05 },
        { at: 0.55, height: 0.26, width: 0.05 },
      ],
    },
  },

  // The Dark: cables hanging from an unseen ceiling, thin and irregular.
  "band.dark": {
    bandId: "band.dark",
    far: {
      scrollRate: 0.18,
      stridepx: 170,
      baseline: 0.72,
      columns: [
        { at: 0.1, height: 0.52, width: 0.03 },
        { at: 0.3, height: 0.44, width: 0.03 },
        { at: 0.47, height: 0.6, width: 0.03 },
        { at: 0.71, height: 0.4, width: 0.03 },
        { at: 0.9, height: 0.55, width: 0.03 },
      ],
    },
    mid: {
      scrollRate: 0.48,
      stridepx: 95,
      baseline: 0.72,
      columns: [
        { at: 0.22, height: 0.3, width: 0.04 },
        { at: 0.68, height: 0.36, width: 0.04 },
      ],
    },
  },

  // The Hollows: wide vaulted arches, broad and low-shouldered.
  "band.hollow": {
    bandId: "band.hollow",
    far: {
      scrollRate: 0.16,
      stridepx: 240,
      baseline: 0.72,
      columns: [
        { at: 0.02, height: 0.62, width: 0.3 },
        { at: 0.42, height: 0.5, width: 0.24 },
        { at: 0.76, height: 0.66, width: 0.2 },
      ],
    },
    mid: {
      scrollRate: 0.46,
      stridepx: 130,
      baseline: 0.72,
      columns: [
        { at: 0.1, height: 0.34, width: 0.16 },
        { at: 0.58, height: 0.42, width: 0.14 },
      ],
    },
  },

  // Selenite Core: crowded crystal, tall and tight. The busiest of the five.
  "band.core": {
    bandId: "band.core",
    far: {
      scrollRate: 0.14,
      stridepx: 150,
      baseline: 0.72,
      columns: [
        { at: 0.04, height: 0.72, width: 0.06 },
        { at: 0.2, height: 0.56, width: 0.05 },
        { at: 0.36, height: 0.8, width: 0.07 },
        { at: 0.55, height: 0.6, width: 0.05 },
        { at: 0.72, height: 0.74, width: 0.06 },
        { at: 0.9, height: 0.62, width: 0.05 },
      ],
    },
    mid: {
      scrollRate: 0.44,
      stridepx: 85,
      baseline: 0.72,
      columns: [
        { at: 0.14, height: 0.4, width: 0.07 },
        { at: 0.52, height: 0.5, width: 0.06 },
        { at: 0.8, height: 0.34, width: 0.06 },
      ],
    },
  },
};

/**
 * How many depths a band change takes to fade across. A hard swap at the
 * boundary reads as a glitch; fading over a couple of depths reads as walking.
 */
export const BACKDROP_CROSSFADE_DEPTHS = 2;
