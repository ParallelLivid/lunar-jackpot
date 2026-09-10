/**
 * The tutorial act machine. Latching records that something happened;
 * presenting decides when a card about it is shown. The two are separate
 * moments, and that is where the complexity here comes from.
 *
 * Gates latch because no act may open while a run is in flight, yet some of the
 * things acts wait for — a rolled run condition, an offered contract — are true
 * only during a run. Recording the answer when it happens and presenting later
 * is the only arrangement that satisfies both. Latches are never cleared, which
 * is also what makes `REPLAY_TUTORIAL` open the acts back to back.
 *
 * Everything runs from one place, the wrapper in `reduce`, and is a no-op unless
 * the tutorial is running.
 */

import {
  TUTORIAL_ACTS,
  TUTORIAL_GATES,
  UI_TUTORIAL_GATES,
  findTutorialAct,
  type TutorialAct,
  type TutorialGateId,
  type TutorialStep,
} from "../content/tutorial";
import { ECONOMY } from "../content/catalog";
import type { CommandResult } from "./commands";
import { projectedSelenite } from "./prestige";
import type { GameState, TutorialState } from "./state";

/**
 * Whether a gate is true right now — live, not latched; this is what the latch
 * pass records. Returns false for the two UI gates, which depend on open rail
 * windows that `GameState` does not hold; the dashboard dispatches
 * `ADVANCE_TUTORIAL` for those instead.
 */
export function isTutorialGateMet(state: GameState, gateId: TutorialGateId): boolean {
  switch (gateId) {
    case "gate.machine-purchased":
      return state.onboarding.hasPurchasedMachineLevel;
    case "gate.expedition-launched":
      return state.onboarding.hasLaunchedExpedition;
    case "gate.run-banked":
      return state.onboarding.hasBankedRun;
    case "gate.chips-held":
      return state.resources.chips > 0;
    case "gate.cache-held":
      return state.resources.caches > 0 || state.resources.deepCaches > 0;
    case "gate.relics-held":
      return state.resources.relics > 0;
    case "gate.trinket-owned":
      return Object.values(state.collection.trinkets).some((trinket) => trinket.owned);
    case "gate.totem-owned":
      return Object.values(state.collection.totems).some((totem) => totem.owned);
    case "gate.consumable-held":
      return state.heldConsumableIds.length > 0;
    // The two transient gates: true for part of a run and gone afterwards, which
    // is the case the latch exists for.
    case "gate.modifier-seen":
      return state.expedition.activeModifierId !== null;
    case "gate.contract-offered":
      return state.expedition.activeContract !== null;
    // `runsFailed` rather than a flag on `onboarding`: it survives prestige, and
    // this act is worth playing once per save rather than once per cycle.
    case "gate.run-failed":
      return state.statistics.runsFailed > 0;
    case "gate.dev-menu-opened":
      return state.onboarding.hasOpenedDevMenu;
    /*
     * Two more lifetime counters. Both latch underground and present on the
     * surface, which is where the litterbox panel and the jukebox button are.
     * The jukebox gate reads `ECONOMY.jukeboxUnlockDepth` because
     * `unlockedRailEntries` reads the same constant, so the act cannot fire a
     * depth before the button exists.
     */
    case "gate.cat-met":
      return state.statistics.catsFound > 0;
    case "gate.jukebox-unlocked":
      return state.statistics.deepestDepth >= ECONOMY.jukeboxUnlockDepth;
    case "gate.prestige-available":
      // The threshold alone, not `isPrestigeAvailable`, which also refuses while
      // a run or bet is live. This gate is about having reached the wall.
      return projectedSelenite(state) > 0;
    default:
      return !UI_TUTORIAL_GATES.includes(gateId) ? false : false;
  }
}

/** The act a state has open, if any. */
export function activeTutorialAct(state: GameState): TutorialAct | null {
  const { tutorial } = state.onboarding;

  return tutorial.status === "running" ? findTutorialAct(tutorial.activeActId) : null;
}

/** Records every gate that is true now and was not already recorded. */
function latchGates(state: GameState): TutorialGateId[] {
  const latched = state.onboarding.tutorial.latchedGateIds;
  const found = TUTORIAL_GATES.filter(
    (gateId) => !latched.includes(gateId) && isTutorialGateMet(state, gateId),
  );

  return found.length === 0 ? latched : [...latched, ...found];
}

/**
 * Whether an act may present right now, and the only place `presentsDuringRun`
 * is read. "On the surface" covers a run that banked and one that failed alike.
 */
function mayPresent(act: TutorialAct, state: GameState): boolean {
  return act.presentsDuringRun || state.expedition.status === "surface";
}

function withTutorial(state: GameState, tutorial: TutorialState): GameState {
  return { ...state, onboarding: { ...state.onboarding, tutorial } };
}

/**
 * Brings the tutorial into line with the state a command has just produced, in
 * three passes whose order matters: latching first lets a gate opened by this
 * command open an act on it, advancing before opening keeps a card from
 * replacing a card, and opening one act at a time queues simultaneous triggers
 * in declaration order.
 */
export function advanceTutorial(result: CommandResult): CommandResult {
  // Read from the state the command produced, not the one it started from:
  // otherwise `SKIP_TUTORIAL` would still be `running` here and immediately
  // reopen the act it just dismissed.
  if (result.state.onboarding.tutorial.status !== "running") {
    return result;
  }

  /*
   * A refused command did nothing, so there is nothing to react to. Not just an
   * optimisation: the latch is lazily initialised on the first command of a
   * session, so without this guard a rejected first command would still write
   * tutorial state and report a material change, breaking "a refused command
   * changes nothing". The next accepted command latches the same gates.
   */
  if (result.effects.some((effect) => effect.type === "COMMAND_REJECTED")) {
    return result;
  }

  let next = result.state;
  let changed = false;

  // 1. Latch.
  const latchedGateIds = latchGates(next);

  if (latchedGateIds !== next.onboarding.tutorial.latchedGateIds) {
    next = withTutorial(next, { ...next.onboarding.tutorial, latchedGateIds });
    changed = true;
  }

  // 2. Advance the open act, if its current step was waiting on a gate.
  const openAct = findTutorialAct(next.onboarding.tutorial.activeActId);

  if (openAct !== null) {
    const current = openAct.steps[next.onboarding.tutorial.stepIndex];
    const satisfied =
      current !== undefined &&
      current.advance !== "next" &&
      next.onboarding.tutorial.latchedGateIds.includes(current.advance);

    if (satisfied) {
      next = withTutorial(next, advanceStep(next.onboarding.tutorial, openAct));
      changed = true;
    }
  }

  // 3. Open the next act, if nothing is presenting.
  if (next.onboarding.tutorial.activeActId === null) {
    const opened = openNextAct(next);

    if (opened !== null) {
      next = withTutorial(next, opened);
      changed = true;
    }
  }

  return changed ? { ...result, state: next, materialChange: true } : result;
}

/** Moves to the next step, closing the act when it runs out. */
export function advanceStep(tutorial: TutorialState, act: TutorialAct): TutorialState {
  const stepIndex = tutorial.stepIndex + 1;

  // The dismissal is cleared on every move: it names one step, so carrying it
  // forward could only silence the wrong card.
  if (stepIndex < act.steps.length) {
    return { ...tutorial, stepIndex, dismissedStepId: null };
  }

  return {
    ...tutorial,
    activeActId: null,
    stepIndex: 0,
    dismissedStepId: null,
    completedActIds: [...tutorial.completedActIds, act.id],
  };
}

/**
 * Opens the first act that is eligible, or finishes the script. Declaration
 * order, so two triggers latching together resolve deterministically.
 */
function openNextAct(state: GameState): TutorialState | null {
  const tutorial = state.onboarding.tutorial;
  const remaining = TUTORIAL_ACTS.filter((act) => !tutorial.completedActIds.includes(act.id));

  if (remaining.length === 0) {
    return { ...tutorial, status: "finished", activeActId: null, stepIndex: 0 };
  }

  const eligible = remaining.find(
    (act) =>
      (act.trigger === "start" || tutorial.latchedGateIds.includes(act.trigger)) &&
      mayPresent(act, state),
  );

  return eligible === undefined
    ? null
    : { ...tutorial, activeActId: eligible.id, stepIndex: 0, dismissedStepId: null };
}

/**
 * The step the script is on, whether or not its card is showing. The difference
 * from {@link selectTutorialStep} is dismissal: a dismissed step is still what
 * the tutorial waits for, so anything asking what the script wants must see it,
 * while anything asking what belongs on screen must not. The dashboard's answer
 * to the two window gates is the first kind of question.
 */
export function currentTutorialStep(state: GameState): {
  act: TutorialAct;
  step: TutorialStep;
} | null {
  const act = activeTutorialAct(state);
  const step = act?.steps[state.onboarding.tutorial.stepIndex];

  return act === null || step === undefined ? null : { act, step };
}

/** The act and step a card should be drawn from, or null when none is open. */
export function selectTutorialStep(state: GameState): {
  act: TutorialAct;
  step: TutorialStepView;
} | null {
  const current = currentTutorialStep(state);

  if (current === null) {
    return null;
  }

  const { act } = current;
  const index = state.onboarding.tutorial.stepIndex;
  const step = current.step;

  // A closed card stays closed until the script moves on. The step is still
  // current; the modal is just out of the way so its gate can be satisfied.
  if (state.onboarding.tutorial.dismissedStepId === step.id) {
    return null;
  }

  return {
    act,
    step: {
      ...step,
      /** One-based, for the card's "Arrival — 1 of 2". */
      position: index + 1,
      total: act.steps.length,
    },
  };
}

export interface TutorialStepView extends TutorialStep {
  /** One-based position of this card within its act. */
  position: number;
  total: number;
}
