/**
 * Depth bands: one shared vocabulary for "how deep is deep", so encounters,
 * recipe pieces and rewards are all gated against the same axis. Depth
 * increments by one per completed encounter.
 *
 * Bands must tile the axis — contiguous, non-overlapping, starting at zero, with
 * exactly one open-ended band at the top — or a depth would have no eligible
 * encounter and the run would stall. `validateContent` enforces it.
 *
 * Bands are twenty-five deep and the gear ladder is what opens them. A run
 * spends roughly six seconds of oxygen per depth, so a tank level's oxygen is
 * very nearly the depth it reaches:
 *
 *   The Shelf      0 -  24    tank levels 1-3
 *   Deep Seams    25 -  49    tank levels 4-6
 *   The Dark      50 -  74    tank levels 7-8
 *   The Hollows   75 -  99    tank level  9
 *   Selenite Core   100+      tank levels 10-12
 *
 * Measured over 25 seeded runs per tier, maxed gear alone reaches a median depth
 * of 118, every prestige perk takes it to 222, and a full collection to 260.
 * Meta-progression roughly doubles what gear reaches, which is worth knowing
 * before gating content on a depth. Any harness that samples depth must resolve
 * choice encounters, or every run stalls at the first one and reads about 5.
 *
 * The Selenite Core is the exception, and the exception is its point: no content
 * eligible at 100+ grants oxygen. Every other band can refill, so depth there is
 * decided by luck rather than gear; removing the refill turns the tank into a
 * hard budget. The invariant lives in content — no reward table reachable from a
 * `band.core` encounter contains an oxygen grant — and `encounterTable.test.ts`
 * walks the tables rather than naming ids, so a new grant anywhere in the core
 * cannot undo it silently.
 */

export const DEPTH_BAND_IDS = [
  "band.shelf",
  "band.seams",
  "band.dark",
  "band.hollow",
  "band.core",
] as const;

export type DepthBandId = (typeof DEPTH_BAND_IDS)[number];

export interface DepthBandDefinition {
  id: DepthBandId;
  displayName: string;
  /** Inclusive. */
  minimum: number;
  /** Inclusive. `null` on the deepest band, which never ends. */
  maximum: number | null;
}

export const DEPTH_BANDS: Record<DepthBandId, DepthBandDefinition> = {
  "band.shelf": {
    id: "band.shelf",
    displayName: "The Shelf",
    minimum: 0,
    maximum: 24,
  },
  "band.seams": {
    id: "band.seams",
    displayName: "Deep Seams",
    minimum: 25,
    maximum: 49,
  },
  "band.dark": {
    id: "band.dark",
    displayName: "The Dark",
    minimum: 50,
    maximum: 74,
  },
  "band.hollow": {
    id: "band.hollow",
    displayName: "The Hollows",
    minimum: 75,
    maximum: 99,
  },
  "band.core": {
    id: "band.core",
    displayName: "Selenite Core",
    minimum: 100,
    maximum: null,
  },
};

/** Every band from `from` downwards, which is how content declares "this and deeper". */
export function bandsFrom(from: DepthBandId): DepthBandId[] {
  const start = DEPTH_BAND_IDS.indexOf(from);

  return DEPTH_BAND_IDS.slice(start < 0 ? 0 : start) as unknown as DepthBandId[];
}

/**
 * The band a depth falls in. Depth is clamped rather than returning null: a
 * negative depth is not a real state, and the deepest band is open-ended, so
 * every finite depth has an answer.
 */
export function bandForDepth(depth: number): DepthBandDefinition {
  const clamped = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;

  for (const id of DEPTH_BAND_IDS) {
    const band = DEPTH_BANDS[id];

    if (clamped >= band.minimum && (band.maximum === null || clamped <= band.maximum)) {
      return band;
    }
  }

  return DEPTH_BANDS[DEPTH_BAND_IDS[DEPTH_BAND_IDS.length - 1]];
}

export function isDepthBandId(value: unknown): value is DepthBandId {
  return typeof value === "string" && (DEPTH_BAND_IDS as readonly string[]).includes(value);
}
