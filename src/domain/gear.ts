/** Tank and pickaxe levels, trinket slots, equipment, and fragment upgrades. */

import { ECONOMY, GEAR, TRINKETS } from "../content/catalog";
import type { GearId, GearLevelDefinition, GradeId, TrinketId } from "../content/catalog";
import { gradeIndex, nextGrade } from "../content/grades";
import { evaluateStat, type Modifier } from "./modifiers";
import type { GameState, GearState, TrinketProgress } from "./state";
import { canAfford, type ResourceDelta, type TransactionPlan } from "./transactions";

export function gearLevelDefinition(gearId: GearId, level: number): GearLevelDefinition | null {
  return GEAR[gearId].levels.find((entry) => entry.level === level) ?? null;
}

export function maximumGearLevel(gearId: GearId): number {
  const levels = GEAR[gearId].levels;

  return levels[levels.length - 1].level;
}

export function gearLevel(state: GameState, gearId: GearId): number {
  return gearId === "tank" ? state.gear.tankLevel : state.gear.pickaxeLevel;
}

export function unlockedTrinketSlots(state: GameState, gearId: GearId): number {
  return gearLevelDefinition(gearId, gearLevel(state, gearId))?.unlockedTrinketSlots ?? 1;
}

export function trinketSlots(state: GameState, gearId: GearId): Array<TrinketId | null> {
  return gearId === "tank" ? state.gear.tankTrinketSlots : state.gear.pickaxeTrinketSlots;
}

function withTrinketSlots(
  gear: GearState,
  gearId: GearId,
  slots: Array<TrinketId | null>,
): GearState {
  return gearId === "tank"
    ? { ...gear, tankTrinketSlots: slots }
    : { ...gear, pickaxeTrinketSlots: slots };
}

/** Base tank oxygen before modifiers, in seconds. */
export function baseMaxOxygen(state: GameState): number {
  return gearLevelDefinition("tank", state.gear.tankLevel)?.statValue ?? GEAR.tank.levels[0].statValue;
}

export function basePickaxeDamage(state: GameState): number {
  return (
    gearLevelDefinition("pickaxe", state.gear.pickaxeLevel)?.statValue ??
    GEAR.pickaxe.levels[0].statValue
  );
}

export function selectMaxOxygen(state: GameState, modifiers: readonly Modifier[]): number {
  return evaluateStat(baseMaxOxygen(state), modifiers, { targetStat: "gear.tankOxygen" });
}

export function selectPickaxeDamage(state: GameState, modifiers: readonly Modifier[]): number {
  return evaluateStat(basePickaxeDamage(state), modifiers, { targetStat: "gear.pickaxeDamage" });
}

export function trinketProgress(state: GameState, trinketId: TrinketId): TrinketProgress | null {
  return state.collection.trinkets[trinketId] ?? null;
}

/** The slot a trinket currently occupies, or null when it is unequipped. */
export function equippedSlotOf(
  state: GameState,
  trinketId: TrinketId,
): { gearId: GearId; slotIndex: number } | null {
  for (const gearId of ["tank", "pickaxe"] as const) {
    const slotIndex = trinketSlots(state, gearId).indexOf(trinketId);

    if (slotIndex !== -1) {
      return { gearId, slotIndex };
    }
  }

  return null;
}

/** Fragments needed to move a trinket from its current grade to the next. */
export function trinketUpgradeCost(grade: GradeId): number | null {
  return ECONOMY.trinketFragmentCosts[gradeIndex(grade)] ?? null;
}

export type GearActionBlock =
  | { kind: "max-level" }
  | { kind: "insufficient-resources"; missing: ResourceDelta[] }
  | { kind: "expedition-active" }
  | { kind: "slot-locked"; requiredLevel: number | null }
  | { kind: "slot-out-of-range" }
  | { kind: "slot-empty" }
  | { kind: "incompatible-gear"; expected: GearId }
  | { kind: "not-owned" }
  | { kind: "max-grade" }
  | { kind: "insufficient-fragments"; available: number; required: number };

export type GearPlan =
  | { ok: true; plan: TransactionPlan }
  | { ok: false; block: GearActionBlock };

function expeditionIsActive(state: GameState): boolean {
  return state.expedition.status !== "surface";
}

/** The gear level at which a given slot index becomes usable. */
export function slotUnlockLevel(gearId: GearId, slotIndex: number): number | null {
  const level = GEAR[gearId].levels.find(
    (entry) => entry.unlockedTrinketSlots >= slotIndex + 1,
  );

  return level?.level ?? null;
}

export function planGearUpgrade(state: GameState, gearId: GearId): GearPlan {
  const currentLevel = gearLevel(state, gearId);
  const nextLevel = gearLevelDefinition(gearId, currentLevel + 1);

  if (nextLevel === null) {
    return { ok: false, block: { kind: "max-level" } };
  }

  const costs: ResourceDelta[] =
    nextLevel.relicCost > 0 ? [{ resource: "relics", amount: nextLevel.relicCost }] : [];

  if (!canAfford(state, costs)) {
    return {
      ok: false,
      block: {
        kind: "insufficient-resources",
        missing: costs.filter((cost) => state.resources[cost.resource] < cost.amount),
      },
    };
  }

  return {
    ok: true,
    plan: {
      label: `gear-level:${gearId}`,
      costs,
      grants: [],
      stateMutations: [
        (current) => ({
          ...current,
          gear:
            gearId === "tank"
              ? { ...current.gear, tankLevel: nextLevel.level }
              : { ...current.gear, pickaxeLevel: nextLevel.level },
        }),
      ],
    },
  };
}

/**
 * Seats a trinket in a slot. Because only one copy of each trinket exists, a
 * trinket already seated elsewhere moves rather than being refused.
 */
export function planEquipTrinket(
  state: GameState,
  gearId: GearId,
  slotIndex: number,
  trinketId: TrinketId,
): GearPlan {
  if (expeditionIsActive(state)) {
    return { ok: false, block: { kind: "expedition-active" } };
  }

  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= ECONOMY.trinketSlotsPerGear) {
    return { ok: false, block: { kind: "slot-out-of-range" } };
  }

  if (slotIndex >= unlockedTrinketSlots(state, gearId)) {
    return {
      ok: false,
      block: { kind: "slot-locked", requiredLevel: slotUnlockLevel(gearId, slotIndex) },
    };
  }

  const definition = TRINKETS[trinketId];

  if (definition === undefined || !state.collection.trinkets[trinketId]?.owned) {
    return { ok: false, block: { kind: "not-owned" } };
  }

  if (definition.targetGearId !== gearId) {
    return { ok: false, block: { kind: "incompatible-gear", expected: definition.targetGearId } };
  }

  const previous = equippedSlotOf(state, trinketId);

  return {
    ok: true,
    plan: {
      label: `equip:${gearId}:${slotIndex}:${trinketId}`,
      costs: [],
      grants: [],
      stateMutations: [
        (current) => {
          let gear = current.gear;

          // Vacate the old position first, so a move never duplicates the item.
          if (previous !== null) {
            const oldSlots = [...trinketSlots({ ...current, gear }, previous.gearId)];
            oldSlots[previous.slotIndex] = null;
            gear = withTrinketSlots(gear, previous.gearId, oldSlots);
          }

          const nextSlots = [...trinketSlots({ ...current, gear }, gearId)];
          nextSlots[slotIndex] = trinketId;

          return { ...current, gear: withTrinketSlots(gear, gearId, nextSlots) };
        },
      ],
    },
  };
}

export function planUnequipTrinket(
  state: GameState,
  gearId: GearId,
  slotIndex: number,
): GearPlan {
  if (expeditionIsActive(state)) {
    return { ok: false, block: { kind: "expedition-active" } };
  }

  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= ECONOMY.trinketSlotsPerGear) {
    return { ok: false, block: { kind: "slot-out-of-range" } };
  }

  if (trinketSlots(state, gearId)[slotIndex] === null) {
    return { ok: false, block: { kind: "slot-empty" } };
  }

  return {
    ok: true,
    plan: {
      label: `unequip:${gearId}:${slotIndex}`,
      costs: [],
      grants: [],
      stateMutations: [
        (current) => {
          const nextSlots = [...trinketSlots(current, gearId)];
          nextSlots[slotIndex] = null;

          return { ...current, gear: withTrinketSlots(current.gear, gearId, nextSlots) };
        },
      ],
    },
  };
}

/**
 * Spends fragments to raise a trinket one grade. The item stays equipped where
 * it is; only its grade changes, so the loadout never has to be rebuilt.
 */
export function planUpgradeTrinket(state: GameState, trinketId: TrinketId): GearPlan {
  const progress = state.collection.trinkets[trinketId];

  if (TRINKETS[trinketId] === undefined || progress === undefined || !progress.owned) {
    return { ok: false, block: { kind: "not-owned" } };
  }

  const upgraded = nextGrade(progress.grade);

  if (upgraded === null) {
    return { ok: false, block: { kind: "max-grade" } };
  }

  const required = trinketUpgradeCost(progress.grade);

  if (required === null) {
    return { ok: false, block: { kind: "max-grade" } };
  }

  if (progress.fragments < required) {
    return {
      ok: false,
      block: { kind: "insufficient-fragments", available: progress.fragments, required },
    };
  }

  return {
    ok: true,
    plan: {
      label: `upgrade-trinket:${trinketId}`,
      costs: [],
      grants: [],
      inventoryMutations: [{ kind: "trinketFragments", trinketId, delta: -required }],
      stateMutations: [
        (current) => ({
          ...current,
          collection: {
            ...current.collection,
            trinkets: {
              ...current.collection.trinkets,
              [trinketId]: { ...current.collection.trinkets[trinketId], grade: upgraded },
            },
          },
        }),
      ],
    },
  };
}

/**
 * Empties slots that the current gear level no longer unlocks. Items are not
 * destroyed; they simply become available in the collection again.
 */
export function releaseRelockedSlots(state: GameState): GameState {
  let gear = state.gear;

  for (const gearId of ["tank", "pickaxe"] as const) {
    const unlocked = unlockedTrinketSlots({ ...state, gear }, gearId);
    const slots = gearId === "tank" ? gear.tankTrinketSlots : gear.pickaxeTrinketSlots;
    const nextSlots = slots.map((trinketId, index) => (index < unlocked ? trinketId : null));
    gear = withTrinketSlots(gear, gearId, nextSlots);
  }

  return { ...state, gear };
}
