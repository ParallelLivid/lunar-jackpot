/**
 * Run modifiers: conditions rolled once at launch that colour a whole run. They
 * are occasional and never guaranteed, which is what makes the ones that land
 * feel like something rather than a per-run stat sheet.
 *
 * Each is an ordinary `Modifier[]`, so it flows through `explainStat` untouched
 * and appears in the existing `base + x` breakdowns.
 *
 * The mixed ones are the point: a purely good modifier is a free bonus, so most
 * of these give something and take something.
 */

import type { DepthBandId } from "./depthBands";
import type { Modifier } from "./economy";

export const EXPEDITION_MODIFIER_IDS = [
  "modifier.rich-vein",
  "modifier.thin-air",
  "modifier.company-audit",
  "modifier.still-dust",
  "modifier.bad-omen",
  "modifier.deep-pockets",
  "modifier.selenite-haze",
  "modifier.under-review",
  "modifier.dust-fall",
  "modifier.short-shift",
  "modifier.quiet-seam",
  "modifier.scrip-payment",
  "modifier.deep-quota",
  "modifier.company-escort",
  "modifier.sealed-orders",
] as const;

export type ExpeditionModifierId = (typeof EXPEDITION_MODIFIER_IDS)[number];

export interface ExpeditionModifierDefinition {
  id: ExpeditionModifierId;
  displayName: string;
  description: string;
  /**
   * The shallowest band the player must already have reached for this modifier to
   * be offered. The roll happens at launch with depth at zero, so gating on the
   * run's own band would gate nothing; this gates on the player instead.
   */
  requiredBand: DepthBandId;
  /** Relative chance of being the one drawn, once a run has rolled a modifier. */
  weight: number;
  /**
   * Depth the player must have reached this prestige cycle, on top of
   * `requiredBand`. That one reads lifetime deepest depth, which survives a
   * prestige that resets gear to level 1 — measured, a veteran on reset gear
   * fails 85.8% of ten-depth targets against 0% at gear level 3. Only Sealed
   * orders needs this, being the only modifier that can take a run away.
   */
  minimumDepthThisCycle?: number;
  /**
   * Extra reward quantity per depth descended, compounding. Applied when a reward
   * is resolved rather than folded into the launch snapshot, because it is not a
   * constant: the last ten depths of a run pay more than the first ten.
   */
  rewardPerDepth?: number;
  /**
   * Holds the exit shut until the run reaches this depth — the one modifier that
   * removes a choice rather than changing a number. See `modifier.sealed-orders`.
   */
  bankingLockedUntilDepth?: number;
  modifiers: Modifier[];
}

export const EXPEDITION_MODIFIERS: Record<
  ExpeditionModifierId,
  ExpeditionModifierDefinition
> = {
  "modifier.rich-vein": {
    id: "modifier.rich-vein",
    displayName: "Rich vein",
    description: "The rock is generous today. Ore yields are far larger.",
    requiredBand: "band.shelf",
    weight: 24,
    modifiers: [
      {
        sourceId: "modifier.rich-vein",
        targetStat: "expedition.oreYield",
        operation: "multiply",
        value: 1.4,
      },
    ],
  },
  "modifier.thin-air": {
    id: "modifier.thin-air",
    displayName: "Thin air",
    description: "The tank reads low from the start, but the Company pays for the risk.",
    requiredBand: "band.shelf",
    weight: 18,
    modifiers: [
      {
        sourceId: "modifier.thin-air",
        targetStat: "gear.tankOxygen",
        operation: "multiply",
        value: 0.75,
      },
      {
        sourceId: "modifier.thin-air",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 1.6,
      },
    ],
  },
  "modifier.company-audit": {
    id: "modifier.company-audit",
    displayName: "Company audit",
    description: "Every component is counted twice. Nothing sealed leaves with you.",
    requiredBand: "band.shelf",
    weight: 14,
    modifiers: [
      {
        sourceId: "modifier.company-audit",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 2,
        tags: ["supply"],
      },
      {
        // Zero weight on cache entries, so no cache is drawn all run.
        sourceId: "modifier.company-audit",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 0,
        tags: ["cache"],
      },
    ],
  },
  "modifier.still-dust": {
    id: "modifier.still-dust",
    displayName: "Still dust",
    description: "Nothing is moving down here. Less of the haul is lost if the air runs out.",
    requiredBand: "band.seams",
    weight: 12,
    modifiers: [
      {
        sourceId: "modifier.still-dust",
        targetStat: "expedition.failureLossChance",
        operation: "add",
        value: -0.2,
      },
    ],
  },
  "modifier.bad-omen": {
    id: "modifier.bad-omen",
    displayName: "Bad omen",
    description: "Rare finds and hazards alike are twice as likely. Take your pick.",
    requiredBand: "band.dark",
    weight: 10,
    modifiers: [
      {
        sourceId: "modifier.bad-omen",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 2,
        tags: ["rare"],
      },
      {
        sourceId: "modifier.bad-omen",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 2,
        tags: ["hazard"],
      },
    ],
  },
  "modifier.deep-pockets": {
    id: "modifier.deep-pockets",
    displayName: "Deep pockets",
    description: "The refinery is paying well. Ore banks for half again as many chips.",
    requiredBand: "band.dark",
    weight: 10,
    modifiers: [
      {
        sourceId: "modifier.deep-pockets",
        targetStat: "economy.oreChipValue",
        operation: "multiply",
        value: 1.5,
      },
    ],
  },
  "modifier.selenite-haze": {
    id: "modifier.selenite-haze",
    displayName: "Selenite haze",
    description: "The dust glitters, and the run seems to fall your way.",
    requiredBand: "band.hollow",
    weight: 8,
    modifiers: [
      {
        sourceId: "modifier.selenite-haze",
        targetStat: "luck",
        operation: "add",
        value: 400,
      },
    ],
  },
  "modifier.under-review": {
    id: "modifier.under-review",
    displayName: "Under review",
    description: "Everything pays double, and the Company will not come looking for you.",
    requiredBand: "band.core",
    weight: 4,
    modifiers: [
      {
        sourceId: "modifier.under-review",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 2,
      },
      {
        sourceId: "modifier.under-review",
        targetStat: "expedition.failureLossChance",
        operation: "add",
        value: 0.3,
      },
    ],
  },

  // Four shallow conditions, because at a 1-in-3 roll a three-deep pool would be
  // exhausted within an hour and runs would be less varied rather than more.

  "modifier.dust-fall": {
    id: "modifier.dust-fall",
    // Not "Dust fall": that is already an encounter's name, and a condition
    // sharing one reads as a relationship that does not exist.
    displayName: "Scoured air",
    description: "The scrubbers are losing. Everything down here costs more breath.",
    requiredBand: "band.shelf",
    weight: 16,
    modifiers: [
      {
        sourceId: "modifier.dust-fall",
        targetStat: "expedition.oxygenDrainRate",
        operation: "multiply",
        value: 1.25,
      },
      {
        sourceId: "modifier.dust-fall",
        targetStat: "expedition.oreYield",
        operation: "multiply",
        value: 1.5,
      },
    ],
  },
  "modifier.short-shift": {
    id: "modifier.short-shift",
    displayName: "Short shift",
    description: "The Company wants you back early. Ground is covered quickly, seams less so.",
    requiredBand: "band.shelf",
    weight: 14,
    modifiers: [
      {
        sourceId: "modifier.short-shift",
        targetStat: "expedition.approachSpeed",
        operation: "multiply",
        value: 1.6,
      },
      {
        sourceId: "modifier.short-shift",
        targetStat: "expedition.oreYield",
        operation: "multiply",
        value: 0.8,
      },
    ],
  },
  "modifier.quiet-seam": {
    id: "modifier.quiet-seam",
    displayName: "Quiet seam",
    description: "Nothing hunting today, and nothing worth finding either.",
    requiredBand: "band.shelf",
    weight: 14,
    modifiers: [
      {
        sourceId: "modifier.quiet-seam",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 0.25,
        tags: ["hazard"],
      },
      {
        sourceId: "modifier.quiet-seam",
        targetStat: "expedition.encounterWeight",
        operation: "multiply",
        value: 0.5,
        tags: ["rare"],
      },
    ],
  },
  "modifier.scrip-payment": {
    id: "modifier.scrip-payment",
    displayName: "Paid in scrip",
    description: "Ore is worth more at the window, but the rock gives up less of it.",
    requiredBand: "band.shelf",
    weight: 12,
    modifiers: [
      {
        sourceId: "modifier.scrip-payment",
        targetStat: "economy.oreChipValue",
        operation: "multiply",
        value: 1.6,
      },
      {
        sourceId: "modifier.scrip-payment",
        targetStat: "expedition.oreYield",
        operation: "multiply",
        value: 0.75,
      },
    ],
  },

  // The two answers to "why press on".

  "modifier.deep-quota": {
    id: "modifier.deep-quota",
    displayName: "Deep quota",
    description:
      "The Company pays by the metre. Every reward is worth more the deeper you take it.",
    requiredBand: "band.seams",
    weight: 12,
    // Three percent per depth, compounding: +34% at depth 10, +490% at 60. Flat
    // would raise the prize without changing the decision.
    rewardPerDepth: 0.03,
    modifiers: [],
  },
  "modifier.company-escort": {
    id: "modifier.company-escort",
    displayName: "Company escort",
    description:
      "Somebody is waiting at the lift. Far less of an unbanked haul is lost if the air runs out.",
    requiredBand: "band.seams",
    weight: 12,
    // The other half of "why press on": deep quota raises the prize, this lowers
    // the stake.
    modifiers: [
      {
        sourceId: "modifier.company-escort",
        targetStat: "expedition.failureLossChance",
        operation: "add",
        value: -0.35,
      },
    ],
  },

  // The banking lock.

  "modifier.sealed-orders": {
    id: "modifier.sealed-orders",
    displayName: "Sealed orders",
    description:
      "Your orders are not to surface before depth 10. The lift will not answer until you do, whatever the tank reads. Everything you bring back is worth half again as much.",
    /*
     * The only content that removes a choice rather than changing a number, and
     * the single exception to "returning is always a deliberate act". Three
     * things keep it from being a confiscation:
     *
     * 1. The target is the only release. Low oxygen does not lift it, which is
     *    why the modifier has teeth.
     * 2. It is bounded by construction: pressing on is always available and
     *    oxygen only falls, so a locked run always terminates.
     * 3. The target is sized by measurement — ten depths, against a measured 0%
     *    failure rate at every gear level from 3/3 upward across 150 seeds. The
     *    cost is losing the option to bank early, not losing runs.
     *
     * `minimumDepthThisCycle` is the load-bearing gate: `requiredBand` reads
     * lifetime depth, which survives the prestige that resets gear, and a veteran
     * on reset gear fails 85.8% of ten-depth targets.
     */
    requiredBand: "band.seams",
    weight: 8,
    minimumDepthThisCycle: 20,
    bankingLockedUntilDepth: 10,
    modifiers: [
      {
        sourceId: "modifier.sealed-orders",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 1.5,
      },
    ],
  },
};

export function isExpeditionModifierId(value: unknown): value is ExpeditionModifierId {
  return (
    typeof value === "string" &&
    (EXPEDITION_MODIFIER_IDS as readonly string[]).includes(value)
  );
}
