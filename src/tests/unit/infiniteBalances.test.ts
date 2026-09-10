/**
 * Coverage for balances that roll over to INF.
 *
 * Three things are worth pinning, and only the first is obvious.
 *
 * The first is the rollover itself: a balance that reaches the ceiling stops
 * counting and says `INF`, rather than the grant being refused — which would
 * make a saturated save look broken, with machines still turning and nothing
 * ever arriving.
 *
 * The second is that `Infinity` **does not survive JSON**. `JSON.stringify`
 * writes `null`, and `null` is indistinguishable from a missing field, so
 * without a sentinel a finished save would export and re-import as zero. That is
 * a silent, total loss of progress and it would not show up in any test that
 * only exercised the live state.
 *
 * The third is that the ceiling is far enough away to be an achievement. A
 * number that is merely large is not the same as a number that is out of reach.
 */

import { describe, expect, it } from "vitest";
import { ECONOMY } from "../../content/catalog";
import { INFINITE, INFINITE_LABEL, formatCompact, formatExact, formatQuantity } from "../../domain/numbers";
import { reduce } from "../../domain/reducer";
import { createGameState, type GameState } from "../../domain/state";
import { applyTransaction } from "../../domain/transactions";
import { selectResourceViews } from "../../domain/selectors";
import { exportSave, parseImport } from "../../persistence/exportImport";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;

function fresh(): GameState {
  return createGameState({ nowUnixMs: NOW, seed: 11 });
}

function withCash(value: number): GameState {
  const base = fresh();

  return { ...base, resources: { ...base.resources, cash: value } };
}

describe("rolling over", () => {
  it("turns a balance that reaches the ceiling into INF", () => {
    const outcome = applyTransaction(withCash(ECONOMY.safeMaximum / 2), {
      label: "big",
      costs: [],
      grants: [{ resource: "cash", amount: ECONOMY.safeMaximum / 2 }],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.state.resources.cash).toBe(INFINITE);
  });

  it("never leaves a balance pinned at the ceiling absorbing payouts", () => {
    /*
     * The reason the test is "reaches" rather than "exceeds". At a googol the gap
     * between representable doubles is about 1e84, so `1e100 + 1` is exactly
     * `1e100` — a strict comparison would let a balance sit at the ceiling
     * swallowing every payout forever, which is the old broken-looking behaviour
     * wearing a different hat.
     */
    expect(ECONOMY.safeMaximum + 1).toBe(ECONOMY.safeMaximum);

    const outcome = applyTransaction(withCash(ECONOMY.safeMaximum), {
      label: "trickle",
      costs: [],
      grants: [{ resource: "cash", amount: 1 }],
    });

    expect(outcome.ok && outcome.state.resources.cash).toBe(INFINITE);
  });

  it("stays infinite through spending", () => {
    const spent = applyTransaction(withCash(INFINITE), {
      label: "spend",
      costs: [{ resource: "cash", amount: 10_000 }],
      grants: [],
    });

    expect(spent.ok).toBe(true);
    expect(spent.ok && spent.state.resources.cash).toBe(INFINITE);
  });
});

describe("writing it down", () => {
  it("shows INF wherever a number would go", () => {
    expect(formatCompact(INFINITE)).toBe(INFINITE_LABEL);
    expect(formatExact(INFINITE)).toBe(INFINITE_LABEL);
    expect(formatQuantity(INFINITE, "compact")).toBe(INFINITE_LABEL);
    expect(formatQuantity(INFINITE, "exact")).toBe(INFINITE_LABEL);
  });

  it("reaches for exponential rather than a longer suffix table", () => {
    // The suffixes stop at 1e24. Naming every step to a googol would be thirty
    // more two-letter abbreviations nobody can tell apart.
    expect(formatCompact(1e24)).toBe("1.00Sp");
    expect(formatCompact(1e30)).toBe("1.00e+30");
  });

  it("stops claiming exactness above what a double can represent", () => {
    // Every digit past 2^53 is an artefact of the binary representation rather
    // than something the player earned, so a full digit string would be a
    // precise-looking lie.
    expect(formatExact(1_234_567)).toBe("1,234,567");
    expect(formatExact(1e30)).toBe("1.000e+30");
  });

  it("reads INF in the resource bar", () => {
    const view = selectResourceViews(withCash(INFINITE)).find(
      (resource) => resource.id === "cash",
    );

    expect(view?.displayText).toBe(INFINITE_LABEL);
    // And in the tooltip and screen-reader line, which take the exact value.
    expect(view?.exactText).toBe(INFINITE_LABEL);
  });
});

describe("surviving the save", () => {
  it("keeps INF through a normalisation", () => {
    // The IndexedDB path: the store clones structurally, so the live `Infinity`
    // arrives intact and the loader has to accept it rather than repair it.
    const reloaded = normalizeGameState(withCash(INFINITE), NOW);

    expect(reloaded.state.resources.cash).toBe(INFINITE);
    expect(reloaded.report.repairs).toEqual([]);
  });

  it("keeps INF through an export and re-import", () => {
    /*
     * The case that would otherwise fail silently and completely.
     * `JSON.stringify(Infinity)` is `null`, so without the sentinel this
     * round-trip returns a save with zero cash and no error anywhere.
     */
    const text = exportSave(createEnvelope(withCash(INFINITE), 1, NOW));

    expect(text).toContain("__Infinity__");
    expect(text).not.toContain('"cash": null');

    const imported = parseImport(text, NOW);

    expect(imported.ok).toBe(true);
    expect(imported.ok && imported.envelope.game.resources.cash).toBe(INFINITE);
  });

  it("rolls a hand-edited over-ceiling save over rather than clamping it", () => {
    // A save claiming a googol gets what it asked for. The ceiling is where
    // counting stops, not a number a balance may sit on.
    const edited = normalizeGameState(
      { ...withCash(0), resources: { ...fresh().resources, cash: ECONOMY.safeMaximum * 10 } },
      NOW,
    );

    expect(edited.state.resources.cash).toBe(INFINITE);
  });
});

describe("living with an infinite balance", () => {
  /** A save whose machines are all running, so ticking actually produces cash. */
  function running(cash: number): GameState {
    const base = withCash(cash);

    return {
      ...base,
      casino: {
        ...base.casino,
        machines: Object.fromEntries(
          Object.entries(base.casino.machines).map(([id, machine]) => [
            id,
            { ...machine, unlocked: true, level: 20 },
          ]),
        ) as GameState["casino"]["machines"],
      },
    };
  }

  const tick = (state: GameState) =>
    reduce(state, {
      type: "TICK",
      casinoElapsedMs: 60_000,
      expeditionElapsedMs: 0,
      nowUnixMs: NOW + 60_000,
    });

  it("keeps ticking without complaining, once cash reads INF", () => {
    /*
     * The regression this guards. `clamped` was "the grant did not fit", which is
     * true on *every* tick once cash is infinite — so the panel would have shown
     * a notice per frame for the rest of the save. It is now the single
     * transition, and an infinite balance is not clamped at all.
     */
    const first = tick(running(INFINITE));
    const second = tick(first.state);

    for (const result of [first, second]) {
      expect(result.state.resources.cash).toBe(INFINITE);
      expect(
        result.effects.filter(
          (effect) => effect.type === "SHOW_FEEDBACK" && effect.message.includes("INF"),
        ),
      ).toEqual([]);
    }
  });

  it("still pays out everything else while cash is done counting", () => {
    // Cash being finished must not stop the rest of the game working.
    const ticked = tick(running(INFINITE));

    expect(ticked.state.statistics.playTimeMs).toBeGreaterThan(0);
    expect(Number.isNaN(ticked.state.resources.chips)).toBe(false);
  });

  it("affords any purchase, and stays infinite after paying", () => {
    const bought = applyTransaction(running(INFINITE), {
      label: "expensive",
      costs: [{ resource: "cash", amount: ECONOMY.safeMaximum }],
      grants: [],
    });

    expect(bought.ok).toBe(true);
    expect(bought.ok && bought.state.resources.cash).toBe(INFINITE);
  });
});

describe("how far away the ceiling is", () => {
  it("is far enough that reaching it is real dedication", () => {
    /*
     * The pace-setter is the prestige wall: the cash threshold starts at 250,000
     * and grows 1.5x per prestige, so lifetime cash of X is roughly
     * log(X / threshold) / log(growth) prestiges away.
     *
     * The old ceiling was `MAX_SAFE_INTEGER`, which this puts at about 60
     * prestiges — a weekend, not an achievement. The assertion is on the shape of
     * the answer rather than an exact figure, so retuning the wall does not fail
     * it for no reason.
     */
    const prestigesTo = (target: number): number =>
      Math.log(target / ECONOMY.prestigeThresholdCash) / Math.log(ECONOMY.prestigeThresholdGrowth);

    expect(prestigesTo(Number.MAX_SAFE_INTEGER)).toBeLessThan(100);
    expect(prestigesTo(ECONOMY.safeMaximum)).toBeGreaterThan(400);
  });

  it("stays well clear of a true floating-point infinity", () => {
    // Intermediate arithmetic must never reach `Infinity` on its own before the
    // ceiling has had its say, or the rollover would stop being a decision.
    expect(ECONOMY.safeMaximum).toBeLessThan(Number.MAX_VALUE / 1e100);
  });
});
