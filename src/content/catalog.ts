/** The single aggregated view of static game content. */

import {
  ECONOMY,
  ORE_GRADES,
  ORE_GRADE_IDS,
  RESOURCE_IDS,
  RESOURCE_METADATA,
  STAT_RULES,
} from "./economy";
import { ENCOUNTERS, ENCOUNTER_IDS, REWARD_TABLES, REWARD_TABLE_IDS } from "./encounters";
import { GEAR, GEAR_IDS } from "./gear";
import { CONTRACTS } from "./contracts";
import { MACHINES, MACHINE_IDS, RESEARCH_NODES, SPECS, STARTER_MACHINE_ID } from "./machines";
import { PERK_BRANCHES, PRESTIGE_PERKS, PRESTIGE_PERK_IDS } from "./prestigePerks";
import { SLOT_SYMBOLS, SLOT_SYMBOL_IDS, SLOT_WAGERS } from "./slotGame";
import { CHIP_GAME_IDS, CHIP_WAGERS } from "./chipGames";
import { ROULETTE_BETS, ROULETTE_BET_IDS, ROULETTE_POCKET_COUNT } from "./roulette";
import {
  BLACKJACK_LUCK_SHAPE,
  BLACKJACK_MEASURED_RETURN,
  BLACKJACK_RANKS,
  BLACKJACK_SHOE_SIZE,
} from "./blackjack";
import { DEPTH_BANDS, DEPTH_BAND_IDS } from "./depthBands";
import { EXPEDITION_MODIFIERS, EXPEDITION_MODIFIER_IDS } from "./expeditionModifiers";
import { HELP_TOPICS, HELP_TOPIC_IDS } from "./help";
import { GRADE_IDS, GRADE_SCALARS } from "./grades";
import {
  CACHE_TYPES,
  CACHE_TYPE_IDS,
  DEEP_CACHE_TYPE_ID,
  STANDARD_CACHE_TYPE_ID,
  isCacheTypeId,
} from "./caches";
import type { TotemId as TotemIdValue } from "./totems";
import { TOTEMS, TOTEM_IDS } from "./totems";
import type { TrinketId as TrinketIdValue } from "./trinkets";
import { TRINKETS, TRINKET_IDS } from "./trinkets";

export type {
  EconomyConstants,
  Modifier,
  ModifierOperation,
  OreGradeId,
  ResourceId,
  StatId,
} from "./economy";
export type {
  EncounterChoiceDefinition,
  EncounterDefinition,
  EncounterFamily,
  EncounterId,
  EncounterResolutionMode,
  RewardGrant,
  RewardTableDefinition,
  RewardTableEntry,
  RewardTableId,
} from "./encounters";
export type { GearDefinition, GearId, GearLevelDefinition } from "./gear";
export type {
  MachineDefinition,
  MachineId,
  MachineLevelDefinition,
  ResearchNodeDefinition,
  ResearchNodeId,
  SpecDefinition,
  SpecId,
} from "./machines";
export type {
  PerkBranchDefinition,
  PerkBranchId,
  PrestigePerkDefinition,
  PrestigePerkId,
} from "./prestigePerks";
export type { SlotSymbolDefinition, SlotSymbolId } from "./slotGame";
export type { ChipGameId } from "./chipGames";
export type { RouletteBetDefinition, RouletteBetId, RouletteColour } from "./roulette";
export type { DepthBandDefinition, DepthBandId } from "./depthBands";
export type {
  ExpeditionModifierDefinition,
  ExpeditionModifierId,
} from "./expeditionModifiers";
export type { GradeId } from "./grades";
export type { TotemDefinition, TotemId } from "./totems";
export type { TrinketDefinition, TrinketId } from "./trinkets";

/** Bumped whenever content IDs are added, removed, or renamed. */
export const CONTENT_VERSION = "0.1.0";

/**
 * The ordinary cache's table, kept under its old name.
 *
 * It is `CACHE_TYPES["cache.standard"].rewards` now. The alias stays because the
 * mid-run rock find draws from it — a collectible found in the ground is not a
 * cache of any kind, and giving it the ordinary odds is the closest true answer.
 */
export const CACHE_REWARDS = CACHE_TYPES[STANDARD_CACHE_TYPE_ID].rewards;

export const CATALOG = {
  contentVersion: CONTENT_VERSION,
  economy: ECONOMY,
  statRules: STAT_RULES,
  contracts: CONTRACTS,
  resourceIds: RESOURCE_IDS,
  resourceMetadata: RESOURCE_METADATA,
  oreGradeIds: ORE_GRADE_IDS,
  oreGrades: ORE_GRADES,
  machineIds: MACHINE_IDS,
  machines: MACHINES,
  researchNodes: RESEARCH_NODES,
  specs: SPECS,
  starterMachineId: STARTER_MACHINE_ID,
  encounterIds: ENCOUNTER_IDS,
  encounters: ENCOUNTERS,
  rewardTableIds: REWARD_TABLE_IDS,
  rewardTables: REWARD_TABLES,
  gearIds: GEAR_IDS,
  gear: GEAR,
  trinketIds: TRINKET_IDS,
  trinkets: TRINKETS,
  totemIds: TOTEM_IDS,
  totems: TOTEMS,
  prestigePerkIds: PRESTIGE_PERK_IDS,
  prestigePerks: PRESTIGE_PERKS,
  perkBranches: PERK_BRANCHES,
  slotSymbolIds: SLOT_SYMBOL_IDS,
  slotSymbols: SLOT_SYMBOLS,
  slotWagers: SLOT_WAGERS,
  chipGameIds: CHIP_GAME_IDS,
  chipWagers: CHIP_WAGERS,
  rouletteBetIds: ROULETTE_BET_IDS,
  rouletteBets: ROULETTE_BETS,
  roulettePocketCount: ROULETTE_POCKET_COUNT,
  blackjackRanks: BLACKJACK_RANKS,
  blackjackLuckShape: BLACKJACK_LUCK_SHAPE,
  blackjackMeasuredReturn: BLACKJACK_MEASURED_RETURN,
  blackjackShoeSize: BLACKJACK_SHOE_SIZE,
  cacheRewards: CACHE_REWARDS,
  cacheTypeIds: CACHE_TYPE_IDS,
  cacheTypes: CACHE_TYPES,
  gradeIds: GRADE_IDS,
  gradeScalars: GRADE_SCALARS,
  depthBandIds: DEPTH_BAND_IDS,
  depthBands: DEPTH_BANDS,
  expeditionModifierIds: EXPEDITION_MODIFIER_IDS,
  expeditionModifiers: EXPEDITION_MODIFIERS,
  helpTopicIds: HELP_TOPIC_IDS,
  helpTopics: HELP_TOPICS,
} as const;

export type ContentCatalog = typeof CATALOG;

export {
  ECONOMY,
  ORE_GRADES,
  ORE_GRADE_IDS,
  RESOURCE_IDS,
  RESOURCE_METADATA,
  STAT_RULES,
} from "./economy";
export {
  CAT_ENCOUNTER_ID,
  ENCOUNTERS,
  ENCOUNTER_FAMILIES,
  ENCOUNTER_FAMILY_LABELS,
  ENCOUNTER_IDS,
  FIRST_ENCOUNTER_ID,
  REWARD_TABLES,
} from "./encounters";
export { GEAR, GEAR_IDS } from "./gear";
export {
  MACHINES,
  MACHINE_IDS,
  RESEARCH_NODES,
  SPECS,
  STARTER_MACHINE_ID,
  machineMerit,
  overclockNodeFor,
} from "./machines";
export {
  PERK_BRANCHES,
  PERK_BRANCH_IDS,
  PRESTIGE_PERKS,
  PRESTIGE_PERK_IDS,
  isPrestigePerkId,
  perkRankCost,
} from "./prestigePerks";
export {
  CHIP_GAME_IDS,
  CHIP_GAME_NAMES,
  CHIP_WAGERS,
  DEFAULT_CHIP_WAGER,
  isChipWager,
  isStakeable,
} from "./chipGames";
export {
  ROULETTE_BETS,
  ROULETTE_BET_IDS,
  ROULETTE_LUCK_POCKET_BIAS,
  ROULETTE_POCKET_COUNT,
  ROULETTE_RED_POCKETS,
  ROULETTE_SPIN_DURATION_MS,
  isRouletteBetId,
  isRoulettePocket,
  pocketColour,
  winningPockets,
} from "./roulette";
export {
  BLACKJACK_BASE_RETURN,
  BLACKJACK_DECKS,
  BLACKJACK_LUCK_BIAS,
  BLACKJACK_LUCK_SHAPE,
  BLACKJACK_MEASURED_RETURN,
  BLACKJACK_RANKS,
  BLACKJACK_RANK_NAMES,
  BLACKJACK_RANK_WEIGHT,
  BLACKJACK_SHOE_SIZE,
  cardValue,
} from "./blackjack";
export {
  SLOT_DEFAULT_WAGER,
  SLOT_REEL_COUNT,
  SLOT_SPIN_DURATION_MS,
  SLOT_SYMBOLS,
  SLOT_SYMBOL_IDS,
  SLOT_WAGERS,
} from "./slotGame";
export {
  EXPEDITION_MODIFIERS,
  EXPEDITION_MODIFIER_IDS,
  isExpeditionModifierId,
} from "./expeditionModifiers";
export { BACKDROPS, BACKDROP_CROSSFADE_DEPTHS } from "./backdrops";
export { CONTRACTS, CONTRACT_IDS, isContractId } from "./contracts";
export type { ContractDefinition, ContractId } from "./contracts";
export type { BackdropDefinition, BackdropLayer } from "./backdrops";
export {
  DEPTH_BANDS,
  DEPTH_BAND_IDS,
  bandForDepth,
  bandsFrom,
  isDepthBandId,
} from "./depthBands";
export {
  GRADE_IDS,
  GRADE_SCALARS,
  HIGHEST_GRADE,
  LOWEST_GRADE,
  gradeIndex,
  gradeScalar,
  isGradeId,
  nextGrade,
  scaleModifiers,
} from "./grades";
export {
  CACHE_TYPES,
  CACHE_TYPE_IDS,
  DEEP_CACHE_TYPE_ID,
  STANDARD_CACHE_TYPE_ID,
  isCacheTypeId,
} from "./caches";
export type { CacheReward, CacheRewardEntry, CacheTypeDefinition, CacheTypeId } from "./caches";
export { TOTEMS, TOTEM_IDS, TOTEM_FORBIDDEN_STATS } from "./totems";
export { TRINKETS, TRINKET_IDS } from "./trinkets";
