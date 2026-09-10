/**
 * The lifetime statistics window: a record rather than a control surface, which
 * is why the rail never marks it for attention. All formatting is done by
 * `selectStatsView`, because how a number is written depends on the player's
 * number-format setting and this is where they are most likely to switch it.
 */

import { selectStatsView } from "../../domain/selectors";
import { useGameState } from "../layout";

export function StatsWindow() {
  const groups = selectStatsView(useGameState());

  return (
    <div className="window-panel stats-window">
      {groups.map((group) => (
        <section key={group.title} className="stats-group">
          <h4 className="subheading">{group.title}</h4>
          <dl className="stats-list">
            {group.entries.map((entry) => (
              <div key={entry.label} className="stats-row" title={entry.detail}>
                <dt className="stats-row__label">{entry.label}</dt>
                <dd className="stats-row__value">{entry.value}</dd>
                {entry.detail === undefined ? null : (
                  <dd className="stats-row__detail">{entry.detail}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
