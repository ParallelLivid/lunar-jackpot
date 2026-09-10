/**
 * The depth wager: chips staked before launch on how deep the next run gets, and
 * the first thing that couples the casino to the expedition.
 *
 * Over-only, because an under-bet is won by launching and banking immediately
 * and so cannot be priced as a bet at all. Two rules hold the rest together:
 *
 * 1. The price is committed at placement. The all-time best it derives from
 *    moves during the very run being bet on, so re-deriving it at settlement
 *    would let a winning run re-price itself downward.
 * 2. It settles on depth reached, not on coming home: failing at depth 40 still
 *    wins a bet on depth 30.
 */

import { ECONOMY } from "../content/catalog";
import { isChipWager, isStakeable } from "../content/chipGames";
import type { DomainEffect } from "./commands";
import { blendScalar, blendToCap } from "./luckBias";
import { luckFactor, type Modifier } from "./modifiers";
import type { DepthWager, DepthWagerSummary, GameState } from "./state";
import { applyTransaction, type TransactionPlan } from "./transactions";

/**
 * The all-time best the price is derived against, floored so a save with no
 * record does not price depth 1 as a personal best.
 */
export function wagerReferenceDepth(state: GameState): number {
  return Math.max(state.statistics.deepestDepth, ECONOMY.depthWagerReferenceFloor);
}

/**
 * The published curve: `p = bestProbability ^ ((target / best) ^ exponent)`.
 * Continuous and monotonic in the target, so there is no step to sit on. Flat
 * below the player's best and steep above it.
 */
export function wagerSuccessProbability(targetDepth: number, referenceDepth: number): number {
  if (!Number.isFinite(targetDepth) || targetDepth <= 0) {
    return 1;
  }

  const best = Math.max(1, referenceDepth);
  const ratio = targetDepth / best;

  // Parenthesised deliberately: `**` is right-associative, so the unbracketed
  // form is correct but not obviously so.
  return ECONOMY.depthWagerBestProbability ** (ratio ** ECONOMY.depthWagerCurveExponent);
}

/** The offered multiplier before luck, at the house's stated margin. */
export function baseWagerMultiplier(targetDepth: number, referenceDepth: number): number {
  const probability = wagerSuccessProbability(targetDepth, referenceDepth);

  if (probability <= 0) {
    return ECONOMY.depthWagerMaximumMultiplier;
  }

  return Math.min(
    ECONOMY.depthWagerMaximumMultiplier,
    ECONOMY.depthWagerBaseReturn / probability,
  );
}

/**
 * The multiplier actually offered, with luck shading the price rather than the
 * run: luck already improves encounter draws, so biasing the run would pay twice
 * for one stat. Capped like every other game, with expected return being the
 * probability times the price.
 */
export function offeredWagerMultiplier(
  targetDepth: number,
  referenceDepth: number,
  modifiers: readonly Modifier[],
  luckPoints: number,
): number {
  // Accepted for the shape every game's luck entry point has, and not applied:
  // there is no outcome set here, only a chance and a price.
  void modifiers;

  const probability = wagerSuccessProbability(targetDepth, referenceDepth);
  const base = baseWagerMultiplier(targetDepth, referenceDepth);
  const shaded = base * (1 + ECONOMY.depthWagerLuckBias * luckFactor(luckPoints));

  const capped = blendToCap(
    base,
    shaded,
    ECONOMY.gamblingMaxExpectedReturn,
    blendScalar,
    (multiplier) => multiplier * probability,
  );

  return Math.min(ECONOMY.depthWagerMaximumMultiplier, capped);
}

/**
 * The shallowest target the house will take a bet on. Scanned rather than
 * solved, so it cannot disagree with the multiplier the panel then shows.
 */
export function minimumWagerTarget(referenceDepth: number): number {
  for (let target = 1; target <= referenceDepth * 3; target += 1) {
    if (baseWagerMultiplier(target, referenceDepth) >= ECONOMY.depthWagerMinimumMultiplier) {
      return target;
    }
  }

  return Math.max(1, Math.ceil(referenceDepth));
}

/** The deepest target offered, where the price curve has run out. */
export function maximumWagerTarget(referenceDepth: number): number {
  return Math.max(minimumWagerTarget(referenceDepth), Math.ceil(referenceDepth * 2));
}

export type DepthWagerBlock =
  | { kind: "wager-pending" }
  | { kind: "expedition-active" }
  | { kind: "unknown-wager" }
  | { kind: "target-too-shallow"; minimum: number }
  | { kind: "target-too-deep"; maximum: number }
  | { kind: "insufficient-chips"; required: number; available: number }
  | { kind: "transaction-failed"; message: string };

export type DepthWagerOutcome =
  | { ok: true; state: GameState; effects: DomainEffect[] }
  | { ok: false; block: DepthWagerBlock };

/**
 * Stakes chips on a target depth. Surface only: mid-run, the depth is already
 * partly known, which is the same free-money shape as an under-bet.
 */
export function placeDepthWager(
  state: GameState,
  targetDepth: number,
  stake: number,
  modifiers: readonly Modifier[],
  luckPoints: number,
): DepthWagerOutcome {
  if (state.gambling.depthWager.pending !== null) {
    return { ok: false, block: { kind: "wager-pending" } };
  }

  if (state.expedition.status !== "surface") {
    return { ok: false, block: { kind: "expedition-active" } };
  }

  if (!isStakeable(stake)) {
    return { ok: false, block: { kind: "unknown-wager" } };
  }

  const reference = wagerReferenceDepth(state);
  const minimum = minimumWagerTarget(reference);
  const maximum = maximumWagerTarget(reference);
  const target = Math.trunc(targetDepth);

  if (!Number.isFinite(target) || target < minimum) {
    return { ok: false, block: { kind: "target-too-shallow", minimum } };
  }

  if (target > maximum) {
    return { ok: false, block: { kind: "target-too-deep", maximum } };
  }

  if (state.resources.chips < stake) {
    return {
      ok: false,
      block: { kind: "insufficient-chips", required: stake, available: state.resources.chips },
    };
  }

  const wager: DepthWager = {
    wagerId: `wager-${String(state.statistics.depthWagersPlaced + 1)}`,
    stake,
    targetDepth: target,
    multiplier: offeredWagerMultiplier(target, reference, modifiers, luckPoints),
    bestDepthAtPlacement: state.statistics.deepestDepth,
    luckPoints,
  };

  const plan: TransactionPlan = {
    label: `depth-wager:${wager.wagerId}`,
    costs: [{ resource: "chips", amount: stake }],
    grants: [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          depthWager: {
            ...current.gambling.depthWager,
            selectedTargetDepth: target,
            selectedStake: isChipWager(stake) ? stake : current.gambling.depthWager.selectedStake,
            pending: wager,
          },
        },
        statistics: {
          ...current.statistics,
          depthWagersPlaced: current.statistics.depthWagersPlaced + 1,
          chipsWagered: current.statistics.chipsWagered + stake,
        },
      }),
    ],
  };

  const outcome = applyTransaction(state, plan);

  if (!outcome.ok) {
    return { ok: false, block: { kind: "transaction-failed", message: outcome.message } };
  }

  return {
    ok: true,
    state: outcome.state,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.wager.place" },
      {
        type: "SHOW_FEEDBACK",
        tone: "neutral",
        message: `Wager placed: depth ${String(target)} at ${wager.multiplier.toFixed(2)}x. It settles on your next completed run.`,
      },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

export interface DepthWagerSettlement {
  state: GameState;
  effects: DomainEffect[];
  summary: DepthWagerSummary | null;
}

/**
 * Settles a pending wager against a finished run, on either outcome — called
 * from both the extraction and the oxygen failure, so a run that reached the
 * target and then died still pays. An unlaunched wager stays pending and settles
 * against whichever run finishes first.
 */
export function settleDepthWager(state: GameState, depthReached: number): DepthWagerSettlement {
  const pending = state.gambling.depthWager.pending;

  if (pending === null) {
    return { state, effects: [], summary: null };
  }

  const won = depthReached >= pending.targetDepth;
  const payout = won ? Math.floor(pending.stake * pending.multiplier) : 0;

  const summary: DepthWagerSummary = {
    wagerId: pending.wagerId,
    stake: pending.stake,
    targetDepth: pending.targetDepth,
    depthReached,
    multiplier: pending.multiplier,
    payout,
    net: payout - pending.stake,
    won,
  };

  const plan: TransactionPlan = {
    label: `depth-wager-settle:${pending.wagerId}`,
    costs: [],
    grants: payout > 0 ? [{ resource: "chips", amount: payout }] : [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          depthWager: {
            ...current.gambling.depthWager,
            pending: null,
            recentResults: [summary, ...current.gambling.depthWager.recentResults].slice(
              0,
              ECONOMY.recentSpinHistoryLength,
            ),
          },
        },
        statistics: {
          ...current.statistics,
          depthWagersWon: current.statistics.depthWagersWon + (won ? 1 : 0),
          chipsWon: current.statistics.chipsWon + payout,
          chipsEarned: current.statistics.chipsEarned + payout,
        },
      }),
    ],
  };

  const outcome = applyTransaction(state, plan);

  if (!outcome.ok) {
    // Leaving the wager pending is the safe failure: a settlement that could not
    // be paid must not clear the stake as though it had been.
    return {
      state,
      effects: [
        {
          type: "SHOW_FEEDBACK",
          tone: "negative",
          message: `The depth wager could not be settled: ${outcome.message}`,
        },
      ],
      summary: null,
    };
  }

  return {
    state: outcome.state,
    effects: [
      ...(won ? [{ type: "PLAY_SOUND", soundId: "sound.wager.win" } as const] : []),
      {
        type: "SHOW_FEEDBACK",
        tone: won ? "positive" : "negative",
        message: won
          ? `Depth wager paid: depth ${String(pending.targetDepth)} reached for ${String(payout)} chips.`
          : `Depth wager lost: depth ${String(pending.targetDepth)} needed, ${String(depthReached)} reached.`,
      },
    ],
    summary,
  };
}
