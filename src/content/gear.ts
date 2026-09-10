/**
 * Oxygen tank and pickaxe level tables, twelve levels each.
 *
 * The tank curve is set against measured runs rather than chosen: a depth costs
 * about 6.8 seconds of oxygen, so a level's oxygen is very nearly the depth it
 * reaches. That maps the ladder onto the depth bands — Deep Seams at level 6,
 * The Dark at 8, The Hollows at 10, the Selenite Core at 12 — with enough margin
 * at each that the pairing does not hinge on a lucky run, or on a run that rolls
 * Thin air and carries a quarter less oxygen.
 *
 * Relic costs are pitched at roughly eighteen runs per level, against the relic
 * income measured at each tier (3 per run at level 5, rising to 17 at level 12).
 *
 * Trinket slots unlock at levels 1, 3 and 5 and cap at three. They are not
 * re-spaced across the longer ladder: moving the third slot later would relock
 * it for anyone past level 5, and `releaseRelockedSlots` would unequip their
 * trinket on load.
 */

export const GEAR_IDS = ["tank", "pickaxe"] as const;

export type GearId = (typeof GEAR_IDS)[number];

export interface GearLevelDefinition {
  level: number;
  /** Relics required to reach this level from the previous one. Level 1 is free. */
  relicCost: number;
  /** Tank: maximum oxygen in seconds. Pickaxe: damage per second. */
  statValue: number;
  unlockedTrinketSlots: number;
}

export interface GearDefinition {
  id: GearId;
  displayName: string;
  description: string;
  spriteId: string;
  statLabel: string;
  statUnit: string;
  levels: GearLevelDefinition[];
}

export const GEAR: Record<GearId, GearDefinition> = {
  tank: {
    id: "tank",
    displayName: "Oxygen tank",
    description: "Sets how long an expedition can stay below the surface.",
    spriteId: "sprite.gear.tank",
    statLabel: "Maximum oxygen",
    statUnit: "s",
    levels: [
      { level: 1, relicCost: 0, statValue: 60, unlockedTrinketSlots: 1 },
      { level: 2, relicCost: 3, statValue: 85, unlockedTrinketSlots: 1 },
      { level: 3, relicCost: 8, statValue: 115, unlockedTrinketSlots: 2 },
      { level: 4, relicCost: 18, statValue: 150, unlockedTrinketSlots: 2 },
      { level: 5, relicCost: 40, statValue: 195, unlockedTrinketSlots: 3 },
      { level: 6, relicCost: 60, statValue: 255, unlockedTrinketSlots: 3 },
      { level: 7, relicCost: 80, statValue: 320, unlockedTrinketSlots: 3 },
      { level: 8, relicCost: 105, statValue: 390, unlockedTrinketSlots: 3 },
      { level: 9, relicCost: 135, statValue: 470, unlockedTrinketSlots: 3 },
      { level: 10, relicCost: 170, statValue: 610, unlockedTrinketSlots: 3 },
      { level: 11, relicCost: 215, statValue: 715, unlockedTrinketSlots: 3 },
      { level: 12, relicCost: 270, statValue: 830, unlockedTrinketSlots: 3 },
    ],
  },
  pickaxe: {
    id: "pickaxe",
    displayName: "Pickaxe",
    description: "Sets how quickly ore durability is broken.",
    spriteId: "sprite.gear.pickaxe",
    statLabel: "Damage",
    statUnit: "/s",
    levels: [
      { level: 1, relicCost: 0, statValue: 10, unlockedTrinketSlots: 1 },
      { level: 2, relicCost: 3, statValue: 16, unlockedTrinketSlots: 1 },
      { level: 3, relicCost: 8, statValue: 25, unlockedTrinketSlots: 2 },
      { level: 4, relicCost: 18, statValue: 38, unlockedTrinketSlots: 2 },
      { level: 5, relicCost: 40, statValue: 58, unlockedTrinketSlots: 3 },
      { level: 6, relicCost: 60, statValue: 75, unlockedTrinketSlots: 3 },
      { level: 7, relicCost: 80, statValue: 92, unlockedTrinketSlots: 3 },
      { level: 8, relicCost: 105, statValue: 110, unlockedTrinketSlots: 3 },
      { level: 9, relicCost: 135, statValue: 130, unlockedTrinketSlots: 3 },
      { level: 10, relicCost: 170, statValue: 166, unlockedTrinketSlots: 3 },
      { level: 11, relicCost: 215, statValue: 192, unlockedTrinketSlots: 3 },
      { level: 12, relicCost: 270, statValue: 222, unlockedTrinketSlots: 3 },
    ],
  },
};
