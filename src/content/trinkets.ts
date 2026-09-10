/**
 * Trinket definitions. Two target the tank, two target the pickaxe.
 *
 * Each trinket authors exactly one effect, which is its grade E. Every higher
 * grade is that effect run through `scaleModifier`, so the numbers below are the
 * only ones a designer tunes.
 */

import type { Modifier } from "./economy";
import type { GearId } from "./gear";
import { percentAdded, trimNumber } from "./grades";

export const TRINKET_IDS = [
  "trinket.bladder",
  "trinket.regulator",
  "trinket.tungsten-head",
  "trinket.ore-sieve",
  "trinket.reinforced-haft",
  "trinket.scrubber-coil",
  "trinket.ballast-harness",
  "trinket.impact-fuse",
] as const;

export type TrinketId = (typeof TRINKET_IDS)[number];

export interface TrinketDefinition {
  id: TrinketId;
  displayName: string;
  description: string;
  spriteId: string;
  targetGearId: GearId;
  /** Grade E. Every higher grade is this, scaled. */
  baseModifiers: Modifier[];
  /** Renders one grade's summary from its already-scaled modifiers. */
  describeEffect: (modifiers: readonly Modifier[]) => string;
}

export const TRINKETS: Record<TrinketId, TrinketDefinition> = {
  "trinket.bladder": {
    id: "trinket.bladder",
    displayName: "Spare bladder",
    description: "A patched reserve bag strapped to the tank.",
    spriteId: "sprite.trinket.bladder",
    targetGearId: "tank",
    baseModifiers: [
      {
        sourceId: "trinket.bladder",
        targetStat: "gear.tankOxygen",
        operation: "add",
        value: 8,
      },
    ],
    describeEffect: (modifiers) => `+${trimNumber(modifiers[0].value)}s maximum oxygen`,
  },
  "trinket.regulator": {
    id: "trinket.regulator",
    displayName: "Tuned regulator",
    description: "Meters the flow so the same tank lasts longer.",
    spriteId: "sprite.trinket.regulator",
    targetGearId: "tank",
    baseModifiers: [
      {
        sourceId: "trinket.regulator",
        targetStat: "gear.tankOxygen",
        operation: "multiply",
        value: 1.08,
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% maximum oxygen`,
  },
  "trinket.tungsten-head": {
    id: "trinket.tungsten-head",
    displayName: "Tungsten head",
    description: "A heavier striking face for the pickaxe.",
    spriteId: "sprite.trinket.tungsten-head",
    targetGearId: "pickaxe",
    baseModifiers: [
      {
        sourceId: "trinket.tungsten-head",
        targetStat: "gear.pickaxeDamage",
        operation: "add",
        value: 3,
      },
    ],
    describeEffect: (modifiers) => `+${trimNumber(modifiers[0].value)} pickaxe damage`,
  },
  "trinket.ore-sieve": {
    id: "trinket.ore-sieve",
    displayName: "Ore sieve",
    description: "Recovers fragments that would otherwise be left in the dust.",
    spriteId: "sprite.trinket.ore-sieve",
    targetGearId: "pickaxe",
    baseModifiers: [
      {
        sourceId: "trinket.ore-sieve",
        targetStat: "expedition.oreYield",
        operation: "multiply",
        value: 1.15,
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% ore recovered`,
  },
  "trinket.reinforced-haft": {
    id: "trinket.reinforced-haft",
    displayName: "Reinforced haft",
    description: "A wrapped shaft that puts the whole arm behind every swing.",
    spriteId: "sprite.trinket.reinforced-haft",
    targetGearId: "pickaxe",
    baseModifiers: [
      {
        // Multiplicative, where the tungsten head is additive — so the two
        // compound instead of competing for the same slot.
        sourceId: "trinket.reinforced-haft",
        targetStat: "gear.pickaxeDamage",
        operation: "multiply",
        value: 1.1,
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% pickaxe damage`,
  },
  "trinket.scrubber-coil": {
    id: "trinket.scrubber-coil",
    displayName: "Scrubber coil",
    description: "Cycles the same air twice before letting it go.",
    spriteId: "sprite.trinket.scrubber-coil",
    targetGearId: "tank",
    baseModifiers: [
      {
        // Below 1, so it compounds across grades rather than scaling its excess.
        // The first content in the game to use that branch.
        sourceId: "trinket.scrubber-coil",
        targetStat: "expedition.oxygenDrainRate",
        operation: "multiply",
        value: 0.94,
      },
    ],
    describeEffect: (modifiers) =>
      `${Math.round((1 - modifiers[0].value) * 100)}% slower oxygen drain`,
  },
  "trinket.ballast-harness": {
    id: "trinket.ballast-harness",
    displayName: "Ballast harness",
    description: "Takes the weight off the walk between one seam and the next.",
    spriteId: "sprite.trinket.ballast-harness",
    targetGearId: "tank",
    baseModifiers: [
      {
        sourceId: "trinket.ballast-harness",
        targetStat: "expedition.approachSpeed",
        operation: "multiply",
        value: 1.12,
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% approach speed`,
  },
  "trinket.impact-fuse": {
    id: "trinket.impact-fuse",
    displayName: "Impact fuse",
    description: "Every so often a swing lands exactly right.",
    spriteId: "sprite.trinket.impact-fuse",
    targetGearId: "pickaxe",
    baseModifiers: [
      {
        sourceId: "trinket.impact-fuse",
        targetStat: "gear.pickaxeCritChance",
        operation: "add",
        value: 0.05,
      },
    ],
    describeEffect: (modifiers) =>
      `${Math.round(modifiers[0].value * 100)}% chance of a double-damage strike`,
  },
};
