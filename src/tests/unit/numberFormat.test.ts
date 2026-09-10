/**
 * Coverage for the number-format setting.
 *
 * The bug this pins down was not a formatting mistake — `formatCompact` was
 * always correct. It was that most of the interface never asked. The resource
 * bar anded the player's setting with a per-resource `compactAtLargeValues`
 * flag that was true for exactly two of the seven resources, and the run
 * inventory printed raw integers without consulting anything at all.
 *
 * So the assertions here are deliberately about *coverage* rather than about any
 * one number: every resource honours the setting, and every carried quantity
 * does too. A test naming only cash and chips would have passed against the bug.
 */

import { describe, expect, it } from "vitest";
import { RESOURCE_IDS } from "../../content/catalog";
import { INFINITE, formatCompact, formatQuantity, formatRate } from "../../domain/numbers";
import {
  deriveContext,
  selectExpeditionView,
  selectResourceViews,
  selectTotalCashPerSecond,
} from "../../domain/selectors";
import {
  createEmptyRunInventory,
  createGameState,
  type GameState,
  type NumberFormatMode,
} from "../../domain/state";

const NOW = 1_700_000_000_000;
const HUGE = 1_234_567_890;

function fresh(): GameState {
  return createGameState({ nowUnixMs: NOW, seed: 7 });
}

function withFormat(state: GameState, numberFormat: NumberFormatMode): GameState {
  return { ...state, settings: { ...state.settings, numberFormat } };
}

/** Every resource holding a number long enough that the notation is visible. */
function loaded(): GameState {
  const state = fresh();

  return {
    ...state,
    resources: RESOURCE_IDS.reduce(
      (balances, id) => ({ ...balances, [id]: HUGE }),
      state.resources,
    ),
  };
}

/**
 * The rounding carry.
 *
 * `formatCompact` chose its fraction digits from the value *before* rounding it
 * and never re-examined the suffix afterwards, so anything that `toFixed`
 * carried across a boundary printed the boundary it had just left. Three of the
 * four cases were cosmetic; the fourth changed the number, because a carry past
 * 1,000 has to advance the suffix.
 *
 * A table rather than four `it` blocks: the faults are one bug at four
 * thresholds, and the interesting thing about any row is the row above it.
 */
describe("formatCompact rounds before it picks a unit", () => {
  const cases: Array<[label: string, input: number, output: string]> = [
    ["below the ladder", 999, "999"],
    ["the first rung", 1_000, "1.00K"],
    ["no carry at all", 1_500, "1.50K"],
    ["carries across ten", 9_999, "10.0K"],
    ["sits on ten", 10_000, "10.0K"],
    ["carries across a hundred", 99_999, "100K"],
    ["sits on a hundred", 100_000, "100K"],
    // The one that changed the number rather than the decimal: this printed
    // "1000K", which is a unit the ladder had already outgrown.
    ["carries into the next unit", 999_999, "1.00M"],
    ["sits on the next unit", 1_000_000, "1.00M"],
    ["carries three units up", 999_999_999_999, "1.00T"],
    // What "max me out" sets a balance to, which was always correct — and the
    // reported failure, which is the same balance a little way spent.
    ["the maxed balance", 1e13, "10.0T"],
    ["the reported bug", 9_999_999_999_999, "10.0T"],
    ["a unit past T", 1.234e15, "1.23Qa"],
    ["past the last suffix", 1e100, "1.00e+100"],
    ["a sign survives a carry", -999_999, "-1.00M"],
    ["zero", 0, "0"],
  ];

  for (const [label, input, output] of cases) {
    it(`${label}: ${String(input)} reads ${output}`, () => {
      expect(formatCompact(input)).toBe(output);
    });
  }

  it("still reports an infinite balance as INF", () => {
    // The carry arithmetic runs on `magnitude`, so the early return for INF has
    // to keep coming first — dividing Infinity by a thousand is Infinity.
    expect(formatCompact(INFINITE)).toBe("INF");
  });

  it("honours a caller's own fraction width through a carry", () => {
    // The promoted branch resets to `fractionDigits` rather than to a literal 2,
    // which is the difference between honouring the argument and ignoring it.
    expect(formatCompact(999_999, 0)).toBe("1M");
    expect(formatCompact(999_999, 3)).toBe("1.000M");
  });

  it("never prints a mantissa the suffix has outgrown", () => {
    /*
     * The property behind the table. Whatever the input, a compact reading is
     * either exponential or a number below 1,000 followed by a suffix — "1000K"
     * satisfied neither and was the shape of the bug.
     */
    for (let exponent = 3; exponent <= 30; exponent += 1) {
      for (const step of [1, 0.999_999, 0.999_999_999]) {
        const text = formatCompact(10 ** exponent * step);

        if (text.includes("e+")) {
          continue;
        }

        const mantissa = Number.parseFloat(text);

        expect(mantissa, `${String(10 ** exponent * step)} read as ${text}`).toBeLessThan(1_000);
        expect(mantissa).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("formatQuantity", () => {
  it("is the compact and exact formatters behind one decision", () => {
    expect(formatQuantity(HUGE, "compact")).toBe("1.23B");
    expect(formatQuantity(HUGE, "exact")).toBe("1,234,567,890");
  });

  it("leaves a small number alone in either mode", () => {
    // Which is why honouring the setting for every resource costs nothing: a
    // relic count of 12 reads the same whichever mode the player is in.
    expect(formatQuantity(12, "compact")).toBe("12");
    expect(formatQuantity(12, "exact")).toBe("12");
  });
});

/**
 * The rate readout.
 *
 * `formatCompact` floors below a thousand, which is right for a balance and
 * wrong for a per-second rate: it turns everything under one into a flat "0",
 * which reads as a floor that has stopped rather than one paying slowly.
 */
describe("formatRate", () => {
  it("says <1 rather than 0 for a rate that has not reached one", () => {
    expect(formatRate(0.4)).toBe("<1");
    expect(formatRate(0.999)).toBe("<1");
    // The smallest rate that is still a rate. `formatCompact` calls this "0".
    expect(formatRate(Number.MIN_VALUE)).toBe("<1");
  });

  it("leaves zero alone, because zero is true", () => {
    // A floor with nothing unlocked produces nothing, and "<1" would be a lie
    // about it rather than a rounding of it.
    expect(formatRate(0)).toBe("0");
  });

  it("is the compact formatter everywhere else", () => {
    for (const value of [1, 1.67, 12, 999, 1_500, 1_234_567, INFINITE]) {
      expect(formatRate(value)).toBe(formatCompact(value));
    }
  });

  it("does not make the starter floor's rate any more precise", () => {
    /*
     * Deliberate, and worth pinning so nobody reads note 3 as fixed twice.
     *
     * The note opens with "1 cash/s is displayed a lot for early machine
     * levels", and the starter machine pays 5 every 3s — 1.67/s, which this
     * still prints as "1", because the note's actual instruction was about the
     * sub-unit case. Widening the rate to a decimal is a separate decision about
     * notation, and it belongs to whoever makes it rather than to this helper.
     */
    const rate = selectTotalCashPerSecond(deriveContext(fresh()));

    expect(rate).toBeCloseTo(5 / 3, 5);
    expect(formatRate(rate)).toBe("1");
  });
});

describe("the resource bar", () => {
  it("truncates every resource, not just cash and chips", () => {
    /*
     * The regression. `compactAtLargeValues` was true only for cash and chips,
     * so dev-editing selenite to a billion printed ten digits and toggling the
     * setting did nothing to it — the setting was never consulted for that row.
     */
    const views = selectResourceViews(loaded());

    expect(views).toHaveLength(RESOURCE_IDS.length);

    for (const view of views) {
      expect(view.displayText).toBe("1.23B");
    }
  });

  it("shows every resource exactly when the player asks for exact", () => {
    for (const view of selectResourceViews(withFormat(loaded(), "exact"))) {
      expect(view.displayText).toBe("1,234,567,890");
    }
  });

  it("keeps the full number available whatever the setting", () => {
    // The tooltip and the screen-reader line read `exactText`, so the exact
    // figure is never actually lost by compacting the visible one.
    for (const view of selectResourceViews(loaded())) {
      expect(view.exactText).toBe("1,234,567,890");
    }
  });

  it("changes with the setting and nothing else", () => {
    const compact = selectResourceViews(loaded());
    const exact = selectResourceViews(withFormat(loaded(), "exact"));

    for (let index = 0; index < compact.length; index += 1) {
      expect(exact[index].displayText).not.toBe(compact[index].displayText);
      expect(exact[index].value).toBe(compact[index].value);
      expect(exact[index].exactText).toBe(compact[index].exactText);
    }
  });
});

describe("the Carrying list", () => {
  function carrying(numberFormat: NumberFormatMode) {
    const state = withFormat(fresh(), numberFormat);
    const running: GameState = {
      ...state,
      expedition: {
        ...state.expedition,
        status: "decision",
        runInventory: {
          ...createEmptyRunInventory(),
          ore: { dust: 4_500_000, seam: 250_000, core: 12_000 },
          components: 8_400,
          relics: 2_100,
        },
      },
    };

    return selectExpeditionView(deriveContext(running)).runInventory;
  }

  it("truncates each carried quantity", () => {
    // Note 30. These were the last raw integers on screen, which pushed the
    // chip wider than its column on a deep run.
    const inventory = carrying("compact");

    expect(inventory.items.length).toBeGreaterThan(0);
    // `formatCompact` narrows the fraction as the scaled value grows, so these
    // are three different digit counts rather than a typo.
    expect(inventory.items.map((item) => item.displayAmount)).toEqual([
      "4.50M",
      "250K",
      "12.0K",
      "8.40K",
      "2.10K",
    ]);
  });

  it("truncates what the haul would bank for", () => {
    expect(carrying("compact").chipsIfBankedText).toBe(
      formatQuantity(carrying("compact").chipsIfBanked, "compact"),
    );
    expect(carrying("compact").chipsIfBankedText).toMatch(/[KMB]$/);
  });

  it("spells everything out in exact mode", () => {
    const inventory = carrying("exact");

    expect(inventory.items.map((item) => item.displayAmount)).toEqual([
      "4,500,000",
      "250,000",
      "12,000",
      "8,400",
      "2,100",
    ]);
    expect(inventory.chipsIfBankedText).toContain(",");
  });

  it("keeps the raw amount for the screen-reader line", () => {
    // The panel announces the exact figure while showing the short one, which is
    // the same split the resource bar uses.
    for (const item of carrying("compact").items) {
      expect(Number.isInteger(item.amount)).toBe(true);
    }
  });
});
