/**
 * Startup validation for the static content catalog.
 *
 * Development builds must fail immediately on invalid content. Production
 * builds surface a fatal configuration error and must not write a save.
 */

import { CATALOG, type ContentCatalog } from "./catalog";
import { STAT_IDS, type Modifier, type StatId } from "./economy";
import { CHIP_GAME_NAMES } from "./chipGames";
import { FIRST_ENCOUNTER_ID } from "./encounters";
import {
  evaluateMachineLevel,
  FLYWHEEL_FLOOR,
  FLYWHEEL_SHORTENING_PER_CYCLE,
  GAMBLER_EXPONENT,
  GAMBLER_MAXIMUM,
  GAMBLER_MEAN,
  GAMBLER_MINIMUM,
  GAMBLER_VARIANCE,
} from "./machines";
import type { EncounterDefinition, RewardTableDefinition } from "./encounters";
import { CONSUMABLES, CONSUMABLE_IDS } from "./consumables";
import { DEPTH_BANDS, DEPTH_BAND_IDS, isDepthBandId } from "./depthBands";
import { GRADE_IDS, GRADE_SCALARS, scaleModifiers } from "./grades";
import { machineMerit } from "./machines";

/**
 * The smallest gain a machine may offer over the one below it, per chip spent.
 * Set below the 1.67 the tightest healthy rung manages, so the rule catches a
 * collapsed rung without failing on a ten percent tuning change.
 */
const MINIMUM_LADDER_GAIN = 1.5;

/**
 * Longest a tutorial act may run before it stops being a card and becomes a
 * lecture. Three is the cutting rule the script is written to, and this is what
 * keeps it there.
 */
const MAXIMUM_ACT_STEPS = 3;

/** The one act allowed to present while a run is in flight. See decision 3. */
const DESCENT_ACT_ID = "act.descent";

/** Guards against a zero merit, which would otherwise report an infinite gain. */
function safeMeritGain(previous: number, current: number): number {
  return previous > 0 ? current / previous : 0;
}
import { CONTRACTS } from "./contracts";
import { MAXIMUM_ENTRY_BODY, MAXIMUM_TOPIC_BODY, topicBodyLength } from "./help";
import {
  MAXIMUM_STEP_WORDS,
  TUTORIAL_ACTS,
  TUTORIAL_ANCHORS,
  isTutorialGateId,
  stepWordCount,
} from "./tutorial";
import { SPRITES } from "../rendering/sprites";
import { TOTEM_FORBIDDEN_STATS } from "./totems";

export interface ContentValidationResult {
  valid: boolean;
  issues: string[];
}

export class ContentValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid content catalog:\n- ${issues.join("\n- ")}`);
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}

const STAT_ID_SET = new Set<string>(STAT_IDS);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

class IssueCollector {
  readonly issues: string[] = [];

  check(condition: boolean, message: string): void {
    if (!condition) {
      this.issues.push(message);
    }
  }

  nonNegativeInteger(value: unknown, label: string, maximum: number): void {
    this.check(
      isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= maximum,
      `${label} must be a non-negative integer within safe bounds (received ${String(value)}).`,
    );
  }

  positive(value: unknown, label: string): void {
    this.check(
      isFiniteNumber(value) && value > 0,
      `${label} must be a positive finite number (received ${String(value)}).`,
    );
  }

  finite(value: unknown, label: string): void {
    this.check(isFiniteNumber(value), `${label} must be finite (received ${String(value)}).`);
  }
}

function validateModifiers(
  collector: IssueCollector,
  modifiers: Modifier[],
  label: string,
  forbiddenStats: readonly StatId[] = [],
): void {
  for (const modifier of modifiers) {
    collector.check(
      STAT_ID_SET.has(modifier.targetStat),
      `${label} targets unknown stat "${modifier.targetStat}".`,
    );
    collector.finite(modifier.value, `${label} modifier value for ${modifier.targetStat}`);

    if (modifier.operation === "multiply") {
      collector.positive(modifier.value, `${label} multiplicative modifier for ${modifier.targetStat}`);
    }

    collector.check(
      !forbiddenStats.includes(modifier.targetStat),
      `${label} must not modify "${modifier.targetStat}".`,
    );
    collector.check(
      modifier.sourceId.length > 0,
      `${label} modifier is missing a source id.`,
    );
  }
}

function validateRewardTable(
  collector: IssueCollector,
  table: RewardTableDefinition,
  safeMaximum: number,
): void {
  const label = `Reward table "${table.id}"`;
  collector.check(table.entries.length > 0, `${label} has no entries.`);

  const positiveWeightEntries = table.entries.filter(
    (entry) => isFiniteNumber(entry.weight) && entry.weight > 0,
  );
  collector.check(
    positiveWeightEntries.length > 0,
    `${label} has no entry with a positive weight.`,
  );

  const entryIds = new Set<string>();

  for (const entry of table.entries) {
    collector.check(!entryIds.has(entry.id), `${label} repeats entry id "${entry.id}".`);
    entryIds.add(entry.id);
    collector.positive(entry.weight, `${label} entry "${entry.id}" weight`);
    collector.check(entry.grants.length > 0, `${label} entry "${entry.id}" grants nothing.`);

    for (const grant of entry.grants) {
      const grantLabel = `${label} entry "${entry.id}" ${grant.kind} grant`;

      // A collectible is one item drawn from a pool, so it has no range.
      if (grant.kind === "collectible") {
        collector.check(
          ["trinket", "totem", "any"].includes(grant.pool),
          `${grantLabel} draws from unknown pool "${grant.pool}".`,
        );
        continue;
      }

      // A contract is one goal offered, so it has no range either. The contracts
      // themselves are checked below, where the whole catalogue is in scope.
      if (grant.kind === "contract") {
        collector.check(
          CONTRACTS[grant.contractId] !== undefined,
          `${grantLabel} offers unknown contract "${grant.contractId}".`,
        );
        continue;
      }

      collector.nonNegativeInteger(grant.minimum, `${grantLabel} minimum`, safeMaximum);
      collector.nonNegativeInteger(grant.maximum, `${grantLabel} maximum`, safeMaximum);
      collector.check(
        isFiniteNumber(grant.minimum) &&
          isFiniteNumber(grant.maximum) &&
          grant.minimum <= grant.maximum,
        `${grantLabel} minimum exceeds its maximum.`,
      );
      collector.check(grant.maximum > 0, `${grantLabel} can never grant anything.`);
    }
  }
}

/** True when any of an encounter's reward tables can pay a recipe piece. */
function encounterGrantsRecipePiece(
  encounter: EncounterDefinition,
  catalog: ContentCatalog,
): boolean {
  const tables = [
    ...(encounter.rewardTableId ? [encounter.rewardTableId] : []),
    ...(encounter.choiceOptions ?? []).map((option) => option.rewardTableId),
  ];

  return tables.some((tableId) =>
    catalog.rewardTables[tableId]?.entries.some((entry) =>
      entry.grants.some((grant) => grant.kind === "recipePiece"),
    ),
  );
}

function validateEncounter(
  collector: IssueCollector,
  encounter: EncounterDefinition,
  catalog: ContentCatalog,
): void {
  const label = `Encounter "${encounter.id}"`;

  // An encounter outside the table is generated by its own rule, so it has no
  // band and no weight. It must be inert in the table, or it is drawn twice.
  if (encounter.outsideTable === true) {
    collector.check(
      encounter.bands.length === 0,
      `${label} is outside the table, so it must belong to no band.`,
    );
    collector.check(
      encounter.baseWeight === 0,
      `${label} is outside the table, so its base weight must be zero.`,
    );
    collector.check(
      encounter.beneficialTags.length === 0,
      `${label} is outside the table, so no weight modifier may reach it.`,
    );

    return;
  }

  collector.check(
    encounter.bands.length > 0,
    `${label} belongs to no depth band, so it could never be generated.`,
  );

  for (const bandId of encounter.bands) {
    collector.check(isDepthBandId(bandId), `${label} names unknown depth band "${bandId}".`);
  }
  collector.positive(encounter.baseWeight, `${label} base weight`);
  collector.positive(encounter.approachDurationMs, `${label} approach duration`);
  collector.positive(encounter.oxygenDrainMultiplier, `${label} oxygen drain multiplier`);

  if (encounter.resolutionMode === "automatic") {
    collector.check(
      encounter.rewardTableId !== undefined,
      `${label} resolves automatically but has no reward table.`,
    );

    if (encounter.family === "ore") {
      collector.positive(encounter.durability, `${label} durability`);
      collector.check(
        encounter.resolveDurationMs === undefined,
        `${label} is an ore encounter, so its duration must come from durability.`,
      );
    } else {
      collector.positive(encounter.resolveDurationMs, `${label} resolve duration`);
    }
  } else {
    const options = encounter.choiceOptions ?? [];
    collector.check(options.length >= 2, `${label} is a choice encounter with fewer than two options.`);

    const optionIds = new Set<string>();

    for (const option of options) {
      const optionLabel = `${label} option "${option.id}"`;
      collector.check(!optionIds.has(option.id), `${optionLabel} id is repeated.`);
      optionIds.add(option.id);
      collector.positive(option.resolveDurationMs, `${optionLabel} resolve duration`);
      collector.positive(option.oxygenDrainMultiplier, `${optionLabel} oxygen drain multiplier`);
      collector.nonNegativeInteger(
        option.oxygenCost,
        `${optionLabel} oxygen cost`,
        catalog.economy.safeMaximum,
      );
      collector.check(
        option.rewardTableId in catalog.rewardTables,
        `${optionLabel} references unknown reward table "${option.rewardTableId}".`,
      );
    }
  }

  if (encounter.rewardTableId !== undefined) {
    collector.check(
      encounter.rewardTableId in catalog.rewardTables,
      `${label} references unknown reward table "${encounter.rewardTableId}".`,
    );
  }
}

function detectCycle(
  nodeIds: readonly string[],
  prerequisitesOf: (id: string) => readonly string[],
): string[] {
  const permanent = new Set<string>();
  const temporary = new Set<string>();
  const cycles: string[] = [];

  const visit = (id: string, trail: string[]): void => {
    if (permanent.has(id)) {
      return;
    }

    if (temporary.has(id)) {
      cycles.push([...trail, id].join(" -> "));
      return;
    }

    temporary.add(id);

    for (const prerequisite of prerequisitesOf(id)) {
      visit(prerequisite, [...trail, id]);
    }

    temporary.delete(id);
    permanent.add(id);
  };

  for (const id of nodeIds) {
    visit(id, []);
  }

  return cycles;
}

/**
 * Walks a collectible's authored effect across every grade. `validateModifiers`
 * only sees the authored values, but the scaled ones reach the game: an authored
 * `multiply 0.8` scales to `1 + (0.8 - 1) x 100 = -19`, a negative multiplier
 * that inverts the stat while the authored 0.8 passes a positivity check.
 */
function validateGradedEffect(
  collector: IssueCollector,
  label: string,
  baseModifiers: Modifier[],
  describeEffect: (modifiers: readonly Modifier[]) => string,
  forbiddenStats: readonly StatId[] = [],
): void {
  validateModifiers(collector, baseModifiers, `${label} base effect`, forbiddenStats);

  for (const grade of GRADE_IDS) {
    const scaled = scaleModifiers(baseModifiers, grade);
    const scopedLabel = `${label} at grade ${grade}`;

    validateModifiers(collector, scaled, scopedLabel, forbiddenStats);

    for (const modifier of scaled) {
      collector.check(
        Number.isFinite(modifier.value),
        `${scopedLabel} scales to a value that is not finite.`,
      );
      collector.check(
        modifier.operation !== "multiply" || modifier.value > 0,
        `${scopedLabel} scales to a non-positive multiplier, which would invert the stat.`,
      );
    }

    collector.check(
      describeEffect(scaled).length > 0,
      `${scopedLabel} produces an empty effect summary.`,
    );
  }
}

export function validateContent(catalog: ContentCatalog = CATALOG): ContentValidationResult {
  const collector = new IssueCollector();
  const safeMaximum = catalog.economy.safeMaximum;

  // Economy constants.
  collector.positive(catalog.economy.offlineCapMs, "Offline cap");
  collector.positive(catalog.economy.maxActiveTickMs, "Maximum active tick");
  collector.positive(catalog.economy.baseOxygenDrainPerSecond, "Base oxygen drain");
  collector.check(
    catalog.economy.trinketFragmentCosts.length === GRADE_IDS.length - 1,
    "The trinket fragment cost curve must cover every grade upgrade exactly once.",
  );
  collector.check(
    catalog.economy.totemFragmentCosts.length === GRADE_IDS.length - 1,
    "The totem fragment cost curve must cover every grade upgrade exactly once.",
  );

  // The grade ladder itself.
  collector.check(
    GRADE_SCALARS.length === GRADE_IDS.length,
    "Every grade must have exactly one scalar.",
  );
  collector.check(
    GRADE_SCALARS[0] === 1,
    "The lowest grade must be the authored effect, so its scalar must be exactly 1.",
  );
  GRADE_SCALARS.forEach((scalar, index) => {
    collector.positive(scalar, `Grade scalar ${GRADE_IDS[index]}`);
    collector.check(
      index === 0 || scalar > GRADE_SCALARS[index - 1],
      "Grade scalars must rise with each grade.",
    );
  });
  collector.positive(catalog.economy.fragmentsPerDuplicate, "Fragments per duplicate");
  collector.positive(
    catalog.economy.selenitePerMaxedDuplicate,
    "Selenite per maxed duplicate",
  );
  collector.positive(catalog.economy.cacheIncomeSeconds, "Cache price in seconds of income");
  collector.positive(catalog.economy.depthsPerCachePurchase, "Depths per cache purchase");
  collector.nonNegativeInteger(
    catalog.economy.depthsPerCachePurchase,
    "Depths per cache purchase",
    safeMaximum,
  );
  // The cache price is derived from income, so what content can guarantee is the
  // floor: thirty seconds of a starting income is only a few dozen cash.
  collector.check(
    catalog.economy.cacheMinimumKeyMultiple > 1,
    "A cache's price floor must exceed the key that opens it.",
  );
  collector.check(
    catalog.economy.autoContinueMinimumRatio > 0 &&
      catalog.economy.autoContinueMinimumRatio < 1,
    "The auto-continue floor must leave a usable range above zero.",
  );
  collector.positive(catalog.economy.logMaxEntries, "Log length");
  collector.positive(catalog.economy.rewardPopDurationMs, "Reward indicator duration");
  collector.check(
    catalog.economy.encounterDurationVariance > 0 &&
      catalog.economy.encounterDurationVariance < 1,
    "Encounter duration variance must be a fraction that keeps durations positive.",
  );

  // Sprite ids are checked for presence but not resolved here: content must not
  // depend on the rendering adapter. The unit tests assert every id resolves.
  for (const metadata of Object.values(catalog.resourceMetadata)) {
    collector.check(
      metadata.spriteId.length > 0,
      `Resource "${metadata.id}" has no sprite id.`,
    );
  }

  for (const grade of Object.values(catalog.oreGrades)) {
    collector.check(grade.spriteId.length > 0, `Ore grade "${grade.id}" has no sprite id.`);
  }

  for (const [label, curve] of [
    ["Trinket", catalog.economy.trinketFragmentCosts],
    ["Totem", catalog.economy.totemFragmentCosts],
  ] as const) {
    curve.forEach((cost, index) => {
      collector.nonNegativeInteger(cost, `${label} fragment cost ${index + 1}`, safeMaximum);
      collector.positive(cost, `${label} fragment cost ${index + 1}`);
      collector.check(
        index === 0 || cost > curve[index - 1],
        `${label} fragment costs must rise with each upgrade.`,
      );
    });
  }
  collector.positive(catalog.economy.luckDiminishingHalfPoint, "Luck diminishing half point");
  collector.check(
    catalog.economy.failureLossChanceMinimum <= catalog.economy.failureLossChanceBase &&
      catalog.economy.failureLossChanceBase <= catalog.economy.failureLossChanceMaximum,
    "Base failure loss chance falls outside its configured clamp range.",
  );
  collector.check(
    catalog.economy.trinketSlotsPerGear === 3,
    "Gear must expose exactly three trinket positions.",
  );
  collector.check(
    catalog.economy.activeTotemSlots === 3,
    "Exactly three active totem slots are required.",
  );
  collector.positive(catalog.economy.gamblingMaxExpectedReturn, "Chip-game expected-return cap");

  // The chip games.
  // Every game needs a name, because the name is the tab: without one the tab
  // renders unlabelled and unreachable rather than failing visibly.
  for (const gameId of catalog.chipGameIds) {
    collector.check(
      (CHIP_GAME_NAMES[gameId] ?? "").length > 0,
      `Chip game "${gameId}" has no display name, so its tab would be blank.`,
    );
  }
  collector.check(
    catalog.chipWagers.length > 0 && catalog.chipWagers.every((wager) => wager > 0),
    "The chip wager ladder must offer at least one positive stake.",
  );
  catalog.chipWagers.forEach((wager, index) => {
    collector.check(
      index === 0 || wager > catalog.chipWagers[index - 1],
      "Chip wagers must rise along the ladder.",
    );
  });

  // A European wheel is 37 pockets, and every multiplier must be fair against
  // the count of pockets that win. The cap only pulls the odds back toward base,
  // so an over-generous multiplier would pass it and pay out forever.
  collector.check(
    catalog.roulettePocketCount === 37,
    `A European wheel has 37 pockets (found ${catalog.roulettePocketCount}).`,
  );

  for (const betId of catalog.rouletteBetIds) {
    const bet = catalog.rouletteBets[betId];
    const label = `Roulette bet "${betId}"`;

    collector.positive(bet.multiplier, `${label} multiplier`);
    collector.check(bet.displayName.length > 0, `${label} has no display name.`);
    collector.check(bet.description.length > 0, `${label} has no description.`);

    if (bet.pockets === null) {
      // The straight-up bet names one pocket, so it is priced against one.
      collector.check(
        bet.multiplier === catalog.roulettePocketCount - 1,
        `${label} covers one pocket and must pay ${catalog.roulettePocketCount - 1}x.`,
      );
      continue;
    }

    collector.check(
      bet.pockets.length > 0,
      `${label} names no winning pockets.`,
    );
    collector.check(
      bet.pockets.every(
        (pocket) =>
          Number.isInteger(pocket) && pocket >= 0 && pocket < catalog.roulettePocketCount,
      ),
      `${label} names a pocket that is not on the wheel.`,
    );
    collector.check(
      new Set(bet.pockets).size === bet.pockets.length,
      `${label} names the same pocket twice, which would pay it twice.`,
    );
    // Zero may be backed, but only on its own: the house edge is the zero, so an
    // outside bet covering it would have none. The green bet backs the zero and
    // nothing else, which is a straight-up rather than a hole in an outside bet.
    collector.check(
      !bet.pockets.includes(0) || bet.pockets.length === 1,
      `${label} covers zero alongside other pockets, which would remove the house's only edge.`,
    );
    // The house edge on every outside bet is the zero, so the multiplier is
    // fully determined: 36 divided by how many pockets win.
    collector.check(
      Math.abs(bet.multiplier * bet.pockets.length - 36) < 1e-9,
      `${label} pays ${bet.multiplier}x on ${bet.pockets.length} pockets, which is not the published European price.`,
    );
  }

  collector.check(
    catalog.blackjackRanks.length === 13,
    "A blackjack shoe needs thirteen ranks.",
  );
  collector.check(
    catalog.blackjackRanks.every((rank) => catalog.blackjackLuckShape[rank] !== undefined),
    "Every blackjack rank needs a luck shape, or luck would silently ignore it.",
  );
  // Forty-four is the true bound: neither side can exceed 21 before its
  // twenty-second card, even on nothing but aces. A shorter shoe deals off the
  // end of the array, which is a silent gift rather than a visible bug.
  collector.check(
    catalog.blackjackShoeSize >= 44,
    `A committed shoe must hold at least 44 cards (found ${catalog.blackjackShoeSize}).`,
  );
  collector.check(
    catalog.blackjackMeasuredReturn.length >= 2,
    "The blackjack return table needs at least two points to interpolate between.",
  );
  catalog.blackjackMeasuredReturn.forEach(([strength, measured], index) => {
    const previous = index === 0 ? null : catalog.blackjackMeasuredReturn[index - 1];

    collector.check(
      previous === null || strength > previous[0],
      "The blackjack return table must be ordered by lean strength.",
    );
    // Monotonic, because `blendToCap` binary-searches it: a dip would let the
    // search settle on a strength whose return is above the cap.
    collector.check(
      previous === null || measured >= previous[1],
      "The blackjack return table must rise with lean strength, or the cap cannot search it.",
    );
  });
  collector.check(
    catalog.blackjackMeasuredReturn[0][1] < catalog.economy.gamblingMaxExpectedReturn,
    "Blackjack must start below the expected-return cap, or luck has nothing to give.",
  );

  // The depth wager.
  collector.check(
    catalog.economy.depthWagerBestProbability > 0 &&
      catalog.economy.depthWagerBestProbability < 1,
    "The depth-wager probability at a personal best must leave room on both sides.",
  );
  collector.positive(catalog.economy.depthWagerCurveExponent, "Depth wager curve exponent");
  collector.positive(catalog.economy.depthWagerReferenceFloor, "Depth wager reference floor");
  collector.check(
    catalog.economy.depthWagerBaseReturn > 0 &&
      catalog.economy.depthWagerBaseReturn <= catalog.economy.gamblingMaxExpectedReturn,
    "The depth wager's base return must sit inside the shared cap.",
  );
  collector.check(
    catalog.economy.depthWagerMinimumMultiplier > 1,
    "The house must refuse a depth wager that would pay less than the stake.",
  );
  collector.check(
    catalog.economy.depthWagerMaximumMultiplier > catalog.economy.depthWagerMinimumMultiplier,
    "The depth wager's price ceiling must sit above its floor.",
  );
  collector.check(
    catalog.economy.depthWagerLuckBias >= 0,
    "The depth wager's luck bias must not shade the price against the player.",
  );

  // Ore grades.
  for (const grade of Object.values(catalog.oreGrades)) {
    collector.positive(grade.chipValue, `Ore grade "${grade.id}" chip value`);
  }

  // Machines, levels, research, and specs.
  const starter = catalog.machines[catalog.starterMachineId];
  collector.check(starter !== undefined, "The starter machine id does not resolve.");
  collector.check(starter?.startsUnlocked === true, "The starter machine is not unlocked.");

  const unlockedAtStart = Object.values(catalog.machines).filter(
    (machine) => machine.startsUnlocked,
  );
  collector.check(
    unlockedAtStart.length === 1,
    `Exactly one machine may start unlocked (found ${unlockedAtStart.length}).`,
  );

  for (const machine of Object.values(catalog.machines)) {
    const label = `Machine "${machine.id}"`;
    collector.check(machine.id in catalog.machines, `${label} id does not resolve.`);
    collector.positive(machine.basePayout, `${label} base payout`);
    collector.positive(machine.baseCycleMs, `${label} base cycle duration`);
    collector.nonNegativeInteger(
      machine.recipePiecesRequired,
      `${label} recipe piece requirement`,
      safeMaximum,
    );
    collector.check(
      machine.startsUnlocked ? machine.recipePiecesRequired === 0 : machine.recipePiecesRequired > 0,
      `${label} must require recipe pieces if and only if it starts locked.`,
    );
    collector.check(
      isDepthBandId(machine.recipeBand),
      `${label} names unknown recipe band "${machine.recipeBand}".`,
    );

    // A locked machine whose band grants no recipe pieces is permanently
    // unreachable, however long the player dives there.
    if (!machine.startsUnlocked) {
      const bandGrantsPieces = Object.values(catalog.encounters).some(
        (encounter) =>
          encounter.bands.includes(machine.recipeBand) &&
          encounterGrantsRecipePiece(encounter, catalog),
      );

      collector.check(
        bandGrantsPieces,
        `${label} draws recipe pieces from a band whose encounters never grant any, so it could never be built.`,
      );
    }
    const { curve } = machine;

    collector.positive(curve.payoutGrowth, `${label} payout growth`);
    collector.positive(curve.cashGrowth, `${label} cash growth`);
    collector.positive(curve.firstCashCost, `${label} first cash cost`);
    collector.positive(curve.componentEveryNLevels, `${label} component interval`);
    collector.positive(curve.firstComponentCost, `${label} first component cost`);
    collector.positive(curve.componentGrowth, `${label} component growth`);

    // The one rule that gives an uncapped ladder a shape: without cost
    // outgrowing payout, every level pays back in the same time.
    collector.check(
      curve.cashGrowth > curve.payoutGrowth,
      `${label} cash cost must grow faster than payout, or levels never get harder.`,
    );
    collector.check(
      curve.payoutGrowth > 1,
      `${label} payout growth must exceed 1, or levels would be worthless.`,
    );

    const first = evaluateMachineLevel(machine, 1);
    collector.check(
      first?.cashCost === 0 && first?.componentCost === 0,
      `${label} level 1 must be free; it is the level a machine holds when unlocked.`,
    );
    collector.check(
      first?.payoutMultiplier === 1,
      `${label} level 1 must be the unmodified base payout.`,
    );

    // Walk a stretch of the curve rather than trusting the algebra.
    let previous = first;

    for (let level = 2; level <= 60; level += 1) {
      const definition = evaluateMachineLevel(machine, level);
      const levelLabel = `${label} level ${level}`;

      collector.check(definition !== null, `${levelLabel} is not representable.`);

      if (definition === null || previous === null) {
        break;
      }

      collector.positive(definition.payoutMultiplier, `${levelLabel} payout multiplier`);
      collector.check(
        definition.payoutMultiplier >= previous.payoutMultiplier,
        `${levelLabel} payout multiplier decreases.`,
      );
      collector.check(
        definition.cashCost >= previous.cashCost,
        `${levelLabel} cash cost decreases.`,
      );
      collector.check(
        (level % curve.componentEveryNLevels === 0) === definition.componentCost > 0,
        `${levelLabel} charges components off the configured interval.`,
      );

      previous = definition;
    }

    for (const nodeId of machine.researchNodeIds) {
      collector.check(
        nodeId in catalog.researchNodes,
        `${label} references unknown research node "${nodeId}".`,
      );
      collector.check(
        catalog.researchNodes[nodeId]?.machineId === machine.id,
        `${label} references research node "${nodeId}" belonging to another machine.`,
      );
    }

    for (const specId of machine.specIds) {
      collector.check(specId in catalog.specs, `${label} references unknown spec "${specId}".`);
      collector.check(
        catalog.specs[specId]?.machineId === machine.id,
        `${label} references spec "${specId}" belonging to another machine.`,
      );
    }
  }

  for (const node of Object.values(catalog.researchNodes)) {
    const label = `Research node "${node.id}"`;
    collector.nonNegativeInteger(node.chipCost, `${label} chip cost`, safeMaximum);

    for (const prerequisite of node.prerequisiteNodeIds) {
      collector.check(
        prerequisite in catalog.researchNodes,
        `${label} requires unknown node "${prerequisite}".`,
      );
    }

    if (node.unlocksSpecId !== undefined) {
      collector.check(
        node.unlocksSpecId in catalog.specs,
        `${label} unlocks unknown spec "${node.unlocksSpecId}".`,
      );
    }
  }

  for (const cycle of detectCycle(
    Object.keys(catalog.researchNodes),
    (id) => catalog.researchNodes[id as keyof typeof catalog.researchNodes]?.prerequisiteNodeIds ?? [],
  )) {
    collector.check(false, `Research prerequisites form a cycle: ${cycle}.`);
  }

  for (const spec of Object.values(catalog.specs)) {
    const label = `Spec "${spec.id}"`;
    collector.positive(spec.payoutMultiplier, `${label} payout multiplier`);
    collector.positive(spec.durationMultiplier, `${label} duration multiplier`);
    collector.check(
      spec.requiredResearchNodeId in catalog.researchNodes,
      `${label} requires unknown research node "${spec.requiredResearchNodeId}".`,
    );

    // The Gambler's draw replaces its flat multiplier rather than stacking on
    // it, so anything but 1 would scale every payout twice.
    collector.check(
      spec.behaviour !== "gambler" || spec.payoutMultiplier === 1,
      `${label} draws its payout per cycle, so its flat multiplier must be 1.`,
    );
  }

  // The Gambler has to sit alongside the other specs rather than above them: a
  // uniform draw over its range averages 2.25x against Endurance's 1.5x.
  collector.check(
    GAMBLER_MINIMUM > 0 && GAMBLER_MAXIMUM > GAMBLER_MINIMUM,
    "The gambler draw needs a positive range.",
  );
  collector.check(
    GAMBLER_EXPONENT >= 1,
    "The gambler exponent must be at least 1, or high rolls become the common case.",
  );
  collector.check(
    GAMBLER_MEAN < 2,
    `The gambler averages ${GAMBLER_MEAN.toFixed(3)}x, which is out of line with the other specs.`,
  );
  collector.positive(GAMBLER_VARIANCE, "Gambler variance");
  collector.check(
    FLYWHEEL_FLOOR > 0 && FLYWHEEL_FLOOR < 1,
    "The flywheel floor must shorten the cycle without stopping it.",
  );
  collector.check(
    FLYWHEEL_SHORTENING_PER_CYCLE > 0 && FLYWHEEL_SHORTENING_PER_CYCLE < 1,
    "The flywheel must shorten each cycle by a fraction of the last.",
  );

  // Reward tables and encounters.
  for (const table of Object.values(catalog.rewardTables)) {
    validateRewardTable(collector, table, safeMaximum);
  }

  for (const encounter of Object.values(catalog.encounters)) {
    validateEncounter(collector, encounter, catalog);
  }

  // Bands must tile the depth axis. A gap would leave a depth with no eligible
  // encounter, and the run would stall with nothing to generate.
  DEPTH_BAND_IDS.forEach((bandId, index) => {
    const band = DEPTH_BANDS[bandId];
    const previous = index === 0 ? null : DEPTH_BANDS[DEPTH_BAND_IDS[index - 1]];
    const isLast = index === DEPTH_BAND_IDS.length - 1;

    collector.check(
      index > 0 || band.minimum === 0,
      "The first depth band must start at depth zero.",
    );
    collector.check(
      previous === null || (previous.maximum !== null && band.minimum === previous.maximum + 1),
      `Depth band "${bandId}" does not start where the previous one ended.`,
    );
    collector.check(
      isLast ? band.maximum === null : band.maximum !== null && band.maximum >= band.minimum,
      `Depth band "${bandId}" has an unusable range; only the deepest band may be open-ended.`,
    );

    const populated = Object.values(catalog.encounters).some((encounter) =>
      encounter.bands.includes(bandId),
    );
    collector.check(
      populated,
      `Depth band "${bandId}" has no encounters, so a run would stall on reaching it.`,
    );
  });

  const firstBandEncounters = Object.values(catalog.encounters).filter((encounter) =>
    encounter.bands.includes(DEPTH_BAND_IDS[0]),
  );
  collector.check(
    firstBandEncounters.length > 0,
    "No encounter is eligible in the first depth band, so a run could never start.",
  );

  // Every run opens on the same ore node. `generateEncounter` makes that
  // guarantee, so what content must promise is that the encounter it pins to is
  // a real ore node the first band contains.
  const opener = catalog.encounters[FIRST_ENCOUNTER_ID];
  collector.check(
    opener !== undefined,
    "The pinned first encounter does not exist in the catalog.",
  );
  collector.check(
    opener?.family === "ore",
    "The first encounter of a run must be an ore node.",
  );
  collector.check(
    opener?.bands.includes(DEPTH_BAND_IDS[0]) ?? false,
    "The first encounter of a run must belong to the first depth band.",
  );

  const grantsRecipePieces = Object.values(catalog.rewardTables).some((table) =>
    table.entries.some((entry) => entry.grants.some((grant) => grant.kind === "recipePiece")),
  );
  const lockedMachines = Object.values(catalog.machines).filter(
    (machine) => !machine.startsUnlocked,
  );
  collector.check(
    lockedMachines.length === 0 || grantsRecipePieces,
    "Locked machines exist but no reward table grants recipe pieces.",
  );

  const reachableRecipeTables = Object.values(catalog.encounters).flatMap((encounter) => [
    ...(encounter.rewardTableId ? [encounter.rewardTableId] : []),
    ...(encounter.choiceOptions ?? []).map((option) => option.rewardTableId),
  ]);
  collector.check(
    lockedMachines.length === 0 ||
      reachableRecipeTables.some((tableId) =>
        catalog.rewardTables[tableId].entries.some((entry) =>
          entry.grants.some((grant) => grant.kind === "recipePiece"),
        ),
      ),
    "No encounter reaches a reward table that grants recipe pieces.",
  );

  const grantsCaches = reachableRecipeTables.some((tableId) =>
    catalog.rewardTables[tableId].entries.some((entry) =>
      entry.grants.some((grant) => grant.kind === "caches"),
    ),
  );
  collector.check(grantsCaches, "No reachable encounter grants a cache, so collections are unreachable.");

  // Gear.
  for (const gear of Object.values(catalog.gear)) {
    const label = `Gear "${gear.id}"`;
    collector.check(gear.levels.length > 0, `${label} has no levels.`);

    gear.levels.forEach((level, index) => {
      const levelLabel = `${label} level ${level.level}`;
      collector.check(
        level.level === index + 1,
        `${levelLabel} is out of order or leaves a gap at index ${index}.`,
      );
      collector.nonNegativeInteger(level.relicCost, `${levelLabel} relic cost`, safeMaximum);
      collector.positive(level.statValue, `${levelLabel} stat value`);
      collector.check(
        level.unlockedTrinketSlots >= 1 &&
          level.unlockedTrinketSlots <= catalog.economy.trinketSlotsPerGear,
        `${levelLabel} unlocks ${level.unlockedTrinketSlots} trinket slots, outside the legal range.`,
      );
      collector.check(
        index === 0 || level.unlockedTrinketSlots >= gear.levels[index - 1].unlockedTrinketSlots,
        `${levelLabel} reduces the unlocked trinket slot count.`,
      );
      collector.check(
        index === 0 || level.statValue > gear.levels[index - 1].statValue,
        `${levelLabel} does not improve on the previous level.`,
      );
    });

    collector.check(
      gear.levels[0]?.relicCost === 0 && gear.levels[0]?.unlockedTrinketSlots === 1,
      `${label} must start at level 1 for free with exactly one trinket slot.`,
    );
    collector.check(
      gear.levels[gear.levels.length - 1]?.unlockedTrinketSlots ===
        catalog.economy.trinketSlotsPerGear,
      `${label} never unlocks its final trinket slot.`,
    );
  }

  // Trinkets.
  for (const trinket of Object.values(catalog.trinkets)) {
    const label = `Trinket "${trinket.id}"`;
    collector.check(
      trinket.targetGearId in catalog.gear,
      `${label} targets unknown gear "${trinket.targetGearId}".`,
    );

    collector.check(
      trinket.baseModifiers.length > 0,
      `${label} has no base modifiers, so every grade would do nothing.`,
    );
    validateGradedEffect(collector, label, trinket.baseModifiers, trinket.describeEffect);
  }

  // Totems.
  for (const totem of Object.values(catalog.totems)) {
    const label = `Totem "${totem.id}"`;

    collector.check(
      totem.baseModifiers.length > 0,
      `${label} has no base modifiers, so every grade would do nothing.`,
    );
    validateGradedEffect(
      collector,
      label,
      totem.baseModifiers,
      totem.describeEffect,
      TOTEM_FORBIDDEN_STATS,
    );
  }

  // A capability is not a stat, so nothing in the modifier pipeline stops two
  // totems granting the same one, which would waste a slot outright.
  const capabilityTotems = Object.values(catalog.totems).filter(
    (totem) => totem.capability !== undefined,
  );

  for (const capability of new Set(capabilityTotems.map((totem) => totem.capability))) {
    const granting = capabilityTotems.filter((totem) => totem.capability === capability);

    collector.check(
      granting.length === 1,
      `Capability "${capability}" is granted by ${granting.length} totems, so one slot would be wasted.`,
    );
  }

  // Two encounters sharing a name is a hard error because the Cartographer's eye
  // names a family: connecting the forecast to the encounter is the only way to
  // tell whether it told the truth.
  const encounterNames = new Map<string, string[]>();

  for (const definition of Object.values(catalog.encounters)) {
    encounterNames.set(definition.displayName, [
      ...(encounterNames.get(definition.displayName) ?? []),
      definition.id,
    ]);
  }

  for (const [displayName, ids] of encounterNames) {
    collector.check(
      ids.length === 1,
      `Encounter name "${displayName}" is shared by ${ids.join(", ")}.`,
    );
  }

  // A run condition and an encounter must not share a name: they appear in the
  // same panel inches apart, so a shared name reads as a relationship that does
  // not exist.
  const encounterNamesInUse = new Set(
    Object.values(catalog.encounters).map((definition) => definition.displayName),
  );

  for (const modifier of Object.values(catalog.expeditionModifiers)) {
    collector.check(
      !encounterNamesInUse.has(modifier.displayName),
      `Run modifier "${modifier.id}" is called "${modifier.displayName}", which is also an ` +
        `encounter. They appear together on the expedition panel.`,
    );
  }

  // Crits have to stay events: at a ceiling of 1 a late loadout makes every
  // strike critical, which is a flat damage multiplier that plays a sound.
  collector.check(
    (catalog.statRules["gear.pickaxeCritChance"]?.maximum ?? 1) < 1,
    "Critical strike chance must be capped below certainty.",
  );

  // Drain reductions compound across grades and stack across sources, so the
  // floor is what stops a loadout buying an expedition that never ends.
  collector.check(
    (catalog.statRules["expedition.oxygenDrainRate"]?.minimum ?? 0) > 0,
    "Oxygen drain must have a positive floor, or a run could last forever.",
  );

  // Run modifiers.
  collector.check(
    catalog.economy.expeditionModifierChance > 0 &&
      catalog.economy.expeditionModifierChance < 1,
    "A run modifier must be occasional: never guaranteed, and never impossible.",
  );

  for (const modifier of Object.values(catalog.expeditionModifiers)) {
    const label = `Run modifier "${modifier.id}"`;

    collector.positive(modifier.weight, `${label} weight`);
    collector.check(
      isDepthBandId(modifier.requiredBand),
      `${label} requires unknown depth band "${modifier.requiredBand}".`,
    );
    // A run that rolled a modifier must be distinguishable from one that did
    // not. Stat modifiers are the usual way but not the only one: a depth-scaled
    // payout and a locked exit cannot be expressed as a `Modifier[]`.
    collector.check(
      modifier.modifiers.length > 0 ||
        (modifier.rewardPerDepth ?? 0) > 0 ||
        (modifier.bankingLockedUntilDepth ?? 0) > 0,
      `${label} has no effect, so a run that rolled it would be indistinguishable.`,
    );
    collector.check(
      (modifier.rewardPerDepth ?? 0) >= 0,
      `${label} has a negative reward-per-depth, which would make going deeper pay less.`,
    );

    if (modifier.bankingLockedUntilDepth !== undefined) {
      const target = modifier.bankingLockedUntilDepth;

      collector.positive(target, `${label} banking lock depth`);

      /*
       * The safety rule for the only kind of modifier that can take a run away.
       * `requiredBand` gates on lifetime deepest depth, which survives a prestige
       * that resets gear to level 1 — measured, a veteran on reset gear fails
       * 85.8% of a ten-depth target against 0% at gear level 3. So a locking
       * modifier also needs a this-cycle gate, comfortably above its own target.
       */
      collector.check(
        (modifier.minimumDepthThisCycle ?? 0) >= target * 2,
        `${label} locks banking until depth ${String(target)} but does not require at least ` +
          `${String(target * 2)} depth reached this cycle. Prestige resets gear while lifetime ` +
          `depth survives, so a lifetime gate alone would impose it on starter gear.`,
      );

      // It takes more than any other modifier, so it has to give something: a
      // pure penalty is a punishment for bad luck at launch.
      collector.check(
        modifier.modifiers.length > 0 || (modifier.rewardPerDepth ?? 0) > 0,
        `${label} holds the exit shut without paying for it.`,
      );
    }
    collector.check(
      modifier.description.length > 0,
      `${label} has no description, and the player has no other way to learn what it does.`,
    );

    // A zero multiplier is legitimate here, since it is how a modifier removes a
    // reward, so only the additive checks apply.
    for (const entry of modifier.modifiers) {
      collector.check(
        STAT_ID_SET.has(entry.targetStat),
        `${label} targets unknown stat "${entry.targetStat}".`,
      );
      collector.finite(entry.value, `${label} value for ${entry.targetStat}`);
      collector.check(
        entry.operation !== "multiply" || entry.value >= 0,
        `${label} scales ${entry.targetStat} by a negative multiplier.`,
      );
    }
  }

  // At least one modifier must be available on a first run, or the feature is
  // invisible until the player has already been deep.
  collector.check(
    Object.values(catalog.expeditionModifiers).some(
      (modifier) => modifier.requiredBand === DEPTH_BAND_IDS[0],
    ),
    "No run modifier is available in the first depth band, so a new player would never see one.",
  );

  // Prestige perks.
  for (const perk of Object.values(catalog.prestigePerks)) {
    const perkLabel = `Prestige perk "${perk.id}"`;

    collector.positive(perk.maximumRank, `${perkLabel} maximum rank`);
    // A repeatable perk is bought forever, so a growing price becomes a wall a
    // few dozen ranks along.
    collector.check(
      perk.repeatable !== true || perk.costGrowth === 1,
      `${perkLabel} is repeatable, so its cost growth must be 1 (found ${String(perk.costGrowth)}).`,
    );
    collector.check(
      perk.requiresMaxedPrerequisites !== true || perk.prerequisitePerkIds.length > 0,
      `${perkLabel} requires maxed prerequisites but names none.`,
    );
    collector.positive(perk.costGrowth, `${perkLabel} cost growth`);
    collector.positive(perk.seleniteCost, `${perkLabel} selenite cost`);
    collector.check(
      perk.branch in catalog.perkBranches,
      `${perkLabel} belongs to unknown branch "${perk.branch}".`,
    );

    // A perk with neither a modifier nor a capability does nothing at all.
    collector.check(
      perk.modifiers.length > 0 || perk.capability !== undefined,
      `${perkLabel} has no effect and no capability, so a rank would buy nothing.`,
    );

    for (const prerequisite of perk.prerequisitePerkIds) {
      collector.check(
        prerequisite in catalog.prestigePerks,
        `${perkLabel} requires unknown perk "${prerequisite}".`,
      );
    }
  }

  // Exactly one root, or a branch could be unreachable.
  collector.check(
    Object.values(catalog.prestigePerks).filter(
      (perk) => perk.prerequisitePerkIds.length === 0,
    ).length === 1,
    "The perk tree must have exactly one root.",
  );
  for (const perk of Object.values(catalog.prestigePerks)) {
    const label = `Prestige perk "${perk.id}"`;
    collector.positive(perk.seleniteCost, `${label} selenite cost`);
    collector.nonNegativeInteger(perk.seleniteCost, `${label} selenite cost`, safeMaximum);
    validateModifiers(collector, perk.modifiers, label);

    for (const prerequisite of perk.prerequisitePerkIds) {
      collector.check(
        prerequisite in catalog.prestigePerks,
        `${label} requires unknown perk "${prerequisite}".`,
      );
    }
  }

  collector.check(
    Object.keys(catalog.prestigePerks).length >= 5,
    "At least five prestige perks are required.",
  );
  collector.check(
    Object.values(catalog.prestigePerks).some((perk) => perk.prerequisitePerkIds.length > 0),
    "The prestige tree contains no prerequisite branch.",
  );

  for (const cycle of detectCycle(
    Object.keys(catalog.prestigePerks),
    (id) =>
      catalog.prestigePerks[id as keyof typeof catalog.prestigePerks]?.prerequisitePerkIds ?? [],
  )) {
    collector.check(false, `Prestige perk prerequisites form a cycle: ${cycle}.`);
  }

  // Contracts. A contract pays from an ordinary reward table, and that table
  // must not pay out another contract, or one would chain into the next and
  // defeat the one-at-a-time rule the state machine relies on.
  for (const contract of Object.values(catalog.contracts)) {
    const label = `Contract "${contract.id}"`;

    collector.positive(contract.span, `${label} span`);
    collector.check(
      contract.description.length > 0,
      `${label} has no description, and a goal the player cannot read is not a goal.`,
    );
    collector.check(
      contract.rewardTableId in catalog.rewardTables,
      `${label} pays from unknown table "${contract.rewardTableId}".`,
    );

    const payout = catalog.rewardTables[contract.rewardTableId];

    collector.check(
      payout === undefined ||
        payout.entries.every((entry) => entry.grants.every((grant) => grant.kind !== "contract")),
      `${label} can pay out another contract, which would chain.`,
    );
  }

  // Every machine needs a payout cue, and the cues must descend as the ladder
  // climbs: the floor tells you how much just paid without looking, which only
  // works while pitch is ordered.
  for (let index = 0; index < catalog.machineIds.length; index += 1) {
    const machineId = catalog.machineIds[index];
    const cue = catalog.machines[machineId].payoutCue;
    const label = `Machine "${machineId}" payout cue`;

    collector.positive(cue.frequency, `${label} frequency`);
    collector.positive(cue.endFrequency, `${label} end frequency`);
    collector.positive(cue.durationMs, `${label} duration`);
    collector.check(
      cue.gain > 0 && cue.gain <= 1,
      `${label} gain must be above zero and no louder than one.`,
    );

    if (index === 0) {
      continue;
    }

    const previous = catalog.machines[catalog.machineIds[index - 1]].payoutCue;

    collector.check(
      cue.frequency < previous.frequency,
      `${label} is not lower than the machine before it; the ladder's cues must ` +
        `descend so the floor says how much just paid.`,
    );
    collector.check(
      cue.durationMs > previous.durationMs,
      `${label} is not longer than the machine before it.`,
    );
  }

  /*
   * Every rung of the machine ladder must be a real upgrade on the one below it,
   * which no single machine's numbers reveal: position is `basePayout /
   * cycleSeconds` divided by Overclock cost raised to
   * log(payoutPerRank)/log(chipGrowth), so two very different machines can be
   * worth the same per chip and rank rounding then favours the cheaper one.
   */
  for (let index = 1; index < catalog.machineIds.length; index += 1) {
    const previous = catalog.machineIds[index - 1];
    const current = catalog.machineIds[index];
    const gain = safeMeritGain(machineMerit(previous), machineMerit(current));

    collector.check(
      gain >= MINIMUM_LADDER_GAIN,
      `Machine "${current}" is only ${gain.toFixed(2)}x better per chip than "${previous}"; ` +
        `a rung must be worth at least ${String(MINIMUM_LADDER_GAIN)}x the one below it.`,
    );
  }

  collector.positive(catalog.economy.prestigeThresholdCash, "Prestige threshold");
  collector.positive(catalog.economy.prestigeSeleniteDivisor, "Prestige selenite divisor");
  collector.check(
    catalog.economy.prestigeThresholdGrowth >= 1,
    "The prestige threshold must not shrink with each prestige.",
  );
  // The most consequential relationship in the prestige economy: with these
  // equal, the award stays at one selenite while the wall grows
  // twelve-thousandfold, and the perk tree stops advancing.
  collector.check(
    catalog.economy.prestigeSeleniteDivisorGrowth < catalog.economy.prestigeThresholdGrowth,
    "The selenite divisor must grow more slowly than the prestige threshold, or reaching a higher wall pays no more than reaching a lower one.",
  );
  collector.check(
    catalog.economy.prestigeSeleniteDivisorGrowth >= 1,
    "The selenite divisor must not shrink with each prestige.",
  );
  collector.check(
    catalog.economy.prestigeSeleniteExponent > 0 && catalog.economy.prestigeSeleniteExponent < 1,
    "The prestige exponent must produce monotonic growth with diminishing returns.",
  );

  // Slot game.
  const symbols = Object.values(catalog.slotSymbols);
  collector.check(symbols.length >= 3, "The slot game needs at least three symbols.");

  for (const symbol of symbols) {
    const label = `Slot symbol "${symbol.id}"`;
    collector.positive(symbol.baseWeight, `${label} base weight`);
    collector.finite(symbol.luckWeightBias, `${label} luck weight bias`);
    collector.check(
      symbol.luckWeightBias > -1,
      `${label} luck bias would drive its weight to zero or below.`,
    );
    collector.check(
      isFiniteNumber(symbol.tripleMultiplier) && symbol.tripleMultiplier >= 0,
      `${label} triple multiplier must be a finite non-negative number.`,
    );
    collector.check(
      isFiniteNumber(symbol.pairMultiplier) && symbol.pairMultiplier >= 0,
      `${label} pair multiplier must be a finite non-negative number.`,
    );
    collector.check(
      symbol.tripleMultiplier >= symbol.pairMultiplier,
      `${label} pays more for a pair than for a triple.`,
    );
  }

  collector.check(catalog.slotWagers.length > 0, "The slot game defines no wagers.");

  for (const wager of catalog.slotWagers) {
    collector.nonNegativeInteger(wager, `Slot wager ${wager}`, safeMaximum);
    collector.positive(wager, `Slot wager ${wager}`);
  }

  collector.check(
    [...catalog.slotWagers].every((wager, index, all) => index === 0 || wager > all[index - 1]),
    "Slot wagers must be listed in ascending order.",
  );

  // Cache rewards.
  collector.check(catalog.cacheRewards.length > 0, "The cache reward table is empty.");
  collector.check(
    catalog.cacheRewards.some((entry) => entry.weight > 0),
    "The cache reward table has no entry with a positive weight.",
  );

  const cacheEntryIds = new Set<string>();

  for (const entry of catalog.cacheRewards) {
    const label = `Cache reward "${entry.id}"`;
    collector.check(!cacheEntryIds.has(entry.id), `${label} id is repeated.`);
    cacheEntryIds.add(entry.id);
    collector.positive(entry.weight, `${label} weight`);

    if (entry.reward.kind === "trinket") {
      collector.check(
        entry.reward.trinketId in catalog.trinkets,
        `${label} grants unknown trinket "${entry.reward.trinketId}".`,
      );
    } else {
      collector.check(
        entry.reward.totemId in catalog.totems,
        `${label} grants unknown totem "${entry.reward.totemId}".`,
      );
    }
  }

  collector.check(
    catalog.cacheRewards.some((entry) => entry.reward.kind === "trinket"),
    "Caches can never produce a trinket.",
  );
  collector.check(
    catalog.cacheRewards.some((entry) => entry.reward.kind === "totem"),
    "Caches can never produce a totem.",
  );

  // Consumables. Each is a bag of modifiers folded into the run snapshot at
  // launch, so the loadout's rules apply: an unknown stat or zero multiplier
  // makes a silently inert item rather than a crash.
  for (const consumableId of CONSUMABLE_IDS) {
    const consumable = CONSUMABLES[consumableId];
    const label = `Consumable "${consumableId}"`;

    collector.check(consumable.id === consumableId, `${label} disagrees with its key.`);
    collector.check(consumable.displayName.length > 0, `${label} has no name.`);
    collector.check(consumable.effectSummary.length > 0, `${label} has no effect summary.`);
    collector.check(consumable.spriteId.length > 0, `${label} has no sprite id.`);
    collector.positive(consumable.chipCost, `${label} chip cost`);
    collector.check(consumable.modifiers.length > 0, `${label} does nothing.`);
    validateModifiers(collector, consumable.modifiers, label);
  }

  // One per lever: two consumables on the same stat would make the choice
  // between them a comparison rather than a decision.
  const consumableStats = CONSUMABLE_IDS.flatMap((id) =>
    CONSUMABLES[id].modifiers.map((modifier) => modifier.targetStat),
  );

  collector.check(
    new Set(consumableStats).size === consumableStats.length,
    "Two consumables target the same stat; there should be one per lever.",
  );

  // The help reference. The window must never scroll, so an overlong topic is a
  // bug — caught here, where the author finds out, rather than by an end-to-end
  // overflow test on whichever topic somebody happened to click.
  const helpTopicIds = new Set<string>();

  for (const topicId of catalog.helpTopicIds) {
    const topic = catalog.helpTopics[topicId];
    const label = `Help topic ${topicId}`;

    collector.check(!helpTopicIds.has(topicId), `${label} is declared twice.`);
    helpTopicIds.add(topicId);

    collector.check(topic.id === topicId, `${label} is keyed by a different id than it carries.`);
    collector.check(topic.title.length > 0, `${label} has no title.`);
    collector.check(topic.summary.length > 0, `${label} has no summary.`);
    collector.check(topic.entries.length > 0, `${label} has no entries.`);
    collector.check(
      SPRITES[topic.spriteId] !== undefined,
      `${label} names a sprite that does not exist: ${topic.spriteId}.`,
    );

    const terms = new Set<string>();

    for (const entry of topic.entries) {
      collector.check(entry.term.length > 0, `${label} has an entry with no term.`);
      collector.check(
        !terms.has(entry.term),
        `${label} uses the term "${entry.term}" twice.`,
      );
      terms.add(entry.term);

      collector.check(
        entry.body.length > 0,
        `${label}, "${entry.term}": the body is empty.`,
      );
      collector.check(
        entry.body.length <= MAXIMUM_ENTRY_BODY,
        `${label}, "${entry.term}": ${String(entry.body.length)} characters, over the ${String(MAXIMUM_ENTRY_BODY)} an entry may be.`,
      );
    }

    const total = topicBodyLength(topic);

    collector.check(
      total <= MAXIMUM_TOPIC_BODY,
      `${label} is ${String(total)} characters, over the ${String(MAXIMUM_TOPIC_BODY)} a topic may be. Split it rather than letting the window scroll.`,
    );
  }

  // The tutorial script. Two of these are product rulings rather than hygiene,
  // and both are easy to reverse by accident: exactly one act may open on a
  // fresh save, and only the descent may present during a run.
  const actIds = new Set<string>();
  const stepIds = new Set<string>();
  let startActs = 0;

  TUTORIAL_ACTS.forEach((act, index) => {
    const label = `Tutorial act ${act.id}`;

    collector.check(!actIds.has(act.id), `${label} is declared twice.`);
    actIds.add(act.id);

    collector.check(act.title.length > 0, `${label} has no title.`);
    collector.check(act.steps.length > 0, `${label} has no steps.`);
    collector.check(
      act.steps.length <= MAXIMUM_ACT_STEPS,
      `${label} has ${String(act.steps.length)} steps; an act is at most ${String(MAXIMUM_ACT_STEPS)}.`,
    );

    if (act.trigger === "start") {
      startActs += 1;
      collector.check(index === 0, `${label} opens on a fresh save but is not declared first.`);
    } else {
      collector.check(
        isTutorialGateId(act.trigger),
        `${label} is triggered by an unknown gate: ${act.trigger}.`,
      );
    }

    // Enforced rather than remembered: a flag this easy to copy onto a new act
    // is how the ruling gets quietly reversed.
    collector.check(
      !act.presentsDuringRun || act.id === DESCENT_ACT_ID,
      `${label} presents during a run, which only ${DESCENT_ACT_ID} may do.`,
    );

    for (const step of act.steps) {
      const stepLabel = `${label}, step ${step.id}`;

      collector.check(!stepIds.has(step.id), `${stepLabel} is declared twice.`);
      stepIds.add(step.id);

      collector.check(step.title.length > 0, `${stepLabel} has no title.`);
      collector.check(
        stepWordCount(step) > 0 && stepWordCount(step) <= MAXIMUM_STEP_WORDS,
        `${stepLabel} is ${String(stepWordCount(step))} words; a card is at most ${String(MAXIMUM_STEP_WORDS)}.`,
      );
      collector.check(
        step.anchor === null || (TUTORIAL_ANCHORS as readonly string[]).includes(step.anchor),
        `${stepLabel} points at an unknown anchor: ${String(step.anchor)}.`,
      );

      // A card may point at the help topic it is the short version of, and a
      // renamed topic would leave a "Read more" button that opens nothing.
      collector.check(
        step.helpTopicId === undefined || catalog.helpTopics[step.helpTopicId] !== undefined,
        `${stepLabel} points at an unknown help topic: ${String(step.helpTopicId)}.`,
      );

      if (step.advance !== "next") {
        collector.check(
          isTutorialGateId(step.advance),
          `${stepLabel} waits on an unknown gate: ${step.advance}.`,
        );
        collector.check(
          step.hint !== undefined && step.hint.length > 0,
          `${stepLabel} waits on the player but gives no hint saying what to do.`,
        );
      }
    }
  });

  // A script with no opening act can never begin, and fails with no symptom:
  // the game simply never mentions the tutorial again.
  collector.check(
    startActs === 1,
    `Exactly one tutorial act must open on a fresh save; found ${String(startActs)}.`,
  );

  return { valid: collector.issues.length === 0, issues: collector.issues };
}

export function assertValidContent(catalog: ContentCatalog = CATALOG): void {
  const result = validateContent(catalog);

  if (!result.valid) {
    throw new ContentValidationError(result.issues);
  }
}
