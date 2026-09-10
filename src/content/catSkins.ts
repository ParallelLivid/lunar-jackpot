/**
 * Cat skins. A skin is per cat and saved, so a shelf of cats is a record of
 * individual meetings rather than one counter drawn twenty times.
 *
 * Four skins are owned from the start and one is picked at random when a cat is
 * met. Six more are bought with chips, on a ladder that ends at a trillion —
 * deliberately, so something is still worth wanting after everything else.
 *
 * Buying a skin widens the pool future cats draw from and the set any cat can be
 * cycled through. It never redresses a cat already met.
 */

export const CAT_SKIN_IDS = [
  "cat.tabby",
  "cat.tuxedo",
  "cat.patched",
  "cat.smoke",
  "cat.scarf",
  "cat.eyepatch",
  "cat.helmet",
  "cat.crown",
  "cat.halo",
  "cat.tophat",
] as const;

export type CatSkinId = (typeof CAT_SKIN_IDS)[number];

export interface CatSkinDefinition {
  id: CatSkinId;
  displayName: string;
  /** Rest and flick frames, the pair every cat is drawn from. */
  restSpriteId: string;
  flickSpriteId: string;
  /** null for a default skin; chips for a purchasable one. */
  chipCost: number | null;
}

export const CAT_SKINS: Record<CatSkinId, CatSkinDefinition> = {
  // The four defaults: markings rather than accessories, so an undressed cat
  // still looks like a cat and bought skins read as additions.
  "cat.tabby": {
    id: "cat.tabby",
    displayName: "Tabby",
    restSpriteId: "sprite.cat.rest",
    flickSpriteId: "sprite.cat.flick",
    chipCost: null,
  },
  "cat.tuxedo": {
    id: "cat.tuxedo",
    displayName: "Tuxedo",
    restSpriteId: "sprite.cat.tuxedo.rest",
    flickSpriteId: "sprite.cat.tuxedo.flick",
    chipCost: null,
  },
  "cat.patched": {
    id: "cat.patched",
    displayName: "Patched",
    restSpriteId: "sprite.cat.patched.rest",
    flickSpriteId: "sprite.cat.patched.flick",
    chipCost: null,
  },
  "cat.smoke": {
    id: "cat.smoke",
    displayName: "Smoke",
    restSpriteId: "sprite.cat.smoke.rest",
    flickSpriteId: "sprite.cat.smoke.flick",
    chipCost: null,
  },
  // The ladder: each rung is roughly a hundred times the last, steeper than any
  // other price in the game, because these buy nothing but a marker of progress.
  "cat.scarf": {
    id: "cat.scarf",
    displayName: "Scarf",
    restSpriteId: "sprite.cat.scarf.rest",
    flickSpriteId: "sprite.cat.scarf.flick",
    chipCost: 5_000,
  },
  "cat.eyepatch": {
    id: "cat.eyepatch",
    displayName: "Eyepatch",
    restSpriteId: "sprite.cat.eyepatch.rest",
    flickSpriteId: "sprite.cat.eyepatch.flick",
    chipCost: 50_000,
  },
  "cat.helmet": {
    id: "cat.helmet",
    displayName: "Mining helmet",
    restSpriteId: "sprite.cat.helmet.rest",
    flickSpriteId: "sprite.cat.helmet.flick",
    chipCost: 1_000_000,
  },
  "cat.crown": {
    id: "cat.crown",
    displayName: "Crown",
    restSpriteId: "sprite.cat.crown.rest",
    flickSpriteId: "sprite.cat.crown.flick",
    chipCost: 100_000_000,
  },
  "cat.halo": {
    id: "cat.halo",
    displayName: "Halo",
    restSpriteId: "sprite.cat.halo.rest",
    flickSpriteId: "sprite.cat.halo.flick",
    chipCost: 10_000_000_000,
  },
  "cat.tophat": {
    id: "cat.tophat",
    displayName: "Top hat",
    restSpriteId: "sprite.cat.tophat.rest",
    flickSpriteId: "sprite.cat.tophat.flick",
    chipCost: 1_000_000_000_000,
  },
};

/** The skins a player has before buying anything, and the pool a cat is drawn from. */
export const DEFAULT_CAT_SKIN_IDS: CatSkinId[] = CAT_SKIN_IDS.filter(
  (skinId) => CAT_SKINS[skinId].chipCost === null,
);

export function isCatSkinId(value: unknown): value is CatSkinId {
  return typeof value === "string" && (CAT_SKIN_IDS as readonly string[]).includes(value);
}
