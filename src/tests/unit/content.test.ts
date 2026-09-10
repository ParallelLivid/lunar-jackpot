import { describe, expect, it } from "vitest";
import { CATALOG, ECONOMY, MACHINES, SLOT_SYMBOL_IDS } from "../../content/catalog";
import type { ContentCatalog } from "../../content/catalog";
import {
  HELP_TOPICS,
  HELP_TOPIC_IDS,
  MAXIMUM_ENTRY_BODY,
  MAXIMUM_TOPIC_BODY,
  helpSpriteIds,
  helpSpritesExist,
  topicBodyLength,
  type HelpTopic,
  type HelpTopicId,
} from "../../content/help";
import { WINDOW_HELP_TOPICS } from "../../ui/help/HelpWindow";
import { RAIL_ENTRIES } from "../../ui/layout/WindowRail";
import {
  COMPANY_BYLINES,
  MAXIMUM_STEP_WORDS,
  TUTORIAL_ACTS,
  isTutorialGateId,
  stepWordCount,
  type TutorialAnchorId,
} from "../../content/tutorial";
import { evaluateMachineLevel } from "../../content/machines";
import { validateContent } from "../../content/validateContent";
import { SPRITES, SPRITE_GRID, hasSprite, spriteRows } from "../../rendering/sprites";
import { CAT_SKINS } from "../../content/catSkins";
import { MINER_SKINS } from "../../content/minerSkins";
import {
  baseSlotWeights,
  cappedSlotWeights,
  expectedReturn,
  luckAdjustedSlotWeights,
  payoutMultiplier,
} from "../../domain/gambling";

describe("content catalog", () => {
  it("passes validation", () => {
    const result = validateContent(CATALOG);

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("evaluates a machine level curve at any level, with no ceiling", () => {
    for (const machine of Object.values(MACHINES)) {
      const first = evaluateMachineLevel(machine, 1);

      // Level 1 comes with the machine and is the unmodified base payout.
      expect(first?.cashCost).toBe(0);
      expect(first?.componentCost).toBe(0);
      expect(first?.payoutMultiplier).toBe(1);

      // Nothing below level 1 exists.
      expect(evaluateMachineLevel(machine, 0)).toBeNull();
      expect(evaluateMachineLevel(machine, -3)).toBeNull();
      expect(evaluateMachineLevel(machine, 2.5)).toBeNull();

      // Far past anything reachable, values stay finite and ordered rather than
      // going NaN or wrapping negative.
      for (const level of [10, 50, 200, 500]) {
        const definition = evaluateMachineLevel(machine, level);
        const previous = evaluateMachineLevel(machine, level - 1);

        expect(definition, `${machine.id} level ${level}`).not.toBeNull();
        expect(Number.isFinite(definition?.payoutMultiplier ?? Number.NaN)).toBe(true);
        expect(Number.isFinite(definition?.cashCost ?? Number.NaN)).toBe(true);
        expect(definition?.payoutMultiplier ?? 0).toBeGreaterThanOrEqual(
          previous?.payoutMultiplier ?? 0,
        );
        expect(definition?.cashCost ?? 0).toBeGreaterThanOrEqual(previous?.cashCost ?? 0);
      }
    }
  });

  it("charges components on every fifth level and nowhere else", () => {
    for (const machine of Object.values(MACHINES)) {
      for (let level = 1; level <= 40; level += 1) {
        const definition = evaluateMachineLevel(machine, level);
        const shouldCharge = level % machine.curve.componentEveryNLevels === 0;

        expect(
          (definition?.componentCost ?? 0) > 0,
          `${machine.id} level ${level}`,
        ).toBe(shouldCharge);
      }
    }
  });

  it("keeps cost growing faster than payout, so levels never stop mattering", () => {
    for (const machine of Object.values(MACHINES)) {
      expect(machine.curve.cashGrowth).toBeGreaterThan(machine.curve.payoutGrowth);
      expect(machine.curve.payoutGrowth).toBeGreaterThan(1);

      // The payback period must lengthen with depth, which is the only thing
      // giving an uncapped ladder a shape.
      const payback = (level: number): number => {
        const definition = evaluateMachineLevel(machine, level);

        return (definition?.cashCost ?? 0) / (definition?.payoutMultiplier ?? 1);
      };

      expect(payback(20)).toBeGreaterThan(payback(10));
      expect(payback(40)).toBeGreaterThan(payback(20));
    }
  });

  it("gives every automatically resolved encounter something to resolve against", () => {
    /*
     * An automatic encounter finishes on one of two clocks: a durability bar
     * chipped down by the pickaxe, or a plain duration. An encounter declaring
     * neither has nothing to end it and the run sits in `resolving` forever.
     *
     * A duration is not optional for anything lacking a reward table — the cat
     * is the one such encounter, meeting it being the whole reward — so this
     * keeps the next table-less encounter from arriving without one.
     */
    for (const encounter of Object.values(CATALOG.encounters)) {
      if (encounter.resolutionMode !== "automatic") {
        continue;
      }

      const hasClock =
        (encounter.durability ?? 0) > 0 || (encounter.resolveDurationMs ?? 0) > 0;

      expect(hasClock, encounter.id).toBe(true);
    }
  });
});

describe("slot economy", () => {
  it("starts below a 100% expected return", () => {
    const base = expectedReturn(baseSlotWeights());

    expect(base).toBeGreaterThan(0.5);
    expect(base).toBeLessThan(1);
  });

  it("improves the expected return as luck rises, before the cap", () => {
    const none = expectedReturn(luckAdjustedSlotWeights([], 0));
    const some = expectedReturn(luckAdjustedSlotWeights([], 20));
    const more = expectedReturn(luckAdjustedSlotWeights([], 54));

    expect(some).toBeGreaterThan(none);
    expect(more).toBeGreaterThan(some);
  });

  it("never lets the capped return exceed the configured maximum", () => {
    for (const luck of [0, 10, 25, 54, 100]) {
      const capped = expectedReturn(cappedSlotWeights([], luck));

      expect(capped).toBeLessThanOrEqual(ECONOMY.gamblingMaxExpectedReturn + 1e-9);
    }
  });

  it("pays the published multipliers and nothing else", () => {
    const [first, second] = SLOT_SYMBOL_IDS;

    expect(payoutMultiplier([first, first, first])).toBe(
      CATALOG.slotSymbols[first].tripleMultiplier,
    );
    expect(payoutMultiplier([first, first, second])).toBe(
      CATALOG.slotSymbols[first].pairMultiplier,
    );
    expect(payoutMultiplier([first, second, SLOT_SYMBOL_IDS[2]])).toBe(0);
  });
});

describe("art coverage", () => {
  it("resolves every sprite the content refers to", () => {
    const referenced = [
      ...Object.values(CATALOG.resourceMetadata).map((entry) => entry.spriteId),
      ...Object.values(CATALOG.oreGrades).map((entry) => entry.spriteId),
      ...Object.values(CATALOG.machines).map((entry) => entry.spriteId),
      ...Object.values(CATALOG.encounters).map((entry) => entry.spriteId),
      ...Object.values(CATALOG.gear).map((entry) => entry.spriteId),
      ...Object.values(CATALOG.trinkets).map((entry) => entry.spriteId),
      ...Object.values(CATALOG.totems).map((entry) => entry.spriteId),
      ...Object.values(CAT_SKINS).flatMap((skin) => [skin.restSpriteId, skin.flickSpriteId]),
      ...Object.values(MINER_SKINS).flatMap((skin) => [skin.spriteId, skin.strideSpriteId]),
      "sprite.player",
      "sprite.prestige",
    ];

    const missing = referenced.filter((spriteId) => !hasSprite(spriteId));

    expect(missing).toEqual([]);
  });

  it("draws every sprite on the same square grid", () => {
    for (const spriteId of Object.keys(SPRITES)) {
      const rows = spriteRows(spriteId);

      expect(rows).toHaveLength(SPRITE_GRID);

      for (const row of rows) {
        expect(row).toHaveLength(SPRITE_GRID);
      }
    }
  });

  it("draws every sprite as one connected figure", () => {
    /*
     * A sprite has to be one connected figure. A brim drawn a row clear of the
     * head leaves it as a second island with no path to the body — a floating
     * head at the 24 pixels this is drawn at — and the grid check above cannot
     * see it, because a disconnected sprite is still twelve rows of twelve.
     *
     * Eight-connected rather than four: a stride frame steps a boot out
     * diagonally, and that is a leg rather than a fault. The exceptions are
     * named rather than the rule weakened, since both are drawings that really
     * are several pieces.
     */
    const SCATTERED = new Set([
      // Loose grains. A connected pile of dust is a rock.
      "sprite.ore.dust",
      // Reel blocks with the cabinet between them, which is the machine.
      "sprite.machine.iota",
    ]);

    for (const spriteId of Object.keys(SPRITES)) {
      if (SCATTERED.has(spriteId)) {
        continue;
      }

      const rows = spriteRows(spriteId);
      const lit = new Set<number>();

      for (let row = 0; row < SPRITE_GRID; row += 1) {
        for (let column = 0; column < SPRITE_GRID; column += 1) {
          if (rows[row][column] !== ".") {
            lit.add(row * SPRITE_GRID + column);
          }
        }
      }

      const [start] = lit;

      expect(start, `${spriteId} is empty`).toBeDefined();

      const seen = new Set([start]);
      const queue = [start as number];

      while (queue.length > 0) {
        const cell = queue.pop() as number;
        const row = Math.floor(cell / SPRITE_GRID);
        const column = cell % SPRITE_GRID;

        for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
          for (let columnStep = -1; columnStep <= 1; columnStep += 1) {
            const next = (row + rowStep) * SPRITE_GRID + (column + columnStep);

            if (
              row + rowStep >= 0 &&
              row + rowStep < SPRITE_GRID &&
              column + columnStep >= 0 &&
              column + columnStep < SPRITE_GRID &&
              lit.has(next) &&
              !seen.has(next)
            ) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
      }

      expect(seen.size, `${spriteId} has cells floating clear of the figure`).toBe(lit.size);
    }
  });

  /*
   * A cat skin drawn to its own template rather than the base cat's comes out
   * misaligned in ways the grid check above cannot see, since a malformed sprite
   * is still twelve rows of twelve characters.
   *
   * These pin the shape a cat has to keep. Neither can say whether a sprite
   * looks like a crown; only a person can.
   */
  describe("the cat skins", () => {
    /** The head, identical in every skin that does not replace it outright. */
    const EAR_ROW = ".##.....##..";

    /**
     * The one skin without it: the mining helmet is drawn *into* the head rather
     * than sat on top of it, so it owns those rows and has no ears to draw.
     */
    const INTEGRATED = ["sprite.cat.helmet.rest", "sprite.cat.helmet.flick"];

    const catSprites = Object.keys(SPRITES).filter((id) => id.startsWith("sprite.cat."));

    it("gives every cat the same head", () => {
      expect(catSprites.length).toBeGreaterThan(4);

      for (const spriteId of catSprites) {
        if (INTEGRATED.includes(spriteId)) {
          continue;
        }

        expect(spriteRows(spriteId), spriteId).toContain(EAR_ROW);
      }
    });

    it("holds a worn accessory still between a cat's two frames", () => {
      // The hat does not animate; the cat under it does. Rest and flick differ
      // in the tail — drawn in `rest`, gone in `flick`, which is the flick —
      // and in nothing above the ears.
      for (const skin of ["halo", "tophat", "crown"] as const) {
        const rest = spriteRows(`sprite.cat.${skin}.rest`);
        const flick = spriteRows(`sprite.cat.${skin}.flick`);
        const accessoryRows = rest.indexOf(EAR_ROW);

        expect(accessoryRows, skin).toBeGreaterThan(0);
        expect(rest.slice(0, accessoryRows), skin).toEqual(flick.slice(0, accessoryRows));
      }
    });
  });
});

/**
 * The help reference. The length budget is the rule worth testing hardest: the
 * window must never scroll, and a topic that outgrows its frame is a content bug
 * an end-to-end overflow test would only catch on whichever topic somebody
 * happened to click.
 */
describe("the help reference", () => {
  /** A catalogue with one topic replaced, for the failure cases. */
  function withTopic(topic: HelpTopic): ContentCatalog {
    return {
      ...CATALOG,
      helpTopics: { ...HELP_TOPICS, [topic.id]: topic },
    } as unknown as ContentCatalog;
  }

  it("passes validation as authored", () => {
    const result = validateContent();

    expect(result.issues.filter((issue) => issue.includes("Help topic"))).toEqual([]);
  });

  it("keeps every topic inside its length budget", () => {
    for (const topicId of HELP_TOPIC_IDS) {
      const topic = HELP_TOPICS[topicId];

      expect(topicBodyLength(topic), topicId).toBeLessThanOrEqual(MAXIMUM_TOPIC_BODY);

      for (const entry of topic.entries) {
        expect(entry.body.length, `${topicId} / ${entry.term}`).toBeLessThanOrEqual(
          MAXIMUM_ENTRY_BODY,
        );
      }
    }
  });

  it("names only sprites that exist", () => {
    for (const spriteId of helpSpriteIds()) {
      expect(SPRITES[spriteId], spriteId).toBeDefined();
    }

    expect(helpSpritesExist()).toBe(true);
  });

  it("gives every topic a title, a summary and at least one entry", () => {
    for (const topicId of HELP_TOPIC_IDS) {
      const topic = HELP_TOPICS[topicId];

      expect(topic.id, topicId).toBe(topicId);
      expect(topic.title.length, topicId).toBeGreaterThan(0);
      expect(topic.summary.length, topicId).toBeGreaterThan(0);
      expect(topic.entries.length, topicId).toBeGreaterThan(0);
    }
  });

  it("uses each term at most once within a topic", () => {
    for (const topicId of HELP_TOPIC_IDS) {
      const terms = HELP_TOPICS[topicId].entries.map((entry) => entry.term);

      expect(new Set(terms).size, topicId).toBe(terms.length);
    }
  });

  it("documents every rail window", () => {
    // `WINDOW_HELP_TOPICS` is exhaustive over `WindowId`, so an undocumented
    // window fails to typecheck. This asserts the other half: that each mapped
    // id names a topic that is really there.
    for (const [windowId, topicId] of Object.entries(WINDOW_HELP_TOPICS)) {
      expect(HELP_TOPICS[topicId], windowId).toBeDefined();
    }
  });

  it("covers every system the final-features note names", () => {
    // The acceptance criterion, as a checklist rather than prose in a document.
    const required: HelpTopicId[] = [
      "help.floor",
      "help.machines",
      "help.expeditions",
      "help.gear",
      "help.trinkets",
      "help.totems",
      "help.caches",
      "help.gambling",
      "help.supplies",
      "help.conditions",
      "help.prestige",
    ];

    for (const topicId of required) {
      expect(HELP_TOPICS[topicId], topicId).toBeDefined();
    }
  });

  it("has reclaimed every deferred paragraph", () => {
    /*
     * Paragraphs moved out of the panels left marker comments naming what went,
     * so the help window could reclaim them. A marker still in the tree is a
     * paragraph that was lost rather than moved.
     *
     * Read through Vite's own glob rather than `node:fs`: no other test in this
     * suite reaches the filesystem, and the app's tsconfig carries no Node types.
     */
    const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    // Split so this file's own mention of it is not a hit.
    const marker = "TODO(help-" + "tab)";
    const stragglers = Object.entries(sources)
      .filter(([, text]) => text.includes(marker))
      .map(([file]) => file);

    expect(stragglers).toEqual([]);
    // The glob resolved to something, so an empty result means what it says.
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it("rejects an entry over the budget", () => {
    const result = validateContent(
      withTopic({
        ...HELP_TOPICS["help.cats"],
        entries: [{ term: "Too long", body: "x".repeat(MAXIMUM_ENTRY_BODY + 1) }],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes("over the"))).toBe(true);
  });

  it("rejects a topic over the budget", () => {
    const filler = { term: "Filler", body: "x".repeat(MAXIMUM_ENTRY_BODY) };
    const result = validateContent(
      withTopic({
        ...HELP_TOPICS["help.cats"],
        entries: Array.from({ length: 8 }, (_, index) => ({
          ...filler,
          term: `Filler ${String(index)}`,
        })),
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes("Split it"))).toBe(true);
  });

  it("rejects a topic with no entries, no summary, or a missing sprite", () => {
    const empty = validateContent(
      withTopic({ ...HELP_TOPICS["help.cats"], entries: [], summary: "" }),
    );

    expect(empty.valid).toBe(false);
    expect(empty.issues.some((issue) => issue.includes("has no entries"))).toBe(true);
    expect(empty.issues.some((issue) => issue.includes("has no summary"))).toBe(true);

    const missingSprite = validateContent(
      withTopic({ ...HELP_TOPICS["help.cats"], spriteId: "sprite.does.not.exist" }),
    );

    expect(missingSprite.valid).toBe(false);
    expect(
      missingSprite.issues.some((issue) => issue.includes("names a sprite that does not exist")),
    ).toBe(true);
  });

  it("rejects a repeated term", () => {
    const result = validateContent(
      withTopic({
        ...HELP_TOPICS["help.cats"],
        entries: [
          { term: "Same", body: "One." },
          { term: "Same", body: "Two." },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes("twice"))).toBe(true);
  });
});

/**
 * The tutorial script, separate from `tutorial.test.ts`, which is about the
 * engine. These are about the prose: that it covers what it set out to, that
 * every id it names resolves, and that the two rulings behind its shape cannot
 * be reversed by an edit that looks harmless.
 */
describe("the tutorial script", () => {
  it("passes validation as authored", () => {
    const result = validateContent();

    expect(result.issues.filter((issue) => issue.includes("Tutorial"))).toEqual([]);
  });

  it("covers every system the note asked for", () => {
    // The systems the tutorial has to walk through, as a checklist rather than
    // prose in a document.
    const covered = TUTORIAL_ACTS.flatMap((act) =>
      act.steps.map((step) => `${act.title} ${step.title} ${step.body}`.toLowerCase()),
    ).join(" ");

    const required = [
      "casino",
      "expedition",
      "pickaxe",
      "oxygen",
      "trinket",
      "totem",
      "cache",
      "chip",
      "supplies",
      "condition",
      "contract",
      "prestige",
      "relic",
      "research",
      "spec",
    ];

    for (const topic of required) {
      expect(covered, `nothing in the script mentions ${topic}`).toContain(topic);
    }
  });

  it("opens each act at the first moment its system is real", () => {
    // A trigger that fires before the player can act on what the act explains is
    // the lecture this shape exists to avoid.
    const triggers = Object.fromEntries(TUTORIAL_ACTS.map((act) => [act.id, act.trigger]));

    expect(triggers["act.arrival"]).toBe("start");
    expect(triggers["act.machine"]).toBe("gate.machine-purchased");
    expect(triggers["act.descent"]).toBe("gate.expedition-launched");
    expect(triggers["act.payday"]).toBe("gate.run-banked");
    expect(triggers["act.store"]).toBe("gate.cache-held");
    expect(triggers["act.trinkets"]).toBe("gate.trinket-owned");
    expect(triggers["act.totems"]).toBe("gate.totem-owned");
    expect(triggers["act.gear"]).toBe("gate.relics-held");
    expect(triggers["act.conditions"]).toBe("gate.modifier-seen");
    expect(triggers["act.prestige"]).toBe("gate.prestige-available");
  });

  it("keeps every card inside the word budget", () => {
    for (const act of TUTORIAL_ACTS) {
      for (const step of act.steps) {
        const words = stepWordCount(step);

        expect(words, `${step.id} is ${String(words)} words`).toBeLessThanOrEqual(
          MAXIMUM_STEP_WORDS,
        );
        expect(words, step.id).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every act to three cards at most", () => {
    for (const act of TUTORIAL_ACTS) {
      expect(act.steps.length, act.id).toBeLessThanOrEqual(3);
      expect(act.steps.length, act.id).toBeGreaterThan(0);
    }
  });

  it("lets only the descent present during a run", () => {
    // Only the descent act may present during a run. The validator enforces this
    // too; asserted here as well because it is a ruling rather than a code
    // invariant, and quietly reversing it is cheap.
    const during = TUTORIAL_ACTS.filter((act) => act.presentsDuringRun).map((act) => act.id);

    expect(during).toEqual(["act.descent"]);
  });

  it("names only anchors that something actually renders", () => {
    // Read out of the source rather than asserted against a list, so a renamed
    // or removed panel breaks this test instead of silently outlining nothing.
    const sources = import.meta.glob("/src/ui/**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const text = Object.values(sources).join("\n");
    const used = new Set(
      TUTORIAL_ACTS.flatMap((act) => act.steps.map((step) => step.anchor)).filter(
        (anchor): anchor is TutorialAnchorId => anchor !== null,
      ),
    );

    expect(used.size).toBeGreaterThan(0);

    for (const anchor of used) {
      // The rail's anchors are templated from the window id, so there is no
      // literal to grep for. What matters is that the suffix names a rail entry
      // the player can see, which is the same failure in a different shape.
      if (anchor.startsWith("rail.")) {
        const windowId = anchor.slice("rail.".length);

        expect(
          RAIL_ENTRIES.some((entry) => entry.id === windowId),
          `${anchor} names no rail entry`,
        ).toBe(true);
        expect(text.includes("data-tutorial-anchor={`rail.${entry.id}`}")).toBe(true);
        continue;
      }

      expect(
        text.includes(`anchorId="${anchor}"`) || text.includes(`data-tutorial-anchor="${anchor}"`),
        `nothing renders the ${anchor} anchor`,
      ).toBe(true);
    }
  });

  it("waits only on gates the game can actually reach", () => {
    // An act triggered by a gate nothing latches is an act nobody sees, and
    // looks exactly like a tutorial that stopped working. Every gate must be one
    // the resolver knows, or one of the two the dashboard answers.
    for (const act of TUTORIAL_ACTS) {
      if (act.trigger !== "start") {
        expect(isTutorialGateId(act.trigger), act.id).toBe(true);
      }

      for (const step of act.steps) {
        if (step.advance !== "next") {
          expect(isTutorialGateId(step.advance), step.id).toBe(true);
          // A step that waits on the player must say what to do.
          expect(step.hint ?? "", step.id).not.toBe("");
        }
      }
    }
  });

  it("gives every gated step a hint and no Next", () => {
    const gated = TUTORIAL_ACTS.flatMap((act) => act.steps).filter(
      (step) => step.advance !== "next",
    );

    // Three of them: buy a level, open the games, open the store.
    expect(gated.length).toBeGreaterThanOrEqual(3);

    for (const step of gated) {
      expect(step.hint, step.id).toBeDefined();
    }
  });

  it("speaks in the Company's voice without shouting", () => {
    // The register, as far as a test can hold it: the Company is cheerful,
    // procedural and indifferent, and never winks. Exclamation marks are the
    // cheapest way to break that, so they are banned.
    for (const act of TUTORIAL_ACTS) {
      for (const step of act.steps) {
        expect(step.body, step.id).not.toContain("!");
        expect(step.title, step.id).not.toContain("!");
      }
    }
  });

  it("uses every byline it declares", () => {
    // A byline nothing speaks in is a department that does not exist.
    const spoken = new Set(
      TUTORIAL_ACTS.flatMap((act) => act.steps.map((step) => step.speaker)).filter(
        (speaker) => speaker !== null,
      ),
    );

    for (const byline of COMPANY_BYLINES) {
      expect(spoken.has(byline), `nothing is said by ${byline}`).toBe(true);
    }
  });

  it("does not diagnose the player", () => {
    // The lore rule easiest to break by being helpful: the Company calls it
    // enthusiasm, an election, a treatment plan, and never what it is — a card
    // that did would be the tutorial explaining its own joke.
    const prose = TUTORIAL_ACTS.flatMap((act) => act.steps.map((step) => step.body))
      .join(" ")
      .toLowerCase();

    for (const word of ["addict", "addiction", "gambling problem", "compulsion"]) {
      expect(prose, `the script says "${word}" out loud`).not.toContain(word);
    }
  });
});
