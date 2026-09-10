import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowId } from "../domain/selectors";
import { ExpeditionPanel } from "../ui/expedition/ExpeditionPanel";
import { GamblingPanel } from "../ui/gambling/GamblingPanel";
import { BetSettlement } from "../ui/gambling/BetSettlement";
import { CacheOpening } from "../ui/store/CacheOpening";
import { GearPanel } from "../ui/gear/GearPanel";
import { HelpWindow } from "../ui/help/HelpWindow";
import { TutorialCard } from "../ui/tutorial/TutorialCard";
import { JukeboxWindow } from "../ui/jukebox/JukeboxWindow";
import { CasinoColumn } from "../ui/layout/CasinoColumn";
import { CasinoNameDialog } from "../ui/casino/CasinoNameDialog";
import { GameRuntimeProvider, useDispatch, useGameState, useRuntimeStatus } from "../ui/layout";
import { currentTutorialStep, selectTutorialStep } from "../domain/tutorial";
import { UI_TUTORIAL_GATE_WINDOWS } from "../content/tutorial";
import type { HelpTopicId } from "../content/help";
import { unlockedRailEntries, WindowRail } from "../ui/layout/WindowRail";
import { MachinePanel } from "../ui/machines/MachinePanel";
import { PrestigePanel } from "../ui/prestige/PrestigePanel";
import { LogPanel } from "../ui/log/LogPanel";
import { ResourceBar } from "../ui/resources/ResourceBar";
import { SaveWindow } from "../ui/settings/SaveWindow";
import { SettingsWindow } from "../ui/settings/SettingsWindow";
import { SkinsWindow } from "../ui/skins/SkinsWindow";
import { StatSheetWindow } from "../ui/stats/StatSheetWindow";
import { StatsWindow } from "../ui/stats/StatsWindow";
import { StoreWindow } from "../ui/store/StoreWindow";
import { Window } from "../ui/shared/Window";
import { TotemPanel } from "../ui/totems/TotemPanel";
import { DevMenu } from "../dev/DevMenu";
import { DevPanel } from "../dev/devPanel";
import type { GameRuntime } from "./bootstrap";

/**
 * What each rail window renders. The context carries the Help topic a tutorial
 * card's "Read more" asked for; every other entry ignores it.
 */
interface WindowContext {
  requestedHelpTopicId: HelpTopicId | null;
}

const WINDOW_CONTENT: Record<WindowId, (context: WindowContext) => ReactNode> = {
  settings: () => <SettingsWindow />,
  save: () => <SaveWindow />,
  store: () => <StoreWindow />,
  gambling: () => <GamblingPanel />,
  prestige: () => <PrestigePanel />,
  gear: () => <GearPanel />,
  totems: () => <TotemPanel />,
  skins: () => <SkinsWindow />,
  statSheet: () => <StatSheetWindow />,
  stats: () => <StatsWindow />,
  jukebox: () => <JukeboxWindow />,
  help: (context) => <HelpWindow requestedTopicId={context.requestedHelpTopicId} />,
};

function Dashboard() {
  const status = useRuntimeStatus();
  // Which windows are open is presentation state and is not saved. Whether
  // several may be open at once is a preference, and that is.
  const state = useGameState();
  const singleWindowMode = state.settings.singleWindowMode;
  // The rail and the window layer filter the same list, so an import cannot
  // leave a locked window open from a stale `openWindows` entry.
  const entries = unlockedRailEntries(state);
  const dispatch = useDispatch();
  const [openWindows, setOpenWindows] = useState<WindowId[]>([]);
  // Which topic Help should show when something else opened it. Cleared on
  // close, so opening Help by hand later lands where the player left it.
  const [requestedHelpTopicId, setRequestedHelpTopicId] = useState<HelpTopicId | null>(null);
  const railButtons = useRef<Partial<Record<WindowId, HTMLButtonElement | null>>>({});
  /*
   * Naming the casino: once after the introduction, and whenever the player
   * asks. A null name means never asked. The prompt waits for the opening act
   * to finish — read or skipped — and for no notice to be showing, since both
   * are modal. A rename is the same dialogue and waits for nothing.
   */
  const [naming, setNaming] = useState<"rename" | null>(null);
  const casinoName = state.settings.casinoName;
  const introductionDone = state.onboarding.tutorial.completedActIds.includes("act.arrival");
  const promptDue = casinoName === null && introductionDone && selectTutorialStep(state) === null;
  const namingMode = naming ?? (promptDue ? "prompt" : null);


  // A replaced save takes its windows with it: the runtime bumps a counter on
  // prestige, reset and import, and any change to it closes the rail windows.
  const windowsClosedAt = useRuntimeStatus().windowsClosedAt;

  useEffect(() => {
    if (windowsClosedAt === 0) {
      return;
    }

    setOpenWindows([]);
    setRequestedHelpTopicId(null);
  }, [windowsClosedAt]);

  // Turning the preference on while several are open collapses them. The
  // focused window survives — the toggle lives in Settings, so keeping the most
  // recent would close the window the player is standing in — falling back to
  // the most recent when focus is elsewhere.
  useEffect(() => {
    if (!singleWindowMode) {
      return;
    }

    const focusedTitle = document.activeElement
      ?.closest<HTMLElement>('[role="dialog"]')
      ?.getAttribute("aria-label");
    const focused = entries.find((entry) => entry.title === focusedTitle);

    setOpenWindows((open) => {
      if (open.length <= 1) {
        return open;
      }

      return focused !== undefined && open.includes(focused.id)
        ? [focused.id]
        : open.slice(-1);
    });
  }, [singleWindowMode]);

  /*
   * The two tutorial gates the domain cannot see: open-the-gambling-window and
   * open-the-store both depend on React state the save does not hold, so
   * `isTutorialGateMet` returns false for them and the dashboard answers them
   * here. Continuously, not on the opening click, so a window that is already
   * open when the card appears still satisfies it. A third such gate belongs in
   * `UI_TUTORIAL_GATE_WINDOWS`.
   */
  useEffect(() => {
    // `currentTutorialStep`, not `selectTutorialStep`: a dismissed step is still
    // what the script waits for, and the presentation selector hides it.
    const step = currentTutorialStep(state)?.step;

    if (step === undefined || step.advance === "next") {
      return;
    }

    const windowId = UI_TUTORIAL_GATE_WINDOWS[step.advance];

    if (windowId !== undefined && openWindows.includes(windowId as WindowId)) {
      dispatch({ type: "ADVANCE_TUTORIAL", stepId: step.id });
    }
  }, [state, openWindows, dispatch]);

  const toggleWindow = (id: WindowId): void => {
    setOpenWindows((open) => {
      if (open.includes(id)) {
        return open.filter((entry) => entry !== id);
      }

      return singleWindowMode ? [id] : [...open, id];
    });
  };

  const closeWindow = (id: WindowId): void => {
    if (id === "help") {
      setRequestedHelpTopicId(null);
    }

    setOpenWindows((open) => open.filter((entry) => entry !== id));
  };

  /** Opens Help at a topic, from a tutorial card's "Read more". */
  const openHelpAt = (topicId: HelpTopicId): void => {
    setRequestedHelpTopicId(topicId);
    setOpenWindows((open) =>
      open.includes("help") ? open : singleWindowMode ? ["help"] : [...open, "help"],
    );
  };

  return (
    <main
      className="game-shell"
      data-read-only={status.leaseStatus === "reader"}
      // Lifts the window layer over the tutorial backdrop, but only while the
      // tutorial opened it, so "Read more" is not buried under its own notice.
      data-tutorial-help={requestedHelpTopicId !== null}
    >
      <h1 className="sr-only">Lunar Jackpot</h1>
      <div className="topbar">
        <ResourceBar />
        {/* The wrapper is what lets the log fill the row without sizing it. */}
        <div className="topbar__log">
          <LogPanel />
        </div>
      </div>
      {/*
        The floor and the litterbox are one cell of the dashboard grid, not two
        rows of it. The machine panel is the other cell of the same row, so the
        two are the same height whether or not there is a cat to show — where
        spanning two rows made the machine panel one row-gap taller every time
        the litterbox was empty.

        How the column divides between them is `CasinoColumn`'s own business.
      */}
      <CasinoColumn onRename={() => { setNaming("rename"); }} />
      <MachinePanel />
      <ExpeditionPanel />
      <WindowRail openWindows={openWindows} onToggle={toggleWindow} buttonRefs={railButtons} />

      <div className="window-layer">
        {entries.filter((entry) => openWindows.includes(entry.id)).map((entry) => (
          <Window
            key={entry.id}
            title={entry.title}
            className={entry.width === undefined ? "" : `window--${entry.width}`}
            fill={entry.fill === true}
            returnFocusTo={railButtons.current[entry.id] ?? null}
            onClose={() => {
              closeWindow(entry.id);
            }}
          >
            {WINDOW_CONTENT[entry.id]({ requestedHelpTopicId })}
          </Window>
        ))}
      </div>

      {/*
        Outside the window layer, and mounted whatever is on screen: a committed
        bet has already been paid for and must settle even if the player closes
        the window or switches to another game. It renders nothing.
      */}
      <BetSettlement />

      {/*
        Outside the window layer, like the settlement above: a batch of caches is
        already opened and granted by the time this renders, so closing the store
        window must not take the account of it away.
      */}
      <CacheOpening />

      {/*
        Last of the overlays, and the only modal in normal play.

        It draws over everything, the window layer included, which is the point:
        the notice is closed before the dashboard is touched. It lived inside the
        log's box until the product owner ruled it should block — and that
        version had to fit the row the resource bar sizes, which clipped its own
        text at some viewports and capped the writing at forty words.
      */}
      <TutorialCard onReadMore={openHelpAt} />

      {/*
        The second modal in normal play, and the last: it asks once per save, and
        after that it only opens when the player clicks their own name. Drawn
        after the tutorial card so a fresh save reads the introduction first.
      */}
      {namingMode === null ? null : (
        <CasinoNameDialog
          mode={namingMode}
          currentName={casinoName}
          onClose={() => {
            setNaming(null);
          }}
        />
      )}

      <DevPanel />
      {/*
        Last, and outside the window layer: it is not a rail window, it has no
        rail entry, and nothing in the normal tab order should reach it. The
        chord is the only way in.
      */}
      <DevMenu />
    </main>
  );
}

export function GameApp({ runtime }: { runtime: GameRuntime }) {
  useEffect(() => {
    // Browsers only allow audio after a gesture, so the context is unlocked on
    // the first interaction of any kind.
    const unlock = (): void => {
      runtime.unlockAudio();
    };

    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [runtime]);

  return (
    <GameRuntimeProvider runtime={runtime}>
      <Dashboard />
    </GameRuntimeProvider>
  );
}
