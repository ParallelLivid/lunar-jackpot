/**
 * Vacuum roulette: the same state machine as the slot game — commit a stake,
 * decide one outcome, animate, pay — with a wheel in place of the reels. Payout
 * multipliers are the published European ones and luck never touches them; it
 * leans the wheel toward the pockets the player backed, through `luckBias.ts`.
 */

import { ECONOMY } from "../content/catalog";
import { isChipWager, isStakeable } from "../content/chipGames";
import {
  ROULETTE_BETS,
  ROULETTE_LUCK_POCKET_BIAS,
  ROULETTE_POCKET_COUNT,
  ROULETTE_SPIN_DURATION_MS,
  isRoulettePocket,
  winningPockets,
  type RouletteBetId,
} from "../content/roulette";
import type { DomainEffect } from "./commands";
import {
  baseWeightsOf,
  blendToCap,
  blendWeightMaps,
  luckBiasedWeights,
  weightProbabilities,
  type BiasableOutcome,
  type WeightMap,
} from "./luckBias";
import type { Modifier } from "./modifiers";
import { nextWeighted, type RngState, type WeightedOption } from "./rng";
import type { CommittedRouletteBet, GameState, RouletteSummary } from "./state";
import { applyTransaction, type TransactionPlan } from "./transactions";

/** Keyed by pocket number written as a string, which is what a weight map needs. */
export type PocketWeights = WeightMap<string>;

export const ROULETTE_POCKETS: readonly number[] = Array.from(
  { length: ROULETTE_POCKET_COUNT },
  (_, pocket) => pocket,
);

/**
 * The wheel as an outcome set, built per bet rather than once: no pocket is
 * favourable until there is a bet for luck to lean toward.
 */
function pocketOutcomes(
  betTypeId: RouletteBetId,
  straightNumber: number,
): ReadonlyArray<BiasableOutcome<string>> {
  const winners = new Set(winningPockets(betTypeId, straightNumber));

  return ROULETTE_POCKETS.map((pocket) => ({
    id: String(pocket),
    baseWeight: 1,
    luckWeightBias: winners.has(pocket) ? ROULETTE_LUCK_POCKET_BIAS : 0,
    // The same tag the paying slot symbols carry, so a modifier written against
    // "paying" outcomes means the same thing in both games.
    tags: winners.has(pocket) ? ["paying"] : [],
  }));
}

/** Expected return per chip staked, exactly: the multiplier times P(win). */
export function rouletteExpectedReturn(
  weights: PocketWeights,
  betTypeId: RouletteBetId,
  straightNumber: number,
): number {
  const probabilities = weightProbabilities(weights);

  return (
    ROULETTE_BETS[betTypeId].multiplier *
    winningPockets(betTypeId, straightNumber).reduce(
      (total, pocket) => total + (probabilities[String(pocket)] ?? 0),
      0,
    )
  );
}

/**
 * The wheel this bet will actually be spun on, capped per bet: a single-pocket
 * bias moves the return much further per unit of weight than an even-money one,
 * so one cap for the whole wheel would leave the cheap bets uncapped.
 */
export function selectWheelWeights(
  modifiers: readonly Modifier[],
  luckPoints: number,
  betTypeId: RouletteBetId,
  straightNumber: number,
): PocketWeights {
  const outcomes = pocketOutcomes(betTypeId, straightNumber);

  return blendToCap(
    baseWeightsOf(outcomes),
    luckBiasedWeights(outcomes, modifiers, luckPoints),
    ECONOMY.gamblingMaxExpectedReturn,
    blendWeightMaps,
    (weights) => rouletteExpectedReturn(weights, betTypeId, straightNumber),
  );
}

export function selectRouletteExpectedReturn(
  modifiers: readonly Modifier[],
  luckPoints: number,
  betTypeId: RouletteBetId,
  straightNumber: number,
): number {
  return rouletteExpectedReturn(
    selectWheelWeights(modifiers, luckPoints, betTypeId, straightNumber),
    betTypeId,
    straightNumber,
  );
}

export interface WheelDraw {
  rngState: RngState;
  pocket: number;
}

export function spinWheel(rngState: RngState, weights: PocketWeights): WheelDraw {
  const options: Array<WeightedOption<number>> = ROULETTE_POCKETS.map((pocket) => ({
    value: pocket,
    weight: weights[String(pocket)] ?? 0,
  }));

  const draw = nextWeighted(rngState, options);

  return { rngState: draw.state, pocket: draw.value ?? 0 };
}

/** Fixed payout rule: the bet's published multiplier, or nothing. */
export function roulettePayoutMultiplier(
  betTypeId: RouletteBetId,
  straightNumber: number,
  pocket: number,
): number {
  return winningPockets(betTypeId, straightNumber).includes(pocket)
    ? ROULETTE_BETS[betTypeId].multiplier
    : 0;
}

export type RouletteBlock =
  | { kind: "spin-in-progress" }
  | { kind: "unknown-wager" }
  | { kind: "unknown-bet" }
  | { kind: "insufficient-chips"; required: number; available: number }
  | { kind: "no-committed-spin" }
  | { kind: "wrong-spin" }
  | { kind: "transaction-failed"; message: string };

export type RouletteOutcome =
  | { ok: true; state: GameState; effects: DomainEffect[] }
  | { ok: false; block: RouletteBlock };

/**
 * Deducts the stake and commits the pocket in one transaction. The wheel then
 * animates toward a result that already exists.
 */
export function startRouletteSpin(
  state: GameState,
  wager: number,
  modifiers: readonly Modifier[],
  luckPoints: number,
): RouletteOutcome {
  const roulette = state.gambling.roulette;

  if (roulette.committedBet !== null) {
    return { ok: false, block: { kind: "spin-in-progress" } };
  }

  if (!isStakeable(wager)) {
    return { ok: false, block: { kind: "unknown-wager" } };
  }

  const betTypeId = roulette.selectedBetTypeId;

  if (ROULETTE_BETS[betTypeId] === undefined) {
    return { ok: false, block: { kind: "unknown-bet" } };
  }

  const straightNumber = isRoulettePocket(roulette.selectedNumber) ? roulette.selectedNumber : 0;

  if (state.resources.chips < wager) {
    return {
      ok: false,
      block: { kind: "insufficient-chips", required: wager, available: state.resources.chips },
    };
  }

  const weights = selectWheelWeights(modifiers, luckPoints, betTypeId, straightNumber);
  const draw = spinWheel(state.random.gambling, weights);
  const multiplier = roulettePayoutMultiplier(betTypeId, straightNumber, draw.pocket);
  const payout = Math.floor(wager * multiplier);
  const betId = `roulette-${String(state.statistics.rouletteSpinsPlayed + 1)}`;

  const committedBet: CommittedRouletteBet = {
    betId,
    gameId: "game.roulette",
    betTypeId,
    straightNumber,
    wager,
    pocket: draw.pocket,
    multiplier,
    payout,
    luckPoints,
    animationRemainingMs: ROULETTE_SPIN_DURATION_MS,
  };

  const plan: TransactionPlan = {
    label: `roulette:${betId}`,
    costs: [{ resource: "chips", amount: wager }],
    grants: [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          roulette: {
            ...current.gambling.roulette,
            selectedWager: isChipWager(wager)
              ? wager
              : current.gambling.roulette.selectedWager,
            committedBet,
          },
        },
        random: { ...current.random, gambling: draw.rngState },
        statistics: {
          ...current.statistics,
          rouletteSpinsPlayed: current.statistics.rouletteSpinsPlayed + 1,
          chipsWagered: current.statistics.chipsWagered + wager,
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
      { type: "PLAY_SOUND", soundId: "sound.roulette.spin" },
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

/** Settles a committed wheel exactly once, granting winnings if any. */
export function completeRouletteSpin(state: GameState, betId: string): RouletteOutcome {
  const committed = state.gambling.roulette.committedBet;

  if (committed === null) {
    return { ok: false, block: { kind: "no-committed-spin" } };
  }

  if (committed.betId !== betId) {
    return { ok: false, block: { kind: "wrong-spin" } };
  }

  const summary: RouletteSummary = {
    betId: committed.betId,
    gameId: "game.roulette",
    betTypeId: committed.betTypeId,
    straightNumber: committed.straightNumber,
    pocket: committed.pocket,
    wager: committed.wager,
    payout: committed.payout,
    net: committed.payout - committed.wager,
  };

  const plan: TransactionPlan = {
    label: `roulette-settle:${betId}`,
    costs: [],
    grants: committed.payout > 0 ? [{ resource: "chips", amount: committed.payout }] : [],
    stateMutations: [
      (current) => ({
        ...current,
        gambling: {
          ...current.gambling,
          roulette: {
            ...current.gambling.roulette,
            committedBet: null,
            recentResults: [summary, ...current.gambling.roulette.recentResults].slice(
              0,
              ECONOMY.recentSpinHistoryLength,
            ),
          },
        },
        statistics: {
          ...current.statistics,
          chipsWon: current.statistics.chipsWon + committed.payout,
          chipsEarned: current.statistics.chipsEarned + committed.payout,
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
      ...(committed.payout > 0
        ? [{ type: "PLAY_SOUND", soundId: "sound.roulette.win" } as const]
        : []),
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

/** Advances only the wheel animation clock; the pocket is already decided. */
export function tickRouletteAnimation(state: GameState, elapsedMs: number): GameState {
  const committed = state.gambling.roulette.committedBet;

  if (committed === null || elapsedMs <= 0) {
    return state;
  }

  return {
    ...state,
    gambling: {
      ...state.gambling,
      roulette: {
        ...state.gambling.roulette,
        committedBet: {
          ...committed,
          animationRemainingMs: Math.max(0, committed.animationRemainingMs - elapsedMs),
        },
      },
    },
  };
}
