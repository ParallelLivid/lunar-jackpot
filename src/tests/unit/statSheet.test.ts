/**
 * Coverage for the stat sheet.
 *
 * The sheet computes nothing of its own — `collectActiveModifiers` gathers the
 * modifiers and `explainStat` walks them — so what is worth pinning is the
 * *mapping*: that a contribution arrives with the name of the thing that caused
 * it, and that a value nobody would recognise never reaches the screen.
 *
 * The load-bearing case is the multiplier one. Half these stats round to whole
 * numbers, which is correct where the base is a real quantity and catastrophic
 * where the base is 1 — a 3.4x payout multiplier floors to "3x" and the sheet
 * quietly understates every perk the player has bought.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, PRESTIGE_PERKS, TRINKETS } from "../../content/catalog";
import { deriveContext, selectStatSheetView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";

const NOW = 1_700_000_000_000;

function fresh(): GameState {
  return createGameState({ nowUnixMs: NOW, seed: 5 });
}

function sheetOf(state: GameState) {
  return selectStatSheetView(deriveContext(state));
}

function row(state: GameState, key: string) {
  return sheetOf(state)
    .groups.flatMap((group) => group.rows)
    .find((entry) => entry.key === key);
}

/** A grade C spare bladder, fitted to the tank. */
function wearingBladder(): GameState {
  const base = fresh();

  return {
    ...base,
    collection: {
      ...base.collection,
      trinkets: {
        ...base.collection.trinkets,
        "trinket.bladder": { owned: true, grade: "C", fragments: 0 },
      },
    },
    gear: { ...base.gear, tankTrinketSlots: ["trinket.bladder", null, null] },
  };
}

describe("naming what changed a stat", () => {
  it("credits an equipped trinket by name and grade", () => {
    const oxygen = row(wearingBladder(), "gear.tankOxygen");

    expect(oxygen?.contributions).toHaveLength(1);
    expect(oxygen?.contributions[0].label).toBe(TRINKETS["trinket.bladder"].displayName);
    // The grade rides on the source id as a suffix; it has to survive the split.
    expect(oxygen?.contributions[0].qualifier).toBe("C");
    expect(oxygen?.contributions[0].effect).toMatch(/^\+/);
  });

  it("credits a perk by name and rank", () => {
    const base = fresh();
    const withPerk: GameState = {
      ...base,
      prestige: { ...base.prestige, perkRanks: { "perk.foothold": 3 } },
    };

    const payout = row(withPerk, "machine.payout");

    expect(payout?.contributions).toHaveLength(1);
    expect(payout?.contributions[0].label).toBe(PRESTIGE_PERKS["perk.foothold"].displayName);
    expect(payout?.contributions[0].qualifier).toBe("3");
  });

  it("credits cats, which are the one source that is not content", () => {
    const base = fresh();
    const met: GameState = { ...base, statistics: { ...base.statistics, catsFound: 4 } };
    const luck = row(met, "luck");

    expect(luck?.contributions[0].label).toBe("Cats met");
    expect(luck?.contributions[0].qualifier).toBeNull();
    expect(luck?.valueText).toContain(String(4 * ECONOMY.luckPerCat));
  });
});

describe("reporting the value", () => {
  it("does not round a multiplier away", () => {
    /*
     * `machine.payout` rounds to whole numbers, which is right when the base is a
     * machine's actual payout. Evaluated from a base of 1 to get the factor, that
     * same rounding turns 1.6x into "1x" — the sheet would report that three
     * ranks of a bought perk do nothing at all.
     */
    const base = fresh();
    const withPerk: GameState = {
      ...base,
      prestige: { ...base.prestige, perkRanks: { "perk.foothold": 3 } },
    };

    const payout = row(withPerk, "machine.payout");

    // Rank 3 of a 1.2 perk scales the excess: 1 + 0.2 * 3.
    expect(payout?.valueText).toBe("x1.6");
    expect(payout?.baseText).toBe("x1");
  });

  it("shows a ratio as a percentage rather than a bare fraction", () => {
    const loss = row(fresh(), "expedition.failureLossChance");

    expect(loss?.valueText).toBe("50.0%");
  });

  it("marks an untouched stat as unchanged rather than hiding it", () => {
    // A sheet whose rows appear and disappear as trinkets are equipped is harder
    // to read than one that does not.
    const crit = row(fresh(), "gear.pickaxeCritChance");

    expect(crit?.unchanged).toBe(true);
    expect(crit?.contributions).toEqual([]);
  });

  it("pairs luck points with the curve they actually buy", () => {
    /*
     * Points are what modifiers add; the factor is what every weighted draw
     * consumes, and it asymptotes. A player reading the points alone cannot tell
     * whether more would help.
     */
    const base = fresh();
    const lucky: GameState = { ...base, statistics: { ...base.statistics, catsFound: 40 } };
    const group = sheetOf(lucky).groups.find((entry) => entry.title === "Luck");

    expect(group?.rows.map((entry) => entry.key)).toEqual(["luck", "luck.factor"]);
    expect(group?.rows[1].valueText).toMatch(/%$/);
    expect(group?.rows[1].valueText).not.toBe(group?.rows[1].baseText);
  });
});

describe("what the sheet leaves out", () => {
  it("omits the tag-scoped stats rather than inventing a single number for them", () => {
    /*
     * A modifier on encounter weight or gambling outcome weight applies only to
     * outcomes carrying a matching tag, so any one figure for either would be
     * wrong for most of what it claims to describe.
     */
    const keys = sheetOf(fresh())
      .groups.flatMap((group) => group.rows)
      .map((entry) => entry.key);

    expect(keys).not.toContain("expedition.encounterWeight");
    expect(keys).not.toContain("gambling.outcomeWeight");
  });

  it("says a run is using its own snapshot, and only during one", () => {
    const surface = sheetOf(fresh());

    expect(surface.snapshotNotice).toBeNull();

    const base = fresh();
    const running: GameState = {
      ...base,
      expedition: { ...base.expedition, status: "decision" },
    };

    expect(sheetOf(running).snapshotNotice).not.toBeNull();
  });
});
