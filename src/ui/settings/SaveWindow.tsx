/** Save status, manual save, export, import, and full reset. */

import { useRef, useState } from "react";
import { ECONOMY } from "../../content/catalog";
import { formatCompact, formatDuration } from "../../domain/numbers";
import { useRuntime, useRuntimeStatus } from "../layout";
import { ActionButton } from "../shared/Panel";

function saveStateLabel(status: ReturnType<typeof useRuntimeStatus>): string {
  switch (status.saveState) {
    case "saving":
      return "Saving…";
    case "pending":
      return "Unsaved changes";
    case "error":
      return `Save failed: ${status.saveError ?? "unknown error"}`;
    case "saved":
      return status.lastSavedAtUnixMs === null
        ? "Saved"
        : `Saved ${new Date(status.lastSavedAtUnixMs).toLocaleTimeString("en-US")}`;
    default:
      return "Idle";
  }
}

export function SaveWindow() {
  const runtime = useRuntime();
  const status = useRuntimeStatus();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirming, setConfirming] = useState<"reset" | "import" | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const downloadExport = (): void => {
    const exported = runtime.exportSave();
    const blob = new Blob([exported.text], { type: exported.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exported.fileName;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Save exported.");
  };

  return (
    <div className="panel--save window-panel">
      <p className="window-panel__status" role="status" aria-live="polite">
        {status.leaseStatus === "writer" ? saveStateLabel(status) : "Read-only tab"}
      </p>

      <div className="button-row">
        <ActionButton
          onClick={() => {
            void runtime.saveNow();
          }}
        >
          Save now
        </ActionButton>
        <ActionButton onClick={downloadExport}>Export</ActionButton>
        <ActionButton
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          Import
        </ActionButton>
        <ActionButton
          onClick={() => {
            setConfirming("reset");
          }}
        >
          Full reset
        </ActionButton>
        {/*
          The tutorial's replay button was here while the Help window did not
          exist. It lives at the foot of Help's first topic now: the tutorial is
          the long-form explanation of the game, not a save operation, and Help is
          the window that holds those.
        */}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="sr-only"
        aria-label="Choose a save file to import"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";

          if (file === undefined) {
            return;
          }

          void file.text().then((text) => {
            setPendingImport(text);
            setConfirming("import");
          }).catch((error: unknown) => {
            setMessage(`Could not read the save file: ${String(error)}`);
          });
        }}
      />

      {message === null ? null : (
        <p className="description" role="status" aria-live="polite">
          {message}
        </p>
      )}

      {status.bootNotices.length === 0 ? null : (
        <ul className="chip-list">
          {status.bootNotices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      {status.welcomeBack === null ? null : (
        <div className="welcome-back" role="status" aria-live="polite">
          <p className="description">
            While you were away, your machines earned{" "}
            {formatCompact(status.welcomeBack.cashGranted)} cash over{" "}
            {Math.round(status.welcomeBack.creditedElapsedMs / 60_000)} minutes
            {/*
              Naming the cap rather than only noting that one exists. At ninety
              minutes it bites on any overnight gap, so "capped" alone leaves the
              player to guess how much time they were credited for.
            */}
            {status.welcomeBack.capped
              ? ` — offline earnings are capped at ${formatDuration(ECONOMY.offlineCapMs)}`
              : ""}
            .
          </p>
          <ActionButton
            onClick={() => {
              runtime.dismissWelcomeBack();
            }}
          >
            Dismiss
          </ActionButton>
        </div>
      )}

      {confirming === null ? null : (
        <div className="confirm" role="alertdialog" aria-label="Confirm destructive action">
          <p className="description">
            {confirming === "reset"
              ? "A full reset deletes all progress. Nothing is retained."
              : "Importing replaces your current game. Your current save is backed up first."}
          </p>
          <div className="button-row">
            <ActionButton
              className="action--primary"
              onClick={() => {
                if (confirming === "reset") {
                  void runtime.resetSave().then(() => {
                    setMessage("Save reset.");
                  }).catch((error: unknown) => {
                    setMessage(`Save reset failed: ${String(error)}`);
                  });
                } else if (pendingImport !== null) {
                  void runtime.importSave(pendingImport).then((outcome) => {
                    setMessage(outcome.message);
                  }).catch((error: unknown) => {
                    setMessage(`Save import failed: ${String(error)}`);
                  });
                }

                setConfirming(null);
                setPendingImport(null);
              }}
            >
              {confirming === "reset" ? "Delete everything" : "Replace my game"}
            </ActionButton>
            <ActionButton
              onClick={() => {
                setConfirming(null);
                setPendingImport(null);
              }}
            >
              Cancel
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}
