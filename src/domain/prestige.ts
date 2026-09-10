/** Prestige eligibility, the selenite award, the reset matrix, and perks. */

import { ECONOMY, MACHINES, PRESTIGE_PERKS } from "../content/catalog";
import type { MachineId, PrestigePerkId } from "../content/catalog";
import { expeditionSpeedForRank, perkRankCost } from "../content/prestigePerks";
import type { DomainEffect } from "./commands";
import { releaseRelockedSlots } from "./gear";
import { collectActiveModifiers, evaluateStat } from "./modifiers";
import type { GameState, MachineProgress } from "./state";
import {
  createEmptyResourceBalances,
  createSurfaceExpeditionState,
  createFreshMachineProgress,
} from "./state";
import { applyTransaction, type TransactionPlan } from "./transactions";

export type PrestigeBlock =
  | { kind: "below-threshold"; required: number; earned: number }
  | { kind: "expedition-active" }
  | { kind: "spin-in-progress" }
  | { kind: "wheel-in-progress" }
  | { kind: "hand-in-progress" }
  | { kind: "wager-pending" }
  | { kind: "already-purchased" }
  | { kind: "unknown-perk" }
  | { kind: "prerequisite-required"; perkId: PrestigePerkId }
  | { kind: "insufficient-selenite"; required: number; available: number }
  | { kind: "transaction-failed"; message: string };

export type PrestigeOutcome =
  | { ok: true; state: GameState; effects: DomainEffect[] }
  | { ok: false; block: PrestigeBlock };

/** Cash earned since the last prestige. Spending never moves this backward. */
export function prestigeMetric(state: GameState): number {
  return state.prestige.cycleCashEarned;
}

/**
 * Cash needed to prestige, given how many prestiges are already behind you: a
 * rising wall, derived from `prestige.count` rather than stored.
 */
export function prestigeThresholdFor(prestigeCount: number): number {
  const count = Math.max(0, Math.floor(prestigeCount));

  return ECONOMY.prestigeThresholdCash * ECONOMY.prestigeThresholdGrowth ** count;
}

export function prestigeThreshold(state: GameState): number {
  return prestigeThresholdFor(state.prestige.count);
}

/**
 * Cash per unit of selenite, given how many prestiges are behind you. It must
 * grow more slowly than the threshold: with the two growing together the award
 * stays at 1 selenite while the wall grows twelve-thousandfold, and the tree
 * stops advancing. The gap between the growth rates is what keeps a rising wall
 * worth climbing.
 */
export function prestigeDivisorFor(prestigeCount: number): number {
  const count = Math.max(0, Math.floor(prestigeCount));

  return ECONOMY.prestigeSeleniteDivisor * ECONOMY.prestigeSeleniteDivisorGrowth ** count;
}

/**
 * Monotonic award with diminishing growth. More earned cash never awards less
 * selenite.
 */
export function projectedSelenite(state: GameState): number {
  const earned = prestigeMetric(state);

  if (earned < prestigeThreshold(state)) {
    return 0;
  }

  const ratio = earned / prestigeDivisorFor(state.prestige.count);
  const base = Math.max(1, Math.floor(ratio ** ECONOMY.prestigeSeleniteExponent));

  // The Vault's Dividend compounds here: more selenite buys the perk that awards
  // more selenite, which is the only place in the tree that feeds itself.
  return evaluateStat(base, collectActiveModifiers(state), {
    targetStat: "prestige.seleniteGain",
  });
}

export function prestigeProgressRatio(state: GameState): number {
  // Clamped, so a save already past its threshold cannot render a bar over 100%.
  return Math.min(1, prestigeMetric(state) / prestigeThreshold(state));
}

export function prestigeBlock(state: GameState): PrestigeBlock | null {
  if (state.expedition.status !== "surface") {
    return { kind: "expedition-active" };
  }

  /*
   * Every live chip commitment blocks the reset, listed separately so the
   * message can say which. A spin or wheel holds an already-decided stake, a
   * hand holds a committed shoe, and a depth wager is priced against gear the
   * prestige is about to take away.
   */
  if (state.gambling.committedSpin !== null) {
    return { kind: "spin-in-progress" };
  }

  if (state.gambling.roulette.committedBet !== null) {
    return { kind: "wheel-in-progress" };
  }

  if (state.gambling.blackjack.hand?.status === "player") {
    return { kind: "hand-in-progress" };
  }

  if (state.gambling.depthWager.pending !== null) {
    return { kind: "wager-pending" };
  }

  if (prestigeMetric(state) < prestigeThreshold(state)) {
    return {
      kind: "below-threshold",
      required: prestigeThreshold(state),
      earned: prestigeMetric(state),
    };
  }

  return null;
}

export function isPrestigeAvailable(state: GameState): boolean {
  return prestigeBlock(state) === null;
}

/** Everything prestige clears, for the confirmation copy. */
export const PRESTIGE_RESET_SUMMARY = [
  "Cash, chips, relics, components, keys, and caches of both kinds",
  "Machine unlocks, levels, research, specs, and recipe pieces",
  "Oxygen tank and pickaxe levels, relocking their second and third trinket slots",
  "Any expedition supplies you have packed but not yet spent",
] as const;

export const PRESTIGE_RETAIN_SUMMARY = [
  "Every trinket you own, including those in the first slot of each gear item",
  "Every totem you own and your active totem loadout",
  "Every cat you have met, its look, and every look you have unlocked",
  "Selenite, purchased perks, settings, and statistics",
] as const;

/**
 * Builds the complete post-prestige state before it replaces the current one, so
 * an interrupted write can never leave a half-reset save.
 */
export function applyPrestige(state: GameState): PrestigeOutcome {
  const block = prestigeBlock(state);

  if (block !== null) {
    return { ok: false, block };
  }

  const award = projectedSelenite(state);
  const modifiers = collectActiveModifiers(state);
  const startingCash = evaluateStat(ECONOMY.startingCash, modifiers, {
    targetStat: "prestige.startingCash",
  });

  const resources = createEmptyResourceBalances();
  resources.cash = startingCash;
  resources.selenite = state.resources.selenite + award;

  const machines = (Object.keys(MACHINES) as MachineId[]).reduce(
    (next, machineId) => {
      next[machineId] = createFreshMachineProgress(machineId);

      return next;
    },
    {} as Record<MachineId, MachineProgress>,
  );

  const reset: GameState = {
    ...state,
    resources,
    casino: { selectedMachineId: state.casino.selectedMachineId, machines },
    gear: { ...state.gear, tankLevel: 1, pickaxeLevel: 1 },
    expedition: createSurfaceExpeditionState(),
    // Cleared, unlike the collection: consumables are bought with chips, and
    // chips reset.
    heldConsumableIds: [],
    // Session history only. `prestigeBlock` refuses the reset while any
    // commitment is outstanding, so this never confiscates a live stake.
    gambling: {
      ...state.gambling,
      committedSpin: null,
      recentResults: [],
      roulette: { ...state.gambling.roulette, committedBet: null, recentResults: [] },
      blackjack: { ...state.gambling.blackjack, hand: null, recentResults: [] },
      depthWager: { ...state.gambling.depthWager, pending: null, recentResults: [] },
    },
    prestige: {
      count: state.prestige.count + 1,
      lifetimeCashEarned: state.prestige.lifetimeCashEarned,
      cycleCashEarned: 0,
      perkRanks: { ...state.prestige.perkRanks },
    },
    pity: { encountersSinceRecipePiece: 0, encountersSinceRelic: 0 },
    /*
     * `purchase` carries through with `...state`: it stamps a lifetime counter,
     * so zeroing it while `statistics` survives would hand out a free cache on
     * every prestige. Statistics carry through for the same reason, with
     * `deepestDepthThisCycle` the one exception — it is what lets the stats
     * window report "best ever" and "best this cycle" separately.
     */
    statistics: { ...state.statistics, deepestDepthThisCycle: 0 },
    /*
     * `onboarding` carries through too, tutorial included. Its acts trigger on
     * first-time events, one of which is becoming eligible to prestige, so
     * resetting it here would replay the script every cycle.
     */
  };

  // Gear levels dropped to 1, so slots two and three relock and return their
  // trinkets to the collection. Nothing is destroyed.
  const released = releaseRelockedSlots(reset);

  return {
    ok: true,
    state: released,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.prestige" },
      {
        type: "SHOW_FEEDBACK",
        tone: "positive",
        message: `Prestige complete. ${award} selenite awarded.`,
      },
      // Everything on the rail was reporting on the cycle this just cleared.
      { type: "CLOSE_WINDOWS" },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

export type PerkPlan =
  | { ok: true; plan: TransactionPlan }
  | { ok: false; block: PrestigeBlock };

/** Ranks held in a perk. Absent means zero. */
export function perkRank(state: GameState, perkId: PrestigePerkId): number {
  return state.prestige.perkRanks[perkId] ?? 0;
}

/**
 * The fastest expedition speed this save has unlocked. Read from the pace perk's
 * rank rather than a modifier, since the unlock doubles per rank while perk
 * scaling is linear.
 */
export function unlockedExpeditionSpeed(state: GameState): number {
  return expeditionSpeedForRank(perkRank(state, "perk.deep.pace"));
}

/**
 * The speed a run actually advances at, clamped to the unlock on every read so a
 * stale or hand-edited setting cannot outrun what the tree has paid for.
 */
export function selectExpeditionSpeed(state: GameState): number {
  const unlocked = unlockedExpeditionSpeed(state);
  const chosen = Number.isFinite(state.settings.expeditionSpeed)
    ? state.settings.expeditionSpeed
    : 1;

  return Math.max(1, Math.min(unlocked, chosen));
}

/** Selenite for this perk's next rank, or null when it is maxed. */
export function perkNextRankCost(state: GameState, perkId: PrestigePerkId): number | null {
  const perk = PRESTIGE_PERKS[perkId];

  return perk === undefined ? null : perkRankCost(perk, perkRank(state, perkId));
}

export function perkBlock(state: GameState, perkId: PrestigePerkId): PrestigeBlock | null {
  const perk = PRESTIGE_PERKS[perkId];

  if (perk === undefined) {
    return { kind: "unknown-perk" };
  }

  const cost = perkRankCost(perk, perkRank(state, perkId));

  if (cost === null) {
    return { kind: "already-purchased" };
  }

  // A prerequisite counts as met at rank 1, so a branch opens as soon as its
  // parent is bought. A capstone asks for the whole tree through its own flag.
  const missing = perk.prerequisitePerkIds.find((prerequisite) =>
    perk.requiresMaxedPrerequisites === true
      ? perkRank(state, prerequisite) < PRESTIGE_PERKS[prerequisite].maximumRank
      : perkRank(state, prerequisite) < 1,
  );

  if (missing !== undefined) {
    return { kind: "prerequisite-required", perkId: missing };
  }

  if (state.resources.selenite < cost) {
    return {
      kind: "insufficient-selenite",
      required: cost,
      available: state.resources.selenite,
    };
  }

  return null;
}

export function planPerkPurchase(state: GameState, perkId: PrestigePerkId): PerkPlan {
  const block = perkBlock(state, perkId);

  if (block !== null) {
    return { ok: false, block };
  }

  const cost = perkNextRankCost(state, perkId) ?? 0;

  return {
    ok: true,
    plan: {
      label: `perk:${perkId}`,
      costs: [{ resource: "selenite", amount: cost }],
      grants: [],
      stateMutations: [
        (current) => ({
          ...current,
          prestige: {
            ...current.prestige,
            perkRanks: {
              ...current.prestige.perkRanks,
              [perkId]: perkRank(current, perkId) + 1,
            },
          },
        }),
      ],
    },
  };
}

export function purchasePerk(state: GameState, perkId: PrestigePerkId): PrestigeOutcome {
  const planned = planPerkPurchase(state, perkId);

  if (!planned.ok) {
    return { ok: false, block: planned.block };
  }

  const outcome = applyTransaction(state, planned.plan);

  if (!outcome.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: outcome.message } };
  }

  return {
    ok: true,
    state: outcome.state,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.purchase" },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}
