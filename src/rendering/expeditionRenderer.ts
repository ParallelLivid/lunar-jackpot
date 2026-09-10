/**
 * Canvas 2D expedition scene.
 *
 * The player stays near the centre while terrain and the approaching encounter
 * move right to left, which produces the illusion of forward travel. Every
 * value drawn here comes from domain state; the renderer decides nothing.
 */

import { SPRITE_GRID, drawSprite, spriteRows } from "./sprites";
import { BACKDROPS, BACKDROP_CROSSFADE_DEPTHS } from "../content/backdrops";
import type { BackdropLayer } from "../content/backdrops";
import { DEPTH_BAND_IDS, bandForDepth } from "../content/depthBands";
import { ECONOMY } from "../content/economy";
import type { ExpeditionStatus } from "../domain/state";

/**
 * An encounter playing out its end, handed over by the app's dissolve lane.
 * Carries wall-clock stamps rather than a progress fraction, because progress
 * advances every frame while the scene is only rebuilt when domain state changes.
 */
export interface SceneDissolve {
  spriteId: string;
  startedAtMs: number;
  endsAtMs: number;
}

export interface ExpeditionScene {
  status: ExpeditionStatus;
  depth: number;
  oxygenRatio: number;
  oxygenIsLow: boolean;
  encounterSpriteId: string | null;
  /** 0 while the encounter is far away, 1 when it reaches the decision point. */
  approachRatio: number;
  resolveRatio: number;
  durabilityRatio: number | null;
  reducedMotion: boolean;
  /** Set while an encounter is dissolving after finishing. */
  dissolve: SceneDissolve | null;
  /** Which miner to draw. Presentation only; nothing downstream reads it. */
  playerSpriteId: string;
  /** The same skin mid-stride. Alternated with the above while approaching. */
  playerStrideSpriteId: string;
  /**
   * Milliseconds this encounter has spent resolving, straight from the domain.
   * The swing runs on this and nothing else: the domain lands a strike every
   * `ECONOMY.pickaxeStrikeIntervalMs`, so running the animation on the wall
   * clock would let the picture and the sound drift apart. Safe to read every
   * frame, since the runtime clock ticks the domain once per animation frame.
   */
  resolveElapsedMs: number;
  /**
   * Which kind of encounter is being resolved, so the miner does the right thing
   * at it, or null between encounters. `"ore"` swings a pickaxe at a rock;
   * everything else reaches for it without making contact.
   */
  encounterFamily: string | null;
}

export interface ExpeditionRenderer {
  render(scene: ExpeditionScene, timeMs: number): void;
  resize(): void;
  dispose(): void;
}

/**
 * How far ahead of the miner an arriving encounter stops. Measured in sprite
 * pixels rather than a fraction of the width, so the two meet just as closely on
 * any canvas. Only the distance travelled changes with width; the approach
 * duration is a content value, so oxygen spend never depends on window size.
 */
const APPROACH_GAP_CELLS = 3;

/**
 * Where the miner stands, so the gap they meet across sits in the middle.
 *
 * Solved rather than tuned: the gap and the sprite are measured in pixels, so any
 * fixed ratio is only correct at one width. Putting the middle of the gap at
 * `width / 2` makes the pair symmetric about the centre at every width:
 *
 *     miner      [playerX, playerX + spriteHeight]
 *     gap        centred on width / 2
 *     encounter  [playerX + spriteHeight + gap, ... + spriteHeight]
 *
 * The clamp keeps the miner on the canvas when the scene is narrower than the
 * pair needs.
 */
function playerX(width: number, spriteHeight: number, scale: number): number {
  const gap = APPROACH_GAP_CELLS * scale;

  return Math.max(scale * 2, Math.round(width / 2 - spriteHeight - gap / 2));
}

const BACKGROUND = "#050505";
const TERRAIN = "#585858";
const HIGHLIGHT = "#f5f5f5";
const DIM = "#a8a8a8";
/* The two backdrop layers, dark enough to stay behind the terrain line. */
const BACKDROP_FAR = "#1a1a1a";
const BACKDROP_MID = "#2b2b2b";

/** Pixels of terrain scroll per millisecond of travel. */
const SCROLL_RATE = 0.06;

/**
 * The pickaxe, as four hand-placed poses in sprite cells. Authored positions
 * rather than a rotation: the canvas draws at scale 2 on a small panel, where a
 * rotated `fillRect` line is a scatter of single pixels rather than a tool.
 *
 * Coordinates are `[column, row]` offsets from the miner sprite's top-left, in
 * cells. Every facing sprite puts the forward hand at columns 9-10 on rows 6-7,
 * where each pose begins, and columns past 11 reach beyond the sprite toward the
 * encounter at column 15.
 *
 * Every cell sits at column 10 or beyond, which is a constraint: the miner and
 * the tool are the same white, so an arc that wound back over the shoulder would
 * be invisible inside the silhouette. The arc is in front of the body — raise,
 * fall, land — and `SWING_WINDUP` is where the slow half ends.
 */
type ToolPose = readonly (readonly [number, number])[];

const SWING_POSES: readonly ToolPose[] = [
  // Lifting: the head starts to come up and forward.
  [[10, 6], [11, 5], [12, 4], [12, 3], [13, 3], [13, 4]],
  // The top of the arc, head above and ahead.
  [[10, 6], [11, 5], [11, 4], [12, 3], [12, 2], [11, 1], [12, 1], [13, 1]],
  // Falling forward.
  [[10, 6], [11, 6], [12, 6], [13, 6], [13, 5], [14, 5], [14, 6]],
  // Contact: the head is down at the rock's near edge.
  [[10, 7], [11, 7], [12, 8], [13, 8], [13, 9], [14, 9], [14, 10]],
];

/**
 * Reaching for something that is not a rock. No tool at all: its absence is the
 * strongest contrast a swing can have. What is drawn is a forearm and hand
 * extending from the shoulder at chest height, with the miner leaning a cell
 * into it — see `REACH_LEAN_CELLS`.
 *
 * Low, short and level. The swing rises to row 1 and drives out to column 14;
 * the reach stays on rows 6-8 and stops at column 12, or 13 with the lean —
 * short of both the swing's extent and the rock at column 15. The lean counts
 * toward that extent, since the body moving is part of how far the arm gets.
 *
 * The tests compare whole poses rather than asserting that no cell is shared:
 * both gestures hang off the same forward hand, so the wrist cell is common to
 * both by construction.
 */
const REACH_POSES: readonly ToolPose[] = [
  // Drawn back: the arm folded down at the body.
  [[10, 6], [11, 7]],
  // Extended: forearm out and slightly down, hand open at the end of it.
  [[10, 6], [11, 7], [12, 7], [12, 8]],
];

/**
 * How far the miner leans in on the extended beat, in sprite cells. Forward,
 * where the swing's recoil is backward, so the two gestures move the body in
 * opposite directions as well as moving different things.
 */
const REACH_LEAN_CELLS = 1;

/** Fraction of a strike interval spent winding up, before the fall. */
const SWING_WINDUP = 0.65;

/** Where in the interval contact begins — the last pose, and the impact mark. */
const SWING_CONTACT = 0.87;

/** How long one lean of the non-mining gesture takes, in milliseconds. */
export const WORKING_CYCLE_MS = 900;

/**
 * How long the miner holds each of their two frames while walking: about three
 * strides a second at the terrain's `SCROLL_RATE`, which reads as neither a
 * skate nor a sprint beside scenery moving at 0.06px per millisecond.
 */
export const WALK_FRAME_MS = 320;

/**
 * The longest frame that may contribute to the scroll, so a backgrounded tab
 * returning with an enormous delta cannot teleport the scenery. The same
 * reasoning as `ECONOMY.maxActiveTickMs`, at presentation scale.
 */
const MAX_SCROLL_FRAME_MS = 100;

export function createExpeditionRenderer(canvas: HTMLCanvasElement): ExpeditionRenderer {
  const context = canvas.getContext("2d");

  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 200;
  let pixelRatio = 1;

  /**
   * How far the world has scrolled, accumulated rather than derived from the
   * clock: deriving it makes the scenery jump whenever the run stops and starts,
   * by however long the player spent at the decision point. Accumulating leaves
   * it exactly where it stopped.
   */
  let scrollPx = 0;
  let lastFrameMs: number | null = null;

  const resize = (): void => {
    // Read defensively rather than assuming a browser: everything else here is
    // arithmetic, so guarding this one global keeps the renderer drivable from a
    // test with a recording canvas.
    pixelRatio = Math.max(1, Math.floor(globalThis.window?.devicePixelRatio ?? 1));
    width = canvas.clientWidth || width;
    height = canvas.clientHeight || height;
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);

    if (context !== null) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.imageSmoothingEnabled = false;
    }
  };

  resize();

  const drawTerrain = (): void => {
    if (context === null) {
      return;
    }

    const groundY = Math.floor(height * 0.72);
    context.fillStyle = TERRAIN;
    context.fillRect(0, groundY, width, 2);

    const scroll = scrollPx % 32;

    // Regolith ticks give the scroll a readable cadence at full speed; the
    // backdrop layers behind move slower, which is what reads as distance.
    for (let x = -32; x < width + 32; x += 32) {
      const position = Math.floor(x - scroll);
      context.fillStyle = DIM;
      context.fillRect(position, groundY + 6, 10, 2);
      context.fillRect(position + 16, groundY + 12, 6, 2);
    }
  };

  /**
   * One repeating silhouette strip, scrolled at its own rate. `alpha` is what
   * makes a band change a fade rather than a cut; at alpha 0 nothing is drawn,
   * so a finished crossfade leaves one backdrop rather than two.
   */
  const drawBackdropLayer = (
    layer: BackdropLayer,
    colour: string,
    alpha: number,
    scroll: number,
  ): void => {
    if (context === null || alpha <= 0) {
      return;
    }

    const baseline = Math.floor(height * layer.baseline);
    const stride = layer.stridepx;
    const offset = ((scroll * layer.scrollRate) % stride + stride) % stride;

    context.save();
    context.globalAlpha = Math.min(1, alpha);
    context.fillStyle = colour;

    for (let origin = -stride; origin < width + stride; origin += stride) {
      for (const column of layer.columns) {
        const x = Math.floor(origin - offset + column.at * stride);
        const columnWidth = Math.max(1, Math.floor(column.width * stride));
        const columnHeight = Math.floor(column.height * baseline);

        context.fillRect(x, baseline - columnHeight, columnWidth, columnHeight);
      }
    }

    context.restore();
  };

  /**
   * The backdrop for the current depth, crossfading across a band boundary.
   * Reduced motion stops the parallax, not the backdrop: the setting is about
   * movement, and somebody who cannot tolerate scrolling should still see where
   * they are.
   */
  const drawBackdrop = (scene: ExpeditionScene): void => {
    if (context === null || scene.status === "surface") {
      return;
    }

    const scroll = scrollPx;
    const band = bandForDepth(scene.depth);
    const backdrop = BACKDROPS[band.id];

    // How far into this band the run is: within the first couple of depths the
    // previous band is still fading out. The first band has no predecessor and
    // does not fade in, or every run would open with no backdrop at all.
    const index = DEPTH_BAND_IDS.indexOf(band.id);
    const previousId = index > 0 ? DEPTH_BAND_IDS[index - 1] : null;
    const intoBand = scene.depth - band.minimum;
    const blend =
      previousId === null
        ? 1
        : Math.min(1, Math.max(0, intoBand / BACKDROP_CROSSFADE_DEPTHS));

    if (previousId !== null && blend < 1) {
      const fadingOut = BACKDROPS[previousId];

      drawBackdropLayer(fadingOut.far, BACKDROP_FAR, 1 - blend, scroll);
      drawBackdropLayer(fadingOut.mid, BACKDROP_MID, 1 - blend, scroll);
    }

    drawBackdropLayer(backdrop.far, BACKDROP_FAR, blend, scroll);
    drawBackdropLayer(backdrop.mid, BACKDROP_MID, blend, scroll);
  };

  /**
   * An encounter coming apart after it finished. The sprite's lit pixels are
   * dropped in a fixed, position-derived order, so the same encounter always
   * crumbles the same way, drifting upward and fading as it goes.
   *
   * Drawn where the encounter stood, for the frames after the domain has moved
   * on and `drawEncounter` has nothing left to draw there.
   */
  const drawDissolve = (scene: ExpeditionScene): void => {
    // Only once the encounter itself is gone. `currentEncounter` survives into
    // the reward beat so the decision can show what was found, and without this
    // guard the dissolve would crumble over a sprite still being drawn solidly.
    if (context === null || scene.dissolve === null || scene.encounterSpriteId !== null) {
      return;
    }

    const span = scene.dissolve.endsAtMs - scene.dissolve.startedAtMs;
    const elapsed = Date.now() - scene.dissolve.startedAtMs;
    const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / span));

    if (progress >= 1) {
      return;
    }

    const scale = Math.max(2, Math.floor(height / 60));
    const spriteHeight = SPRITE_GRID * scale;
    const groundY = Math.floor(height * 0.72);
    const startX = width - spriteHeight - 8;
    const endX = Math.min(
      startX,
      playerX(width, spriteHeight, scale) + spriteHeight + APPROACH_GAP_CELLS * scale,
    );
    const rise = Math.round(progress * scale * 4);
    const rows = spriteRows(scene.dissolve.spriteId);

    context.save();
    context.globalAlpha = 1 - progress;
    context.fillStyle = DIM;

    for (let row = 0; row < rows.length; row += 1) {
      const line = rows[row];

      for (let column = 0; column < line.length; column += 1) {
        if (line[column] === ".") {
          continue;
        }

        // A stable pseudo-random order from the pixel's own position: no state,
        // no RNG, and identical every time the same sprite dissolves.
        const rank = ((row * 7 + column * 13) % 12) / 12;

        if (rank < progress) {
          continue;
        }

        context.fillRect(
          endX + column * scale,
          groundY - spriteHeight + row * scale - rise,
          scale,
          scale,
        );
      }
    }

    context.restore();
  };

  /**
   * Where the encounter's sprite is drawn, given how far it has approached.
   * Shared with the impact mark, so that lands on the encounter's near edge
   * rather than at a guessed offset from the miner.
   */
  const encounterX = (approachRatio: number, scale: number, spriteHeight: number): number => {
    const startX = width - spriteHeight - 8;
    const endX = Math.min(
      startX,
      playerX(width, spriteHeight, scale) + spriteHeight + APPROACH_GAP_CELLS * scale,
    );
    const ratio = Math.max(0, Math.min(1, approachRatio));

    return Math.floor(startX + (endX - startX) * ratio);
  };

  /** Draws one authored pose, in cells offset from the miner's top-left. */
  const drawTool = (pose: ToolPose, originX: number, originY: number, scale: number): void => {
    if (context === null) {
      return;
    }

    context.fillStyle = HIGHLIGHT;

    for (const [column, row] of pose) {
      context.fillRect(originX + column * scale, originY + row * scale, scale, scale);
    }
  };

  const drawPlayer = (scene: ExpeditionScene, timeMs: number): void => {
    if (context === null) {
      return;
    }

    const scale = Math.max(2, Math.floor(height / 60));
    const spriteHeight = SPRITE_GRID * scale;
    const groundY = Math.floor(height * 0.72);
    // The walk is two frames rather than a vertical bob. They advance only while
    // an encounter is approaching, which is the only time the miner is
    // travelling, so the walk stops when the walking does.
    const walking = scene.status === "approaching" && !scene.reducedMotion;
    const striding = walking && Math.floor(timeMs / WALK_FRAME_MS) % 2 === 1;

    // The miner faces one way, always: there is one profile sprite per skin and
    // nothing to choose between.
    const resolvingOre = scene.status === "resolving" && scene.encounterFamily === "ore";
    const phase = resolvingOre
      ? (scene.resolveElapsedMs % ECONOMY.pickaxeStrikeIntervalMs) /
        ECONOMY.pickaxeStrikeIntervalMs
      : 0;
    // The recoil: one cell for two or three frames as the head lands. A swing
    // that arrives at a stationary body reads as a wave.
    const recoil = resolvingOre && !scene.reducedMotion && phase >= SWING_CONTACT ? scale : 0;

    // The reach's lean, applied to the body rather than the arm alone — the arm
    // is the detail on top of it. Forward, where the recoil above is backward.
    const reaching = scene.status === "resolving" && !resolvingOre && !scene.reducedMotion;
    const extendedReach =
      reaching && Math.floor(timeMs / WORKING_CYCLE_MS) % REACH_POSES.length === 1;
    const lean = extendedReach ? REACH_LEAN_CELLS * scale : 0;

    const originX = playerX(width, spriteHeight, scale) - recoil + lean;
    const originY = groundY - spriteHeight;

    drawSprite(context, striding ? scene.playerStrideSpriteId : scene.playerSpriteId, {
      x: originX,
      y: originY,
      scale,
    });

    // Everything below is motion, which reduced motion turns off. It also keeps
    // `expeditionScene.test.ts`'s meeting-point measurement valid: that helper
    // measures square rects, and every cell of a drawn pickaxe is one.
    if (scene.status !== "resolving" || scene.reducedMotion) {
      return;
    }

    if (!resolvingOre) {
      /*
       * Not a rock: the miner reaches for it. No pickaxe, no contact, no recoil.
       * On `timeMs` rather than `resolveElapsedMs` deliberately — the swing runs
       * on the domain's strike clock because it must agree with a sound, and
       * nothing in the domain marks a reach. `WORKING_CYCLE_MS` is slower than
       * the strike interval and not a multiple of it, so the two never read as
       * one rhythm at two speeds.
       */
      drawTool(REACH_POSES[extendedReach ? 1 : 0], originX, originY, scale);

      return;
    }

    /*
     * The swing, on the domain's own strike clock. Two thirds of the interval
     * winds up and the last third falls, so the head accelerates into the rock.
     * Contact is the final pose, landing in the ~50ms before `resolveElapsedMs`
     * crosses the next strike interval — the same frame the domain lands the
     * strike and fires `sound.pickaxe.impact`.
     */
    const windUp = phase / SWING_WINDUP;
    const pose =
      phase < SWING_WINDUP
        ? SWING_POSES[windUp < 0.5 ? 0 : 1]
        : SWING_POSES[phase < SWING_CONTACT ? 2 : 3];

    drawTool(pose, originX, originY, scale);

    if (phase >= SWING_CONTACT && scene.encounterSpriteId !== null) {
      // A mark on the rock's near edge, for the frames the head is against it.
      const rockX = encounterX(scene.approachRatio, scale, spriteHeight);

      context.fillStyle = HIGHLIGHT;

      for (const row of [8, 9, 10]) {
        context.fillRect(rockX, groundY - spriteHeight + row * scale, scale, scale);
      }
    }
  };

  const drawEncounter = (scene: ExpeditionScene): void => {
    if (context === null || scene.encounterSpriteId === null) {
      return;
    }

    const scale = Math.max(2, Math.floor(height / 60));
    const spriteHeight = SPRITE_GRID * scale;
    const groundY = Math.floor(height * 0.72);

    // Approach maps onto screen position: 0 is off the right edge, 1 is just
    // ahead of the player. Anchoring to the player rather than a fraction of the
    // width keeps them meeting closely at any window size.
    const x = encounterX(scene.approachRatio, scale, spriteHeight);

    drawSprite(context, scene.encounterSpriteId, {
      x,
      y: groundY - spriteHeight,
      scale,
    });

    if (scene.durabilityRatio !== null) {
      const barWidth = spriteHeight;
      const remaining = Math.max(0, Math.min(1, scene.durabilityRatio));
      context.fillStyle = DIM;
      context.fillRect(x, groundY + 8, barWidth, 3);
      context.fillStyle = HIGHLIGHT;
      context.fillRect(x, groundY + 8, Math.floor(barWidth * remaining), 3);
    } else if (scene.status === "resolving") {
      const barWidth = spriteHeight;
      const progress = Math.max(0, Math.min(1, scene.resolveRatio));
      context.fillStyle = DIM;
      context.fillRect(x, groundY + 8, barWidth, 3);
      context.fillStyle = HIGHLIGHT;
      context.fillRect(x, groundY + 8, Math.floor(barWidth * progress), 3);
    }
  };

  return {
    render(scene, timeMs) {
      if (context === null) {
        return;
      }

      // Advanced once per frame, before anything is drawn, so the terrain and
      // both backdrop layers describe the same instant.
      const deltaMs =
        lastFrameMs === null ? 0 : Math.min(MAX_SCROLL_FRAME_MS, Math.max(0, timeMs - lastFrameMs));

      lastFrameMs = timeMs;

      if (scene.status === "approaching" && !scene.reducedMotion) {
        scrollPx += deltaMs * SCROLL_RATE;
      }

      context.fillStyle = BACKGROUND;
      context.fillRect(0, 0, width, height);

      if (scene.status === "surface") {
        context.fillStyle = DIM;
        context.font = "12px ui-monospace, monospace";
        context.fillText("Surface — ready to launch", 12, 20);
      } else {
        context.fillStyle = scene.oxygenIsLow ? HIGHLIGHT : DIM;
        context.font = "12px ui-monospace, monospace";
        context.fillText(
          `Depth ${scene.depth} — oxygen ${Math.round(scene.oxygenRatio * 100)}%`,
          12,
          20,
        );
      }

      drawBackdrop(scene);
      drawTerrain();
      drawEncounter(scene);
      drawDissolve(scene);
      drawPlayer(scene, timeMs);
    },

    resize,

    dispose() {
      // Nothing retained beyond the canvas itself.
    },
  };
}
