/**
 * The help reference: a topic list beside one topic, and nothing that scrolls.
 *
 * `useFitScale` answers the no-scrollbars requirement elsewhere by shrinking a
 * panel's contents, which is not enough for a body of prose — shrinking text
 * past the fit floor makes it unreadable and still scrolls. So the body is a
 * column flow, and a topic that outgrows its frame is answered by splitting it,
 * which `validateContent` enforces with a length budget.
 *
 * The frame is `widest` and filled for the same reason: the columns need every
 * pixel the rail can spare.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  HELP_TOPICS,
  HELP_TOPIC_IDS,
  type HelpTopicId,
} from "../../content/help";
import { selectNextAction, type WindowId } from "../../domain/selectors";
import { ActionButton } from "../shared/Panel";
import { useDerived, useDispatch } from "../layout";
import { PixelSprite } from "../shared/PixelSprite";

/**
 * Which topic explains which rail window. Exhaustive over `WindowId` on purpose:
 * adding a rail window without deciding where it is documented should fail to
 * typecheck rather than ship a system nothing explains. Several windows share a
 * topic where they are really one subject — Statistics and Buffs are both
 * "reading the numbers".
 */
export const WINDOW_HELP_TOPICS: Record<WindowId, HelpTopicId> = {
  settings: "help.save",
  save: "help.save",
  store: "help.caches",
  gambling: "help.gambling",
  prestige: "help.prestige",
  gear: "help.gear",
  totems: "help.totems",
  skins: "help.cats",
  statSheet: "help.numbers",
  stats: "help.numbers",
  jukebox: "help.music",
  // The window explaining itself points at where to start.
  help: "help.company",
};

/**
 * The pane that is not a topic, and the one the window opens on. Not a
 * `HelpTopic`: its content is derived from the save rather than authored, so it
 * has no place in `HELP_TOPICS` and nothing for `validateContent` to check.
 * Everything else about it behaves as a topic does, which is why the selection
 * state widens rather than the window growing a second mode.
 */
export const NEXT_ACTION_PANE = "help.next-action";

export type HelpPaneId = HelpTopicId | typeof NEXT_ACTION_PANE;

/** The nav, in order. The recommendation first, then the reference. */
const HELP_PANE_IDS: HelpPaneId[] = [NEXT_ACTION_PANE, ...HELP_TOPIC_IDS];

interface HelpWindowProps {
  /**
   * A topic to jump to, set when something outside opened this window at one —
   * a tutorial card's "Read more". Null means the player opened Help themselves,
   * and they land on the recommendation.
   */
  requestedTopicId?: HelpTopicId | null;
}

export function HelpWindow({ requestedTopicId = null }: HelpWindowProps) {
  // Opening the window lands on "What to do next" unless something asked for a
  // topic. Rebuilt on every open rather than remembered: the window unmounts
  // when it closes, so there is no "wherever I left it" to fight with.
  const [selectedId, setSelectedId] = useState<HelpPaneId>(
    requestedTopicId ?? NEXT_ACTION_PANE,
  );
  const tabRefs = useRef<Partial<Record<HelpPaneId, HTMLButtonElement | null>>>({});
  const dispatch = useDispatch();
  const derived = useDerived();
  const nextAction = selectNextAction(derived);
  const tutorialRunning = derived.state.onboarding.tutorial.status === "running";
  const selected = selectedId === NEXT_ACTION_PANE ? null : HELP_TOPICS[selectedId];

  // A request arriving while the window is already open still moves it: the
  // initial state above only covers a fresh open, and with one-window mode off
  // Help can already be up when "Read more" is pressed.
  useEffect(() => {
    if (requestedTopicId !== null) {
      setSelectedId(requestedTopicId);
    }
  }, [requestedTopicId]);

  // Arrow keys move between topics, which is what a `tablist` promises. Only the
  // selected tab is in the tab order, so Tab crosses the whole list in one press
  // — the standard for this pattern, and why focus is moved by hand here.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : event.key === "Home"
            ? -HELP_PANE_IDS.length
            : event.key === "End"
              ? HELP_PANE_IDS.length
              : 0;

    if (step === 0) {
      return;
    }

    event.preventDefault();

    const index = HELP_PANE_IDS.indexOf(selectedId);
    const next =
      HELP_PANE_IDS[
        Math.min(HELP_PANE_IDS.length - 1, Math.max(0, index + step))
      ];

    setSelectedId(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="panel--help window-panel help-window">
      <ul className="help-nav" role="tablist" aria-orientation="vertical" aria-label="Help topics">
        {HELP_PANE_IDS.map((paneId) => {
          const open = paneId === selectedId;

          return (
            <li key={paneId}>
              <button
                type="button"
                role="tab"
                id={`help-tab-${paneId}`}
                aria-selected={open}
                aria-controls={`help-panel-${paneId}`}
                tabIndex={open ? 0 : -1}
                ref={(element) => {
                  tabRefs.current[paneId] = element;
                }}
                className={`help-tab${open ? " help-tab--open" : ""}`}
                onKeyDown={onTabKeyDown}
                onClick={() => {
                  setSelectedId(paneId);
                }}
              >
                <span className="help-tab__label">
                  {paneId === NEXT_ACTION_PANE ? "What to do next" : HELP_TOPICS[paneId].title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <section
        role="tabpanel"
        id={`help-panel-${selectedId}`}
        aria-labelledby={`help-tab-${selectedId}`}
        className="help-panel"
        /* For the end-to-end test that walks every topic looking for overflow. */
        data-topic={selectedId}
      >
        {selected === null ? (
          /*
            The recommendation the window opens on. Same shape as a topic —
            heading, summary, body — so the two panes read as one window. What
            differs is where the words come from: a topic is authored and
            budgeted, this is derived from the save every render.
          */
          <>
            <h3 className="subheading help-heading">
              <PixelSprite spriteId="sprite.help" scale={2} />
              <span>{nextAction.title}</span>
            </h3>
            <p className="description help-summary">{nextAction.body}</p>

            <p className="help-next-action__more">
              <ActionButton
                onClick={() => {
                  setSelectedId(nextAction.topicId);
                }}
              >
                Read about this
              </ActionButton>
            </p>

            {/*
              The tutorial controls, on the pane the window opens on.

              They were pinned to the first *topic* while that was where a player
              arrived. It is not any more, and "play it again" belongs beside
              "here is what to do next" rather than under four paragraphs about
              the Company.
            */}
            <p className="help-replay">
              <ActionButton
                onClick={() => {
                  dispatch({ type: "REPLAY_TUTORIAL" });
                }}
              >
                Play the tutorial again
              </ActionButton>
              {/*
                The only way to turn the script off entirely, since Skip means
                "skip this act".

                Here rather than on the card, because it is a decision about the
                game rather than a response to the notice in front of you — and
                because the reverse of it is the button beside it.
              */}
              {tutorialRunning ? (
                <ActionButton
                  onClick={() => {
                    dispatch({ type: "STOP_TUTORIAL" });
                  }}
                >
                  Stop showing these
                </ActionButton>
              ) : null}
            </p>
          </>
        ) : (
          <>
            {/*
              The icon sits on the topic rather than on every row of the index.

              It was on each of the seventeen tabs, and that is what made the
              window overflow: the nav column — not the prose — was the height
              driver, at 618px against a 229px topic body on a 700px-tall
              viewport. A tab strip is an index, and an index is text; one icon
              at full size on the thing you are actually reading says more than
              seventeen at half size.
            */}
            <h3 className="subheading help-heading">
              <PixelSprite spriteId={selected.spriteId} scale={2} />
              <span>{selected.title}</span>
            </h3>
            <p className="description help-summary">{selected.summary}</p>

            <dl className="help-body">
              {selected.entries.map((entry) => (
                <div className="help-entry" key={entry.term}>
                  <dt className="help-entry__term">{entry.term}</dt>
                  <dd className="help-entry__body">{entry.body}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
