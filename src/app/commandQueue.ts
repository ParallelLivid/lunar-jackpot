/**
 * The serialized command queue: validate, calculate the next state, publish
 * once, then run non-authoritative effects. Rapid clicks cannot act twice
 * because the second command sees the state the first one produced.
 */

import type { DomainEffect, GameCommand } from "../domain/commands";
import { reduce } from "../domain/reducer";
import type { GameState } from "../domain/state";

export type StateListener = (state: GameState) => void;
export type EffectSink = (effects: DomainEffect[], command: GameCommand) => void;

export interface CommandQueueOptions {
  initialState: GameState;
  /** Non-authoritative side effects: sound, feedback, save requests. */
  onEffects: EffectSink;
  /**
   * Gate for material commands. A tab without the writer lease may still read
   * state but must not mutate it.
   */
  canDispatch?: (command: GameCommand) => boolean;
}

export interface CommandQueue {
  getState(): GameState;
  dispatch(command: GameCommand): void;
  subscribe(listener: StateListener): () => void;
  /** Used by bootstrap, import, and reset to install an externally built state. */
  replaceState(state: GameState): void;
}

export function createCommandQueue(options: CommandQueueOptions): CommandQueue {
  const listeners = new Set<StateListener>();
  const pending: GameCommand[] = [];

  let state = options.initialState;
  let draining = false;

  const publish = (): void => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const drain = (): void => {
    if (draining) {
      return;
    }

    draining = true;

    try {
      while (pending.length > 0) {
        const command = pending.shift() as GameCommand;

        if (options.canDispatch !== undefined && !options.canDispatch(command)) {
          // A blocked clock tick is expected in a read-only tab and is dropped
          // silently; only a player action is worth reporting.
          if (command.type !== "TICK") {
            options.onEffects(
              [
                {
                  type: "COMMAND_REJECTED",
                  command: command.type,
                  message: "This tab is read-only while another tab holds the save.",
                },
              ],
              command,
            );
          }

          continue;
        }

        const result = reduce(state, command);

        state = result.state;
        publish();
        options.onEffects(result.effects, command);
      }
    } finally {
      draining = false;
    }
  };

  return {
    getState() {
      return state;
    },

    dispatch(command) {
      pending.push(command);
      drain();
    },

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    replaceState(next) {
      state = next;
      publish();
    },
  };
}
