/**
 * The single pure command reducer.
 *
 * Every command is validated against the current state, the complete next state
 * is calculated, and any invalid cost or transition rejects the whole command.
 */

import {
  CACHE_TYPES,
  ECONOMY,
  HIGHEST_GRADE,
  PRESTIGE_PERKS,
  RESEARCH_NODES,
  STANDARD_CACHE_TYPE_ID,
} from "../content/catalog";
import type { MachineId, PrestigePerkId, ResearchNodeId } from "../content/catalog";
import {
  advanceMachines,
  planCashProduction,
  selectCashPerSecond,
  planMachineLevelPurchase,
  planMachineUnlock,
  planResearch,
  planSpecChange,
} from "./casino";
import {
  describeCachePurchase,
  openCaches,
  planCacheChipPurchase,
  planCachePurchase,
  planKeyPurchase,
  planTotemEquip,
  planTotemUpgrade,
} from "./collections";
import type { CommandResult, DomainEffect, GameCommand, GameCommandType } from "./commands";
import {
  chooseEncounterOption,
  continueExpedition,
  launchExpedition,
  returnFromExpedition,
  tickExpedition,
} from "./expedition";
import { cycleCatSkin, planCatSkinPurchase } from "./cats";
import { planMinerSkinChange, planMinerSkinPurchase } from "./miner";
import { planConsumablePurchase } from "./consumables";
import { applyDevPatch, describeDevPatch } from "./devEdits";
import {
  planEquipTrinket,
  planGearUpgrade,
  planUnequipTrinket,
  planUpgradeTrinket,
  releaseRelockedSlots,
} from "./gear";
import { completeSpin, startSpin, tickSpinAnimation } from "./gambling";
import {
  completeRouletteSpin,
  startRouletteSpin,
  tickRouletteAnimation,
} from "./roulette";
import {
  dealBlackjackHand,
  doubleBlackjackHand,
  hitBlackjackHand,
  standBlackjackHand,
} from "./blackjack";
import {
  maximumWagerTarget,
  minimumWagerTarget,
  placeDepthWager,
  wagerReferenceDepth,
} from "./depthWager";
import { isMusicTrackId } from "../content/music";
import { CAT_SKINS } from "../content/catSkins";
import { MINER_SKINS } from "../content/minerSkins";
import { CONSUMABLES } from "../content/consumables";
import { isChipStake } from "../content/chipGames";
import { isRouletteBetId, isRoulettePocket } from "../content/roulette";
import { collectActiveModifiers, selectLuckPoints } from "./modifiers";
import {
  activeTutorialAct,
  advanceStep,
  advanceTutorial,
  selectTutorialStep,
} from "./tutorial";
import { clamp, formatCompact } from "./numbers";
import { applyPrestige, purchasePerk, selectExpeditionSpeed } from "./prestige";
/*
 * The one place the domain reaches into persistence. `normalizeGameState`
 * encodes a domain rule — what a legal `GameState` looks like — but lives in
 * persistence because loading needed it first. The developer command is the
 * only other producer of arbitrary state, so it uses the same repairer rather
 * than a second copy. Not a cycle: `saveSchema` never imports the reducer.
 */
import { normalizeGameState } from "../persistence/saveSchema";
import { normalizeCasinoName } from "./state";
import type { GameState, SettingsState } from "./state";
import { applyTransaction, type TransactionPlan } from "./transactions";

/** What the log says when the jukebox unlocks. Exported so tests assert on it. */
export const JUKEBOX_UNLOCK_NOTICE =
  "OPERATIONS: a jukebox has been installed on the floor. Morale is now mandatory.";

/**
 * Combined income of every unlocked machine. Lives here rather than only in the
 * selectors because the cache price derives from it and the reducer has to
 * charge that price, so both must read one implementation.
 */
export function totalCashPerSecond(state: GameState): number {
  const modifiers = collectActiveModifiers(state);

  return (Object.keys(state.casino.machines) as MachineId[])
    .filter((machineId) => state.casino.machines[machineId].unlocked)
    .reduce((total, machineId) => total + selectCashPerSecond(state, machineId, modifiers), 0);
}

function rejected(
  state: GameState,
  command: GameCommandType,
  message: string,
): CommandResult {
  return {
    state,
    effects: [
      { type: "COMMAND_REJECTED", command, message },
      { type: "PLAY_SOUND", soundId: "sound.control.reject" },
    ],
    materialChange: false,
  };
}

function accepted(
  state: GameState,
  effects: DomainEffect[],
  materialChange = true,
): CommandResult {
  return { state, effects, materialChange };
}

/** Runs a plan through the transaction boundary and reports either outcome. */
function commit(
  state: GameState,
  command: GameCommandType,
  plan: TransactionPlan,
  effects: DomainEffect[],
): CommandResult {
  const outcome = applyTransaction(state, plan);

  if (!outcome.ok) {
    return rejected(state, command, outcome.message);
  }

  return accepted(outcome.state, effects);
}

/** Turns a content id into the name the player actually sees. */
function nameOf(id: unknown): string {
  if (typeof id !== "string") {
    return "an earlier step";
  }

  return (
    RESEARCH_NODES[id as ResearchNodeId]?.displayName ??
    PRESTIGE_PERKS[id as PrestigePerkId]?.displayName ??
    id
  );
}

export function describeBlock(block: { kind: string } & Record<string, unknown>): string {
  switch (block.kind) {
    case "locked":
      return "That machine is still locked.";
    case "max-level":
      return "Already at the maximum level.";
    case "research-required":
      return `Requires research: ${nameOf(block.nodeId)}.`;
    case "prerequisite-required":
      return `Requires ${nameOf(block.nodeId ?? block.perkId)} first.`;
    case "already-researched":
      return "Already researched.";
    case "already-purchased":
      return "Already purchased.";
    case "already-unlocked":
      return "Already unlocked.";
    case "unknown-spec":
      return "That spec does not exist for this machine.";
    case "spec-not-researched":
      return `That spec needs research: ${nameOf(block.nodeId)}.`;
    case "recipe-incomplete":
      return `Recipe incomplete: ${String(block.owned)} of ${String(block.required)} pieces.`;
    case "insufficient-resources":
      return "Not enough resources.";
    case "insufficient-selenite":
      return `Needs ${String(block.required)} selenite; you have ${String(block.available)}.`;
    case "insufficient-chips":
      return `Needs ${formatCompact(Number(block.required))} chips; you have ${formatCompact(Number(block.available))}.`;
    case "insufficient-fragments":
      return `Needs ${String(block.required)} fragments; you have ${String(block.available)}.`;

    case "depths-required":
      return (
        `The Company restocks every ${String(block.required)} depths descended. ` +
        `${String(block.remaining)} to go.`
      );
    case "expedition-active":
      return "Not while an expedition is under way.";
    case "not-on-surface":
      return "An expedition is already under way.";
    case "not-in-decision":
      return "There is no decision waiting. You are committed until this encounter resolves.";
    case "banking-locked":
      // Names the target, the distance left, and what does not open it, since a
      // disabled Return button with no stated reason reads as broken.
      return (
        `Sealed orders: the lift will not answer above depth ${String(block.target)}. ` +
        `${String(block.remaining)} more to go, whatever the tank reads.`
      );
    case "not-in-choice":
      return "There is no choice waiting to be made.";
    case "unknown-option":
      return "That option is not part of this encounter.";
    case "slot-locked":
      return block.requiredLevel === null
        ? "That slot is locked."
        : `That slot unlocks at level ${String(block.requiredLevel)}.`;
    case "slot-out-of-range":
      return "That slot does not exist.";
    case "slot-empty":
      return "That slot is already empty.";
    case "incompatible-gear":
      return `That trinket only fits the ${String(block.expected)}.`;
    case "not-owned":
      return "You do not have a spare copy of that item.";
    case "max-grade":
      return `Already at ${HIGHEST_GRADE}, the highest grade.`;
    case "already-equipped":
      return "That totem is already in another slot.";
    case "no-key":
      return "You need a key to open a cache.";
    case "no-cache":
      return "You have no caches to open.";
    case "no-reward-available":
      return "The cache reward table produced nothing.";
    case "spin-in-progress":
      return "A spin is still resolving.";
    case "wheel-in-progress":
      return "The wheel is still turning.";
    case "no-committed-spin":
      return "There is no spin to settle.";
    case "wrong-spin":
      return "That spin is no longer the active one.";
    case "unknown-wager":
      return "That wager is not offered.";
    case "unknown-bet":
      return "That bet is not on the table.";
    case "hand-in-progress":
      return "Finish the hand you are playing first.";
    case "no-hand":
      return "There is no hand to play.";
    case "hand-settled":
      return "That hand is already settled.";
    case "double-too-late":
      return "Doubling is only offered on the first two cards.";
    case "wager-pending":
      return "A depth wager is already riding on your next run.";
    case "target-too-shallow":
      return `The house will not take a bet shallower than depth ${String(block.minimum)}.`;
    case "target-too-deep":
      return `The house will not price a bet deeper than depth ${String(block.maximum)}.`;
    case "invalid-quantity":
      return "Choose a whole quantity of at least one.";
    case "below-threshold":
      return `Prestige needs ${formatCompact(Number(block.required))} cash earned this cycle.`;
    case "unknown-perk":
      return "That perk does not exist.";
    case "bank-failed":
    case "transaction-failed":
      return String(block.message);
    default:
      return "That action is not available right now.";
  }
}

/**
 * Repairs a settings patch before it is stored. Takes the whole state because
 * one rule is about the save rather than the value: the jukebox may only be
 * switched on once the unlock depth is reached, and leaving that in the window
 * that offers the control would miss every other caller.
 */
function clampSettings(
  state: GameState,
  patch: Partial<SettingsState>,
): Partial<SettingsState> {
  const next: Partial<SettingsState> = { ...patch };

  for (const key of ["masterVolume", "musicVolume", "sfxVolume", "machineVolume"] as const) {
    if (next[key] !== undefined) {
      next[key] = clamp(next[key], 0, 1);
    }
  }

  if (next.autoContinue !== undefined) {
    next.autoContinue = {
      enabled: next.autoContinue.enabled,
      // Never below the floor: auto-continue exists to stop before a failure.
      oxygenThresholdRatio: clamp(
        next.autoContinue.oxygenThresholdRatio,
        ECONOMY.autoContinueMinimumRatio,
        0.95,
      ),
    };
  }

  if (next.jukebox !== undefined) {
    next.jukebox = {
      // A save short of the gate cannot switch it on, whatever the patch says.
      enabled:
        next.jukebox.enabled &&
        state.statistics.deepestDepth >= ECONOMY.jukeboxUnlockDepth,
      // A track this build does not ship falls back rather than being stored.
      trackId: isMusicTrackId(next.jukebox.trackId) ? next.jukebox.trackId : "music.casino",
    };
  }

  return next;
}

function reduceTick(state: GameState, command: Extract<GameCommand, { type: "TICK" }>): CommandResult {
  const casinoElapsedMs = Math.max(0, command.casinoElapsedMs);
  const expeditionElapsedMs = clamp(command.expeditionElapsedMs, 0, ECONOMY.maxActiveTickMs);
  const modifiers = collectActiveModifiers(state);

  let next = state;
  const effects: DomainEffect[] = [];

  // Casino production is granted in one atomic transaction across all machines.
  const advance = advanceMachines(state, casinoElapsedMs, modifiers);
  const production = applyTransaction(
    state,
    planCashProduction(advance.cashGranted, advance.machines, advance.payoutRng),
  );

  if (production.ok) {
    next = production.state;
  }

  // One cue per machine that paid, capped because ten at once is a chord rather
  // than information. The tail is kept: `completedMachineIds` is in ladder
  // order, so the most valuable machines keep their cues.
  const cued = advance.completedMachineIds.slice(-ECONOMY.machineCuesPerTick);

  for (const machineId of cued) {
    effects.push({ type: "PLAY_SOUND", soundId: `sound.payout.${machineId}` });
  }

  if (advance.clamped) {
    // Fires exactly once, on the tick that tips cash over the ceiling and rolls
    // it to `INF`.
    effects.push({
      type: "SHOW_FEEDBACK",
      tone: "positive",
      message: "Cash has outgrown counting. It reads INF from here.",
    });
  }

  /*
   * Expedition speed is applied by sub-stepping rather than by handing
   * `tickExpedition` a bigger number. Scaling before the `maxActiveTickMs` clamp
   * would collide with it — at 8x a 900ms frame becomes 7,200ms and is truncated
   * back to 1,000 — so the run would advance slower than the selected speed.
   * Slicing into clamp-sized steps keeps the guard and lands every transition on
   * the boundaries it would at 1x, so a seeded run reproduces at any speed.
   */
  const speed = selectExpeditionSpeed(state);

  // A cat pause is spent out of the unscaled elapsed time, and the run does not
  // advance while any remains. Spending it out of the scaled time would make the
  // pause 32 times shorter at 32x, when the point is a fixed visible moment.
  const pauseSpentMs = Math.min(next.expedition.pauseRemainingWallMs, expeditionElapsedMs);

  if (pauseSpentMs > 0) {
    next = {
      ...next,
      expedition: {
        ...next.expedition,
        pauseRemainingWallMs: next.expedition.pauseRemainingWallMs - pauseSpentMs,
      },
    };
  }

  // Only the unspent part of the frame reaches the run, so the frame that ends a
  // pause advances by its remainder rather than its whole length.
  let remainingExpeditionMs = (expeditionElapsedMs - pauseSpentMs) * speed;

  while (remainingExpeditionMs > 0) {
    const slice = Math.min(remainingExpeditionMs, ECONOMY.maxActiveTickMs);
    const expeditionStep = tickExpedition(next, slice);

    next = expeditionStep.state;
    effects.push(...expeditionStep.effects);
    remainingExpeditionMs -= slice;

    // Nothing left to advance once the run is over; the rest of the frame is
    // not carried into the next one.
    if (next.expedition.status === "surface") {
      break;
    }

    // A pause created inside the loop takes effect immediately: the spend above
    // happens before the loop, so otherwise a stuttering frame at high speed
    // would run several slices past the beat the pause exists to show.
    if (next.expedition.pauseRemainingWallMs > 0) {
      break;
    }
  }

  next = tickSpinAnimation(next, casinoElapsedMs);
  next = tickRouletteAnimation(next, casinoElapsedMs);

  next = {
    ...next,
    statistics: { ...next.statistics, playTimeMs: next.statistics.playTimeMs + casinoElapsedMs },
    // Production is credited up to this instant, so the next load cannot pay for
    // this session again. The max() stops a backward system clock rewinding it.
    lastSettledAtUnixMs: Number.isFinite(command.nowUnixMs)
      ? Math.max(next.lastSettledAtUnixMs, command.nowUnixMs)
      : next.lastSettledAtUnixMs,
  };

  // Priced against the state the purchase is applied to, so the autobuy pays
  // what the store window would have shown.
  const bought = autobuyCache(next, totalCashPerSecond(next));

  if (bought !== null) {
    next = bought.state;
    effects.push(...bought.effects);
  }

  const materialChange =
    advance.cashGranted > 0 ||
    bought !== null ||
    state.expedition.status !== next.expedition.status;

  return { state: next, effects, materialChange };
}

/**
 * The standing order: buys the paced cache the moment the Company restocks it.
 * Three rules hold it in check.
 *
 * Cash only — the chip caches have no restock, so an autobuy pointed at them
 * would hold the chip balance at zero forever. Never the last of the cash, or no
 * machine level could ever be bought again. And every purchase reports itself
 * exactly as a manual one does, since an unexplained drop in cash is worse than
 * no automation.
 *
 * In the reducer's tick rather than a component effect, so it keeps running with
 * the store window closed.
 */
function autobuyCache(
  state: GameState,
  cashPerSecond: number,
): { state: GameState; effects: DomainEffect[] } | null {
  const settings = state.settings.cacheAutobuy;

  if (!settings.enabled) {
    return null;
  }

  const availability = describeCachePurchase(state, cashPerSecond, STANDARD_CACHE_TYPE_ID);

  if (
    availability.depthsRemaining > 0 ||
    state.resources.cash < availability.price * ECONOMY.cacheAutobuyCashFloorMultiple
  ) {
    return null;
  }

  const planned = planCachePurchase(state, cashPerSecond, STANDARD_CACHE_TYPE_ID);

  if (!planned.ok) {
    return null;
  }

  const outcome = applyTransaction(state, planned.plan);

  if (!outcome.ok) {
    return null;
  }

  return {
    state: outcome.state,
    effects: [
      {
        type: "SHOW_FEEDBACK",
        tone: "neutral",
        message: `Standing order fulfilled: one cache, ${formatCompact(availability.price)} cash, debited.`,
      },
      { type: "REQUEST_SAVE", immediate: false },
    ],
  };
}

/**
 * Announces the jukebox unlock, once, on whatever command crossed the depth.
 * Compared across the whole command rather than inside one case, because
 * `statistics.deepestDepth` moves both when the player presses on and when
 * auto-continue does it from inside `tickExpedition`.
 *
 * A crossing comparison rather than a flag: the statistic is monotonic, so "was
 * below, is now at or above" is true exactly once in a save's life, and no save
 * field has to be defaulted, normalised and reasoned about on import. The
 * developer menu crosses the gate through this too, and announces.
 */
function announceJukeboxUnlock(before: GameState, result: CommandResult): CommandResult {
  if (
    before.statistics.deepestDepth >= ECONOMY.jukeboxUnlockDepth ||
    result.state.statistics.deepestDepth < ECONOMY.jukeboxUnlockDepth
  ) {
    return result;
  }

  return {
    ...result,
    effects: [
      ...result.effects,
      { type: "SHOW_FEEDBACK", tone: "neutral", message: JUKEBOX_UNLOCK_NOTICE },
    ],
  };
}

/**
 * The command reducer: a thin wrapper over the switch below, for the rules that
 * can only be decided by comparing the state before a command with the state
 * after it.
 */
export function reduce(state: GameState, command: GameCommand): CommandResult {
  // The tutorial runs outermost because it reacts to whatever the command did,
  // including a jukebox unlock, and is a no-op unless the tutorial is running.
  return advanceTutorial(announceJukeboxUnlock(state, reduceCommand(state, command)));
}

function reduceCommand(state: GameState, command: GameCommand): CommandResult {
  switch (command.type) {
    case "TICK":
      return reduceTick(state, command);

    case "SELECT_MACHINE": {
      if (state.casino.machines[command.machineId] === undefined) {
        return rejected(state, command.type, "That machine does not exist.");
      }

      return accepted(
        {
          ...state,
          casino: { ...state.casino, selectedMachineId: command.machineId },
        },
        [],
        false,
      );
    }

    case "UNLOCK_MACHINE": {
      const planned = planMachineUnlock(state, command.machineId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        { type: "SHOW_FEEDBACK", tone: "positive", message: "New machine installed." },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "BUY_MACHINE_LEVEL": {
      const planned = planMachineLevelPurchase(state, command.machineId, command.quantity ?? 1);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "RESEARCH_NODE": {
      const planned = planResearch(state, command.nodeId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        {
          type: "SHOW_FEEDBACK",
          tone: "positive",
          message: `${RESEARCH_NODES[command.nodeId].displayName} researched.`,
        },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "SET_MACHINE_SPEC": {
      const planned = planSpecChange(
        state,
        command.machineId,
        command.specId,
        collectActiveModifiers(state),
      );

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.control.confirm" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "LAUNCH_EXPEDITION": {
      const outcome = launchExpedition(state);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "CONTINUE_EXPEDITION": {
      const outcome = continueExpedition(state);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "CHOOSE_ENCOUNTER_OPTION": {
      const outcome = chooseEncounterOption(state, command.optionId);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "RETURN_FROM_EXPEDITION": {
      const outcome = returnFromExpedition(state);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "BUY_GEAR_LEVEL": {
      const planned = planGearUpgrade(state, command.gearId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "BUY_KEY": {
      const planned = planKeyPurchase(state, command.quantity);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "BUY_CACHE": {
      // The price is a function of income, and both this and the store view
      // derive it from the same state, so they agree.
      const planned = planCachePurchase(state, totalCashPerSecond(state), command.cacheTypeId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        {
          type: "SHOW_FEEDBACK",
          tone: "positive",
          message: `${CACHE_TYPES[command.cacheTypeId].displayName} delivered. The Company thanks you for your custom.`,
        },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "BUY_CACHE_WITH_CHIPS": {
      const planned = planCacheChipPurchase(state, command.cacheTypeId, command.quantity);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "OPEN_CACHES": {
      const outcome = openCaches(state, command.cacheTypeId, command.quantity);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "EQUIP_TRINKET": {
      const planned = planEquipTrinket(state, command.gearId, command.slot, command.trinketId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.gear.equip" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "UNEQUIP_TRINKET": {
      const planned = planUnequipTrinket(state, command.gearId, command.slot);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.gear.equip" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "UPGRADE_TRINKET": {
      const planned = planUpgradeTrinket(state, command.trinketId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.gear.upgrade" },
        { type: "SHOW_FEEDBACK", tone: "positive", message: "Trinket upgraded a tier." },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "UPGRADE_TOTEM": {
      const planned = planTotemUpgrade(state, command.totemId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.gear.upgrade" },
        { type: "SHOW_FEEDBACK", tone: "positive", message: "Totem rank increased." },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "EQUIP_TOTEM": {
      const planned = planTotemEquip(state, command.slot, command.totemId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.gear.equip" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "BUY_CAT_SKIN": {
      const planned = planCatSkinPurchase(state, command.skinId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        {
          type: "SHOW_FEEDBACK",
          tone: "positive",
          message: `${CAT_SKINS[command.skinId].displayName} unlocked. Cats you meet from now on may wear it.`,
        },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "BUY_MINER_SKIN": {
      const planned = planMinerSkinPurchase(state, command.skinId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        {
          type: "SHOW_FEEDBACK",
          tone: "positive",
          message: `${MINER_SKINS[command.skinId].displayName} unlocked. Wear it from the Skins panel.`,
        },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "SET_MINER_SKIN": {
      const planned = planMinerSkinChange(state, command.skinId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      // No feedback line: the miner on screen changing says it, and this control
      // may be clicked repeatedly.
      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.control.confirm" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "BUY_CONSUMABLE": {
      const planned = planConsumablePurchase(state, command.consumableId);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.purchase" },
        {
          type: "SHOW_FEEDBACK",
          tone: "positive",
          message: `${CONSUMABLES[command.consumableId].displayName} packed for the next run.`,
        },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    case "CYCLE_CAT_SKIN": {
      const planned = cycleCatSkin(state, command.index);

      if (!planned.ok) {
        return rejected(state, command.type, describeBlock(planned.block));
      }

      // No feedback line: a message per click would flood the log.
      return commit(state, command.type, planned.plan, [
        { type: "PLAY_SOUND", soundId: "sound.gear.equip" },
        { type: "REQUEST_SAVE", immediate: false },
      ]);
    }

    case "SET_WAGER": {
      // `isChipStake` rather than a ladder membership test: the selection may be
      // "all", resolved against the balance at the moment of play.
      if (!isChipStake(command.wager)) {
        return rejected(state, command.type, "That wager is not offered.");
      }

      return accepted(
        { ...state, gambling: { ...state.gambling, selectedWager: command.wager } },
        [],
        false,
      );
    }

    case "START_SLOT_SPIN": {
      const modifiers = collectActiveModifiers(state);
      const outcome = startSpin(state, command.wager, modifiers, selectLuckPoints(modifiers));

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "COMPLETE_SLOT_SPIN": {
      const outcome = completeSpin(state, command.betId);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "SET_ROULETTE_BET": {
      if (!isRouletteBetId(command.betTypeId)) {
        return rejected(state, command.type, "That bet is not on the table.");
      }

      // Kept across bet types, so switching away from a straight bet and back
      // does not forget the chosen number.
      const straightNumber = isRoulettePocket(command.straightNumber)
        ? command.straightNumber
        : state.gambling.roulette.selectedNumber;

      return accepted(
        {
          ...state,
          gambling: {
            ...state.gambling,
            roulette: {
              ...state.gambling.roulette,
              selectedBetTypeId: command.betTypeId,
              selectedNumber: straightNumber,
            },
          },
        },
        [],
        false,
      );
    }

    case "SET_ROULETTE_WAGER": {
      if (!isChipStake(command.wager)) {
        return rejected(state, command.type, "That wager is not offered.");
      }

      return accepted(
        {
          ...state,
          gambling: {
            ...state.gambling,
            roulette: { ...state.gambling.roulette, selectedWager: command.wager },
          },
        },
        [],
        false,
      );
    }

    case "START_ROULETTE_SPIN": {
      const modifiers = collectActiveModifiers(state);
      const outcome = startRouletteSpin(
        state,
        command.wager,
        modifiers,
        selectLuckPoints(modifiers),
      );

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "COMPLETE_ROULETTE_SPIN": {
      const outcome = completeRouletteSpin(state, command.betId);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "SET_BLACKJACK_WAGER": {
      if (!isChipStake(command.wager)) {
        return rejected(state, command.type, "That wager is not offered.");
      }

      return accepted(
        {
          ...state,
          gambling: {
            ...state.gambling,
            blackjack: { ...state.gambling.blackjack, selectedWager: command.wager },
          },
        },
        [],
        false,
      );
    }

    case "DEAL_BLACKJACK": {
      const modifiers = collectActiveModifiers(state);
      const outcome = dealBlackjackHand(
        state,
        command.wager,
        modifiers,
        selectLuckPoints(modifiers),
      );

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "BLACKJACK_HIT": {
      const outcome = hitBlackjackHand(state);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "BLACKJACK_STAND": {
      const outcome = standBlackjackHand(state);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "BLACKJACK_DOUBLE": {
      const outcome = doubleBlackjackHand(state);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "SET_DEPTH_WAGER": {
      // Clamped rather than rejected: a slider should stop at the end of its
      // track rather than refuse the value.
      const reference = wagerReferenceDepth(state);
      const target = clamp(
        Math.trunc(command.targetDepth),
        minimumWagerTarget(reference),
        maximumWagerTarget(reference),
      );

      return accepted(
        {
          ...state,
          gambling: {
            ...state.gambling,
            depthWager: {
              ...state.gambling.depthWager,
              selectedTargetDepth: target,
              selectedStake: isChipStake(command.stake)
                ? command.stake
                : state.gambling.depthWager.selectedStake,
            },
          },
        },
        [],
        false,
      );
    }

    case "PLACE_DEPTH_WAGER": {
      const modifiers = collectActiveModifiers(state);
      const outcome = placeDepthWager(
        state,
        command.targetDepth,
        command.stake,
        modifiers,
        selectLuckPoints(modifiers),
      );

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "BUY_PRESTIGE_PERK": {
      const outcome = purchasePerk(state, command.perkId);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "PRESTIGE": {
      const outcome = applyPrestige(state);

      return outcome.ok
        ? accepted(outcome.state, outcome.effects)
        : rejected(state, command.type, describeBlock(outcome.block));
    }

    case "ADVANCE_TUTORIAL": {
      const tutorial = state.onboarding.tutorial;
      const act = activeTutorialAct(state);

      if (act === null) {
        return rejected(state, command.type, "The tutorial is not showing anything.");
      }

      const step = act.steps[tutorial.stepIndex];

      // A stale id is refused, so two clicks on a card that advanced between
      // them cannot skip the step in between.
      if (step === undefined || step.id !== command.stepId) {
        return rejected(state, command.type, "That tutorial step has already been passed.");
      }

      return accepted(
        {
          ...state,
          onboarding: { ...state.onboarding, tutorial: advanceStep(tutorial, act) },
        },
        [{ type: "REQUEST_SAVE", immediate: false }],
      );
    }

    case "DISMISS_TUTORIAL_CARD": {
      const active = selectTutorialStep(state);

      if (active === null || active.step.id !== command.stepId) {
        return rejected(state, command.type, "That tutorial card is not showing.");
      }

      return accepted(
        {
          ...state,
          onboarding: {
            ...state.onboarding,
            tutorial: { ...state.onboarding.tutorial, dismissedStepId: command.stepId },
          },
        },
        [{ type: "REQUEST_SAVE", immediate: false }],
      );
    }

    case "SKIP_TUTORIAL": {
      const tutorial = state.onboarding.tutorial;
      const act = activeTutorialAct(state);

      if (tutorial.status !== "running" || act === null) {
        return rejected(state, command.type, "The tutorial is not showing anything.");
      }

      /*
       * Completed, not abandoned. `openNextAct` skips whatever is in
       * `completedActIds`, which is what stops the engine reopening the act just
       * dismissed. Everything else is untouched — the status stays `running` and
       * the latches stay latched — so `advanceTutorial` opens the next eligible
       * act and a skip reads as a page turn rather than a door closing.
       */
      return accepted(
        {
          ...state,
          onboarding: {
            ...state.onboarding,
            tutorial: {
              ...tutorial,
              activeActId: null,
              stepIndex: 0,
              dismissedStepId: null,
              completedActIds: [...tutorial.completedActIds, act.id],
            },
          },
        },
        [
          {
            type: "SHOW_FEEDBACK",
            tone: "neutral",
            message: `Skipped: ${act.title}. Later notices will still arrive.`,
          },
          { type: "REQUEST_SAVE", immediate: true },
        ],
      );
    }

    case "STOP_TUTORIAL": {
      if (state.onboarding.tutorial.status !== "running") {
        return rejected(state, command.type, "The tutorial is not running.");
      }

      // `advanceTutorial` returns early on any status but `running`, so this
      // makes the engine inert until `REPLAY_TUTORIAL` turns it back on.
      return accepted(
        {
          ...state,
          onboarding: {
            ...state.onboarding,
            tutorial: {
              ...state.onboarding.tutorial,
              status: "skipped",
              activeActId: null,
              stepIndex: 0,
              dismissedStepId: null,
            },
          },
        },
        [
          {
            type: "SHOW_FEEDBACK",
            tone: "neutral",
            message: "Tutorial turned off. You can play it again from the Help window.",
          },
          { type: "REQUEST_SAVE", immediate: true },
        ],
      );
    }

    case "REPLAY_TUTORIAL": {
      return accepted(
        {
          ...state,
          onboarding: {
            ...state.onboarding,
            tutorial: {
              ...state.onboarding.tutorial,
              status: "running",
              activeActId: null,
              stepIndex: 0,
              completedActIds: [],
              // Latches are kept, so a finished save reads the script through
              // rather than re-earning every trigger.
            },
          },
        },
        [
          { type: "SHOW_FEEDBACK", tone: "neutral", message: "Tutorial restarted." },
          { type: "REQUEST_SAVE", immediate: true },
        ],
      );
    }

    case "UPDATE_SETTINGS": {
      return accepted(
        { ...state, settings: { ...state.settings, ...clampSettings(state, command.patch) } },
        [{ type: "REQUEST_SAVE", immediate: false }],
      );
    }

    case "SET_CASINO_NAME": {
      // The same normalisation a loaded save gets, so a typed name and a name
      // found in a file are held to one rule.
      const name = normalizeCasinoName(command.name);

      if (name === null) {
        return rejected(state, command.type, "A casino needs a name.");
      }

      if (name === state.settings.casinoName) {
        return accepted(state, [], false);
      }

      return accepted(
        { ...state, settings: { ...state.settings, casinoName: name } },
        [
          {
            type: "SHOW_FEEDBACK",
            tone: "positive",
            message: `The floor is now trading as ${name}.`,
          },
          // Immediate, so a name is not lost to a tab closed straight after.
          { type: "REQUEST_SAVE", immediate: true },
        ],
      );
    }

    case "OPEN_DEV_MENU": {
      /*
       * Shut while a run is in flight, and the refusal is what says so: a
       * rejected command becomes a `COMMAND_REJECTED` effect, which the runtime
       * turns into a feedback line and a log entry. A patch that relocks a gear
       * slot under a run that has already snapshotted its loadout is far worse
       * to debug than a menu that will not open.
       */
      if (state.expedition.status !== "surface") {
        return rejected(
          state,
          command.type,
          "The developer menu is closed while an expedition is under way. Bank or fail the run first.",
        );
      }

      // A no-op rather than a refusal: pressing the chord again is not a mistake.
      if (state.onboarding.hasOpenedDevMenu) {
        return accepted(state, [], false);
      }

      return accepted(
        {
          ...state,
          onboarding: { ...state.onboarding, hasOpenedDevMenu: true },
        },
        [{ type: "REQUEST_SAVE", immediate: false }],
      );
    }

    case "DEV_SET_STATE": {
      /*
       * The one command that hands the player something they did not earn, so
       * also the one the balance simulations must never dispatch. The patch is
       * applied and the whole state re-normalised, the same path a loaded save
       * takes, so a hand-made state cannot be rejected by the loader later.
       */
      const patched = applyDevPatch(state, command.patch);
      // A level change can relock a gear slot, so any trinket in one returns to
      // the collection rather than being stranded.
      const released = releaseRelockedSlots(patched);
      const normalized = normalizeGameState(released, state.lastSettledAtUnixMs);
      const repairs = normalized.report.repairs;

      // The one place the save is marked as edited: not where the menu opens,
      // since looking is not cheating, and not in the panel, which a second UI
      // could forget. Applied after normalisation rebuilds the state object.
      const marked: GameState = { ...normalized.state, devMenuUsed: true };

      return accepted(marked, [
        {
          type: "SHOW_FEEDBACK",
          tone: "neutral",
          message:
            repairs.length === 0
              ? `Developer edit applied: ${describeDevPatch(command.patch)}.`
              : `Developer edit applied with ${String(repairs.length)} repair(s): ${repairs[0]}`,
        },
        { type: "REQUEST_SAVE", immediate: true },
      ]);
    }

    default: {
      const exhaustive: never = command;

      return rejected(
        state,
        (exhaustive as GameCommand).type,
        "Unknown command.",
      );
    }
  }
}
