import type { PropsWithChildren, ReactNode } from "react";
import { useFitScale } from "./useFitScale";
import type { ActionAvailability } from "../../domain/selectors";

interface PanelProps extends PropsWithChildren {
  className?: string;
  title: string;
  /**
   * What the heading shows, when that differs from what the panel is called.
   * `title` stays the accessible name and the stable handle — end-to-end tests
   * address the floor as `region "Casino Floor"`, and the one-window-mode effect
   * looks windows up by label — so a player-chosen name must not rename the
   * region. `title` is identity, `heading` is display; only the floor passes one.
   */
  heading?: ReactNode;
  /** Rendered on the heading row, for compact status or toggles. */
  actions?: ReactNode;
  /**
   * Shrink the body's contents to fit rather than scrolling them. Off by
   * default, and deliberately off for the log and the cache-opening window: both
   * hold a history whose length is the point.
   */
  fit?: boolean;
  /**
   * Lay the contents out wide enough that shrinking them fills the panel. Only
   * meaningful with `fit`: without it a scaled panel leaves its right-hand edge
   * blank. See `.panel__fit--fill` for why this is opt-in.
   */
  fill?: boolean;
  /**
   * How far this panel's contents may be shrunk before it scrolls instead,
   * defaulting to the shared `FIT_SCALE_FLOOR`. The expedition panel passes a
   * lower one: its fixed encounter box takes its natural height to 374px, which
   * needs 0.523 at 1440x700 and 0.547 at 1280x720, both under the shared 0.55.
   *
   * Falling through the floor hands back the full size and a scrollbar rather
   * than shrinking further, so without this the reserved box would trade a
   * resizing panel for a scrolling one.
   */
  fitFloor?: number;
  /**
   * Marks this panel as something a tutorial card can point at. A data attribute
   * rather than a class, so the handle is not also a style hook. See `TutorialCard`.
   */
  anchorId?: string;
}

export function Panel({
  actions,
  anchorId,
  children,
  className = "",
  fill = false,
  fit = false,
  fitFloor,
  heading,
  title,
}: PanelProps) {
  const { atFloor, containerRef, contentRef } = useFitScale(fit, fitFloor);

  if (!fit) {
    return (
      <section
        className={`panel ${className}`.trim()}
        aria-label={title}
        data-tutorial-anchor={anchorId}
      >
        <div className="panel__header">
          <h2 className="panel__heading">{heading ?? title}</h2>
          {actions === undefined ? null : <div className="panel__actions">{actions}</div>}
        </div>
        <div className="panel__body">{children}</div>
      </section>
    );
  }

  return (
    <section
      className={`panel ${className}`.trim()}
      aria-label={title}
      data-tutorial-anchor={anchorId}
    >
      <div className="panel__header">
        <h2 className="panel__heading">{heading ?? title}</h2>
        {actions === undefined ? undefined : <div className="panel__actions">{actions}</div>}
      </div>
      {/*
        Two elements rather than one: the outer measures the space, the inner is
        what gets scaled. They cannot be the same box, because scaling a box
        would change the very size it is being measured against.

        `atFloor` gives the scroll back when the content could not be made to fit
        legibly — clipping content the player cannot reach would be worse than
        the scrollbar this is here to remove.
      */}
      <div
        className={`panel__body panel__body--fit${atFloor ? " panel__body--overflowing" : ""}`}
        ref={containerRef}
      >
        {/*
          No `style` here: `useFitScale` writes `--fit-scale` to this element
          itself. Both setting it would mean the hook's layout effect wiping the
          value React had just rendered, on a render React would then have no
          reason to repeat.
        */}
        <div
          className={`panel__fit${fill ? " panel__fit--fill" : ""}`}
          ref={contentRef}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

interface ActionButtonProps extends PropsWithChildren {
  onClick: () => void;
  availability?: ActionAvailability;
  /** Overrides `availability` when a control is disabled for another reason. */
  disabledReason?: string | null;
  className?: string;
  ariaLabel?: string;
  pressed?: boolean;
}

/**
 * A button that always explains why it is unavailable, through both its title
 * attribute and adjacent helper text supplied by the caller.
 */
export function ActionButton({
  ariaLabel,
  availability,
  children,
  className = "",
  disabledReason,
  onClick,
  pressed,
}: ActionButtonProps) {
  const reason = disabledReason ?? (availability?.available === false ? availability.reason : null);
  const disabled = reason !== null && reason !== undefined;

  return (
    <button
      type="button"
      className={`action ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={reason ?? undefined}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}

/**
 * A button that spends: what it buys on the first line, what it costs on the
 * second. The standard is one sentence — a button that spends is two lines, and
 * a button that does not is one line and a verb. Two lines carries both the
 * quantity and the price without a button wide enough to break a column.
 *
 * The two visible lines are read in order, so most need no override: "Buy one,
 * 500 cash" is already a sentence. A button whose first line is a quantity token
 * is not — "x10 → 11" does not read aloud — so those pass an `ariaLabel`.
 */
export function PriceButton({
  what,
  cost,
  availability,
  disabledReason,
  onClick,
  ariaLabel,
  className = "",
}: {
  /** What pressing this buys: a quantity, a target level, or a verb. */
  what: ReactNode;
  /** What it charges, currency named. */
  cost: ReactNode;
  availability?: ActionAvailability;
  disabledReason?: string | null;
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <ActionButton
      availability={availability}
      disabledReason={disabledReason}
      onClick={onClick}
      ariaLabel={ariaLabel}
      className={`action--priced ${className}`.trim()}
    >
      <span className="action__what">{what}</span>
      {/*
        A separator nobody sees and everybody hears.

        The two spans are flex items on separate lines, so they are separate to
        the eye and adjacent in the text: without this the button's `textContent`
        is `Level 2100 cash`, which is what a screen reader is handed when no
        `aria-label` overrides it.

        Its own class rather than `.sr-only`, and not for tidiness. The
        consumable tile already carries an `.sr-only` span for its flavour prose,
        and a second one inside its button makes `tile.locator(".sr-only")` match
        two elements. `.sr-only` means prose the eye does not need; a separator
        is punctuation. It is hidden by the same declarations.
      */}
      <span className="action__separator">, </span>
      <span className="action__cost">{cost}</span>
    </ActionButton>
  );
}

export function StatRow({
  label,
  value,
  next,
  title,
}: {
  label: string;
  value: ReactNode;
  next?: ReactNode;
  title?: string;
}) {
  return (
    <div className="stat-row" title={title}>
      <span className="stat-row__label">{label}</span>
      <span className="stat-row__value">
        {value}
        {next === undefined ? null : (
          <>
            <span className="stat-row__arrow" aria-hidden="true">
              {" -> "}
            </span>
            <span className="stat-row__next">{next}</span>
          </>
        )}
      </span>
    </div>
  );
}

/** Renders a stat as `base + bonus`, with each source named in the tooltip. */
export function StatValue({
  breakdown,
  unit = "",
  format = (value: number) => Math.round(value).toString(),
}: {
  breakdown: import("../../domain/selectors").StatBreakdownView;
  unit?: string;
  format?: (value: number) => string;
}) {
  if (breakdown.bonus === 0) {
    return (
      <span className="stat-value">
        {format(breakdown.base)}
        {unit}
      </span>
    );
  }

  const sign = breakdown.bonus > 0 ? "+" : "-";
  const title = breakdown.sources
    .map((source) => `${source.amount > 0 ? "+" : "-"}${format(Math.abs(source.amount))} ${source.label}`)
    .join(", ");

  return (
    <span className="stat-value" title={title}>
      {format(breakdown.base)}
      <span className="stat-value__bonus">
        {" "}
        {sign} {format(Math.abs(breakdown.bonus))}
      </span>
      {unit}
    </span>
  );
}

export function ProgressBar({
  ratio,
  label,
  tone = "neutral",
}: {
  ratio: number;
  label: string;
  tone?: "neutral" | "warning" | "positive";
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

  return (
    <div
      className={`progress progress--${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__fill" style={{ inlineSize: `${clamped * 100}%` }} />
    </div>
  );
}

/** Short helper text that states why an action is currently unavailable. */
export function DisabledNote({ availability }: { availability: ActionAvailability }) {
  if (availability.available || availability.reason === null) {
    return null;
  }

  return <p className="disabled-note">{availability.reason}</p>;
}

export function EmptyNote({ children }: PropsWithChildren) {
  return <p className="empty-note">{children}</p>;
}
