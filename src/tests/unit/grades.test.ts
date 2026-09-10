/**
 * Coverage for the collectible grade ladder.
 *
 * The ladder is formula-derived, so these tests guard the formula rather than a
 * table: that every grade is stronger than the one below it, that grade E is
 * exactly what the designer authored, that no scaled value can invert a stat,
 * and that the migration off the old three-tier system never weakened anyone.
 */

import { describe, expect, it } from "vitest";
import {
  ECONOMY,
  GRADE_IDS,
  GRADE_SCALARS,
  HIGHEST_GRADE,
  LOWEST_GRADE,
  TOTEMS,
  TRINKETS,
  scaleModifiers,
} from "../../content/catalog";
import type { GradeId, Modifier } from "../../content/catalog";
import { cappedSlotWeights, expectedReturn } from "../../domain/gambling";
import { collectActiveModifiers, luckFactor, selectLuckPoints } from "../../domain/modifiers";
import { createGameState, type GameState } from "../../domain/state";
import { STAT_RULES } from "../../content/economy";

const COLLECTIBLES = [...Object.values(TRINKETS), ...Object.values(TOTEMS)];

/** The single number a modifier contributes, comparable across operations. */
function magnitude(modifier: Modifier): number {
  return modifier.operation === "add" ? modifier.value : modifier.value - 1;
}

describe("the grade ladder", () => {
  it("starts at the authored effect", () => {
    expect(GRADE_SCALARS[0]).toBe(1);
    expect(LOWEST_GRADE).toBe("E");
    expect(HIGHEST_GRADE).toBe("SSS");

    for (const collectible of COLLECTIBLES) {
      const scaled = scaleModifiers(collectible.baseModifiers, LOWEST_GRADE);

      scaled.forEach((modifier, index) => {
        expect(modifier.value).toBeCloseTo(collectible.baseModifiers[index].value, 10);
      });
    }
  });

  it("makes every grade strictly stronger than the one below it", () => {
    for (const collectible of COLLECTIBLES) {
      for (let index = 1; index < GRADE_IDS.length; index += 1) {
        const lower = scaleModifiers(collectible.baseModifiers, GRADE_IDS[index - 1]);
        const higher = scaleModifiers(collectible.baseModifiers, GRADE_IDS[index]);

        higher.forEach((modifier, slot) => {
          expect(
            Math.abs(magnitude(modifier)),
            `${collectible.id} at ${GRADE_IDS[index]}`,
          ).toBeGreaterThan(Math.abs(magnitude(lower[slot])));
        });
      }
    }
  });

  it("never scales a modifier into something that would invert a stat", () => {
    for (const collectible of COLLECTIBLES) {
      for (const grade of GRADE_IDS) {
        for (const modifier of scaleModifiers(collectible.baseModifiers, grade)) {
          expect(Number.isFinite(modifier.value)).toBe(true);

          if (modifier.operation === "multiply") {
            expect(modifier.value, `${collectible.id} at ${grade}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("gives every grade a non-empty effect summary", () => {
    for (const collectible of COLLECTIBLES) {
      for (const grade of GRADE_IDS) {
        const summary = collectible.describeEffect(
          scaleModifiers(collectible.baseModifiers, grade),
        );

        expect(summary.length).toBeGreaterThan(0);
        expect(summary).not.toContain("NaN");
      }
    }
  });

  it("tags each grade's modifiers with the grade they came from", () => {
    const scaled = scaleModifiers(TRINKETS["trinket.bladder"].baseModifiers, "A");

    expect(scaled[0].sourceId).toBe("trinket.bladder:A");
  });

  it("charges a rising, fully covered fragment cost for every upgrade", () => {
    for (const curve of [ECONOMY.trinketFragmentCosts, ECONOMY.totemFragmentCosts]) {
      expect(curve).toHaveLength(GRADE_IDS.length - 1);

      curve.forEach((cost, index) => {
        expect(cost).toBeGreaterThan(0);

        if (index > 0) {
          expect(cost).toBeGreaterThan(curve[index - 1]);
        }
      });
    }
  });

  it("costs a Fibonacci run of duplicate finds to climb the whole ladder", () => {
    // A duplicate is worth one fragment, so a cost is also a count of finds.
    expect(ECONOMY.fragmentsPerDuplicate).toBe(1);

    for (const curve of [ECONOMY.trinketFragmentCosts, ECONOMY.totemFragmentCosts]) {
      expect(curve).toEqual([3, 5, 8, 13, 21, 34, 55]);

      curve.forEach((cost, index) => {
        if (index >= 2) {
          expect(cost).toBe(curve[index - 1] + curve[index - 2]);
        }
      });

      // Grade C is roughly where the old three-tier maximum sat; the ladder
      // above it is the long tail, at about half its former length.
      expect(curve[0] + curve[1]).toBe(8);
      expect(curve.reduce((total, cost) => total + cost, 0)).toBe(139);
    }
  });
});

describe("the migration off three tiers", () => {
  /**
   * The old tier values, frozen. Version 3 is a historical shape, so comparing
   * against the live content would stop testing anything the day it is retuned.
   */
  const OLD_VALUES: Record<string, Record<number, number>> = {
    "trinket.bladder": { 1: 8, 2: 18, 3: 32 },
    "trinket.regulator": { 1: 0.08, 2: 0.16, 3: 0.26 },
    "trinket.tungsten-head": { 1: 3, 2: 7, 3: 13 },
    "trinket.ore-sieve": { 1: 0.15, 2: 0.3, 3: 0.5 },
  };

  const MAPPING: Record<number, GradeId> = { 1: "E", 2: "D", 3: "C" };

  it("never weakens a rescaled trinket", () => {
    for (const [trinketId, byTier] of Object.entries(OLD_VALUES)) {
      const definition = TRINKETS[trinketId as keyof typeof TRINKETS];

      for (const [tier, oldValue] of Object.entries(byTier)) {
        const scaled = scaleModifiers(definition.baseModifiers, MAPPING[Number(tier)]);

        expect(
          Math.abs(magnitude(scaled[0])),
          `${trinketId} tier ${tier}`,
        ).toBeGreaterThanOrEqual(oldValue - 1e-9);
      }
    }
  });

  it("never weakens the prospector, whose luck curve moved with it", () => {
    // The half-point moved 40 -> 250 and the base moved 12 -> 75 by the same
    // factor, so the factor a player actually experiences must not drop.
    const oldFactor = (points: number): number => points / (points + 40);
    const oldByRank: Record<number, number> = { 1: 12, 2: 20, 3: 28 };

    for (const [rank, oldPoints] of Object.entries(oldByRank)) {
      const scaled = scaleModifiers(
        TOTEMS["totem.prospector"].baseModifiers,
        MAPPING[Number(rank)],
      );

      expect(luckFactor(scaled[0].value), `rank ${rank}`).toBeGreaterThanOrEqual(
        oldFactor(oldPoints) - 1e-9,
      );
    }
  });

  it("actually delivers the re-anchored luck through the real pipeline", () => {
    /*
     * The original version of these tests called `luckFactor` directly, which
     * skips `evaluateStat` and therefore skips the stat clamp. That let a real
     * bug through for two chunks: `STAT_RULES.luck` capped at 100 while
     * `luckPointCap` said 25,000, so every luck value was pinned at 100 and the
     * re-anchor was a nerf. Going through `collectActiveModifiers` is what makes
     * this test able to fail.
     */
    const base = createGameState({ nowUnixMs: 0, seed: 3 });
    const equipped: GameState = {
      ...base,
      collection: {
        ...base.collection,
        totems: {
          ...base.collection.totems,
          "totem.prospector": { owned: true, grade: HIGHEST_GRADE, fragments: 0 },
        },
        activeTotemIds: ["totem.prospector", null, null],
      },
    };

    const points = selectLuckPoints(collectActiveModifiers(equipped));

    expect(points).toBeGreaterThan(1_000);
    expect(luckFactor(points)).toBeGreaterThan(0.9);
  });

  it("keeps the stat clamp and the economy cap as one number", () => {
    // Two sources of truth for the same ceiling is exactly how the bug above
    // survived: nothing compared them.
    expect(STAT_RULES.luck.maximum).toBe(ECONOMY.luckPointCap);
  });

  it("keeps the Lucky charm perk worth what it was", () => {
    // A flat +10 against a half-point of 40 bought a 0.2 factor. The perk was
    // rebased to 63 so it still does, rather than silently becoming a sixth of
    // its former self when the curve moved.
    expect(luckFactor(63)).toBeCloseTo(10 / (10 + 40), 2);
  });
});

describe("the redesigned totems", () => {
  it("moved off the stats that could not scale", () => {
    const everyStat = COLLECTIBLES.flatMap((collectible) =>
      collectible.baseModifiers.map((modifier) => modifier.targetStat),
    );

    // Both are clamped hard enough that grades B and above would have been inert
    // on them. Nothing should target either again without revisiting the ladder.
    expect(everyStat).not.toContain("expedition.failureLossChance");
    expect(everyStat).not.toContain("gambling.outcomeWeight");
  });

  it("reaches the top of the ladder without hitting a ceiling", () => {
    for (const totemId of ["totem.anchor", "totem.gambler"] as const) {
      const top = scaleModifiers(TOTEMS[totemId].baseModifiers, HIGHEST_GRADE);
      const bottom = scaleModifiers(TOTEMS[totemId].baseModifiers, LOWEST_GRADE);

      // A tenfold-plus gain is the whole point of moving them.
      expect(magnitude(top[0]) / magnitude(bottom[0])).toBeCloseTo(100, 5);
    }
  });

  it("keeps the slot expected return capped across the whole luck range", () => {
    for (const points of [0, 250, 2_500, ECONOMY.luckPointCap]) {
      expect(expectedReturn(cappedSlotWeights([], points))).toBeLessThanOrEqual(
        ECONOMY.gamblingMaxExpectedReturn + 1e-9,
      );
    }
  });
});
