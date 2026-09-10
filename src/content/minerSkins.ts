/**
 * Miner skins. The same idea as `catSkins.ts`, with one asymmetry: only the
 * default is free. A cat's skin is drawn at random, so four free defaults are
 * what stop the first four cats looking identical; the miner's look is selected,
 * so a second free option would be a choice made before the player has any
 * reason to prefer either.
 *
 * The ladder is x100 a rung, matching the cat ladder and offset from it so the
 * two interleave. It stops below the cat top hat, which stays the most expensive
 * thing in the game.
 */

export const MINER_SKIN_IDS = [
  "miner.standard",
  "miner.prospector",
  "miner.deepdiver",
  "miner.company",
  "miner.veteran",
  "miner.visitor",
] as const;

export type MinerSkinId = (typeof MINER_SKIN_IDS)[number];

export interface MinerSkinDefinition {
  id: MinerSkinId;
  displayName: string;
  /**
   * The miner, in profile, facing the way the encounters come from. One sprite
   * and one direction. The profile puts the forward hand at columns 9-10 of the
   * sprite grid, where `expeditionRenderer` hangs every pickaxe pose.
   *
   * This is the planted frame: what the store icon shows, and what the scene
   * draws whenever the miner is not walking.
   */
  spriteId: string;
  /**
   * The mid-stride frame, drawn only while an encounter is approaching. The pair
   * is the whole sprite sheet. Identical to `spriteId` above row 10, so only the
   * legs move and a walk cannot turn into a jump — the same rule the cats'
   * rest/flick pair follows, held by `skins.test.ts`.
   */
  strideSpriteId: string;
  /** null for the one default; chips for everything else. */
  chipCost: number | null;
}

export const MINER_SKINS: Record<MinerSkinId, MinerSkinDefinition> = {
  "miner.standard": {
    id: "miner.standard",
    displayName: "Standard issue",
    // The default sprite, so a save that has bought nothing needs no migration.
    spriteId: "sprite.player",
    strideSpriteId: "sprite.player.stride",
    chipCost: null,
  },
  "miner.prospector": {
    id: "miner.prospector",
    displayName: "Prospector",
    spriteId: "sprite.miner.prospector",
    strideSpriteId: "sprite.miner.prospector.stride",
    chipCost: 25_000,
  },
  "miner.deepdiver": {
    id: "miner.deepdiver",
    displayName: "Deep diver",
    spriteId: "sprite.miner.deepdiver",
    strideSpriteId: "sprite.miner.deepdiver.stride",
    chipCost: 2_500_000,
  },
  "miner.company": {
    id: "miner.company",
    displayName: "Company suit",
    spriteId: "sprite.miner.company",
    strideSpriteId: "sprite.miner.company.stride",
    chipCost: 250_000_000,
  },
  "miner.veteran": {
    id: "miner.veteran",
    displayName: "Veteran",
    spriteId: "sprite.miner.veteran",
    strideSpriteId: "sprite.miner.veteran.stride",
    chipCost: 25_000_000_000,
  },
  "miner.visitor": {
    id: "miner.visitor",
    displayName: "Visitor",
    // Renamed from `miner.gilded`. The id moved with the name because this
    // string is in the save — see `migrateFifteenToSixteen`.
    spriteId: "sprite.miner.visitor",
    strideSpriteId: "sprite.miner.visitor.stride",
    chipCost: 500_000_000_000,
  },
};

/** The skin every save starts with, and the one it falls back to. */
export const DEFAULT_MINER_SKIN_ID: MinerSkinId = "miner.standard";

export function isMinerSkinId(value: unknown): value is MinerSkinId {
  return typeof value === "string" && (MINER_SKIN_IDS as readonly string[]).includes(value);
}
