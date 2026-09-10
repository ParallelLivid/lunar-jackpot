/**
 * Where every number in the game comes from. Nothing here computes anything:
 * `selectStatSheetView` turns the walked modifier list into rows and this
 * renders them.
 *
 * A row with no contributions still appears, dimmed. Showing only modified stats
 * would change the sheet's shape as trinkets were equipped, and "why is critical
 * chance missing" is a worse question than "why is it zero".
 */

import { selectStatSheetView, type StatSheetRow } from "../../domain/selectors";
import { useDerived } from "../layout";
import { EmptyNote } from "../shared/Panel";

function StatRowCard({ row }: { row: StatSheetRow }) {
  return (
    <li className={`stat-sheet__row${row.unchanged ? " stat-sheet__row--unchanged" : ""}`}>
      <div className="stat-sheet__head">
        <span className="stat-sheet__label" title={row.detail ?? undefined}>
          {row.label}
        </span>
        <span className="stat-sheet__value">
          {/*
            Base and final together, because either alone is half the answer:
            the final value without the base hides how much of it was earned,
            and the base without the final is not what the run will use.
          */}
          {row.unchanged ? (
            row.valueText
          ) : (
            <>
              <span className="stat-sheet__base">{row.baseText}</span>
              <span className="stat-sheet__arrow" aria-hidden="true">
                {" -> "}
              </span>
              {row.valueText}
            </>
          )}
        </span>
      </div>

      {row.detail === null ? null : <p className="stat-sheet__detail">{row.detail}</p>}

      {row.contributions.length === 0 ? null : (
        <ul className="stat-sheet__sources">
          {row.contributions.map((contribution) => (
            <li key={contribution.key} className="stat-sheet__source">
              <span className="stat-sheet__source-name">
                {contribution.label}
                {contribution.qualifier === null ? null : (
                  <span className="stat-sheet__qualifier"> {contribution.qualifier}</span>
                )}
              </span>
              <span className="stat-sheet__effect">{contribution.effect}</span>
            </li>
          ))}
        </ul>
      )}

      <span className="sr-only">
        {row.label}: {row.unchanged ? `${row.valueText}, unmodified.` : `${row.baseText} base, ${row.valueText} in play.`}
        {row.contributions
          .map(
            (contribution) =>
              ` ${contribution.label}${
                contribution.qualifier === null ? "" : ` ${contribution.qualifier}`
              }, ${contribution.effect}.`,
          )
          .join("")}
      </span>
    </li>
  );
}

export function StatSheetWindow() {
  const view = selectStatSheetView(useDerived());

  return (
    <div className="panel--stat-sheet window-panel">
      <p className="window-panel__status">Everything currently changing a number</p>

      {view.snapshotNotice === null ? null : (
        <EmptyNote>{view.snapshotNotice}</EmptyNote>
      )}

      {/*
        Five groups side by side rather than stacked.

        `.stat-sheet-group` rather than `.panel-section`: the latter draws a top
        border to separate one section from the next in a column, which in a
        grid becomes a rule across the top of every group including the ones on
        the first row, where there is nothing above to separate from.
      */}
      <div className="stat-sheet-groups">
        {view.groups.map((group) => (
          <section key={group.title} className="stat-sheet-group">
            <h4 className="subheading">{group.title}</h4>
            <ul className="stat-sheet">
              {group.rows.map((row) => (
                <StatRowCard key={row.key} row={row} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
