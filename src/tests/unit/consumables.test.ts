/**
 * Coverage for consumables.
 *
 * The system is small because it reuses two things wholesale: `applyTransaction`
 * for the purchase, and `createRunModifierSnapshot` for the effect. So most of
 * these tests are about the *seams* — that a purchase is charged and refused for
 * the right reasons, that launching both applies and spends in one step, and
 * that nothing gives them back.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, ENCOUNTERS } from "../../content/catalog";
import type { EncounterId } from "../../content/catalog";
import {
  CONSUMABLES,
  CONSUMABLE_IDS,
  consumableModifiers,
  type ConsumableId,
} from "../../content/consumables";
import { STAT_RULES } from "../../content/economy";
import { SPRITES } from "../../rendering/sprites";
import { selectMaxOxygen } from "../../domain/gear";
import { collectActiveModifiers } from "../../domain/modifiers";
import { applyPrestige } from "../../domain/prestige";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";
import { runMigrations } from "../../persistence/migrations";
import { SAVE_VERSION, normalizeGameState } from "../../persistence/saveSchema";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;

function fresh(seed = 9): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A surface state with chips to spare. */
function rich(chips = 1_000_000): GameState {
  const base = fresh();

  return { ...base, resources: { ...base.resources, chips } };
}

function buy(state: GameState, consumableId: ConsumableId): GameState {
  return reduce(state, { type: "BUY_CONSUMABLE", consumableId }).state;
}

function tick(state: GameState, expeditionElapsedMs: number): GameState {
  return reduce(state, {
    type: "TICK",
    casinoElapsedMs: 0,
    expeditionElapsedMs,
    nowUnixMs: state.lastSettledAtUnixMs + expeditionElapsedMs,
  }).state;
}

describe("the six", () => {
  it("has one per lever, and no two on the same stat", () => {
    /*
     * The ruling that shapes the set. Two consumables on one stat would make the
     * choice between them an arithmetic comparison rather than a decision, and
     * nothing in the types would notice.
     */
    const stats = CONSUMABLE_IDS.flatMap((id) =>
      CONSUMABLES[id].modifiers.map((modifier) => modifier.targetStat),
    );

    expect(CONSUMABLE_IDS).toHaveLength(6);
    expect(new Set(stats).size).toBe(stats.length);
  });

  it("gives every one a sprite that exists and is well formed", () => {
    // A missing sprite draws a labelled placeholder rather than failing, so
    // nothing else in the game would ever complain about a typo here.
    for (const id of CONSUMABLE_IDS) {
      const rows = SPRITES[CONSUMABLES[id].spriteId];

      expect(rows, CONSUMABLES[id].spriteId).toBeDefined();
      expect(rows, id).toHaveLength(12);

      for (const row of rows) {
        expect(row.length, `${id}: "${row}"`).toBe(12);
      }
    }
  });

  it("prices them in the band one good run banks", () => {
    /*
     * Measured with the run simulation at mid-game gear (tank and pickaxe 6): a
     * run banks a median of 371 chips and a good one about 778. A consumable
     * that cost a tenth of that would be a formality; one that cost ten times it
     * would never be bought. The band is the decision.
     */
    for (const id of CONSUMABLE_IDS) {
      expect(CONSUMABLES[id].chipCost, id).toBeGreaterThanOrEqual(200);
      expect(CONSUMABLES[id].chipCost, id).toBeLessThanOrEqual(1_000);
    }

    // And they are not all the same price — the set is a ladder.
    expect(new Set(CONSUMABLE_IDS.map((id) => CONSUMABLES[id].chipCost)).size).toBe(6);
  });

  it("discloses the two clamps rather than leaving them to be found", () => {
    /*
     * `gear.pickaxeCritChance` caps at 0.9 and `expedition.failureLossChance` at
     * [0.05, 0.95], so those two are worth less to a well-equipped player. That
     * is intended; being a surprise is not.
     */
    expect(STAT_RULES["gear.pickaxeCritChance"].maximum).toBe(0.9);
    expect(STAT_RULES["expedition.failureLossChance"].minimum).toBe(0.05);

    expect(CONSUMABLES["consumable.honed-edge"].description).toContain("90%");
    expect(CONSUMABLES["consumable.safety-line"].description).toContain("5%");

    /*
     * And in the effect summary, which is the line that is actually on screen.
     *
     * The supplies sit in a column where the description does not fit on the
     * tile and is carried as a tooltip and a visually-hidden line. A tooltip is
     * discovered rather than disclosed, so the figure has to be somewhere the
     * store always shows, and that is here.
     */
    expect(CONSUMABLES["consumable.honed-edge"].effectSummary).toContain("90%");
    expect(CONSUMABLES["consumable.safety-line"].effectSummary).toContain("5%");
  });

  it("collects modifiers in catalogue order, whatever order they were bought", () => {
    const forwards = consumableModifiers(["consumable.spare-canister", "consumable.safety-line"]);
    const backwards = consumableModifiers(["consumable.safety-line", "consumable.spare-canister"]);

    expect(forwards).toEqual(backwards);
    expect(consumableModifiers([])).toEqual([]);
  });
});

describe("buying one", () => {
  it("deducts the chips and holds the item", () => {
    const before = rich();
    const after = buy(before, "consumable.stimulant");

    expect(after.resources.chips).toBe(
      before.resources.chips - CONSUMABLES["consumable.stimulant"].chipCost,
    );
    expect(after.heldConsumableIds).toEqual(["consumable.stimulant"]);
  });

  it("refuses a second of the same, without charging for it", () => {
    // Non-stackable was ruled on directly.
    const once = buy(rich(), "consumable.stimulant");
    const twice = buy(once, "consumable.stimulant");

    expect(twice.resources.chips).toBe(once.resources.chips);
    expect(twice.heldConsumableIds).toEqual(["consumable.stimulant"]);
  });

  it("allows one of each", () => {
    let state = rich();

    for (const id of CONSUMABLE_IDS) {
      state = buy(state, id);
    }

    expect(state.heldConsumableIds).toHaveLength(CONSUMABLE_IDS.length);
  });

  it("refuses when the chips are not there", () => {
    const poor = { ...fresh(), resources: { ...fresh().resources, chips: 10 } };
    const after = buy(poor, "consumable.spare-canister");

    expect(after.heldConsumableIds).toEqual([]);
    expect(after.resources.chips).toBe(10);
  });

  it("refuses during a run", () => {
    /*
     * The item affects the *next* run. Buying one mid-descent, watching it do
     * nothing, and calling it a bug would be an entirely reasonable reading — so
     * the purchase is refused rather than scoped silently.
     */
    const running = reduce(rich(), { type: "LAUNCH_EXPEDITION" }).state;

    expect(running.expedition.status).not.toBe("surface");

    const after = buy(running, "consumable.stimulant");

    expect(after.heldConsumableIds).toEqual([]);
    expect(after.resources.chips).toBe(running.resources.chips);
  });
});

describe("launching with them", () => {
  it("folds the modifier into the snapshot and empties the list", () => {
    const packed = buy(rich(), "consumable.spare-canister");
    const launched = reduce(packed, { type: "LAUNCH_EXPEDITION" }).state;

    expect(launched.heldConsumableIds).toEqual([]);
    expect(
      launched.expedition.modifierSnapshot?.modifiers.some(
        (modifier) => modifier.sourceId === "consumable.spare-canister",
      ),
    ).toBe(true);
  });

  it("shows up in the run's derived values, not just its modifier list", () => {
    /*
     * The assertion that matters: a modifier in the snapshot that nothing reads
     * is an item that does nothing. Max oxygen is the cleanest of the six to
     * measure, being a single number the run is launched with.
     */
    const plain = reduce(rich(), { type: "LAUNCH_EXPEDITION" }).state;
    const packed = reduce(buy(rich(), "consumable.spare-canister"), {
      type: "LAUNCH_EXPEDITION",
    }).state;
    const base = selectMaxOxygen(fresh(), collectActiveModifiers(fresh()));

    expect(plain.expedition.maxOxygenSnapshot).toBe(base);
    expect(packed.expedition.maxOxygenSnapshot).toBe(Math.round(base * 1.5));
    expect(packed.expedition.oxygen).toBe(packed.expedition.maxOxygenSnapshot);
  });

  it("carries every held item at once", () => {
    let state = rich();

    for (const id of CONSUMABLE_IDS) {
      state = buy(state, id);
    }

    const launched = reduce(state, { type: "LAUNCH_EXPEDITION" }).state;
    const sources = new Set(
      (launched.expedition.modifierSnapshot?.modifiers ?? []).map((modifier) => modifier.sourceId),
    );

    for (const id of CONSUMABLE_IDS) {
      expect(sources.has(id), id).toBe(true);
    }

    expect(launched.expedition.modifierSnapshot?.luckPoints).toBeGreaterThanOrEqual(500);
    expect(launched.expedition.modifierSnapshot?.pickaxeCritChance).toBeGreaterThan(0);
    expect(launched.expedition.modifierSnapshot?.approachSpeed).toBeGreaterThan(1);
  });

  it("does not refund a run that failed", () => {
    /*
     * The rule that makes them a risk rather than a subscription. Driven all the
     * way to a real failure rather than asserted on the launch state, because
     * "nothing gives them back" has to survive every path out of a run.
     */
    const packed = buy(rich(), "consumable.spare-canister");
    let state = reduce(packed, { type: "LAUNCH_EXPEDITION" }).state;

    expect(state.heldConsumableIds).toEqual([]);

    // Drain the tank without pressing on, which is the shortest route to a loss.
    state = {
      ...state,
      expedition: { ...state.expedition, oxygen: 0.5 },
    };

    for (let step = 0; step < 2_000 && state.expedition.status !== "surface"; step += 1) {
      if (state.expedition.status === "decision") {
        state = reduce(state, { type: "CONTINUE_EXPEDITION" }).state;
        continue;
      }

      if (state.expedition.status === "choice") {
        const definition = ENCOUNTERS[state.expedition.currentEncounter?.encounterId as EncounterId];

        state = reduce(state, {
          type: "CHOOSE_ENCOUNTER_OPTION",
          optionId: definition.choiceOptions?.[0]?.id ?? "",
        }).state;
        continue;
      }

      state = tick(state, 100);
    }

    expect(state.statistics.runsFailed).toBeGreaterThan(0);
    expect(state.heldConsumableIds).toEqual([]);
  });

  it("does not refund a run that came home either", () => {
    const packed = buy(rich(), "consumable.stimulant");
    let state = reduce(packed, { type: "LAUNCH_EXPEDITION" }).state;

    for (let step = 0; step < 2_000; step += 1) {
      if (state.expedition.status === "decision") {
        state = reduce(state, { type: "RETURN_FROM_EXPEDITION" }).state;
        break;
      }

      if (state.expedition.status === "choice") {
        const definition = ENCOUNTERS[state.expedition.currentEncounter?.encounterId as EncounterId];

        state = reduce(state, {
          type: "CHOOSE_ENCOUNTER_OPTION",
          optionId: definition.choiceOptions?.[0]?.id ?? "",
        }).state;
        continue;
      }

      state = tick(state, 100);
    }

    expect(state.heldConsumableIds).toEqual([]);
  });
});

describe("prestige", () => {
  it("clears what is packed", () => {
    /*
     * Bought with chips, and chips reset — so carrying a packed bag over the wall
     * would be free value on the far side of a reset that is supposed to cost
     * something.
     */
    const packed = buy(rich(), "consumable.rabbits-foot");
    const ready: GameState = {
      ...packed,
      // `prestigeMetric` reads `cycleCashEarned`, not the cash balance — a
      // player who spent everything they earned is still eligible.
      prestige: { ...packed.prestige, cycleCashEarned: ECONOMY.prestigeThresholdCash * 10 },
    };

    const outcome = applyPrestige(ready);

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.heldConsumableIds).toEqual([]);
      // And the collection is untouched, which is the contrast that makes the
      // rule legible: permanent things stay, bought-with-chips things do not.
      expect(outcome.state.collection.ownedCatSkinIds.length).toBeGreaterThan(0);
    }
  });
});

describe("the save", () => {
  it("drops an id the build has never heard of", () => {
    const packed = buy(rich(), "consumable.stimulant");
    const raw = JSON.parse(JSON.stringify(packed)) as Record<string, unknown>;

    raw.heldConsumableIds = [
      "consumable.stimulant",
      "consumable.from-a-later-version",
      "consumable.stimulant",
    ];

    const normalized = normalizeGameState(raw, NOW);

    // Unknown dropped, duplicate collapsed — non-stackable is a rule of the
    // system, so it is enforced on load as well as on purchase.
    expect(normalized.state.heldConsumableIds).toEqual(["consumable.stimulant"]);
    expect(normalized.report.repairs.length).toBeGreaterThan(0);
  });

  it("defaults to nothing packed when the field is missing", () => {
    const raw = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;

    delete raw.heldConsumableIds;

    expect(normalizeGameState(raw, NOW).state.heldConsumableIds).toEqual([]);
  });

  it("survives a round trip with what was packed", () => {
    let state = rich();

    for (const id of CONSUMABLE_IDS) {
      state = buy(state, id);
    }

    const round = normalizeGameState(JSON.parse(JSON.stringify(state)) as unknown, NOW);

    expect(round.state.heldConsumableIds).toEqual(state.heldConsumableIds);
  });

  it("migrates a version 13 save to a bag that is simply empty", () => {
    const legacy = {
      saveVersion: 13,
      contentVersion: "0.1.0",
      revision: 2,
      savedAtUnixMs: NOW,
      game: { statistics: { catsFound: 0 } },
    };

    const migrated = runMigrations(legacy);

    expect(migrated.envelope.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(13));
    expect((migrated.envelope.game as Record<string, unknown>).heldConsumableIds).toEqual([]);
  });
});
