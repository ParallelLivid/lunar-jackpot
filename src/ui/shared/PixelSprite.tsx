/** Renders pixel-art sprites as scaled SVG rectangles so edges stay crisp. */

import { useId } from "react";
import {
  SPRITE_COLORS,
  SPRITE_COLORS_DIMMED,
  SPRITE_GRID,
  hasSprite,
  spriteRows,
} from "../../rendering/sprites";
import type { SpritePixel } from "../../rendering/sprites";

interface PixelSpriteProps {
  spriteId: string;
  /** Pixels per sprite cell. Always an integer so scaling stays exact. */
  scale?: number;
  dimmed?: boolean;
  label?: string;
  className?: string;
}

export function PixelSprite({
  className = "",
  dimmed = false,
  label,
  scale = 3,
  spriteId,
}: PixelSpriteProps) {
  const titleId = useId();
  const rows = spriteRows(spriteId);
  const step = Math.max(1, Math.floor(scale));
  const size = SPRITE_GRID * step;
  const cells: Array<{ key: string; x: number; y: number; fill: string }> = [];

  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row];

    for (let column = 0; column < line.length; column += 1) {
      const pixel = line[column] as SpritePixel;

      if (pixel === ".") {
        continue;
      }

      cells.push({
        key: `${row}-${column}`,
        x: column * step,
        y: row * step,
        fill: dimmed ? SPRITE_COLORS_DIMMED[pixel] : SPRITE_COLORS[pixel],
      });
    }
  }

  return (
    <svg
      className={`pixel-sprite ${className}`.trim()}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={label === undefined ? "presentation" : "img"}
      aria-labelledby={label === undefined ? undefined : titleId}
      aria-hidden={label === undefined}
      shapeRendering="crispEdges"
    >
      {label === undefined ? null : <title id={titleId}>{label}</title>}
      {cells.map((cell) => (
        <rect key={cell.key} x={cell.x} y={cell.y} width={step} height={step} fill={cell.fill} />
      ))}
      {hasSprite(spriteId) ? null : (
        <desc>Placeholder art: no sprite is defined for {spriteId}.</desc>
      )}
    </svg>
  );
}

interface MachineSpriteProps {
  spriteId: string;
  /** Cycle progress, used only for a subtle idle motion. */
  progress?: number;
  locked?: boolean;
  animate?: boolean;
}

export function MachineSprite({
  animate = true,
  locked = false,
  progress = 0,
  spriteId,
}: MachineSpriteProps) {
  // Motion is decorative: the offset is derived from domain progress and never
  // feeds back into it. Reduced motion pins it to zero.
  const bob = animate ? Math.round(Math.sin(progress * Math.PI * 2) * 2) : 0;

  return (
    <span className="machine-sprite" style={{ transform: `translateY(${bob}px)` }}>
      <PixelSprite spriteId={spriteId} scale={4} dimmed={locked} />
    </span>
  );
}
