/**
 * The expedition state machine: launch, approach, decision, resolution,
 * extraction, and oxygen failure.
 *
 * Every transition here is pure. Animation never decides oxygen, damage, or
 * rewards; it only reads the progress values this module produces.
 */

import {
  CAT_ENCOUNTER_ID,
  ECONOMY,
  ENCOUNTERS,
  EXPEDITION_MODIFIERS,
  ORE_GRADES,
  ORE_GRADE_IDS,
} from "../content/catalog";
import type { ExpeditionModifierDefinition, ExpeditionModifierId } from "../content/catalog";
import { DEFAULT_CAT_SKIN_IDS } from "../content/catSkins";
import { heldConsumableModifiers } from "./consumables";
import { DEPTH_BAND_IDS, bandForDepth } from "../content/depthBands";
import type { EncounterDefinition, MachineId, OreGradeId } from "../content/catalog";
import type { DomainEffect, RunSummary } from "./commands";
import {
  applyDurationVariance,
  drawDurationFactor,
  generateEncounter,
  resolveRewardTable,
} from "./encounters";
import { grantCollectible } from "./collections";
import { settleDepthWager } from "./depthWager";
import { selectMaxOxygen, selectPickaxeDamage } from "./gear";
import {
  collectActiveModifiers,
  evaluateStat,
  selectForecastsEncounters,
  selectLuckPoints,
  selectResolvesChoices,
  type Modifier,
} from "./modifiers";
import { clamp } from "./numbers";
import {
  createRunRngStreams,
  nextBinomial,
  nextChance,
  nextFloat,
  nextIntegerInclusive,
  nextWeighted,
  type RngState,
  type RunRngStreams,
} from "./rng";
import type {
  ActiveEncounter,
  ExpeditionState,
  FailureResult,
  GameState,
  ResolvedGrant,
  RunInventory,
  RunModifierSnapshot,
} from "./state";
import { createEmptyRunInventory, createSurfaceExpeditionState } from "./state";
import { applyTransaction, type ResourceDelta, type TransactionPlan } from "./transactions";

export interface ExpeditionStepResult {
  state: GameState;
  effects: DomainEffect[];
}

export type ExpeditionBlock =
  | { kind: "not-on-surface" }
  | { kind: "not-in-decision" }
  | { kind: "banking-locked"; target: number; remaining: number }
  | { kind: "not-in-choice" }
  | { kind: "unknown-option" }
  | { kind: "bank-failed"; message: string };

export type ExpeditionOutcome =
  | { ok: true; state: GameState; effects: DomainEffect[] }
  | { ok: false; block: ExpeditionBlock };

/** Loss probability applied independently to each unbanked resource unit. */
export function selectFailureLossChance(modifiers: readonly Modifier[]): number {
  return evaluateStat(ECONOMY.failureLossChanceBase, modifiers, {
    targetStat: "expedition.failureLossChance",
  });
}

export function selectOreChipValues(
  modifiers: readonly Modifier[],
): Record<OreGradeId, number> {
  return ORE_GRADE_IDS.reduce(
    (values, grade) => {
      values[grade] = evaluateStat(ORE_GRADES[grade].chipValue, modifiers, {
        targetStat: "economy.oreChipValue",
      });

      return values;
    },
    {} as Record<OreGradeId, number>,
  );
}

export function createRunModifierSnapshot(
  modifiers: readonly Modifier[],
  resolvesChoices = false,
  forecastsEncounters = false,
): RunModifierSnapshot {
  return {
    modifiers: [...modifiers],
    luckPoints: selectLuckPoints(modifiers),
    failureLossChance: selectFailureLossChance(modifiers),
    oreChipValues: selectOreChipValues(modifiers),
    oxygenDrainRate: evaluateStat(1, modifiers, { targetStat: "expedition.oxygenDrainRate" }),
    approachSpeed: evaluateStat(1, modifiers, { targetStat: "expedition.approachSpeed" }),
    pickaxeCritChance: evaluateStat(0, modifiers, { targetStat: "gear.pickaxeCritChance" }),
    resolvesChoices,
    forecastsEncounters,
  };
}

/** The condition's name, for a summary that has to read after the fact. */
function modifierNameOf(id: ExpeditionModifierId | null): string | null {
  return id === null ? null : (EXPEDITION_MODIFIERS[id]?.displayName ?? null);
}

function snapshotModifiers(expedition: ExpeditionState): Modifier[] {
  return expedition.modifierSnapshot?.modifiers ?? [];
}

/**
 * The run's modifiers, plus anything that depends on how deep it currently is.
 * Everything else is snapshotted at launch, but deep quota cannot be — "worth
 * more the deeper you take it" is the whole effect. Used only where a reward is
 * resolved; encounter generation keeps the plain snapshot.
 */
function rewardModifiers(expedition: ExpeditionState): Modifier[] {
  const modifiers = snapshotModifiers(expedition);
  const definition =
    expedition.activeModifierId === null
      ? undefined
      : EXPEDITION_MODIFIERS[expedition.activeModifierId];
  const perDepth = definition?.rewardPerDepth ?? 0;

  if (perDepth <= 0 || expedition.depth <= 0) {
    return modifiers;
  }

  return [
    ...modifiers,
    {
      sourceId: definition?.id ?? "expedition.depth",
      targetStat: "expedition.rewardQuantity",
      operation: "multiply",
      // Compounding, so each depth is worth slightly more than the last.
      value: (1 + perDepth) ** expedition.depth,
    },
  ];
}

function withExpedition(state: GameState, expedition: ExpeditionState): GameState {
  return { ...state, expedition };
}

function cloneRunInventory(inventory: RunInventory): RunInventory {
  return {
    ore: { ...inventory.ore },
    components: inventory.components,
    relics: inventory.relics,
    recipePieces: { ...inventory.recipePieces },
    caches: inventory.caches,
    deepCaches: inventory.deepCaches,
  };
}

export function runInventoryIsEmpty(inventory: RunInventory): boolean {
  return (
    inventory.components === 0 &&
    inventory.relics === 0 &&
    inventory.caches === 0 &&
    inventory.deepCaches === 0 &&
    ORE_GRADE_IDS.every((grade) => inventory.ore[grade] === 0) &&
    Object.values(inventory.recipePieces).every((count) => count === 0)
  );
}

/** Applies committed grants to the run inventory and to oxygen. */
function applyGrants(
  expedition: ExpeditionState,
  grants: readonly ResolvedGrant[],
): ExpeditionState {
  const inventory = cloneRunInventory(expedition.runInventory);
  let oxygen = expedition.oxygen;
  let contract = expedition.activeContract;

  for (const grant of grants) {
    switch (grant.kind) {
      case "contract":
        // One at a time: a run already carrying a contract keeps it, so a new
        // offer cannot silently replace a goal part-way through.
        contract = contract ?? grant.contract;
        break;
      case "ore":
        inventory.ore[grant.grade] += grant.amount;
        break;
      case "components":
        inventory.components += grant.amount;
        break;
      case "relics":
        inventory.relics += grant.amount;
        break;
      case "caches":
        inventory.caches += grant.amount;
        break;
      case "deepCaches":
        inventory.deepCaches += grant.amount;
        break;
      case "recipePiece":
        inventory.recipePieces[grant.machineId] =
          (inventory.recipePieces[grant.machineId] ?? 0) + grant.amount;
        break;
      case "oxygen":
        // Restoration can never exceed the tank snapshot taken at launch.
        oxygen = Math.min(expedition.maxOxygenSnapshot, oxygen + grant.amount);
        break;
      default:
        break;
    }
  }

  return { ...expedition, runInventory: inventory, oxygen, activeContract: contract };
}

/**
 * Pays a contract whose target the run has just reached, or leaves it alone. The
 * reward was drawn at acceptance, so this only hands over what was decided.
 */
function settleContract(expedition: ExpeditionState): {
  expedition: ExpeditionState;
  grants: ResolvedGrant[];
} {
  const contract = expedition.activeContract;

  if (contract === null || expedition.depth < contract.targetDepth) {
    return { expedition, grants: [] };
  }

  const grants = contract.reward?.grants ?? [];

  return {
    expedition: applyGrants({ ...expedition, activeContract: null }, grants),
    grants,
  };
}

function updatePity(state: GameState, grants: readonly ResolvedGrant[]): GameState {
  const gotRecipe = grants.some((grant) => grant.kind === "recipePiece");
  const gotRelic = grants.some((grant) => grant.kind === "relics");

  return {
    ...state,
    pity: {
      encountersSinceRecipePiece: gotRecipe ? 0 : state.pity.encountersSinceRecipePiece + 1,
      encountersSinceRelic: gotRelic ? 0 : state.pity.encountersSinceRelic + 1,
    },
  };
}

function activeDrainMultiplier(
  encounter: ActiveEncounter,
  definition: EncounterDefinition,
): number {
  if (encounter.chosenOptionId === null) {
    return encounter.oxygenDrainMultiplier;
  }

  const option = definition.choiceOptions?.find((entry) => entry.id === encounter.chosenOptionId);

  return option?.oxygenDrainMultiplier ?? encounter.oxygenDrainMultiplier;
}

function drainOxygen(
  oxygen: number,
  elapsedMs: number,
  multiplier: number,
  drainRate: number,
): number {
  const seconds = Math.max(0, elapsedMs) / 1000;

  return oxygen - seconds * ECONOMY.baseOxygenDrainPerSecond * multiplier * drainRate;
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * Rolls this run's condition, if it gets one: one draw for whether there is a
 * modifier and one for which. The pool is filtered to what the player has
 * already reached, since the roll happens at depth zero.
 */
function rollExpeditionModifier(
  state: GameState,
  rngState: RngState,
): { rngState: RngState; definition: ExpeditionModifierDefinition | null } {
  const chance = nextChance(rngState, ECONOMY.expeditionModifierChance);

  if (!chance.value) {
    return { rngState: chance.state, definition: null };
  }

  const reached = bandForDepth(state.statistics.deepestDepth);
  const reachedIndex = DEPTH_BAND_IDS.indexOf(reached.id);
  const candidates = Object.values(EXPEDITION_MODIFIERS).filter(
    (definition) =>
      DEPTH_BAND_IDS.indexOf(definition.requiredBand) <= reachedIndex &&
      // `requiredBand` reads lifetime deepest depth, which survives a prestige
      // that resets gear to level 1. This second gate asks what the player can
      // do now, so a run-losing condition cannot land on starter gear.
      state.statistics.deepestDepthThisCycle >= (definition.minimumDepthThisCycle ?? 0),
  );

  const draw = nextWeighted(
    chance.state,
    candidates.map((definition) => ({ value: definition, weight: definition.weight })),
  );

  return { rngState: draw.state, definition: draw.value };
}

export function launchExpedition(state: GameState): ExpeditionOutcome {
  if (state.expedition.status !== "surface") {
    return { ok: false, block: { kind: "not-on-surface" } };
  }

  const seedDraw = nextFloat(state.random.expeditionSeeds);
  const seed = Math.floor(seedDraw.value * 0x1_0000_0000) >>> 0;
  const runNumber = state.random.nextExpeditionSeedCounter + 1;

  const runStreams = createRunRngStreams(seed);
  const rolled = rollExpeditionModifier(state, runStreams["expedition-generation"]);

  // The condition joins the loadout before anything is snapshotted, so it reaches
  // max oxygen, the failure roll and every reward, and cannot change mid-run.
  const modifiers = [
    ...collectActiveModifiers(state),
    ...(rolled.definition?.modifiers ?? []),
    /*
     * Consumables join for the same reason the condition does: everything
     * downstream reads the snapshot, so folding them in here makes them work
     * without anything else knowing they exist. They are spent here rather than
     * on the way back, so a run that fails has still paid for them.
     */
    ...heldConsumableModifiers(state),
  ];
  const snapshot = createRunModifierSnapshot(
    modifiers,
    selectResolvesChoices(state),
    selectForecastsEncounters(state),
  );
  const maxOxygen = selectMaxOxygen(state, modifiers);
  const pickaxeDamage = selectPickaxeDamage(state, modifiers);

  const expedition: ExpeditionState = {
    ...createSurfaceExpeditionState(),
    status: "launching",
    runId: `run-${state.prestige.count}-${runNumber}`,
    seed,
    rngStreams: { ...runStreams, "expedition-generation": rolled.rngState },
    depth: 0,
    oxygen: maxOxygen,
    maxOxygenSnapshot: maxOxygen,
    pickaxeDamageSnapshot: pickaxeDamage,
    modifierSnapshot: snapshot,
    activeModifierId: rolled.definition?.id ?? null,
    transitionRemainingMs: ECONOMY.launchTransitionMs,
  };

  return {
    ok: true,
    state: {
      ...state,
      expedition,
      random: {
        ...state.random,
        expeditionSeeds: seedDraw.state,
        nextExpeditionSeedCounter: runNumber,
      },
      statistics: { ...state.statistics, runsLaunched: state.statistics.runsLaunched + 1 },
      onboarding: { ...state.onboarding, hasLaunchedExpedition: true },
      // Emptied in the same expression that snapshotted them, so there is no
      // state in which one has been spent but not applied, or the reverse.
      heldConsumableIds: [],
    },
    effects: [
      { type: "CLEAR_RUN_SUMMARY" },
      { type: "PLAY_SOUND", soundId: "sound.control.confirm" },
      { type: "REQUEST_SAVE", immediate: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// Decision transitions
// ---------------------------------------------------------------------------

/**
 * Starts resolving the encounter the player has just reached. There is no
 * accept-or-decline step: arriving commits the player, and the only choice is
 * what to do after it resolves.
 */
function beginResolution(state: GameState): GameState {
  const expedition = state.expedition;

  if (expedition.currentEncounter === null || expedition.rngStreams === null) {
    return state;
  }

  const definition = ENCOUNTERS[expedition.currentEncounter.encounterId];

  // A choice encounter still asks how to take it, never whether to take it.
  if (definition.resolutionMode === "choice") {
    const answered = autoResolveChoice(state, definition);

    return answered ?? withExpedition(state, { ...expedition, status: "choice" });
  }

  /*
   * An encounter with no reward table is its own reward and resolves on its
   * timer with nothing committed — the cat is the only one. It must still move
   * to `resolving`: returning the state unchanged would leave the arrival
   * condition true and retry the encounter every tick until the run ran out of
   * oxygen. `committedReward: null` is what the reward branch already expects.
   */
  if (definition.rewardTableId === undefined) {
    return withExpedition(state, {
      ...expedition,
      status: "resolving",
      currentEncounter: {
        ...expedition.currentEncounter,
        resolveElapsedMs: 0,
        committedReward: null,
      },
    });
  }

  // Commit the reward before any resolution animation begins.
  const resolution = resolveRewardTable(
    state,
    expedition.rngStreams["expedition-rewards"],
    definition.rewardTableId,
    rewardModifiers(expedition),
    expedition.depth,
  );

  return withExpedition(state, {
    ...expedition,
    status: "resolving",
    rngStreams: { ...expedition.rngStreams, "expedition-rewards": resolution.rngState },
    currentEncounter: {
      ...expedition.currentEncounter,
      resolveElapsedMs: 0,
      committedReward: resolution.reward,
    },
  });
}

/**
 * Presses on to the next encounter after a reward has landed. This and
 * `returnFromExpedition` are the only two moves available in `decision`.
 */
export function continueExpedition(state: GameState): ExpeditionOutcome {
  const expedition = state.expedition;

  if (expedition.status !== "decision") {
    return { ok: false, block: { kind: "not-in-decision" } };
  }

  const depth = expedition.depth + 1;

  // A contract settles on arrival at its target, before the next encounter is
  // generated, so the payout belongs to the descent that earned it.
  const settled = settleContract({ ...expedition, depth });
  const descended = beginApproach(
    withExpedition(state, {
      ...settled.expedition,
      currentEncounter: null,
      transitionRemainingMs: 0,
    }),
  );

  return {
    ok: true,
    // Recorded even on a run that never comes home: reaching a depth unlocks the
    // modifiers gated on it, and failing there does not undo that.
    state: {
      ...descended,
      statistics: {
        ...descended.statistics,
        deepestDepth: Math.max(descended.statistics.deepestDepth, depth),
        deepestDepthThisCycle: Math.max(descended.statistics.deepestDepthThisCycle, depth),
        // One per descent, so this counts distance travelled rather than the
        // furthest point reached, which is what the cache gate wants.
        depthDescended: descended.statistics.depthDescended + 1,
      },
    },
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.control.confirm" },
      // A contract that just paid announces itself through the reward lane, so
      // it reads as a reward rather than a message.
      ...(settled.grants.length > 0
        ? ([
            { type: "PLAY_SOUND", soundId: "sound.reward.pickup" },
            { type: "SHOW_ENCOUNTER_REWARD", grants: settled.grants, oxygenDelta: 0 },
          ] as const)
        : []),
    ],
  };
}

/**
 * Draws the encounter one step down so the decision can name it — the one
 * sanctioned exception to committing to an encounter sight unseen, paid for with
 * a totem slot.
 *
 * Not a peek at a future roll: the draw happens here instead of in
 * `beginApproach`, not as well as, so the stream advances exactly once per
 * descent and pressing on delivers the encounter that was named. A run without
 * the totem never reaches this, so its generation order is untouched.
 */
function withForecast(state: GameState): GameState {
  const expedition = state.expedition;

  if (
    !(expedition.modifierSnapshot?.forecastsEncounters ?? false) ||
    expedition.forecastEncounter !== null ||
    expedition.rngStreams === null
  ) {
    return state;
  }

  const generation = generateEncounter(
    state,
    expedition.rngStreams["expedition-generation"],
    expedition.depth + 1,
    snapshotModifiers(expedition),
    expedition.modifierSnapshot?.luckPoints ?? 0,
    expedition.modifierSnapshot?.approachSpeed ?? 1,
  );

  return withExpedition(state, {
    ...expedition,
    rngStreams: {
      ...expedition.rngStreams,
      "expedition-generation": generation.rngState,
    },
    forecastEncounter: generation.encounter,
  });
}

/**
 * The dowsing bone answering a fork, or null when nothing is equipped to. It
 * draws uniformly and knows nothing about what the options are worth, which is
 * the trade the totem sells. The draw comes off the generation stream, so the
 * answer belongs to the run's seed rather than to frame timing.
 */
function autoResolveChoice(
  state: GameState,
  definition: EncounterDefinition,
): GameState | null {
  const expedition = state.expedition;
  const options = definition.choiceOptions ?? [];

  if (!(expedition.modifierSnapshot?.resolvesChoices ?? false) || options.length === 0) {
    return null;
  }

  if (expedition.rngStreams === null) {
    return null;
  }

  const draw = nextFloat(expedition.rngStreams["expedition-generation"]);
  const picked = options[Math.min(options.length - 1, Math.floor(draw.value * options.length))];

  const advanced = withExpedition(state, {
    ...expedition,
    status: "choice",
    rngStreams: { ...expedition.rngStreams, "expedition-generation": draw.state },
  });
  const outcome = chooseEncounterOption(advanced, picked.id);

  return outcome.ok ? outcome.state : null;
}

export function chooseEncounterOption(state: GameState, optionId: string): ExpeditionOutcome {
  const expedition = state.expedition;

  if (
    expedition.status !== "choice" ||
    expedition.currentEncounter === null ||
    expedition.rngStreams === null
  ) {
    return { ok: false, block: { kind: "not-in-choice" } };
  }

  const definition = ENCOUNTERS[expedition.currentEncounter.encounterId];
  const option = definition.choiceOptions?.find((entry) => entry.id === optionId);

  if (option === undefined) {
    return { ok: false, block: { kind: "unknown-option" } };
  }

  const resolution = resolveRewardTable(
    state,
    expedition.rngStreams["expedition-rewards"],
    option.rewardTableId,
    rewardModifiers(expedition),
    expedition.depth,
  );

  // Committed with the same spread as a generated encounter, so picking an
  // option is not a way to learn its exact cost.
  const variance = drawDurationFactor(resolution.rngState);

  return {
    ok: true,
    state: withExpedition(state, {
      ...expedition,
      status: "resolving",
      oxygen: expedition.oxygen - option.oxygenCost,
      rngStreams: { ...expedition.rngStreams, "expedition-rewards": variance.rngState },
      currentEncounter: {
        ...expedition.currentEncounter,
        chosenOptionId: option.id,
        resolveElapsedMs: 0,
        resolveDurationMs: applyDurationVariance(option.resolveDurationMs, variance.factor),
        committedReward: resolution.reward,
      },
    }),
    effects: [{ type: "PLAY_SOUND", soundId: "sound.control.confirm" }],
  };
}

/**
 * Records a cat: the count, the entry with its skin, and the pause. Count and
 * array are incremented in one expression so they cannot drift, since
 * `catsFound` is what the luck modifier reads. The skin is drawn from the owned
 * pool off the seeded rewards stream, so a reloaded run meets the same cat
 * wearing the same thing.
 */
function meetCat(state: GameState): { state: GameState } {
  const pool =
    state.collection.ownedCatSkinIds.length > 0
      ? state.collection.ownedCatSkinIds
      : DEFAULT_CAT_SKIN_IDS;
  const streams = state.expedition.rngStreams;
  const draw =
    streams === null
      ? { state: null, value: 0 }
      : nextIntegerInclusive(streams["expedition-rewards"], 0, pool.length - 1);

  return {
    state: {
      ...state,
      statistics: { ...state.statistics, catsFound: state.statistics.catsFound + 1 },
      collection: {
        ...state.collection,
        cats: [...state.collection.cats, { skinId: pool[draw.value] }],
      },
      expedition: {
        ...state.expedition,
        pauseRemainingWallMs: ECONOMY.catPauseWallMs,
        // Counted in the same expression as the other two, so a third view of
        // one fact cannot drift from them.
        runKeepsakes: {
          ...state.expedition.runKeepsakes,
          cats: state.expedition.runKeepsakes.cats + 1,
        },
        rngStreams:
          streams === null || draw.state === null
            ? streams
            : { ...streams, "expedition-rewards": draw.state },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Banking
// ---------------------------------------------------------------------------

export interface BankResult {
  state: GameState;
  chipsFromOre: number;
}

/** What an inventory's ore is worth in chips, at this run's committed rates. */
function oreChips(state: GameState, inventory: RunInventory): number {
  const values =
    state.expedition.modifierSnapshot?.oreChipValues ??
    selectOreChipValues(collectActiveModifiers(state));

  return Math.floor(
    ORE_GRADE_IDS.reduce((total, grade) => total + inventory.ore[grade] * (values[grade] ?? 0), 0),
  );
}

export function bankRunInventory(
  state: GameState,
  inventory: RunInventory,
  label: string,
): { ok: true; result: BankResult } | { ok: false; message: string } {
  const oreValues =
    state.expedition.modifierSnapshot?.oreChipValues ??
    selectOreChipValues(collectActiveModifiers(state));

  const chipsFromOre = ORE_GRADE_IDS.reduce(
    (total, grade) => total + inventory.ore[grade] * (oreValues[grade] ?? 0),
    0,
  );

  const grants: ResourceDelta[] = [];

  if (chipsFromOre > 0) {
    grants.push({ resource: "chips", amount: Math.floor(chipsFromOre) });
  }

  if (inventory.components > 0) {
    grants.push({ resource: "components", amount: inventory.components });
  }

  if (inventory.relics > 0) {
    grants.push({ resource: "relics", amount: inventory.relics });
  }

  if (inventory.caches > 0) {
    grants.push({ resource: "caches", amount: inventory.caches });
  }

  if (inventory.deepCaches > 0) {
    grants.push({ resource: "deepCaches", amount: inventory.deepCaches });
  }

  const plan: TransactionPlan = {
    label,
    costs: [],
    grants,
    inventoryMutations: (Object.keys(inventory.recipePieces) as MachineId[])
      .filter((machineId) => inventory.recipePieces[machineId] > 0)
      .map((machineId) => ({
        kind: "recipePieces" as const,
        machineId,
        delta: inventory.recipePieces[machineId],
      })),
  };

  const outcome = applyTransaction(state, plan);

  if (!outcome.ok) {
    return { ok: false, message: outcome.message };
  }

  const bankedOre = ORE_GRADE_IDS.reduce((total, grade) => total + inventory.ore[grade], 0);
  const chipsGranted = Math.floor(chipsFromOre);

  return {
    ok: true,
    result: {
      state: {
        ...outcome.state,
        statistics: {
          ...outcome.state.statistics,
          chipsEarned: outcome.state.statistics.chipsEarned + chipsGranted,
          oreBanked: outcome.state.statistics.oreBanked + bankedOre,
        },
      },
      chipsFromOre: chipsGranted,
    },
  };
}

/**
 * The depth Sealed orders is holding the exit shut until, or null when nothing
 * is. Read from the run's own `activeModifierId`, fixed at launch, so the lock
 * cannot appear or vanish mid-run and survives a reload.
 */
export function bankingLockedUntil(state: GameState): number | null {
  const expedition = state.expedition;

  if (expedition.activeModifierId === null) {
    return null;
  }

  const target = EXPEDITION_MODIFIERS[expedition.activeModifierId]?.bankingLockedUntilDepth;

  if (target === undefined || expedition.depth >= target) {
    return null;
  }

  return target;
}

export function returnFromExpedition(state: GameState): ExpeditionOutcome {
  if (state.expedition.status !== "decision") {
    return { ok: false, block: { kind: "not-in-decision" } };
  }

  // Sealed orders, checked after the decision test and before anything is
  // banked, so a locked run is refused rather than half-processed. Low oxygen
  // does not lift it: a locked run can end with a full haul and no exit.
  const lockedUntil = bankingLockedUntil(state);

  if (lockedUntil !== null) {
    return {
      ok: false,
      block: {
        kind: "banking-locked",
        target: lockedUntil,
        remaining: lockedUntil - state.expedition.depth,
      },
    };
  }

  const inventory = cloneRunInventory(state.expedition.runInventory);
  const banked = bankRunInventory(state, inventory, "extraction");

  if (!banked.ok) {
    return { ok: false, block: { kind: "bank-failed", message: banked.message } };
  }

  const summary: RunSummary = {
    outcome: "returned",
    depth: state.expedition.depth,
    encountersCompleted: state.expedition.history.filter((entry) => entry.outcome === "completed")
      .length,
    chipsFromOre: banked.result.chipsFromOre,
    chipsLost: 0,
    recovered: inventory,
    lost: null,
    modifierName: modifierNameOf(state.expedition.activeModifierId),
  };

  const returned: GameState = {
    ...banked.result.state,
    expedition: createSurfaceExpeditionState(),
    statistics: {
      ...banked.result.state.statistics,
      runsReturned: banked.result.state.statistics.runsReturned + 1,
      // Only a banked run counts: a haul lost to an empty tank never came home.
      bestRunChips: Math.max(
        banked.result.state.statistics.bestRunChips,
        banked.result.chipsFromOre,
      ),
    },
    onboarding: { ...banked.result.state.onboarding, hasBankedRun: true },
  };

  // Settled against the depth reached, after banking and before reporting, so
  // the payout lands in the same commit.
  const wager = settleDepthWager(returned, state.expedition.depth);

  return {
    ok: true,
    state: wager.state,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.expedition.bank" },
      { type: "SHOW_RUN_SUMMARY", summary },
      ...wager.effects,
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

// ---------------------------------------------------------------------------
// Oxygen failure
// ---------------------------------------------------------------------------

/**
 * Rolls the independent per-unit loss for every unbanked resource unit. There is
 * no pity: a run may recover everything, nothing, or anything between.
 */
export function commitFailureResult(
  inventory: RunInventory,
  rngState: RngState,
  lossChance: number,
): { rngState: RngState; result: FailureResult } {
  const chance = clamp(
    lossChance,
    ECONOMY.failureLossChanceMinimum,
    ECONOMY.failureLossChanceMaximum,
  );

  const recovered = createEmptyRunInventory();
  const lost = createEmptyRunInventory();
  let current = rngState;

  for (const grade of ORE_GRADE_IDS) {
    const draw = nextBinomial(current, inventory.ore[grade], chance);
    current = draw.state;
    lost.ore[grade] = draw.value;
    recovered.ore[grade] = inventory.ore[grade] - draw.value;
  }

  const componentDraw = nextBinomial(current, inventory.components, chance);
  current = componentDraw.state;
  lost.components = componentDraw.value;
  recovered.components = inventory.components - componentDraw.value;

  const relicDraw = nextBinomial(current, inventory.relics, chance);
  current = relicDraw.state;
  lost.relics = relicDraw.value;
  recovered.relics = inventory.relics - relicDraw.value;

  const cacheDraw = nextBinomial(current, inventory.caches, chance);
  current = cacheDraw.state;
  lost.caches = cacheDraw.value;
  recovered.caches = inventory.caches - cacheDraw.value;

  // Rolled like every other carried thing: a deep cache is no safer than an
  // ordinary one.
  const deepCacheDraw = nextBinomial(current, inventory.deepCaches, chance);
  current = deepCacheDraw.state;
  lost.deepCaches = deepCacheDraw.value;
  recovered.deepCaches = inventory.deepCaches - deepCacheDraw.value;

  for (const machineId of Object.keys(inventory.recipePieces) as MachineId[]) {
    const draw = nextBinomial(current, inventory.recipePieces[machineId], chance);
    current = draw.state;
    lost.recipePieces[machineId] = draw.value;
    recovered.recipePieces[machineId] = inventory.recipePieces[machineId] - draw.value;
  }

  return { rngState: current, result: { recovered, lost, banked: false } };
}

function failRun(state: GameState): ExpeditionStepResult {
  const expedition = state.expedition;
  const streams = expedition.rngStreams;

  const failureRng: RngState =
    streams?.["expedition-failure"] ?? createRunRngStreams(expedition.seed ?? 0)["expedition-failure"];

  const committed = commitFailureResult(
    expedition.runInventory,
    failureRng,
    expedition.modifierSnapshot?.failureLossChance ?? ECONOMY.failureLossChanceBase,
  );

  const failedState: GameState = withExpedition(state, {
    ...expedition,
    status: "failed",
    oxygen: 0,
    currentEncounter: null,
    committedFailureResult: committed.result,
    rngStreams:
      streams === null ? null : { ...streams, "expedition-failure": committed.rngState },
  });

  const banked = bankRunInventory(failedState, committed.result.recovered, "failure-recovery");

  if (!banked.ok) {
    // Keep the committed result so a retry banks exactly the same haul.
    return {
      state: failedState,
      effects: [
        { type: "PLAY_SOUND", soundId: "sound.expedition.failed" },
        {
          type: "SHOW_FEEDBACK",
          tone: "negative",
          message: `Recovered haul could not be banked: ${banked.message}`,
        },
        { type: "REQUEST_SAVE", immediate: true },
      ],
    };
  }

  const summary: RunSummary = {
    outcome: "failed",
    depth: expedition.depth,
    encountersCompleted: expedition.history.filter((entry) => entry.outcome === "completed").length,
    chipsFromOre: banked.result.chipsFromOre,
    // Priced with the run's own snapshot, so both rows on the card use the same
    // rate.
    chipsLost: oreChips(state, committed.result.lost),
    recovered: committed.result.recovered,
    lost: committed.result.lost,
    modifierName: modifierNameOf(expedition.activeModifierId),
  };

  const ended: GameState = {
    ...banked.result.state,
    expedition: createSurfaceExpeditionState(),
    statistics: {
      ...banked.result.state.statistics,
      runsFailed: banked.result.state.statistics.runsFailed + 1,
    },
  };

  // A depth wager settles here on the same terms: failing at depth 40 still wins
  // a bet on depth 30, because the bet is on depth reached.
  const wager = settleDepthWager(ended, expedition.depth);

  return {
    state: wager.state,
    effects: [
      { type: "PLAY_SOUND", soundId: "sound.expedition.failed" },
      { type: "SHOW_RUN_SUMMARY", summary },
      ...wager.effects,
      { type: "REQUEST_SAVE", immediate: true },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

function beginApproach(state: GameState): GameState {
  const expedition = state.expedition;

  if (expedition.rngStreams === null) {
    return withExpedition(state, createSurfaceExpeditionState());
  }

  // A forecast run already drew this encounter. Consuming it rather than drawing
  // again makes the forecast binding and keeps the generation stream advancing
  // exactly once per descent.
  if (expedition.forecastEncounter !== null) {
    return withExpedition(state, {
      ...expedition,
      status: "approaching",
      currentEncounter: expedition.forecastEncounter,
      forecastEncounter: null,
      transitionRemainingMs: 0,
    });
  }

  const generation = generateEncounter(
    state,
    expedition.rngStreams["expedition-generation"],
    expedition.depth,
    snapshotModifiers(expedition),
    expedition.modifierSnapshot?.luckPoints ?? 0,
    expedition.modifierSnapshot?.approachSpeed ?? 1,
  );

  if (generation.encounter === null) {
    return withExpedition(state, {
      ...expedition,
      status: "decision",
      rngStreams: {
        ...expedition.rngStreams,
        "expedition-generation": generation.rngState,
      },
      currentEncounter: null,
    });
  }

  return withExpedition(state, {
    ...expedition,
    status: "approaching",
    rngStreams: { ...expedition.rngStreams, "expedition-generation": generation.rngState },
    currentEncounter: generation.encounter,
    transitionRemainingMs: 0,
  });
}

/**
 * Advances the active run by `elapsedMs`. Oxygen drains during approach and
 * automatic resolution only; the decision and inline-choice states are paused so
 * reading speed is never punished.
 */
export function tickExpedition(state: GameState, elapsedMs: number): ExpeditionStepResult {
  const expedition = state.expedition;
  const effects: DomainEffect[] = [];

  if (elapsedMs <= 0) {
    return { state, effects };
  }

  switch (expedition.status) {
    case "surface":
    case "decision":
    case "choice":
    case "extracting":
    case "failed":
      return { state, effects };

    case "launching": {
      const remaining = expedition.transitionRemainingMs - elapsedMs;

      if (remaining > 0) {
        return {
          state: withExpedition(state, { ...expedition, transitionRemainingMs: remaining }),
          effects,
        };
      }

      return { state: beginApproach(withExpedition(state, { ...expedition, transitionRemainingMs: 0 })), effects };
    }

    case "approaching": {
      const encounter = expedition.currentEncounter;

      if (encounter === null) {
        return { state: beginApproach(state), effects };
      }

      const oxygen = drainOxygen(
        expedition.oxygen,
        elapsedMs,
        encounter.oxygenDrainMultiplier,
        expedition.modifierSnapshot?.oxygenDrainRate ?? 1,
      );

      if (oxygen <= 0) {
        return failRun(withExpedition(state, { ...expedition, oxygen: 0 }));
      }

      const approachElapsedMs = encounter.approachElapsedMs + elapsedMs;
      const arrived = approachElapsedMs >= encounter.approachDurationMs;

      const advanced = withExpedition(state, {
        ...expedition,
        oxygen,
        currentEncounter: {
          ...encounter,
          approachElapsedMs: Math.min(approachElapsedMs, encounter.approachDurationMs),
        },
      });

      // Arriving commits the player to the encounter straight away.
      return { state: arrived ? beginResolution(advanced) : advanced, effects };
    }

    case "resolving": {
      const encounter = expedition.currentEncounter;

      if (encounter === null) {
        return { state: beginApproach(state), effects };
      }

      const definition = ENCOUNTERS[encounter.encounterId];
      const multiplier = activeDrainMultiplier(encounter, definition);

      // 1. Oxygen is spent before any completion is considered.
      const oxygen = drainOxygen(
        expedition.oxygen,
        elapsedMs,
        multiplier,
        expedition.modifierSnapshot?.oxygenDrainRate ?? 1,
      );

      // 2. A run that reaches zero fails, even if the encounter would have
      //    completed on the same tick.
      if (oxygen <= 0) {
        return failRun(withExpedition(state, { ...expedition, oxygen: 0 }));
      }

      // 3. Otherwise the encounter may complete and grant its reward.
      let advanced: ActiveEncounter;
      let completed: boolean;
      let strikeStreams: RunRngStreams | null = null;
      let criticalStrikes = 0;

      if (encounter.durabilityRemaining !== null) {
        // Damage lands in whole strikes rather than continuously, so a crit is
        // an event. Strike count is a function of total elapsed time rather than
        // how it was sliced, so frame rate and speed do not change the result.
        const resolveElapsedMs = encounter.resolveElapsedMs + elapsedMs;
        const strikesDue = Math.floor(resolveElapsedMs / ECONOMY.pickaxeStrikeIntervalMs);
        const newStrikes = Math.max(0, strikesDue - encounter.strikesTaken);
        const perStrike =
          (expedition.pickaxeDamageSnapshot * ECONOMY.pickaxeStrikeIntervalMs) / 1000;
        const critChance = expedition.modifierSnapshot?.pickaxeCritChance ?? 0;

        let damage = 0;
        let crits = 0;
        let strikeRng = expedition.rngStreams?.["expedition-failure"] ?? null;

        for (let strike = 0; strike < newStrikes; strike += 1) {
          let isCrit = false;

          if (critChance > 0 && strikeRng !== null) {
            const roll = nextChance(strikeRng, critChance);

            strikeRng = roll.state;
            isCrit = roll.value;
          }

          damage += isCrit ? perStrike * ECONOMY.pickaxeCritMultiplier : perStrike;
          crits += isCrit ? 1 : 0;
        }

        // One impact per frame that carried a strike. Several strikes inside one
        // frame collapse to a single sound rather than stacking into noise.
        if (newStrikes > 0) {
          effects.push({ type: "PLAY_SOUND", soundId: "sound.pickaxe.impact" });
        }

        // Reported once per tick with a count rather than once per strike, since
        // a single frame can hold several. The damage is the extra the crits
        // removed, as the plain half of each strike would have landed anyway.
        if (crits > 0) {
          criticalStrikes = crits;
          effects.push({
            type: "PLAY_SOUND",
            soundId: "sound.pickaxe.critical",
          });
          effects.push({
            type: "SHOW_CRITICAL_STRIKE",
            count: crits,
            damage: crits * perStrike * (ECONOMY.pickaxeCritMultiplier - 1),
          });
        }

        const remaining = encounter.durabilityRemaining - damage;
        completed = remaining <= 0;
        advanced = {
          ...encounter,
          durabilityRemaining: Math.max(0, remaining),
          resolveElapsedMs,
          strikesTaken: encounter.strikesTaken + newStrikes,
        };

        // Threaded into the state below rather than reassigned: the crit rolls
        // have to persist, or the same strikes would be re-rolled on reload.
        strikeStreams =
          strikeRng === null || expedition.rngStreams === null
            ? null
            : { ...expedition.rngStreams, "expedition-failure": strikeRng };
      } else {
        const resolveElapsedMs = encounter.resolveElapsedMs + elapsedMs;
        const duration = encounter.resolveDurationMs ?? 0;
        completed = resolveElapsedMs >= duration;
        advanced = { ...encounter, resolveElapsedMs: Math.min(resolveElapsedMs, duration) };
      }

      // Crits are counted on both paths out of this branch: a strike that breaks
      // the rock counts the same as one that does not.
      const withCrits = (next: GameState): GameState =>
        criticalStrikes === 0
          ? next
          : {
              ...next,
              statistics: {
                ...next.statistics,
                criticalStrikes: next.statistics.criticalStrikes + criticalStrikes,
              },
            };

      if (!completed) {
        return {
          state: withCrits(
            withExpedition(state, {
              ...expedition,
              oxygen,
              currentEncounter: advanced,
              rngStreams: strikeStreams ?? expedition.rngStreams,
            }),
          ),
          effects,
        };
      }

      const grants = advanced.committedReward?.grants ?? [];
      const rewarded = applyGrants(
        {
          ...expedition,
          oxygen,
          currentEncounter: advanced,
          rngStreams: strikeStreams ?? expedition.rngStreams,
        },
        grants,
      );

      const withHistory: ExpeditionState = {
        ...rewarded,
        status: "reward",
        transitionRemainingMs: ECONOMY.rewardTransitionMs,
        history: [
          ...rewarded.history,
          {
            encounterId: encounter.encounterId,
            depth: expedition.depth,
            chosenOptionId: encounter.chosenOptionId,
            outcome: "completed" as const,
            grants,
          },
        ].slice(-ECONOMY.encounterHistoryLength),
      };

      // A collectible is permanent progression, not cargo: it lands in the
      // collection when found, so an oxygen failure cannot take it.
      // `grantCollectible` is the same function a cache open uses, so a
      // duplicate arrives as fragments here too.
      const collected = grants.reduce((current, grant) => {
        if (grant.kind !== "collectible") {
          return current;
        }

        const granted = grantCollectible(current, grant.reward);

        /*
         * A find that could no longer improve the item pays selenite.
         * `grant.arrival` is read rather than re-derived: it was decided when the
         * reward was committed, so the row, the pop and the grant agree. Asking
         * `isEffectivelyMaxed` again would question a state `grantCollectible`
         * has just changed.
         */
        if (grant.arrival !== "selenite") {
          return granted;
        }

        return withExpedition(granted, {
          ...granted.expedition,
          runKeepsakes: {
            ...granted.expedition.runKeepsakes,
            selenite:
              granted.expedition.runKeepsakes.selenite + ECONOMY.selenitePerMaxedDuplicate,
          },
        });
      }, withExpedition(state, withHistory));

      // Meeting a cat is the whole reward; it grants nothing to carry out.
      const isCat = encounter.encounterId === CAT_ENCOUNTER_ID;
      const met = isCat ? meetCat(collected) : { state: collected };
      const counted = met.state;

      const nextState = updatePity(counted, grants);

      return {
        state: withCrits({
          ...nextState,
          statistics: {
            ...nextState.statistics,
            encountersCompleted: nextState.statistics.encountersCompleted + 1,
          },
        }),
        effects: [
          // A cat gets its own jingle rather than the ore pickup.
          { type: "PLAY_SOUND", soundId: isCat ? "sound.cat.meet" : "sound.reward.pickup" },
          { type: "SHOW_ENCOUNTER_REWARD", grants, oxygenDelta: 0 },
          // Same tick as the reward, so the pop and the dissolve agree.
          { type: "SHOW_ENCOUNTER_COMPLETE", spriteId: definition.spriteId },
        ],
      };
    }

    case "reward": {
      const remaining = expedition.transitionRemainingMs - elapsedMs;

      if (remaining > 0) {
        return {
          state: withExpedition(state, { ...expedition, transitionRemainingMs: remaining }),
          effects,
        };
      }

      // The reward has landed, so the player now chooses whether to press on.
      // The encounter is kept so the decision can show what was just found.
      const settled = withForecast(
        withExpedition(state, {
          ...expedition,
          status: "decision",
          transitionRemainingMs: 0,
        }),
      );

      // Auto-continue lives here rather than in the UI so it is deterministic,
      // serialized with every other transition, and survives a mid-run reload.
      // It only ever presses on; it never banks.
      const auto = state.settings.autoContinue;

      if (auto.enabled) {
        const ratio =
          expedition.maxOxygenSnapshot > 0
            ? expedition.oxygen / expedition.maxOxygenSnapshot
            : 0;

        if (ratio > auto.oxygenThresholdRatio) {
          const pressedOn = continueExpedition(settled);

          if (pressedOn.ok) {
            return { state: pressedOn.state, effects };
          }
        }

        return {
          state: settled,
          effects: [
            ...effects,
            {
              type: "SHOW_FEEDBACK",
              tone: "neutral",
              message: `Auto-continue paused: oxygen at ${Math.round(ratio * 100)}%.`,
            },
          ],
        };
      }

      return { state: settled, effects };
    }

    default:
      return { state, effects };
  }
}

/**
 * True while the player is committed to the encounter in progress. Returning is
 * only ever possible from the decision that follows a reward.
 */
export function isReturnLocked(state: GameState): boolean {
  return state.expedition.status !== "decision";
}

export function oxygenRatio(state: GameState): number {
  const max = state.expedition.maxOxygenSnapshot;

  return max > 0 ? clamp(state.expedition.oxygen / max, 0, 1) : 0;
}

export function isOxygenLow(state: GameState): boolean {
  return (
    state.expedition.status !== "surface" && oxygenRatio(state) <= ECONOMY.lowOxygenWarningRatio
  );
}
