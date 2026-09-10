/** The complete command vocabulary and the effects a command may request. */

import type {
  GearId,
  MachineId,
  PrestigePerkId,
  ResearchNodeId,
  ResourceId,
  SpecId,
  TotemId,
  TrinketId,
} from "../content/catalog";
import type { CacheTypeId } from "../content/caches";
import type { CatSkinId } from "../content/catSkins";
import type { MinerSkinId } from "../content/minerSkins";
import type { ConsumableId } from "../content/consumables";
import type { ChipStake } from "../content/chipGames";
import type { CacheOpenBatch } from "./collections";
import type { GradeId } from "../content/grades";
import type { RouletteBetId } from "../content/roulette";
import type { ResolvedGrant, RunInventory, SettingsState, SpinSummary } from "./state";

/**
 * What the developer menu is allowed to overwrite: an enumerated patch rather
 * than a deep partial of `GameState`, so the cheat surface stays readable and
 * cannot reach the RNG streams or a run in flight.
 *
 * Every field is optional; an absent field is left alone. Values are clamped and
 * re-normalised by the reducer, so an out-of-range number is repaired rather
 * than stored.
 */
export interface DevStatePatch {
  resources?: Partial<Record<ResourceId, number>>;
  /** Cats met. Permanent luck that is otherwise a 1-in-1000 roll. */
  catsFound?: number;
  /** Deepest depth ever reached, which gates the stranger run modifiers. */
  deepestDepth?: number;
  /** Prestige count, which also sets the prestige threshold. */
  prestigeCount?: number;
  selenite?: number;
  trinkets?: Partial<Record<TrinketId, DevCollectiblePatch>>;
  totems?: Partial<Record<TotemId, DevCollectiblePatch>>;
  tankLevel?: number;
  pickaxeLevel?: number;
  machines?: Partial<Record<MachineId, DevMachinePatch>>;
  perkRanks?: Partial<Record<PrestigePerkId, number>>;
}

export interface DevCollectiblePatch {
  owned?: boolean;
  grade?: GradeId;
  fragments?: number;
}

export interface DevMachinePatch {
  unlocked?: boolean;
  level?: number;
  recipePieces?: number;
  researchRanks?: Partial<Record<ResearchNodeId, number>>;
}

export type GameCommand =
  | {
      type: "TICK";
      casinoElapsedMs: number;
      expeditionElapsedMs: number;
      /**
       * Wall-clock stamp for this tick. Production has been credited up to this
       * moment, so offline settlement must measure from here on the next load.
       */
      nowUnixMs: number;
    }
  | { type: "SELECT_MACHINE"; machineId: MachineId }
  | { type: "UNLOCK_MACHINE"; machineId: MachineId }
  /** Levels to buy, defaulting to one. All-or-nothing; see `planMachineLevelPurchase`. */
  | { type: "BUY_MACHINE_LEVEL"; machineId: MachineId; quantity?: number }
  | { type: "RESEARCH_NODE"; nodeId: ResearchNodeId }
  | { type: "SET_MACHINE_SPEC"; machineId: MachineId; specId: SpecId | null }
  | { type: "LAUNCH_EXPEDITION" }
  | { type: "CONTINUE_EXPEDITION" }
  | { type: "CHOOSE_ENCOUNTER_OPTION"; optionId: string }
  | { type: "RETURN_FROM_EXPEDITION" }
  | { type: "BUY_GEAR_LEVEL"; gearId: GearId }
  | { type: "BUY_KEY"; quantity: number }
  /** The paced, cash-priced cache. One at a time, because the gate allows one. */
  | { type: "BUY_CACHE"; cacheTypeId: CacheTypeId }
  /** The ungated, chip-priced cache. Bulk, because nothing limits it but chips. */
  | { type: "BUY_CACHE_WITH_CHIPS"; cacheTypeId: CacheTypeId; quantity: number }
  /**
   * Opens `quantity` caches of one kind as a single command, so a bulk open is
   * one save, one feedback line, and one all-or-nothing outcome.
   */
  | { type: "OPEN_CACHES"; cacheTypeId: CacheTypeId; quantity: number }
  | { type: "EQUIP_TRINKET"; gearId: GearId; slot: number; trinketId: TrinketId }
  | { type: "UNEQUIP_TRINKET"; gearId: GearId; slot: number }
  | { type: "UPGRADE_TRINKET"; trinketId: TrinketId }
  | { type: "UPGRADE_TOTEM"; totemId: TotemId }
  | { type: "EQUIP_TOTEM"; slot: number; totemId: TotemId | null }
  | { type: "BUY_CAT_SKIN"; skinId: CatSkinId }
  | { type: "BUY_MINER_SKIN"; skinId: MinerSkinId }
  /** Wears an owned miner skin. Refused for one that is not owned. */
  | { type: "SET_MINER_SKIN"; skinId: MinerSkinId }
  /**
   * Buys one consumable for the next run. Refused mid-run, where it would appear
   * to do nothing.
   */
  | { type: "BUY_CONSUMABLE"; consumableId: ConsumableId }
  /**
   * Advances one cat to its next owned skin, by index into `collection.cats`:
   * cats have no identity beyond the order they were met in.
   */
  | { type: "CYCLE_CAT_SKIN"; index: number }
  | { type: "SET_WAGER"; wager: ChipStake }
  | { type: "START_SLOT_SPIN"; wager: number }
  | { type: "COMPLETE_SLOT_SPIN"; betId: string }
  | { type: "SET_ROULETTE_BET"; betTypeId: RouletteBetId; straightNumber: number }
  | { type: "SET_ROULETTE_WAGER"; wager: ChipStake }
  | { type: "START_ROULETTE_SPIN"; wager: number }
  | { type: "COMPLETE_ROULETTE_SPIN"; betId: string }
  | { type: "SET_BLACKJACK_WAGER"; wager: ChipStake }
  | { type: "DEAL_BLACKJACK"; wager: number }
  | { type: "BLACKJACK_HIT" }
  | { type: "BLACKJACK_STAND" }
  | { type: "BLACKJACK_DOUBLE" }
  | { type: "SET_DEPTH_WAGER"; targetDepth: number; stake: ChipStake }
  | { type: "PLACE_DEPTH_WAGER"; targetDepth: number; stake: number }
  | { type: "BUY_PRESTIGE_PERK"; perkId: PrestigePerkId }
  | { type: "PRESTIGE" }
  /**
   * Moves the tutorial on by one step. Refused when the step id does not match
   * the open step, so a click queued against a stale card cannot skip ahead.
   * Also how the dashboard answers the two gates that depend on which rail
   * windows are open, which `GameState` does not hold.
   */
  | { type: "ADVANCE_TUTORIAL"; stepId: string }
  /**
   * Closes the card without moving the script on. The card is modal, so a step
   * that waits for the player to act has to be closable. The step stays current
   * and the next card opens when its gate latches.
   */
  | { type: "DISMISS_TUTORIAL_CARD"; stepId: string }
  /**
   * Puts the open act away, and only the open act; later acts still run.
   * Recorded as completed rather than abandoned, so the engine does not reopen
   * it on the next command. `STOP_TUTORIAL` ends the script for good.
   */
  | { type: "SKIP_TUTORIAL" }
  /**
   * Ends the tutorial for good. Lives in the Help window rather than on every
   * card, since it is a preference rather than a response to one notice, and is
   * reversible from the same place by `REPLAY_TUTORIAL`.
   */
  | { type: "STOP_TUTORIAL" }
  /**
   * Starts the script again, keeping the latched gates so a finished save replays
   * the acts back to back rather than re-earning each trigger.
   */
  | { type: "REPLAY_TUTORIAL" }
  | { type: "UPDATE_SETTINGS"; patch: Partial<SettingsState> }
  /**
   * Names the casino floor. Its own command rather than an `UPDATE_SETTINGS`
   * patch because the name is validated: it is normalised and an empty one is
   * refused. Suggested names are drawn in the dialogue and arrive here as
   * ordinary names, so the reducer never touches the RNG streams.
   */
  | { type: "SET_CASINO_NAME"; name: string }
  /**
   * The player pressed the developer chord. Refused while a run is in flight,
   * where a patch could contradict a loadout the run has already snapshotted,
   * and the refusal is what logs the reason. Also records that the menu has been
   * seen, which is the tutorial gate for the dev-menu act — separate from
   * `devMenuUsed`, which records an actual edit and marks the save permanently.
   */
  | { type: "OPEN_DEV_MENU" }
  /**
   * Developer menu edit, not reachable through normal play. The one command that
   * can hand the player something they did not earn, so the balance simulations
   * must never dispatch it.
   */
  | { type: "DEV_SET_STATE"; patch: DevStatePatch };

export type GameCommandType = GameCommand["type"];

/**
 * A machine's payout cue, templated over `MachineId` so the `SoundId`-keyed
 * catalogue fails to typecheck if a new machine has no cue. Named `payout`
 * because machine ids already begin with "machine.".
 */
export type MachineSoundId = `sound.payout.${MachineId}`;

/**
 * Every cue the game can play, one id per thing that happens. The catalogue is a
 * `Record<SoundId, SoundDefinition>`, so an id added here without a sound fails
 * to compile. A list rather than a union so anything needing to walk every cue
 * has something to walk; the union is derived below, with machine cues appended.
 */
export const STATIC_SOUND_IDS = [
  "sound.pickaxe.impact",
  "sound.pickaxe.critical",
  "sound.reward.pickup",
  "sound.expedition.bank",
  "sound.cat.meet",
  "sound.expedition.failed",
  "sound.cache.open",
  "sound.slots.spin",
  "sound.slots.win",
  "sound.roulette.spin",
  "sound.roulette.win",
  "sound.blackjack.deal",
  "sound.blackjack.win",
  "sound.wager.place",
  "sound.wager.win",
  "sound.purchase",
  "sound.gear.equip",
  "sound.gear.upgrade",
  "sound.control.confirm",
  "sound.control.reject",
  "sound.prestige",
] as const;

export type SoundId = MachineSoundId | (typeof STATIC_SOUND_IDS)[number];

export interface RunSummary {
  outcome: "returned" | "failed";
  depth: number;
  encountersCompleted: number;
  chipsFromOre: number;
  /**
   * What the lost ore would have banked for, at the rate the recovered ore did,
   * so the summary can report both rows in chips. Zero on a run that came home.
   */
  chipsLost: number;
  recovered: RunInventory;
  /** Only present for an oxygen failure. */
  lost: RunInventory | null;
  /** The condition this run was under, if it rolled one. */
  modifierName: string | null;
}

export type FeedbackTone = "positive" | "negative" | "neutral";

export type DomainEffect =
  | { type: "PLAY_SOUND"; soundId: SoundId }
  | { type: "SHOW_FEEDBACK"; tone: FeedbackTone; message: string }
  | { type: "REQUEST_SAVE"; immediate: boolean }
  | { type: "SHOW_RUN_SUMMARY"; summary: RunSummary }
  /**
   * Takes the previous run's summary off the scene it overlays. Emitted on
   * launch so the card cannot sit over the walk that has just started; kept in
   * the domain rather than a view effect so it never depends on render order.
   */
  | { type: "CLEAR_RUN_SUMMARY" }
  /**
   * Takes the rail windows down, emitted by a command that has replaced the save
   * underneath them. Which windows are open is React state the domain cannot
   * reach, so this asks and the dashboard acts.
   */
  | { type: "CLOSE_WINDOWS" }
  /**
   * What an encounter just added to the run, for the floating indicators. It
   * reports what the reducer already applied and carries no authority of its own.
   */
  | {
      type: "SHOW_ENCOUNTER_REWARD";
      grants: ResolvedGrant[];
      /** Negative when oxygen was spent up front to begin an option. */
      oxygenDelta: number;
    }
  /**
   * One or more pickaxe strikes landed critically this tick. Counted, because a
   * long frame can hold several and the feedback should say four rather than
   * arrive four times. `damage` is the extra durability the crits removed.
   */
  | { type: "SHOW_CRITICAL_STRIKE"; count: number; damage: number }
  /**
   * An encounter has just finished, so the scene can play it out. An event
   * rather than state, because the domain has moved on by the next frame; the
   * app layer holds the timer. A failed run does not emit this.
   */
  | { type: "SHOW_ENCOUNTER_COMPLETE"; spriteId: string }
  | { type: "SHOW_SPIN_RESULT"; summary: SpinSummary }
  /**
   * What one or more opened caches produced, for the panel that plays them in.
   * An effect rather than state, because the collection afterwards cannot say
   * whether a trinket arrived just now or was already there.
   */
  | { type: "SHOW_CACHE_RESULTS"; batch: CacheOpenBatch }
  | { type: "COMMAND_REJECTED"; command: GameCommandType; message: string };

export interface CommandResult {
  state: import("./state").GameState;
  effects: DomainEffect[];
  /** True when the state changed in a way that must reach persistence. */
  materialChange: boolean;
}
