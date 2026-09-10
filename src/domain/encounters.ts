/** Encounter generation, weighting, and reward-table resolution. */

import {
  CACHE_REWARDS,
  CAT_ENCOUNTER_ID,
  ECONOMY,
  ENCOUNTERS,
  FIRST_ENCOUNTER_ID,
  REWARD_TABLES,
} from "../content/catalog";
import { CONTRACTS } from "../content/contracts";
import type { ContractId } from "../content/contracts";
import { collectibleArrival } from "./collections";
import { bandForDepth } from "../content/depthBands";
import type {
  EncounterDefinition,
  EncounterId,
  RewardGrant,
  RewardTableEntry,
  RewardTableId,
} from "../content/catalog";
import { earliestIncompleteRecipeMachineId } from "./casino";
import { evaluateStat, luckFactor, type Modifier } from "./modifiers";
import {
  nextChance,
  nextFloat,
  nextIntegerInclusive,
  nextWeighted,
  type RngState,
} from "./rng";
import type { ActiveEncounter, CommittedReward, GameState, PityState, ResolvedGrant } from "./state";

export function encounterDefinition(encounterId: EncounterId): EncounterDefinition {
  return ENCOUNTERS[encounterId];
}

export function eligibleEncounters(depth: number): EncounterDefinition[] {
  const band = bandForDepth(depth);

  return Object.values(ENCOUNTERS).filter(
    (encounter) => encounter.outsideTable !== true && encounter.bands.includes(band.id),
  );
}

function grantsKind(tableId: RewardTableId, kind: RewardGrant["kind"]): boolean {
  return REWARD_TABLES[tableId].entries.some((entry) =>
    entry.grants.some((grant) => grant.kind === kind),
  );
}

/**
 * Whether an encounter can pay a given kind of grant, counting its choice
 * branches as well as its own table. Exported so the Selenite Core's no-oxygen
 * invariant is asserted against the same walk pity uses, rather than a copy of it.
 */
export function encounterCanGrant(
  definition: EncounterDefinition,
  kind: RewardGrant["kind"],
): boolean {
  const tables: RewardTableId[] = [
    ...(definition.rewardTableId ? [definition.rewardTableId] : []),
    ...(definition.choiceOptions ?? []).map((option) => option.rewardTableId),
  ];

  return tables.some((tableId) => grantsKind(tableId, kind));
}

/**
 * Effective selection weight for one encounter. Luck raises weights tagged
 * `beneficial`, totem modifiers apply to their own declared tags, and pity
 * temporarily raises encounters that can supply a needed progression drop.
 * Weights can never become negative.
 */
export function selectEncounterWeight(
  definition: EncounterDefinition,
  modifiers: readonly Modifier[],
  luckPoints: number,
  pity: PityState,
): number {
  const factor = luckFactor(luckPoints);
  const beneficialBoost = definition.beneficialTags.includes("beneficial")
    ? 1 + factor * ECONOMY.luckEncounterWeightStrength
    : 1;

  let weight = evaluateStat(definition.baseWeight * beneficialBoost, modifiers, {
    targetStat: "expedition.encounterWeight",
    tags: definition.beneficialTags,
  });

  const needsRecipe = pity.encountersSinceRecipePiece >= ECONOMY.pityEncounterThreshold;
  const needsRelic = pity.encountersSinceRelic >= ECONOMY.pityEncounterThreshold;

  if (
    (needsRecipe && encounterCanGrant(definition, "recipePiece")) ||
    (needsRelic && encounterCanGrant(definition, "relics"))
  ) {
    weight *= ECONOMY.pityWeightMultiplier;
  }

  return Math.max(0, weight);
}

export interface EncounterGeneration {
  rngState: RngState;
  encounter: ActiveEncounter | null;
}

export function generateEncounter(
  state: GameState,
  rngState: RngState,
  depth: number,
  modifiers: readonly Modifier[],
  luckPoints: number,
  approachSpeed = 1,
): EncounterGeneration {
  const candidates = eligibleEncounters(depth).filter(
    (definition) => !isRecipeOnlyAndComplete(state, definition),
  );

  const options = candidates.map((definition) => ({
    value: definition,
    weight: selectEncounterWeight(definition, modifiers, luckPoints, state.pity),
  }));

  /*
   * The cat is drawn before the table, on its own fixed probability. As a table
   * entry its odds would shift with the eligible pool and with every totem that
   * touches encounter weight; one `nextChance` at a constant is the only
   * construction where "strict 1 in 1000" is literally true.
   */
  const cat = nextChance(rngState, ECONOMY.catEncounterChance);

  if (cat.value) {
    const variance = drawDurationFactor(cat.state);

    return {
      rngState: variance.rngState,
      encounter: createActiveEncounter(
        ENCOUNTERS[CAT_ENCOUNTER_ID],
        variance.factor,
        approachSpeed,
      ),
    };
  }

  const draw = nextWeighted(cat.state, options);

  if (draw.value === null) {
    return { rngState: draw.state, encounter: null };
  }

  /*
   * Every run opens on the same encounter, which teaches the loop before the
   * table starts varying. The override replaces the drawn value rather than
   * skipping the draw, so the stream advances exactly once either way and a seed
   * still reproduces the same run.
   */
  const selected = depth === 0 ? ENCOUNTERS[FIRST_ENCOUNTER_ID] : draw.value;

  const variance = drawDurationFactor(draw.state);

  return {
    rngState: variance.rngState,
    encounter: createActiveEncounter(selected, variance.factor, approachSpeed),
  };
}

/**
 * A rare encounter whose only reward is a recipe piece stops being generated
 * once every recipe is complete, so it cannot crowd out other useful finds.
 */
function isRecipeOnlyAndComplete(state: GameState, definition: EncounterDefinition): boolean {
  if (earliestIncompleteRecipeMachineId(state) !== null) {
    return false;
  }

  const tables: RewardTableId[] = [
    ...(definition.rewardTableId ? [definition.rewardTableId] : []),
    ...(definition.choiceOptions ?? []).map((option) => option.rewardTableId),
  ];

  return (
    tables.length > 0 &&
    tables.every((tableId) =>
      REWARD_TABLES[tableId].entries.every((entry) =>
        entry.grants.every((grant) => grant.kind === "recipePiece"),
      ),
    )
  );
}

/**
 * Scales a duration by a committed random factor, so the cost of an encounter is
 * not exactly learnable. The factor is drawn once at generation and written onto
 * the encounter, so a reload resumes it rather than rerolling.
 */
export function applyDurationVariance(base: number, factor: number): number {
  return Math.max(1, base * factor);
}

export function drawDurationFactor(rngState: RngState): { rngState: RngState; factor: number } {
  const draw = nextFloat(rngState);
  const spread = ECONOMY.encounterDurationVariance;

  return { rngState: draw.state, factor: 1 - spread + draw.value * spread * 2 };
}

export function createActiveEncounter(
  definition: EncounterDefinition,
  durationFactor = 1,
  approachSpeed = 1,
): ActiveEncounter {
  const isOre = definition.family === "ore";

  return {
    encounterId: definition.id,
    approachElapsedMs: 0,
    // Speed shortens the walk only: a faster resolution would be a damage stat
    // under another name.
    approachDurationMs: Math.max(1, definition.approachDurationMs / Math.max(0.25, approachSpeed)),
    resolveElapsedMs: 0,
    strikesTaken: 0,
    // Ore varies durability rather than duration, so break time stays durability
    // divided by damage and a pickaxe upgrade reads as a clean improvement.
    resolveDurationMs: isOre
      ? null
      : applyDurationVariance(definition.resolveDurationMs ?? 0, durationFactor),
    durabilityRemaining: isOre
      ? applyDurationVariance(definition.durability ?? 0, durationFactor)
      : null,
    oxygenDrainMultiplier: definition.oxygenDrainMultiplier,
    chosenOptionId: null,
    committedReward: null,
  };
}

/**
 * Draws one collectible from a pool, using the run's own reward stream and the
 * same weights the Company store draws against, so a find in the rock and a find
 * in a cache are the same draw. How it lands — the item, fragments, or selenite
 * for one that can no longer be improved — is decided here and carried on the
 * grant, so the feedback need not re-derive it from a changed state.
 */
function resolveCollectible(
  state: GameState,
  rngState: RngState,
  pool: "trinket" | "totem" | "any",
): { rngState: RngState; grant: ResolvedGrant | null } {
  const candidates = CACHE_REWARDS.filter(
    (entry) => pool === "any" || entry.reward.kind === pool,
  );

  const draw = nextWeighted(
    rngState,
    candidates.map((entry) => ({ value: entry, weight: entry.weight })),
  );

  if (draw.value === null) {
    return { rngState: draw.state, grant: null };
  }

  return {
    rngState: draw.state,
    grant: {
      kind: "collectible",
      reward: draw.value.reward,
      arrival: collectibleArrival(state, draw.value.reward),
    },
  };
}

/**
 * Accepts a contract, drawing what it will pay in the same breath. The payout is
 * decided now rather than at the target: a contract waits across several
 * encounters, so resolving it on arrival would let a player reload until the
 * roll suited them. The draw runs through `resolveRewardTable` like any other.
 */
function resolveContract(
  state: GameState,
  rngState: RngState,
  contractId: ContractId,
  modifiers: readonly Modifier[],
  depth: number,
): { rngState: RngState; grant: ResolvedGrant } {
  const definition = CONTRACTS[contractId];
  const payout = resolveRewardTable(state, rngState, definition.rewardTableId, modifiers, depth);

  return {
    rngState: payout.rngState,
    grant: {
      kind: "contract",
      contract: {
        contractId,
        startedAtDepth: depth,
        targetDepth: depth + definition.span,
        reward: payout.reward,
      },
    },
  };
}

function resolveGrantAmount(
  rngState: RngState,
  grant: Exclude<RewardGrant, { kind: "collectible" } | { kind: "contract" }>,
  modifiers: readonly Modifier[],
  tags: readonly string[],
): { rngState: RngState; amount: number } {
  const roll = nextIntegerInclusive(rngState, grant.minimum, grant.maximum);

  const quantity = evaluateStat(roll.value, modifiers, {
    targetStat: "expedition.rewardQuantity",
    tags,
  });

  if (grant.kind !== "ore") {
    return { rngState: roll.state, amount: quantity };
  }

  return {
    rngState: roll.state,
    amount: evaluateStat(quantity, modifiers, { targetStat: "expedition.oreYield", tags }),
  };
}

export interface RewardResolution {
  rngState: RngState;
  reward: CommittedReward | null;
}

/**
 * Commits one reward-table result. Called when resolution begins or when a
 * choice is selected, never after the fact.
 */
export function resolveRewardTable(
  state: GameState,
  rngState: RngState,
  tableId: RewardTableId,
  modifiers: readonly Modifier[],
  /** Depth the reward was earned at; recipe pieces are gated on its band. */
  depth = 0,
): RewardResolution {
  const table = REWARD_TABLES[tableId];

  if (table === undefined) {
    return { rngState, reward: null };
  }

  const options = table.entries.map((entry) => ({
    value: entry,
    weight: Math.max(
      0,
      evaluateStat(entry.weight, modifiers, {
        targetStat: "expedition.encounterWeight",
        tags: entry.tags,
      }),
    ),
  }));

  const draw = nextWeighted<RewardTableEntry>(rngState, options);

  if (draw.value === null) {
    return { rngState: draw.state, reward: null };
  }

  const entry = draw.value;
  let current = draw.state;
  const grants: ResolvedGrant[] = [];

  for (const grant of entry.grants) {
    if (grant.kind === "collectible") {
      const drawn = resolveCollectible(state, current, grant.pool);
      current = drawn.rngState;

      if (drawn.grant !== null) {
        grants.push(drawn.grant);
      }

      continue;
    }

    if (grant.kind === "contract") {
      const offered = resolveContract(state, current, grant.contractId, modifiers, depth);

      current = offered.rngState;
      grants.push(offered.grant);
      continue;
    }

    const resolved = resolveGrantAmount(current, grant, modifiers, entry.tags);
    current = resolved.rngState;

    if (resolved.amount <= 0) {
      continue;
    }

    switch (grant.kind) {
      case "ore":
        grants.push({ kind: "ore", grade: grant.grade, amount: resolved.amount });
        break;
      case "oxygen":
        grants.push({ kind: "oxygen", amount: resolved.amount });
        break;
      case "components":
        grants.push({ kind: "components", amount: resolved.amount });
        break;
      case "relics":
        grants.push({ kind: "relics", amount: resolved.amount });
        break;
      case "caches":
        grants.push({ kind: "caches", amount: resolved.amount });
        break;
      case "deepCaches":
        grants.push({ kind: "deepCaches", amount: resolved.amount });
        break;
      case "recipePiece": {
        // A piece belongs to the band it was found in, so diving is the only way
        // to build the deep machines. With that band finished it pays out in
        // components instead, so the find is never silently dropped.
        const band = bandForDepth(depth).id;
        const machineId = earliestIncompleteRecipeMachineId(state, band);

        if (machineId === null) {
          grants.push({
            kind: "components",
            amount: resolved.amount * ECONOMY.recipeFallbackComponentsPerPiece,
          });
        } else {
          grants.push({ kind: "recipePiece", machineId, amount: resolved.amount });
        }

        break;
      }
      default:
        break;
    }
  }

  return {
    rngState: current,
    reward: { tableId, entryId: entry.id, tags: [...entry.tags], grants },
  };
}
