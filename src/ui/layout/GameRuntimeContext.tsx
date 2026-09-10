/** React access to the game runtime, state snapshot, and derived views. */

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import type { GameRuntime, RuntimeStatus } from "../../app/bootstrap";
import type { GameCommand } from "../../domain/commands";
import { deriveContext, type DerivedContext } from "../../domain/selectors";
import type { GameState } from "../../domain/state";

const RuntimeContext = createContext<GameRuntime | null>(null);

export function GameRuntimeProvider({
  runtime,
  children,
}: PropsWithChildren<{ runtime: GameRuntime }>) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): GameRuntime {
  const runtime = useContext(RuntimeContext);

  if (runtime === null) {
    throw new Error("useRuntime was called outside a GameRuntimeProvider.");
  }

  return runtime;
}

export function useGameState(): GameState {
  const runtime = useRuntime();

  return useSyncExternalStore(
    (listener) => runtime.subscribe(listener),
    () => runtime.getState(),
  );
}

export function useRuntimeStatus(): RuntimeStatus {
  const runtime = useRuntime();

  return useSyncExternalStore(
    (listener) => runtime.subscribeStatus(listener),
    () => runtime.getStatus(),
  );
}

export function useDispatch(): (command: GameCommand) => void {
  const runtime = useRuntime();

  return useMemo(() => (command: GameCommand) => {
    runtime.dispatch(command);
  }, [runtime]);
}

/** Modifier-aware context shared by every selector call in one render. */
export function useDerived(): DerivedContext {
  const state = useGameState();

  return useMemo(() => deriveContext(state), [state]);
}

/** True while this tab does not hold the writer lease. */
export function useReadOnly(): boolean {
  return useRuntimeStatus().leaseStatus !== "writer";
}
