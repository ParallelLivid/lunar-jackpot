/**
 * Consumables: chips spent on the next run, and nothing else. Six of them, one
 * per lever the run snapshot already carries, so a consumable is a bag of
 * modifiers that `createRunModifierSnapshot` folds in at launch and needs no
 * machinery of its own.
 *
 * One of each at most, so the question is which of six to take rather than how
 * many to stack. Spent at launch rather than at return, so a run that fails has
 * still paid for them — which is what makes a consumable a risk.
 *
 * Priced against a run rather than a wallet: at mid-game gear a run banks a
 * median of 371 chips and a good one about 778, and the ladder sits between
 * those, so one consumable costs roughly one good run.
 *
 * Two of them target clamped stats — `gear.pickaxeCritChance` caps at 0.9 and
 * `expedition.failureLossChance` at [0.05, 0.95] — so they are worth less to an
 * already well-equipped player. The clamp is stated in `effectSummary`, which is
 * the line the store always shows, rather than only in the tooltip.
 */

import type { Modifier } from "./economy";

export const CONSUMABLE_IDS = [
  "consumable.safety-line",
  "consumable.honed-edge",
  "consumable.stimulant",
  "consumable.survey-charts",
  "consumable.rabbits-foot",
  "consumable.spare-canister",
] as const;

export type ConsumableId = (typeof CONSUMABLE_IDS)[number];

export interface ConsumableDefinition {
  id: ConsumableId;
  displayName: string;
  description: string;
  /** What the effect is, in one line, for the tile and the pre-launch row. */
  effectSummary: string;
  spriteId: string;
  chipCost: number;
  /** Folded into the run snapshot at launch, then discarded. */
  modifiers: Modifier[];
}

export const CONSUMABLES: Record<ConsumableId, ConsumableDefinition> = {
  "consumable.safety-line": {
    id: "consumable.safety-line",
    displayName: "Safety line",
    description:
      "Anchored at the last airlock. Loses less of the haul if the oxygen runs out. Worth least to a player whose loss chance is already low, since it cannot fall below 5%.",
    effectSummary: "Failure loss -15 points, floor 5%",
    spriteId: "sprite.consumable.safety-line",
    chipCost: 250,
    modifiers: [
      {
        sourceId: "consumable.safety-line",
        targetStat: "expedition.failureLossChance",
        operation: "add",
        value: -0.15,
      },
    ],
  },
  "consumable.honed-edge": {
    id: "consumable.honed-edge",
    displayName: "Honed edge",
    description:
      "A morning on the whetstone. More strikes land double. Ore only, and worth least at a high crit chance already, since it cannot pass 90%.",
    effectSummary: "Pickaxe crit +15 points, cap 90%",
    spriteId: "sprite.consumable.honed-edge",
    chipCost: 320,
    modifiers: [
      {
        sourceId: "consumable.honed-edge",
        targetStat: "gear.pickaxeCritChance",
        operation: "add",
        value: 0.15,
      },
    ],
  },
  "consumable.stimulant": {
    id: "consumable.stimulant",
    displayName: "Stimulant",
    description:
      "Walk between encounters faster, and spend less air getting there. Does nothing to how long the work itself takes.",
    effectSummary: "Approach speed x1.4",
    spriteId: "sprite.consumable.stimulant",
    chipCost: 420,
    modifiers: [
      {
        sourceId: "consumable.stimulant",
        targetStat: "expedition.approachSpeed",
        operation: "multiply",
        value: 1.4,
      },
    ],
  },
  "consumable.survey-charts": {
    id: "consumable.survey-charts",
    displayName: "Survey charts",
    description:
      "Somebody has been down here before and wrote it all down. Every reward the run resolves comes back larger.",
    effectSummary: "Reward quantity x1.3",
    spriteId: "sprite.consumable.survey-charts",
    chipCost: 560,
    modifiers: [
      {
        sourceId: "consumable.survey-charts",
        targetStat: "expedition.rewardQuantity",
        operation: "multiply",
        value: 1.3,
      },
    ],
  },
  "consumable.rabbits-foot": {
    id: "consumable.rabbits-foot",
    displayName: "Rabbit's foot",
    description:
      "Luck, on the same diminishing curve everything else uses — so it is worth most to a run that had little to begin with. It cannot move the cat.",
    effectSummary: "Luck +500",
    spriteId: "sprite.consumable.rabbits-foot",
    chipCost: 680,
    modifiers: [
      {
        sourceId: "consumable.rabbits-foot",
        targetStat: "luck",
        operation: "add",
        value: 500,
      },
    ],
  },
  "consumable.spare-canister": {
    id: "consumable.spare-canister",
    displayName: "Spare canister",
    description:
      "Half a tank again, strapped to the pack. The bluntest of the six and the most expensive: more air is more of everything.",
    effectSummary: "Maximum oxygen x1.5",
    spriteId: "sprite.consumable.spare-canister",
    chipCost: 850,
    modifiers: [
      {
        sourceId: "consumable.spare-canister",
        targetStat: "gear.tankOxygen",
        operation: "multiply",
        value: 1.5,
      },
    ],
  },
};

export function isConsumableId(value: unknown): value is ConsumableId {
  return typeof value === "string" && (CONSUMABLE_IDS as readonly string[]).includes(value);
}

/** Every modifier the held consumables contribute, in catalogue order. */
export function consumableModifiers(ids: readonly ConsumableId[]): Modifier[] {
  return CONSUMABLE_IDS.filter((id) => ids.includes(id)).flatMap((id) => CONSUMABLES[id].modifiers);
}
