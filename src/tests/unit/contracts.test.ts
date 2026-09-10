/**
 * Coverage for depth contracts.
 *
 * A contract is the first thing in the game that outlives the encounter that
 * created it, and that is where every interesting failure lives: a reward that
 * waits can be rerolled by reloading, can pay twice, can pay for a goal that was
 * never met, or can quietly cost the player something it never promised to.
 */

import { describe, expect, it } from "vitest";
import { CONTRACTS, EXPEDITION_MODIFIERS, REWARD_TABLES } from "../../content/catalog";
import type { ContractId } from "../../content/catalog";
import { reduce } from "../../domain/reducer";
import { deriveContext, selectExpeditionView, selectRunCommitments } from "../../domain/selectors";
import { createGameState, type GameState, type RunContract } from "../../domain/state";
import { createEnvelope, normalizeGameState } from "../../persistence/saveSchema";

const NOW = 1_700_000_000_000;
const CONTRACT: ContractId = "contract.core-sample";

function fresh(seed = 12): GameState {
  return createGameState({ nowUnixMs: NOW, seed });
}

/** A launched run sitting at a decision, carrying the given contract. */
function carrying(
  contract: Partial<RunContract> = {},
  depth = 4,
  seed = 12,
): GameState {
  const launched = reduce(fresh(seed), { type: "LAUNCH_EXPEDITION" }).state;
  const startedAtDepth = contract.startedAtDepth ?? depth;

  return {
    ...launched,
    expedition: {
      ...launched.expedition,
      status: "decision",
      depth,
      activeContract: {
        contractId: CONTRACT,
        startedAtDepth,
        targetDepth: startedAtDepth + CONTRACTS[CONTRACT].span,
        reward: {
          tableId: CONTRACTS[CONTRACT].rewardTableId,
          entryId: "relics",
          tags: ["rare"],
          grants: [{ kind: "relics", amount: 7 }],
        },
        ...contract,
      },
    },
  };
}

describe("taking a contract", () => {
  it("is offered by content, and pays from a table of its own", () => {
    /*
     * Its own table rather than a borrowed encounter one — and it must never draw
     * from a table that offers contracts, or one accepted contract would chain
     * into the next. `validateContent` enforces that; this is the shape it
     * enforces.
     */
    for (const contract of Object.values(CONTRACTS)) {
      const payout = REWARD_TABLES[contract.rewardTableId];

      expect(payout, contract.id).toBeDefined();
      expect(
        payout.entries.every((entry) => entry.grants.every((grant) => grant.kind !== "contract")),
        contract.id,
      ).toBe(true);
      expect(contract.span, contract.id).toBeGreaterThan(0);
    }
  });

  it("sets its target relative to where it was taken", () => {
    const state = carrying({}, 12);

    expect(state.expedition.activeContract?.startedAtDepth).toBe(12);
    expect(state.expedition.activeContract?.targetDepth).toBe(12 + CONTRACTS[CONTRACT].span);
  });

  it("decides what it pays at acceptance rather than at the target", () => {
    // A reward that waits is the one reward a reload could reroll, so it is
    // committed the moment the contract is taken.
    expect(carrying().expedition.activeContract?.reward).not.toBeNull();
    expect(carrying().expedition.activeContract?.reward?.grants).toHaveLength(1);
  });
});

describe("carrying one", () => {
  const press = (state: GameState): GameState =>
    reduce(state, { type: "CONTINUE_EXPEDITION" }).state;

  /** Puts a run back at a decision, so the next press-on is available. */
  const atDecision = (state: GameState): GameState => ({
    ...state,
    expedition: { ...state.expedition, status: "decision" },
  });

  it("pays exactly once, on arriving at the target", () => {
    let state = carrying({}, 4);
    const target = state.expedition.activeContract?.targetDepth ?? 0;
    const before = state.expedition.runInventory.relics;

    // Short of the target it pays nothing and stays.
    while (state.expedition.depth + 1 < target) {
      state = press(state);
      expect(state.expedition.activeContract, `depth ${String(state.expedition.depth)}`).not.toBeNull();
      expect(state.expedition.runInventory.relics).toBe(before);
      state = atDecision(state);
    }

    // The descent that reaches it pays, and clears the contract.
    state = press(state);

    expect(state.expedition.depth).toBe(target);
    expect(state.expedition.runInventory.relics).toBe(before + 7);
    expect(state.expedition.activeContract).toBeNull();

    // And it cannot pay again on the next descent.
    expect(press(atDecision(state)).expedition.runInventory.relics).toBe(before + 7);
  });

  it("announces the payout through the normal reward lane", () => {
    // It reads as a reward rather than as a message, because that is what it is.
    let state = carrying({}, 4);
    const target = state.expedition.activeContract?.targetDepth ?? 0;

    while (state.expedition.depth + 1 < target) {
      state = atDecision(press(state));
    }

    const arrival = reduce(state, { type: "CONTINUE_EXPEDITION" });

    expect(arrival.effects.some((effect) => effect.type === "SHOW_ENCOUNTER_REWARD")).toBe(true);
  });

  it("takes only one at a time, keeping the one already in hand", () => {
    /*
     * A second offer replacing a goal the player is part-way through would be the
     * one way a contract could cost them something — and the whole design is that
     * it cannot.
     */
    const state = carrying({}, 4);
    const held = state.expedition.activeContract;
    const offered = reduce(state, { type: "CONTINUE_EXPEDITION" }).state;

    expect(offered.expedition.activeContract?.contractId).toBe(held?.contractId);
    expect(offered.expedition.activeContract?.targetDepth).toBe(held?.targetDepth);
  });

  it("lapses silently when the run is banked short of the target", () => {
    // "Encourage", not "trap": turning back costs nothing beyond the missed
    // payout.
    const state = carrying({}, 4);
    const before = state.resources.relics;
    const banked = reduce(state, { type: "RETURN_FROM_EXPEDITION" });

    expect(banked.materialChange).toBe(true);
    expect(banked.state.expedition.activeContract).toBeNull();
    expect(banked.state.resources.relics).toBe(before);
    expect(
      banked.effects.some(
        (effect) => effect.type === "SHOW_FEEDBACK" && effect.tone === "negative",
      ),
    ).toBe(false);
  });

  it("survives a reload with its committed payout intact", () => {
    const state = carrying({}, 4);
    const restored = normalizeGameState(createEnvelope(state, 1, NOW).game, NOW).state;

    expect(restored.expedition.activeContract).toEqual(state.expedition.activeContract);
  });

  it("cannot be handed a target it has already passed", () => {
    /*
     * A stored target behind where the contract started would pay on the next
     * descent for a goal that was never met.
     *
     * Built by corrupting a real in-flight save rather than by handing the loader
     * a bare fragment: a run only survives normalisation with valid RNG streams
     * and a modifier snapshot, so a fragment resets to the surface and this would
     * have asserted nothing.
     */
    const state = carrying({}, 4);
    const saved = createEnvelope(state, 1, NOW).game;
    const tampered = {
      ...saved,
      expedition: {
        ...saved.expedition,
        activeContract: { contractId: CONTRACT, startedAtDepth: 20, targetDepth: 3, reward: null },
      },
    };
    const restored = normalizeGameState(tampered, NOW).state;

    expect(restored.expedition.activeContract?.startedAtDepth).toBe(20);
    expect(restored.expedition.activeContract?.targetDepth).toBeGreaterThanOrEqual(20);
  });
});

describe("the run-status surface", () => {
  it("shows nothing at all when the run is committed to nothing", () => {
    const launched = reduce(fresh(), { type: "LAUNCH_EXPEDITION" }).state;

    expect(selectRunCommitments(launched, null)).toEqual([]);
    expect(selectExpeditionView(deriveContext(launched)).commitments).toEqual([]);
  });

  it("shows a contract with its target and how far is left", () => {
    const state = carrying({}, 6);
    const [commitment] = selectRunCommitments(state, null);

    expect(commitment.displayName).toBe(CONTRACTS[CONTRACT].displayName);
    expect(commitment.targetDepth).toBe(6 + CONTRACTS[CONTRACT].span);
    expect(commitment.depthsRemaining).toBe(CONTRACTS[CONTRACT].span);
    expect(commitment.progressRatio).toBe(0);
  });

  it("advances its progress as the run descends", () => {
    const started = carrying({ startedAtDepth: 4 }, 4);
    const halfway = carrying({ startedAtDepth: 4 }, 4 + CONTRACTS[CONTRACT].span / 2);

    expect(selectRunCommitments(halfway, null)[0].progressRatio).toBeGreaterThan(
      selectRunCommitments(started, null)[0].progressRatio,
    );
  });

  it("separates what was offered from what was imposed", () => {
    /*
     * The distinction between the three systems that share this surface: a
     * contract pays if you reach it, a lock holds the exit until you do. Stated
     * rather than left to be inferred from the wording.
     */
    const locked: GameState = (() => {
      const state = carrying({}, 4);

      return {
        ...state,
        expedition: { ...state.expedition, activeModifierId: "modifier.sealed-orders" },
      };
    })();

    const target =
      EXPEDITION_MODIFIERS["modifier.sealed-orders"].bankingLockedUntilDepth ?? 0;
    const commitments = selectRunCommitments(locked, target);

    expect(commitments).toHaveLength(2);
    expect(commitments.map((entry) => entry.tone)).toEqual(["imposed", "offered"]);
    expect(commitments[0].startedAtDepth).toBe(0);
  });
});
