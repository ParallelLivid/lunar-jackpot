/**
 * Coverage for the icon-based run summary.
 *
 * The card is the only place a finished run reports itself, and the floating
 * reward pops are `aria-hidden` precisely because it used to say the totals in
 * prose. Replacing that prose with icons is therefore the one change here that
 * could quietly take something away, so the announcement has as many tests as the
 * tiles do.
 */

import { describe, expect, it } from "vitest";
import { MACHINES, ORE_GRADE_IDS, RESOURCE_METADATA } from "../../content/catalog";
import type { MachineId } from "../../content/catalog";
import type { RunSummary } from "../../domain/commands";
import { selectRunSummaryView } from "../../domain/selectors";
import { createEmptyRunInventory, type RunInventory } from "../../domain/state";

function inventory(patch: Partial<RunInventory> = {}): RunInventory {
  return { ...createEmptyRunInventory(), ...patch };
}

function summary(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    outcome: "returned",
    depth: 12,
    encountersCompleted: 7,
    chipsFromOre: 412,
    chipsLost: 0,
    recovered: inventory(),
    lost: null,
    modifierName: null,
    ...patch,
  };
}

describe("what the card shows", () => {
  it("shows chips, and never raw ore", () => {
    /*
     * The note asks for what the run was *worth*. Ore is an intermediate the
     * player never spends — it is converted the moment it is banked — so showing
     * it alongside chips would be showing the same value twice in two units.
     */
    const view = selectRunSummaryView(
      summary({
        chipsFromOre: 412,
        recovered: inventory({
          ore: ORE_GRADE_IDS.reduce(
            (ore, grade) => ({ ...ore, [grade]: 50 }),
            createEmptyRunInventory().ore,
          ),
        }),
      }),
    );

    expect(view.recovered.map((item) => item.key)).toEqual(["chips"]);
    expect(view.recovered[0].amount).toBe(412);
    expect(view.recovered[0].spriteId).toBe(RESOURCE_METADATA.chips.spriteId);
  });

  it("gives every material an icon and a spelled-out name", () => {
    const machineId = Object.keys(MACHINES)[0] as MachineId;
    const view = selectRunSummaryView(
      summary({
        recovered: inventory({
          components: 3,
          relics: 2,
          caches: 1,
          recipePieces: { [machineId]: 4 } as Record<MachineId, number>,
        }),
      }),
    );

    expect(view.recovered.map((item) => item.key)).toEqual([
      "chips",
      "components",
      "relics",
      "caches",
      `recipe:${machineId}`,
    ]);

    for (const item of view.recovered) {
      expect(item.spriteId, item.key).toBeTruthy();
      expect(item.label.length, item.key).toBeGreaterThan(0);
    }
  });

  it("omits what the run did not find", () => {
    // A row of zeroes is noise; the interesting thing about a haul is what is in
    // it.
    const view = selectRunSummaryView(
      summary({ chipsFromOre: 0, recovered: inventory({ relics: 1 }) }),
    );

    expect(view.recovered.map((item) => item.key)).toEqual(["relics"]);
  });

  it("keeps depth and encounters as text", () => {
    // They are not materials and have no icon to give them.
    expect(selectRunSummaryView(summary()).detail).toBe("Depth 12 · 7 encounters");
  });

  it("names the condition the run was under", () => {
    const view = selectRunSummaryView(summary({ modifierName: "Sealed orders" }));

    expect(view.modifierName).toBe("Sealed orders");
    expect(view.announcement).toContain("Sealed orders");
  });
});

describe("after a failure", () => {
  const failed = summary({
    outcome: "failed",
    chipsFromOre: 120,
    chipsLost: 300,
    recovered: inventory({ relics: 1 }),
    lost: inventory({ components: 4, relics: 2 }),
  });

  it("shows what came back and what the roll took, separately", () => {
    const view = selectRunSummaryView(failed);

    expect(view.recovered.map((item) => item.key)).toEqual(["chips", "relics"]);
    expect(view.lost.map((item) => item.key)).toEqual(["chips", "components", "relics"]);
  });

  it("prices the lost ore in chips, like the recovered ore", () => {
    // Reporting one row in chips and the other in ore would be two units for the
    // same thing, on the same card.
    const view = selectRunSummaryView(failed);

    expect(view.lost.find((item) => item.key === "chips")?.amount).toBe(300);
  });

  it("shows no lost row at all on a run that came home", () => {
    expect(selectRunSummaryView(summary()).lost).toEqual([]);
  });

  it("says so when nothing survived", () => {
    const view = selectRunSummaryView(
      summary({ outcome: "failed", chipsFromOre: 0, recovered: inventory(), lost: inventory({ relics: 3 }) }),
    );

    expect(view.recovered).toEqual([]);
    expect(view.announcement).toContain("nothing");
  });
});

describe("the announcement", () => {
  it("carries everything the icons show", () => {
    /*
     * The regression this chunk was most likely to cause. The reward pops are
     * `aria-hidden` on the grounds that this card announces the totals; when the
     * prose became icons, the announcement had to move rather than vanish.
     */
    const machineId = Object.keys(MACHINES)[0] as MachineId;
    const view = selectRunSummaryView(
      summary({
        outcome: "failed",
        chipsFromOre: 412,
        chipsLost: 88,
        modifierName: "Deep quota",
        recovered: inventory({
          components: 3,
          recipePieces: { [machineId]: 2 } as Record<MachineId, number>,
        }),
        lost: inventory({ relics: 5 }),
      }),
    );

    expect(view.announcement).toContain("Oxygen exhausted");
    expect(view.announcement).toContain("Depth 12");
    expect(view.announcement).toContain("7 encounters");
    expect(view.announcement).toContain("Deep quota");

    // Every recovered and lost tile is named in the sentence, amount included.
    for (const item of [...view.recovered, ...view.lost]) {
      expect(view.announcement, item.key).toContain(`${String(item.amount)} ${item.label}`);
    }

    expect(view.announcement).toContain("Lost");
  });

  it("reads as one sentence rather than a list of tiles", () => {
    // Tile-by-tile is worse than a sentence for anyone listening, which is why
    // the tiles are hidden and this is not.
    const view = selectRunSummaryView(summary({ recovered: inventory({ relics: 2 }) }));

    expect(view.announcement).toBe(
      "Extraction complete. Depth 12 · 7 encounters. Brought back 412 Chips, 2 Relics.",
    );
  });
});
