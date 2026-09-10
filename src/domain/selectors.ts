/**
 * Pure derived views for the UI.
 *
 * The interface never reproduces a formula: every number, cost, gate, and
 * disabled reason shown on screen comes from here.
 */

import {
  CACHE_TYPES,
  CACHE_TYPE_IDS,
  CAT_ENCOUNTER_ID,
  ECONOMY,
  ENCOUNTERS,
  ENCOUNTER_FAMILY_LABELS,
  GEAR,
  MACHINES,
  ORE_GRADES,
  ORE_GRADE_IDS,
  PRESTIGE_PERKS,
  PRESTIGE_PERK_IDS,
  RESEARCH_NODES,
  RESOURCE_IDS,
  RESOURCE_METADATA,
  SLOT_SYMBOLS,
  SLOT_SYMBOL_IDS,
  EXPEDITION_MODIFIERS,
  SPECS,
  STARTER_MACHINE_ID,
  TOTEMS,
  TOTEM_IDS,
  TRINKETS,
  TRINKET_IDS,
} from "../content/catalog";
import { CHIP_WAGERS, STAKE_EVERYTHING, type ChipStake } from "../content/chipGames";
import {
  ROULETTE_BETS,
  ROULETTE_BET_IDS,
  ROULETTE_POCKET_COUNT,
  betColour,
  pocketColour,
  type RouletteBetId,
  type RouletteColour,
} from "../content/roulette";
import {
  BLACKJACK_BASE_RETURN,
  BLACKJACK_RANK_NAMES,
  cardValue,
} from "../content/blackjack";
import {
  handTotal,
  selectBlackjackExpectedReturn,
} from "./blackjack";
import { selectRouletteExpectedReturn } from "./roulette";
import {
  baseWagerMultiplier,
  maximumWagerTarget,
  minimumWagerTarget,
  offeredWagerMultiplier,
  wagerReferenceDepth,
  wagerSuccessProbability,
} from "./depthWager";
import type {
  CacheTypeId,
  EncounterChoiceDefinition,
  GearId,
  MachineId,
  OreGradeId,
  PrestigePerkId,
  ResearchNodeId,
  ResourceId,
  SlotSymbolId,
  SpecId,
  GradeId,
  TotemId,
  TrinketId,
} from "../content/catalog";
import {
  baseCyclePayout,
  isSpecAvailable,
  activeSpec,
  flywheelDurationMultiplier,
  machineLevelDefinition,
  researchChipCost,
  researchPayoutMultiplier,
  researchRank,
  planMachineLevelPurchase,
  planMachineUnlock,
  planResearch,
  selectCashPerSecond,
  selectCycleMs,
  selectCyclePayout,
  selectExpectedCyclePayout,
} from "./casino";
import { DEPTH_BANDS, bandForDepth } from "../content/depthBands";
import {
  CAT_SKINS,
  CAT_SKIN_IDS,
  DEFAULT_CAT_SKIN_IDS,
  type CatSkinId,
} from "../content/catSkins";
import { MINER_SKINS, MINER_SKIN_IDS, type MinerSkinId } from "../content/minerSkins";
import { planCatSkinPurchase } from "./cats";
import { planMinerSkinChange, planMinerSkinPurchase } from "./miner";
import { CONSUMABLES, CONSUMABLE_IDS, type ConsumableId } from "../content/consumables";
import { planConsumablePurchase } from "./consumables";
import type { HelpTopicId } from "../content/help";
import type { MusicTrackId } from "../content/music";
import {
  PERK_BRANCHES,
  expeditionSpeedForRank,
  expeditionSpeeds,
  type PrestigePerkDefinition,
} from "../content/prestigePerks";
import type { PerkBranchId, StatId } from "../content/catalog";
import { expectedSpecPayoutMultiplier } from "../content/machines";
import {
  HIGHEST_GRADE,
  nextGrade,
  scaleModifierBy,
  scaleModifiers,
  trimNumber,
} from "../content/grades";
import {
  affordableQuantity,
  cacheChipPrice,
  openableCacheCount,
  describeCachePurchase,
  keyCost,
  planCacheChipPurchase,
  planCachePurchase,
  planKeyPurchase,
  planTotemUpgrade,
  totemUpgradeCost,
} from "./collections";
import {
  bankingLockedUntil,
  oxygenRatio,
  selectFailureLossChance,
  selectOreChipValues,
} from "./expedition";
import {
  baseMaxOxygen,
  basePickaxeDamage,
  equippedSlotOf,
  gearLevel,
  gearLevelDefinition,
  maximumGearLevel,
  planGearUpgrade,
  planUpgradeTrinket,
  selectMaxOxygen,
  selectPickaxeDamage,
  slotUnlockLevel,
  trinketSlots,
  trinketUpgradeCost,
  unlockedTrinketSlots,
} from "./gear";
import { selectExpectedReturn } from "./gambling";
import {
  collectActiveModifiers,
  explainStat,
  luckFactor,
  roundStat,
  selectLuckPoints,
  type Modifier,
  type ModifierContribution,
  type ModifierQuery,
} from "./modifiers";
import {
  clamp,
  formatCompact,
  formatDuration,
  formatExact,
  formatPercent,
  INFINITE,
  formatQuantity,
  formatRankNumeral,
  safeDivide,
} from "./numbers";
import {
  perkBlock,
  perkNextRankCost,
  perkRank,
  prestigeBlock,
  prestigeMetric,
  prestigeProgressRatio,
  prestigeThreshold,
  projectedSelenite,
  selectExpeditionSpeed,
  unlockedExpeditionSpeed,
} from "./prestige";
import { describeBlock } from "./reducer";
import { CONTRACTS } from "../content/contracts";
import type { CacheOpenBatch } from "./collections";
import type { GameState, ResolvedGrant, RunInventory } from "./state";
import type { RunSummary } from "./commands";

export interface StatSourceView {
  label: string;
  /** The amount this source actually added, after its operation. */
  amount: number;
}

export interface StatBreakdownView {
  base: number;
  /** Total added by modifiers, so `base + bonus === final` however it was applied. */
  bonus: number;
  final: number;
  sources: StatSourceView[];
}

/**
 * A modifier's source id, split into the thing and how far up it is.
 * `scaleModifierBy` appends `:<suffix>` to every scaled modifier, so a grade E
 * spare bladder arrives as `trinket.bladder:E`. Ids contain dots but never
 * colons, so the last colon is an unambiguous split.
 */
export function splitModifierSource(sourceId: string): {
  label: string;
  qualifier: string | null;
} {
  const split = sourceId.lastIndexOf(":");
  const id = split === -1 ? sourceId : sourceId.slice(0, split);
  const qualifier = split === -1 ? null : sourceId.slice(split + 1);

  const named =
    TRINKETS[id as TrinketId]?.displayName ??
    TOTEMS[id as TotemId]?.displayName ??
    PRESTIGE_PERKS[id as PrestigePerkId]?.displayName ??
    SPECS[id as SpecId]?.displayName ??
    // Cats are the one modifier source that is not a piece of content.
    (id === "cats" ? "Cats met" : id);

  return { label: named, qualifier: qualifier === null || qualifier === "" ? null : qualifier };
}

/** Turns a modifier source id into the name the player already knows it by. */
function describeModifierSource(sourceId: string): string {
  const { label, qualifier } = splitModifierSource(sourceId);

  return qualifier === null ? label : `${label} (Grade ${qualifier})`;
}

/**
 * Splits a stat into its base and what modifiers added. Multiplicative sources
 * report the amount they actually contributed, so a x1.08 regulator on a 60s
 * tank reads as "+5": every source stays comparable and `base + bonus` is the
 * displayed total.
 */
export function describeStat(
  baseValue: number,
  modifiers: readonly Modifier[],
  query: ModifierQuery,
): StatBreakdownView {
  const breakdown = explainStat(baseValue, modifiers, query);
  const sources: StatSourceView[] = [];
  let previous = breakdown.baseValue;

  // The final value is rounded by the stat's own rule and the base is not, so
  // the base is rounded here too; otherwise the rounding reads as a bonus.
  const roundedBase = roundStat(breakdown.baseValue, query.targetStat);

  for (const contribution of breakdown.contributions) {
    sources.push({
      label: describeModifierSource(contribution.sourceId),
      amount: contribution.runningValue - previous,
    });
    previous = contribution.runningValue;
  }

  return {
    base: roundedBase,
    bonus: breakdown.finalValue - roundedBase,
    final: breakdown.finalValue,
    sources: sources.filter((source) => source.amount !== 0),
  };
}

export interface DerivedContext {
  state: GameState;
  modifiers: Modifier[];
  luckPoints: number;
}

export function deriveContext(state: GameState): DerivedContext {
  const modifiers = collectActiveModifiers(state);

  return { state, modifiers, luckPoints: selectLuckPoints(modifiers) };
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface ResourceView {
  id: ResourceId;
  displayName: string;
  glyph: string;
  spriteId: string;
  description: string;
  value: number;
  /**
   * The value in the notation the player chose; `exactText` always carries the
   * full number, and is what the tooltip and the screen-reader line use.
   */
  displayText: string;
  exactText: string;
}

/**
 * Every resource honours the number-format setting, with no per-resource
 * override: `formatCompact` already returns a plain integer below a thousand, so
 * applying the setting everywhere cannot make a small number worse.
 */
export function selectResourceViews(state: GameState): ResourceView[] {
  return RESOURCE_IDS.map((id) => {
    const metadata = RESOURCE_METADATA[id];
    const value = state.resources[id];

    return {
      id,
      displayName: metadata.displayName,
      glyph: metadata.glyph,
      spriteId: metadata.spriteId,
      description: metadata.description,
      value,
      displayText: formatQuantity(value, state.settings.numberFormat),
      exactText: formatExact(value),
    };
  });
}

// ---------------------------------------------------------------------------
// Casino
// ---------------------------------------------------------------------------

export interface ActionAvailability {
  available: boolean;
  /** Present whenever `available` is false. */
  reason: string | null;
}

export interface ResearchNodeView {
  id: ResearchNodeId;
  displayName: string;
  description: string;
  /** Chips for the next rank, or null when there is no next rank. */
  chipCost: number | null;
  rank: number;
  /** null when the node can be bought forever. */
  maximumRank: number | null;
  repeatable: boolean;
  /** True once at least one rank is held, which is what a spec unlock needs. */
  researched: boolean;
  purchase: ActionAvailability;
  unlocksSpecId: SpecId | null;
}

export interface SpecView {
  id: SpecId;
  displayName: string;
  description: string;
  payoutMultiplier: number;
  durationMultiplier: number;
  researched: boolean;
  active: boolean;
}

export interface MachineView {
  id: MachineId;
  displayName: string;
  description: string;
  spriteId: string;
  unlocked: boolean;
  selected: boolean;
  level: number;
  /** Total payout multiplier from researched ranks, so the panel can show it. */
  researchMultiplier: number;
  cyclePayout: number;
  /** The same payout split into its base and what modifiers added. */
  payoutBreakdown: StatBreakdownView;
  /**
   * True when the active spec redraws its payout each cycle, so every number on
   * this view is a long-run average rather than what the next cycle will pay.
   */
  payoutIsAverage: boolean;
  /** Present while a flywheel is ramping, as a fraction of the base cycle. */
  flywheelRatio: number | null;
  cycleMs: number;
  cashPerSecond: number;
  cycleProgressRatio: number;
  recipePieces: number;
  recipePiecesRequired: number;
  /** Where this machine's recipe pieces drop, so a locked tile can say so. */
  recipeBandName: string;
  unlockAction: ActionAvailability;
  nextLevel: {
    level: number;
    cyclePayout: number;
    /** Read the same way as the current payout, so the arrow compares like with like. */
    payoutBreakdown: StatBreakdownView;
    cashCost: number;
    componentCost: number;
  } | null;
  purchase: ActionAvailability;
  /**
   * The batch sizes the panel offers, priced and checked here rather than in the
   * component, so the button, its tooltip and the charge all come from one walk
   * of the ladder.
   */
  bulkLevels: MachineBulkView[];
  research: ResearchNodeView[];
  specs: SpecView[];
}

export interface MachineBulkView {
  quantity: number;
  /** The level the machine reaches if this batch is bought. */
  targetLevel: number;
  cashCost: number;
  componentCost: number;
  purchase: ActionAvailability;
}

function availability(
  plan: { ok: true } | { ok: false; block: { kind: string } & Record<string, unknown> },
): ActionAvailability {
  return plan.ok ? { available: true, reason: null } : { available: false, reason: describeBlock(plan.block) };
}

/**
 * The batch sizes the machine panel offers. The single purchase stays in the
 * list rather than being special-cased, so all three buttons are built and
 * priced the same way.
 */
const MACHINE_BULK_QUANTITIES = [1, 10, 100];

/** Prices one batch and reports whether it can be bought. */
function describeMachineBulk(
  state: GameState,
  machineId: MachineId,
  quantity: number,
): MachineBulkView {
  const progress = state.casino.machines[machineId];

  let cashCost = 0;
  let componentCost = 0;

  for (let step = 1; step <= quantity; step += 1) {
    const level = machineLevelDefinition(machineId, progress.level + step);

    if (level === null) {
      break;
    }

    cashCost += level.cashCost;
    componentCost += level.componentCost;
  }

  return {
    quantity,
    targetLevel: progress.level + quantity,
    cashCost,
    componentCost,
    purchase: availability(planMachineLevelPurchase(state, machineId, quantity)),
  };
}

export function selectMachineView(context: DerivedContext, machineId: MachineId): MachineView {
  const { state, modifiers } = context;
  const definition = MACHINES[machineId];
  const progress = state.casino.machines[machineId];
  const cycleMs = selectCycleMs(state, machineId, modifiers);
  const nextLevelDefinition = machineLevelDefinition(machineId, progress.level + 1);
  const spec = activeSpec(progress);
  // The Gambler's flat multiplier is 1 because the draw replaces it, so the
  // display folds the average back in.
  const expectedSpecRatio =
    spec === null ? 1 : expectedSpecPayoutMultiplier(spec) / spec.payoutMultiplier;

  return {
    id: machineId,
    displayName: definition.displayName,
    description: definition.description,
    spriteId: definition.spriteId,
    unlocked: progress.unlocked,
    selected: state.casino.selectedMachineId === machineId,
    level: progress.level,
    researchMultiplier: researchPayoutMultiplier(progress),
    cyclePayout: selectExpectedCyclePayout(state, machineId, modifiers),
    payoutBreakdown: describeStat(
      baseCyclePayout(state, machineId) * expectedSpecRatio,
      modifiers,
      { targetStat: "machine.payout" },
    ),
    payoutIsAverage: spec?.behaviour === "gambler",
    flywheelRatio:
      spec?.behaviour === "flywheel"
        ? flywheelDurationMultiplier(progress.flywheelCycles)
        : null,
    cycleMs,
    cashPerSecond: selectCashPerSecond(state, machineId, modifiers),
    cycleProgressRatio: cycleMs > 0 ? safeDivide(progress.cycleProgressMs, cycleMs) : 0,
    recipePieces: progress.recipePieces,
    recipePiecesRequired: definition.recipePiecesRequired,
    recipeBandName: DEPTH_BANDS[definition.recipeBand].displayName,
    unlockAction: availability(planMachineUnlock(state, machineId)),
    nextLevel:
      nextLevelDefinition === null
        ? null
        : {
            level: nextLevelDefinition.level,
            cyclePayout: selectExpectedCyclePayout(
              state,
              machineId,
              modifiers,
              nextLevelDefinition.level,
            ),
            payoutBreakdown: describeStat(
              baseCyclePayout(state, machineId, nextLevelDefinition.level) * expectedSpecRatio,
              modifiers,
              { targetStat: "machine.payout" },
            ),
            cashCost: nextLevelDefinition.cashCost,
            componentCost: nextLevelDefinition.componentCost,
          },
    purchase: availability(planMachineLevelPurchase(state, machineId)),
    bulkLevels: MACHINE_BULK_QUANTITIES.map((quantity) =>
      describeMachineBulk(state, machineId, quantity),
    ),
    research: definition.researchNodeIds.map((nodeId) => {
      const node = RESEARCH_NODES[nodeId];

      const rank = researchRank(progress, nodeId);
      const repeatable = node.maximumRank === null || node.maximumRank > 1;
      // A repeatable node is named for the rank it offers rather than the one
      // held: the row is a purchase. The payout stat reports what is held.
      const offeredRank =
        node.maximumRank === null ? rank + 1 : Math.min(node.maximumRank, rank + 1);

      return {
        id: nodeId,
        displayName: repeatable
          ? `${node.displayName} ${formatRankNumeral(offeredRank)}`
          : node.displayName,
        description: node.description,
        chipCost: researchChipCost(progress, nodeId),
        rank,
        maximumRank: node.maximumRank,
        repeatable,
        researched: rank >= 1,
        purchase: availability(planResearch(state, nodeId)),
        unlocksSpecId: node.unlocksSpecId ?? null,
      };
    }),
    specs: definition.specIds.map((specId) => {
      const spec = SPECS[specId];

      return {
        id: specId,
        displayName: spec.displayName,
        description: spec.description,
        payoutMultiplier: spec.payoutMultiplier,
        durationMultiplier: spec.durationMultiplier,
        researched: isSpecAvailable(state, specId),
        active: progress.activeSpecId === specId,
      };
    }),
  };
}

export function selectMachineViews(context: DerivedContext): MachineView[] {
  return (Object.keys(MACHINES) as MachineId[]).map((machineId) =>
    selectMachineView(context, machineId),
  );
}

export function selectTotalCashPerSecond(context: DerivedContext): number {
  return (Object.keys(MACHINES) as MachineId[])
    .filter((machineId) => context.state.casino.machines[machineId].unlocked)
    .reduce(
      (total, machineId) => total + selectCashPerSecond(context.state, machineId, context.modifiers),
      0,
    );
}

// ---------------------------------------------------------------------------
// Gear, trinkets, totems
// ---------------------------------------------------------------------------

export interface TrinketSlotView {
  index: number;
  unlocked: boolean;
  requiredGearLevel: number | null;
  trinketId: TrinketId | null;
  spriteId: string | null;
  displayName: string | null;
  grade: GradeId | null;
  effectSummary: string | null;
}

export interface GearView {
  id: GearId;
  displayName: string;
  description: string;
  statLabel: string;
  statUnit: string;
  level: number;
  maximumLevel: number;
  currentStat: number;
  statBreakdown: StatBreakdownView;
  /**
   * The next level's stat with the current loadout applied, so both sides of the
   * arrow read the same way. The raw level-table number is not what the player
   * would actually get.
   */
  nextStatBreakdown: StatBreakdownView | null;
  relicCost: number | null;
  upgrade: ActionAvailability;
  slots: TrinketSlotView[];
  nextSlotUnlockLevel: number | null;
}

export function selectGearView(context: DerivedContext, gearId: GearId): GearView {
  const { state, modifiers } = context;
  const definition = GEAR[gearId];
  const level = gearLevel(state, gearId);
  const next = gearLevelDefinition(gearId, level + 1);
  const unlocked = unlockedTrinketSlots(state, gearId);
  const slots = trinketSlots(state, gearId);

  const currentStat =
    gearId === "tank" ? selectMaxOxygen(state, modifiers) : selectPickaxeDamage(state, modifiers);

  const targetStat = gearId === "tank" ? "gear.tankOxygen" : "gear.pickaxeDamage";

  const statBreakdown =
    gearId === "tank"
      ? describeStat(baseMaxOxygen(state), modifiers, { targetStat })
      : describeStat(basePickaxeDamage(state), modifiers, { targetStat });

  return {
    id: gearId,
    displayName: definition.displayName,
    description: definition.description,
    statLabel: definition.statLabel,
    statUnit: definition.statUnit,
    level,
    maximumLevel: maximumGearLevel(gearId),
    currentStat,
    statBreakdown,
    nextStatBreakdown:
      next === null ? null : describeStat(next.statValue, modifiers, { targetStat }),
    relicCost: next === null ? null : next.relicCost,
    upgrade: availability(planGearUpgrade(state, gearId)),
    slots: slots.map((trinketId, index) => {
      const progress = trinketId === null ? null : state.collection.trinkets[trinketId];
      const definition = trinketId === null ? null : TRINKETS[trinketId];

      return {
        index,
        unlocked: index < unlocked,
        requiredGearLevel: index < unlocked ? null : slotUnlockLevel(gearId, index),
        trinketId,
        spriteId: definition?.spriteId ?? null,
        displayName: definition?.displayName ?? null,
        grade: progress?.grade ?? null,
        effectSummary:
          definition === null || progress === null
            ? null
            : definition.describeEffect(scaleModifiers(definition.baseModifiers, progress.grade)),
      };
    }),
    nextSlotUnlockLevel: unlocked >= ECONOMY.trinketSlotsPerGear ? null : slotUnlockLevel(gearId, unlocked),
  };
}

export interface TrinketView {
  trinketId: TrinketId;
  displayName: string;
  description: string;
  spriteId: string;
  targetGearId: GearId;
  owned: boolean;
  grade: GradeId;
  maximumGrade: GradeId;
  /** The grade one step up, or null at the top of the ladder. */
  nextGrade: GradeId | null;
  effectSummary: string;
  /** The effect one grade up, so the upgrade can be previewed before it is paid. */
  nextEffectSummary: string | null;
  fragments: number;
  upgradeCost: number | null;
  upgrade: ActionAvailability;
  equippedSlot: { gearId: GearId; slotIndex: number } | null;
}

/** One view per trinket: a duplicate arrives as fragments, never as a copy. */
export function selectTrinketViews(state: GameState): TrinketView[] {
  return TRINKET_IDS.map((trinketId) => {
    const definition = TRINKETS[trinketId];
    const progress = state.collection.trinkets[trinketId];
    const upgraded = nextGrade(progress.grade);

    return {
      trinketId,
      displayName: definition.displayName,
      description: definition.description,
      spriteId: definition.spriteId,
      targetGearId: definition.targetGearId,
      owned: progress.owned,
      grade: progress.grade,
      maximumGrade: HIGHEST_GRADE,
      nextGrade: upgraded,
      effectSummary: definition.describeEffect(
        scaleModifiers(definition.baseModifiers, progress.grade),
      ),
      nextEffectSummary:
        upgraded === null
          ? null
          : definition.describeEffect(scaleModifiers(definition.baseModifiers, upgraded)),
      fragments: progress.fragments,
      upgradeCost: trinketUpgradeCost(progress.grade),
      upgrade: availability(planUpgradeTrinket(state, trinketId)),
      equippedSlot: equippedSlotOf(state, trinketId),
    };
  });
}

export interface TotemView {
  id: TotemId;
  displayName: string;
  description: string;
  owned: boolean;
  grade: GradeId;
  maximumGrade: GradeId;
  nextGrade: GradeId | null;
  spriteId: string;
  fragments: number;
  upgradeCost: number | null;
  upgrade: ActionAvailability;
  effectSummary: string;
  nextEffectSummary: string | null;
  activeSlot: number | null;
}

export function selectTotemViews(state: GameState): TotemView[] {
  return TOTEM_IDS.map((totemId) => {
    const definition = TOTEMS[totemId];
    const progress = state.collection.totems[totemId];
    const upgraded = nextGrade(progress.grade);
    const slot = state.collection.activeTotemIds.indexOf(totemId);

    return {
      id: totemId,
      displayName: definition.displayName,
      description: definition.description,
      owned: progress.owned,
      grade: progress.grade,
      maximumGrade: HIGHEST_GRADE,
      nextGrade: upgraded,
      spriteId: definition.spriteId,
      fragments: progress.fragments,
      upgradeCost: totemUpgradeCost(progress.grade),
      upgrade: availability(planTotemUpgrade(state, totemId)),
      effectSummary: definition.describeEffect(
        scaleModifiers(definition.baseModifiers, progress.grade),
      ),
      nextEffectSummary:
        upgraded === null
          ? null
          : definition.describeEffect(scaleModifiers(definition.baseModifiers, upgraded)),
      activeSlot: slot === -1 ? null : slot,
    };
  });
}

export interface LoadoutView {
  luckPoints: number;
  luckFactor: number;
  maxOxygen: number;
  pickaxeDamage: number;
  failureLossChance: number;
  failureLossBreakdown: StatBreakdownView;
  oreChipValues: Record<OreGradeId, number>;
  keyCashCost: number;
  keyPurchase: ActionAvailability;
}

export function selectLoadoutView(context: DerivedContext): LoadoutView {
  const { state, modifiers, luckPoints } = context;

  return {
    luckPoints,
    luckFactor: luckFactor(luckPoints),
    maxOxygen: selectMaxOxygen(state, modifiers),
    pickaxeDamage: selectPickaxeDamage(state, modifiers),
    failureLossChance: selectFailureLossChance(modifiers),
    failureLossBreakdown: describeStat(ECONOMY.failureLossChanceBase, modifiers, {
      targetStat: "expedition.failureLossChance",
    }),
    oreChipValues: selectOreChipValues(modifiers),
    keyCashCost: keyCost(1),
    keyPurchase:
      state.resources.cash >= keyCost(1)
        ? { available: true, reason: null }
        : { available: false, reason: "Not enough cash for a key." },
  };
}

// ---------------------------------------------------------------------------
// Expedition
// ---------------------------------------------------------------------------

export interface EncounterOptionView {
  id: string;
  label: string;
  description: string;
  /** Oxygen deducted the moment the option is committed. */
  oxygenCost: number;
}

export interface EncounterPreview {
  encounterId: string;
  displayName: string;
  family: string;
  spriteId: string;
  difficultyLabel: string;
  rewardSummary: string;
  approachProgressRatio: number;
  resolveProgressRatio: number;
  /**
   * Milliseconds this encounter has spent resolving. The elapsed value rather
   * than a ratio, because an ore node has no resolve duration to be a fraction
   * of. The renderer uses it to put the pickaxe swing on the same clock the
   * domain lands strikes on, `ECONOMY.pickaxeStrikeIntervalMs`.
   */
  resolveElapsedMs: number;
  durabilityRatio: number | null;
  options: EncounterOptionView[];
}

export interface RunItemView {
  key: string;
  spriteId: string;
  displayName: string;
  amount: number;
  /**
   * `amount` in the notation the player chose. A late run carries ore in the
   * millions, and a raw integer here pushes the row wider than its column.
   */
  displayAmount: string;
  /** Tooltip detail, such as what a unit of ore is worth. */
  detail: string;
  /**
   * True for progression already banked, false for cargo still at risk. The
   * panel renders the two separately, since "banks as N chips on a safe return"
   * is true only of the cargo.
   */
  secured: boolean;
}

export interface RunInventoryView {
  /** Cargo: at risk from an oxygen failure, and worth chips on a safe return. */
  items: RunItemView[];
  /** Progression already banked. Never lost, never converted. */
  secured: RunItemView[];
  chipsIfBanked: number;
  /** `chipsIfBanked` in the notation the player chose. */
  chipsIfBankedText: string;
  isEmpty: boolean;
}

/**
 * One thing this run is committed to, with a depth target and progress toward
 * it. A shared surface rather than a contract indicator: a mid-run contract, an
 * exit held shut by Sealed orders and a wager placed before launch can all be
 * live at once, and each wants to say "here is a target and how far to go".
 *
 * `tone` separates them: a contract is offered and pays if met, while a lock is
 * imposed and holds the exit until met.
 */
export interface RunCommitmentView {
  key: string;
  displayName: string;
  detail: string;
  /**
   * How the commitment came about. A contract is offered and pays if met; Sealed
   * orders are imposed and hold the exit until met; a depth wager is staked, and
   * is the only one of the three that has already cost chips.
   */
  tone: "offered" | "imposed" | "staked";
  startedAtDepth: number;
  targetDepth: number;
  /** 0 at the depth it began, 1 at the target. */
  progressRatio: number;
  depthsRemaining: number;
}

export interface ExpeditionView {
  status: GameState["expedition"]["status"];
  depth: number;
  /** The band the current depth falls in, so the run can say where it is. */
  depthBandName: string;
  /**
   * The condition rolled at launch, if any. Named during the run because it is
   * rolled at launch: there is no earlier moment at which to show it.
   */
  activeModifier: { displayName: string; description: string } | null;
  /** Speeds the pace perk has unlocked, always including 1x. */
  availableSpeeds: number[];
  /** The speed in force, already clamped to what is unlocked. */
  speed: number;
  oxygen: number;
  maxOxygen: number;
  oxygenRatio: number;
  oxygenIsLow: boolean;
  lowOxygenThreshold: number;
  pickaxeDamage: number;
  failureLossChance: number;
  canLaunch: ActionAvailability;
  canContinue: ActionAvailability;
  canReturn: ActionAvailability;
  encounter: EncounterPreview | null;
  /**
   * What waits one step down, from an equipped Cartographer's eye: the family
   * and nothing else, not the name, difficulty or payout. "Something rare"
   * covers a supply cache and a cat alike, so the cat's surprise survives.
   */
  forecast: { label: string } | null;
  /** Everything this run is committed to, in one place. */
  commitments: RunCommitmentView[];
  runInventory: RunInventoryView;
  encountersCompleted: number;
  /** Lowest threshold the auto-continue slider may reach. */
  autoContinueMinimumRatio: number;
  /**
   * The sprite the scene draws the miner with, from the worn skin. The planted
   * frame; `playerStrideSpriteId` is its walking pair.
   */
  playerSpriteId: string;
  /** The same skin mid-stride, alternated with the above while walking. */
  playerStrideSpriteId: string;
  /**
   * True while the run is holding still on a cat it has just met, so the card
   * can say something: an otherwise blank three-second beat reads as a hang.
   */
  metCat: boolean;
  /** Wall-clock milliseconds left of that hold, for anything that wants to wait. */
  pauseRemainingMs: number;
}

function describeRunInventory(context: DerivedContext): RunInventoryView {
  const inventory = context.state.expedition.runInventory;
  const values =
    context.state.expedition.modifierSnapshot?.oreChipValues ??
    selectOreChipValues(context.modifiers);

  // Formatted in one pass at the end, so a new kind of carried thing cannot
  // arrive unformatted.
  const items: Array<Omit<RunItemView, "displayAmount">> = [];

  for (const grade of ORE_GRADE_IDS) {
    if (inventory.ore[grade] > 0) {
      items.push({
        key: `ore:${grade}`,
        spriteId: ORE_GRADES[grade].spriteId,
        displayName: ORE_GRADES[grade].displayName,
        amount: inventory.ore[grade],
        detail: `${values[grade]} chips each when banked`,
        secured: false,
      });
    }
  }

  const banked: Array<[ResourceId, number]> = [
    ["components", inventory.components],
    ["relics", inventory.relics],
    ["caches", inventory.caches],
    ["deepCaches", inventory.deepCaches],
  ];

  for (const [resource, amount] of banked) {
    if (amount > 0) {
      items.push({
        key: resource,
        spriteId: RESOURCE_METADATA[resource].spriteId,
        displayName: RESOURCE_METADATA[resource].displayName,
        amount,
        detail: RESOURCE_METADATA[resource].description,
        secured: false,
      });
    }
  }

  for (const machineId of Object.keys(MACHINES) as MachineId[]) {
    if (inventory.recipePieces[machineId] > 0) {
      items.push({
        key: `recipe:${machineId}`,
        spriteId: MACHINES[machineId].spriteId,
        displayName: `${MACHINES[machineId].displayName} recipe pieces`,
        amount: inventory.recipePieces[machineId],
        detail: `Unlocks ${MACHINES[machineId].displayName}`,
        secured: false,
      });
    }
  }

  // What the run has already banked, kept out of `items` and `chipsIfBanked`:
  // none of it converts to chips or can be lost, so mixing it into the cargo
  // would make the panel's "banks as N chips" line untrue.
  const keepsakes = context.state.expedition.runKeepsakes;
  const secured: Array<Omit<RunItemView, "displayAmount">> = [];

  if (keepsakes.selenite > 0) {
    secured.push({
      key: "keepsake:selenite",
      spriteId: RESOURCE_METADATA.selenite.spriteId,
      displayName: RESOURCE_METADATA.selenite.displayName,
      amount: keepsakes.selenite,
      detail: "From a find that was already at its best. Kept whatever happens.",
      secured: true,
    });
  }

  if (keepsakes.cats > 0) {
    // The most recently met cat, wearing what it was met in, so the shelf shows
    // the same one. `cats` is appended to, so the last entry is the newest.
    const cats = context.state.collection.cats;
    const newest = cats[cats.length - 1];

    secured.push({
      key: "keepsake:cats",
      spriteId:
        newest === undefined
          ? CAT_SKINS[DEFAULT_CAT_SKIN_IDS[0]].restSpriteId
          : CAT_SKINS[newest.skinId].restSpriteId,
      displayName: keepsakes.cats === 1 ? "Cat" : "Cats",
      amount: keepsakes.cats,
      detail: "Met on this run. Permanent luck, and it comes home whatever happens.",
      secured: true,
    });
  }

  const chipsIfBanked = Math.floor(
    ORE_GRADE_IDS.reduce(
      (total, grade) => total + inventory.ore[grade] * (values[grade] ?? 0),
      0,
    ),
  );

  const mode = context.state.settings.numberFormat;
  const formatted = (list: Array<Omit<RunItemView, "displayAmount">>): RunItemView[] =>
    list.map((item) => ({ ...item, displayAmount: formatQuantity(item.amount, mode) }));

  return {
    items: formatted(items),
    secured: formatted(secured),
    chipsIfBanked,
    chipsIfBankedText: formatQuantity(chipsIfBanked, mode),
    // "Nothing yet" means nothing at all, cargo or kept.
    isEmpty: items.length === 0 && secured.length === 0,
  };
}

export interface GrantPopView {
  key: string;
  spriteId: string | null;
  label: string;
  /** Signed, so a cost reads as a loss and a reward as a gain. */
  amount: number;
  unit: string;
}

/**
 * Turns committed grants into the floating indicators shown over the scene.
 * Everything collected is listed, including oxygen restored and any up-front
 * oxygen charge.
 */
export function describeGrants(
  grants: readonly ResolvedGrant[],
  oxygenDelta: number,
): GrantPopView[] {
  const pops: GrantPopView[] = [];

  grants.forEach((grant, index) => {
    switch (grant.kind) {
      case "ore":
        pops.push({
          key: `${index}:ore:${grant.grade}`,
          spriteId: ORE_GRADES[grant.grade].spriteId,
          label: ORE_GRADES[grant.grade].displayName,
          amount: grant.amount,
          unit: "",
        });
        break;
      case "oxygen":
        pops.push({
          key: `${index}:oxygen`,
          spriteId: null,
          label: "Oxygen",
          amount: grant.amount,
          unit: "s",
        });
        break;
      case "recipePiece":
        pops.push({
          key: `${index}:recipe:${grant.machineId}`,
          spriteId: MACHINES[grant.machineId].spriteId,
          label: `${MACHINES[grant.machineId].displayName} pieces`,
          amount: grant.amount,
          unit: "",
        });
        break;
      case "collectible": {
        const definition =
          grant.reward.kind === "trinket"
            ? TRINKETS[grant.reward.trinketId]
            : TOTEMS[grant.reward.totemId];
        const { displayName: name, spriteId } = definition;

        pops.push({
          key: `${index}:collectible`,
          // A find that can no longer improve the item pays selenite, so the pop
          // shows selenite rather than a collectible that was not received.
          spriteId:
            grant.arrival === "selenite" ? RESOURCE_METADATA.selenite.spriteId : spriteId,
          label:
            grant.arrival === "selenite"
              ? `Selenite (${name} is maxed)`
              : grant.arrival === "fragments"
                ? `${name} fragments`
                : name,
          amount:
            grant.arrival === "selenite"
              ? ECONOMY.selenitePerMaxedDuplicate
              : grant.arrival === "fragments"
                ? ECONOMY.fragmentsPerDuplicate
                : 1,
          unit: "",
        });
        break;
      }
      case "contract": {
        // A contract is a goal taken rather than a material gained, so it shows
        // what it is rather than a quantity. Progress lives on the run status.
        pops.push({
          key: `${index}:contract`,
          spriteId: null,
          label: CONTRACTS[grant.contract.contractId].displayName,
          amount: 0,
          unit: "",
        });
        break;
      }
      default: {
        const resource = grant.kind as ResourceId;
        pops.push({
          key: `${index}:${resource}`,
          spriteId: RESOURCE_METADATA[resource]?.spriteId ?? null,
          label: RESOURCE_METADATA[resource]?.displayName ?? resource,
          amount: grant.amount,
          unit: "",
        });
        break;
      }
    }
  });

  if (oxygenDelta !== 0) {
    pops.push({
      key: "oxygen-cost",
      spriteId: null,
      label: "Oxygen",
      amount: oxygenDelta,
      unit: "s",
    });
  }

  return pops;
}

export function selectExpeditionView(context: DerivedContext): ExpeditionView {
  const { state } = context;
  const expedition = state.expedition;
  const pickaxeDamage =
    expedition.status === "surface"
      ? selectPickaxeDamage(state, context.modifiers)
      : expedition.pickaxeDamageSnapshot;

  const active = expedition.currentEncounter;
  const definition = active === null ? null : ENCOUNTERS[active.encounterId];

  const encounter: EncounterPreview | null =
    active === null || definition === null
      ? null
      : {
          encounterId: definition.id,
          displayName: definition.displayName,
          family: definition.family,
          spriteId: definition.spriteId,
          difficultyLabel: definition.difficultyLabel,
          rewardSummary: definition.rewardSummary,
          approachProgressRatio: safeDivide(
            active.approachElapsedMs,
            active.approachDurationMs,
            1,
          ),
          resolveProgressRatio:
            active.resolveDurationMs === null
              ? 0
              : safeDivide(active.resolveElapsedMs, active.resolveDurationMs),
          resolveElapsedMs: active.resolveElapsedMs,
          durabilityRatio:
            active.durabilityRemaining === null
              ? null
              : safeDivide(active.durabilityRemaining, definition.durability ?? 1),
          options: (definition.choiceOptions ?? []).map((option: EncounterChoiceDefinition) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            oxygenCost: option.oxygenCost,
          })),
        };

  const launchable = expedition.status === "surface";
  // The decision follows a reward rather than a staged encounter.
  const inDecision = expedition.status === "decision";
  // The tank fills for free at launch, so on the surface it reads as full.
  const maxOxygen = launchable
    ? selectMaxOxygen(state, context.modifiers)
    : expedition.maxOxygenSnapshot;

  const forecastEncounter = expedition.forecastEncounter;
  // Sealed orders, if this run drew it and has not yet reached its target.
  const lockedUntil = bankingLockedUntil(state);
  const commitments = selectRunCommitments(state, lockedUntil);

  return {
    status: expedition.status,
    depth: expedition.depth,
    depthBandName: bandForDepth(expedition.depth).displayName,
    // Only at the decision: any earlier would announce it while the player is
    // still walking to the encounter before it.
    commitments,
    forecast:
      inDecision && forecastEncounter !== null
        ? { label: ENCOUNTER_FAMILY_LABELS[ENCOUNTERS[forecastEncounter.encounterId].family] }
        : null,
    // Derived from the same function that decides what a rank unlocks, so the
    // list cannot fall behind the perk.
    availableSpeeds: expeditionSpeeds().filter(
      (speed) => speed <= unlockedExpeditionSpeed(state),
    ),
    speed: selectExpeditionSpeed(state),
    activeModifier:
      expedition.activeModifierId === null
        ? null
        : {
            displayName: EXPEDITION_MODIFIERS[expedition.activeModifierId].displayName,
            description: EXPEDITION_MODIFIERS[expedition.activeModifierId].description,
          },
    oxygen: launchable ? maxOxygen : expedition.oxygen,
    maxOxygen,
    oxygenRatio: launchable ? 1 : oxygenRatio(state),
    oxygenIsLow: expedition.status !== "surface" && oxygenRatio(state) <= ECONOMY.lowOxygenWarningRatio,
    lowOxygenThreshold: ECONOMY.lowOxygenWarningRatio,
    pickaxeDamage,
    failureLossChance:
      expedition.modifierSnapshot?.failureLossChance ?? selectFailureLossChance(context.modifiers),
    /*
     * The first machine level comes before the first descent: a player who
     * launches first learns the mining loop with no reason to come back up.
     *
     * Here rather than in `launchExpedition`, because this is first-run pacing
     * rather than a game rule — in the domain it would make every balance
     * simulation buy a level. It is not tutorial state either: the flag is set
     * by the purchase, so skipping the script gates a player identically.
     */
    canLaunch: !launchable
      ? { available: false, reason: "An expedition is already under way." }
      : state.onboarding.hasPurchasedMachineLevel
        ? { available: true, reason: null }
        : {
            available: false,
            reason: "Buy your first machine level before you go down.",
          },
    canContinue: inDecision
      ? { available: true, reason: null }
      : {
          available: false,
          reason: "You are committed until this encounter resolves.",
        },
    canReturn: inDecision
      ? lockedUntil === null
        ? { available: true, reason: null }
        : {
            available: false,
            reason: describeBlock({
              kind: "banking-locked",
              target: lockedUntil,
              remaining: lockedUntil - expedition.depth,
            }),
          }
      : {
          available: false,
          reason:
            expedition.status === "surface"
              ? "You are already on the surface."
              : "You cannot return until the encounter resolves.",
        },
    encounter,
    runInventory: describeRunInventory(context),
    encountersCompleted: expedition.history.filter((entry) => entry.outcome === "completed").length,
    autoContinueMinimumRatio: ECONOMY.autoContinueMinimumRatio,
    playerSpriteId: MINER_SKINS[state.collection.activeMinerSkinId].spriteId,
    playerStrideSpriteId: MINER_SKINS[state.collection.activeMinerSkinId].strideSpriteId,
    metCat:
      expedition.status === "reward" &&
      expedition.currentEncounter?.encounterId === CAT_ENCOUNTER_ID,
    pauseRemainingMs: expedition.pauseRemainingWallMs,
  };
}

// ---------------------------------------------------------------------------
// Gambling
// ---------------------------------------------------------------------------

export interface WagerView {
  wager: number;
  affordable: boolean;
  reason: string | null;
}

export interface PayoutRowView {
  symbolId: SlotSymbolId;
  displayName: string;
  glyph: string;
  tripleMultiplier: number;
  pairMultiplier: number;
}

/**
 * Staking the whole balance, offered beside the rungs in all four games. Not a
 * rung, since its value depends on the balance rather than the ladder, which is
 * also why it plays directly instead of changing the selection first.
 */
export interface BetEverythingView {
  /** Chips it would stake right now. */
  wager: number;
  available: ActionAvailability;
}

/**
 * `busy` is why the game cannot be played at all — a wheel still turning, a hand
 * still live — and not whether the selected rung is affordable. Betting
 * everything is affordable by definition.
 */
function describeBetEverything(state: GameState, busy: string | null): BetEverythingView {
  const chips = state.resources.chips;

  // An infinite balance has no "everything" to bet: no result can be computed
  // from an infinite wager, so it is refused with a reason rather than ignored.
  const reason =
    busy ??
    (chips === INFINITE
      ? "Your chips have outgrown counting."
      : chips <= 0
        ? "You have no chips."
        : null);

  return {
    wager: chips === INFINITE ? 0 : chips,
    available: reason === null ? { available: true, reason: null } : { available: false, reason },
  };
}

/** A stored selection, turned into the number a play command will be given. */
interface ResolvedStake {
  /** What the play command stakes. */
  amount: number;
  /** True when the selection is the everything mode rather than a rung. */
  isEverything: boolean;
  /** Why this stake cannot be played right now, or null. */
  blocked: string | null;
}

/**
 * The one place a stake selection becomes a number, shared by all four games, so
 * the amount on the play button, the amount its availability is judged against
 * and the amount the command charges cannot disagree.
 *
 * "Everything" is resolved here, when the view is built, rather than when it was
 * selected: the balance moves between the two, which is why the selection is
 * stored as a mode rather than a number.
 */
function resolveStake(state: GameState, selection: ChipStake): ResolvedStake {
  if (selection === STAKE_EVERYTHING) {
    const everything = describeBetEverything(state, null);

    return {
      amount: everything.wager,
      isEverything: true,
      blocked: everything.available.available ? null : everything.available.reason,
    };
  }

  return {
    amount: selection,
    isEverything: false,
    blocked:
      state.resources.chips >= selection ? null : `Needs ${formatCompact(selection)} chips.`,
  };
}

export interface GamblingView {
  /**
   * The stake the next play will use, already resolved — a number even for "Bet
   * it all", so the button and the command read one value.
   */
  selectedWager: number;
  /** True when the selection is the everything rung rather than a fixed one. */
  stakeIsEverything: boolean;
  wagers: WagerView[];
  spin: ActionAvailability;
  committedSpin: GameState["gambling"]["committedSpin"];
  recentResults: GameState["gambling"]["recentResults"];
  luckPoints: number;
  expectedReturn: number;
  maximumExpectedReturn: number;
  payoutTable: PayoutRowView[];
  reelCount: number;
  betEverything: BetEverythingView;
}

export function selectGamblingView(context: DerivedContext): GamblingView {
  const { state, modifiers, luckPoints } = context;
  const spinning = state.gambling.committedSpin !== null;
  const stake = resolveStake(state, state.gambling.selectedWager);

  return {
    selectedWager: stake.amount,
    stakeIsEverything: stake.isEverything,
    wagers: CHIP_WAGERS.map((wager) => ({
      wager,
      affordable: state.resources.chips >= wager,
      reason: state.resources.chips >= wager ? null : `Needs ${wager} chips.`,
    })),
    spin: spinning
      ? { available: false, reason: "A spin is still resolving." }
      : stake.blocked === null
        ? { available: true, reason: null }
        : { available: false, reason: stake.blocked },
    committedSpin: state.gambling.committedSpin,
    recentResults: state.gambling.recentResults,
    luckPoints,
    expectedReturn: selectExpectedReturn(modifiers, luckPoints),
    maximumExpectedReturn: ECONOMY.gamblingMaxExpectedReturn,
    payoutTable: SLOT_SYMBOL_IDS.map((symbolId) => {
      const symbol = SLOT_SYMBOLS[symbolId];

      return {
        symbolId,
        displayName: symbol.displayName,
        glyph: symbol.glyph,
        tripleMultiplier: symbol.tripleMultiplier,
        pairMultiplier: symbol.pairMultiplier,
      };
    }),
    reelCount: 3,
    betEverything: describeBetEverything(state, spinning ? "A spin is still resolving." : null),
  };
}

// ---------------------------------------------------------------------------
// Roulette
// ---------------------------------------------------------------------------

export interface RouletteBetView {
  betTypeId: RouletteBetId;
  displayName: string;
  description: string;
  multiplier: number;
  selected: boolean;
  /** True for the one bet that needs a number chosen alongside it. */
  needsNumber: boolean;
  /**
   * The colour this bet backs, when it backs exactly one — so the button can
   * carry the same pattern the wheel does. Null for every bet that spans
   * colours, and for the straight-up, whose colour depends on the number.
   */
  colour: RouletteColour | null;
}

export interface RouletteView {
  bets: RouletteBetView[];
  selectedBetTypeId: RouletteBetId;
  selectedNumber: number;
  /** The stake the next play will use, already resolved. See `GamblingView`. */
  selectedWager: number;
  /** True when the selection is the everything rung rather than a fixed one. */
  stakeIsEverything: boolean;
  wagers: WagerView[];
  spin: ActionAvailability;
  betEverything: BetEverythingView;
  committedBet: GameState["gambling"]["roulette"]["committedBet"];
  recentResults: GameState["gambling"]["roulette"]["recentResults"];
  pocketCount: number;
  /** Pocket colours, so the panel never keeps its own copy of the red set. */
  colourOf: (pocket: number) => RouletteColour;
  luckPoints: number;
  expectedReturn: number;
  /**
   * One minus the expected return, which is the number a roulette player reads.
   * Disclosed because luck leans the wheel, and doing that silently would be an
   * undocumented payout rule.
   */
  houseEdge: number;
  maximumExpectedReturn: number;
}

export function selectRouletteView(context: DerivedContext): RouletteView {
  const { state, modifiers, luckPoints } = context;
  const roulette = state.gambling.roulette;
  const spinning = roulette.committedBet !== null;
  const stake = resolveStake(state, roulette.selectedWager);
  const expected = selectRouletteExpectedReturn(
    modifiers,
    luckPoints,
    roulette.selectedBetTypeId,
    roulette.selectedNumber,
  );

  return {
    bets: ROULETTE_BET_IDS.map((betTypeId) => ({
      betTypeId,
      displayName: ROULETTE_BETS[betTypeId].displayName,
      description: ROULETTE_BETS[betTypeId].description,
      multiplier: ROULETTE_BETS[betTypeId].multiplier,
      selected: betTypeId === roulette.selectedBetTypeId,
      needsNumber: ROULETTE_BETS[betTypeId].pockets === null,
      colour: betColour(betTypeId),
    })),
    selectedBetTypeId: roulette.selectedBetTypeId,
    selectedNumber: roulette.selectedNumber,
    selectedWager: stake.amount,
    stakeIsEverything: stake.isEverything,
    wagers: CHIP_WAGERS.map((wager) => ({
      wager,
      affordable: state.resources.chips >= wager,
      reason: state.resources.chips >= wager ? null : `Needs ${String(wager)} chips.`,
    })),
    spin: spinning
      ? { available: false, reason: "The wheel is still turning." }
      : stake.blocked === null
        ? { available: true, reason: null }
        : { available: false, reason: stake.blocked },
    betEverything: describeBetEverything(state, spinning ? "The wheel is still turning." : null),
    committedBet: roulette.committedBet,
    recentResults: roulette.recentResults,
    pocketCount: ROULETTE_POCKET_COUNT,
    colourOf: pocketColour,
    luckPoints,
    expectedReturn: expected,
    houseEdge: 1 - expected,
    maximumExpectedReturn: ECONOMY.gamblingMaxExpectedReturn,
  };
}

// ---------------------------------------------------------------------------
// Blackjack
// ---------------------------------------------------------------------------

export interface BlackjackCardView {
  /** Position in the hand, so a repeated rank still keys uniquely. */
  key: string;
  rank: number;
  label: string;
  value: number;
}

export interface BlackjackView {
  /** The stake the next deal will use, already resolved. See `GamblingView`. */
  selectedWager: number;
  /** True when the selection is the everything rung rather than a fixed one. */
  stakeIsEverything: boolean;
  wagers: WagerView[];
  deal: ActionAvailability;
  betEverything: BetEverythingView;
  hit: ActionAvailability;
  stand: ActionAvailability;
  double: ActionAvailability;
  playerCards: BlackjackCardView[];
  dealerCards: BlackjackCardView[];
  playerTotal: number;
  playerSoft: boolean;
  /**
   * The dealer's total as the player may see it: the upcard alone while the hand
   * is live. The hole card is in the committed shoe either way, so hiding it is
   * presentation, but showing it would hand over the whole hand.
   */
  dealerTotal: number;
  dealerHidden: boolean;
  status: "idle" | "player" | "settled";
  outcomeLabel: string | null;
  lastNet: number | null;
  recentResults: GameState["gambling"]["blackjack"]["recentResults"];
  luckPoints: number;
  expectedReturn: number;
  houseEdge: number;
  /** The return with no luck at all, so the panel can show what luck is worth. */
  baseReturn: number;
  maximumExpectedReturn: number;
}

const BLACKJACK_OUTCOME_LABELS: Record<string, string> = {
  "player-blackjack": "Blackjack, paid three to two",
  player: "You win",
  dealer: "Dealer wins",
  push: "Push, stake returned",
};

function cardViews(cards: readonly number[], prefix: string): BlackjackCardView[] {
  return cards.map((rank, index) => ({
    key: `${prefix}-${String(index)}`,
    rank,
    label: BLACKJACK_RANK_NAMES[rank] ?? String(rank),
    value: cardValue(rank),
  }));
}

export function selectBlackjackView(context: DerivedContext): BlackjackView {
  const { state, modifiers, luckPoints } = context;
  const blackjack = state.gambling.blackjack;
  const hand = blackjack.hand;
  const live = hand !== null && hand.status === "player";
  const stake = resolveStake(state, blackjack.selectedWager);
  const expected = selectBlackjackExpectedReturn(modifiers, luckPoints);

  const dealerCards = hand === null ? [] : hand.dealerCards;
  const visibleDealer = live ? dealerCards.slice(0, 1) : dealerCards;

  const canDouble =
    live &&
    hand.playerCards.length === 2 &&
    !hand.doubled &&
    state.resources.chips >= hand.wager;

  const doubleReason = (): string => {
    if (hand === null || !live) {
      return "Deal a hand first.";
    }

    if (hand.playerCards.length !== 2 || hand.doubled) {
      return "Doubling is only offered on the first two cards.";
    }

    return `Needs another ${String(hand.wager)} chips.`;
  };

  return {
    selectedWager: stake.amount,
    stakeIsEverything: stake.isEverything,
    wagers: CHIP_WAGERS.map((wager) => ({
      wager,
      affordable: state.resources.chips >= wager,
      reason: state.resources.chips >= wager ? null : `Needs ${String(wager)} chips.`,
    })),
    deal: live
      ? { available: false, reason: "Finish the hand you are playing first." }
      : stake.blocked === null
        ? { available: true, reason: null }
        : { available: false, reason: stake.blocked },
    betEverything: describeBetEverything(
      state,
      live ? "Finish the hand you are playing first." : null,
    ),
    hit: live
      ? { available: true, reason: null }
      : { available: false, reason: "Deal a hand first." },
    stand: live
      ? { available: true, reason: null }
      : { available: false, reason: "Deal a hand first." },
    double: canDouble
      ? { available: true, reason: null }
      : { available: false, reason: doubleReason() },
    playerCards: hand === null ? [] : cardViews(hand.playerCards, "player"),
    dealerCards: cardViews(visibleDealer, "dealer"),
    playerTotal: hand === null ? 0 : handTotal(hand.playerCards).total,
    playerSoft: hand === null ? false : handTotal(hand.playerCards).soft,
    dealerTotal: handTotal(visibleDealer).total,
    dealerHidden: live,
    status: hand === null ? "idle" : hand.status,
    outcomeLabel:
      hand === null || hand.outcome === null
        ? null
        : (BLACKJACK_OUTCOME_LABELS[hand.outcome] ?? null),
    lastNet: hand === null || hand.status !== "settled" ? null : hand.payout - hand.wager,
    recentResults: blackjack.recentResults,
    luckPoints,
    expectedReturn: expected,
    houseEdge: 1 - expected,
    baseReturn: BLACKJACK_BASE_RETURN,
    maximumExpectedReturn: ECONOMY.gamblingMaxExpectedReturn,
  };
}

// ---------------------------------------------------------------------------
// The depth wager
// ---------------------------------------------------------------------------

export interface DepthWagerView {
  /** The all-time best the price is derived against, already floored. */
  referenceDepth: number;
  /** True while the floor is doing the work, so the panel can say why. */
  referenceIsFloor: boolean;
  minimumTarget: number;
  maximumTarget: number;
  selectedTarget: number;
  /** The stake the next wager will use, already resolved. See `GamblingView`. */
  selectedStake: number;
  /** True when the selection is the everything rung rather than a fixed one. */
  stakeIsEverything: boolean;
  stakes: WagerView[];
  /** The chance the published curve assigns to the selected target. */
  successChance: number;
  /** The price before luck, so what luck is worth here stays visible. */
  baseMultiplier: number;
  offeredMultiplier: number;
  potentialPayout: number;
  place: ActionAvailability;
  betEverything: BetEverythingView;
  pending: GameState["gambling"]["depthWager"]["pending"];
  recentResults: GameState["gambling"]["depthWager"]["recentResults"];
  luckPoints: number;
  expectedReturn: number;
  maximumExpectedReturn: number;
  /** The curve, written out: the player composes the bet, so the price is stated. */
  formula: string;
}

export function selectDepthWagerView(context: DerivedContext): DepthWagerView {
  const { state, modifiers, luckPoints } = context;
  const wager = state.gambling.depthWager;
  const reference = wagerReferenceDepth(state);
  const minimum = minimumWagerTarget(reference);
  const maximum = maximumWagerTarget(reference);
  // A save that has never opened this panel opens on the player's own record.
  const target = clamp(
    wager.selectedTargetDepth === 0 ? reference : wager.selectedTargetDepth,
    minimum,
    maximum,
  );

  const chance = wagerSuccessProbability(target, reference);
  const offered = offeredWagerMultiplier(target, reference, modifiers, luckPoints);
  const onSurface = state.expedition.status === "surface";
  const stake = resolveStake(state, wager.selectedStake);

  const placeReason = (): string => {
    if (wager.pending !== null) {
      return "A wager is already riding on your next run.";
    }

    if (!onSurface) {
      return "Wagers are placed before you launch, not during a run.";
    }

    // Whatever the resolver says, so each kind of refusal explains itself.
    return stake.blocked ?? "That stake cannot be placed.";
  };

  return {
    referenceDepth: reference,
    referenceIsFloor: state.statistics.deepestDepth < ECONOMY.depthWagerReferenceFloor,
    minimumTarget: minimum,
    maximumTarget: maximum,
    selectedTarget: target,
    selectedStake: stake.amount,
    stakeIsEverything: stake.isEverything,
    betEverything: describeBetEverything(
      state,
      wager.pending !== null
        ? "A wager is already riding on your next run."
        : onSurface
          ? null
          : "Wagers are placed before you launch, not during a run.",
    ),
    stakes: CHIP_WAGERS.map((stake) => ({
      wager: stake,
      affordable: state.resources.chips >= stake,
      reason: state.resources.chips >= stake ? null : `Needs ${String(stake)} chips.`,
    })),
    successChance: chance,
    baseMultiplier: baseWagerMultiplier(target, reference),
    offeredMultiplier: offered,
    potentialPayout: Math.floor(stake.amount * offered),
    place:
      wager.pending === null && onSurface && stake.blocked === null
        ? { available: true, reason: null }
        : { available: false, reason: placeReason() },
    pending: wager.pending,
    recentResults: wager.recentResults,
    luckPoints,
    expectedReturn: offered * chance,
    maximumExpectedReturn: ECONOMY.gamblingMaxExpectedReturn,
    formula:
      `Chance = ${String(ECONOMY.depthWagerBestProbability)} ^ ` +
      `((target / ${String(reference)}) ^ ${String(ECONOMY.depthWagerCurveExponent)}), ` +
      `priced at a ${formatPercent(1 - ECONOMY.depthWagerBaseReturn, 0)} house margin.`,
  };
}

// ---------------------------------------------------------------------------
// Prestige
// ---------------------------------------------------------------------------

export interface PerkView {
  id: PrestigePerkId;
  branchId: PerkBranchId;
  branchName: string;
  displayName: string;
  description: string;
  rank: number;
  maximumRank: number;
  /** True when there is no maximum, so the panel counts rather than drawing pips. */
  repeatable: boolean;
  /** Selenite for the next rank, or null once the perk is maxed. */
  seleniteCost: number | null;
  /** What the next rank would add, so the player is not buying blind. */
  nextEffectSummary: string | null;
  /** True once at least one rank is held, which is what opens a prerequisite. */
  purchased: boolean;
  prerequisitePerkIds: PrestigePerkId[];
  /**
   * What still has to be done first, in a sentence: a list of names for an
   * ordinary perk, and a summary for the capstone, whose fourteen prerequisites
   * would be three unreadable lines.
   */
  prerequisiteSummary: string;
  purchase: ActionAvailability;
}

/**
 * What one rank of a perk is worth, in words. Perks scale linearly, so this is
 * the authored effect times the rank. Returns null when there is nothing to say,
 * so the panel can omit the line rather than render "Next:" and nothing.
 */
function describePerkRank(perk: PrestigePerkDefinition, rank: number): string | null {
  if (perk.modifiers.length === 0) {
    return describePerkCapability(perk, rank);
  }

  return perk.modifiers
    .map((modifier) => {
      const scaled = scaleModifierBy(modifier, rank, String(rank));
      const stat = STAT_LABELS[scaled.targetStat] ?? scaled.targetStat;

      if (scaled.operation === "add") {
        // `formatCompact` floors anything below 1, which would render a -0.04
        // failure loss chance as "-0", so probabilities are shown as percentages.
        if (PROBABILITY_STATS.has(scaled.targetStat)) {
          const percent = Math.round(scaled.value * 1000) / 10;

          return `${percent > 0 ? "+" : ""}${String(percent)}% ${stat}`;
        }

        const rounded = Math.round(scaled.value * 100) / 100;

        return `${rounded > 0 ? "+" : ""}${formatCompact(rounded)} ${stat}`;
      }

      const percent = Math.round((scaled.value - 1) * 100);

      return `${percent > 0 ? "+" : ""}${percent}% ${stat}`;
    })
    .join(", ");
}

/**
 * A capability perk's next rank, for the perks that buy a behaviour rather than
 * a number. The speed perk is the only one today.
 */
function describePerkCapability(perk: PrestigePerkDefinition, rank: number): string | null {
  if (perk.capability === "expedition-speed") {
    return `${String(expeditionSpeedForRank(rank))}x expedition speed`;
  }

  return null;
}

/** Additive stats that are probabilities, and so read as percentages. */
const PROBABILITY_STATS = new Set<StatId>(["expedition.failureLossChance"]);

/** Player-facing names for the stats perks touch. */
const STAT_LABELS: Partial<Record<StatId, string>> = {
  "machine.payout": "machine payout",
  "machine.cycleMs": "cycle time",
  "prestige.startingCash": "starting cash",
  "prestige.seleniteGain": "selenite awarded",
  "gear.tankOxygen": "maximum oxygen",
  "gear.pickaxeDamage": "pickaxe damage",
  "expedition.rewardQuantity": "reward quantity",
  "expedition.failureLossChance": "failure loss chance",
  "expedition.encounterWeight": "rare encounter weight",
  "economy.oreChipValue": "ore chip value",
  luck: "luck",
};

export interface PrestigeView {
  count: number;
  metric: number;
  threshold: number;
  progressRatio: number;
  projectedSelenite: number;
  selenite: number;
  prestige: ActionAvailability;
  resetSummary: readonly string[];
  retainSummary: readonly string[];
  perks: PerkView[];
}

export function selectPrestigeView(
  state: GameState,
  resetSummary: readonly string[],
  retainSummary: readonly string[],
): PrestigeView {
  const block = prestigeBlock(state);
  const metric = prestigeMetric(state);

  return {
    count: state.prestige.count,
    metric,
    // Both read the scaled wall rather than the base constant, so the panel
    // shows this cycle's target.
    threshold: prestigeThreshold(state),
    progressRatio: prestigeProgressRatio(state),
    projectedSelenite: projectedSelenite(state),
    selenite: state.resources.selenite,
    prestige:
      block === null
        ? { available: true, reason: null }
        : { available: false, reason: describeBlock(block) },
    resetSummary,
    retainSummary,
    /*
     * A capstone is hidden until it can be bought: its prerequisite is the whole
     * tree, and a locked card advertising it from the first prestige is a promise
     * the player cannot act on for many cycles. Keyed on
     * `requiresMaxedPrerequisites` rather than an id, and on the block kind, so
     * one that is revealed but merely unaffordable still shows.
     */
    perks: PRESTIGE_PERK_IDS.filter((perkId) => {
      if (PRESTIGE_PERKS[perkId].requiresMaxedPrerequisites !== true) {
        return true;
      }

      return perkBlock(state, perkId)?.kind !== "prerequisite-required";
    }).map((perkId) => {
      const perk = PRESTIGE_PERKS[perkId];
      const perkIssue = perkBlock(state, perkId);

      const rank = perkRank(state, perkId);
      const nextCost = perkNextRankCost(state, perkId);

      return {
        id: perkId,
        branchId: perk.branch,
        branchName: PERK_BRANCHES[perk.branch].displayName,
        displayName: perk.displayName,
        description: perk.description,
        rank,
        maximumRank: perk.maximumRank,
        repeatable: perk.repeatable === true,
        /** Null once the perk is maxed, which is also what disables the button. */
        seleniteCost: nextCost,
        // What the next rank adds, so the player is not buying blind.
        nextEffectSummary:
          nextCost === null ? null : describePerkRank(perk, rank + 1),
        purchased: rank > 0,
        prerequisitePerkIds: perk.prerequisitePerkIds,
        prerequisiteSummary:
          perk.requiresMaxedPrerequisites === true
            ? "Every other perk, at its maximum rank."
            : perk.prerequisitePerkIds
                .map((id) => PRESTIGE_PERKS[id].displayName)
                .join(", "),
        purchase:
          perkIssue === null
            ? { available: true, reason: null }
            : { available: false, reason: describeBlock(perkIssue) },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/**
 * The next thing worth doing, and where it is explained in full. It lives in the
 * Help window rather than as a dashboard callout, which is what makes it pulled
 * rather than pushed, and follows from that:
 *
 * - No dismissal, or the manual would answer "what next" with silence.
 * - No tutorial suppression, since a panel the player opened deliberately does
 *   not compete with a card the way a callout did.
 * - Always an answer. Past the five first-time conditions the answer is depth,
 *   in the same words `act.deeper` uses, so the two surfaces cannot disagree.
 */
export interface NextActionView {
  id: string;
  /** The imperative, as a heading. */
  title: string;
  /** Why, and what it leads to. Two sentences at most. */
  body: string;
  /** The topic that explains it in full, for a "Read more" into the manual. */
  topicId: HelpTopicId;
}

export function selectNextAction(context: DerivedContext): NextActionView {
  const { state } = context;
  const candidates: NextActionView[] = [];

  const starter = selectMachineView(context, STARTER_MACHINE_ID);

  if (!state.onboarding.hasPurchasedMachineLevel) {
    candidates.push({
      id: "next.first-upgrade",
      title: "Buy your first machine level",
      body: starter.purchase.available
        ? "The floor is the only thing on this moon that makes cash, and a level raises its payout permanently. Buy one in the machine panel; the expedition waits until you have."
        : "The floor is the only thing on this moon that makes cash. Let the starter machine run until a level is affordable, then buy one in the machine panel.",
      topicId: "help.machines",
    });
  }

  if (!state.onboarding.hasLaunchedExpedition) {
    candidates.push({
      id: "next.first-expedition",
      title: "Launch an expedition",
      body: "Ore comes off the rock and becomes chips only when you return safely. Oxygen runs down the whole time you are below, and the tank is refilled free when you come back.",
      topicId: "help.expeditions",
    });
  }

  if (state.expedition.status === "decision" && !state.onboarding.hasBankedRun) {
    candidates.push({
      id: "next.first-decision",
      title: "Press on, or bank what you are carrying",
      body: "Encounters resolve as soon as you reach them, and pressing on commits you to whatever comes next, sight unseen. Returning banks the ore; failing rolls each unbanked unit separately.",
      topicId: "help.expeditions",
    });
  }

  if (state.onboarding.hasBankedRun && state.resources.chips > 0) {
    candidates.push({
      id: "next.spend-chips",
      title: "Spend the chips",
      body: "Chips buy machine research in the middle panel, expedition supplies and caches in the store, and a seat at any of the Company's four games. They never become cash.",
      topicId: "help.machines",
    });
  }

  if (state.resources.caches > 0 && state.resources.keys === 0) {
    candidates.push({
      id: "next.buy-key",
      title: "Buy a key",
      body: "You are carrying a sealed cache and nothing to open it with. A key is 250 cash from the store and opens one cache of either kind.",
      topicId: "help.caches",
    });
  }

  // The answer for a save past all five, and why this cannot return null:
  // everything left is gated on depth, and the pane is always on screen.
  return (
    candidates[0] ?? {
      id: "next.go-deeper",
      title: "Go deeper",
      body: "Depth is what is left. Deeper bands pay more per encounter, the nine unbuilt machines have their recipe pieces filed in their own bands, and every remaining system opens off how far down you have been.",
      topicId: "help.expeditions",
    }
  );
}

// ---------------------------------------------------------------------------
// Window rail
// ---------------------------------------------------------------------------

export type WindowId =
  | "settings"
  | "save"
  | "store"
  | "gambling"
  | "prestige"
  | "gear"
  | "totems"
  | "skins"
  | "statSheet"
  | "stats"
  | "jukebox"
  | "help";

/**
 * One cache kind's row in the store: what it is, what it costs both ways, and
 * how long until the Company has another.
 */
export interface CacheOfferView {
  cacheTypeId: CacheTypeId;
  displayName: string;
  description: string;
  spriteId: string;
  held: number;
  /** The income-derived cash price, restocked on a depth gate. */
  cashPrice: number;
  depthsPerRestock: number;
  depthsUntilRestock: number;
  buyWithCash: ActionAvailability;
  /** The flat chip price, always in stock and bought in bulk. */
  chipPrice: number;
  /** The buttons the panel offers, the last of which is everything affordable. */
  chipOffers: BulkOfferView[];
  open: ActionAvailability;
  /** How many could be opened right now, which is what "open all" will take. */
  openable: number;
}

export interface StoreView {
  keysHeld: number;
  keyPrice: number;
  /** The buttons the key row offers, the last of which is everything affordable. */
  keyOffers: BulkOfferView[];
  caches: CacheOfferView[];
}

/**
 * One line of an opened-cache summary: what came out, and how many times.
 * Grouped rather than one row per cache, since the interesting fact is almost
 * always "eleven of these, one of those".
 */
export interface CacheResultRowView {
  key: string;
  spriteId: string;
  displayName: string;
  /** What the player received: the item, fragments, or selenite. */
  detail: string;
  count: number;
  /** The grade it now sits at, where the row is about a collectible. */
  grade: GradeId | null;
}

export interface CacheResultsView {
  title: string;
  rows: CacheResultRowView[];
  opened: number;
  /** Asked for but not opened, so the panel can say why it stopped. */
  shortfall: number;
  announcement: string;
}

export function selectCacheResultsView(
  state: GameState,
  batch: CacheOpenBatch,
): CacheResultsView {
  const rows = new Map<string, CacheResultRowView>();

  for (const result of batch.results) {
    const definition =
      result.reward.kind === "trinket"
        ? TRINKETS[result.reward.trinketId]
        : TOTEMS[result.reward.totemId];
    const id =
      result.reward.kind === "trinket" ? result.reward.trinketId : result.reward.totemId;
    const key = `${id}:${result.arrival}`;

    const existing = rows.get(key);

    if (existing !== undefined) {
      existing.count += 1;
      continue;
    }

    // The grade is read from the collection as it stands after the whole batch,
    // which is where the thing ended up rather than where it was mid-open.
    const progress =
      result.reward.kind === "trinket"
        ? state.collection.trinkets[result.reward.trinketId]
        : state.collection.totems[result.reward.totemId];

    rows.set(key, {
      key,
      spriteId:
        result.arrival === "selenite"
          ? RESOURCE_METADATA.selenite.spriteId
          : definition.spriteId,
      displayName: result.arrival === "selenite" ? "Selenite" : definition.displayName,
      detail:
        result.arrival === "item"
          ? "New"
          : result.arrival === "fragments"
            ? `${String(ECONOMY.fragmentsPerDuplicate)} fragment${
                ECONOMY.fragmentsPerDuplicate === 1 ? "" : "s"
              }`
            : `${definition.displayName} is maxed`,
      count: 1,
      grade: result.arrival === "selenite" ? null : (progress?.grade ?? null),
    });
  }

  const opened = batch.results.length;
  const list = [...rows.values()];

  return {
    title: `${CACHE_TYPES[batch.cacheTypeId].displayName}${opened === 1 ? "" : "s"} opened`,
    rows: list,
    opened,
    shortfall: batch.shortfall,
    // One sentence for assistive technology, since a grid of tiles read item by
    // item is worse than being told what happened.
    announcement: `Opened ${String(opened)} ${CACHE_TYPES[
      batch.cacheTypeId
    ].displayName.toLowerCase()}${opened === 1 ? "" : "s"}: ${list
      .map((row) => `${String(row.count)} ${row.displayName}, ${row.detail}`)
      .join("; ")}.`,
  };
}

/**
 * The quantities a bulk row offers: fixed rungs plus whatever the balance covers,
 * deduplicated and sorted, so a player who can afford three sees 1 and 3 rather
 * than 1, 10, 100 and 3.
 */
function bulkQuantities(balance: number, unitPrice: number): number[] {
  const most = affordableQuantity(balance, unitPrice);

  if (most <= 0) {
    return [1];
  }

  const rungs = [1, 10, 100].filter((rung) => rung < most);

  return [...new Set([...rungs, most])].sort((first, second) => first - second);
}

/**
 * One button on a bulk row: how many, what it costs, and whether it may be
 * pressed. Availability comes from the real plan for that quantity rather than a
 * balance comparison here, so "greyed" and "refused" are the same answer by
 * construction. The price is on the view for the same reason: a component
 * multiplying it out would be a second answer.
 */
export interface BulkOfferView {
  quantity: number;
  totalPrice: number;
  purchase: ActionAvailability;
}

function bulkOffers(
  balance: number,
  unitPrice: number,
  plan: (quantity: number) => Parameters<typeof availability>[0],
): BulkOfferView[] {
  return bulkQuantities(balance, unitPrice).map((quantity) => ({
    quantity,
    totalPrice: unitPrice * quantity,
    purchase: availability(plan(quantity)),
  }));
}

export function selectStoreView(context: DerivedContext): StoreView {
  const { state } = context;
  // Derived once and handed to every description and plan, so the price on a
  // button is the price charged. This is the one price that moves on its own.
  const cashPerSecond = selectTotalCashPerSecond(context);

  const caches = CACHE_TYPE_IDS.map((cacheTypeId): CacheOfferView => {
    const type = CACHE_TYPES[cacheTypeId];
    const held = state.resources[type.resourceId];
    const cash = describeCachePurchase(state, cashPerSecond, cacheTypeId);
    const chipPrice = cacheChipPrice(cacheTypeId);

    return {
      cacheTypeId,
      displayName: type.displayName,
      description: type.description,
      spriteId: type.spriteId,
      held,
      cashPrice: cash.price,
      depthsPerRestock: cash.depthsRequired,
      depthsUntilRestock: cash.depthsRemaining,
      buyWithCash: availability(planCachePurchase(state, cashPerSecond, cacheTypeId)),
      chipPrice,
      chipOffers: bulkOffers(state.resources.chips, chipPrice, (quantity) =>
        planCacheChipPurchase(state, cacheTypeId, quantity),
      ),
      openable: openableCacheCount(state, cacheTypeId),
      open:
        state.resources.keys < 1
          ? { available: false, reason: "You need a key." }
          : held < 1
            ? { available: false, reason: `You have no ${type.displayName.toLowerCase()}s to open.` }
            : { available: true, reason: null },
    };
  });

  return {
    keysHeld: state.resources.keys,
    keyPrice: keyCost(1),
    keyOffers: bulkOffers(state.resources.cash, keyCost(1), (quantity) =>
      planKeyPurchase(state, quantity),
    ),
    caches,
  };
}

/** Lower sorts first. See the ordering note at the end of `selectRunCommitments`. */
const COMMITMENT_URGENCY: Record<RunCommitmentView["tone"], number> = {
  imposed: 0,
  staked: 1,
  offered: 2,
};

export function selectRunCommitments(
  state: GameState,
  lockedUntil: number | null,
): RunCommitmentView[] {
  const expedition = state.expedition;
  const commitments: RunCommitmentView[] = [];

  const progressFrom = (startedAtDepth: number, targetDepth: number): number => {
    const span = targetDepth - startedAtDepth;

    return span <= 0 ? 1 : Math.min(1, Math.max(0, (expedition.depth - startedAtDepth) / span));
  };

  if (lockedUntil !== null && expedition.activeModifierId !== null) {
    const definition = EXPEDITION_MODIFIERS[expedition.activeModifierId];

    commitments.push({
      key: `modifier:${expedition.activeModifierId}`,
      displayName: definition.displayName,
      detail: "The lift will not answer until you reach this depth.",
      tone: "imposed",
      // Measured from the surface: imposed at launch rather than taken on later.
      startedAtDepth: 0,
      targetDepth: lockedUntil,
      progressRatio: progressFrom(0, lockedUntil),
      depthsRemaining: Math.max(0, lockedUntil - expedition.depth),
    });
  }

  const contract = expedition.activeContract;

  if (contract !== null) {
    const definition = CONTRACTS[contract.contractId];

    commitments.push({
      key: `contract:${contract.contractId}`,
      displayName: definition.displayName,
      detail: "Pays when you reach this depth. Nothing is lost if you turn back.",
      tone: "offered",
      startedAtDepth: contract.startedAtDepth,
      targetDepth: contract.targetDepth,
      progressRatio: progressFrom(contract.startedAtDepth, contract.targetDepth),
      depthsRemaining: Math.max(0, contract.targetDepth - expedition.depth),
    });
  }

  /*
   * The wager last, since it was staked before the run began — and measured from
   * the surface, for the same reason sealed orders are. Only once a run is under
   * way: a wager can sit unlaunched, and without this guard the panel would show
   * progress toward a target on a run that has not started. The gambling panel
   * covers that case with its "Riding on your next run" block.
   */
  const wager = state.gambling.depthWager.pending;

  if (wager !== null && expedition.status !== "surface") {
    commitments.push({
      key: `wager:${wager.wagerId}`,
      displayName: `Depth wager, ${wager.multiplier.toFixed(2)}x`,
      detail: `${String(wager.stake)} chips staked on reaching depth ${String(wager.targetDepth)}. It pays even if the tank runs dry.`,
      tone: "staked",
      startedAtDepth: 0,
      targetDepth: wager.targetDepth,
      progressRatio: progressFrom(0, wager.targetDepth),
      depthsRemaining: Math.max(0, wager.targetDepth - expedition.depth),
    });
  }

  /*
   * Most urgent first, because the panel header shows one commitment and counts
   * the rest. Sorted here rather than in the component so every caller agrees on
   * which one matters. Tone leads, since it says what missing the target costs:
   * an imposed lock holds the exit shut, a staked wager has already taken chips,
   * an offered contract merely declines to pay. Distance and then the key break
   * ties, so the order is total and stable.
   */
  return commitments.sort(
    (first, second) =>
      COMMITMENT_URGENCY[first.tone] - COMMITMENT_URGENCY[second.tone] ||
      first.depthsRemaining - second.depthsRemaining ||
      first.key.localeCompare(second.key),
  );
}

// ---------------------------------------------------------------------------
// The run summary
// ---------------------------------------------------------------------------

export interface RunSummaryItem {
  key: string;
  spriteId: string;
  /** What the sprite is, spelled out. The icon is decoration; this is the name. */
  label: string;
  amount: number;
}

export interface RunSummaryView {
  outcome: "returned" | "failed";
  heading: string;
  /** The Company's comment on the run. Flavour, and never carries a fact. */
  notice: string;
  /** Depth and encounters: not materials, and with no icon to give them. */
  detail: string;
  modifierName: string | null;
  recovered: RunSummaryItem[];
  /** Non-empty only after a failure. */
  lost: RunSummaryItem[];
  /**
   * The whole card as one sentence. The floating reward pops are `aria-hidden`,
   * so this is what a screen reader reads.
   */
  announcement: string;
}

function summaryItems(
  inventory: RunInventory,
  chips: number,
): RunSummaryItem[] {
  const items: RunSummaryItem[] = [];

  // Chips, not ore: ore is an intermediate, converted the moment it is banked.
  if (chips > 0) {
    items.push({
      key: "chips",
      spriteId: RESOURCE_METADATA.chips.spriteId,
      label: RESOURCE_METADATA.chips.displayName,
      amount: chips,
    });
  }

  const simple: Array<
    [keyof RunInventory & ("components" | "relics" | "caches" | "deepCaches"), ResourceId]
  > = [
    ["components", "components"],
    ["relics", "relics"],
    ["caches", "caches"],
    ["deepCaches", "deepCaches"],
  ];

  for (const [field, resourceId] of simple) {
    const amount = inventory[field];

    // Zero-count materials are omitted rather than shown as 0.
    if (amount > 0) {
      items.push({
        key: field,
        spriteId: RESOURCE_METADATA[resourceId].spriteId,
        label: RESOURCE_METADATA[resourceId].displayName,
        amount,
      });
    }
  }

  for (const machineId of Object.keys(MACHINES) as MachineId[]) {
    const amount = inventory.recipePieces[machineId] ?? 0;

    if (amount > 0) {
      items.push({
        key: `recipe:${machineId}`,
        spriteId: MACHINES[machineId].spriteId,
        label: `${MACHINES[machineId].displayName} pieces`,
        amount,
      });
    }
  }

  return items;
}

function listItems(items: readonly RunSummaryItem[]): string {
  return items.map((item) => `${String(item.amount)} ${item.label}`).join(", ");
}

export function selectRunSummaryView(summary: RunSummary): RunSummaryView {
  const recovered = summaryItems(summary.recovered, Math.floor(summary.chipsFromOre));
  const lost =
    summary.lost === null ? [] : summaryItems(summary.lost, Math.floor(summary.chipsLost));

  const heading = summary.outcome === "returned" ? "Extraction complete" : "Oxygen exhausted";
  // The Company's word on the run. A separate field rather than folded into
  // `detail`, which is the factual line the announcement reads out; this is
  // flavour, so the card marks it `aria-hidden`.
  const notice =
    summary.outcome === "returned"
      ? "PAYROLL: ore received and converted at the posted rate."
      : "PAYROLL: a loss report has been filed. Your effort is recorded. Nothing is forgiven.";
  const detail = `Depth ${String(summary.depth)} · ${String(summary.encountersCompleted)} encounters`;

  const brought = recovered.length === 0 ? "nothing" : listItems(recovered);
  const announcement = [
    `${heading}. ${detail}.`,
    summary.modifierName === null ? null : `Under ${summary.modifierName}.`,
    `Brought back ${brought}.`,
    lost.length === 0 ? null : `Lost ${listItems(lost)}.`,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");

  return {
    outcome: summary.outcome,
    heading,
    detail,
    notice,
    modifierName: summary.modifierName,
    recovered,
    lost,
    announcement,
  };
}

// ---------------------------------------------------------------------------
// The stat sheet
// ---------------------------------------------------------------------------

/**
 * Everything currently changing a stat, and what it changes it to.
 * `collectActiveModifiers` gathers every trinket, totem, cat and perk, and
 * `explainStat` records each contribution; this is where the player reads it.
 */
export interface StatSheetContribution {
  key: string;
  /** The trinket, totem or perk, by name. */
  label: string;
  /** Its grade or rank, where it has one. */
  qualifier: string | null;
  /** What it does, signed and in the stat's own terms: "+8s", "x1.12". */
  effect: string;
}

export interface StatSheetRow {
  key: string;
  label: string;
  /** The value before anything modifies it. */
  baseText: string;
  /** The value in play. */
  valueText: string;
  /** True when nothing is modifying this stat, so the row can say so quietly. */
  unchanged: boolean;
  contributions: StatSheetContribution[];
  /** Longer explanation, where the label alone would mislead. */
  detail: string | null;
}

export interface StatSheetGroup {
  title: string;
  rows: StatSheetRow[];
}

export interface StatSheetView {
  groups: StatSheetGroup[];
  /**
   * Set while a run is under way, because several of these were snapshotted at
   * launch and the run is using those rather than what the sheet is showing.
   */
  snapshotNotice: string | null;
}

/**
 * How a stat's numbers should read. `multiplier` and `factor` both render as
 * "xN" and differ only in whether the stat's clamp applies:
 *
 * - `multiplier` — evaluated from a base of 1, so the clamp in `STAT_RULES`
 *   bounds the number shown. Oxygen drain really is floored at 0.2x.
 * - `factor` — the real base varies, so only the factor can honestly be shown
 *   and the clamp belongs to the absolute value. Applying it anyway would render
 *   a 0.7x cycle-time bonus as "x100", since `machine.cycleMs` is floored at 100
 *   milliseconds.
 */
type StatSheetKind = "absolute" | "multiplier" | "factor" | "ratio" | "points";

interface StatSheetRowSpec {
  targetStat: StatId;
  label: string;
  kind: StatSheetKind;
  base: (state: GameState) => number;
  unit?: string;
  detail?: string;
}

function describeContribution(contribution: ModifierContribution, kind: StatSheetKind): string {
  if (contribution.operation === "multiply") {
    // A reduction reads as the percentage it removes rather than the fraction it
    // leaves: reduction multipliers compound, and "x0" looks broken.
    return contribution.value < 1
      ? `-${formatPercent(1 - contribution.value, 1)}`
      : `x${trimNumber(contribution.value)}`;
  }

  const sign = contribution.value >= 0 ? "+" : "";

  return kind === "ratio"
    ? `${sign}${formatPercent(contribution.value, 0)}`
    : `${sign}${trimNumber(contribution.value)}`;
}

function formatStatValue(value: number, kind: StatSheetKind, unit: string): string {
  switch (kind) {
    case "ratio":
      return formatPercent(value, 1);
    case "multiplier":
    case "factor":
      return `x${trimNumber(value)}`;
    case "points":
      return `${formatCompact(value)}${unit}`;
    default:
      return `${trimNumber(value)}${unit}`;
  }
}

/**
 * The rows, in the order they are shown. `expedition.encounterWeight` and
 * `gambling.outcomeWeight` are absent: both are tag-scoped, so a single number
 * for either would be wrong whichever number was chosen.
 */
const STAT_SHEET: ReadonlyArray<{ title: string; rows: StatSheetRowSpec[] }> = [
  {
    title: "Gear",
    rows: [
      {
        targetStat: "gear.tankOxygen",
        label: "Maximum oxygen",
        kind: "absolute",
        unit: "s",
        base: baseMaxOxygen,
      },
      {
        targetStat: "gear.pickaxeDamage",
        label: "Pickaxe damage",
        kind: "absolute",
        unit: "/s",
        base: basePickaxeDamage,
      },
      {
        targetStat: "gear.pickaxeCritChance",
        label: "Critical strike chance",
        kind: "ratio",
        base: () => 0,
        detail: "Each critical strike does double damage.",
      },
    ],
  },
  {
    title: "Expedition",
    rows: [
      {
        targetStat: "expedition.oxygenDrainRate",
        label: "Oxygen drain",
        kind: "multiplier",
        base: () => 1,
        detail: "Below 1x makes a tank last longer.",
      },
      {
        targetStat: "expedition.approachSpeed",
        label: "Approach speed",
        kind: "multiplier",
        base: () => 1,
        detail: "Above 1x shortens the walk between encounters.",
      },
      {
        targetStat: "expedition.rewardQuantity",
        label: "Reward quantity",
        kind: "factor",
        base: () => 1,
      },
      {
        targetStat: "expedition.oreYield",
        label: "Ore yield",
        kind: "factor",
        base: () => 1,
      },
      {
        targetStat: "expedition.failureLossChance",
        label: "Loss on failure",
        kind: "ratio",
        base: () => ECONOMY.failureLossChanceBase,
        detail: "Chance each unbanked unit is lost when the air runs out.",
      },
    ],
  },
  {
    title: "Casino",
    rows: [
      {
        targetStat: "machine.payout",
        label: "Machine payout",
        kind: "factor",
        base: () => 1,
        detail: "Applied to every machine's own payout.",
      },
      {
        targetStat: "machine.cycleMs",
        label: "Machine cycle time",
        kind: "factor",
        base: () => 1,
        detail: "Below 1x means faster cycles.",
      },
      {
        targetStat: "economy.oreChipValue",
        label: "Ore chip value",
        kind: "factor",
        base: () => 1,
        detail: "Applied to every ore grade when a haul is banked.",
      },
    ],
  },
  {
    title: "Prestige",
    rows: [
      {
        targetStat: "prestige.startingCash",
        label: "Starting cash",
        kind: "absolute",
        base: () => ECONOMY.startingCash,
        detail: "Cash in hand at the start of each cycle.",
      },
      {
        targetStat: "prestige.seleniteGain",
        label: "Selenite award",
        kind: "factor",
        base: () => 1,
      },
    ],
  },
];

function buildStatSheetRow(
  spec: StatSheetRowSpec,
  context: DerivedContext,
): StatSheetRow {
  const base = spec.base(context.state);
  const breakdown = explainStat(base, context.modifiers, { targetStat: spec.targetStat });

  // Neither multiplier shape reads the rounded value: flooring a 3.4x multiplier
  // evaluated from a base of 1 would report "3x". A `factor` skips the clamp
  // too, which bounds an absolute value the sheet is not showing.
  const value =
    spec.kind === "multiplier"
      ? breakdown.afterClamp
      : spec.kind === "factor"
        ? breakdown.afterMultiplicative
        : breakdown.finalValue;
  const unit = spec.unit ?? "";

  return {
    key: spec.targetStat,
    label: spec.label,
    baseText: formatStatValue(base, spec.kind, unit),
    valueText: formatStatValue(value, spec.kind, unit),
    unchanged: breakdown.contributions.length === 0,
    contributions: breakdown.contributions.map((contribution, index) => {
      const source = splitModifierSource(contribution.sourceId);

      return {
        key: `${contribution.sourceId}:${String(index)}`,
        label: source.label,
        qualifier: source.qualifier,
        effect: describeContribution(contribution, spec.kind),
      };
    }),
    detail: spec.detail ?? null,
  };
}

export function selectStatSheetView(context: DerivedContext): StatSheetView {
  const { state, luckPoints } = context;

  const groups: StatSheetGroup[] = STAT_SHEET.map((group) => ({
    title: group.title,
    rows: group.rows.map((spec) => buildStatSheetRow(spec, context)),
  }));

  // Luck is its own group because the number that matters is not the stat:
  // points are what modifiers add, but the asymptoting factor is what every
  // weighted draw consumes, and only that says whether more would help.
  const luckBreakdown = explainStat(0, context.modifiers, { targetStat: "luck" });

  groups.push({
    title: "Luck",
    rows: [
      {
        key: "luck",
        label: "Luck points",
        baseText: formatStatValue(0, "points", ""),
        valueText: formatStatValue(luckBreakdown.finalValue, "points", ""),
        unchanged: luckBreakdown.contributions.length === 0,
        contributions: luckBreakdown.contributions.map((contribution, index) => {
          const source = splitModifierSource(contribution.sourceId);

          return {
            key: `${contribution.sourceId}:${String(index)}`,
            label: source.label,
            qualifier: source.qualifier,
            effect: describeContribution(contribution, "points"),
          };
        }),
        detail: null,
      },
      {
        key: "luck.factor",
        label: "Luck effect",
        baseText: formatPercent(luckFactor(0), 1),
        valueText: formatPercent(luckFactor(luckPoints), 1),
        unchanged: luckPoints <= 0,
        contributions: [],
        detail:
          "The diminishing-return curve every weighted draw consumes. Points buy less of it the more you have.",
      },
    ],
  });

  return {
    groups,
    // Several of these are snapshotted at launch, so mid-run the sheet describes
    // the loadout rather than the run. Saying so beats lying or recomputing.
    snapshotNotice:
      state.expedition.status === "surface"
        ? null
        : "A run is under way. It is using the values it was launched with; these are what the next one will start from.",
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface StatEntry {
  label: string;
  value: string;
  /** Longer explanation, where the label alone would mislead. */
  detail?: string;
}

export interface StatGroup {
  title: string;
  entries: StatEntry[];
}

function ownedCount(progress: Record<string, { owned: boolean }>): number {
  return Object.values(progress).filter((entry) => entry.owned).length;
}

/**
 * The stats window, grouped by the system each number came from. Formatting
 * happens here rather than in the component because it depends on the player's
 * number-format setting, and this window is where somebody switches to exact
 * mode.
 */
export function selectStatsView(state: GameState): StatGroup[] {
  const stats = state.statistics;
  const amount = (value: number): string =>
    formatQuantity(value, state.settings.numberFormat);
  // Counts stay exact whatever the setting: "1,203 runs" beats "1.2K runs".
  const tally = (value: number): string => formatExact(value);

  return [
    {
      title: "Expedition",
      entries: [
        { label: "Runs launched", value: tally(stats.runsLaunched) },
        { label: "Returned safely", value: tally(stats.runsReturned) },
        { label: "Lost to the dark", value: tally(stats.runsFailed) },
        { label: "Encounters resolved", value: tally(stats.encountersCompleted) },
        { label: "Critical strikes", value: tally(stats.criticalStrikes) },
        {
          label: "Deepest ever",
          value: tally(stats.deepestDepth),
          detail: "Gates which run modifiers can be drawn.",
        },
        { label: "Deepest this cycle", value: tally(stats.deepestDepthThisCycle) },
        {
          label: "Depths descended",
          value: tally(stats.depthDescended),
          detail: "Every depth stepped, across every run.",
        },
        { label: "Ore banked", value: amount(stats.oreBanked) },
        { label: "Best haul", value: `${amount(stats.bestRunChips)} chips` },
      ],
    },
    {
      title: "Casino",
      entries: [
        { label: "Cash earned", value: amount(stats.cashEarned) },
        { label: "Cash spent", value: amount(stats.cashSpent) },
        { label: "Chips earned", value: amount(stats.chipsEarned) },
        {
          label: "Chips spent",
          value: amount(stats.chipsSpent),
          detail: "Includes everything wagered.",
        },
      ],
    },
    {
      title: "Gambling",
      entries: [
        { label: "Slot spins", value: tally(stats.spinsPlayed) },
        { label: "Roulette spins", value: tally(stats.rouletteSpinsPlayed) },
        { label: "Blackjack hands", value: tally(stats.blackjackHandsPlayed) },
        {
          label: "Depth wagers",
          value: `${tally(stats.depthWagersWon)} / ${tally(stats.depthWagersPlaced)}`,
          detail: "Won against placed.",
        },
        { label: "Chips wagered", value: amount(stats.chipsWagered) },
        { label: "Chips won", value: amount(stats.chipsWon) },
        {
          label: "Net",
          value: amount(stats.chipsWon - stats.chipsWagered),
          detail: "Won minus wagered, across all four games. Negative is the expected outcome.",
        },
      ],
    },
    {
      title: "Collection",
      entries: [
        { label: "Caches opened", value: tally(stats.cachesOpened) },
        // Counted from the collection rather than a running total: "X of N" is a
        // claim about what is owned, and nothing can ever be un-owned, so the
        // collection is the accurate source and needs no migration.
        {
          label: "Trinkets owned",
          value: `${tally(ownedCount(state.collection.trinkets))} / ${tally(TRINKET_IDS.length)}`,
          detail: "Duplicates arrive as fragments and raise the grade instead.",
        },
        {
          label: "Totems owned",
          value: `${tally(ownedCount(state.collection.totems))} / ${tally(TOTEM_IDS.length)}`,
        },
        {
          label: "Cats met",
          value: tally(stats.catsFound),
          detail: "A flat 1 in 1000 per encounter. Each adds luck, permanently.",
        },
      ],
    },
    {
      title: "Lifetime",
      entries: [
        { label: "Prestiges", value: tally(state.prestige.count) },
        { label: "Lifetime cash", value: amount(state.prestige.lifetimeCashEarned) },
        {
          label: "Time played",
          value: formatDuration(stats.playTimeMs),
          detail: "Active time only. Offline production is not counted here.",
        },
      ],
    },
  ];
}

/**
 * What, if anything, a rail button has to say about its window. The rail is
 * icon-only, so without this a reward in a closed window would go unnoticed.
 *
 * `action` means something is waiting to be bought, opened or equipped. `busy`
 * means a hand or bet is live behind a closed window, which can refuse a
 * prestige. They are different claims and are drawn as different shapes.
 */
export type RailMarker = "none" | "action" | "busy";

export function selectRailAttention(context: DerivedContext): Record<WindowId, RailMarker> {
  const { state } = context;
  const gambling = state.gambling;

  const flag = (value: boolean): RailMarker => (value ? "action" : "none");

  // A hand awaiting hit-or-stand is the one gambling state that wants the
  // player, so it earns the stronger marker. A spinning wheel, spinning reels
  // and a riding wager can only be waited on, though each blocks prestige.
  const gamblingMarker: RailMarker =
    gambling.blackjack.hand?.status === "player"
      ? "action"
      : gambling.committedSpin !== null ||
          gambling.roulette.committedBet !== null ||
          gambling.depthWager.pending !== null
        ? "busy"
        : "none";

  const canUpgradeTrinket = selectTrinketViews(state).some(
    (trinket) => trinket.upgrade.available,
  );
  const totems = selectTotemViews(state);
  const prestige = selectPrestigeView(state, [], []);

  const store = selectStoreView(context);

  return {
    settings: "none",
    save: "none",
    store: flag(
      store.caches.some(
        (offer) => offer.buyWithCash.available || offer.open.available,
      ),
    ),
    gambling: gamblingMarker,
    prestige: flag(
      prestige.prestige.available || prestige.perks.some((perk) => perk.purchase.available),
    ),
    gear: flag(canUpgradeTrinket),
    // A wardrobe never waits on the player, and never blocks anything.
    skins: "none",
    // A reference sheet, like the statistics window: it reports, it never waits.
    statSheet: "none",
    // The stats window is a record, not an inbox.
    stats: "none",
    // A jukebox never waits on the player. The unlock is announced once in the
    // log; a marker reports a standing state and would never clear.
    jukebox: "none",
    // A reference sheet, like Statistics and Buffs: it explains, it never waits.
    help: "none",
    totems: flag(
      totems.some((totem) => totem.upgrade.available) ||
        (state.expedition.status === "surface" &&
          state.collection.activeTotemIds.includes(null) &&
          totems.some((totem) => totem.owned && totem.activeSlot === null)),
    ),
  };
}

/**
 * Which music track belongs to the game's current state. Derived rather than
 * stored, so it cannot disagree with where the player is, and derived here
 * rather than in a `useEffect` so the domain states the rule once.
 *
 * Returns null only while a run is launching or extracting, which are
 * transitions rather than places; the engine reads null as "fade out and stop".
 *
 * Unless the jukebox is on, in which case the chosen track plays through
 * everything, since "nothing overwrites the track I picked" is the whole of what
 * it promises. The unlock is re-checked here rather than trusted, because an
 * imported save can arrive with `enabled` true and a depth that never earned it.
 */
export function selectMusicTrackId(state: GameState): MusicTrackId | null {
  const { jukebox } = state.settings;

  if (jukebox.enabled && state.statistics.deepestDepth >= ECONOMY.jukeboxUnlockDepth) {
    return jukebox.trackId;
  }

  const { status, depth } = state.expedition;

  if (status === "surface") {
    return "music.casino";
  }

  if (status === "launching" || status === "extracting" || status === "failed") {
    return null;
  }

  return `music.${bandForDepth(depth).id}`;
}

export interface CatView {
  index: number;
  skinId: CatSkinId;
  displayName: string;
  restSpriteId: string;
  flickSpriteId: string;
}

export interface CatSkinOfferView {
  skinId: CatSkinId;
  displayName: string;
  restSpriteId: string;
  chipCost: number;
  costLabel: string;
  owned: boolean;
  purchase: ActionAvailability;
}

export interface CatBoxView {
  cats: CatView[];
  /** How many skins a click can cycle through. One means clicking does nothing. */
  ownedSkinCount: number;
  offers: CatSkinOfferView[];
}

/**
 * The cat shelf and the skins for sale. The offers live here rather than in the
 * store because they are cosmetic and priced in chips, unlike anything The
 * Company sells.
 */
export function selectCatBoxView(context: DerivedContext): CatBoxView {
  const { state } = context;
  const owned = state.collection.ownedCatSkinIds;

  return {
    cats: state.collection.cats.map((cat, index) => {
      const skin = CAT_SKINS[cat.skinId];

      return {
        index,
        skinId: cat.skinId,
        displayName: skin.displayName,
        restSpriteId: skin.restSpriteId,
        flickSpriteId: skin.flickSpriteId,
      };
    }),
    ownedSkinCount: owned.length,
    offers: CAT_SKIN_IDS.filter((skinId) => CAT_SKINS[skinId].chipCost !== null).map((skinId) => {
      const definition = CAT_SKINS[skinId];
      const chipCost = definition.chipCost ?? 0;
      const isOwned = owned.includes(skinId);

      return {
        skinId,
        displayName: definition.displayName,
        restSpriteId: definition.restSpriteId,
        chipCost,
        costLabel: `${formatQuantity(chipCost, state.settings.numberFormat)} chips`,
        owned: isOwned,
        // Derived from the plan the command will run and the balance the
        // transaction will check, so an enabled button is one the reducer takes.
        purchase: isOwned
          ? { available: false, reason: "Already unlocked." }
          : state.resources.chips < chipCost
            ? {
                available: false,
                reason: `Costs ${formatQuantity(chipCost, state.settings.numberFormat)} chips.`,
              }
            : availability(planCatSkinPurchase(state, skinId)),
      };
    }),
  };
}

export interface MinerSkinOfferView {
  skinId: MinerSkinId;
  displayName: string;
  spriteId: string;
  chipCost: number;
  costLabel: string;
  owned: boolean;
  /** True for the one currently being worn. */
  worn: boolean;
  /** Buying it, for a skin not yet owned. */
  purchase: ActionAvailability;
  /** Wearing it, for one that is. */
  wear: ActionAvailability;
}

export interface SkinsView {
  cats: CatSkinOfferView[];
  miners: MinerSkinOfferView[];
  /** How many cat skins a click can cycle through, for the hint in the panel. */
  ownedCatSkinCount: number;
}

/**
 * Everything the Skins window shows: the cat wardrobe and the miner's. The cat
 * half reuses `selectCatBoxView`'s offers, which the shelf also needs to know
 * what a cat may be cycled into.
 */
export function selectSkinsView(context: DerivedContext): SkinsView {
  const { state } = context;
  const owned = state.collection.ownedMinerSkinIds;
  const active = state.collection.activeMinerSkinId;

  return {
    cats: selectCatBoxView(context).offers,
    ownedCatSkinCount: state.collection.ownedCatSkinIds.length,
    miners: MINER_SKIN_IDS.map((skinId) => {
      const definition = MINER_SKINS[skinId];
      const chipCost = definition.chipCost ?? 0;
      const isOwned = owned.includes(skinId);
      const isWorn = skinId === active;

      return {
        skinId,
        displayName: definition.displayName,
        spriteId: definition.spriteId,
        chipCost,
        costLabel:
          definition.chipCost === null
            ? "Free"
            : `${formatQuantity(chipCost, state.settings.numberFormat)} chips`,
        owned: isOwned,
        worn: isWorn,
        // Priced against the balance the transaction checks, so an enabled
        // button is one the reducer will accept.
        purchase: isOwned
          ? { available: false, reason: "Already unlocked." }
          : state.resources.chips < chipCost
            ? {
                available: false,
                reason: `Costs ${formatQuantity(chipCost, state.settings.numberFormat)} chips.`,
              }
            : availability(planMinerSkinPurchase(state, skinId)),
        wear: isWorn
          ? { available: false, reason: "Already worn." }
          : availability(planMinerSkinChange(state, skinId)),
      };
    }),
  };
}

export interface ConsumableOfferView {
  id: ConsumableId;
  displayName: string;
  description: string;
  effectSummary: string;
  spriteId: string;
  chipCost: number;
  costLabel: string;
  held: boolean;
  purchase: ActionAvailability;
}

export interface HeldConsumableView {
  id: ConsumableId;
  displayName: string;
  effectSummary: string;
  spriteId: string;
}

/** The six tiles in the store. */
export function selectConsumableOffers(context: DerivedContext): ConsumableOfferView[] {
  const { state } = context;

  return CONSUMABLE_IDS.map((id) => {
    const definition = CONSUMABLES[id];
    const held = state.heldConsumableIds.includes(id);
    const plan = planConsumablePurchase(state, id);

    return {
      id,
      displayName: definition.displayName,
      description: definition.description,
      effectSummary: definition.effectSummary,
      spriteId: definition.spriteId,
      chipCost: definition.chipCost,
      costLabel: `${formatQuantity(definition.chipCost, state.settings.numberFormat)} chips`,
      held,
      // The plan is asked first, so its refusals come back in the reducer's own
      // wording. Only the chip check is added here, since the transaction rather
      // than the plan refuses an unaffordable purchase.
      purchase: !plan.ok
        ? availability(plan)
        : state.resources.chips < definition.chipCost
          ? {
              available: false,
              reason: `Costs ${formatQuantity(definition.chipCost, state.settings.numberFormat)} chips.`,
            }
          : { available: true, reason: null },
    };
  });
}

/**
 * What is packed for the next run, shown above the Launch button so a consumable
 * bought and forgotten still reaches the decision it was meant to affect.
 */
export function selectHeldConsumables(context: DerivedContext): HeldConsumableView[] {
  return CONSUMABLE_IDS.filter((id) => context.state.heldConsumableIds.includes(id)).map((id) => ({
    id,
    displayName: CONSUMABLES[id].displayName,
    effectSummary: CONSUMABLES[id].effectSummary,
    spriteId: CONSUMABLES[id].spriteId,
  }));
}
