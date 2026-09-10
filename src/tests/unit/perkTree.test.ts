/**
 * Coverage for the prestige perk tree.
 *
 * Perks became repeatable, which means the things worth pinning are the ones a
 * one-shot perk never had to answer: does a rank actually scale the effect, does
 * a maxed perk stop selling, and does the price move.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY, PERK_BRANCH_IDS, PRESTIGE_PERKS, PRESTIGE_PERK_IDS } from "../../content/catalog";
import type { PrestigePerkId } from "../../content/catalog";
import { perkRankCost } from "../../content/prestigePerks";
import { collectActiveModifiers, evaluateStat, selectLuckPoints } from "../../domain/modifiers";
import { perkBlock, perkNextRankCost, perkRank, projectedSelenite } from "../../domain/prestige";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectPrestigeView } from "../../domain/selectors";
import { PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY } from "../../domain/prestige";
import { createGameState, type GameState } from "../../domain/state";
import { runMigrations } from "../../persistence/migrations";
import { migrationVersionsFrom } from "../migrationVersions";

const NOW = 1_700_000_000_000;

function fresh(seed = 5): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A state holding the given perk ranks, with selenite to spare. */
function withPerks(ranks: Partial<Record<PrestigePerkId, number>>, selenite = 100_000): GameState {
  const base = fresh();

  return {
    ...base,
    resources: { ...base.resources, selenite },
    prestige: { ...base.prestige, perkRanks: ranks },
  };
}

describe("the tree", () => {
  it("hangs every branch off a single root", () => {
    const root = PRESTIGE_PERKS["perk.foothold"];

    expect(root.prerequisitePerkIds).toEqual([]);

    for (const perkId of PRESTIGE_PERK_IDS) {
      const perk = PRESTIGE_PERKS[perkId];

      if (perk.id === root.id) {
        continue;
      }

      expect(perk.prerequisitePerkIds.length, `${perk.id} has no prerequisite`).toBeGreaterThan(0);
    }
  });

  it("puts every branch on the board", () => {
    for (const branchId of PERK_BRANCH_IDS) {
      const inBranch = PRESTIGE_PERK_IDS.filter(
        (perkId) => PRESTIGE_PERKS[perkId].branch === branchId,
      );

      expect(inBranch.length, `branch ${branchId}`).toBeGreaterThan(0);
    }
  });

  it("gates a branch until its parent is bought once", () => {
    // A prerequisite is met at rank 1, not at maximum: a branch opens as soon as
    // its parent is taken, rather than only once it is finished.
    const locked = withPerks({});
    const opened = withPerks({ "perk.foothold": 1 });

    expect(reduce(locked, { type: "BUY_PRESTIGE_PERK", perkId: "perk.house.edge" }).materialChange).toBe(
      false,
    );
    expect(reduce(opened, { type: "BUY_PRESTIGE_PERK", perkId: "perk.house.edge" }).materialChange).toBe(
      true,
    );
  });
});

describe("ranking a perk up", () => {
  it("scales the effect by the rank", () => {
    // Perks scale linearly: rank 3 is three times the authored effect. That is a
    // curve a player can hold in their head while spending on it.
    const luckAt = (rank: number): number =>
      selectLuckPoints(collectActiveModifiers(withPerks({ "perk.vault.charm": rank })));

    expect(luckAt(0)).toBe(0);
    expect(luckAt(1)).toBe(90);
    expect(luckAt(2)).toBe(180);
    expect(luckAt(5)).toBe(450);
  });

  it("compounds a reduction rather than scaling its excess", () => {
    /*
     * Shift work is below 1, so it uses the compounding branch. Linear excess
     * scaling would take the cycle to zero and then negative at high ranks.
     */
    const cycleAt = (rank: number): number =>
      evaluateStat(10_000, collectActiveModifiers(withPerks({ "perk.house.tempo": rank })), {
        targetStat: "machine.cycleMs",
      });

    expect(cycleAt(0)).toBe(10_000);
    expect(cycleAt(8)).toBeLessThan(cycleAt(4));
    expect(cycleAt(8)).toBeGreaterThan(0);
  });

  it("charges more for each successive rank, and stops at the maximum", () => {
    for (const perkId of PRESTIGE_PERK_IDS) {
      const perk = PRESTIGE_PERKS[perkId];

      // A repeatable perk has no maximum to stop at; its own case is below.
      if (perk.repeatable === true) {
        continue;
      }

      let previous = 0;

      for (let rank = 0; rank < perk.maximumRank; rank += 1) {
        const cost = perkRankCost(perk, rank);

        expect(cost, `${perkId} rank ${rank + 1}`).not.toBeNull();
        expect(cost ?? 0).toBeGreaterThanOrEqual(previous);
        previous = cost ?? 0;
      }

      // Nothing left to sell at the top.
      expect(perkRankCost(perk, perk.maximumRank)).toBeNull();
    }
  });

  it("sells a repeatable perk forever, at an unchanging price", () => {
    /*
     * Linear cost for linear benefit. A growing price would be a wall a few
     * dozen ranks along, which is the opposite of what a capstone is for, and
     * `validateContent` refuses one — this is the behaviour that rule protects.
     */
    const perk = PRESTIGE_PERKS["perk.apex"];

    expect(perk.repeatable).toBe(true);

    for (const rank of [0, 1, 50, 5_000]) {
      expect(perkRankCost(perk, rank), `rank ${String(rank)}`).toBe(perk.seleniteCost);
    }
  });

  it("opens the capstone only once the whole tree is finished", () => {
    /*
     * Every other perk opens as soon as its parent is *bought*. This one needs
     * them maxed, which is why it is a flag rather than a change to what a
     * prerequisite means — the latter would have re-gated the entire tree.
     */
    const base = createGameState({ nowUnixMs: 0, seed: 4 });
    const rich = { ...base, resources: { ...base.resources, selenite: 1e9 } };

    const allButOne = Object.fromEntries(
      PRESTIGE_PERK_IDS.filter((id) => id !== "perk.apex").map((id) => [
        id,
        PRESTIGE_PERKS[id].maximumRank,
      ]),
    );

    const oneShort: GameState = {
      ...rich,
      prestige: {
        ...rich.prestige,
        perkRanks: { ...allButOne, "perk.foothold": PRESTIGE_PERKS["perk.foothold"].maximumRank - 1 },
      },
    };

    expect(perkBlock(oneShort, "perk.apex")?.kind).toBe("prerequisite-required");

    const finished: GameState = {
      ...rich,
      prestige: { ...rich.prestige, perkRanks: allButOne },
    };

    expect(perkBlock(finished, "perk.apex")).toBeNull();
  });

  it("shows the capstone only once the whole tree is finished", () => {
    /*
     * The block above only shows the capstone cannot be bought early. Drawing it
     * from the first prestige as a locked card advertises a prerequisite the
     * player cannot act on for many cycles, which is not what "appears when
     * everything else is maxed" means.
     *
     * The regression guard is the third assertion: a filter bug that hid the
     * whole tree would satisfy the first two on its own.
     */
    const base = createGameState({ nowUnixMs: 0, seed: 4 });
    const rich = { ...base, resources: { ...base.resources, selenite: 1e9 } };
    const view = (state: GameState) =>
      selectPrestigeView(state, PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY).perks;

    const fresh = view(rich);

    expect(fresh.some((perk) => perk.id === "perk.apex")).toBe(false);

    const maxed: GameState = {
      ...rich,
      prestige: {
        ...rich.prestige,
        perkRanks: Object.fromEntries(
          PRESTIGE_PERK_IDS.filter((id) => id !== "perk.apex").map((id) => [
            id,
            PRESTIGE_PERKS[id].maximumRank,
          ]),
        ),
      },
    };

    const finished = view(maxed);

    expect(finished.some((perk) => perk.id === "perk.apex")).toBe(true);
    expect(finished.find((perk) => perk.id === "perk.apex")?.purchase.available).toBe(true);

    // Every ordinary perk is present in both states, hidden or not.
    for (const state of [fresh, finished]) {
      for (const perkId of PRESTIGE_PERK_IDS) {
        if (PRESTIGE_PERKS[perkId].requiresMaxedPrerequisites === true) {
          continue;
        }

        expect(state.some((perk) => perk.id === perkId), perkId).toBe(true);
      }
    }
  });

  it("keeps a revealed capstone visible when it is merely unaffordable", () => {
    // The filter is keyed on the block *kind*, not on whether it can be bought:
    // a capstone that has appeared must not vanish again when selenite is spent.
    const base = createGameState({ nowUnixMs: 0, seed: 4 });
    const maxed: GameState = {
      ...base,
      resources: { ...base.resources, selenite: 0 },
      prestige: {
        ...base.prestige,
        perkRanks: Object.fromEntries(
          PRESTIGE_PERK_IDS.filter((id) => id !== "perk.apex").map((id) => [
            id,
            PRESTIGE_PERKS[id].maximumRank,
          ]),
        ),
      },
    };

    const perks = selectPrestigeView(maxed, PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY).perks;
    const capstone = perks.find((perk) => perk.id === "perk.apex");

    expect(capstone).toBeDefined();
    expect(capstone?.purchase.available).toBe(false);
  });

  it("refuses to sell a rank past the maximum", () => {
    const perk = PRESTIGE_PERKS["perk.foothold"];
    const maxed = withPerks({ "perk.foothold": perk.maximumRank });

    expect(perkNextRankCost(maxed, "perk.foothold")).toBeNull();
    expect(
      reduce(maxed, { type: "BUY_PRESTIGE_PERK", perkId: "perk.foothold" }).materialChange,
    ).toBe(false);
  });

  it("buys a rank through the reducer and charges the stated price", () => {
    const state = withPerks({ "perk.foothold": 1 }, 500);
    const cost = perkNextRankCost(state, "perk.foothold") ?? 0;
    const bought = reduce(state, { type: "BUY_PRESTIGE_PERK", perkId: "perk.foothold" }).state;

    expect(perkRank(bought, "perk.foothold")).toBe(2);
    expect(bought.resources.selenite).toBe(500 - cost);
  });

  it("shows what the next rank buys before it is bought", () => {
    const view = selectPrestigeView(
      withPerks({ "perk.foothold": 1 }),
      PRESTIGE_RESET_SUMMARY,
      PRESTIGE_RETAIN_SUMMARY,
    );
    const root = view.perks.find((perk) => perk.id === "perk.foothold");

    expect(root?.rank).toBe(1);
    expect(root?.nextEffectSummary).toContain("machine payout");
    expect(root?.seleniteCost).not.toBeNull();
  });

  it("makes the very first perk visible on the machine it affects", () => {
    /*
     * `machine.payout` floors, and the starter machine pays 5 at level 1 — the
     * exact state a player is in right after their first prestige. A perk that
     * rounds back to 5 would look broken on the first purchase anyone makes.
     */
    const before = evaluateStat(5, [], { targetStat: "machine.payout" });
    const after = evaluateStat(
      5,
      collectActiveModifiers(withPerks({ "perk.foothold": 1 })),
      { targetStat: "machine.payout" },
    );

    expect(after).toBeGreaterThan(before);
  });
});

describe("the selenite award", () => {
  function earning(cash: number): GameState {
    const base = fresh();

    return {
      ...base,
      prestige: { ...base.prestige, cycleCashEarned: cash, lifetimeCashEarned: cash },
    };
  }

  it("pays more for cash over the minimum than it used to", () => {
    expect(ECONOMY.prestigeSeleniteExponent).toBe(0.75);

    // The old 0.6 exponent gave 1 / 2 / 9 / 36 at these points.
    expect(projectedSelenite(earning(250_000))).toBe(1);
    expect(projectedSelenite(earning(1_000_000))).toBe(2);
    expect(projectedSelenite(earning(10_000_000))).toBe(15);
    expect(projectedSelenite(earning(100_000_000))).toBe(89);
  });

  it("never pays less for earning more", () => {
    let previous = 0;

    for (let cash = 250_000; cash <= 200_000_000; cash *= 1.6) {
      const award = projectedSelenite(earning(cash));

      expect(award).toBeGreaterThanOrEqual(previous);
      previous = award;
    }
  });

  it("compounds through the Dividend perk", () => {
    // The one perk in the tree that feeds itself.
    const plain = earning(10_000_000);
    const withDividend: GameState = {
      ...plain,
      prestige: { ...plain.prestige, perkRanks: { "perk.vault.dividend": 4 } },
    };

    expect(projectedSelenite(withDividend)).toBeGreaterThan(projectedSelenite(plain));
  });
});

describe("the version 7 to 8 migration", () => {
  it("folds purchases to rank 1 and refunds the perks that no longer exist", () => {
    const legacy = {
      saveVersion: 7,
      contentVersion: "0.1.0",
      revision: 16,
      savedAtUnixMs: NOW,
      game: {
        resources: { selenite: 3 },
        prestige: {
          count: 2,
          purchasedPerkIds: [
            "perk.house-edge",
            "perk.seed-capital",
            "perk.lucky-charm",
            "perk.relic-consignment",
            "perk.refinery",
          ],
        },
      },
    };

    const migrated = runMigrations(legacy);
    const game = migrated.envelope.game as Record<string, unknown>;
    const prestige = game.prestige as Record<string, unknown>;
    const resources = game.resources as Record<string, unknown>;

    expect(migrated.appliedVersions).toEqual(migrationVersionsFrom(7));

    // The three that survive keep their purchase, at rank 1 under their new ids.
    expect(prestige.perkRanks).toEqual({
      "perk.house.edge": 1,
      "perk.house.capital": 1,
      "perk.vault.charm": 1,
    });

    // The two that were removed come back as selenite rather than vanishing.
    expect(resources.selenite).toBe(3 + 4 + 5);
  });

  it("normalises a rank beyond a perk's maximum", () => {
    const state = deriveContext(withPerks({ "perk.foothold": 99 })).state;

    // The state helper bypasses normalisation, so this is about the reducer not
    // trusting it: a hand-edited rank must not buy an unbounded effect.
    expect(perkRankCost(PRESTIGE_PERKS["perk.foothold"], perkRank(state, "perk.foothold"))).toBeNull();
  });
});

describe("what the next rank buys, in words", () => {
  it("describes a capability perk instead of leaving the line blank", () => {
    /*
     * `describePerkRank` maps over a perk's modifiers, and the pace perk buys a
     * behaviour rather than a number — so it produced an empty string, and the
     * panel rendered "Next:" followed by nothing. Found by looking at the perk
     * tree in three columns, where a blank line is impossible to miss.
     */
    const view = selectPrestigeView(
      withPerks({ "perk.deep.pace": 1 }),
      PRESTIGE_RESET_SUMMARY,
      PRESTIGE_RETAIN_SUMMARY,
    );
    const pace = view.perks.find((perk) => perk.id === "perk.deep.pace");

    expect(pace?.nextEffectSummary).toBe("4x expedition speed");
  });

  it("says nothing at all rather than something empty", () => {
    // Every perk either has a summary with content or has none. A perk added
    // later with a capability this does not know about renders no line, not a
    // blank one.
    const view = selectPrestigeView(
      withPerks({}),
      PRESTIGE_RESET_SUMMARY,
      PRESTIGE_RETAIN_SUMMARY,
    );

    for (const perk of view.perks) {
      if (perk.nextEffectSummary !== null) {
        expect(perk.nextEffectSummary.trim().length, perk.id).toBeGreaterThan(0);
      }
    }
  });

  it("writes a probability as a percentage, not as a floored zero", () => {
    /*
     * `formatCompact` floors anything below 1, so Ballast's -0.04 failure loss
     * chance read as "-0 failure loss chance" — wrong and meaningless. Also found
     * by reading the tree in columns rather than by any test.
     */
    const view = selectPrestigeView(
      withPerks({}),
      PRESTIGE_RESET_SUMMARY,
      PRESTIGE_RETAIN_SUMMARY,
    );
    const ballast = view.perks.find((perk) => perk.id === "perk.deep.ballast");

    expect(ballast?.nextEffectSummary).toBe("-4% failure loss chance");
    expect(ballast?.nextEffectSummary).not.toContain("-0 ");
  });

  it("still describes an ordinary perk by its numbers", () => {
    const view = selectPrestigeView(
      withPerks({}),
      PRESTIGE_RESET_SUMMARY,
      PRESTIGE_RETAIN_SUMMARY,
    );

    expect(view.perks.find((perk) => perk.id === "perk.foothold")?.nextEffectSummary).toContain(
      "machine payout",
    );
  });
});
