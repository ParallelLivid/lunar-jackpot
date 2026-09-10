import { describe, expect, it } from "vitest";
import {
  ECONOMY,
  ENCOUNTERS,
  GRADE_IDS,
  HIGHEST_GRADE,
  RESOURCE_METADATA,
  TOTEMS,
  TRINKETS,
  scaleModifiers,
} from "../../content/catalog";
import { TOTEM_FORBIDDEN_STATS } from "../../content/totems";
import { bandForDepth } from "../../content/depthBands";
import {
  describeCacheReward,
  grantCollectible,
  remainingFragmentCost,
} from "../../domain/collections";
import { selectEncounterWeight } from "../../domain/encounters";
import { equippedSlotOf, trinketUpgradeCost } from "../../domain/gear";
import { collectActiveModifiers, selectLuckPoints } from "../../domain/modifiers";
import { describeGrants } from "../../domain/selectors";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState, type TrinketProgress } from "../../domain/state";

const NO_PITY = { encountersSinceRecipePiece: 0, encountersSinceRelic: 0 };

function withTrinket(
  progress: Partial<TrinketProgress>,
  equipped: Array<string | null> = [null, null, null],
  tankLevel = 5,
): GameState {
  const base = createGameState({ nowUnixMs: 0, seed: 5 });

  return {
    ...base,
    gear: {
      ...base.gear,
      tankLevel,
      tankTrinketSlots: equipped as GameState["gear"]["tankTrinketSlots"],
    },
    collection: {
      ...base.collection,
      trinkets: {
        ...base.collection.trinkets,
        "trinket.bladder": { owned: true, grade: "E" as const, fragments: 0, ...progress },
      },
    },
  };
}

describe("fragment upgrades", () => {
  it("spends exactly the configured fragments and raises the grade", () => {
    const cost = trinketUpgradeCost("E") ?? 0;
    const state = withTrinket({ grade: "E", fragments: cost });
    const upgraded = reduce(state, { type: "UPGRADE_TRINKET", trinketId: "trinket.bladder" });

    expect(upgraded.materialChange).toBe(true);
    expect(upgraded.state.collection.trinkets["trinket.bladder"]).toEqual({
      owned: true,
      grade: "D",
      fragments: 0,
    });
  });

  it("refuses an upgrade with one fragment too few", () => {
    const cost = trinketUpgradeCost("E") ?? 0;
    const state = withTrinket({ grade: "E", fragments: cost - 1 });

    expect(
      reduce(state, { type: "UPGRADE_TRINKET", trinketId: "trinket.bladder" }).materialChange,
    ).toBe(false);
  });

  it("charges more for each successive grade", () => {
    const costs = GRADE_IDS.slice(0, -1).map((grade) => trinketUpgradeCost(grade) ?? 0);

    costs.forEach((cost, index) => {
      if (index > 0) {
        expect(cost).toBeGreaterThan(costs[index - 1]);
      }
    });

    // Nothing to buy at the top of the ladder.
    expect(trinketUpgradeCost(HIGHEST_GRADE)).toBeNull();
  });

  it("refuses to upgrade past the highest grade", () => {
    const state = withTrinket({ grade: HIGHEST_GRADE, fragments: 9_999 });

    expect(
      reduce(state, { type: "UPGRADE_TRINKET", trinketId: "trinket.bladder" }).materialChange,
    ).toBe(false);
  });

  it("upgrades in place, leaving the trinket equipped", () => {
    const cost = trinketUpgradeCost("E") ?? 0;
    const state = withTrinket({ grade: "E", fragments: cost }, ["trinket.bladder", null, null]);
    const upgraded = reduce(state, { type: "UPGRADE_TRINKET", trinketId: "trinket.bladder" }).state;

    expect(upgraded.gear.tankTrinketSlots[0]).toBe("trinket.bladder");
    expect(upgraded.collection.trinkets["trinket.bladder"].grade).toBe("D");
  });

  it("applies the upgraded grade to the next run", () => {
    const oxygenOf = (state: GameState): number =>
      reduce(state, { type: "LAUNCH_EXPEDITION" }).state.expedition.maxOxygenSnapshot;

    const gradeE = withTrinket({ grade: "E" }, ["trinket.bladder", null, null]);
    const gradeD = withTrinket({ grade: "D" }, ["trinket.bladder", null, null]);

    expect(oxygenOf(gradeD)).toBeGreaterThan(oxygenOf(gradeE));
  });

  it("refuses to upgrade a trinket that is not owned", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 6 });

    expect(
      reduce(base, { type: "UPGRADE_TRINKET", trinketId: "trinket.bladder" }).materialChange,
    ).toBe(false);
  });
});

describe("duplicates become fragments", () => {
  it("grants the item on the first find and fragments thereafter", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 9 });
    let state: GameState = {
      ...base,
      resources: { ...base.resources, keys: 40, caches: 40 },
    };

    for (let index = 0; index < 40; index += 1) {
      state = reduce(state, { type: "OPEN_CACHES", quantity: 1, cacheTypeId: "cache.standard" }).state;
    }

    const trinkets = Object.values(state.collection.trinkets);
    const ownedTrinkets = trinkets.filter((trinket) => trinket.owned);

    expect(ownedTrinkets.length).toBeGreaterThan(0);
    // Forty opens against four trinkets and four totems must have produced
    // duplicates, and every one of them arrived as fragments.
    expect(
      ownedTrinkets.some((trinket) => trinket.fragments > 0) ||
        Object.values(state.collection.totems).some((totem) => totem.fragments > 0),
    ).toBe(true);

    // A trinket is one entity: never a count, and never two grades at once.
    for (const trinket of trinkets) {
      expect(GRADE_IDS).toContain(trinket.grade);
    }
  });

  it("raises a totem grade once enough fragments are banked", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 11 });
    const cost = ECONOMY.totemFragmentCosts[0];
    const state: GameState = {
      ...base,
      collection: {
        ...base.collection,
        totems: {
          ...base.collection.totems,
          "totem.prospector": { owned: true, grade: "E" as const, fragments: cost },
        },
      },
    };

    const upgraded = reduce(state, { type: "UPGRADE_TOTEM", totemId: "totem.prospector" });

    expect(upgraded.materialChange).toBe(true);
    expect(upgraded.state.collection.totems["totem.prospector"]).toEqual({
      owned: true,
      grade: "D",
      fragments: 0,
    });
  });
});

describe("a find that can no longer improve anything", () => {
  const TRINKET = "trinket.bladder" as const;

  /** One trinket owned at `grade`, holding `fragments`, and nothing else. */
  function holding(grade: (typeof GRADE_IDS)[number], fragments: number): GameState {
    const base = createGameState({ nowUnixMs: 0, seed: 3 });

    return {
      ...base,
      collection: {
        ...base.collection,
        trinkets: {
          ...base.collection.trinkets,
          [TRINKET]: { owned: true, grade, fragments },
        },
      },
    };
  }

  const reward = { kind: "trinket" as const, trinketId: TRINKET };

  it("still pays a fragment while there is anything left to buy", () => {
    const granted = grantCollectible(holding("E", 0), reward);

    expect(granted.collection.trinkets[TRINKET].fragments).toBe(
      ECONOMY.fragmentsPerDuplicate,
    );
    expect(granted.resources.selenite).toBe(0);
  });

  it("pays selenite once the item is at the top of the ladder", () => {
    const granted = grantCollectible(holding(HIGHEST_GRADE, 0), reward);

    expect(granted.resources.selenite).toBe(ECONOMY.selenitePerMaxedDuplicate);
    // And the fragment count is left exactly where it was.
    expect(granted.collection.trinkets[TRINKET].fragments).toBe(0);
  });

  it("pays selenite once the banked fragments already reach the top", () => {
    /*
     * The half of the rule that is not obvious: the player has not spent them
     * yet, but nothing they find can improve on what they already hold, so a
     * fragment would be dead weight.
     */
    const enough = remainingFragmentCost("trinket", "E");
    const granted = grantCollectible(holding("E", enough), reward);

    expect(granted.resources.selenite).toBe(ECONOMY.selenitePerMaxedDuplicate);
  });

  it("still pays a fragment one short of that", () => {
    // The case that catches an off-by-one in the cost sum, which is the only
    // arithmetic in this whole rule.
    const enough = remainingFragmentCost("trinket", "E");
    const granted = grantCollectible(holding("E", enough - 1), reward);

    expect(granted.resources.selenite).toBe(0);
    expect(granted.collection.trinkets[TRINKET].fragments).toBe(
      enough - 1 + ECONOMY.fragmentsPerDuplicate,
    );
  });

  it("sums only the upgrades still ahead", () => {
    // Reaching the top from SS costs one step; from E it costs the whole ladder.
    expect(remainingFragmentCost("trinket", HIGHEST_GRADE)).toBe(0);
    expect(remainingFragmentCost("trinket", "SS")).toBe(
      ECONOMY.trinketFragmentCosts[GRADE_IDS.indexOf("SS")],
    );
    expect(remainingFragmentCost("trinket", "E")).toBe(
      ECONOMY.trinketFragmentCosts.reduce((total, cost) => total + cost, 0),
    );
  });

  it("reads the totem ladder for a totem", () => {
    // The two ladders hold the same numbers today and are separate constants
    // precisely so they need not: a helper that picked one would be wrong later.
    const base = createGameState({ nowUnixMs: 0, seed: 3 });
    const maxed: GameState = {
      ...base,
      collection: {
        ...base.collection,
        totems: {
          ...base.collection.totems,
          "totem.magpie": { owned: true, grade: HIGHEST_GRADE, fragments: 0 },
        },
      },
    };

    const granted = grantCollectible(maxed, { kind: "totem", totemId: "totem.magpie" });

    expect(granted.resources.selenite).toBe(ECONOMY.selenitePerMaxedDuplicate);
  });

  it("never pays selenite for something not yet owned", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 3 });
    const granted = grantCollectible(base, reward);

    expect(granted.collection.trinkets[TRINKET].owned).toBe(true);
    expect(granted.resources.selenite).toBe(0);
  });

  it("says what the player actually received", () => {
    // A silent substitution is the failure worth avoiding: the player can see
    // they drew a trinket, so the message has to explain why they got selenite.
    expect(describeCacheReward(holding("E", 0), reward)).toContain("fragment");
    expect(describeCacheReward(holding(HIGHEST_GRADE, 0), reward)).toContain("selenite");
    expect(describeCacheReward(holding(HIGHEST_GRADE, 0), reward)).toContain("maxed");
  });

  it("shows selenite on the run's own reward pop, not the collectible", () => {
    /*
     * The mid-run path. A collectible found in the rock goes through the same
     * grant, so the floating indicator has to show what was actually received —
     * showing the trinket sprite would claim something the player did not get.
     */
    const [pop] = describeGrants([{ kind: "collectible", reward, arrival: "selenite" }], 0);

    expect(pop.label).toContain("Selenite");
    expect(pop.label).toContain("maxed");
    expect(pop.amount).toBe(ECONOMY.selenitePerMaxedDuplicate);
    expect(pop.spriteId).toBe(RESOURCE_METADATA.selenite.spriteId);
  });

  it("still shows the collectible when it is the collectible", () => {
    const [found] = describeGrants([{ kind: "collectible", reward, arrival: "item" }], 0);
    const [fragments] = describeGrants(
      [{ kind: "collectible", reward, arrival: "fragments" }],
      0,
    );

    expect(found.label).toBe(TRINKETS[TRINKET].displayName);
    expect(found.spriteId).toBe(TRINKETS[TRINKET].spriteId);
    expect(fragments.label).toContain("fragments");
  });
});

describe("trinket equipment rules", () => {
  it("rejects a trinket on the gear it does not target", () => {
    const state = withTrinket({});

    expect(
      reduce(state, {
        type: "EQUIP_TRINKET",
        gearId: "pickaxe",
        slot: 0,
        trinketId: "trinket.bladder",
      }).materialChange,
    ).toBe(false);
  });

  it("moves the single copy rather than seating it twice", () => {
    const state = withTrinket({}, ["trinket.bladder", null, null]);
    const moved = reduce(state, {
      type: "EQUIP_TRINKET",
      gearId: "tank",
      slot: 1,
      trinketId: "trinket.bladder",
    });

    expect(moved.materialChange).toBe(true);
    expect(moved.state.gear.tankTrinketSlots).toEqual([null, "trinket.bladder", null]);
    expect(equippedSlotOf(moved.state, "trinket.bladder")).toEqual({
      gearId: "tank",
      slotIndex: 1,
    });
  });

  it("refuses a locked slot and equipment changes during a run", () => {
    const lowLevel = withTrinket({}, [null, null, null], 1);

    expect(
      reduce(lowLevel, {
        type: "EQUIP_TRINKET",
        gearId: "tank",
        slot: 1,
        trinketId: "trinket.bladder",
      }).materialChange,
    ).toBe(false);

    const running = reduce(withTrinket({}), { type: "LAUNCH_EXPEDITION" }).state;

    expect(
      reduce(running, {
        type: "EQUIP_TRINKET",
        gearId: "tank",
        slot: 0,
        trinketId: "trinket.bladder",
      }).materialChange,
    ).toBe(false);
  });

  it("refuses to equip a trinket that is not owned", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 7 });

    expect(
      reduce(base, {
        type: "EQUIP_TRINKET",
        gearId: "tank",
        slot: 0,
        trinketId: "trinket.bladder",
      }).materialChange,
    ).toBe(false);
  });
});

describe("totem restrictions", () => {
  function withTotems(): GameState {
    const base = createGameState({ nowUnixMs: 0, seed: 7 });

    return {
      ...base,
      collection: {
        ...base.collection,
        totems: {
          ...base.collection.totems,
          "totem.prospector": { owned: true, grade: "E" as const, fragments: 0 },
        },
      },
    };
  }

  it("never targets tank oxygen or pickaxe damage at any grade", () => {
    for (const totem of Object.values(TOTEMS)) {
      for (const grade of GRADE_IDS) {
        for (const modifier of scaleModifiers(totem.baseModifiers, grade)) {
          expect(TOTEM_FORBIDDEN_STATS).not.toContain(modifier.targetStat);
        }
      }
    }
  });

  it("refuses to seat the same totem in two slots", () => {
    const first = reduce(withTotems(), {
      type: "EQUIP_TOTEM",
      slot: 0,
      totemId: "totem.prospector",
    });

    expect(first.materialChange).toBe(true);
    expect(
      reduce(first.state, { type: "EQUIP_TOTEM", slot: 1, totemId: "totem.prospector" })
        .materialChange,
    ).toBe(false);
  });

  it("refuses an unowned totem and refuses changes during a run", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 8 });

    expect(
      reduce(base, { type: "EQUIP_TOTEM", slot: 0, totemId: "totem.magpie" }).materialChange,
    ).toBe(false);

    const running = reduce(withTotems(), { type: "LAUNCH_EXPEDITION" }).state;

    expect(
      reduce(running, { type: "EQUIP_TOTEM", slot: 0, totemId: "totem.prospector" })
        .materialChange,
    ).toBe(false);
  });
});

describe("luck and expedition outcomes", () => {
  const beneficial = ENCOUNTERS["encounter.oxygen.shelf"];
  const neutral = ENCOUNTERS["encounter.ore.shelf.light"];

  it("raises beneficial encounter weight with luck and leaves others alone", () => {
    const withoutLuck = selectEncounterWeight(beneficial, [], 0, NO_PITY);
    const withLuck = selectEncounterWeight(beneficial, [], 40, NO_PITY);

    expect(withLuck).toBeGreaterThan(withoutLuck);

    expect(selectEncounterWeight(neutral, [], 40, NO_PITY)).toBe(
      selectEncounterWeight(neutral, [], 0, NO_PITY),
    );
  });

  /**
   * Points that produce a given luck factor.
   *
   * The test used to hardcode 54 points, which was a 0.57 factor against the old
   * half-point of 40 and is only 0.18 against the current 250. Deriving the
   * points from the factor keeps the assertion about behaviour rather than about
   * a magic number that quietly stops meaning anything when the curve moves.
   */
  const pointsForFactor = (factor: number): number =>
    (ECONOMY.luckDiminishingHalfPoint * factor) / (1 - factor);

  it("shifts the beneficial share of a weighted draw measurably", () => {
    const share = (luckPoints: number): number => {
      const weights = Object.values(ENCOUNTERS)
        .filter((encounter) => encounter.bands.includes(bandForDepth(8).id))
        .map((encounter) => ({
          encounter,
          weight: selectEncounterWeight(encounter, [], luckPoints, NO_PITY),
        }));

      const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
      const good = weights
        .filter((entry) => entry.encounter.beneficialTags.includes("beneficial"))
        .reduce((sum, entry) => sum + entry.weight, 0);

      return good / total;
    };

    expect(share(pointsForFactor(0.57))).toBeGreaterThan(share(0) + 0.03);
  });

  it("lets a rare-find totem raise rare encounter weight through its tags", () => {
    const base = createGameState({ nowUnixMs: 0, seed: 10 });
    const withMagpie: GameState = {
      ...base,
      collection: {
        ...base.collection,
        totems: {
          ...base.collection.totems,
          "totem.magpie": { owned: true, grade: "C" as const, fragments: 0 },
        },
        activeTotemIds: ["totem.magpie", null, null],
      },
    };

    const modifiers = collectActiveModifiers(withMagpie);
    const rare = ENCOUNTERS["encounter.rare.shelf"];

    expect(
      selectEncounterWeight(rare, modifiers, selectLuckPoints(modifiers), NO_PITY),
    ).toBeGreaterThan(selectEncounterWeight(rare, [], 0, NO_PITY));
  });

  it("raises the weight of a pity-protected encounter once the threshold passes", () => {
    const rare = ENCOUNTERS["encounter.rare.shelf"];
    const starved = {
      encountersSinceRecipePiece: ECONOMY.pityEncounterThreshold,
      encountersSinceRelic: 0,
    };

    expect(selectEncounterWeight(rare, [], 0, starved)).toBeGreaterThan(
      selectEncounterWeight(rare, [], 0, NO_PITY),
    );
  });
});
