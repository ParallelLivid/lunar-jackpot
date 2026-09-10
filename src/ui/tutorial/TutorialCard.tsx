/**
 * The tutorial notice: a modal dialogue the player closes before carrying on,
 * and the only modal in normal play. Everything else — the rail windows, the
 * run summary — stays non-modal.
 *
 * Closing and advancing are different actions. Some cards wait for the player to
 * do something on the dashboard, which a modal is precisely what prevents, so a
 * waiting notice has Got it — closing it and leaving the step current, with the
 * next notice arriving when the gate latches — while a reading notice has Next.
 *
 * It is never a wall: tutorial state must never gate progression. Escape closes,
 * and nothing here is a prerequisite for anything.
 *
 * Skip is on every notice except the last card of an act that advances on Next,
 * where it would duplicate the primary. It stays on a last card that waits,
 * where the two still mean different things.
 *
 * The anchor is a class, not an overlay: a `.is-tutorial-target` outline toggled
 * on the anchored element rather than a ring measured with
 * `getBoundingClientRect`, which would need re-measuring on every resize,
 * fit-scale settle and panel reflow. A class cannot desynchronise from its
 * element.
 *
 * The focus trap, backdrop and moved focus are what a modal owes the keyboard.
 * `Window.tsx` implements none of the three, which is why this does not reuse it.
 */

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { HelpTopicId } from "../../content/help";
import { selectTutorialStep } from "../../domain/tutorial";
import { ActionButton } from "../shared/Panel";
import { useDispatch, useGameState } from "../layout";

interface TutorialCardProps {
  /**
   * Opens the help window at a topic. Passed in rather than dispatched, because
   * which windows are open is the dashboard's state and not the game's.
   */
  onReadMore: (topicId: HelpTopicId) => void;
}

export function TutorialCard({ onReadMore }: TutorialCardProps) {
  const state = useGameState();
  const active = selectTutorialStep(state);
  const dispatch = useDispatch();
  const anchor = active?.step.anchor ?? null;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stepId = active?.step.id ?? null;

  // The outline marks what the notice is talking about, behind the backdrop.
  // Applied to an element this component does not own, so it is an effect with a
  // cleanup rather than a prop threaded through five unrelated panels.
  useEffect(() => {
    if (anchor === null) {
      return;
    }

    const element = document.querySelector<HTMLElement>(`[data-tutorial-anchor="${anchor}"]`);

    element?.classList.add("is-tutorial-target");

    return () => {
      element?.classList.remove("is-tutorial-target");
    };
  }, [anchor]);

  // Focus follows the notice, so the keyboard is where the eye is.
  useEffect(() => {
    if (stepId !== null) {
      frameRef.current?.focus();
    }
  }, [stepId]);

  if (active === null) {
    return null;
  }

  const { act, step } = active;
  const waiting = step.advance !== "next";
  // The last card of this act. `position` and `total` are already on the view
  // for the "Arrival — 1 of 3" line, so this needs no new state.
  const last = step.position === step.total;

  const close = (): void => {
    dispatch({ type: "DISMISS_TUTORIAL_CARD", stepId: step.id });
  };

  // Tab is kept inside the notice: a dialogue that blocks the mouse and lets the
  // keyboard wander behind it strands anyone navigating by keyboard.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();

      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = frameRef.current?.querySelectorAll<HTMLElement>("button");

    if (focusable === undefined || focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/*
        The backdrop and the notice are siblings, not parent and child.
        
        Nested, the notice was trapped in the backdrop's stacking context and so
        could never rise above the highlighted panel, which sits between the two
        on purpose. The result was a notice with the casino floor drawn across
        it. Three layers, flat: dimming, the thing being pointed at, the notice.
      */}
      <div className="tutorial-backdrop" />
      <div
        className="tutorial-notice"
        data-step={step.id}
        role="dialog"
        aria-modal="true"
        // Named for what it is rather than by its heading, which changes with
        // every step and would leave the dialogue with no stable name.
        aria-label="Tutorial notice"
        aria-describedby="tutorial-notice-body"
        tabIndex={-1}
        ref={frameRef}
        onKeyDown={onKeyDown}
      >
        <p className="tutorial-notice__meta">
          <span className="tutorial-notice__from">
            {step.speaker === null ? "THE COMPANY" : step.speaker}
          </span>
          <span className="tutorial-notice__position">
            {act.title} — {step.position} of {step.total}
          </span>
        </p>

        <h2 className="tutorial-notice__title">
          {step.title}
        </h2>

        <p className="tutorial-notice__body" id="tutorial-notice-body">
          {step.body}
        </p>

        {/*
          Never on a waiting notice. That card is asking for one thing, and the
          thing is on the dashboard behind this — sending the player to the
          manual instead is a second errand in the middle of the first.
        */}
        {step.helpTopicId === undefined || waiting ? null : (
          <p className="tutorial-notice__more">
            <button
              type="button"
              className="tutorial-notice__link"
              onClick={() => {
                onReadMore(step.helpTopicId as HelpTopicId);
              }}
            >
              Read more in the manual
            </button>
          </p>
        )}

        {waiting ? <p className="tutorial-notice__hint">{step.hint}</p> : null}

        {/*
          Skip on the left, the primary on the right, at opposite ends of the
          row: crowded into the same corner they sat 9px apart, which is a
          misclick between "carry on" and "put this act away".

          Skip is first in the DOM as well as on screen, so the keyboard walks
          the row left to right like the eye. Nothing is defaulted either way —
          the notice focuses its own frame rather than a button — and the focus
          trap reads the buttons live, so first and last follow the DOM.
        */}
        <div className="tutorial-notice__actions">
          {/*
            Not on the last card of an act, unless that card is waiting.

            On a final reading card, Skip and the primary produce the same state:
            `SKIP_TUTORIAL` clears the act and appends it to `completedActIds`,
            and `advanceStep` past the last index does exactly that. Two buttons
            and one outcome, so the duplicate goes.

            A final waiting card keeps its Skip: there "Got it" only closes the
            notice and leaves the act open on its gate, so Skip is the one way to
            say "I am not going to do that". Two acts end that way
            (`act.arrival` on the first machine level, `act.payday` on opening
            the games), and without it the tutorial would be a wall.

            It skips this act, not the script. The accessible name states the
            scope, and the feedback line says it again: "Skipped: [act]. Later
            notices will still arrive."

            Turning the tutorial off entirely is a control in the Help window: a
            decision about the game rather than an answer to the notice in front
            of you.
          */}
          {waiting || !last ? (
            <ActionButton
              ariaLabel="Skip the rest of this tutorial topic"
              onClick={() => {
                dispatch({ type: "SKIP_TUTORIAL" });
              }}
            >
              Skip
            </ActionButton>
          ) : null}
          {waiting ? (
            // The only way past a waiting notice, and why dismissing exists at
            // all: what it asks for is on the dashboard, behind this.
            <ActionButton className="action--primary" onClick={close}>
              Got it
            </ActionButton>
          ) : (
            <ActionButton
              className="action--primary"
              onClick={() => {
                dispatch({ type: "ADVANCE_TUTORIAL", stepId: step.id });
              }}
            >
              {/*
                "Done" on the last card, because that is what it does: advancing
                off the final step closes the act. "Next" on a card with nothing
                after it is a promise the script cannot keep.
              */}
              {last ? "Done" : "Next"}
            </ActionButton>
          )}
        </div>
      </div>
    </>
  );
}
