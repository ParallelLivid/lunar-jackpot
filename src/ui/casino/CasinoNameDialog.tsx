/**
 * Naming the casino: the prompt after the introduction, and the rename after
 * that. One component with a `mode`, since the two are the same dialogue with a
 * different starting value and a different way out.
 *
 * It borrows `.tutorial-notice` for its frame, because it arrives when the
 * opening act finishes and is part of the same beat — the second and last modal
 * in normal play.
 *
 * The prompt commits rather than cancels: Escape and the backdrop take the
 * suggestion, since leaving the name null would reopen this on the next render.
 * The rename has a real Cancel, because there is already a name to keep.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { suggestCasinoName } from "../../content/casinoNames";
import { MAXIMUM_CASINO_NAME } from "../../domain/state";
import { ActionButton } from "../shared/Panel";
import { useDispatch } from "../layout";

interface CasinoNameDialogProps {
  /**
   * `"prompt"` is the once-per-save introduction; `"rename"` is the player
   * coming back to it from the floor's heading.
   */
  mode: "prompt" | "rename";
  /** The name to start the field at, or null when there is not one yet. */
  currentName: string | null;
  onClose: () => void;
}

export function CasinoNameDialog({ mode, currentName, onClose }: CasinoNameDialogProps) {
  const dispatch = useDispatch();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Drawn once on mount and shown in the field rather than substituted behind
  // the player's back, which is also why the reducer needs no randomness.
  const [suggestion] = useState(() => suggestCasinoName());
  const [draft, setDraft] = useState(currentName ?? "");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (name: string): void => {
    dispatch({ type: "SET_CASINO_NAME", name });
    onClose();
  };

  /** What a bare Enter or a dismissal means, which differs by entry point. */
  const settle = (): void => {
    if (mode === "rename") {
      onClose();

      return;
    }

    commit(draft.trim().length === 0 ? suggestion : draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      settle();

      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    // The same trap the tutorial notice keeps: a dialogue that blocks the mouse
    // and lets the keyboard wander behind it is not really a modal.
    const focusable = frameRef.current?.querySelectorAll<HTMLElement>("button, input");

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
      <div className="tutorial-backdrop" onClick={settle} />
      <div
        className="tutorial-notice casino-name"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "prompt" ? "Name your casino" : "Rename your casino"}
        tabIndex={-1}
        ref={frameRef}
        onKeyDown={onKeyDown}
      >
        <p className="tutorial-notice__meta">
          <span className="tutorial-notice__from">OPERATIONS</span>
          <span className="tutorial-notice__position">
            {mode === "prompt" ? "Registration" : "Amendment"}
          </span>
        </p>

        <h2 className="tutorial-notice__title">
          {mode === "prompt" ? "The floor needs a trading name" : "Rename the floor"}
        </h2>

        <p className="tutorial-notice__body">
          {mode === "prompt"
            ? "The facility requires a trading name for the register. You may choose it yourself; the Company has prepared one in case you would rather not."
            : "The register can be amended. The Company keeps every previous entry, of course, but the sign will say whatever you put here."}
        </p>

        <label className="casino-name__field">
          <span className="sr-only">Casino name</span>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={MAXIMUM_CASINO_NAME}
            placeholder={suggestion}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();

                if (draft.trim().length > 0) {
                  commit(draft);
                } else if (mode === "prompt") {
                  commit(suggestion);
                }
              }
            }}
          />
        </label>

        <div className="tutorial-notice__actions">
          <ActionButton
            className="action--primary"
            disabledReason={draft.trim().length === 0 ? "A casino needs a name." : null}
            onClick={() => {
              commit(draft);
            }}
          >
            {mode === "prompt" ? "Register it" : "Save"}
          </ActionButton>
          {mode === "prompt" ? (
            <ActionButton
              onClick={() => {
                commit(suggestion);
              }}
            >
              Let the Company choose
            </ActionButton>
          ) : (
            <ActionButton onClick={onClose}>Cancel</ActionButton>
          )}
        </div>
      </div>
    </>
  );
}
