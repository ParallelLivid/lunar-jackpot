/** Casino machine definitions. IDs are stable and must not change with names. */

import type { DepthBandId } from "./depthBands";
import { ECONOMY } from "./economy";

export const MACHINE_IDS = [
  "machine.alpha",
  "machine.beta",
  "machine.gamma",
  "machine.delta",
  "machine.epsilon",
  "machine.zeta",
  "machine.eta",
  "machine.theta",
  "machine.iota",
  "machine.kappa",
] as const;

export type MachineId = (typeof MACHINE_IDS)[number];

export const RESEARCH_NODE_IDS = [
  "research.alpha.overclock",
  "research.alpha.spec-endurance",
  "research.alpha.spec-gambler",
  "research.alpha.spec-flywheel",
  "research.beta.overclock",
  "research.beta.spec-endurance",
  "research.beta.spec-gambler",
  "research.beta.spec-flywheel",
  "research.gamma.overclock",
  "research.gamma.spec-endurance",
  "research.gamma.spec-gambler",
  "research.gamma.spec-flywheel",
  "research.delta.overclock",
  "research.delta.spec-endurance",
  "research.delta.spec-gambler",
  "research.delta.spec-flywheel",
  "research.epsilon.overclock",
  "research.epsilon.spec-endurance",
  "research.epsilon.spec-gambler",
  "research.epsilon.spec-flywheel",
  "research.zeta.overclock",
  "research.zeta.spec-endurance",
  "research.zeta.spec-gambler",
  "research.zeta.spec-flywheel",
  "research.eta.overclock",
  "research.eta.spec-endurance",
  "research.eta.spec-gambler",
  "research.eta.spec-flywheel",
  "research.theta.overclock",
  "research.theta.spec-endurance",
  "research.theta.spec-gambler",
  "research.theta.spec-flywheel",
  "research.iota.overclock",
  "research.iota.spec-endurance",
  "research.iota.spec-gambler",
  "research.iota.spec-flywheel",
  "research.kappa.overclock",
  "research.kappa.spec-endurance",
  "research.kappa.spec-gambler",
  "research.kappa.spec-flywheel",
] as const;

export type ResearchNodeId = (typeof RESEARCH_NODE_IDS)[number];

export const SPEC_IDS = [
  "spec.alpha.endurance",
  "spec.alpha.gambler",
  "spec.alpha.flywheel",
  "spec.beta.endurance",
  "spec.beta.gambler",
  "spec.beta.flywheel",
  "spec.gamma.endurance",
  "spec.gamma.gambler",
  "spec.gamma.flywheel",
  "spec.delta.endurance",
  "spec.delta.gambler",
  "spec.delta.flywheel",
  "spec.epsilon.endurance",
  "spec.epsilon.gambler",
  "spec.epsilon.flywheel",
  "spec.zeta.endurance",
  "spec.zeta.gambler",
  "spec.zeta.flywheel",
  "spec.eta.endurance",
  "spec.eta.gambler",
  "spec.eta.flywheel",
  "spec.theta.endurance",
  "spec.theta.gambler",
  "spec.theta.flywheel",
  "spec.iota.endurance",
  "spec.iota.gambler",
  "spec.iota.flywheel",
  "spec.kappa.endurance",
  "spec.kappa.gambler",
  "spec.kappa.flywheel",
] as const;

export type SpecId = (typeof SPEC_IDS)[number];

export interface MachineLevelDefinition {
  level: number;
  payoutMultiplier: number;
  cashCost: number;
  componentCost: number;
}

/**
 * Levels are uncapped, so they are a curve rather than a table.
 *
 * `cashGrowth` must exceed `payoutGrowth`, which is what gives an endless ladder
 * a shape: each level pays back a little slower than the last. It must exceed it
 * only barely — the time to earn out a level goes as
 * `(cashGrowth / payoutGrowth) ** level`, so the ratio alone decides where the
 * ladder walls off, and no `firstCashCost` can compensate for a wide one. It
 * sits near 1.005.
 *
 * `firstCashCost` is roughly a minute of that machine's own level-1 income, so
 * every tier climbs at a comparable rate rather than a deep machine being
 * charged proportionally more cash as well as earning more. Measured against the
 * prestige wall, alpha reaches about level 87 on a first prestige and 852 by the
 * hundred-and-tenth.
 *
 * `componentGrowth` is far below `cashGrowth ** componentEveryNLevels`, which is
 * what it would need to track cash. Components come only from expeditions, so a
 * charge that kept pace would gate the ladder on expedition throughput.
 */
export interface MachineCurve {
  payoutGrowth: number;
  /** Cost of level 2. Level 1 comes with the machine. */
  firstCashCost: number;
  cashGrowth: number;
  /** Components are charged on every nth level and nowhere else. */
  componentEveryNLevels: number;
  firstComponentCost: number;
  componentGrowth: number;
}

/**
 * How a machine sounds when it pays. Content owns the cue rather than a sound
 * id, because the catalogue lives in the audio layer and content may not reach
 * into it.
 *
 * Pitch descends as the ladder climbs, so the floor tells you how much just paid
 * without looking. `validateContent` enforces that direction.
 */
export interface MachinePayoutCue {
  frequency: number;
  endFrequency: number;
  durationMs: number;
  gain: number;
}

export interface MachineDefinition {
  id: MachineId;
  displayName: string;
  description: string;
  spriteId: string;
  startsUnlocked: boolean;
  recipePiecesRequired: number;
  /**
   * The depth band whose encounters drop this machine's recipe pieces, which is
   * what makes the later machines a reason to dive: no amount of shallow running
   * produces a deep piece. Nominal for the starter machine, which needs no recipe.
   */
  recipeBand: DepthBandId;
  basePayout: number;
  baseCycleMs: number;
  curve: MachineCurve;
  researchNodeIds: ResearchNodeId[];
  specIds: SpecId[];
  payoutCue: MachinePayoutCue;
}

export interface ResearchNodeDefinition {
  id: ResearchNodeId;
  machineId: MachineId;
  displayName: string;
  description: string;
  /** Chips for the first rank. */
  chipCost: number;
  /** Applied per rank already held, so a repeatable node gets dearer. */
  chipCostGrowth: number;
  /** `null` for a node that can be bought forever. */
  maximumRank: number | null;
  /** Payout multiplier contributed by each rank. 1 for nodes that only unlock. */
  payoutMultiplierPerRank: number;
  prerequisiteNodeIds: ResearchNodeId[];
  unlocksSpecId?: SpecId;
}

/**
 * How a spec behaves beyond its flat multipliers.
 *
 * - `static` applies its multipliers and nothing else.
 * - `gambler` redraws its payout every cycle. Its `payoutMultiplier` stays 1,
 *   because the draw replaces it; `GAMBLER_MEAN` is what display should use.
 * - `flywheel` shortens each cycle by a fixed fraction of the last, down to a
 *   floor. Its `durationMultiplier` is the ramp's starting point.
 */
export type SpecBehaviour = "static" | "gambler" | "flywheel";

export interface SpecDefinition {
  id: SpecId;
  machineId: MachineId;
  displayName: string;
  description: string;
  behaviour: SpecBehaviour;
  payoutMultiplier: number;
  durationMultiplier: number;
  requiredResearchNodeId: ResearchNodeId;
}

/**
 * The Gambler draw: `minimum + span * u ** exponent` for a uniform `u`. A
 * uniform draw would average 2.25x against Endurance's 1.5x, which is a free
 * doubling rather than a variance tradeoff. Cubing skews the mass low — the
 * median cycle pays 0.94x — so a 4x cycle is a rare, visible event.
 */
export const GAMBLER_MINIMUM = 0.5;
export const GAMBLER_MAXIMUM = 4;
export const GAMBLER_EXPONENT = 3;

/** E[X] for the draw above: minimum + span / (exponent + 1). */
export const GAMBLER_MEAN =
  GAMBLER_MINIMUM + (GAMBLER_MAXIMUM - GAMBLER_MINIMUM) / (GAMBLER_EXPONENT + 1);

/** Var(X) for the same draw, needed to approximate a long offline stretch. */
export const GAMBLER_VARIANCE =
  (GAMBLER_MAXIMUM - GAMBLER_MINIMUM) ** 2 *
  (1 / (2 * GAMBLER_EXPONENT + 1) - 1 / (GAMBLER_EXPONENT + 1) ** 2);

/** Each completed cycle shortens the next by this fraction, down to the floor. */
export const FLYWHEEL_SHORTENING_PER_CYCLE = 0.015;
export const FLYWHEEL_FLOOR = 0.5;

/** The payout multiplier a spec averages, which is what a rate readout wants. */
export function expectedSpecPayoutMultiplier(spec: SpecDefinition): number {
  return spec.behaviour === "gambler" ? GAMBLER_MEAN : spec.payoutMultiplier;
}

/**
 * Evaluates a machine's level curve at any level. There is no maximum.
 *
 * Costs are not clamped to `safeMaximum`: cash is, so an unaffordable cost is
 * its own wall, whereas clamping the cost would open a band where the price
 * stopped rising while payout kept climbing. The payout multiplier is clamped,
 * because it feeds cash arithmetic. Returns null only when a value stops being
 * representable at all.
 */
export function evaluateMachineLevel(
  definition: MachineDefinition,
  level: number,
): MachineLevelDefinition | null {
  if (!Number.isInteger(level) || level < 1) {
    return null;
  }

  const { curve } = definition;
  const step = level - 1;

  const payoutMultiplier = Math.min(curve.payoutGrowth ** step, ECONOMY.safeMaximum);
  const cashCost = level === 1 ? 0 : curve.firstCashCost * curve.cashGrowth ** (step - 1);
  const chargesComponents =
    curve.componentEveryNLevels > 0 && level % curve.componentEveryNLevels === 0;
  const componentCost = chargesComponents
    ? curve.firstComponentCost *
      curve.componentGrowth ** (level / curve.componentEveryNLevels - 1)
    : 0;

  if (
    !Number.isFinite(payoutMultiplier) ||
    !Number.isFinite(cashCost) ||
    !Number.isFinite(componentCost)
  ) {
    return null;
  }

  return {
    level,
    payoutMultiplier,
    cashCost: Math.round(cashCost),
    componentCost: Math.round(componentCost),
  };
}

export const MACHINES: Record<MachineId, MachineDefinition> = {
  "machine.alpha": {
    id: "machine.alpha",
    displayName: "Penny Reels",
    description: "A battered three-reel cabinet. Pays little, pays often.",
    spriteId: "sprite.machine.alpha",
    startsUnlocked: true,
    recipePiecesRequired: 0,
    recipeBand: "band.shelf",
    basePayout: 5,
    baseCycleMs: 3_000,
    curve: {
      payoutGrowth: 1.0553,
      firstCashCost: 100,
      cashGrowth: 1.06,
      componentEveryNLevels: 5,
      firstComponentCost: 2,
      componentGrowth: 1.03,
    },
    researchNodeIds: [
      "research.alpha.overclock",
      "research.alpha.spec-endurance",
      "research.alpha.spec-gambler",
      "research.alpha.spec-flywheel",
    ],
    specIds: ["spec.alpha.endurance", "spec.alpha.gambler", "spec.alpha.flywheel"],
    payoutCue: { frequency: 880, endFrequency: 1174, durationMs: 60, gain: 0.1 },
  },
  "machine.beta": {
    id: "machine.beta",
    displayName: "Vacuum Roulette",
    description: "A sealed wheel that spins in a hard vacuum. Slower, richer.",
    spriteId: "sprite.machine.beta",
    startsUnlocked: false,
    recipePiecesRequired: 3,
    recipeBand: "band.shelf",
    basePayout: 46,
    baseCycleMs: 7_000,
    curve: {
      payoutGrowth: 1.0567,
      firstCashCost: 390,
      cashGrowth: 1.062,
      componentEveryNLevels: 5,
      firstComponentCost: 4,
      componentGrowth: 1.031,
    },
    researchNodeIds: [
      "research.beta.overclock",
      "research.beta.spec-endurance",
      "research.beta.spec-gambler",
      "research.beta.spec-flywheel",
    ],
    specIds: ["spec.beta.endurance", "spec.beta.gambler", "spec.beta.flywheel"],
    payoutCue: { frequency: 698, endFrequency: 932, durationMs: 75, gain: 0.11 },
  },
  "machine.gamma": {
    id: "machine.gamma",
    displayName: "Crater Tables",
    description: "A whole pit of automated tables. Long cycles, heavy payouts.",
    spriteId: "sprite.machine.gamma",
    startsUnlocked: false,
    recipePiecesRequired: 4,
    recipeBand: "band.shelf",
    basePayout: 420,
    baseCycleMs: 13_000,
    curve: {
      payoutGrowth: 1.0582,
      firstCashCost: 1_900,
      cashGrowth: 1.064,
      componentEveryNLevels: 5,
      firstComponentCost: 8,
      componentGrowth: 1.032,
    },
    researchNodeIds: [
      "research.gamma.overclock",
      "research.gamma.spec-endurance",
      "research.gamma.spec-gambler",
      "research.gamma.spec-flywheel",
    ],
    specIds: ["spec.gamma.endurance", "spec.gamma.gambler", "spec.gamma.flywheel"],
    payoutCue: { frequency: 587, endFrequency: 784, durationMs: 90, gain: 0.12 },
  },
  "machine.delta": {
    id: "machine.delta",
    displayName: "Regolith Keno",
    description: "Numbers drawn from settling dust. Patient, and generous to the patient.",
    spriteId: "sprite.machine.delta",
    startsUnlocked: false,
    recipePiecesRequired: 4,
    recipeBand: "band.seams",
    basePayout: 3_600,
    baseCycleMs: 19_000,
    curve: {
      payoutGrowth: 1.0596,
      firstCashCost: 11_000,
      cashGrowth: 1.066,
      componentEveryNLevels: 5,
      firstComponentCost: 14,
      componentGrowth: 1.033,
    },
    researchNodeIds: [
      "research.delta.overclock",
      "research.delta.spec-endurance",
      "research.delta.spec-gambler",
      "research.delta.spec-flywheel",
    ],
    specIds: ["spec.delta.endurance", "spec.delta.gambler", "spec.delta.flywheel"],
    payoutCue: { frequency: 494, endFrequency: 659, durationMs: 105, gain: 0.13 },
  },
  "machine.epsilon": {
    id: "machine.epsilon",
    displayName: "Airlock Baccarat",
    description: "Two hands dealt between pressure cycles. The house counts the seconds.",
    spriteId: "sprite.machine.epsilon",
    startsUnlocked: false,
    recipePiecesRequired: 5,
    recipeBand: "band.seams",
    basePayout: 31_000,
    baseCycleMs: 26_000,
    curve: {
      payoutGrowth: 1.0611,
      firstCashCost: 72_000,
      cashGrowth: 1.068,
      componentEveryNLevels: 5,
      firstComponentCost: 22,
      componentGrowth: 1.034,
    },
    researchNodeIds: [
      "research.epsilon.overclock",
      "research.epsilon.spec-endurance",
      "research.epsilon.spec-gambler",
      "research.epsilon.spec-flywheel",
    ],
    specIds: ["spec.epsilon.endurance", "spec.epsilon.gambler", "spec.epsilon.flywheel"],
    payoutCue: { frequency: 415, endFrequency: 554, durationMs: 120, gain: 0.14 },
  },
  "machine.zeta": {
    id: "machine.zeta",
    displayName: "Cascade Pachinko",
    description: "A wall of falling ball bearings, endlessly re-fed.",
    spriteId: "sprite.machine.zeta",
    startsUnlocked: false,
    recipePiecesRequired: 5,
    recipeBand: "band.dark",
    basePayout: 265_000,
    baseCycleMs: 34_000,
    curve: {
      payoutGrowth: 1.0626,
      firstCashCost: 470_000,
      cashGrowth: 1.07,
      componentEveryNLevels: 5,
      firstComponentCost: 34,
      componentGrowth: 1.035,
    },
    researchNodeIds: [
      "research.zeta.overclock",
      "research.zeta.spec-endurance",
      "research.zeta.spec-gambler",
      "research.zeta.spec-flywheel",
    ],
    specIds: ["spec.zeta.endurance", "spec.zeta.gambler", "spec.zeta.flywheel"],
    payoutCue: { frequency: 349, endFrequency: 466, durationMs: 140, gain: 0.15 },
  },
  "machine.eta": {
    id: "machine.eta",
    displayName: "Tidal Wheel",
    description: "Geared to the pull of the Earth overhead. It never quite stops.",
    spriteId: "sprite.machine.eta",
    startsUnlocked: false,
    recipePiecesRequired: 6,
    recipeBand: "band.dark",
    basePayout: 2_300_000,
    baseCycleMs: 43_000,
    curve: {
      payoutGrowth: 1.064,
      firstCashCost: 3_200_000,
      cashGrowth: 1.072,
      componentEveryNLevels: 5,
      firstComponentCost: 52,
      componentGrowth: 1.036,
    },
    researchNodeIds: [
      "research.eta.overclock",
      "research.eta.spec-endurance",
      "research.eta.spec-gambler",
      "research.eta.spec-flywheel",
    ],
    specIds: ["spec.eta.endurance", "spec.eta.gambler", "spec.eta.flywheel"],
    payoutCue: { frequency: 294, endFrequency: 392, durationMs: 160, gain: 0.16 },
  },
  "machine.theta": {
    id: "machine.theta",
    displayName: "Ghost Parlour",
    description: "Nobody staffs it. The chips move anyway.",
    spriteId: "sprite.machine.theta",
    startsUnlocked: false,
    recipePiecesRequired: 6,
    recipeBand: "band.hollow",
    basePayout: 20_000_000,
    baseCycleMs: 53_000,
    curve: {
      payoutGrowth: 1.0655,
      firstCashCost: 23_000_000,
      cashGrowth: 1.074,
      componentEveryNLevels: 5,
      firstComponentCost: 80,
      componentGrowth: 1.037,
    },
    researchNodeIds: [
      "research.theta.overclock",
      "research.theta.spec-endurance",
      "research.theta.spec-gambler",
      "research.theta.spec-flywheel",
    ],
    specIds: ["spec.theta.endurance", "spec.theta.gambler", "spec.theta.flywheel"],
    payoutCue: { frequency: 247, endFrequency: 330, durationMs: 185, gain: 0.17 },
  },
  "machine.iota": {
    id: "machine.iota",
    displayName: "Orbital Craps",
    description: "Dice thrown in free fall, settled by a slow spin.",
    spriteId: "sprite.machine.iota",
    startsUnlocked: false,
    recipePiecesRequired: 7,
    recipeBand: "band.hollow",
    basePayout: 175_000_000,
    baseCycleMs: 64_000,
    curve: {
      payoutGrowth: 1.0669,
      firstCashCost: 160_000_000,
      cashGrowth: 1.076,
      componentEveryNLevels: 5,
      firstComponentCost: 122,
      componentGrowth: 1.038,
    },
    researchNodeIds: [
      "research.iota.overclock",
      "research.iota.spec-endurance",
      "research.iota.spec-gambler",
      "research.iota.spec-flywheel",
    ],
    specIds: ["spec.iota.endurance", "spec.iota.gambler", "spec.iota.flywheel"],
    payoutCue: { frequency: 208, endFrequency: 277, durationMs: 210, gain: 0.18 },
  },
  "machine.kappa": {
    id: "machine.kappa",
    displayName: "Selenite Vault",
    description: "The house's own reserve, opened to anyone who can reach it.",
    spriteId: "sprite.machine.kappa",
    startsUnlocked: false,
    recipePiecesRequired: 8,
    recipeBand: "band.core",
    basePayout: 1_500_000_000,
    baseCycleMs: 78_000,
    curve: {
      payoutGrowth: 1.0684,
      firstCashCost: 1_200_000_000,
      cashGrowth: 1.078,
      componentEveryNLevels: 5,
      firstComponentCost: 186,
      componentGrowth: 1.039,
    },
    researchNodeIds: [
      "research.kappa.overclock",
      "research.kappa.spec-endurance",
      "research.kappa.spec-gambler",
      "research.kappa.spec-flywheel",
    ],
    specIds: ["spec.kappa.endurance", "spec.kappa.gambler", "spec.kappa.flywheel"],
    payoutCue: { frequency: 175, endFrequency: 233, durationMs: 240, gain: 0.19 },
  },
};

interface ResearchCosts {
  machineId: MachineId;
  /** Chips for Overclock rank 1. Each further rank costs `chipCostGrowth` more. */
  overclockCost: number;
  enduranceCost: number;
  gamblerCost: number;
  flywheelCost: number;
}

interface ResearchIds {
  overclock: ResearchNodeId;
  endurance: ResearchNodeId;
  gambler: ResearchNodeId;
  flywheel: ResearchNodeId;
  enduranceSpec: SpecId;
  gamblerSpec: SpecId;
  flywheelSpec: SpecId;
}

/** Each Overclock rank doubles the machine's payout, and there is no last rank. */
export const OVERCLOCK_PAYOUT_PER_RANK = 2;
export const OVERCLOCK_CHIP_GROWTH = 4;

/**
 * A machine's repeatable payout research — its Overclock. Identified
 * structurally, as the only node that never runs out of ranks and raises payout,
 * so rewording a display name cannot stop the balance rule below from checking.
 */
export function overclockNodeFor(machineId: MachineId): ResearchNodeDefinition | null {
  for (const nodeId of MACHINES[machineId].researchNodeIds) {
    const node = RESEARCH_NODES[nodeId];

    if (node.maximumRank === null && node.payoutMultiplierPerRank > 1) {
      return node;
    }
  }

  return null;
}

/**
 * How much cash per second a machine reaches for a given chip budget, stripped
 * of the budget itself. Each Overclock rank costs `OVERCLOCK_CHIP_GROWTH` times
 * the last and pays `OVERCLOCK_PAYOUT_PER_RANK` times the last, so `B` chips
 * reach roughly
 *
 *     cash/s  ≈  (basePayout / cycleSeconds) / overclockCost^k  ×  B^k
 *
 * where `k = log(payoutPerRank) / log(chipGrowth)`. The budget is common to
 * every machine, so the leading term alone is a machine's competitive position,
 * and comparing adjacent machines with it catches a rung that is no upgrade.
 */
export function machineMerit(machineId: MachineId): number {
  const definition = MACHINES[machineId];
  const overclock = overclockNodeFor(machineId);

  if (overclock === null || definition.baseCycleMs <= 0) {
    return 0;
  }

  const exponent = Math.log(OVERCLOCK_PAYOUT_PER_RANK) / Math.log(OVERCLOCK_CHIP_GROWTH);
  const baseRate = definition.basePayout / (definition.baseCycleMs / 1000);

  return baseRate / overclock.chipCost ** exponent;
}

function buildResearch(costs: ResearchCosts, ids: ResearchIds): ResearchNodeDefinition[] {
  return [
    {
      id: ids.overclock,
      machineId: costs.machineId,
      displayName: "Overclock",
      description: "Doubles this machine's payout. Repeatable, and each rank costs more.",
      chipCost: costs.overclockCost,
      chipCostGrowth: OVERCLOCK_CHIP_GROWTH,
      maximumRank: null,
      payoutMultiplierPerRank: OVERCLOCK_PAYOUT_PER_RANK,
      prerequisiteNodeIds: [],
    },
    {
      id: ids.endurance,
      machineId: costs.machineId,
      displayName: "Endurance tuning",
      description: "Unlocks the endurance spec.",
      chipCost: costs.enduranceCost,
      chipCostGrowth: 1,
      maximumRank: 1,
      payoutMultiplierPerRank: 1,
      prerequisiteNodeIds: [],
      unlocksSpecId: ids.enduranceSpec,
    },
    {
      id: ids.gambler,
      machineId: costs.machineId,
      displayName: "Gambler tuning",
      description: "Unlocks the gambler spec.",
      chipCost: costs.gamblerCost,
      chipCostGrowth: 1,
      maximumRank: 1,
      payoutMultiplierPerRank: 1,
      // No prerequisite: the three specs are alternatives, so requiring one
      // before another would make it a toll rather than a choice.
      prerequisiteNodeIds: [],
      unlocksSpecId: ids.gamblerSpec,
    },
    {
      id: ids.flywheel,
      machineId: costs.machineId,
      displayName: "Flywheel tuning",
      description: "Unlocks the flywheel spec.",
      chipCost: costs.flywheelCost,
      chipCostGrowth: 1,
      maximumRank: 1,
      payoutMultiplierPerRank: 1,
      prerequisiteNodeIds: [],
      unlocksSpecId: ids.flywheelSpec,
    },
  ];
}

const RESEARCH_LIST: ResearchNodeDefinition[] = [
  ...buildResearch(
    {
      machineId: "machine.alpha",
      /*
       * Priced to keep the step up to Vacuum Roulette in line with the rest of
       * the ladder. Every other step gains 1.67x–2.99x of merit (see
       * `machineMerit`); at a lower cost here the step is 1.8%, a dead heat that
       * rank quantisation settles in Penny's favour at every budget, leaving the
       * starter the best machine indefinitely. At 110 the step is 1.69x.
       *
       * Raising Penny is the only single-machine fix: lowering Vacuum Roulette
       * instead lands its merit on Crater Tables' and recreates the flat step one
       * rung up. The cost to the opening is that the first Overclock takes two or
       * three runs rather than one.
       */
      overclockCost: 110,
      enduranceCost: 90,
      gamblerCost: 220,
      flywheelCost: 260,
    },
    {
      overclock: "research.alpha.overclock",
      endurance: "research.alpha.spec-endurance",
      gambler: "research.alpha.spec-gambler",
      flywheel: "research.alpha.spec-flywheel",
      enduranceSpec: "spec.alpha.endurance",
      gamblerSpec: "spec.alpha.gambler",
      flywheelSpec: "spec.alpha.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.beta",
      overclockCost: 600,
      enduranceCost: 900,
      gamblerCost: 1_900,
      flywheelCost: 2_200,
    },
    {
      overclock: "research.beta.overclock",
      endurance: "research.beta.spec-endurance",
      gambler: "research.beta.spec-gambler",
      flywheel: "research.beta.spec-flywheel",
      enduranceSpec: "spec.beta.endurance",
      gamblerSpec: "spec.beta.gambler",
      flywheelSpec: "spec.beta.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.gamma",
      overclockCost: 5_200,
      enduranceCost: 7_400,
      gamblerCost: 14_000,
      flywheelCost: 16_500,
    },
    {
      overclock: "research.gamma.overclock",
      endurance: "research.gamma.spec-endurance",
      gambler: "research.gamma.spec-gambler",
      flywheel: "research.gamma.spec-flywheel",
      enduranceSpec: "spec.gamma.endurance",
      gamblerSpec: "spec.gamma.gambler",
      flywheelSpec: "spec.gamma.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.delta",
      overclockCost: 34_000,
      enduranceCost: 48_000,
      gamblerCost: 92_000,
      flywheelCost: 108_000,
    },
    {
      overclock: "research.delta.overclock",
      endurance: "research.delta.spec-endurance",
      gambler: "research.delta.spec-gambler",
      flywheel: "research.delta.spec-flywheel",
      enduranceSpec: "spec.delta.endurance",
      gamblerSpec: "spec.delta.gambler",
      flywheelSpec: "spec.delta.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.epsilon",
      overclockCost: 210_000,
      enduranceCost: 300_000,
      gamblerCost: 570_000,
      flywheelCost: 670_000,
    },
    {
      overclock: "research.epsilon.overclock",
      endurance: "research.epsilon.spec-endurance",
      gambler: "research.epsilon.spec-gambler",
      flywheel: "research.epsilon.spec-flywheel",
      enduranceSpec: "spec.epsilon.endurance",
      gamblerSpec: "spec.epsilon.gambler",
      flywheelSpec: "spec.epsilon.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.zeta",
      overclockCost: 1_300_000,
      enduranceCost: 1_850_000,
      gamblerCost: 3_500_000,
      flywheelCost: 4_100_000,
    },
    {
      overclock: "research.zeta.overclock",
      endurance: "research.zeta.spec-endurance",
      gambler: "research.zeta.spec-gambler",
      flywheel: "research.zeta.spec-flywheel",
      enduranceSpec: "spec.zeta.endurance",
      gamblerSpec: "spec.zeta.gambler",
      flywheelSpec: "spec.zeta.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.eta",
      overclockCost: 7_800_000,
      enduranceCost: 11_000_000,
      gamblerCost: 21_000_000,
      flywheelCost: 24_500_000,
    },
    {
      overclock: "research.eta.overclock",
      endurance: "research.eta.spec-endurance",
      gambler: "research.eta.spec-gambler",
      flywheel: "research.eta.spec-flywheel",
      enduranceSpec: "spec.eta.endurance",
      gamblerSpec: "spec.eta.gambler",
      flywheelSpec: "spec.eta.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.theta",
      overclockCost: 46_000_000,
      enduranceCost: 65_000_000,
      gamblerCost: 124_000_000,
      flywheelCost: 145_000_000,
    },
    {
      overclock: "research.theta.overclock",
      endurance: "research.theta.spec-endurance",
      gambler: "research.theta.spec-gambler",
      flywheel: "research.theta.spec-flywheel",
      enduranceSpec: "spec.theta.endurance",
      gamblerSpec: "spec.theta.gambler",
      flywheelSpec: "spec.theta.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.iota",
      overclockCost: 270_000_000,
      enduranceCost: 380_000_000,
      gamblerCost: 730_000_000,
      flywheelCost: 855_000_000,
    },
    {
      overclock: "research.iota.overclock",
      endurance: "research.iota.spec-endurance",
      gambler: "research.iota.spec-gambler",
      flywheel: "research.iota.spec-flywheel",
      enduranceSpec: "spec.iota.endurance",
      gamblerSpec: "spec.iota.gambler",
      flywheelSpec: "spec.iota.flywheel",
    },
  ),
  ...buildResearch(
    {
      machineId: "machine.kappa",
      overclockCost: 1_600_000_000,
      enduranceCost: 2_250_000_000,
      gamblerCost: 4_300_000_000,
      flywheelCost: 5_050_000_000,
    },
    {
      overclock: "research.kappa.overclock",
      endurance: "research.kappa.spec-endurance",
      gambler: "research.kappa.spec-gambler",
      flywheel: "research.kappa.spec-flywheel",
      enduranceSpec: "spec.kappa.endurance",
      gamblerSpec: "spec.kappa.gambler",
      flywheelSpec: "spec.kappa.flywheel",
    },
  ),
];

export const RESEARCH_NODES = Object.fromEntries(
  RESEARCH_LIST.map((node) => [node.id, node]),
) as Record<ResearchNodeId, ResearchNodeDefinition>;

function buildSpecs(
  machineId: MachineId,
  ids: {
    endurance: SpecId;
    gambler: SpecId;
    flywheel: SpecId;
    enduranceResearch: ResearchNodeId;
    gamblerResearch: ResearchNodeId;
    flywheelResearch: ResearchNodeId;
  },
): SpecDefinition[] {
  return [
    {
      id: ids.endurance,
      machineId,
      displayName: "Endurance",
      description: "Triple payout for double the cycle time.",
      behaviour: "static",
      payoutMultiplier: 3,
      durationMultiplier: 2,
      requiredResearchNodeId: ids.enduranceResearch,
    },
    {
      id: ids.gambler,
      machineId,
      displayName: "Gambler",
      description: `Every cycle pays a random ${GAMBLER_MINIMUM}x to ${GAMBLER_MAXIMUM}x the base. Most land low; a few land very high.`,
      behaviour: "gambler",
      // 1, not the mean: the per-cycle draw replaces this rather than stacking on
      // it. Rate readouts use `expectedSpecPayoutMultiplier`.
      payoutMultiplier: 1,
      durationMultiplier: 1,
      requiredResearchNodeId: ids.gamblerResearch,
    },
    {
      id: ids.flywheel,
      machineId,
      displayName: "Flywheel",
      description: `Each completed cycle shortens the next, down to half the base time. Changing spec resets the ramp.`,
      behaviour: "flywheel",
      payoutMultiplier: 1,
      durationMultiplier: 1,
      requiredResearchNodeId: ids.flywheelResearch,
    },
  ];
}

const SPEC_LIST: SpecDefinition[] = [
  ...buildSpecs("machine.alpha", {
    endurance: "spec.alpha.endurance",
    gambler: "spec.alpha.gambler",
    flywheel: "spec.alpha.flywheel",
    enduranceResearch: "research.alpha.spec-endurance",
    gamblerResearch: "research.alpha.spec-gambler",
    flywheelResearch: "research.alpha.spec-flywheel",
  }),
  ...buildSpecs("machine.beta", {
    endurance: "spec.beta.endurance",
    gambler: "spec.beta.gambler",
    flywheel: "spec.beta.flywheel",
    enduranceResearch: "research.beta.spec-endurance",
    gamblerResearch: "research.beta.spec-gambler",
    flywheelResearch: "research.beta.spec-flywheel",
  }),
  ...buildSpecs("machine.gamma", {
    endurance: "spec.gamma.endurance",
    gambler: "spec.gamma.gambler",
    flywheel: "spec.gamma.flywheel",
    enduranceResearch: "research.gamma.spec-endurance",
    gamblerResearch: "research.gamma.spec-gambler",
    flywheelResearch: "research.gamma.spec-flywheel",
  }),
  ...buildSpecs("machine.delta", {
    endurance: "spec.delta.endurance",
    gambler: "spec.delta.gambler",
    flywheel: "spec.delta.flywheel",
    enduranceResearch: "research.delta.spec-endurance",
    gamblerResearch: "research.delta.spec-gambler",
    flywheelResearch: "research.delta.spec-flywheel",
  }),
  ...buildSpecs("machine.epsilon", {
    endurance: "spec.epsilon.endurance",
    gambler: "spec.epsilon.gambler",
    flywheel: "spec.epsilon.flywheel",
    enduranceResearch: "research.epsilon.spec-endurance",
    gamblerResearch: "research.epsilon.spec-gambler",
    flywheelResearch: "research.epsilon.spec-flywheel",
  }),
  ...buildSpecs("machine.zeta", {
    endurance: "spec.zeta.endurance",
    gambler: "spec.zeta.gambler",
    flywheel: "spec.zeta.flywheel",
    enduranceResearch: "research.zeta.spec-endurance",
    gamblerResearch: "research.zeta.spec-gambler",
    flywheelResearch: "research.zeta.spec-flywheel",
  }),
  ...buildSpecs("machine.eta", {
    endurance: "spec.eta.endurance",
    gambler: "spec.eta.gambler",
    flywheel: "spec.eta.flywheel",
    enduranceResearch: "research.eta.spec-endurance",
    gamblerResearch: "research.eta.spec-gambler",
    flywheelResearch: "research.eta.spec-flywheel",
  }),
  ...buildSpecs("machine.theta", {
    endurance: "spec.theta.endurance",
    gambler: "spec.theta.gambler",
    flywheel: "spec.theta.flywheel",
    enduranceResearch: "research.theta.spec-endurance",
    gamblerResearch: "research.theta.spec-gambler",
    flywheelResearch: "research.theta.spec-flywheel",
  }),
  ...buildSpecs("machine.iota", {
    endurance: "spec.iota.endurance",
    gambler: "spec.iota.gambler",
    flywheel: "spec.iota.flywheel",
    enduranceResearch: "research.iota.spec-endurance",
    gamblerResearch: "research.iota.spec-gambler",
    flywheelResearch: "research.iota.spec-flywheel",
  }),
  ...buildSpecs("machine.kappa", {
    endurance: "spec.kappa.endurance",
    gambler: "spec.kappa.gambler",
    flywheel: "spec.kappa.flywheel",
    enduranceResearch: "research.kappa.spec-endurance",
    gamblerResearch: "research.kappa.spec-gambler",
    flywheelResearch: "research.kappa.spec-flywheel",
  }),
];

export const SPECS = Object.fromEntries(SPEC_LIST.map((spec) => [spec.id, spec])) as Record<
  SpecId,
  SpecDefinition
>;

export const STARTER_MACHINE_ID: MachineId = "machine.alpha";
