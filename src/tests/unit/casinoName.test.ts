/**
 * Naming the casino.
 *
 * The interesting part is not the string; it is that `null` and `""` are
 * different answers. `null` means the player has never been asked, which is the
 * one condition the prompt fires on — and it is a state they cannot return to,
 * because leaving the field blank gets a generated name rather than nothing.
 */

import { describe, expect, it } from "vitest";
import {
  CASINO_NAME_NOUNS,
  CASINO_NAME_QUALIFIERS,
  suggestCasinoName,
} from "../../content/casinoNames";
import { applyPrestige } from "../../domain/prestige";
import { reduce } from "../../domain/reducer";
import {
  MAXIMUM_CASINO_NAME,
  createGameState,
  normalizeCasinoName,
  type GameState,
} from "../../domain/state";
import { ECONOMY } from "../../content/catalog";
import { SAVE_VERSION, createEnvelope, normalizeGameState } from "../../persistence/saveSchema";
import { runMigrations } from "../../persistence/migrations";

const NOW = 1_700_000_000_000;

function fresh(): GameState {
  return createGameState({ nowUnixMs: NOW, seed: 9 });
}

describe("what a name may be", () => {
  it("has none on a fresh save, and that is not the same as an empty one", () => {
    expect(fresh().settings.casinoName).toBeNull();
  });

  it("trims, collapses and caps", () => {
    expect(normalizeCasinoName("  The   Bottom  Line  ")).toBe("The Bottom Line");
    expect(normalizeCasinoName("x".repeat(80))).toHaveLength(MAXIMUM_CASINO_NAME);
  });

  it("refuses anything that is not a name", () => {
    // All of these are "never asked" rather than "named nothing", which is what
    // stops a hand-edited save from producing a blank heading.
    for (const value of ["", "   ", "\n\t ", 12, null, undefined, {}]) {
      expect(normalizeCasinoName(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("strips control characters rather than storing them", () => {
    // A newline in a panel heading is not a name.
    expect(normalizeCasinoName("The\nBottom\u0000Line")).toBe("The Bottom Line");
  });
});

describe("setting the name", () => {
  it("accepts one and says so", () => {
    const named = reduce(fresh(), { type: "SET_CASINO_NAME", name: "The Bottom Line" });

    expect(named.state.settings.casinoName).toBe("The Bottom Line");
    expect(
      named.effects.some(
        (effect) => effect.type === "SHOW_FEEDBACK" && effect.message.includes("The Bottom Line"),
      ),
    ).toBe(true);
  });

  it("normalises on the way in, from the same rule a loaded save gets", () => {
    const named = reduce(fresh(), { type: "SET_CASINO_NAME", name: "  Spacious   Holdings " });

    expect(named.state.settings.casinoName).toBe("Spacious Holdings");
  });

  it("refuses a blank one rather than storing an empty string", () => {
    const result = reduce(fresh(), { type: "SET_CASINO_NAME", name: "   " });

    expect(result.state.settings.casinoName).toBeNull();
    expect(result.effects.some((effect) => effect.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("is a no-op when the name has not changed", () => {
    const named = reduce(fresh(), { type: "SET_CASINO_NAME", name: "Holdings" }).state;
    const again = reduce(named, { type: "SET_CASINO_NAME", name: "Holdings" });

    expect(again.materialChange).toBe(false);
    expect(again.effects).toEqual([]);
  });

  it("survives a prestige, like every other setting", () => {
    // The name is in `settings` for this reason: a cycle reset must not take it,
    // and `applyPrestige` carries settings through untouched.
    const named = reduce(fresh(), { type: "SET_CASINO_NAME", name: "Holdings" }).state;
    const ready: GameState = {
      ...named,
      prestige: { ...named.prestige, cycleCashEarned: ECONOMY.prestigeThresholdCash * 10 },
    };
    const outcome = applyPrestige(ready);

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.settings.casinoName).toBe("Holdings");
    }
  });
});

describe("the name across a save", () => {
  it("round-trips", () => {
    const named = reduce(fresh(), { type: "SET_CASINO_NAME", name: "Holdings" }).state;
    const loaded = normalizeGameState(createEnvelope(named, 1, NOW).game, NOW).state;

    expect(loaded.settings.casinoName).toBe("Holdings");
  });

  it("repairs a hand-edited one rather than trusting it", () => {
    const named = reduce(fresh(), { type: "SET_CASINO_NAME", name: "Holdings" }).state;
    const raw = JSON.parse(JSON.stringify(createEnvelope(named, 1, NOW).game)) as {
      settings: Record<string, unknown>;
    };

    raw.settings.casinoName = `   ${"y".repeat(200)}   `;

    const loaded = normalizeGameState(raw, NOW).state;

    expect(loaded.settings.casinoName).toHaveLength(MAXIMUM_CASINO_NAME);
  });

  it("reads an older save as never having been asked", () => {
    // Which is the right answer: an existing save has not been asked, so it
    // should be asked once, the same as a new one.
    const envelope = createEnvelope(fresh(), 1, NOW) as unknown as Record<string, unknown>;
    const older = { ...envelope, saveVersion: 14 };
    const migrated = runMigrations(older);

    // `SAVE_VERSION` rather than a literal: the point is that the chain runs to
    // the head, and pinning the head means every future migration fails this
    // test for a reason that has nothing to do with casino names.
    expect(migrated.envelope.saveVersion).toBe(SAVE_VERSION);
    expect(
      (migrated.envelope.game as { settings: { casinoName: unknown } }).settings.casinoName,
    ).toBeNull();
  });
});

describe("the Company's own suggestions", () => {
  it("fits the cap, every combination of it", () => {
    for (const qualifier of CASINO_NAME_QUALIFIERS) {
      for (const noun of CASINO_NAME_NOUNS) {
        const name = `${qualifier} ${noun}`;

        expect(name.length, name).toBeLessThanOrEqual(MAXIMUM_CASINO_NAME);
        // And survives normalisation unchanged, so what is suggested is what is
        // stored.
        expect(normalizeCasinoName(name)).toBe(name);
      }
    }
  });

  it("draws with the randomness it is handed, and never off the end", () => {
    // `pick` is a parameter so this can be walked deterministically — and so the
    // suggestion never reaches for a game RNG stream to decide something that
    // has no effect on anything.
    expect(suggestCasinoName(() => 0)).toBe(`${CASINO_NAME_QUALIFIERS[0]} ${CASINO_NAME_NOUNS[0]}`);
    expect(normalizeCasinoName(suggestCasinoName(() => 0.999999))).not.toBeNull();
  });
});
