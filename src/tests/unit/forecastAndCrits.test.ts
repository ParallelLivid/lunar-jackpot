/**
 * Coverage for the Cartographer's eye and for critical-strike feedback.
 *
 * The eye is the only sanctioned exception to the rule that reaching an
 * encounter commits you to it sight unseen, so most of what is worth pinning is
 * the shape of the exception rather than the feature: that it names the family
 * and nothing narrower, that it cannot say "a cat", that it is binding, and
 * above all that moving the draw earlier does not change which encounters a run
 * meets.
 */

import { describe, expect, it } from "vitest";
import {
  ECONOMY,
  ENCOUNTERS,
  ENCOUNTER_FAMILY_LABELS,
  TOTEMS,
  CAT_ENCOUNTER_ID,
} from "../../content/catalog";
import type { TotemId } from "../../content/catalog";
import { tickExpedition } from "../../domain/expedition";
import { selectForecastsEncounters, selectTotemCapability } from "../../domain/modifiers";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectExpeditionView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;

/**
 * A launched-ready state with the given totems owned at grade E and equipped.
 *
 * `autoContinue` defaults off, because that is the only state in which a forecast
 * is visible for any length of time: auto-continue presses on the instant the
 * decision arrives, so the encounter is drawn and consumed inside one tick. That
 * is the correct behaviour — the eye is for a player who is choosing — but it
 * means these tests have to stop at the decision the way a player does.
 */
function withTotems(totems: TotemId[], seed = 5, autoContinue = false): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed });

  return {
    ...base,
    collection: {
      ...base.collection,
      totems: {
        ...base.collection.totems,
        ...Object.fromEntries(
          totems.map((id) => [id, { owned: true, grade: "E" as const, fragments: 0 }]),
        ),
      },
      activeTotemIds: [...totems, null, null].slice(0, 3),
    },
    settings: {
      ...base.settings,
      autoContinue: { enabled: autoContinue, oxygenThresholdRatio: 0.1 },
    },
  };
}

function tick(state: GameState, frameMs = 250): GameState {
  return reduce(state, {
    type: "TICK",
    casinoElapsedMs: frameMs,
    expeditionElapsedMs: frameMs,
    nowUnixMs: state.lastSettledAtUnixMs + frameMs,
  }).state;
}

/**
 * Every encounter a run met, in order, pressing on at each decision.
 *
 * Presses on explicitly rather than leaning on auto-continue so the run actually
 * comes to rest at each decision, which is where a forecast lives.
 */
function encountersMet(launched: GameState, frames = 400): string[] {
  let current = launched;
  const met: string[] = [];

  for (let frame = 0; frame < frames; frame += 1) {
    current = tick(current);

    if (current.expedition.status === "decision") {
      const pressed = reduce(current, { type: "CONTINUE_EXPEDITION" });

      current = pressed.state;
    }

    const id = current.expedition.currentEncounter?.encounterId ?? null;

    if (id !== null && id !== met[met.length - 1]) {
      met.push(id);
    }
  }

  return met;
}

/** Runs until the first decision that carries a forecast, or null if none does. */
function firstForecast(state: GameState): { label: string; nextEncounterId: string } | null {
  let current = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;

  for (let frame = 0; frame < 400; frame += 1) {
    current = tick(current);

    const view = selectExpeditionView(deriveContext(current));

    if (view.forecast !== null && current.expedition.forecastEncounter !== null) {
      return {
        label: view.forecast.label,
        nextEncounterId: current.expedition.forecastEncounter.encounterId,
      };
    }
  }

  return null;
}

describe("the Cartographer's eye", () => {
  const carrying = (seed = 5): GameState => withTotems(["totem.cartographer"], seed);

  it("is the only totem that forecasts", () => {
    const forecasting = Object.values(TOTEMS).filter(
      (totem) => totem.capability === "forecast-encounter",
    );

    expect(forecasting.map((totem) => totem.id)).toEqual(["totem.cartographer"]);
    expect(selectForecastsEncounters(carrying())).toBe(true);
    expect(selectForecastsEncounters(withTotems([]))).toBe(false);
    expect(selectTotemCapability(carrying(), "resolve-choices")).toBe(false);
  });

  it("names what is coming, and says nothing without the totem", () => {
    const seen = firstForecast(carrying());

    expect(seen).not.toBeNull();
    expect(firstForecast(withTotems([]))).toBeNull();
  });

  it("names the family and never the encounter", () => {
    /*
     * The whole shape of the exception. A forecast that named the encounter
     * would tell the player what it pays and how hard it is, which is most of
     * the information "sight unseen" was protecting.
     */
    const seen = firstForecast(carrying());
    const labels: string[] = Object.values(ENCOUNTER_FAMILY_LABELS);
    const named = Object.values(ENCOUNTERS).find(
      (definition) => definition.id === seen?.nextEncounterId,
    );

    expect(labels).toContain(seen?.label);
    expect(named).toBeDefined();
    expect(seen?.label).not.toBe(named?.displayName);
    expect(seen?.label).toBe(ENCOUNTER_FAMILY_LABELS[named?.family ?? "ore"]);
  });

  it("cannot give away a cat", () => {
    /*
     * The cat's 1-in-1000 is the one surprise in the game that nothing may move,
     * and a forecast naming it would spend the surprise a few seconds early. It
     * survives because the cat's family is `rare`, which it shares with every
     * ordinary rare find — so the eye can say "something rare" and still not know.
     */
    const catFamily = ENCOUNTERS[CAT_ENCOUNTER_ID].family;

    expect(catFamily).toBe("rare");
    expect(ENCOUNTER_FAMILY_LABELS[catFamily]).not.toMatch(/cat/i);
  });

  it("is binding: pressing on delivers exactly what was named", () => {
    // A forecast that could be rerolled by pressing on would be worthless, and
    // one that differed from what arrived would be a lie.
    let current = reduce(carrying(), { type: "LAUNCH_EXPEDITION" }).state;

    for (let frame = 0; frame < 400; frame += 1) {
      current = tick(current);

      const forecast = current.expedition.forecastEncounter;

      if (forecast !== null) {
        const pressed = reduce(current, { type: "CONTINUE_EXPEDITION" }).state;

        expect(pressed.expedition.currentEncounter?.encounterId).toBe(forecast.encounterId);
        expect(pressed.expedition.forecastEncounter).toBeNull();

        return;
      }
    }

    throw new Error("no forecast was ever consumed");
  });

  it("does not change which encounters the run meets", () => {
    /*
     * The load-bearing test. Drawing the encounter at the decision instead of at
     * the press-on is a reorder of when the generation stream is consumed, not a
     * change to how often — so an otherwise identical run must meet exactly the
     * same encounters in the same order.
     *
     * Compared against the same run with the flag flipped on the snapshot rather
     * than against a run carrying the totem, because the totem also grants luck
     * and luck moves the weights. This isolates the reorder.
     */
    const plain = reduce(withTotems([]), { type: "LAUNCH_EXPEDITION" }).state;
    const forecasting: GameState = {
      ...plain,
      expedition: {
        ...plain.expedition,
        modifierSnapshot:
          plain.expedition.modifierSnapshot === null
            ? null
            : { ...plain.expedition.modifierSnapshot, forecastsEncounters: true },
      },
    };

    const met = encountersMet(plain);

    expect(met.length).toBeGreaterThan(1);
    expect(encountersMet(forecasting)).toEqual(met);
  });

  it("leaves a run without the totem drawing exactly as it always did", () => {
    // The other half: adding the feature must not have moved anything for the
    // players who do not own it.
    const launch = (): GameState =>
      reduce(withTotems([], 11), { type: "LAUNCH_EXPEDITION" }).state;

    expect(encountersMet(launch())).toEqual(encountersMet(launch()));
    expect(encountersMet(launch()).length).toBeGreaterThan(1);
  });

  it("restores the forecast on reload rather than redrawing it", () => {
    /*
     * Redrawing on load would let a player reload at a decision until the
     * forecast said something they liked, which is a far stronger totem than the
     * one being sold.
     */
    let current = reduce(carrying(), { type: "LAUNCH_EXPEDITION" }).state;

    for (let frame = 0; frame < 400; frame += 1) {
      current = tick(current);

      if (current.expedition.forecastEncounter !== null) {
        const restored = normalizeGameState(createEnvelope(current, 1, NOW).game, NOW).state;

        expect(restored.expedition.forecastEncounter?.encounterId).toBe(
          current.expedition.forecastEncounter.encounterId,
        );
        expect(restored.expedition.modifierSnapshot?.forecastsEncounters).toBe(true);

        return;
      }
    }

    throw new Error("no forecast was ever held");
  });

  it("commits the capability at launch, so unequipping cannot revoke it mid-run", () => {
    const launched = reduce(carrying(), { type: "LAUNCH_EXPEDITION" }).state;
    const unequipped: GameState = {
      ...launched,
      collection: { ...launched.collection, activeTotemIds: [null, null, null] },
    };

    expect(unequipped.expedition.modifierSnapshot?.forecastsEncounters).toBe(true);
    expect(selectForecastsEncounters(unequipped)).toBe(false);
  });

  it("shows nothing while the player is still walking", () => {
    // The forecast is a decision-point reading. Naming the encounter after next
    // during an approach would stack two unresolved futures on one card.
    let current = reduce(carrying(), { type: "LAUNCH_EXPEDITION" }).state;

    for (let frame = 0; frame < 400; frame += 1) {
      current = tick(current);

      if (current.expedition.status === "approaching") {
        expect(selectExpeditionView(deriveContext(current)).forecast).toBeNull();
      }

      if (current.expedition.status === "decision") {
        current = reduce(current, { type: "CONTINUE_EXPEDITION" }).state;
      }
    }
  });

  it("carries a scaling effect alongside the capability", () => {
    // Same rule the dowsing bone follows: a capability is identical at every
    // grade, so without a modifier the ladder above E would buy nothing.
    expect(TOTEMS["totem.cartographer"].baseModifiers.length).toBeGreaterThan(0);
  });
});

describe("critical strike feedback", () => {
  /** One resolving-state tick over an ore seam at the given crit chance. */
  function strikeTick(critChance: number, elapsedMs: number, seed = 3) {
    const launched = reduce(withTotems([], seed), { type: "LAUNCH_EXPEDITION" }).state;
    const definition = ENCOUNTERS["encounter.ore.shelf.light"];

    const staged: GameState = {
      ...launched,
      expedition: {
        ...launched.expedition,
        status: "resolving",
        oxygen: 100_000,
        maxOxygenSnapshot: 100_000,
        modifierSnapshot:
          launched.expedition.modifierSnapshot === null
            ? null
            : { ...launched.expedition.modifierSnapshot, pickaxeCritChance: critChance },
        currentEncounter: {
          encounterId: definition.id,
          approachElapsedMs: definition.approachDurationMs,
          approachDurationMs: definition.approachDurationMs,
          resolveElapsedMs: 0,
          strikesTaken: 0,
          resolveDurationMs: null,
          // Far beyond what these ticks can break, so the seam does not complete
          // and turn the tick into a reward instead of a strike.
          durabilityRemaining: 1_000_000,
          oxygenDrainMultiplier: definition.oxygenDrainMultiplier,
          chosenOptionId: null,
          committedReward: null,
        },
      },
    };

    return tickExpedition(staged, elapsedMs);
  }

  it("reports a crit when one lands", () => {
    const { effects } = strikeTick(1, ECONOMY.pickaxeStrikeIntervalMs);
    const pop = effects.find((effect) => effect.type === "SHOW_CRITICAL_STRIKE");

    expect(pop).toBeDefined();
    expect(effects.some((effect) => effect.type === "PLAY_SOUND" && effect.soundId === "sound.pickaxe.critical")).toBe(
      true,
    );
  });

  it("says nothing at all without a crit chance", () => {
    // The trinket is what buys the feedback. A player who has never found it must
    // never see a crit indicator.
    const { effects } = strikeTick(0, ECONOMY.pickaxeStrikeIntervalMs * 8);

    expect(effects.some((effect) => effect.type === "SHOW_CRITICAL_STRIKE")).toBe(false);
    expect(
      effects.some((effect) => effect.type === "PLAY_SOUND" && effect.soundId === "sound.pickaxe.critical"),
    ).toBe(false);
  });

  it("collapses several crits in one tick into one report", () => {
    /*
     * At 8x, or on a long frame, four strikes can land inside one tick. Four
     * separate pops for one frame would read as a stutter; one pop saying four
     * reads as what happened.
     */
    const { effects } = strikeTick(1, ECONOMY.pickaxeStrikeIntervalMs * 4);
    const pops = effects.filter((effect) => effect.type === "SHOW_CRITICAL_STRIKE");

    expect(pops).toHaveLength(1);
    expect(pops[0].type === "SHOW_CRITICAL_STRIKE" ? pops[0].count : 0).toBe(4);
  });

  it("reports the extra damage the crits bought, not the whole swing", () => {
    // The plain half of each strike was going to land anyway; what the crit is
    // worth is the difference.
    const { effects } = strikeTick(1, ECONOMY.pickaxeStrikeIntervalMs);
    const pop = effects.find((effect) => effect.type === "SHOW_CRITICAL_STRIKE");
    const launched = reduce(withTotems([], 3), { type: "LAUNCH_EXPEDITION" }).state;
    const perStrike =
      (launched.expedition.pickaxeDamageSnapshot * ECONOMY.pickaxeStrikeIntervalMs) / 1000;

    expect(pop?.type === "SHOW_CRITICAL_STRIKE" ? pop.damage : 0).toBeCloseTo(
      perStrike * (ECONOMY.pickaxeCritMultiplier - 1),
      6,
    );
  });
});
