/**
 * Coverage for miner skins — a collection that is selected rather than drawn,
 * which is the whole of the risk: owning and wearing are two states, a save can
 * disagree about which is which, and the renderer draws whatever the save says
 * without asking whether it was ever bought.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINER_SKIN_ID,
  MINER_SKINS,
  MINER_SKIN_IDS,
  type MinerSkinId,
} from "../../content/minerSkins";
import { CAT_SKINS } from "../../content/catSkins";
import { applyPrestige } from "../../domain/prestige";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectExpeditionView, selectSkinsView } from "../../domain/selectors";
import { createGameState, type GameState } from "../../domain/state";
import { normalizeGameState } from "../../persistence/saveSchema";
import { SPRITE_GRID, hasSprite, spriteRows } from "../../rendering/sprites";

const NOW = 1_700_000_000_000;

function withChips(chips: number): GameState {
  const base = createGameState({ nowUnixMs: NOW, seed: 5 });

  return { ...base, resources: { ...base.resources, chips } };
}

const PAID: MinerSkinId = "miner.prospector";

describe("the miner wardrobe", () => {
  it("starts with exactly one skin, and it is free", () => {
    // Cats have four free skins so the first four are not identical; the miner
    // is one character whose look is chosen, so a second free option would be a
    // decision made before the player has any reason to prefer either.
    const free = MINER_SKIN_IDS.filter((id) => MINER_SKINS[id].chipCost === null);

    expect(free).toEqual([DEFAULT_MINER_SKIN_ID]);
    expect(withChips(0).collection.ownedMinerSkinIds).toEqual([DEFAULT_MINER_SKIN_ID]);
    expect(withChips(0).collection.activeMinerSkinId).toBe(DEFAULT_MINER_SKIN_ID);
  });

  it("prices its ladder below the cat top hat", () => {
    // The most expensive thing in the game stays the top hat, deliberately.
    const dearest = Math.max(
      ...MINER_SKIN_IDS.map((id) => MINER_SKINS[id].chipCost ?? 0),
    );

    expect(dearest).toBeLessThan(CAT_SKINS["cat.tophat"].chipCost ?? 0);
  });

  it("draws every skin with a sprite that exists, both frames", () => {
    // Twelve sprites, not six: a set absent from exactly this kind of list is a
    // set nothing verifies, so the stride frames are named here too.
    for (const id of MINER_SKIN_IDS) {
      expect(hasSprite(MINER_SKINS[id].spriteId), `${id} planted`).toBe(true);
      expect(hasSprite(MINER_SKINS[id].strideSpriteId), `${id} stride`).toBe(true);
    }
  });

  it("moves only the legs between a skin's two frames", () => {
    /*
     * The cats' rule applied to the miner: a stride frame that also moved the
     * head or the pack would read as a jump rather than a step, and since the
     * pickaxe hangs off the forward hand, a stride that moved the arm would make
     * the tool jitter in time with the feet.
     *
     * Rows 0-9 identical, rows 10-11 different. Both halves matter: the second
     * is what stops a "stride" frame that is simply a copy.
     */
    for (const id of MINER_SKIN_IDS) {
      const planted = spriteRows(MINER_SKINS[id].spriteId);
      const stride = spriteRows(MINER_SKINS[id].strideSpriteId);

      for (let row = 0; row < 10; row += 1) {
        expect(stride[row], `${id} row ${String(row)}`).toBe(planted[row]);
      }

      expect(
        stride[10] !== planted[10] || stride[11] !== planted[11],
        `${id} has two identical frames`,
      ).toBe(true);
    }
  });

  /**
   * The two halves of the wardrobe rule, both held here. Six skins that differ
   * by three cells out of 144 are one drawing; six that each redraw a third of
   * the body they are supposed to be wearing are six characters. Nothing else in
   * the suite can see either, because every sprite is a well-formed 12x12 grid
   * whose id resolves.
   *
   * So the floors below say the six are not one drawing, and
   * `builds every skin on the same chassis` says they are not six characters.
   * Neither can say whether a brim reads as a brim at 24 pixels.
   */
  describe("telling the six apart", () => {
    const rowsOf = (id: MinerSkinId): readonly string[] => spriteRows(MINER_SKINS[id].spriteId);

    /** Cells where two skins differ, either in shade or in being drawn at all. */
    const distance = (a: MinerSkinId, b: MinerSkinId, outlineOnly: boolean): number => {
      const [left, right] = [rowsOf(a), rowsOf(b)];
      let cells = 0;

      for (let row = 0; row < SPRITE_GRID; row += 1) {
        for (let column = 0; column < SPRITE_GRID; column += 1) {
          const one = left[row][column];
          const other = right[row][column];

          cells += (outlineOnly ? (one === ".") !== (other === ".") : one !== other) ? 1 : 0;
        }
      }

      return cells;
    };

    const pairs = MINER_SKIN_IDS.flatMap((a, index) =>
      MINER_SKIN_IDS.slice(index + 1).map((b) => [a, b] as const),
    );

    it("gives no two skins the same drawing", () => {
      /*
       * Once every skin shares the standard's torso, arm and shoulder by rule,
       * only about sixty cells are left to differ in — so a higher floor would
       * make six unrelated drawings the only way to pass. The outline floor
       * below does the real work at two drawn pixels a cell; this one catches a
       * duplicate. Measured, the worst pair is 13.
       */
      for (const [a, b] of pairs) {
        expect(distance(a, b, false), `${a} vs ${b}`).toBeGreaterThanOrEqual(12);
      }
    });

    it("gives no two skins the same outline", () => {
      // The half that matters most: shading is invisible at two drawn pixels a
      // cell, so two skins differing only in shade are one skin. Measured, the
      // worst pair is 9 — a brim and a closed stance.
      for (const [a, b] of pairs) {
        expect(distance(a, b, true), `${a} vs ${b}`).toBeGreaterThanOrEqual(6);
      }
    });

    it("builds every skin on the same chassis", () => {
      /*
       * Rows 5-9, columns 2-10 are the torso, the shoulder and the forward arm,
       * and they are the character: a skin that redrew them would read as a
       * different miner rather than the same one dressed differently. Everything
       * outside the block — the head, what is worn at the back or hip, the
       * stance — is where a skin is told apart.
       *
       * Both frames, because a stride that drifted off the chassis would put the
       * pickaxe somewhere else on alternate steps.
       */
      const chassis = spriteRows("sprite.player");

      for (const id of MINER_SKIN_IDS) {
        const definition = MINER_SKINS[id];

        for (const spriteId of [definition.spriteId, definition.strideSpriteId]) {
          const rows = spriteRows(spriteId);

          for (let row = 5; row <= 9; row += 1) {
            for (let column = 2; column <= 10; column += 1) {
              expect(
                rows[row][column],
                `${spriteId} at ${String(column)},${String(row)}`,
              ).toBe(chassis[row][column]);
            }
          }
        }
      }
    });

    it("faces right, and can prove it", () => {
      /*
       * The miner is drawn in profile, facing right, in every state — a claim
       * nothing else holds, since a sprite check has no opinion about which way
       * a head is pointing.
       *
       * A head that is its own mirror image has no direction in it: a helm grown
       * symmetrically reads as facing the viewer rather than in profile.
       *
       * The floor is "not symmetric" rather than a margin, because the standard
       * this wardrobe is built on sits at 2 and a floor rejecting the baseline
       * would be about something else. Measured: standard 2, prospector 16, deep
       * diver 6, company 18, veteran 8, visitor 2.
       *
       * It cannot tell right from left — a mirrored miner would pass. What it
       * catches is a sprite with no facing at all.
       */
      for (const id of MINER_SKIN_IDS) {
        const rows = rowsOf(id);
        const columns: number[] = [];

        for (let row = 0; row <= 4; row += 1) {
          for (let column = 0; column < SPRITE_GRID; column += 1) {
            if (rows[row][column] !== ".") {
              columns.push(column);
            }
          }
        }

        // Mirrored about the head's own lit box rather than the sprite's, so an
        // off-centre head is not credited with asymmetry it does not have.
        const first = Math.min(...columns);
        const last = Math.max(...columns);
        let differing = 0;

        for (let row = 0; row <= 4; row += 1) {
          for (let column = first; column <= last; column += 1) {
            differing += rows[row][column] === rows[row][first + last - column] ? 0 : 1;
          }
        }

        expect(differing, `${id} head is its own mirror image`).toBeGreaterThan(0);
      }
    });

    it("keeps the hand where the pickaxe hangs off it", () => {
      // The one cell an overhaul must not move: every swing and reach pose
      // begins at the forward hand, so a skin that redrew the arm would leave
      // the tool floating and look like a renderer bug rather than an art one.
      for (const id of MINER_SKIN_IDS) {
        const rows = rowsOf(id);

        for (const [column, row] of [[9, 6], [10, 6], [9, 7], [10, 7]] as const) {
          expect(rows[row][column], `${id} at ${String(column)},${String(row)}`).not.toBe(".");
        }
      }
    });

    it("stands every skin on the same ground line", () => {
      // Boots on the bottom row, so switching skins does not change the miner's
      // height or leave one hovering.
      for (const id of MINER_SKIN_IDS) {
        expect(rowsOf(id)[SPRITE_GRID - 1], id).toContain("#");
      }
    });
  });

  it("buys a skin once, and charges for it once", () => {
    const cost = MINER_SKINS[PAID].chipCost ?? 0;
    const bought = reduce(withChips(cost), { type: "BUY_MINER_SKIN", skinId: PAID }).state;

    expect(bought.collection.ownedMinerSkinIds).toContain(PAID);
    expect(bought.resources.chips).toBe(0);

    // Owning it is not wearing it: buying a coat does not put it on.
    expect(bought.collection.activeMinerSkinId).toBe(DEFAULT_MINER_SKIN_ID);

    const again = reduce(bought, { type: "BUY_MINER_SKIN", skinId: PAID }).state;

    expect(again.collection.ownedMinerSkinIds.filter((id) => id === PAID)).toHaveLength(1);
  });

  it("refuses a skin the chips do not cover, and takes nothing", () => {
    const cost = MINER_SKINS[PAID].chipCost ?? 0;
    const broke = withChips(cost - 1);
    const after = reduce(broke, { type: "BUY_MINER_SKIN", skinId: PAID }).state;

    expect(after.collection.ownedMinerSkinIds).not.toContain(PAID);
    expect(after.resources.chips).toBe(cost - 1);
  });

  it("refuses to wear a skin that has not been bought", () => {
    // Enforced at the command as well as in the save normaliser: a state where
    // the miner wears something unowned has no way back.
    const after = reduce(withChips(0), { type: "SET_MINER_SKIN", skinId: PAID }).state;

    expect(after.collection.activeMinerSkinId).toBe(DEFAULT_MINER_SKIN_ID);
  });

  it("wears one that has, and the scene draws it", () => {
    const cost = MINER_SKINS[PAID].chipCost ?? 0;
    const bought = reduce(withChips(cost), { type: "BUY_MINER_SKIN", skinId: PAID }).state;
    const worn = reduce(bought, { type: "SET_MINER_SKIN", skinId: PAID }).state;

    expect(worn.collection.activeMinerSkinId).toBe(PAID);
    expect(selectExpeditionView(deriveContext(worn)).playerSpriteId).toBe(
      MINER_SKINS[PAID].spriteId,
    );

    // And the default still draws what it always drew.
    expect(selectExpeditionView(deriveContext(bought)).playerSpriteId).toBe("sprite.player");
  });

  it("offers each skin in exactly one of its three states", () => {
    const cost = MINER_SKINS[PAID].chipCost ?? 0;
    const bought = reduce(withChips(cost), { type: "BUY_MINER_SKIN", skinId: PAID }).state;
    const view = selectSkinsView(deriveContext(bought));

    const standard = view.miners.find((offer) => offer.skinId === DEFAULT_MINER_SKIN_ID);
    const owned = view.miners.find((offer) => offer.skinId === PAID);
    const unowned = view.miners.find((offer) => !offer.owned);

    // Worn: neither buyable nor wearable again.
    expect(standard?.worn).toBe(true);
    expect(standard?.wear.available).toBe(false);

    // Owned but not worn: wearable, not buyable.
    expect(owned?.owned).toBe(true);
    expect(owned?.worn).toBe(false);
    expect(owned?.wear.available).toBe(true);
    expect(owned?.purchase.available).toBe(false);

    // Unowned: not wearable at any price until it is bought.
    expect(unowned?.wear.available).toBe(false);
  });

  it("survives a save round trip, and repairs a skin worn but not owned", () => {
    const cost = MINER_SKINS[PAID].chipCost ?? 0;
    const bought = reduce(withChips(cost), { type: "BUY_MINER_SKIN", skinId: PAID }).state;
    const worn = reduce(bought, { type: "SET_MINER_SKIN", skinId: PAID }).state;
    const reloaded = normalizeGameState(worn, NOW).state;

    expect(reloaded.collection.ownedMinerSkinIds).toContain(PAID);
    expect(reloaded.collection.activeMinerSkinId).toBe(PAID);

    // The failure the normaliser exists for: a hand-edited save wearing a skin
    // it never bought draws a sprite the player cannot change away from, since
    // the panel only offers what is owned.
    const impossible: GameState = {
      ...worn,
      collection: { ...worn.collection, ownedMinerSkinIds: [DEFAULT_MINER_SKIN_ID] },
    };

    expect(normalizeGameState(impossible, NOW).state.collection.activeMinerSkinId).toBe(
      DEFAULT_MINER_SKIN_ID,
    );

    const nonsense: GameState = {
      ...worn,
      collection: { ...worn.collection, activeMinerSkinId: "miner.nope" as MinerSkinId },
    };

    expect(normalizeGameState(nonsense, NOW).state.collection.activeMinerSkinId).toBe(
      DEFAULT_MINER_SKIN_ID,
    );
  });

  it("keeps its skins across a prestige, being cosmetic", () => {
    const cost = MINER_SKINS[PAID].chipCost ?? 0;
    const bought = reduce(withChips(cost), { type: "BUY_MINER_SKIN", skinId: PAID }).state;
    const worn = reduce(bought, { type: "SET_MINER_SKIN", skinId: PAID }).state;

    // A real prestige rather than a normalisation standing in for one: the claim
    // is about `applyPrestige`'s slice rule.
    const ready: GameState = {
      ...worn,
      resources: { ...worn.resources, cash: 400_000 },
      prestige: { ...worn.prestige, cycleCashEarned: 600_000, lifetimeCashEarned: 600_000 },
    };

    const outcome = applyPrestige(ready);

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.collection.ownedMinerSkinIds).toContain(PAID);
      expect(outcome.state.collection.activeMinerSkinId).toBe(PAID);
      // Chips reset, which is what makes keeping the skin worth asserting.
      expect(outcome.state.resources.chips).toBe(0);
    }
  });
});
