/** Authoritative serializable game-state types and fresh-state construction. */

import {
  ECONOMY,
  MACHINES,
  ORE_GRADE_IDS,
  RESOURCE_IDS,
  SLOT_DEFAULT_WAGER,
  STARTER_MACHINE_ID,
  TOTEM_IDS,
  TRINKET_IDS,
} from "../content/catalog";
import { DEFAULT_CAT_SKIN_IDS, type CatSkinId } from "../content/catSkins";
import { DEFAULT_MINER_SKIN_ID, type MinerSkinId } from "../content/minerSkins";
import type { ConsumableId } from "../content/consumables";
import type { ChipGameId, ChipStake } from "../content/chipGames";
import type { RouletteBetId } from "../content/roulette";
import type {
  CacheReward,
  ContractId,
  ExpeditionModifierId,
  EncounterId,
  MachineId,
  Modifier,
  OreGradeId,
  ResearchNodeId,
  ResourceId,
  SlotSymbolId,
  SpecId,
  GradeId,
  TotemId,
  TrinketId,
} from "../content/catalog";
import { LOWEST_GRADE } from "../content/grades";
import type { PrestigePerkId } from "../content/prestigePerks";
import type { MusicTrackId } from "../content/music";
import { TUTORIAL_ACTS, type TutorialGateId } from "../content/tutorial";
import type { CollectibleArrival } from "./collections";
import type { NumberFormatMode } from "./numbers";
import { createRngState, type RngState, type RunRngStreams } from "./rng";

export type ResourceBalances = Record<ResourceId, number>;

export interface MachineProgress {
  unlocked: boolean;
  level: number;
  recipePieces: number;
  /** Completed cycles on the flywheel ramp. Reset whenever the spec changes. */
  flywheelCycles: number;
  /** Rank per research node. A repeatable node counts up; a one-shot is 0 or 1. */
  researchRanks: Partial<Record<ResearchNodeId, number>>;
  activeSpecId: SpecId | null;
  cycleProgressMs: number;
}

export interface CasinoState {
  selectedMachineId: MachineId;
  machines: Record<MachineId, MachineProgress>;
}

export interface GearState {
  tankLevel: number;
  pickaxeLevel: number;
  /**
   * Fixed length 3. Positions above the unlocked count stay null. A slot holds
   * only the trinket id; the tier lives on the single owned entity, so the two
   * can never disagree.
   */
  tankTrinketSlots: Array<TrinketId | null>;
  pickaxeTrinketSlots: Array<TrinketId | null>;
}

/**
 * One entity per trinket. A duplicate find becomes fragments rather than a
 * second copy, so two grades of the same trinket can never coexist.
 */
export interface TrinketProgress {
  owned: boolean;
  grade: GradeId;
  fragments: number;
}

export interface TotemProgress {
  owned: boolean;
  grade: GradeId;
  /** Fragments banked toward the next grade. */
  fragments: number;
}

export interface CatRecord {
  skinId: CatSkinId;
}

export interface CollectionState {
  trinkets: Record<TrinketId, TrinketProgress>;
  totems: Record<TotemId, TotemProgress>;
  /** Fixed length 3. */
  activeTotemIds: Array<TotemId | null>;
  /**
   * One entry per cat met, in the order they were met. Its length must always
   * equal `statistics.catsFound`, which stays the authority for the luck bonus;
   * this array only carries the skins. `normalizeGameState` reconciles the two
   * if a save disagrees.
   */
  cats: CatRecord[];
  /**
   * Skins available to wear, starting from the four defaults. Cosmetic, so it
   * survives prestige by living in `collection`.
   */
  ownedCatSkinIds: CatSkinId[];
  /** Miner skins bought. Cosmetic, so it survives prestige. */
  ownedMinerSkinIds: MinerSkinId[];
  /**
   * The one being worn. Selected rather than cycled as cat skins are: there is
   * only one miner, so its look is a choice rather than a per-instance property.
   */
  activeMinerSkinId: MinerSkinId;
}

export type RunOre = Record<OreGradeId, number>;

export interface RunInventory {
  ore: RunOre;
  components: number;
  relics: number;
  recipePieces: Record<MachineId, number>;
  caches: number;
  deepCaches: number;
}

/** Progression a run banked on the way down, rather than carried out. */
export interface RunKeepsakes {
  /** Granted by a find that could no longer improve the item it duplicated. */
  selenite: number;
  /** Cats met. The rarest thing in the game, and never lost. */
  cats: number;
}

export type ResolvedGrant =
  | { kind: "ore"; grade: OreGradeId; amount: number }
  | { kind: "oxygen"; amount: number }
  | { kind: "components"; amount: number }
  | { kind: "relics"; amount: number }
  | { kind: "recipePiece"; machineId: MachineId; amount: number }
  | { kind: "caches"; amount: number }
  | { kind: "deepCaches"; amount: number }
  /**
   * Applied straight to the collection rather than the run inventory: a
   * collectible is permanent progression, not cargo. `arrival` records how it
   * landed, so the feedback need not re-derive it from a changed state.
   */
  | { kind: "collectible"; reward: CacheReward; arrival: CollectibleArrival }
  /** A contract accepted, with what it will pay already decided. */
  | { kind: "contract"; contract: RunContract };

/**
 * A goal taken mid-run, paid when the run reaches its target depth. Lives on the
 * run because it outlives the encounter that produced it.
 */
export interface RunContract {
  contractId: ContractId;
  /** Where it was taken, so the surface can show progress rather than a raw depth. */
  startedAtDepth: number;
  targetDepth: number;
  /**
   * What it pays, decided at acceptance. A contract sits in the save across
   * several encounters, so resolving it at the target would let a player reload
   * until the payout suited them.
   */
  reward: CommittedReward | null;
}

export interface CommittedReward {
  tableId: string;
  entryId: string;
  tags: string[];
  grants: ResolvedGrant[];
}

export interface ActiveEncounter {
  encounterId: EncounterId;
  approachElapsedMs: number;
  approachDurationMs: number;
  resolveElapsedMs: number;
  /** Strikes already swung at this encounter, so damage lands in whole hits. */
  strikesTaken: number;
  /** Null for ore encounters, whose duration derives from remaining durability. */
  resolveDurationMs: number | null;
  durabilityRemaining: number | null;
  oxygenDrainMultiplier: number;
  chosenOptionId: string | null;
  /** Committed when resolution begins or the choice is selected. */
  committedReward: CommittedReward | null;
}

export interface EncounterHistoryEntry {
  encounterId: EncounterId;
  depth: number;
  chosenOptionId: string | null;
  outcome: "completed" | "declined" | "interrupted";
  grants: ResolvedGrant[];
}

export interface RunModifierSnapshot {
  modifiers: Modifier[];
  luckPoints: number;
  failureLossChance: number;
  oreChipValues: Record<OreGradeId, number>;
  /** Multiplies the base oxygen drain. Below 1 makes the tank last longer. */
  oxygenDrainRate: number;
  /** Divides approach durations. Above 1 shortens the walk between encounters. */
  approachSpeed: number;
  /** Chance each pickaxe strike lands for double damage. */
  pickaxeCritChance: number;
  /**
   * Whether a fork resolves itself, from an equipped dowsing bone. Snapshotted
   * so unequipping mid-run cannot strand a run in a choice it cannot answer.
   */
  resolvesChoices: boolean;
  /**
   * Whether the next encounter is named before the player presses on, from an
   * equipped Cartographer's eye. Snapshotted like the rest of the loadout.
   */
  forecastsEncounters: boolean;
}

export interface FailureResult {
  recovered: RunInventory;
  lost: RunInventory;
  /** Set once the recovered portion has been banked, so a reload cannot rebank. */
  banked: boolean;
}

export type ExpeditionStatus =
  | "surface"
  | "launching"
  | "approaching"
  | "decision"
  | "choice"
  | "resolving"
  | "reward"
  | "extracting"
  | "failed";

export interface ExpeditionState {
  status: ExpeditionStatus;
  runId: string | null;
  seed: number | null;
  rngStreams: RunRngStreams | null;
  depth: number;
  oxygen: number;
  maxOxygenSnapshot: number;
  pickaxeDamageSnapshot: number;
  modifierSnapshot: RunModifierSnapshot | null;
  /**
   * The condition rolled at launch, if this run drew one. Held on the run rather
   * than the snapshot so it can be named after the fact; its effects are already
   * folded into `modifierSnapshot`.
   */
  activeModifierId: ExpeditionModifierId | null;
  currentEncounter: ActiveEncounter | null;
  /**
   * The contract this run is carrying, if one was taken and not yet resolved.
   * One at a time, since overlapping contracts stack for no added interest.
   */
  activeContract: RunContract | null;
  /**
   * The encounter waiting one step down, generated early so it can be named at
   * the decision point. Only ever populated for a run whose snapshot forecasts;
   * `beginApproach` consumes it in place of drawing, so pressing on delivers
   * exactly what was shown and the generation stream is consumed once either way.
   */
  forecastEncounter: ActiveEncounter | null;
  runInventory: RunInventory;
  /**
   * Permanent progression this run has already banked — selenite from a maxed-out
   * duplicate, a cat met. Not cargo: neither is at risk from an oxygen failure
   * and neither converts to chips, so they are kept out of `runInventory` and
   * held here only so the Carrying panel can report them.
   */
  runKeepsakes: RunKeepsakes;
  history: EncounterHistoryEntry[];
  committedFailureResult: FailureResult | null;
  /** Milliseconds left of the launching or reward transition. */
  transitionRemainingMs: number;
  /**
   * Wall-clock milliseconds the run is held still, so a cat can be looked at.
   * Decremented by raw elapsed time rather than run time, so it lasts the same
   * real second at every speed. On the state rather than in a component timer,
   * so a reload or a hidden tab cannot skip it.
   */
  pauseRemainingWallMs: number;
}

/**
 * What every committed chip bet has in common: stake deducted, result decided,
 * animation owed. Sharing the base makes the reload rule one rule rather than
 * four — a bet in the save is already paid for and already decided, so a reload
 * settles it rather than rerolling it.
 */
export interface CommittedBet {
  /** Unique for the life of the save. A settle command has to name it. */
  betId: string;
  gameId: ChipGameId;
  /** Chips staked. Blackjack updates this when a hand is doubled. */
  wager: number;
  payout: number;
  /** Luck at the moment of commitment, so the panel can explain the price. */
  luckPoints: number;
  /** Presentational time still owed. Zero for a game that resolves on a click. */
  animationRemainingMs: number;
}

export interface CommittedSpin extends CommittedBet {
  gameId: "game.slots";
  symbolIds: SlotSymbolId[];
  multiplier: number;
}

/** What a settled bet left behind, for the session history. */
export interface BetSummary {
  betId: string;
  gameId: ChipGameId;
  wager: number;
  payout: number;
  net: number;
}

export interface SpinSummary extends BetSummary {
  gameId: "game.slots";
  symbolIds: SlotSymbolId[];
  multiplier: number;
}

export interface CommittedRouletteBet extends CommittedBet {
  gameId: "game.roulette";
  /** Which bet was placed, as opposed to `betId`, which identifies this stake. */
  betTypeId: RouletteBetId;
  /** Only meaningful for a straight-up bet; ignored by every other. */
  straightNumber: number;
  /** The pocket, decided before the wheel starts turning. */
  pocket: number;
  multiplier: number;
}

export interface RouletteSummary extends BetSummary {
  gameId: "game.roulette";
  betTypeId: RouletteBetId;
  straightNumber: number;
  pocket: number;
}

export interface RouletteState {
  selectedBetTypeId: RouletteBetId;
  /** The number a straight-up bet would ride on. Kept across bet types. */
  selectedNumber: number;
  /** A rung, or "all". See {@link ChipStake}. */
  selectedWager: ChipStake;
  committedBet: CommittedRouletteBet | null;
  recentResults: RouletteSummary[];
}

export type BlackjackOutcome =
  | "player-blackjack"
  | "player"
  | "dealer"
  | "push";

/**
 * One hand against the dealer. `shoe` is the whole card order, drawn from the
 * gambling stream at the deal, so every hit takes an already-decided card and a
 * player cannot reload until the next card suits them.
 */
export interface BlackjackHand extends CommittedBet {
  gameId: "game.blackjack";
  /** Card ranks 1 to 13, ace low. Committed in full at the deal. */
  shoe: number[];
  /** How far into the committed shoe this hand has drawn. */
  cursor: number;
  playerCards: number[];
  dealerCards: number[];
  doubled: boolean;
  /** `player` is the only status that accepts an action or blocks prestige. */
  status: "player" | "settled";
  outcome: BlackjackOutcome | null;
}

export interface BlackjackSummary extends BetSummary {
  gameId: "game.blackjack";
  outcome: BlackjackOutcome;
  playerTotal: number;
  dealerTotal: number;
}

export interface BlackjackState {
  /** A rung, or "all". See {@link ChipStake}. */
  selectedWager: ChipStake;
  hand: BlackjackHand | null;
  recentResults: BlackjackSummary[];
}

/**
 * A stake on how deep the next run will get. Over-only, because an under-bet is
 * won by launching and banking immediately and so pays nothing. The price is
 * committed at placement and never recomputed: the all-time best it is derived
 * from moves during the very run being bet on.
 */
export interface DepthWager {
  wagerId: string;
  stake: number;
  targetDepth: number;
  /** Total returned per chip staked on a win, stake included. */
  multiplier: number;
  /** The all-time best the price was derived from, so the panel can say why. */
  bestDepthAtPlacement: number;
  luckPoints: number;
}

export interface DepthWagerSummary {
  wagerId: string;
  stake: number;
  targetDepth: number;
  depthReached: number;
  multiplier: number;
  payout: number;
  net: number;
  won: boolean;
}

export interface DepthWagerState {
  /** The target the panel is composing, not one that has been staked. */
  selectedTargetDepth: number;
  /** A rung, or "all". See {@link ChipStake}. */
  selectedStake: ChipStake;
  /** The staked wager, if one is pending. At most one at a time. */
  pending: DepthWager | null;
  recentResults: DepthWagerSummary[];
}

export interface GamblingState {
  /** The slot machine's stake: a rung, or "all". See {@link ChipStake}. */
  selectedWager: ChipStake;
  committedSpin: CommittedSpin | null;
  recentResults: SpinSummary[];
  roulette: RouletteState;
  blackjack: BlackjackState;
  depthWager: DepthWagerState;
}

export interface GlobalRandomState {
  gambling: RngState;
  cacheRewards: RngState;
  /** Dedicated stream that picks each expedition seed. */
  expeditionSeeds: RngState;
  /** Redraws the Gambler spec's payout, one draw per completed cycle. */
  machinePayout: RngState;
  nextExpeditionSeedCounter: number;
}

export interface PrestigeState {
  count: number;
  lifetimeCashEarned: number;
  /** Lifetime cash earned since the most recent prestige, used for eligibility. */
  cycleCashEarned: number;
  /** Rank per perk. A perk absent from the record is at rank 0. */
  perkRanks: Partial<Record<PrestigePerkId, number>>;
}

/**
 * Pity counters guard progression drops only. They never touch oxygen-failure
 * retention, which has no pity by product decision.
 */
export interface PityState {
  encountersSinceRecipePiece: number;
  encountersSinceRelic: number;
}

/** Paced purchases that unlock as runs are completed. */
export interface PurchaseState {
  /**
   * Cumulative depth descended when the last cache was bought. Lifetime, like
   * the counter it is compared against, so a prestige cannot hand out a free
   * cache by resetting one side of the comparison.
   */
  depthAtLastCachePurchase: number;
  /**
   * The same stamp for the deep cache, kept apart so the two gates run
   * independently. Sharing one would mean buying either reset both.
   */
  depthAtLastDeepCachePurchase: number;
}

export interface StatisticsState {
  playTimeMs: number;
  cashEarned: number;
  chipsEarned: number;
  runsLaunched: number;
  runsReturned: number;
  runsFailed: number;
  encountersCompleted: number;
  oreBanked: number;
  spinsPlayed: number;
  chipsWagered: number;
  chipsWon: number;
  cachesOpened: number;
  /** Deepest depth ever reached, which gates the stranger run modifiers. */
  deepestDepth: number;
  /** Cats met. Each adds luck permanently, and survives prestige. */
  catsFound: number;


  /**
   * Depths stepped across every run, ever. Not derivable from `deepestDepth`,
   * and used as the cache gate because it rewards playing rather than peaking.
   */
  depthDescended: number;
  /** Deepest depth since the last prestige. The only statistic that resets. */
  deepestDepthThisCycle: number;
  /**
   * Cash and chips that left the balance, for any reason. Counted at the
   * transaction boundary so a new kind of purchase cannot forget to report
   * itself. `chipsWagered` is a subset of `chipsSpent`, not a separate total.
   */
  cashSpent: number;
  chipsSpent: number;
  /** Critical pickaxe strikes landed. */
  criticalStrikes: number;
  /** The largest single banked haul, in chips. The number a player remembers. */
  bestRunChips: number;


  /**
   * Per-game counters. `spinsPlayed` stays the slot game's own; `chipsWagered`,
   * `chipsWon` and `chipsSpent` are the cross-game totals.
   */
  rouletteSpinsPlayed: number;
  blackjackHandsPlayed: number;
  depthWagersPlaced: number;
  depthWagersWon: number;
}

/**
 * The tutorial's own progress. See `domain/tutorial.ts` for why gates latch
 * rather than being read live.
 */
export interface TutorialState {
  /**
   * "running" from the first load of a fresh save until the last act has played.
   * It means the script is live, not that a card is up.
   */
  status: "running" | "finished" | "skipped";
  /** The act presenting right now, or null between acts — which is most of a save. */
  activeActId: string | null;
  /** Index into the active act's steps. Steps are never revisited. */
  stepIndex: number;
  /** Acts already played, so a script edit cannot replay an old one. */
  completedActIds: string[];
  /** Every gate that has ever been true. Latched, and never cleared. */
  latchedGateIds: TutorialGateId[];
  /**
   * The step whose card the player has closed, if it is still the current one.
   * Dismissing is not advancing: the card is a modal, and some steps wait for an
   * action the player cannot take through it. A step id rather than a boolean,
   * so a stale flag cannot silence the next card as well.
   */
  dismissedStepId: string | null;
}

export interface OnboardingState {
  hasPurchasedMachineLevel: boolean;
  hasLaunchedExpedition: boolean;
  hasBankedRun: boolean;
  /**
   * The developer chord has been pressed at least once, which is what the
   * dev-menu tutorial act triggers on. Separate from `devMenuUsed`, which
   * records an actual edit.
   */
  hasOpenedDevMenu: boolean;
  tutorial: TutorialState;
}

// Declared beside `formatQuantity` and re-exported here, where consumers look.
export type { NumberFormatMode };

/**
 * Presses on automatically while oxygen is above the threshold. It never banks:
 * returning is always a deliberate act.
 */
export interface AutoContinueSettings {
  enabled: boolean;
  oxygenThresholdRatio: number;
}

/**
 * Buys the paced, cash-priced cache on the player's behalf — only that one, since
 * the chip caches are unlimited and an autobuy would drain the balance forever.
 */
export interface CacheAutobuySettings {
  enabled: boolean;
}

/**
 * The player's standing choice of music, once the jukebox is unlocked. While
 * `enabled`, `selectMusicTrackId` returns `trackId` whatever the game is doing;
 * otherwise the track follows the scene. `trackId` survives being switched off,
 * so turning the jukebox back on returns to the last track chosen.
 */
export interface JukeboxSettings {
  enabled: boolean;
  trackId: MusicTrackId;
}

export interface SettingsState {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  /**
   * The machine payout cue's own level, under the effects channel. A slider
   * rather than a switch, because ten machines paying on a maxed floor is the
   * loudest repeated sound in the game; zero silences it entirely.
   */
  machineVolume: number;
  reducedMotion: boolean;
  screenShake: boolean;
  /**
   * When true, opening a rail window closes the one already open. On by default:
   * the rail is a set of reference panels, and stacking them buries the game.
   */
  singleWindowMode: boolean;
  /**
   * Expedition simulation speed. Clamped at read time to what the pace perk has
   * unlocked, so a stale or hand-edited value can never run faster than earned.
   */
  expeditionSpeed: number;
  numberFormat: NumberFormatMode;
  autoContinue: AutoContinueSettings;
  cacheAutobuy: CacheAutobuySettings;
  /** In `settings` because it is a preference, and settings survive a prestige. */
  jukebox: JukeboxSettings;
  /**
   * What the player calls their casino floor, or null if they have never been
   * asked — the condition the naming prompt fires on, and a state the player
   * cannot return to, since a blank field gets a generated name. In `settings`
   * so it survives a prestige. Normalised on the way in by `normalizeCasinoName`.
   */
  casinoName: string | null;
}

export interface GameState {
  resources: ResourceBalances;
  casino: CasinoState;
  gear: GearState;
  collection: CollectionState;
  /**
   * Consumables bought and not yet spent, at most one of each. Outside
   * `collection` because they are not permanent: launch folds them into the run
   * snapshot and empties the list, and prestige clears them with the chips that
   * bought them.
   */
  heldConsumableIds: ConsumableId[];
  expedition: ExpeditionState;
  gambling: GamblingState;
  random: GlobalRandomState;
  prestige: PrestigeState;
  pity: PityState;
  purchase: PurchaseState;
  statistics: StatisticsState;
  onboarding: OnboardingState;
  settings: SettingsState;
  /**
   * Whether the developer menu has ever been used on this save. Provenance
   * rather than a statistic: set by the one command that can hand out something
   * unearned, never cleared, and carried through export and import. Opening the
   * menu without editing does not set it.
   */
  devMenuUsed: boolean;
  /** Wall-clock stamp of the last settlement, used for offline production. */
  lastSettledAtUnixMs: number;
}

export function createEmptyResourceBalances(): ResourceBalances {
  return RESOURCE_IDS.reduce((balances, id) => {
    balances[id] = 0;

    return balances;
  }, {} as ResourceBalances);
}

export function createEmptyRunOre(): RunOre {
  return ORE_GRADE_IDS.reduce((ore, grade) => {
    ore[grade] = 0;

    return ore;
  }, {} as RunOre);
}

export function createEmptyRecipePieces(): Record<MachineId, number> {
  return Object.keys(MACHINES).reduce(
    (pieces, id) => {
      pieces[id as MachineId] = 0;

      return pieces;
    },
    {} as Record<MachineId, number>,
  );
}

export function createEmptyRunInventory(): RunInventory {
  return {
    ore: createEmptyRunOre(),
    components: 0,
    relics: 0,
    recipePieces: createEmptyRecipePieces(),
    caches: 0,
    deepCaches: 0,
  };
}

export function createSurfaceExpeditionState(): ExpeditionState {
  return {
    status: "surface",
    runId: null,
    seed: null,
    rngStreams: null,
    depth: 0,
    oxygen: 0,
    maxOxygenSnapshot: 0,
    pickaxeDamageSnapshot: 0,
    modifierSnapshot: null,
    activeModifierId: null,
    currentEncounter: null,
    activeContract: null,
    forecastEncounter: null,
    runInventory: createEmptyRunInventory(),
    runKeepsakes: { selenite: 0, cats: 0 },
    history: [],
    committedFailureResult: null,
    transitionRemainingMs: 0,
    pauseRemainingWallMs: 0,
  };
}

export function createFreshMachineProgress(machineId: MachineId): MachineProgress {
  return {
    unlocked: MACHINES[machineId].startsUnlocked,
    level: 1,
    recipePieces: 0,
    flywheelCycles: 0,
    researchRanks: {},
    activeSpecId: null,
    cycleProgressMs: 0,
  };
}

export function createFreshCasinoState(): CasinoState {
  return {
    selectedMachineId: STARTER_MACHINE_ID,
    machines: Object.keys(MACHINES).reduce(
      (machines, id) => {
        machines[id as MachineId] = createFreshMachineProgress(id as MachineId);

        return machines;
      },
      {} as Record<MachineId, MachineProgress>,
    ),
  };
}

export function createFreshGearState(): GearState {
  return {
    tankLevel: 1,
    pickaxeLevel: 1,
    tankTrinketSlots: [null, null, null],
    pickaxeTrinketSlots: [null, null, null],
  };
}

export function createEmptyTrinkets(): Record<TrinketId, TrinketProgress> {
  return TRINKET_IDS.reduce(
    (trinkets, id) => {
      trinkets[id] = { owned: false, grade: LOWEST_GRADE, fragments: 0 };

      return trinkets;
    },
    {} as Record<TrinketId, TrinketProgress>,
  );
}

export function createFreshCollectionState(): CollectionState {
  return {
    trinkets: createEmptyTrinkets(),
    totems: TOTEM_IDS.reduce(
      (totems, id) => {
        totems[id] = { owned: false, grade: LOWEST_GRADE, fragments: 0 };

        return totems;
      },
      {} as Record<TotemId, TotemProgress>,
    ),
    activeTotemIds: [null, null, null],
    cats: [],
    ownedCatSkinIds: [...DEFAULT_CAT_SKIN_IDS],
    ownedMinerSkinIds: [DEFAULT_MINER_SKIN_ID],
    activeMinerSkinId: DEFAULT_MINER_SKIN_ID,
  };
}

/**
 * A tutorial that has not started, on a save that has never been played. This is
 * also what makes a save reset replay the tutorial, since `resetSave` builds a
 * fresh state. A prestige must not reach here: `applyPrestige` carries
 * `onboarding` forward, or the script would replay every cycle.
 */
export function createFreshTutorialState(): TutorialState {
  return {
    status: "running",
    /*
     * Open from the first render rather than the first tick. `advanceTutorial`
     * would open it a frame later, and that frame is visible: the dashboard
     * paints once with no card, then the card arrives and pushes the window
     * layer down. The validator guarantees exactly one `"start"` act, declared
     * first, which makes this equivalent to letting the engine do it.
     */
    activeActId: TUTORIAL_ACTS[0].id,
    stepIndex: 0,
    completedActIds: [],
    latchedGateIds: [],
    dismissedStepId: null,
  };
}

export function createFreshSettingsState(): SettingsState {
  return {
    masterVolume: 0.7,
    musicVolume: 0.4,
    sfxVolume: 0.8,
    muted: false,
    machineVolume: 0.8,
    reducedMotion: false,
    screenShake: true,
    singleWindowMode: true,
    expeditionSpeed: 1,
    numberFormat: "compact",
    autoContinue: { enabled: false, oxygenThresholdRatio: 0.35 },
    cacheAutobuy: { enabled: false },
    // Off, and pointed at the casino: the track a fresh save is already hearing,
    // so switching the jukebox on for the first time changes nothing until the
    // player picks something.
    jukebox: { enabled: false, trackId: "music.casino" },
    // Never asked, which is distinct from named nothing. See the field.
    casinoName: null,
  };
}

/**
 * Longest a casino name may be: short enough that the floor heading still fits
 * its row at every fit scale. Enforced on the way into the state, not in the
 * input, because a save can arrive from a text editor.
 */
export const MAXIMUM_CASINO_NAME = 24;

/**
 * A casino name as the state is allowed to hold one, or null: trimmed,
 * whitespace collapsed, control characters removed, capped. Anything left empty
 * becomes `null`, the same answer an absent field gets. Used by both the reducer
 * and the save schema so the rule cannot be enforced in only one of them.
 */
export function normalizeCasinoName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    // Control characters out first: a newline in a panel heading is not a name.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length === 0 ? null : cleaned.slice(0, MAXIMUM_CASINO_NAME).trim();
}

export function createFreshGamblingState(): GamblingState {
  return {
    selectedWager: SLOT_DEFAULT_WAGER,
    committedSpin: null,
    recentResults: [],
    roulette: {
      selectedBetTypeId: "bet.red",
      selectedNumber: 0,
      selectedWager: SLOT_DEFAULT_WAGER,
      committedBet: null,
      recentResults: [],
    },
    blackjack: {
      selectedWager: SLOT_DEFAULT_WAGER,
      hand: null,
      recentResults: [],
    },
    depthWager: {
      // Zero rather than a guess: the panel derives the first sensible target
      // from the player's record, and there is none yet.
      selectedTargetDepth: 0,
      selectedStake: SLOT_DEFAULT_WAGER,
      pending: null,
      recentResults: [],
    },
  };
}

export function createFreshStatisticsState(): StatisticsState {
  return {
    playTimeMs: 0,
    cashEarned: 0,
    chipsEarned: 0,
    runsLaunched: 0,
    runsReturned: 0,
    runsFailed: 0,
    encountersCompleted: 0,
    oreBanked: 0,
    spinsPlayed: 0,
    chipsWagered: 0,
    chipsWon: 0,
    cachesOpened: 0,
    deepestDepth: 0,
    catsFound: 0,
    depthDescended: 0,
    deepestDepthThisCycle: 0,
    cashSpent: 0,
    chipsSpent: 0,
    criticalStrikes: 0,
    bestRunChips: 0,
    rouletteSpinsPlayed: 0,
    blackjackHandsPlayed: 0,
    depthWagersPlaced: 0,
    depthWagersWon: 0,
  };
}

export interface CreateGameStateOptions {
  nowUnixMs: number;
  seed?: number;
  startingCash?: number;
}

export function createGameState(options: CreateGameStateOptions): GameState {
  const seed = options.seed ?? Math.trunc(options.nowUnixMs) >>> 0;
  const resources = createEmptyResourceBalances();
  resources.cash = options.startingCash ?? ECONOMY.startingCash;

  return {
    resources,
    casino: createFreshCasinoState(),
    gear: createFreshGearState(),
    collection: createFreshCollectionState(),
    heldConsumableIds: [],
    expedition: createSurfaceExpeditionState(),
    gambling: createFreshGamblingState(),
    random: {
      gambling: createRngState(seed, "gambling"),
      cacheRewards: createRngState(seed, "cache-rewards"),
      expeditionSeeds: createRngState(seed, "expedition-seeds"),
      machinePayout: createRngState(seed, "machine-payout"),
      nextExpeditionSeedCounter: 0,
    },
    prestige: {
      count: 0,
      lifetimeCashEarned: 0,
      cycleCashEarned: 0,
      perkRanks: {},
    },
    pity: { encountersSinceRecipePiece: 0, encountersSinceRelic: 0 },
    purchase: { depthAtLastCachePurchase: 0, depthAtLastDeepCachePurchase: 0 },
    statistics: createFreshStatisticsState(),
    onboarding: {
      hasPurchasedMachineLevel: false,
      hasLaunchedExpedition: false,
      hasBankedRun: false,
      hasOpenedDevMenu: false,
      tutorial: createFreshTutorialState(),
    },
    settings: createFreshSettingsState(),
    devMenuUsed: false,
    lastSettledAtUnixMs: options.nowUnixMs,
  };
}
