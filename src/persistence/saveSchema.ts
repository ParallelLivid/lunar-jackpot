/**
 * The versioned save envelope, its checksum, and defensive normalization.
 *
 * Loading never trusts stored data. Every field is rebuilt against the current
 * content catalog, and anything unrecognized falls back to a documented default
 * rather than corrupting the run.
 */

import { STAT_IDS } from "../content/economy";
import { INFINITE } from "../domain/numbers";
import { ENCOUNTERS } from "../content/encounters";
import { isExpeditionModifierId } from "../content/expeditionModifiers";
import { isContractId } from "../content/contracts";
import { DEFAULT_CAT_SKIN_IDS, isCatSkinId } from "../content/catSkins";
import { DEFAULT_MINER_SKIN_ID, isMinerSkinId } from "../content/minerSkins";
import { isConsumableId } from "../content/consumables";
import { isMusicTrackId } from "../content/music";
import { TUTORIAL_ACT_IDS, isTutorialGateId } from "../content/tutorial";
import { reconcileCats } from "../domain/cats";
import { LOWEST_GRADE, isGradeId } from "../content/grades";
import { evaluateMachineLevel } from "../content/machines";
import {
  CONTENT_VERSION,
  ECONOMY,
  GEAR,
  MACHINES,
  ORE_GRADES,
  ORE_GRADE_IDS,
  PRESTIGE_PERKS,
  RESEARCH_NODES,
  RESOURCE_IDS,
  SLOT_SYMBOL_IDS,
  SLOT_WAGERS,
  SPECS,
  STARTER_MACHINE_ID,
  TOTEM_IDS,
  TRINKETS,
  TRINKET_IDS,
} from "../content/catalog";
import type {
  EncounterId,
  MachineId,
  Modifier,
  OreGradeId,
  PrestigePerkId,
  ResearchNodeId,
  ResourceId,
  SlotSymbolId,
  SpecId,
  TotemId,
  TrinketId,
} from "../content/catalog";
import { isRngState, type RngState, type RunRngStreams } from "../domain/rng";
import { isChipStake, type ChipStake } from "../content/chipGames";
import {
  BLACKJACK_RANKS,
  BLACKJACK_SHOE_SIZE,
} from "../content/blackjack";
import { isRouletteBetId, isRoulettePocket } from "../content/roulette";
import type { CatRecord, RunContract } from "../domain/state";
import {
  createFreshGamblingState,
  createEmptyRecipePieces,
  createEmptyResourceBalances,
  createEmptyRunInventory,
  createFreshCollectionState,
  createFreshMachineProgress,
  createFreshSettingsState,
  createFreshStatisticsState,
  createFreshTutorialState,
  createGameState,
  createSurfaceExpeditionState,
  normalizeCasinoName,
} from "../domain/state";
import type {
  ActiveEncounter,
  CommittedReward,
  ExpeditionStatus,
  FailureResult,
  GameState,
  MachineProgress,
  ResolvedGrant,
  RunInventory,
  RunModifierSnapshot,
  SpinSummary,
  BlackjackHand,
  BlackjackOutcome,
  BlackjackSummary,
  CommittedRouletteBet,
  DepthWager,
  DepthWagerSummary,
  GamblingState,
  RouletteSummary,
} from "../domain/state";

export const SAVE_VERSION = 16;

export interface SaveEnvelope {
  saveVersion: number;
  contentVersion: string;
  revision: number;
  savedAtUnixMs: number;
  checksum: string;
  game: GameState;
}

/**
 * How `Infinity` is written down. IndexedDB structured-clones it, but
 * `JSON.stringify(Infinity)` is `null` and indistinguishable from a missing
 * field — so without a sentinel, exporting a finished save and importing it back
 * would reset every infinite balance to zero. A string, so it can never be
 * mistaken for a value.
 */
export const INFINITY_SENTINEL = "__Infinity__";

/**
 * Replaces non-finite numbers on the way into JSON. Shared by the checksum and
 * the export, necessarily: the checksum is verified by re-stringifying the
 * parsed record, so two different rules would make an exported infinite save
 * fail its own checksum on import.
 */
export function saveJsonReplacer(_key: string, value: unknown): unknown {
  return value === Number.POSITIVE_INFINITY ? INFINITY_SENTINEL : value;
}

/** FNV-1a over the canonical JSON body. Corruption detection, not security. */
export function checksumOf(envelope: Omit<SaveEnvelope, "checksum">): string {
  const text = JSON.stringify(
    {
      saveVersion: envelope.saveVersion,
      contentVersion: envelope.contentVersion,
      revision: envelope.revision,
      savedAtUnixMs: envelope.savedAtUnixMs,
      game: envelope.game,
    },
    saveJsonReplacer,
  );

  let hash = 2_166_136_261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createEnvelope(
  game: GameState,
  revision: number,
  savedAtUnixMs: number,
): SaveEnvelope {
  const body = {
    saveVersion: SAVE_VERSION,
    contentVersion: CONTENT_VERSION,
    revision,
    savedAtUnixMs,
    game,
  };

  return { ...body, checksum: checksumOf(body) };
}

// ---------------------------------------------------------------------------
// Normalization primitives
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quantity(value: unknown, fallback = 0): number {
  // A balance that rolled over, arriving either as a live `Infinity` (IndexedDB
  // keeps it) or as the sentinel it becomes in an exported file.
  if (value === INFINITE || value === INFINITY_SENTINEL) {
    return INFINITE;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  // A stored value at or past the ceiling rolls over here too: the ceiling is
  // where counting stops, not a number a balance may sit on.
  if (value >= ECONOMY.safeMaximum) {
    return INFINITE;
  }

  return Math.max(0, Math.floor(value));
}

function decimal(value: unknown, fallback = 0, minimum = 0, maximum = Number.MAX_VALUE): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function rngOr(value: unknown, fallback: RngState): RngState {
  return isRngState(value) ? value : fallback;
}

export interface NormalizationReport {
  /** Human-readable notes about anything that was repaired or dropped. */
  repairs: string[];
}

function normalizeSlotTrinketId(
  value: unknown,
  report: NormalizationReport,
): TrinketId | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string" || !(TRINKET_IDS as readonly string[]).includes(value)) {
    report.repairs.push(`Dropped an equipped trinket with unknown id "${String(value)}".`);

    return null;
  }

  return value as TrinketId;
}

function normalizeRunInventory(value: unknown): RunInventory {
  const inventory = createEmptyRunInventory();

  if (!isRecord(value)) {
    return inventory;
  }

  const ore = isRecord(value.ore) ? value.ore : {};

  for (const grade of ORE_GRADE_IDS) {
    inventory.ore[grade as OreGradeId] = quantity(ore[grade]);
  }

  inventory.components = quantity(value.components);
  inventory.relics = quantity(value.relics);
  inventory.caches = quantity(value.caches);
  inventory.deepCaches = quantity(value.deepCaches);

  const pieces = isRecord(value.recipePieces) ? value.recipePieces : {};

  for (const machineId of Object.keys(MACHINES) as MachineId[]) {
    inventory.recipePieces[machineId] = quantity(pieces[machineId]);
  }

  return inventory;
}

function normalizeModifierSnapshot(value: unknown): RunModifierSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.modifiers)) {
    return null;
  }

  const modifiers = value.modifiers.filter(
    (entry): entry is Modifier =>
      isRecord(entry) &&
      typeof entry.sourceId === "string" &&
      typeof entry.targetStat === "string" &&
      (STAT_IDS as readonly string[]).includes(entry.targetStat) &&
      (entry.operation === "add" || entry.operation === "multiply") &&
      typeof entry.value === "number" &&
      Number.isFinite(entry.value),
  );

  const storedOre = isRecord(value.oreChipValues) ? value.oreChipValues : {};
  const oreChipValues = ORE_GRADE_IDS.reduce(
    (values, grade) => {
      values[grade as OreGradeId] = quantity(storedOre[grade], ORE_GRADES[grade].chipValue);

      return values;
    },
    {} as Record<OreGradeId, number>,
  );

  return {
    modifiers,
    // Defaulted rather than recomputed: a run's snapshot is fixed at launch, and
    // a save written before these existed should keep behaving as it did.
    oxygenDrainRate: decimal(value.oxygenDrainRate, 1, 0.2),
    approachSpeed: decimal(value.approachSpeed, 1, 0.25),
    resolvesChoices: value.resolvesChoices === true,
    forecastsEncounters: value.forecastsEncounters === true,
    pickaxeCritChance: decimal(value.pickaxeCritChance, 0, 0),
    luckPoints: decimal(value.luckPoints, 0, 0),
    failureLossChance: decimal(
      value.failureLossChance,
      ECONOMY.failureLossChanceBase,
      ECONOMY.failureLossChanceMinimum,
      ECONOMY.failureLossChanceMaximum,
    ),
    oreChipValues,
  };
}

function normalizeCommittedReward(value: unknown): CommittedReward | null {
  if (!isRecord(value) || !Array.isArray(value.grants)) {
    return null;
  }

  const grants = value.grants.filter((grant): grant is ResolvedGrant => {
    if (!isRecord(grant) || typeof grant.amount !== "number" || !Number.isFinite(grant.amount)) {
      return false;
    }

    switch (grant.kind) {
      case "ore":
        return typeof grant.grade === "string" && (ORE_GRADE_IDS as readonly string[]).includes(grant.grade);
      case "recipePiece":
        return typeof grant.machineId === "string" && grant.machineId in MACHINES;
      case "oxygen":
      case "components":
      case "relics":
      case "caches":
        return true;
      default:
        return false;
    }
  });

  return {
    tableId: typeof value.tableId === "string" ? value.tableId : "",
    entryId: typeof value.entryId === "string" ? value.entryId : "",
    tags: stringArray(value.tags),
    grants,
  };
}

function normalizeContract(value: unknown): RunContract | null {
  if (!isRecord(value) || !isContractId(value.contractId)) {
    return null;
  }

  const startedAtDepth = quantity(value.startedAtDepth);

  return {
    contractId: value.contractId,
    startedAtDepth,
    // Never behind where it was taken: a target already passed would pay on the
    // next descent for a goal that was never met.
    targetDepth: Math.max(startedAtDepth, quantity(value.targetDepth)),
    reward: normalizeCommittedReward(value.reward),
  };
}

// ---------------------------------------------------------------------------
// The chip games
// ---------------------------------------------------------------------------

/*
 * Every committed bet is restored rather than regenerated: a bet in the save has
 * already been paid for and decided, so a reload settles it. Redrawing would
 * turn a reload into a reroll — worst in blackjack, where a player could reload
 * before each hit until the card was good.
 */

/**
 * A stored stake selection, repaired to something the games will accept.
 * `isChipStake` admits the `"all"` mode as well as the rungs; anything else
 * falls back to the fresh default.
 */
function chipWager(value: unknown, fallback: ChipStake): ChipStake {
  return isChipStake(value) ? value : fallback;
}

function normalizeRoulette(
  value: unknown,
  report: NormalizationReport,
): GamblingState["roulette"] {
  const fresh = createFreshGamblingState().roulette;
  const raw = isRecord(value) ? value : {};
  const rawBet = isRecord(raw.committedBet) ? raw.committedBet : null;

  const committedBet: CommittedRouletteBet | null =
    rawBet !== null &&
    typeof rawBet.betId === "string" &&
    isRouletteBetId(rawBet.betTypeId) &&
    isRoulettePocket(rawBet.pocket)
      ? {
          betId: rawBet.betId,
          gameId: "game.roulette",
          betTypeId: rawBet.betTypeId,
          straightNumber: isRoulettePocket(rawBet.straightNumber) ? rawBet.straightNumber : 0,
          wager: quantity(rawBet.wager),
          pocket: rawBet.pocket,
          multiplier: decimal(rawBet.multiplier, 0, 0),
          payout: quantity(rawBet.payout),
          luckPoints: decimal(rawBet.luckPoints, 0, 0),
          animationRemainingMs: decimal(rawBet.animationRemainingMs, 0, 0),
        }
      : null;

  if (rawBet !== null && committedBet === null) {
    report.repairs.push("Discarded an unreadable roulette bet.");
  }

  return {
    selectedBetTypeId: isRouletteBetId(raw.selectedBetTypeId)
      ? raw.selectedBetTypeId
      : fresh.selectedBetTypeId,
    selectedNumber: isRoulettePocket(raw.selectedNumber) ? raw.selectedNumber : 0,
    selectedWager: chipWager(raw.selectedWager, fresh.selectedWager),
    committedBet,
    recentResults: (Array.isArray(raw.recentResults) ? raw.recentResults : [])
      .filter(
        (entry): entry is RouletteSummary => isRecord(entry) && typeof entry.betId === "string",
      )
      .slice(0, ECONOMY.recentSpinHistoryLength),
  };
}

const BLACKJACK_OUTCOMES: readonly BlackjackOutcome[] = [
  "player-blackjack",
  "player",
  "dealer",
  "push",
];

function cardArray(value: unknown): number[] {
  return (Array.isArray(value) ? value : [])
    .filter((rank): rank is number => typeof rank === "number")
    .map((rank) => Math.trunc(rank))
    .filter((rank) => (BLACKJACK_RANKS as readonly number[]).includes(rank));
}

function normalizeBlackjack(
  value: unknown,
  report: NormalizationReport,
): GamblingState["blackjack"] {
  const fresh = createFreshGamblingState().blackjack;
  const raw = isRecord(value) ? value : {};
  const rawHand = isRecord(raw.hand) ? raw.hand : null;

  let hand: BlackjackHand | null = null;

  if (rawHand !== null && typeof rawHand.betId === "string") {
    const shoe = cardArray(rawHand.shoe);
    const playerCards = cardArray(rawHand.playerCards);
    const dealerCards = cardArray(rawHand.dealerCards);
    const status = rawHand.status === "settled" ? "settled" : "player";

    // A live hand needs a shoe long enough to finish itself: a truncated one
    // would deal off the end of the array, a silent gift rather than a failure.
    const usable =
      shoe.length >= BLACKJACK_SHOE_SIZE && playerCards.length >= 2 && dealerCards.length >= 2;

    if (usable) {
      hand = {
        betId: rawHand.betId,
        gameId: "game.blackjack",
        wager: quantity(rawHand.wager),
        payout: quantity(rawHand.payout),
        luckPoints: decimal(rawHand.luckPoints, 0, 0),
        animationRemainingMs: 0,
        shoe,
        // Never behind the cards already on the table: a lower cursor would deal
        // the player a card they are already holding.
        cursor: Math.min(
          shoe.length,
          Math.max(playerCards.length + dealerCards.length, quantity(rawHand.cursor)),
        ),
        playerCards,
        dealerCards,
        doubled: rawHand.doubled === true,
        status,
        outcome: BLACKJACK_OUTCOMES.includes(rawHand.outcome as BlackjackOutcome)
          ? (rawHand.outcome as BlackjackOutcome)
          : null,
      };
    } else {
      report.repairs.push("Discarded an unreadable blackjack hand.");
    }
  }

  return {
    selectedWager: chipWager(raw.selectedWager, fresh.selectedWager),
    hand,
    recentResults: (Array.isArray(raw.recentResults) ? raw.recentResults : [])
      .filter(
        (entry): entry is BlackjackSummary => isRecord(entry) && typeof entry.betId === "string",
      )
      .slice(0, ECONOMY.recentSpinHistoryLength),
  };
}

function normalizeDepthWager(
  value: unknown,
  report: NormalizationReport,
): GamblingState["depthWager"] {
  const fresh = createFreshGamblingState().depthWager;
  const raw = isRecord(value) ? value : {};
  const rawPending = isRecord(raw.pending) ? raw.pending : null;

  // Restored exactly as committed, never re-derived: the all-time best it was
  // priced against moves during the very run being bet on.
  const pending: DepthWager | null =
    rawPending !== null &&
    typeof rawPending.wagerId === "string" &&
    quantity(rawPending.targetDepth) > 0
      ? {
          wagerId: rawPending.wagerId,
          stake: quantity(rawPending.stake),
          targetDepth: quantity(rawPending.targetDepth),
          multiplier: decimal(rawPending.multiplier, 1, 0, ECONOMY.depthWagerMaximumMultiplier),
          bestDepthAtPlacement: quantity(rawPending.bestDepthAtPlacement),
          luckPoints: decimal(rawPending.luckPoints, 0, 0),
        }
      : null;

  if (rawPending !== null && pending === null) {
    report.repairs.push("Discarded an unreadable depth wager.");
  }

  return {
    selectedTargetDepth: quantity(raw.selectedTargetDepth),
    selectedStake: chipWager(raw.selectedStake, fresh.selectedStake),
    pending,
    recentResults: (Array.isArray(raw.recentResults) ? raw.recentResults : [])
      .filter(
        (entry): entry is DepthWagerSummary =>
          isRecord(entry) && typeof entry.wagerId === "string",
      )
      .slice(0, ECONOMY.recentSpinHistoryLength),
  };
}

function normalizeActiveEncounter(
  value: unknown,
  report: NormalizationReport,
): ActiveEncounter | null {
  if (!isRecord(value)) {
    return null;
  }

  const encounterId = value.encounterId;

  if (typeof encounterId !== "string" || !(encounterId in ENCOUNTERS)) {
    report.repairs.push(`Dropped an in-progress encounter with unknown id "${String(encounterId)}".`);

    return null;
  }

  const definition = ENCOUNTERS[encounterId as EncounterId];
  const chosenOptionId =
    typeof value.chosenOptionId === "string" &&
    definition.choiceOptions?.some((option) => option.id === value.chosenOptionId)
      ? value.chosenOptionId
      : null;

  return {
    encounterId: encounterId as EncounterId,
    approachElapsedMs: decimal(value.approachElapsedMs, 0, 0),
    approachDurationMs: decimal(value.approachDurationMs, definition.approachDurationMs, 1),
    resolveElapsedMs: decimal(value.resolveElapsedMs, 0, 0),
    strikesTaken: quantity(value.strikesTaken),
    resolveDurationMs:
      typeof value.resolveDurationMs === "number" && Number.isFinite(value.resolveDurationMs)
        ? Math.max(0, value.resolveDurationMs)
        : null,
    durabilityRemaining:
      typeof value.durabilityRemaining === "number" && Number.isFinite(value.durabilityRemaining)
        ? Math.max(0, value.durabilityRemaining)
        : null,
    oxygenDrainMultiplier: decimal(
      value.oxygenDrainMultiplier,
      definition.oxygenDrainMultiplier,
      0.0001,
    ),
    chosenOptionId,
    committedReward: normalizeCommittedReward(value.committedReward),
  };
}

function normalizeFailureResult(value: unknown): FailureResult | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    recovered: normalizeRunInventory(value.recovered),
    lost: normalizeRunInventory(value.lost),
    banked: boolean(value.banked),
  };
}

const EXPEDITION_STATUSES: ExpeditionStatus[] = [
  "surface",
  "launching",
  "approaching",
  "decision",
  "choice",
  "resolving",
  "reward",
  "extracting",
  "failed",
];

/**
 * Rebuilds a `GameState` from unknown stored data.
 *
 * Anything missing or unrecognized is replaced from a fresh state, so a partial
 * or content-drifted save still loads into a playable game.
 */
export interface NormalizeOptions {
  /**
   * When the envelope's save timestamp is known, it bounds the settlement stamp
   * and lets a stale one be recognised and repaired.
   */
  savedAtUnixMs?: number;
}

/**
 * Repairs the offline settlement stamp, which can never sit after the moment the
 * save was written. One far before it can only come from a build that failed to
 * advance it while playing, so the next load would re-credit the whole session
 * as offline income; those snap forward to the save time, at a cost of at most
 * one autosave interval of genuinely offline production.
 */
function repairSettlementStamp(stored: number, savedAtUnixMs: number | undefined): number {
  if (savedAtUnixMs === undefined || !Number.isFinite(savedAtUnixMs)) {
    return stored;
  }

  if (stored > savedAtUnixMs) {
    return savedAtUnixMs;
  }

  return savedAtUnixMs - stored > 2 * ECONOMY.autosaveIntervalMs ? savedAtUnixMs : stored;
}

export function normalizeGameState(
  raw: unknown,
  nowUnixMs: number,
  options: NormalizeOptions = {},
): { state: GameState; report: NormalizationReport } {
  const report: NormalizationReport = { repairs: [] };
  const fresh = createGameState({ nowUnixMs });

  if (!isRecord(raw)) {
    report.repairs.push("Saved game data was not an object; started a fresh game.");

    return { state: fresh, report };
  }

  // Resources.
  const resources = createEmptyResourceBalances();
  const rawResources = isRecord(raw.resources) ? raw.resources : {};

  for (const id of RESOURCE_IDS) {
    resources[id as ResourceId] = quantity(rawResources[id]);
  }

  // Casino.
  const rawCasino = isRecord(raw.casino) ? raw.casino : {};
  const rawMachines = isRecord(rawCasino.machines) ? rawCasino.machines : {};
  const machines = {} as Record<MachineId, MachineProgress>;

  for (const machineId of Object.keys(MACHINES) as MachineId[]) {
    const definition = MACHINES[machineId];
    const stored = isRecord(rawMachines[machineId]) ? rawMachines[machineId] : {};
    // Levels are uncapped, so there is no ceiling to clamp against — only a
    // floor, and whatever the level curve can still represent.
    const storedLevel = Math.max(1, quantity(stored.level, 1));
    const level = evaluateMachineLevel(definition, storedLevel) === null ? 1 : storedLevel;

    if (level !== storedLevel) {
      report.repairs.push(`Reset machine "${machineId}" to level 1; ${storedLevel} is not representable.`);
    }

    const rawRanks = isRecord(stored.researchRanks) ? stored.researchRanks : {};
    const researchRanks: Partial<Record<ResearchNodeId, number>> = {};

    for (const [nodeId, rawRank] of Object.entries(rawRanks)) {
      const node = RESEARCH_NODES[nodeId as ResearchNodeId];

      if (node === undefined || node.machineId !== machineId) {
        report.repairs.push(`Dropped unknown research node "${nodeId}".`);
        continue;
      }

      const rank = quantity(rawRank, 0);

      if (rank > 0) {
        researchRanks[node.id] =
          node.maximumRank === null ? rank : Math.min(node.maximumRank, rank);
      }
    }

    let activeSpecId: SpecId | null = null;
    const storedSpec = stored.activeSpecId;

    if (typeof storedSpec === "string") {
      const spec = SPECS[storedSpec as SpecId];

      if (spec !== undefined && spec.machineId === machineId) {
        activeSpecId = spec.id;
      } else {
        report.repairs.push(`Cleared unknown active spec "${storedSpec}".`);
      }
    }

    machines[machineId] = {
      unlocked: boolean(stored.unlocked, definition.startsUnlocked),
      level,
      recipePieces: quantity(stored.recipePieces),
      flywheelCycles: quantity(stored.flywheelCycles),
      researchRanks,
      activeSpecId,
      cycleProgressMs: decimal(stored.cycleProgressMs, 0, 0),
    };

    if (definition.startsUnlocked) {
      machines[machineId].unlocked = true;
    }
  }

  const selectedMachineId =
    typeof rawCasino.selectedMachineId === "string" &&
    rawCasino.selectedMachineId in MACHINES
      ? (rawCasino.selectedMachineId as MachineId)
      : STARTER_MACHINE_ID;

  // Gear.
  const rawGear = isRecord(raw.gear) ? raw.gear : {};
  const tankMax = GEAR.tank.levels[GEAR.tank.levels.length - 1].level;
  const pickaxeMax = GEAR.pickaxe.levels[GEAR.pickaxe.levels.length - 1].level;

  const readSlots = (value: unknown): Array<TrinketId | null> => {
    const list = Array.isArray(value) ? value : [];

    return [0, 1, 2].map((index) => normalizeSlotTrinketId(list[index], report));
  };

  const gear = {
    tankLevel: Math.min(tankMax, Math.max(1, quantity(rawGear.tankLevel, 1))),
    pickaxeLevel: Math.min(pickaxeMax, Math.max(1, quantity(rawGear.pickaxeLevel, 1))),
    tankTrinketSlots: readSlots(rawGear.tankTrinketSlots),
    pickaxeTrinketSlots: readSlots(rawGear.pickaxeTrinketSlots),
  };

  // Collection.
  const collection = createFreshCollectionState();
  const rawCollection = isRecord(raw.collection) ? raw.collection : {};
  const rawTrinkets = isRecord(rawCollection.trinkets) ? rawCollection.trinkets : {};

  for (const trinketId of TRINKET_IDS) {
    const stored = isRecord(rawTrinkets[trinketId]) ? rawTrinkets[trinketId] : {};
    const owned = boolean(stored.owned);

    collection.trinkets[trinketId as TrinketId] = {
      owned,
      grade: isGradeId(stored.grade) ? stored.grade : LOWEST_GRADE,
      fragments: owned ? quantity(stored.fragments) : 0,
    };
  }

  const rawTotems = isRecord(rawCollection.totems) ? rawCollection.totems : {};

  for (const totemId of TOTEM_IDS) {
    const stored = isRecord(rawTotems[totemId]) ? rawTotems[totemId] : {};
    const owned = boolean(stored.owned);

    collection.totems[totemId as TotemId] = {
      owned,
      grade: isGradeId(stored.grade) ? stored.grade : LOWEST_GRADE,
      fragments: owned ? quantity(stored.fragments) : 0,
    };
  }

  const rawActiveTotems = Array.isArray(rawCollection.activeTotemIds)
    ? rawCollection.activeTotemIds
    : [];

  const seenTotems = new Set<string>();

  collection.activeTotemIds = [0, 1, 2].map((index) => {
    const candidate = rawActiveTotems[index];

    if (typeof candidate !== "string" || !(TOTEM_IDS as readonly string[]).includes(candidate)) {
      return null;
    }

    if (seenTotems.has(candidate) || !collection.totems[candidate as TotemId].owned) {
      report.repairs.push(`Cleared an invalid active totem slot for "${candidate}".`);

      return null;
    }

    seenTotems.add(candidate);

    return candidate as TotemId;
  });

  // Cat skins: unknown ids dropped, and the defaults always present, since a
  // save claiming otherwise would leave a player unable to dress a cat at all.
  const rawOwnedSkins = stringArray(rawCollection.ownedCatSkinIds).filter(isCatSkinId);

  collection.ownedCatSkinIds = [
    ...DEFAULT_CAT_SKIN_IDS,
    ...rawOwnedSkins.filter((skinId) => !DEFAULT_CAT_SKIN_IDS.includes(skinId)),
  ];

  // Miner skins on the same rules, plus one more: the worn skin must be owned,
  // or the miner is drawn in something the player never bought.
  const rawOwnedMinerSkins = stringArray(rawCollection.ownedMinerSkinIds).filter(isMinerSkinId);

  collection.ownedMinerSkinIds = [
    DEFAULT_MINER_SKIN_ID,
    ...rawOwnedMinerSkins.filter((skinId) => skinId !== DEFAULT_MINER_SKIN_ID),
  ];

  const rawActiveMinerSkin = rawCollection.activeMinerSkinId;

  collection.activeMinerSkinId =
    isMinerSkinId(rawActiveMinerSkin) && collection.ownedMinerSkinIds.includes(rawActiveMinerSkin)
      ? rawActiveMinerSkin
      : DEFAULT_MINER_SKIN_ID;

  const rawCats = Array.isArray(rawCollection.cats) ? rawCollection.cats : [];

  collection.cats = rawCats.flatMap((entry): CatRecord[] => {
    if (!isRecord(entry) || !isCatSkinId(entry.skinId)) {
      report.repairs.push("Replaced a cat with an unreadable skin.");

      return [{ skinId: DEFAULT_CAT_SKIN_IDS[0] }];
    }

    return [{ skinId: entry.skinId }];
  });

  // Expedition.
  const rawExpedition = isRecord(raw.expedition) ? raw.expedition : {};
  const storedStatus = rawExpedition.status;
  const status: ExpeditionStatus =
    typeof storedStatus === "string" &&
    EXPEDITION_STATUSES.includes(storedStatus as ExpeditionStatus)
      ? (storedStatus as ExpeditionStatus)
      : "surface";

  const rawStreams = isRecord(rawExpedition.rngStreams) ? rawExpedition.rngStreams : null;
  const streamsValid =
    rawStreams !== null &&
    isRngState(rawStreams["expedition-generation"]) &&
    isRngState(rawStreams["expedition-rewards"]) &&
    isRngState(rawStreams["expedition-failure"]) &&
    normalizeModifierSnapshot(rawExpedition.modifierSnapshot) !== null;

  let expedition = createSurfaceExpeditionState();

  if (status !== "surface" && streamsValid) {
    expedition = {
      ...expedition,
      status,
      runId: typeof rawExpedition.runId === "string" ? rawExpedition.runId : null,
      seed: typeof rawExpedition.seed === "number" ? rawExpedition.seed : null,
      rngStreams: rawStreams as unknown as RunRngStreams,
      depth: quantity(rawExpedition.depth),
      oxygen: decimal(rawExpedition.oxygen, 0, 0),
      maxOxygenSnapshot: decimal(rawExpedition.maxOxygenSnapshot, 1, 1),
      pickaxeDamageSnapshot: decimal(rawExpedition.pickaxeDamageSnapshot, 1, 0.01),
      modifierSnapshot: normalizeModifierSnapshot(rawExpedition.modifierSnapshot),
      // The id is only a label; the modifier's effects live in the snapshot, so
      // an unknown one loses its name and nothing else.
      activeModifierId: isExpeditionModifierId(rawExpedition.activeModifierId)
        ? rawExpedition.activeModifierId
        : null,
      currentEncounter: normalizeActiveEncounter(rawExpedition.currentEncounter, report),
      // Restored rather than regenerated: redrawing on load would let a player
      // reload at a decision until the forecast suited them.
      forecastEncounter: normalizeActiveEncounter(rawExpedition.forecastEncounter, report),
      // Restored with its committed reward intact, or reloading could change
      // what the contract is worth.
      activeContract: normalizeContract(rawExpedition.activeContract),
      runInventory: normalizeRunInventory(rawExpedition.runInventory),
      // Absent on an older save, which reads as a run that has banked nothing —
      // the honest answer, since these counters only describe the run in progress.
      runKeepsakes: {
        selenite: quantity(
          isRecord(rawExpedition.runKeepsakes) ? rawExpedition.runKeepsakes.selenite : 0,
        ),
        cats: quantity(
          isRecord(rawExpedition.runKeepsakes) ? rawExpedition.runKeepsakes.cats : 0,
        ),
      },
      history: Array.isArray(rawExpedition.history)
        ? (rawExpedition.history as GameState["expedition"]["history"]).slice(
            -ECONOMY.encounterHistoryLength,
          )
        : [],
      committedFailureResult: normalizeFailureResult(rawExpedition.committedFailureResult),
      transitionRemainingMs: decimal(rawExpedition.transitionRemainingMs, 0, 0),
    };
  } else if (status !== "surface") {
    report.repairs.push("An in-progress expedition could not be resumed and was abandoned.");
  }

  // Gambling.
  const rawGambling = isRecord(raw.gambling) ? raw.gambling : {};
  // The same reader as the other three games, since all four share one ladder.
  const selectedWager = chipWager(rawGambling.selectedWager, SLOT_WAGERS[0]);

  const rawSpin = isRecord(rawGambling.committedSpin) ? rawGambling.committedSpin : null;
  const spinSymbols = Array.isArray(rawSpin?.symbolIds)
    ? rawSpin.symbolIds.filter(
        (id): id is SlotSymbolId =>
          typeof id === "string" && (SLOT_SYMBOL_IDS as readonly string[]).includes(id),
      )
    : [];

  const committedSpin =
    rawSpin !== null && typeof rawSpin.betId === "string" && spinSymbols.length > 0
      ? {
          betId: rawSpin.betId,
          gameId: "game.slots" as const,
          wager: quantity(rawSpin.wager),
          symbolIds: spinSymbols,
          multiplier: decimal(rawSpin.multiplier, 0, 0),
          payout: quantity(rawSpin.payout),
          luckPoints: decimal(rawSpin.luckPoints, 0, 0),
          animationRemainingMs: decimal(rawSpin.animationRemainingMs, 0, 0),
        }
      : null;

  if (rawSpin !== null && committedSpin === null) {
    report.repairs.push("Discarded an unreadable in-flight spin.");
  }

  const recentResults = (
    Array.isArray(rawGambling.recentResults) ? rawGambling.recentResults : []
  )
    .filter((entry): entry is SpinSummary => isRecord(entry) && typeof entry.betId === "string")
    .slice(0, ECONOMY.recentSpinHistoryLength);

  const gambling: GamblingState = {
    selectedWager,
    committedSpin,
    recentResults,
    roulette: normalizeRoulette(rawGambling.roulette, report),
    blackjack: normalizeBlackjack(rawGambling.blackjack, report),
    depthWager: normalizeDepthWager(rawGambling.depthWager, report),
  };

  // Random streams.
  const rawRandom = isRecord(raw.random) ? raw.random : {};

  // Prestige.
  const rawPrestige = isRecord(raw.prestige) ? raw.prestige : {};
  const rawPerkRanks = isRecord(rawPrestige.perkRanks) ? rawPrestige.perkRanks : {};
  const perkRanks: Partial<Record<PrestigePerkId, number>> = {};

  for (const [perkId, rawRank] of Object.entries(rawPerkRanks)) {
    const perk = PRESTIGE_PERKS[perkId as PrestigePerkId];

    if (perk === undefined) {
      report.repairs.push(`Dropped unknown prestige perk "${perkId}".`);
      continue;
    }

    // A repeatable perk has no maximum to clamp against; its `maximumRank` is a
    // placeholder the flag overrides.
    const stored = quantity(rawRank, 0);
    const rank = perk.repeatable === true ? stored : Math.min(perk.maximumRank, stored);

    if (rank > 0) {
      perkRanks[perk.id] = rank;
    }
  }

  // Statistics, onboarding, settings.
  const rawStatistics = isRecord(raw.statistics) ? raw.statistics : {};
  const statistics = createFreshStatisticsState();

  for (const key of Object.keys(statistics) as Array<keyof typeof statistics>) {
    statistics[key] = quantity(rawStatistics[key]);
  }

  // `catsFound` is the authority, since the luck modifier reads it, so the list
  // is squared against the count rather than the other way round.
  const reconciledCats = reconcileCats(
    collection.cats,
    statistics.catsFound,
    collection.ownedCatSkinIds,
  );

  if (reconciledCats.length !== collection.cats.length) {
    report.repairs.push(
      `Squared the cat list against ${String(statistics.catsFound)} cats found.`,
    );
  }

  collection.cats = reconciledCats;

  const rawOnboarding = isRecord(raw.onboarding) ? raw.onboarding : {};
  const rawSettings = isRecord(raw.settings) ? raw.settings : {};
  const defaults = createFreshSettingsState();

  const rawPity = isRecord(raw.pity) ? raw.pity : {};

  // Unknown ids dropped and duplicates collapsed, as `activeTotemIds` are: a
  // save must not hold an item this build has never heard of, and non-stackable
  // is enforced on load as well as on purchase.
  const heldConsumableIds = [
    ...new Set(stringArray(raw.heldConsumableIds).filter(isConsumableId)),
  ];

  if (heldConsumableIds.length !== stringArray(raw.heldConsumableIds).length) {
    report.repairs.push("Dropped an unreadable or duplicated consumable.");
  }

  const state: GameState = {
    resources,
    casino: { selectedMachineId, machines },
    gear,
    collection,
    heldConsumableIds,
    expedition,
    gambling,
    random: {
      gambling: rngOr(rawRandom.gambling, fresh.random.gambling),
      cacheRewards: rngOr(rawRandom.cacheRewards, fresh.random.cacheRewards),
      machinePayout: rngOr(rawRandom.machinePayout, fresh.random.machinePayout),
      expeditionSeeds: rngOr(rawRandom.expeditionSeeds, fresh.random.expeditionSeeds),
      nextExpeditionSeedCounter: quantity(rawRandom.nextExpeditionSeedCounter),
    },
    prestige: {
      count: quantity(rawPrestige.count),
      lifetimeCashEarned: quantity(rawPrestige.lifetimeCashEarned),
      cycleCashEarned: quantity(rawPrestige.cycleCashEarned),
      perkRanks,
    },
    pity: {
      encountersSinceRecipePiece: quantity(rawPity.encountersSinceRecipePiece),
      encountersSinceRelic: quantity(rawPity.encountersSinceRelic),
    },
    purchase: {
      depthAtLastCachePurchase: quantity(
        (isRecord(raw.purchase) ? raw.purchase : {}).depthAtLastCachePurchase,
      ),
      depthAtLastDeepCachePurchase: quantity(
        (isRecord(raw.purchase) ? raw.purchase : {}).depthAtLastDeepCachePurchase,
      ),
    },
    statistics,
    onboarding: {
      hasPurchasedMachineLevel: boolean(rawOnboarding.hasPurchasedMachineLevel),
      hasLaunchedExpedition: boolean(rawOnboarding.hasLaunchedExpedition),
      hasBankedRun: boolean(rawOnboarding.hasBankedRun),
      hasOpenedDevMenu: boolean(rawOnboarding.hasOpenedDevMenu),
      tutorial: (() => {
        const raw = isRecord(rawOnboarding.tutorial) ? rawOnboarding.tutorial : null;
        const fresh = createFreshTutorialState();

        if (raw === null) {
          // A save written before the tutorial existed. Defaulting to `running`
          // would start it mid-game, so any save showing play is treated as
          // finished and only a never-played one starts the script.
          const played = statistics.playTimeMs > 0 || statistics.runsLaunched > 0;

          return played ? { ...fresh, status: "finished" as const } : fresh;
        }

        const status =
          raw.status === "finished" || raw.status === "skipped" || raw.status === "running"
            ? raw.status
            : fresh.status;

        // An act or a gate this build no longer ships is dropped rather than
        // resumed — a script edit must not strand a save on a step that is gone.
        const activeActId =
          typeof raw.activeActId === "string" && TUTORIAL_ACT_IDS.includes(raw.activeActId)
            ? raw.activeActId
            : null;

        return {
          status,
          activeActId,
          stepIndex: activeActId === null ? 0 : quantity(raw.stepIndex),
          completedActIds: stringArray(raw.completedActIds).filter((id) =>
            TUTORIAL_ACT_IDS.includes(id),
          ),
          latchedGateIds: [...new Set(stringArray(raw.latchedGateIds).filter(isTutorialGateId))],
          // Only meaningful while it names the current step, so a save that
          // resumed onto a different act drops it and shows the card.
          dismissedStepId:
            typeof raw.dismissedStepId === "string" ? raw.dismissedStepId : null,
        };
      })(),
    },
    settings: {
      masterVolume: decimal(rawSettings.masterVolume, defaults.masterVolume, 0, 1),
      musicVolume: decimal(rawSettings.musicVolume, defaults.musicVolume, 0, 1),
      sfxVolume: decimal(rawSettings.sfxVolume, defaults.sfxVolume, 0, 1),
      muted: boolean(rawSettings.muted, defaults.muted),
      // A save written before the slider carries `machineSounds` instead. Off
      // becomes zero, so a player who silenced the cue does not come back to a
      // loud floor; on and absent take the default.
      machineVolume:
        rawSettings.machineSounds === false
          ? 0
          : decimal(rawSettings.machineVolume, defaults.machineVolume, 0, 1),
      reducedMotion: boolean(rawSettings.reducedMotion, defaults.reducedMotion),
      screenShake: boolean(rawSettings.screenShake, defaults.screenShake),
      singleWindowMode: boolean(rawSettings.singleWindowMode, defaults.singleWindowMode),
      expeditionSpeed: decimal(rawSettings.expeditionSpeed, defaults.expeditionSpeed, 1),
      numberFormat: rawSettings.numberFormat === "exact" ? "exact" : "compact",
      autoContinue: (() => {
        const raw = isRecord(rawSettings.autoContinue) ? rawSettings.autoContinue : {};

        return {
          enabled: boolean(raw.enabled, defaults.autoContinue.enabled),
          oxygenThresholdRatio: decimal(
            raw.oxygenThresholdRatio,
            defaults.autoContinue.oxygenThresholdRatio,
            ECONOMY.autoContinueMinimumRatio,
            0.95,
          ),
        };
      })(),
      cacheAutobuy: (() => {
        const raw = isRecord(rawSettings.cacheAutobuy) ? rawSettings.cacheAutobuy : {};

        // Built from what is recognised rather than spreading the raw object, so
        // a field that no longer exists is dropped on the next write.
        return { enabled: boolean(raw.enabled, defaults.cacheAutobuy.enabled) };
      })(),
      jukebox: (() => {
        const raw = isRecord(rawSettings.jukebox) ? rawSettings.jukebox : {};
        const trackId = isMusicTrackId(raw.trackId) ? raw.trackId : defaults.jukebox.trackId;

        // The unlock is re-checked on load as well as on the command that set
        // it, so an edited or older save cannot arrive with a jukebox it never
        // earned. `selectMusicTrackId` gates on the same condition every read;
        // this is here so the stored state is honest, not merely harmless.
        const unlocked = statistics.deepestDepth >= ECONOMY.jukeboxUnlockDepth;

        if (raw.trackId !== undefined && !isMusicTrackId(raw.trackId)) {
          report.repairs.push(
            `Reset the jukebox to ${defaults.jukebox.trackId}; this build has no track named ${String(raw.trackId)}.`,
          );
        }

        return { enabled: unlocked && boolean(raw.enabled, defaults.jukebox.enabled), trackId };
      })(),
      // Normalised by the domain, so a loaded file and a typed name are held to
      // one rule. Absent and unusable both come back null, which is what the
      // naming prompt fires on.
      casinoName: normalizeCasinoName(rawSettings.casinoName),
    },
    // Provenance rather than a preference, so it sits outside `settings`.
    // Defaults to false: the flag records what this build observed.
    devMenuUsed: boolean(raw.devMenuUsed),
    lastSettledAtUnixMs: repairSettlementStamp(
      typeof raw.lastSettledAtUnixMs === "number" && Number.isFinite(raw.lastSettledAtUnixMs)
        ? raw.lastSettledAtUnixMs
        : (options.savedAtUnixMs ?? nowUnixMs),
      options.savedAtUnixMs,
    ),
  };

  // Only one copy of each trinket exists, so it can occupy at most one slot and
  // must actually be owned.
  const seatedTrinkets = new Set<string>();

  for (const gearId of ["tank", "pickaxe"] as const) {
    const slots = gearId === "tank" ? state.gear.tankTrinketSlots : state.gear.pickaxeTrinketSlots;

    const cleaned = slots.map((trinketId) => {
      if (trinketId === null) {
        return null;
      }

      if (!state.collection.trinkets[trinketId].owned) {
        report.repairs.push(`Unequipped "${trinketId}"; it is not owned.`);

        return null;
      }

      if (seatedTrinkets.has(trinketId)) {
        report.repairs.push(`Unequipped a second copy of "${trinketId}"; only one exists.`);

        return null;
      }

      if (TRINKETS[trinketId].targetGearId !== gearId) {
        report.repairs.push(`Unequipped "${trinketId}"; it does not fit the ${gearId}.`);

        return null;
      }

      seatedTrinkets.add(trinketId);

      return trinketId;
    });

    if (gearId === "tank") {
      state.gear.tankTrinketSlots = cleaned;
    } else {
      state.gear.pickaxeTrinketSlots = cleaned;
    }
  }

  return { state, report };
}

export type EnvelopeValidation =
  | { ok: true; envelope: SaveEnvelope; report: NormalizationReport }
  | { ok: false; reason: string };

export type ChecksumVerification = { ok: true } | { ok: false; reason: string };

/**
 * Verifies version and checksum against the record exactly as it was stored.
 *
 * This must run before migrations, because a migration rewrites the body the
 * checksum was taken over.
 */
export function verifyEnvelopeChecksum(raw: unknown): ChecksumVerification {
  if (!isRecord(raw)) {
    return { ok: false, reason: "The save record is not an object." };
  }

  if (typeof raw.saveVersion !== "number" || !Number.isInteger(raw.saveVersion)) {
    return { ok: false, reason: "The save record has no usable version." };
  }

  if (raw.saveVersion > SAVE_VERSION) {
    return {
      ok: false,
      reason: `The save was written by a newer build (version ${raw.saveVersion}).`,
    };
  }

  if (typeof raw.checksum !== "string" || raw.checksum.length === 0) {
    return { ok: false, reason: "The save record has no checksum." };
  }

  const expected = checksumOf({
    saveVersion: raw.saveVersion,
    contentVersion: typeof raw.contentVersion === "string" ? raw.contentVersion : "",
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    savedAtUnixMs: typeof raw.savedAtUnixMs === "number" ? raw.savedAtUnixMs : 0,
    game: raw.game as GameState,
  });

  if (expected !== raw.checksum) {
    return { ok: false, reason: "The save record failed its checksum." };
  }

  return { ok: true };
}

export interface ValidateEnvelopeOptions {
  /** Skipped when the record has already been checksum-verified and migrated. */
  verifyChecksum?: boolean;
}

export function validateEnvelope(
  raw: unknown,
  nowUnixMs: number,
  options: ValidateEnvelopeOptions = {},
): EnvelopeValidation {
  if (!isRecord(raw)) {
    return { ok: false, reason: "The save record is not an object." };
  }

  if (typeof raw.saveVersion !== "number" || !Number.isInteger(raw.saveVersion)) {
    return { ok: false, reason: "The save record has no usable version." };
  }

  if (raw.saveVersion > SAVE_VERSION) {
    return {
      ok: false,
      reason: `The save was written by a newer build (version ${raw.saveVersion}).`,
    };
  }

  if (options.verifyChecksum !== false) {
    const verified = verifyEnvelopeChecksum(raw);

    if (!verified.ok) {
      return verified;
    }
  }

  const savedAtUnixMs =
    typeof raw.savedAtUnixMs === "number" && Number.isFinite(raw.savedAtUnixMs)
      ? raw.savedAtUnixMs
      : nowUnixMs;

  const normalized = normalizeGameState(raw.game, nowUnixMs, { savedAtUnixMs });

  return {
    ok: true,
    envelope: {
      saveVersion: raw.saveVersion,
      contentVersion: typeof raw.contentVersion === "string" ? raw.contentVersion : CONTENT_VERSION,
      revision: typeof raw.revision === "number" ? Math.max(0, Math.floor(raw.revision)) : 0,
      savedAtUnixMs,
      checksum: typeof raw.checksum === "string" ? raw.checksum : "",
      game: normalized.state,
    },
    report: normalized.report,
  };
}

export { createFreshMachineProgress, createEmptyRecipePieces };
