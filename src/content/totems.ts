/**
 * Totem definitions. Totems may add luck, bias beneficial encounter weights, or
 * improve reward quantity, ore chip value or machine payout. They must never
 * modify tank oxygen or pickaxe damage.
 *
 * Like trinkets, each totem authors exactly one effect — its grade E — and every
 * higher grade is that effect scaled.
 *
 * Every totem must target a stat that can actually scale. A clamped probability
 * or a capped gambling weight leaves grades B through SSS inert, which is why
 * neither appears here.
 */

import type { Modifier } from "./economy";
import { percentAdded, trimNumber } from "./grades";

export const TOTEM_IDS = [
  "totem.prospector",
  "totem.magpie",
  "totem.gambler",
  "totem.anchor",
  "totem.ledger",
  "totem.salt-circle",
  "totem.moth",
  "totem.lantern",
  "totem.dowsing-bone",
  "totem.cartographer",
] as const;

export type TotemId = (typeof TOTEM_IDS)[number];

export interface TotemDefinition {
  id: TotemId;
  /**
   * A behaviour the totem grants beyond its modifiers: the dowsing bone resolves
   * choice encounters, and the Cartographer's eye names the next encounter's
   * family. Both carry modifiers as well, so their grades have something to
   * scale, and no two totems may grant the same capability.
   */
  capability?: "resolve-choices" | "forecast-encounter";
  displayName: string;
  description: string;
  spriteId: string;
  /** Grade E. Every higher grade is this, scaled. */
  baseModifiers: Modifier[];
  describeEffect: (modifiers: readonly Modifier[]) => string;
}

/** Stats a totem is never permitted to target. */
export const TOTEM_FORBIDDEN_STATS = ["gear.tankOxygen", "gear.pickaxeDamage"] as const;

export const TOTEMS: Record<TotemId, TotemDefinition> = {
  "totem.prospector": {
    id: "totem.prospector",
    displayName: "Prospector's thumb",
    description: "Adds raw luck, which biases beneficial encounters and slot outcomes.",
    spriteId: "sprite.totem.prospector",
    // Sized against the luck half-point of 250, which gives the curve room for
    // eight grades.
    baseModifiers: [
      { sourceId: "totem.prospector", targetStat: "luck", operation: "add", value: 75 },
    ],
    describeEffect: (modifiers) => `+${trimNumber(modifiers[0].value)} luck`,
  },
  "totem.magpie": {
    id: "totem.magpie",
    displayName: "Magpie idol",
    description: "Draws rare finds forward and enlarges their contents.",
    spriteId: "sprite.totem.magpie",
    baseModifiers: [
      {
        sourceId: "totem.magpie",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 1.4,
        tags: ["rare"],
      },
      {
        sourceId: "totem.magpie",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 1.1,
      },
    ],
    describeEffect: (modifiers) =>
      `+${percentAdded(modifiers[0].value)}% rare encounter weight, ` +
      `+${percentAdded(modifiers[1].value)}% reward quantity`,
  },
  "totem.gambler": {
    id: "totem.gambler",
    displayName: "Loaded die",
    // Pays through the machines rather than slot outcome weights, which the
    // expected-return cap makes impossible to scale across grades.
    description: "Leans on the house machines so every cycle pays heavier.",
    spriteId: "sprite.totem.gambler",
    baseModifiers: [
      {
        sourceId: "totem.gambler",
        targetStat: "machine.payout",
        operation: "multiply",
        value: 1.1,
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% machine payout`,
  },
  "totem.anchor": {
    id: "totem.anchor",
    displayName: "Ballast anchor",
    // Protects the value of the haul rather than the odds of keeping it, which
    // is a clamped probability and so cannot scale across grades.
    description: "Steadies the climb out, so the haul is worth more at the surface.",
    spriteId: "sprite.totem.anchor",
    baseModifiers: [
      {
        sourceId: "totem.anchor",
        targetStat: "economy.oreChipValue",
        operation: "multiply",
        value: 1.12,
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% ore chip value`,
  },
  "totem.ledger": {
    id: "totem.ledger",
    displayName: "Iron ledger",
    description: "The Company counts what you carry, and rounds in your favour.",
    spriteId: "sprite.totem.ledger",
    baseModifiers: [
      {
        sourceId: "totem.ledger",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 1.12,
        tags: ["supply"],
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% salvage rewards`,
  },
  "totem.salt-circle": {
    id: "totem.salt-circle",
    displayName: "Salt circle",
    description: "Whatever is down here keeps its distance.",
    spriteId: "sprite.totem.salt-circle",
    baseModifiers: [
      {
        // Below 1: hazards get rarer, compounding across grades.
        sourceId: "totem.salt-circle",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 0.88,
        tags: ["hazard"],
      },
    ],
    describeEffect: (modifiers) =>
      `${Math.round((1 - modifiers[0].value) * 100)}% fewer hazards`,
  },
  "totem.moth": {
    id: "totem.moth",
    displayName: "Moth pendant",
    description: "Drawn to anything sealed and left in the dark.",
    spriteId: "sprite.totem.moth",
    baseModifiers: [
      {
        sourceId: "totem.moth",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 1.2,
        tags: ["cache"],
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% cache finds`,
  },
  "totem.lantern": {
    id: "totem.lantern",
    displayName: "Deep lantern",
    description: "Shows the seam for what it is worth before you cut it.",
    spriteId: "sprite.totem.lantern",
    baseModifiers: [
      {
        sourceId: "totem.lantern",
        targetStat: "economy.oreChipValue",
        operation: "multiply",
        value: 1.1,
      },
    ],
    describeEffect: (modifiers) => `+${percentAdded(modifiers[0].value)}% ore chip value`,
  },
  "totem.dowsing-bone": {
    id: "totem.dowsing-bone",
    displayName: "Dowsing bone",
    description:
      "Chooses for you at a fork, without preference. It keeps a run moving; it does not play it well.",
    spriteId: "sprite.totem.dowsing-bone",
    capability: "resolve-choices",
    baseModifiers: [
      // A capability alone has nothing for the grades to scale: an option is
      // either chosen for you or it is not. This is what the ladder climbs.
      {
        sourceId: "totem.dowsing-bone",
        targetStat: "expedition.oreYield",
        operation: "multiply",
        value: 1.08,
      },
    ],
    describeEffect: (modifiers) =>
      `Resolves choices at random, +${percentAdded(modifiers[0].value)}% ore recovered`,
  },
  "totem.cartographer": {
    id: "totem.cartographer",
    displayName: "Cartographer's eye",
    description:
      "Names what lies ahead, though never what it is worth. The only thing in the mine that sees past the next step.",
    spriteId: "sprite.totem.cartographer",
    capability: "forecast-encounter",
    baseModifiers: [
      // Luck like the prospector's thumb but at half the value, since the
      // capability is most of what this sells. Deliberately not a strict
      // upgrade: the choice between them is information against raw odds.
      { sourceId: "totem.cartographer", targetStat: "luck", operation: "add", value: 40 },
    ],
    describeEffect: (modifiers) =>
      `Names the next encounter, +${trimNumber(modifiers[0].value)} luck`,
  },
};
