/**
 * Coverage for the expedition scene. The renderer decides nothing — every value
 * it draws comes from the scene it is handed — which makes it testable without a
 * browser: hand it a fake 2D context, drive it, and read back what it drew.
 *
 * The three things worth pinning are the ones easy to get subtly wrong and
 * impossible to notice: that the bands really differ, that the layers really
 * move at different rates, and that a finished crossfade leaves one backdrop
 * rather than two stacked forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKDROPS, DEPTH_BANDS, DEPTH_BAND_IDS, ECONOMY } from "../../content/catalog";
import { BACKDROP_CROSSFADE_DEPTHS } from "../../content/backdrops";
import { MINER_SKINS, MINER_SKIN_IDS } from "../../content/minerSkins";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";
import {
  createExpeditionRenderer,
  WALK_FRAME_MS,
  WORKING_CYCLE_MS,
  type ExpeditionScene,
} from "../../rendering/expeditionRenderer";

const NOW = 1_700_000_000_000;

interface DrawnRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  alpha: number;
}

/**
 * A 2D context that records rather than paints. The size is a parameter because
 * "the miner and the encounter meet in the middle" cannot be tested at a single
 * width: any fixed position is centred at exactly one of them.
 */
function recordingCanvas(
  width = 640,
  height = 200,
): { canvas: HTMLCanvasElement; drawn: DrawnRect[] } {
  const drawn: DrawnRect[] = [];
  let fillStyle = "#000000";
  let globalAlpha = 1;
  const stack: Array<{ fillStyle: string; globalAlpha: number }> = [];

  const context = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(value: number) {
      globalAlpha = value;
    },
    imageSmoothingEnabled: false,
    font: "",
    save: () => stack.push({ fillStyle, globalAlpha }),
    restore: () => {
      const previous = stack.pop();

      if (previous !== undefined) {
        fillStyle = previous.fillStyle;
        globalAlpha = previous.globalAlpha;
      }
    },
    setTransform: () => undefined,
    fillText: () => undefined,
    fillRect: (x: number, y: number, width: number, height: number) => {
      drawn.push({ x, y, width, height, fill: fillStyle, alpha: globalAlpha });
    },
  };

  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;

  return { canvas, drawn };
}

function scene(patch: Partial<ExpeditionScene> = {}): ExpeditionScene {
  return {
    status: "approaching",
    depth: 0,
    oxygenRatio: 1,
    oxygenIsLow: false,
    encounterSpriteId: null,
    approachRatio: 0,
    resolveRatio: 0,
    durabilityRatio: null,
    resolveElapsedMs: 0,
    encounterFamily: null,
    playerSpriteId: "sprite.player",
    playerStrideSpriteId: "sprite.player.stride",
    reducedMotion: false,
    dissolve: null,
    ...patch,
  };
}

/** The two backdrop greys, which nothing else in the scene uses. */
const FAR = "#1a1a1a";
const MID = "#2b2b2b";

function render(
  current: ExpeditionScene,
  timeMs = 0,
  size?: { width: number; height: number },
): DrawnRect[] {
  const { canvas, drawn } = recordingCanvas(size?.width, size?.height);

  createExpeditionRenderer(canvas).render(current, timeMs);

  return drawn;
}

function backdropOf(drawn: DrawnRect[], fill: string): DrawnRect[] {
  return drawn.filter((rect) => rect.fill === fill && rect.alpha > 0);
}

describe("the backdrop", () => {
  it("draws something behind every band", () => {
    for (const bandId of DEPTH_BAND_IDS) {
      const drawn = render(scene({ depth: DEPTH_BANDS[bandId].minimum + 10 }));

      expect(backdropOf(drawn, FAR).length, bandId).toBeGreaterThan(0);
      expect(backdropOf(drawn, MID).length, bandId).toBeGreaterThan(0);
    }
  });

  it("draws the first band immediately rather than fading it in from nothing", () => {
    // The shelf has no band above it to fade from, so blending it up from zero
    // would leave the opening of every run with no backdrop at all.
    const drawn = render(scene({ depth: 0 }));

    expect(backdropOf(drawn, FAR).length).toBeGreaterThan(0);
    expect(backdropOf(drawn, FAR).every((rect) => rect.alpha === 1)).toBe(true);
  });

  it("gives each band a silhouette of its own", () => {
    // Five places, not one place five times. Compared on the content, which is
    // where the difference is authored.
    const shapes = DEPTH_BAND_IDS.map((bandId) => JSON.stringify(BACKDROPS[bandId]));

    expect(new Set(shapes).size).toBe(DEPTH_BAND_IDS.length);
  });

  it("draws nothing on the surface", () => {
    const drawn = render(scene({ status: "surface" }));

    expect(backdropOf(drawn, FAR)).toHaveLength(0);
    expect(backdropOf(drawn, MID)).toHaveLength(0);
  });
});

describe("parallax", () => {
  /** The leftmost x a layer drew at, which is what moves as it scrolls. */
  function leadingEdge(drawn: DrawnRect[], fill: string): number {
    return Math.min(...backdropOf(drawn, fill).map((rect) => rect.x));
  }

  /**
   * Drives one renderer across several frames, returning what each drew. The
   * single-frame `render` helper cannot be used: scroll is accumulated inside
   * the renderer, so a fresh renderer's first frame has no previous timestamp
   * and therefore no movement, and every one-frame comparison would read zero.
   */
  function renderFrames(frames: Array<{ scene: ExpeditionScene; timeMs: number }>): DrawnRect[][] {
    const { canvas, drawn } = recordingCanvas();
    const renderer = createExpeditionRenderer(canvas);
    const perFrame: DrawnRect[][] = [];
    let consumed = 0;

    for (const frame of frames) {
      renderer.render(frame.scene, frame.timeMs);
      perFrame.push(drawn.slice(consumed));
      consumed = drawn.length;
    }

    return perFrame;
  }

  /** A run of ordinary 16ms frames, all in the same scene. */
  function walk(count: number, patch: Partial<ExpeditionScene>, fromMs = 0) {
    return Array.from({ length: count }, (_, index) => ({
      scene: scene(patch),
      timeMs: fromMs + index * 16,
    }));
  }

  it("moves the two layers at different rates", () => {
    // Distance reads as the difference between the layers rather than any one
    // rate, so what matters is that they disagree.
    const frames = renderFrames(walk(61, { depth: 5 }));
    const before = frames[0];
    const after = frames[frames.length - 1];

    const farMoved = Math.abs(leadingEdge(after, FAR) - leadingEdge(before, FAR));
    const midMoved = Math.abs(leadingEdge(after, MID) - leadingEdge(before, MID));

    expect(farMoved).toBeGreaterThan(0);
    expect(midMoved).toBeGreaterThan(0);
    expect(farMoved).not.toBe(midMoved);
  });

  it("holds the scenery in place between encounters, then resumes from there", () => {
    /*
     * An offset derived as `timeMs * rate` produces two jumps per encounter: one
     * to zero when the walk stops, and one back to wherever absolute time has
     * reached by the next approach — the second sized by how long the player
     * spent deciding. Five seconds at the decision point is what makes that
     * fail loudly here rather than by a frame's worth.
     */
    const frames = renderFrames([
      ...walk(30, { depth: 5 }),
      { scene: scene({ depth: 5, status: "decision" }), timeMs: 480 },
      { scene: scene({ depth: 5, status: "decision" }), timeMs: 5_000 },
      { scene: scene({ depth: 5 }), timeMs: 5_016 },
    ]);

    const stopped = leadingEdge(frames[29], FAR);
    const waiting = leadingEdge(frames[31], FAR);
    const resumed = leadingEdge(frames[32], FAR);

    expect(waiting).toBe(stopped);
    // One 16ms frame of travel, which cannot move a 0.2-rate layer a whole pixel.
    expect(Math.abs(resumed - stopped)).toBeLessThanOrEqual(1);
  });

  it("stops entirely under reduced motion, without removing the backdrop", () => {
    // The setting is about movement: somebody who cannot tolerate scrolling
    // should still see where they are, so both halves are asserted.
    const frames = renderFrames(walk(61, { depth: 5, reducedMotion: true }));
    const before = frames[0];
    const after = frames[frames.length - 1];

    expect(leadingEdge(after, FAR)).toBe(leadingEdge(before, FAR));
    expect(leadingEdge(after, MID)).toBe(leadingEdge(before, MID));
    expect(backdropOf(after, FAR).length).toBeGreaterThan(0);
  });

  it("stops while the run is not travelling", () => {
    // Nothing moves past a player who is standing still resolving an encounter.
    const frames = renderFrames(walk(61, { depth: 5, status: "resolving" }));

    expect(leadingEdge(frames[frames.length - 1], FAR)).toBe(leadingEdge(frames[0], FAR));
  });

  it("does not teleport the scenery after a long gap between frames", () => {
    // A backgrounded tab returns with an enormous delta, so one frame's scroll
    // contribution is clamped and coming back is a step rather than a jump.
    const frames = renderFrames([
      { scene: scene({ depth: 5 }), timeMs: 0 },
      { scene: scene({ depth: 5 }), timeMs: 16 },
      { scene: scene({ depth: 5 }), timeMs: 600_000 },
    ]);

    const beforeGap = leadingEdge(frames[1], FAR);
    const afterGap = leadingEdge(frames[2], FAR);

    // 100ms of clamped travel at rate 0.2 is a couple of pixels, not a stride.
    expect(Math.abs(afterGap - beforeGap)).toBeLessThan(4);
  });
});

describe("crossing a band boundary", () => {
  const secondBand = DEPTH_BAND_IDS[1];
  const start = DEPTH_BANDS[secondBand].minimum;

  it("still shows the band being left, at the moment of crossing", () => {
    // The fade starts at the boundary rather than having finished by it, so the
    // first depth of a new band still looks like the old one.
    const drawn = render(scene({ depth: start }));

    expect(backdropOf(drawn, FAR).every((rect) => rect.alpha === 1)).toBe(true);
  });

  it("draws both bands part-way across", () => {
    // Counted rather than compared by opacity: mid-fade both bands sit at the
    // same alpha, so what marks a crossing is two sets of columns rather than one.
    const midway = backdropOf(render(scene({ depth: start + 1 })), FAR).length;
    const settled = backdropOf(
      render(scene({ depth: start + BACKDROP_CROSSFADE_DEPTHS })),
      FAR,
    ).length;

    expect(midway).toBeGreaterThan(settled);
  });

  it("leaves exactly one band once the crossing is done", () => {
    // The failure this guards is a fade that never finishes: both bands drawn
    // forever, at full opacity, one on top of the other.
    const drawn = render(scene({ depth: start + BACKDROP_CROSSFADE_DEPTHS }));
    const alphas = new Set(backdropOf(drawn, FAR).map((rect) => rect.alpha));

    expect(alphas).toEqual(new Set([1]));
  });

  it("fades rather than cuts", () => {
    // Part-way through, the incoming band is neither absent nor already whole.
    const half = BACKDROP_CROSSFADE_DEPTHS / 2;
    const drawn = render(scene({ depth: start + half }));
    const partial = backdropOf(drawn, FAR).filter((rect) => rect.alpha > 0 && rect.alpha < 1);

    expect(partial.length).toBeGreaterThan(0);
  });
});

describe("an encounter dissolving", () => {
  // The clock is frozen for these: the renderer reads `Date.now()` to advance
  // the dissolve, so two scenes built from two separate reads can straddle a
  // millisecond and compare different moments.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dissolving = (elapsedMs: number): ExpeditionScene =>
    scene({
      status: "reward",
      dissolve: {
        spriteId: "sprite.encounter.ore",
        startedAtMs: NOW - elapsedMs,
        endsAtMs: NOW - elapsedMs + ECONOMY.encounterDissolveMs,
      },
    });

  it("draws fewer of the sprite's pixels as it goes", () => {
    // The whole effect: lit pixels dropping out in a fixed order.
    const early = render(dissolving(0)).length;
    const late = render(dissolving(ECONOMY.encounterDissolveMs * 0.8)).length;

    expect(early).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
  });

  it("draws nothing once it is over", () => {
    const drawn = render(dissolving(ECONOMY.encounterDissolveMs + 50));
    const surface = render(scene({ status: "reward" }));

    expect(drawn.length).toBe(surface.length);
  });

  it("crumbles the same way every time", () => {
    // Derived from each pixel's own position rather than a random draw, so an
    // encounter does not sparkle differently on every run.
    const once = render(dissolving(ECONOMY.encounterDissolveMs / 2));
    const twice = render(dissolving(ECONOMY.encounterDissolveMs / 2));

    expect(twice.length).toBe(once.length);
  });
});

describe("what tells the scene an encounter finished", () => {
  // "Finished 200ms ago" is an event rather than a state: by the next frame the
  // domain has moved on. So the domain announces it once and the app layer owns
  // the timer, as the reward and critical-strike lanes do.
  function runUntil(
    predicate: (result: ReturnType<typeof reduce>) => boolean,
    frames = 400,
  ): ReturnType<typeof reduce> | null {
    let current = reduce(createGameState({ nowUnixMs: NOW, seed: 4 }), {
      type: "LAUNCH_EXPEDITION",
    });

    for (let frame = 0; frame < frames; frame += 1) {
      current = reduce(current.state, {
        type: "TICK",
        casinoElapsedMs: 0,
        expeditionElapsedMs: 250,
        nowUnixMs: current.state.lastSettledAtUnixMs + 250,
      });

      if (predicate(current)) {
        return current;
      }

      if (current.state.expedition.status === "decision") {
        current = reduce(current.state, { type: "CONTINUE_EXPEDITION" });
      }
    }

    return null;
  }

  it("announces a completed encounter exactly once, with what to dissolve", () => {
    const completed = runUntil((result) =>
      result.effects.some((effect) => effect.type === "SHOW_ENCOUNTER_COMPLETE"),
    );

    expect(completed).not.toBeNull();

    const announcements = (completed?.effects ?? []).filter(
      (effect) => effect.type === "SHOW_ENCOUNTER_COMPLETE",
    );

    expect(announcements).toHaveLength(1);
    expect(
      announcements[0].type === "SHOW_ENCOUNTER_COMPLETE" ? announcements[0].spriteId : "",
    ).toMatch(/^sprite\./);
  });

  it("arrives on the same tick as the reward, so the two agree on screen", () => {
    const completed = runUntil((result) =>
      result.effects.some((effect) => effect.type === "SHOW_ENCOUNTER_COMPLETE"),
    );

    expect(
      (completed?.effects ?? []).some((effect) => effect.type === "SHOW_ENCOUNTER_REWARD"),
    ).toBe(true);
  });

  it("says nothing when a run fails", () => {
    // A run that ran out of air did not finish what it was doing, and the
    // failure has its own presentation — the case a renderer-local timer could
    // not tell apart.
    let launched = reduce(createGameState({ nowUnixMs: NOW, seed: 4 }), {
      type: "LAUNCH_EXPEDITION",
    }).state;

    // Past the launch transition first: oxygen does not drain until the walk has
    // begun, so a run cannot fail while still launching.
    while (launched.expedition.status === "launching") {
      launched = reduce(launched, {
        type: "TICK",
        casinoElapsedMs: 0,
        expeditionElapsedMs: 250,
        nowUnixMs: launched.lastSettledAtUnixMs + 250,
      }).state;
    }

    const gasping: GameState = {
      ...launched,
      expedition: { ...launched.expedition, oxygen: 0.25 },
    };
    const failed = reduce(gasping, {
      type: "TICK",
      casinoElapsedMs: 0,
      expeditionElapsedMs: 500,
      nowUnixMs: gasping.lastSettledAtUnixMs + 500,
    });

    expect(failed.state.expedition.status).toBe("surface");
    expect(failed.effects.some((effect) => effect.type === "SHOW_ENCOUNTER_COMPLETE")).toBe(
      false,
    );
  });
});

/**
 * The miner's skin reaches the canvas. The link from the worn skin to the pixels
 * is three lines across three files, exactly the kind of chain that type-checks
 * while doing nothing — asserted here against the recording canvas rather than
 * in a browser, where `getImageData` returns zeros in the preview pane and a
 * screenshot of a 24px sprite proves little.
 */
describe("the dissolve", () => {
  /*
   * `drawDissolve` covers the gap left when `currentEncounter` is cleared — but
   * it is not cleared on the way into `"reward"`, so without the guard the
   * renderer draws the sprite and a fading crumbling copy of it in the same
   * place. Invisible at 450ms; very visible once a cat holds the frame.
   */
  const spritePixels = (drawn: DrawnRect[]): DrawnRect[] =>
    drawn.filter((rect) => rect.width === rect.height && rect.width > 1);

  const dissolving = {
    spriteId: "sprite.encounter.seam",
    startedAtMs: Date.now(),
    endsAtMs: Date.now() + 10_000,
  };

  it("stands aside while the encounter is still on screen", () => {
    const staged = spritePixels(
      render(scene({ status: "reward", encounterSpriteId: "sprite.encounter.seam", approachRatio: 1 })),
    );
    const withDissolve = spritePixels(
      render(
        scene({
          status: "reward",
          encounterSpriteId: "sprite.encounter.seam",
          approachRatio: 1,
          dissolve: dissolving,
        }),
      ),
    );

    expect(staged.length).toBeGreaterThan(0);
    // Not one pixel more: the encounter is drawn once, not twice.
    expect(withDissolve.length).toBe(staged.length);
  });

  it("still draws once the encounter is gone", () => {
    // Which is the case it was written for, and must keep working.
    const cleared = spritePixels(render(scene({ status: "reward", encounterSpriteId: null })));
    const covered = spritePixels(
      render(scene({ status: "reward", encounterSpriteId: null, dissolve: dissolving })),
    );

    expect(covered.length).toBeGreaterThan(cleared.length);
  });
});

describe("the miner sprite", () => {
  /** Sprite pixels are square; the terrain and the bars are not. */
  const spritePixels = (drawn: DrawnRect[]): DrawnRect[] =>
    drawn.filter((rect) => rect.width === rect.height && rect.width > 1);

  /**
   * The pixels a render lit, as a position set. Shapes rather than counts,
   * because two different sprites could light the same number of cells.
   */
  const shapeOf = (rects: DrawnRect[]): string =>
    rects
      .map((rect) => `${String(rect.x)},${String(rect.y)}`)
      .sort()
      .join(" ");

  it("draws whatever skin the scene names, not a fixed one", () => {
    // On the surface, stated rather than left at the default: the status is what
    // decides which frame is drawn, so a default could compare two identical
    // renders and pass nothing.
    const standard = spritePixels(
      render(scene({ status: "surface", playerSpriteId: "sprite.player" })),
    );
    const visitor = spritePixels(
      render(scene({ status: "surface", playerSpriteId: "sprite.miner.visitor" })),
    );

    expect(standard.length).toBeGreaterThan(0);
    expect(visitor.length).toBeGreaterThan(0);
    expect(shapeOf(standard)).not.toBe(shapeOf(visitor));
  });

  it("turns to face an encounter, and only then", () => {
    // One direction, always: the miner looks the same in every state, so nothing
    // about the run can turn them round by accident.
    const looks = { playerSpriteId: "sprite.player" };
    const cellsAt = (patch: Partial<ExpeditionScene>): Set<string> =>
      new Set(
        spritePixels(render(scene({ ...looks, reducedMotion: true, ...patch }))).map(
          (rect) => `${String(rect.x)},${String(rect.y)}`,
        ),
      );

    const surface = cellsAt({ status: "surface" });

    expect(surface.size).toBeGreaterThan(0);

    for (const status of ["approaching", "resolving", "decision", "choice", "reward"] as const) {
      expect([...cellsAt({ status })].sort().join(" "), status).toBe([...surface].sort().join(" "));

      // With an encounter staged. A subset check rather than an equality,
      // because `spritePixels` collects every square cell on the canvas and the
      // encounter's own sprite is made of those too.
      const staged = cellsAt({
        status,
        approachRatio: 1,
        encounterSpriteId: "sprite.encounter.ore",
      });

      for (const cell of surface) {
        expect(staged.has(cell), `${status}: miner cell ${cell} moved`).toBe(true);
      }
    }
  });

  it("steps through two frames while walking, and holds one when it stops", () => {
    /*
     * A sine wave on the body's y is the only thing that moves, so the miner
     * slides along with both legs welded together — and keyed off "not on the
     * surface" it never stops, bobbing while planted at a rock. Frames answer
     * both: they advance only while approaching, so the walk stops when the
     * walking does.
     */
    const looks = {
      playerSpriteId: "sprite.player",
      playerStrideSpriteId: "sprite.player.stride",
    };
    const at = (patch: Partial<ExpeditionScene>, timeMs: number): string =>
      shapeOf(spritePixels(render(scene({ ...looks, ...patch }), timeMs)));

    // Half a cycle apart, which is one frame either side of the swap.
    const planted = at({ status: "approaching" }, 0);
    const striding = at({ status: "approaching" }, WALK_FRAME_MS);

    expect(planted).not.toBe(striding);
    // And it comes back round rather than walking off into a third frame.
    expect(at({ status: "approaching" }, WALK_FRAME_MS * 2)).toBe(planted);

    // Standing still is one frame whatever the clock does, asserted across every
    // state a time-driven bob would keep running in.
    for (const status of ["surface", "resolving", "decision"] as const) {
      expect(at({ status }, WALK_FRAME_MS), status).toBe(at({ status }, 0));
    }

    // Reduced motion holds the planted frame even while travelling.
    expect(at({ status: "approaching", reducedMotion: true }, WALK_FRAME_MS)).toBe(
      at({ status: "approaching", reducedMotion: true }, 0),
    );
  });

  it("draws every skin the content offers", () => {
    // A sprite id that names nothing draws nothing and fails silently on the
    // canvas; here it is a count of zero.
    for (const skinId of MINER_SKIN_IDS) {
      const drawn = spritePixels(
        render(
          scene({
            status: "approaching",
            reducedMotion: true,
            playerSpriteId: MINER_SKINS[skinId].spriteId,
          }),
        ),
      );

      expect(drawn.length, skinId).toBeGreaterThan(0);
    }
  });
});

/**
 * The pickaxe, on the domain's own strike clock. Swinging on the wall clock
 * drifts continuously from the strike the domain lands every
 * `ECONOMY.pickaxeStrikeIntervalMs`, so no swing ever appears to land. These pin
 * the property that replaced it: the picture is a function of
 * `resolveElapsedMs`, so it cannot drift by construction.
 */
describe("the pickaxe swing", () => {
  const squares = (drawn: DrawnRect[]): DrawnRect[] =>
    drawn.filter((rect) => rect.width === rect.height && rect.width > 1);

  const mining = (resolveElapsedMs: number, patch: Partial<ExpeditionScene> = {}) =>
    squares(
      render(
        scene({
          status: "resolving",
          approachRatio: 1,
          encounterSpriteId: "sprite.encounter.ore",
          encounterFamily: "ore",
          durabilityRatio: 0.5,
          resolveElapsedMs,
          ...patch,
        }),
      ),
    );

  /**
   * The tool's own cells, by differencing against the same frame with motion
   * off. "How far right does the drawing reach" does not work: the encounter
   * sprite always sits further right than the pickaxe, so every such measurement
   * comes back as the rock's edge. Reduced motion draws the miner and the rock
   * and no tool at all, which makes it an exact mask.
   */
  const toolCells = (patch: Partial<ExpeditionScene>, timeMs = 0): DrawnRect[] => {
    const withMotion = squares(render(scene({ ...patch, reducedMotion: false }), timeMs));
    const still = new Set(
      squares(render(scene({ ...patch, reducedMotion: true }), timeMs)).map(
        (rect) => `${String(rect.x)},${String(rect.y)}`,
      ),
    );

    return withMotion.filter((rect) => !still.has(`${String(rect.x)},${String(rect.y)}`));
  };

  /** How far right the tool reaches. */
  const reach = (drawn: DrawnRect[]): number => Math.max(...drawn.map((rect) => rect.x));

  it("moves the tool through the interval rather than holding it still", () => {
    // Four samples across one strike interval, which is four different poses.
    // Movement alone is not the claim; the next test is about the clock.
    const interval = ECONOMY.pickaxeStrikeIntervalMs;
    const shapes = [0.1, 0.4, 0.75, 0.95].map((fraction) =>
      mining(interval * fraction)
        .map((rect) => `${String(rect.x)},${String(rect.y)}`)
        .sort()
        .join(" "),
    );

    expect(new Set(shapes).size, "four samples, four poses").toBe(4);
  });

  it("lands the head forward at the end of every interval, not the middle", () => {
    /*
     * The shape of the swing: two thirds winding up and back, the last third
     * falling forward, so the drawing reaches furthest right just before the
     * interval wraps — the frame the domain lands its strike on. Checked across
     * three consecutive intervals, which is the claim a wall clock cannot make.
     */
    const interval = ECONOMY.pickaxeStrikeIntervalMs;
    const ore = {
      status: "resolving" as const,
      approachRatio: 1,
      encounterSpriteId: "sprite.encounter.ore",
      encounterFamily: "ore",
      durabilityRatio: 0.5,
    };

    for (const cycle of [0, 1, 2]) {
      const base = interval * cycle;
      const windUp = reach(toolCells({ ...ore, resolveElapsedMs: base + interval * 0.2 }));
      const contact = reach(toolCells({ ...ore, resolveElapsedMs: base + interval * 0.95 }));

      expect(contact, `cycle ${String(cycle)}`).toBeGreaterThan(windUp);
    }
  });

  it("marks the rock only while the head is against it", () => {
    // The impact mark is drawn at the encounter's near edge and only in the
    // contact pose, so the widest reach and the mark arrive together.
    const interval = ECONOMY.pickaxeStrikeIntervalMs;
    const early = mining(interval * 0.2).length;
    const contact = mining(interval * 0.95).length;

    expect(contact).toBeGreaterThan(early);
  });

  it("reaches for something that is not a rock, rather than swinging at it", () => {
    /*
     * The non-mining gesture: no tool at all, and the miner reaches low and
     * short without ever arriving.
     *
     * Isolated as "everything drawn past the body's own right edge" rather than
     * by differencing against a reduced-motion frame. The difference trick works
     * only while the body never moves, and the reach leans a cell — so every
     * body cell lands somewhere new and the diff returns the figure as well as
     * the arm, answering "how high does this gesture go" with the helmet.
     */
    const beyondBody = (patch: Partial<ExpeditionScene>, timeMs: number): DrawnRect[] => {
      const edge = Math.max(
        ...squares(render(scene({ ...patch, reducedMotion: true }), timeMs)).map((r) => r.x),
      );

      return squares(render(scene({ ...patch, reducedMotion: false }), timeMs)).filter(
        (rect) => rect.x > edge,
      );
    };

    /*
     * No encounter sprite staged, doing two jobs. `beyondBody` takes the
     * rightmost thing drawn as the body's edge, and a staged rock sits further
     * right than either gesture reaches, so nothing would be beyond the body.
     * Leaving it off also suppresses the impact mark, which is drawn at the
     * rock's near edge and would count toward how far the pickaxe travels.
     */
    const resolving = (family: string, resolveElapsedMs: number) => ({
      status: "resolving" as const,
      approachRatio: 1,
      encounterSpriteId: null,
      encounterFamily: family,
      resolveElapsedMs,
      durabilityRatio: family === "ore" ? 0.5 : null,
    });

    const ore = (fraction: number) =>
      beyondBody(resolving("ore", ECONOMY.pickaxeStrikeIntervalMs * fraction), 0);
    const hazard = beyondBody(resolving("hazard", 0), WORKING_CYCLE_MS);

    expect(hazard.length).toBeGreaterThan(0);

    // Shorter than the swing at its furthest, measured across an interval rather
    // than at one instant: the swing recoils a cell at contact, so the frame it
    // looks longest in is the fall rather than the landing.
    const phases = [0.1, 0.3, 0.45, 0.6, 0.75, 0.95];
    const swingReach = Math.max(...phases.map((f) => reach(ore(f))));

    expect(reach(hazard)).toBeLessThan(swingReach);

    // And lower, compared against the swing's high point rather than its contact
    // pose, where the head is down at the rock's foot. What separates the
    // gestures is that the swing clears the miner's head at some point in every
    // interval and the reach never leaves the arm's own rows.
    const highest = (cells: DrawnRect[]): number => Math.min(...cells.map((r) => r.y));
    const swingApex = Math.min(...phases.map((f) => highest(ore(f))));

    expect(highest(hazard)).toBeGreaterThan(swingApex);
  });

  it("leans the body into the reach rather than waving an arm at it", () => {
    // The lean, measured on the miner rather than the arm, since the whole
    // figure shifts — and forward, where the swing's recoil goes backward.
    const body = (timeMs: number): DrawnRect[] =>
      squares(
        render(
          scene({
            status: "resolving",
            approachRatio: 1,
            encounterSpriteId: "sprite.encounter.ore",
            encounterFamily: "supply",
            durabilityRatio: null,
          }),
          timeMs,
        ),
      );

    const leftmost = (cells: DrawnRect[]): number => Math.min(...cells.map((r) => r.x));

    expect(leftmost(body(WORKING_CYCLE_MS))).toBeGreaterThan(leftmost(body(0)));
  });

  it("draws no tool at all under reduced motion", () => {
    /*
     * The accessibility contract, and what keeps the meeting-point measurement
     * below honest: every cell of a drawn pickaxe is a square rect, and that
     * helper measures square rects while passing `reducedMotion: true`.
     *
     * Asserted as "elapsed time changes nothing" rather than as a count — no
     * tool and no recoil — since a count would pass a frame that had merely lost
     * some of the pickaxe.
     */
    const interval = ECONOMY.pickaxeStrikeIntervalMs;
    const shapeAt = (fraction: number): string =>
      mining(interval * fraction, { reducedMotion: true })
        .map((rect) => `${String(rect.x)},${String(rect.y)}`)
        .sort()
        .join(" ");

    const windUp = shapeAt(0.2);

    expect(shapeAt(0.95)).toBe(windUp);
    expect(shapeAt(0.5)).toBe(windUp);

    // And the same frame with motion on differs, so this is a real setting
    // rather than a scene that never animated.
    const moving = mining(interval * 0.95)
      .map((rect) => `${String(rect.x)},${String(rect.y)}`)
      .sort()
      .join(" ");

    expect(moving).not.toBe(windUp);
  });
});

describe("where the miner and the encounter meet", () => {
  /** Sprite pixels are square; the terrain, the bars and the strike are not. */
  const spritePixels = (drawn: DrawnRect[]): DrawnRect[] =>
    drawn.filter((rect) => rect.width === rect.height && rect.width > 1);

  /**
   * The pair, fully arrived, as the span of canvas they occupy.
   * `approachRatio: 1` is the encounter at its stopping point, which is the only
   * moment "where they meet" has an answer.
   */
  const meeting = (
    width: number,
  ): { left: number; right: number; midpoint: number; centre: number } => {
    const drawn = spritePixels(
      render(
        scene({
          status: "resolving",
          approachRatio: 1,
          encounterSpriteId: "sprite.encounter.ore",
          playerSpriteId: "sprite.player",
          reducedMotion: true,
        }),
        0,
        { width, height: 200 },
      ),
    );

    const xs = drawn.map((rect) => rect.x);
    const rights = drawn.map((rect) => rect.x + rect.width);
    const left = Math.min(...xs);
    const right = Math.max(...rights);

    return { left, right, midpoint: (left + right) / 2, centre: width / 2 };
  };

  it("centres the pair on the canvas, at any width", () => {
    /*
     * A `playerX` of `width * 0.28` puts the meeting point about 29% across,
     * huddled on the left with two thirds of the scene empty ahead. Several
     * widths, because a fixed ratio is centred at exactly one of them. The
     * tolerance is a sprite cell: the sprites are drawn on a pixel grid at an
     * integer scale, so the midpoint lands within a cell of the centre.
     */
    for (const width of [480, 640, 1020, 1600]) {
      const { midpoint, centre } = meeting(width);

      expect(Math.abs(midpoint - centre), `${String(width)}px canvas`).toBeLessThanOrEqual(12);
    }
  });

  it("keeps the pair on the canvas rather than centring it off the edge", () => {
    // The clamp: a canvas narrower than the pair needs still draws both starting
    // inside it, which is a preview pane rather than a real window.
    const { left, right } = meeting(200);

    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThan(left);
  });

  it("still leaves the encounter a walk in from the right", () => {
    // Centring moves where they stop, not where the encounter starts: if the two
    // coincided the approach would be a jump.
    const start = spritePixels(
      render(
        scene({ approachRatio: 0, encounterSpriteId: "sprite.encounter.ore" }),
        0,
        { width: 1020, height: 200 },
      ),
    );
    const end = spritePixels(
      render(
        scene({ approachRatio: 1, encounterSpriteId: "sprite.encounter.ore" }),
        0,
        { width: 1020, height: 200 },
      ),
    );

    expect(Math.max(...start.map((rect) => rect.x))).toBeGreaterThan(
      Math.max(...end.map((rect) => rect.x)) + 100,
    );
  });
});
