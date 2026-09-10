/** Resource identity, modifier vocabulary, and tunable economy constants. */

export const RESOURCE_IDS = [
  "cash",
  "chips",
  "relics",
  "components",
  "keys",
  "caches",
  "deepCaches",
  "selenite",
] as const;

export type ResourceId = (typeof RESOURCE_IDS)[number];

export interface ResourceMetadata {
  id: ResourceId;
  displayName: string;
  /** Short symbol used where a full label does not fit. */
  glyph: string;
  spriteId: string;
  description: string;
  resetOnPrestige: boolean;
}

export const RESOURCE_METADATA: Record<ResourceId, ResourceMetadata> = {
  cash: {
    id: "cash",
    spriteId: "sprite.resource.cash",
    displayName: "Cash",
    glyph: "$",
    description: "Produced by casino machines. Buys machine levels and cache keys.",
    resetOnPrestige: true,
  },
  chips: {
    id: "chips",
    spriteId: "sprite.resource.chips",
    displayName: "Chips",
    glyph: "C",
    description: "Converted from expedition ore at the posted rate. Funds research, supplies, and the games The Company runs.",
    resetOnPrestige: true,
  },
  relics: {
    id: "relics",
    spriteId: "sprite.resource.relics",
    displayName: "Relics",
    glyph: "R",
    description: "Expedition rewards. Upgrade the oxygen tank and pickaxe, both of which remain Company property.",
    resetOnPrestige: true,
  },
  components: {
    id: "components",
    spriteId: "sprite.resource.components",
    displayName: "Components",
    glyph: "K",
    description: "Expedition rewards. Required by higher machine levels.",
    resetOnPrestige: true,
  },
  keys: {
    id: "keys",
    spriteId: "sprite.resource.keys",
    displayName: "Keys",
    glyph: "F",
    description: "Bought from The Company with cash. Opens one cache each. Non-refundable.",
    resetOnPrestige: true,
  },
  caches: {
    id: "caches",
    spriteId: "sprite.resource.caches",
    displayName: "Caches",
    glyph: "B",
    description: "Rare expedition finds. Company property until opened, which takes a key.",
    resetOnPrestige: true,
  },
  // A second balance rather than a typed count inside the first: `RESOURCE_IDS`
  // is what the save normaliser, transaction layer, resource bar and developer
  // menu all iterate, so a new entry is handled everywhere without being told.
  deepCaches: {
    id: "deepCaches",
    spriteId: "sprite.resource.deep-caches",
    displayName: "Deep caches",
    glyph: "D",
    description:
      "Found below the Dark, or bought from The Company at a markup. Opened with a key, usually for a totem.",
    resetOnPrestige: true,
  },
  selenite: {
    id: "selenite",
    spriteId: "sprite.resource.selenite",
    displayName: "Selenite",
    glyph: "S",
    description: "Awarded on prestige. Buys permanent perks.",
    resetOnPrestige: false,
  },
};

/** Ore never enters banked balances; it exists only inside a run inventory. */
export const ORE_GRADE_IDS = ["dust", "seam", "core"] as const;

export type OreGradeId = (typeof ORE_GRADE_IDS)[number];

export interface OreGradeDefinition {
  id: OreGradeId;
  spriteId: string;
  displayName: string;
  /** Chips granted per unit when banked at extraction. */
  chipValue: number;
}

export const ORE_GRADES: Record<OreGradeId, OreGradeDefinition> = {
  dust: {
    id: "dust",
    spriteId: "sprite.ore.dust",
    displayName: "Regolith dust",
    chipValue: 1,
  },
  seam: {
    id: "seam",
    spriteId: "sprite.ore.seam",
    displayName: "Bright seam",
    chipValue: 4,
  },
  core: {
    id: "core",
    spriteId: "sprite.ore.core",
    displayName: "Cold core",
    chipValue: 12,
  },
};

/** Every value a modifier may target. */
export const STAT_IDS = [
  "machine.payout",
  "machine.cycleMs",
  "gear.tankOxygen",
  "gear.pickaxeDamage",
  "expedition.oreYield",
  "expedition.oxygenDrainRate",
  "expedition.approachSpeed",
  "gear.pickaxeCritChance",
  "expedition.rewardQuantity",
  "expedition.encounterWeight",
  "expedition.failureLossChance",
  "economy.oreChipValue",
  "gambling.outcomeWeight",
  "prestige.startingCash",
  "prestige.seleniteGain",
  "luck",
] as const;

export type StatId = (typeof STAT_IDS)[number];

export type ModifierOperation = "add" | "multiply";

export interface Modifier {
  sourceId: string;
  targetStat: StatId;
  operation: ModifierOperation;
  value: number;
  /** Tag-scoped modifiers only apply to matching encounters or reward tables. */
  tags?: string[];
}

export interface StatRule {
  /** Applied after additive and multiplicative passes. */
  minimum?: number;
  maximum?: number;
  rounding: "none" | "floor" | "round" | "ceil";
}

/**
 * The ceiling on total luck points. Defined here, above `STAT_RULES`, because
 * the stat clamp and `ECONOMY.luckPointCap` must be the same number —
 * `evaluateStat` applies the clamp, so a lower one would silently pin every luck
 * value in the game. A test asserts the two agree.
 *
 * A guard against a hand-edited save rather than a balance lever: `luckFactor`
 * asymptotes on its own well before this.
 */
export const LUCK_POINT_CAP = 25_000;

export const STAT_RULES: Record<StatId, StatRule> = {
  "machine.payout": { minimum: 0, rounding: "floor" },
  "machine.cycleMs": { minimum: 100, rounding: "round" },
  "gear.tankOxygen": { minimum: 1, rounding: "round" },
  "gear.pickaxeDamage": { minimum: 0.01, rounding: "none" },
  "expedition.oreYield": { minimum: 0, rounding: "floor" },
  // Below 1 slows the drain. Floored well above zero: a run that never spends
  // oxygen never ends.
  "expedition.oxygenDrainRate": { minimum: 0.2, maximum: 4, rounding: "none" },
  // Above 1 shortens the walk. Capped so travel never becomes instant.
  "expedition.approachSpeed": { minimum: 0.25, maximum: 6, rounding: "none" },
  "gear.pickaxeCritChance": { minimum: 0, maximum: 0.9, rounding: "none" },
  "expedition.rewardQuantity": { minimum: 0, rounding: "floor" },
  "expedition.encounterWeight": { minimum: 0, rounding: "none" },
  "expedition.failureLossChance": { minimum: 0.05, maximum: 0.95, rounding: "none" },
  "economy.oreChipValue": { minimum: 0, rounding: "floor" },
  "gambling.outcomeWeight": { minimum: 0, rounding: "none" },
  "prestige.startingCash": { minimum: 0, rounding: "floor" },
  "prestige.seleniteGain": { minimum: 0, rounding: "floor" },
  luck: { minimum: 0, maximum: LUCK_POINT_CAP, rounding: "none" },
};

export interface EconomyConstants {
  /**
   * Largest quantity a balance may hold before it rolls over to `INF`. Not a
   * refusal: a total that passes this becomes `Infinity` and stays there, so it
   * marks the point at which counting stops being worth doing.
   */
  safeMaximum: number;
  offlineCapMs: number;
  /** Guards against a stalled renderer consuming an unreasonable oxygen amount. */
  maxActiveTickMs: number;
  autosaveDebounceMs: number;
  autosaveIntervalMs: number;
  startingCash: number;
  keyCashCost: number;
  /**
   * Buying a cache is a paced, guaranteed route to collectibles alongside the
   * random expedition find, throttled by the depth gate. The price is not a
   * constant but this many seconds of current income, so a cache always costs
   * about the same amount of time; a flat price stops being a decision quickly.
   */
  cacheIncomeSeconds: number;
  /**
   * The floor, as a multiple of a key's price. Thirty seconds of a starting
   * income would make a cache cheaper than the key needed to open it.
   */
  cacheMinimumKeyMultiple: number;
  /**
   * Depths descended between purchases, cumulative across every run. Not "deepest
   * reached", which would stop the collectible economy for a player who plateaus.
   */
  depthsPerCachePurchase: number;
  /**
   * The chip price of a cache, off the shelf and unlimited, beside the cash
   * price rather than instead of it. Deliberately cheap: chips are the currency
   * a player has least use for once their machines are running.
   */
  cacheChipCost: number;
  /** The chip price of a deep cache. Always in stock, like the ordinary one. */
  deepCacheChipCost: number;
  /**
   * Depths descended between cash purchases of a deep cache: ten times the
   * ordinary gate, since a deep cache is the rarer half of the collection.
   */
  depthsPerDeepCachePurchase: number;
  /** What a deep cache costs, as a multiple of an ordinary one. */
  deepCacheCashMultiple: number;
  /**
   * Cash the autobuy will not spend below, as a multiple of the price. Without
   * it the balance would sit at zero forever and no machine level could ever be
   * bought again.
   */
  cacheAutobuyCashFloorMultiple: number;
  baseOxygenDrainPerSecond: number;
  lowOxygenWarningRatio: number;
  failureLossChanceBase: number;
  failureLossChanceMinimum: number;
  failureLossChanceMaximum: number;
  /**
   * Fragments needed to raise a trinket one grade, indexed from grade E. A
   * duplicate yields fragments rather than a second copy, so the cost rises with
   * each grade. The curve is Fibonacci from 3, and totems share it.
   */
  trinketFragmentCosts: number[];
  /** Fragments needed to raise a totem one grade, indexed from grade E. */
  totemFragmentCosts: number[];
  /** Fragments granted by finding an item already owned. */
  fragmentsPerDuplicate: number;
  /**
   * Selenite granted instead, when the fragments would be dead weight. Selenite
   * is the substitute because it survives prestige: a find that can no longer
   * improve this cycle instead improves every cycle after it.
   */
  selenitePerMaxedDuplicate: number;
  activeTotemSlots: number;
  trinketSlotsPerGear: number;
  /**
   * Luck is stored in points; this curve converts points to a 0..1 weight bias.
   * The cap guards against a hand-edited save rather than acting as a balance
   * lever, since `luckFactor` asymptotes on its own; the half-point shapes the
   * curve.
   */
  luckPointCap: number;
  luckDiminishingHalfPoint: number;
  /** How strongly full luck multiplies weights tagged "beneficial". */
  luckEncounterWeightStrength: number;
  /**
   * Fractional spread applied to an encounter's duration when it is generated,
   * so the cost of pressing on is never exactly predictable.
   */
  encounterDurationVariance: number;
  /** Components granted per recipe piece when every recipe is already complete. */
  recipeFallbackComponentsPerPiece: number;
  /**
   * The ceiling on any chip game's expected return per chip staked. One number
   * for all four games, so there is no per-game cap to fall out of step.
   */
  gamblingMaxExpectedReturn: number;
  /**
   * The depth-wager price curve, published in the panel exactly as written here:
   * `p(target) = bestProbability ^ ((target / best) ^ curveExponent)`, where
   * `best` is the all-time deepest depth floored at `referenceFloor` and the
   * offered multiplier is `baseReturn / p`.
   *
   * The floor stops a fresh save betting on depth 1 at long odds.
   * `bestProbability` is the chance the curve assigns to matching a personal
   * best, and decides whether this is a chip printer — priced near a third,
   * since matching your best is uncertain but far from rare.
   */
  depthWagerReferenceFloor: number;
  depthWagerBestProbability: number;
  depthWagerCurveExponent: number;
  /** The house margin the offered price is derived at, before luck. */
  depthWagerBaseReturn: number;
  /**
   * The house will not take a bet it is nearly certain to win: a target far
   * below the player's best would pay less than the stake, which is a fee rather
   * than a bet. Becomes a minimum offered target rather than a bad price.
   */
  depthWagerMinimumMultiplier: number;
  depthWagerMaximumMultiplier: number;
  /** How far full luck may shade the offered price before the cap has its say. */
  depthWagerLuckBias: number;
  prestigeThresholdCash: number;
  prestigeSeleniteDivisor: number;
  /**
   * Per-prestige growth of the cash wall and of the cash-per-selenite divisor.
   * The divisor must grow more slowly than the threshold: growing together pins
   * the award at 1 selenite while the wall grows twelve-thousandfold, and the
   * perk tree stops advancing. See `prestigeCurveReport` in the simulations.
   */
  prestigeThresholdGrowth: number;
  prestigeSeleniteDivisorGrowth: number;
  /**
   * How much cash over the threshold counts for. High enough that a long cycle
   * is worth more than a short one: at ten million cash, 15 selenite rather
   * than 9.
   */
  prestigeSeleniteExponent: number;
  /** Eligible encounters without a needed rare drop before pity raises its weight. */
  pityEncounterThreshold: number;
  pityWeightMultiplier: number;
  recentSpinHistoryLength: number;
  encounterHistoryLength: number;
  launchTransitionMs: number;
  rewardTransitionMs: number;
  /** How long an ordinary inline message stays on screen. */
  feedbackDurationMs: number;
  /** Rejections and warnings linger longer, since they are easy to miss. */
  feedbackErrorDurationMs: number;
  feedbackMaxVisible: number;
  /** How long a floating gain indicator stays over the expedition scene. */
  rewardPopDurationMs: number;
  criticalPopDurationMs: number;
  /** How long an encounter takes to dissolve once it is finished. */
  encounterDissolveMs: number;
  /**
   * How many machine payout cues may sound in one tick. On a full floor ten cues
   * at once is a chord rather than information, so the loudest few are kept.
   */
  machineCuesPerTick: number;
  /**
   * Auto-continue may never be set below this fraction of oxygen. The feature
   * exists to stop before a failure, so a zero threshold would defeat it.
   */
  autoContinueMinimumRatio: number;
  /** How many lines of history the log keeps. */
  logMaxEntries: number;
  /**
   * Deepest depth ever reached at which the jukebox appears on the rail.
   * Measured over 25 seeded runs per progression tier: unreachable on maxed gear
   * (median 118), occasional with the perk tree finished (median 222), and about
   * a coin flip with a complete collection (median 260).
   *
   * Read against lifetime `statistics.deepestDepth`, since
   * `deepestDepthThisCycle` would hand the jukebox back on every prestige.
   */
  jukeboxUnlockDepth: number;
  /**
   * How often the pickaxe swings. Damage lands per strike rather than per frame,
   * so a critical hit is an event the player can see rather than an average.
   */
  pickaxeStrikeIntervalMs: number;
  /** What a critical strike multiplies its damage by. */
  pickaxeCritMultiplier: number;
  /**
   * Chance a run rolls a modifier at launch. Deliberately low: a condition that
   * turns up most runs is a stat sheet rather than an event.
   */
  expeditionModifierChance: number;
  /**
   * Chance per encounter of meeting a cat. Rolled on its own, before the
   * weighted table, so nothing — luck, totems, pity, depth — can move it.
   */
  catEncounterChance: number;
  /**
   * Wall-clock milliseconds a run holds still when a cat is met — wall clock
   * rather than run time, so it is the same visible moment at 1x and at 32x. The
   * pause is what makes a 1-in-1000 event something the player sees.
   */
  catPauseWallMs: number;
  /** Luck each cat adds, permanently, and through prestige. */
  luckPerCat: number;
}

export const ECONOMY: EconomyConstants = {
  /*
   * A googol, sized against the prestige wall: the threshold grows 1.5x per
   * prestige from 250,000, so `MAX_SAFE_INTEGER` is about 60 prestiges away and
   * this is about 540. Rolling over to `INF` should end a very long road rather
   * than happen to somebody who left the tab open.
   *
   * Still 208 orders of magnitude below `Number.MAX_VALUE`, so no intermediate
   * arithmetic reaches a true infinity first. Above 2^53 a double cannot
   * separate adjacent integers, which is why counting stops at all.
   */
  safeMaximum: 1e100,
  offlineCapMs: 90 * 60 * 1000,
  maxActiveTickMs: 1000,
  autosaveDebounceMs: 1500,
  autosaveIntervalMs: 30_000,
  startingCash: 0,
  keyCashCost: 250,
  cacheIncomeSeconds: 30,
  cacheMinimumKeyMultiple: 2,
  depthsPerCachePurchase: 10,
  cacheChipCost: 50,
  deepCacheChipCost: 500,
  depthsPerDeepCachePurchase: 100,
  deepCacheCashMultiple: 5,
  cacheAutobuyCashFloorMultiple: 2,
  baseOxygenDrainPerSecond: 1,
  lowOxygenWarningRatio: 0.25,
  failureLossChanceBase: 0.5,
  failureLossChanceMinimum: 0.05,
  failureLossChanceMaximum: 0.95,
  trinketFragmentCosts: [3, 5, 8, 13, 21, 34, 55],
  totemFragmentCosts: [3, 5, 8, 13, 21, 34, 55],
  fragmentsPerDuplicate: 1,
  selenitePerMaxedDuplicate: 1,
  activeTotemSlots: 3,
  trinketSlotsPerGear: 3,
  luckPointCap: LUCK_POINT_CAP,
  luckDiminishingHalfPoint: 250,
  luckEncounterWeightStrength: 0.8,
  encounterDurationVariance: 0.35,
  recipeFallbackComponentsPerPiece: 2,
  gamblingMaxExpectedReturn: 1,
  depthWagerReferenceFloor: 10,
  depthWagerBestProbability: 0.35,
  depthWagerCurveExponent: 2.5,
  depthWagerBaseReturn: 0.95,
  depthWagerMinimumMultiplier: 1.1,
  // At this multiplier the curve has run out at roughly twice the player's best,
  // where the offered target range also stops.
  depthWagerMaximumMultiplier: 250,
  depthWagerLuckBias: 0.25,
  prestigeThresholdCash: 250_000,
  prestigeSeleniteDivisor: 250_000,
  // Keeps the selenite-earned to next-rank-cost ratio at or above 1.25 for
  // twenty prestiges, behind a lower wall than the alternatives measured.
  prestigeThresholdGrowth: 1.5,
  prestigeSeleniteDivisorGrowth: 1.25,
  prestigeSeleniteExponent: 0.75,
  pityEncounterThreshold: 12,
  pityWeightMultiplier: 6,
  recentSpinHistoryLength: 8,
  encounterHistoryLength: 40,
  launchTransitionMs: 800,
  rewardTransitionMs: 900,
  feedbackDurationMs: 3_500,
  feedbackErrorDurationMs: 6_000,
  feedbackMaxVisible: 3,
  rewardPopDurationMs: 1_600,
  autoContinueMinimumRatio: 0.1,
  logMaxEntries: 50,
  jukeboxUnlockDepth: 250,
  pickaxeStrikeIntervalMs: 400,
  pickaxeCritMultiplier: 2,
  /** How long a critical-strike indicator stays on the scene. */
  criticalPopDurationMs: 700,
  encounterDissolveMs: 450,
  machineCuesPerTick: 3,
  // 1 in 3. The shallow pool needs seven entries to sustain this rate; a
  // three-deep pool would be exhausted within an hour.
  expeditionModifierChance: 1 / 3,
  catEncounterChance: 0.001,
  catPauseWallMs: 3_000,
  luckPerCat: 25,
};
