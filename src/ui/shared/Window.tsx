/**
 * A non-modal window: no backdrop, the dashboard behind stays interactive, focus
 * is not trapped, and several may be open at once. That keeps the substance of
 * "no modal during routine play" while giving the secondary systems room the
 * grid could not spare.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { useFitScale } from "./useFitScale";

interface WindowProps {
  title: string;
  /**
   * Extra class for the frame. Windows are one width by default, which suits a
   * list of controls; wider frames exist for the layouts that need columns.
   */
  className?: string;
  onClose: () => void;
  /** Focused when the window closes, so keyboard users are not stranded. */
  returnFocusTo?: HTMLElement | null;
  actions?: ReactNode;
  children: ReactNode;
  /**
   * Shrink the body's contents to fit rather than scrolling them. On for the
   * rail windows; off for the cache-opening window, whose contents animate in
   * and would drive the fit every frame, and for the developer menu, which
   * manages its own height.
   */
  fit?: boolean;
  /**
   * Lay the contents out wide enough that shrinking them fills the frame. Only
   * meaningful with `fit`, and off by default: a box laid out at `100% / scale`
   * is wider than it looks, so an `auto-fit` grid inside one holds more columns
   * than the frame can legibly show. Each window answers that for itself.
   */
  fill?: boolean;
}

export function Window({
  actions,
  children,
  className = "",
  fill = false,
  fit = true,
  onClose,
  returnFocusTo,
  title,
}: WindowProps) {
  const { atFloor, containerRef, contentRef } = useFitScale(fit);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(returnFocusTo ?? null);

  returnFocusRef.current = returnFocusTo ?? returnFocusRef.current;

  useEffect(() => {
    frameRef.current?.focus();

    return () => {
      returnFocusRef.current?.focus();
    };
  }, []);

  return (
    <section
      className={`window ${className}`.trim()}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      ref={frameRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Stop here so one Escape closes one window rather than all of them.
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="window__header">
        <h2 className="window__title">{title}</h2>
        <div className="window__actions">
          {actions}
          <button
            type="button"
            className="window__close"
            onClick={onClose}
            aria-label={`Close ${title}`}
            title={`Close ${title}`}
          >
            <span aria-hidden="true">X</span>
          </button>
        </div>
      </header>
      {/*
        The same fit-or-scroll rule the dashboard panels use.
        
        A window whose content nearly fits is scaled and loses its scrollbar; one
        whose content cannot fit legibly — the Buffs sheet on a maxed save, or
        Statistics, both of which are unbounded lists — keeps its full size and
        its scrollbar rather than being shrunk *and* scrolled.
      */}
      {fit ? (
        <div
          className={`window__body window__body--fit${
            atFloor ? " window__body--overflowing" : ""
          }`}
          ref={containerRef}
        >
          <div
            className={`panel__fit${fill ? " panel__fit--fill" : ""}`}
            ref={contentRef}
          >
            {children}
          </div>
        </div>
      ) : (
        <div className="window__body">{children}</div>
      )}
    </section>
  );
}
