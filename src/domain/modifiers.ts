/**
 * The single evaluation pipeline every modified value passes through.
 *
 * Order: base value, additive modifiers, multiplicative modifiers,
 * stat clamp, then one stat-specific rounding step.
 */

import { ECONOMY, PRESTIGE_PERKS, TOTEMS, TRINKETS } from "../content/catalog";
import type { PrestigePerkId, TotemDefinition } from "../content/catalog";
import { STAT_RULES, type Modifier, type ModifierOperation, type StatId } from "../content/economy";
import { scaleModifiers, scaleModifierBy } from "../content/grades";
import { isFiniteNumber } from "./numbers";
import type { GameState } from "./state";

export type { Modifier, ModifierOperation, StatId };

export interface ModifierContribution {
  sourceId: string;
  operation: ModifierOperation;
  value: number;
  /** Value of the stat immediately after this contribution was applied. */
  runningValue: number;
}

export interface ModifierBreakdown {
  targetStat: StatId;
  baseValue: number;
  contributions: ModifierContribution[];
  afterAdditive: number;
  afterMultiplicative: number;
  afterClamp: number;
  finalValue: number;
}

export interface ModifierQuery {
  targetStat: StatId;
  /** A tagged modifier applies only when one of its tags appears here. */
  tags?: readonly string[];
}

function applies(modifier: Modifier, query: ModifierQuery): boolean {
  if (modifier.targetStat !== query.targetStat) {
    return false;
  }

  if (modifier.tags === undefined || modifier.tags.length === 0) {
    return true;
  }

  const contextTags = query.tags ?? [];

  return modifier.tags.some((tag) => contextTags.includes(tag));
}

function round(value: number, rule: (typeof STAT_RULES)[StatId]): number {
  switch (rule.rounding) {
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
    case "round":
      return Math.round(value);
    default:
      return value;
  }
}

/**
 * Applies a stat's own rounding rule to a loose value. Exported so a breakdown
 * can round its base the way `explainStat` rounds the final value; comparing a
 * raw base against a rounded final would report the rounding as a modifier.
 */
export function roundStat(value: number, targetStat: StatId): number {
  const rule = STAT_RULES[targetStat];

  return isFiniteNumber(value) ? round(value, rule) : (rule.minimum ?? 0);
}

export function explainStat(
  baseValue: number,
  modifiers: readonly Modifier[],
  query: ModifierQuery,
): ModifierBreakdown {
  const rule = STAT_RULES[query.targetStat];
  const relevant = modifiers.filter((modifier) => applies(modifier, query));
  const contributions: ModifierContribution[] = [];

  let running = isFiniteNumber(baseValue) ? baseValue : 0;

  for (const modifier of relevant) {
    if (modifier.operation !== "add" || !isFiniteNumber(modifier.value)) {
      continue;
    }

    running += modifier.value;
    contributions.push({
      sourceId: modifier.sourceId,
      operation: "add",
      value: modifier.value,
      runningValue: running,
    });
  }

  const afterAdditive = running;

  for (const modifier of relevant) {
    if (modifier.operation !== "multiply" || !isFiniteNumber(modifier.value)) {
      continue;
    }

    running *= modifier.value;
    contributions.push({
      sourceId: modifier.sourceId,
      operation: "multiply",
      value: modifier.value,
      runningValue: running,
    });
  }

  const afterMultiplicative = running;

  if (rule.minimum !== undefined) {
    running = Math.max(running, rule.minimum);
  }

  if (rule.maximum !== undefined) {
    running = Math.min(running, rule.maximum);
  }

  const afterClamp = running;
  const finalValue = isFiniteNumber(running) ? round(running, rule) : (rule.minimum ?? 0);

  return {
    targetStat: query.targetStat,
    baseValue,
    contributions,
    afterAdditive,
    afterMultiplicative,
    afterClamp,
    finalValue,
  };
}

export function evaluateStat(
  baseValue: number,
  modifiers: readonly Modifier[],
  query: ModifierQuery,
): number {
  return explainStat(baseValue, modifiers, query).finalValue;
}

/** Collects the modifiers relevant to one stat, for tooltip rendering. */
export function selectModifiers(
  modifiers: readonly Modifier[],
  query: ModifierQuery,
): Modifier[] {
  return modifiers.filter((modifier) => applies(modifier, query));
}

/**
 * Every modifier currently supplied by equipped trinkets, active totems, and
 * purchased prestige perks.
 *
 * Only trinkets sitting in a slot contribute. Relocked slots are emptied when
 * they relock, so no slot-count arithmetic is needed here.
 */
export function collectActiveModifiers(state: GameState): Modifier[] {
  const modifiers: Modifier[] = [];

  const equipped = [...state.gear.tankTrinketSlots, ...state.gear.pickaxeTrinketSlots];

  for (const trinketId of equipped) {
    if (trinketId === null) {
      continue;
    }

    const definition = TRINKETS[trinketId];
    const progress = state.collection.trinkets[trinketId];

    if (definition === undefined || progress === undefined || !progress.owned) {
      continue;
    }

    modifiers.push(...scaleModifiers(definition.baseModifiers, progress.grade));
  }

  for (const totemId of state.collection.activeTotemIds) {
    if (totemId === null) {
      continue;
    }

    const definition = TOTEMS[totemId];
    const progress = state.collection.totems[totemId];

    if (definition === undefined || progress === undefined || !progress.owned) {
      continue;
    }

    modifiers.push(...scaleModifiers(definition.baseModifiers, progress.grade));
  }

  // Cats: a permanent, prestige-proof luck source with no slot and no cost.
  if (state.statistics.catsFound > 0) {
    modifiers.push({
      sourceId: "cats",
      targetStat: "luck",
      operation: "add",
      value: state.statistics.catsFound * ECONOMY.luckPerCat,
    });
  }

  // A perk's rank scales its authored effect through the same function the grade
  // ladder uses, but on a linear curve: rank 3 is three times the effect.
  for (const [perkId, rank] of Object.entries(state.prestige.perkRanks)) {
    const perk = PRESTIGE_PERKS[perkId as PrestigePerkId];

    if (perk === undefined || rank === undefined || rank <= 0) {
      continue;
    }

    for (const modifier of perk.modifiers) {
      modifiers.push(scaleModifierBy(modifier, rank, String(rank)));
    }
  }

  return modifiers;
}

/** Total luck in points, before the diminishing-return curve. */
export function selectLuckPoints(modifiers: readonly Modifier[]): number {
  return evaluateStat(0, modifiers, { targetStat: "luck" });
}

/**
 * Converts luck points to a 0..1 factor with diminishing returns. Weight and
 * return curves consume the factor, never the raw points.
 */
export function luckFactor(luckPoints: number): number {
  const points = Math.max(0, Math.min(luckPoints, ECONOMY.luckPointCap));

  return points / (points + ECONOMY.luckDiminishingHalfPoint);
}

/**
 * Whether an equipped, owned totem grants the given capability. Read from the
 * equipped totems, not the modifier list: a capability is not a stat. Content
 * validation keeps each capability to one totem, so this is a lookup.
 */
export function selectTotemCapability(
  state: GameState,
  capability: NonNullable<TotemDefinition["capability"]>,
): boolean {
  return state.collection.activeTotemIds.some((totemId) => {
    if (totemId === null) {
      return false;
    }

    return (
      TOTEMS[totemId]?.capability === capability &&
      (state.collection.totems[totemId]?.owned ?? false)
    );
  });
}

/** Whether an equipped totem answers choice encounters on the player's behalf. */
export function selectResolvesChoices(state: GameState): boolean {
  return selectTotemCapability(state, "resolve-choices");
}

/** Whether an equipped totem names the next encounter before it is reached. */
export function selectForecastsEncounters(state: GameState): boolean {
  return selectTotemCapability(state, "forecast-encounter");
}
