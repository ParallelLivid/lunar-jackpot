/**
 * The running log.
 *
 * This replaces the floating strip that used to sit over the expedition panel:
 * nothing covers the game, and nothing is lost if the player looks away.
 * Transient, in-place feedback is handled by the reward indicators on the
 * expedition scene instead.
 */

import { useRuntimeStatus } from "../layout";
import { Panel } from "../shared/Panel";

function savedLabel(status: ReturnType<typeof useRuntimeStatus>): string {
  if (status.leaseStatus !== "writer") {
    return "Read-only tab";
  }

  switch (status.saveState) {
    case "saving":
      return "Saving…";
    case "pending":
      return "Unsaved changes";
    case "error":
      return "Save failed";
    case "saved":
      return status.lastSavedAtUnixMs === null
        ? "Saved"
        : `Saved ${new Date(status.lastSavedAtUnixMs).toLocaleTimeString("en-US")}`;
    default:
      return "Idle";
  }
}

export function LogPanel() {
  const status = useRuntimeStatus();

  return (
    <Panel
      className="panel--log"
      title="Log"
      actions={
        <span className="panel__status" role="status" aria-live="polite">
          {savedLabel(status)}
        </span>
      }
    >
      {status.log.length === 0 ? (
        <p className="empty-note">Nothing has happened yet.</p>
      ) : (
        <ul className="log-list">
          {status.log.map((entry) => (
            <li key={entry.id} className={`log-entry log-entry--${entry.tone}`}>
              <span className="log-entry__time">{entry.time}</span>
              <span className="log-entry__text">
                {entry.text}
                {entry.count > 1 ? (
                  <span className="log-entry__count"> x{entry.count}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
