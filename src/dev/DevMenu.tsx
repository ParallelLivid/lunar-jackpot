/**
 * The developer menu. Unlike `DevPanel`, which is read-only diagnostics gated to
 * development builds, this ships in production and can hand the player anything.
 *
 * The chord is convenience, not security: the save is local IndexedDB and the
 * Save window exports it, so anyone wanting to edit their resources can already
 * do it in a text editor. What the chord buys is that a player who does not want
 * this never trips over it — no rail entry, no menu item, and nothing in the tab
 * order until it is open.
 *
 * Every edit is a `DEV_SET_STATE` command, so every value goes through the same
 * clamping and normalisation a loaded save does.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  GRADE_IDS,
  MACHINES,
  PERK_BRANCHES,
  PERK_BRANCH_IDS,
  MACHINE_IDS,
  PRESTIGE_PERKS,
  PRESTIGE_PERK_IDS,
  RESEARCH_NODES,
  RESOURCE_IDS,
  TOTEMS,
  TOTEM_IDS,
  TRINKETS,
  TRINKET_IDS,
} from "../content/catalog";
import type {
  GradeId,
  MachineId,
  PrestigePerkId,
  ResourceId,
  TotemId,
  TrinketId,
} from "../content/catalog";
import type { DevStatePatch } from "../domain/commands";
import { devMaximumMachineLevel, maxOutPatch } from "../domain/devEdits";
import { useDispatch, useGameState } from "../ui/layout";
import { ActionButton } from "../ui/shared/Panel";
import { Window } from "../ui/shared/Window";

/**
 * `Ctrl` + `Shift` + `Alt` + `D`. Three modifiers so it cannot be struck by
 * accident, and nothing in the app or a browser's defaults claims it.
 */
function isDevChord(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    event.altKey &&
    // `event.code` rather than `event.key`: with Alt held some layouts report a
    // composed character, and the chord is about the physical key.
    event.code === "KeyD"
  );
}

/** Toggles on the chord. Exported so the shortcut can be tested without the DOM. */
export function useDevMenuShortcut(): { open: boolean; close: () => void } {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isDevChord(event)) {
        return;
      }

      // Claimed first, so the chord never also triggers the focused control.
      event.preventDefault();
      setOpen((value) => !value);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return {
    open,
    close,
  };
}

/**
 * A number field that dispatches on commit rather than on every keystroke:
 * typing "500" through an onChange handler would dispatch 5, then 50, then 500.
 */
function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  // A value changed elsewhere has to win over a stale draft, or the panel starts
  // lying about the state it is editing.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(draft);

    if (Number.isFinite(parsed) && parsed !== value) {
      onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <label className="dev-field">
      <span className="dev-field__label">{label}</span>
      <input
        type="number"
        className="dev-field__input"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          }
        }}
      />
    </label>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="dev-section">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {title}
      </button>
      {open ? <div className="dev-section__body">{children}</div> : null}
    </section>
  );
}

function GradeSelect({
  grade,
  onChange,
}: {
  grade: GradeId;
  onChange: (next: GradeId) => void;
}) {
  return (
    <select
      className="dev-field__input"
      value={grade}
      aria-label="Grade"
      onChange={(event) => {
        onChange(event.target.value as GradeId);
      }}
    >
      {GRADE_IDS.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  );
}

export function DevMenu() {
  const { close, open } = useDevMenuShortcut();
  const state = useGameState();
  const dispatch = useDispatch();
  const underway = state.expedition.status !== "surface";

  /*
   * The chord asks the domain, and the domain answers in the log.
   * `OPEN_DEV_MENU` is refused while a run is in flight, and a refused command
   * becomes a feedback line and a log entry — which is how the reason reaches
   * the player rather than the menu simply failing to appear. The same command
   * records that the console has been seen, for the tutorial act about it.
   *
   * The close below is what keeps it shut. The check is duplicated between here
   * and the reducer on purpose: the domain owns the rule, and the interface has
   * to know it to avoid drawing something the rule forbids.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    dispatch({ type: "OPEN_DEV_MENU" });

    if (underway) {
      close();
    }
  }, [open, underway, close, dispatch]);

  if (!open || underway) {
    return null;
  }

  const send = (patch: DevStatePatch): void => {
    dispatch({ type: "DEV_SET_STATE", patch });
  };

  return (
    <div className="dev-menu-layer">
      <Window title="Developer" onClose={close} fit={false}>
        <div className="dev-menu">
          <p className="description">
            Edits go through the same validation a loaded save does, so an
            impossible value is repaired rather than stored. Press the shortcut
            again to close.
          </p>

          {/*
            One patch, one normalisation, one save. Fifteen separate edits would
            be fifteen of each, with fourteen intermediate states nobody wanted.

            Refused during a run: the patch cannot reach a run in flight, but it
            can relock a gear slot and change the gear a run has already
            snapshotted, and "my oxygen changed mid-descent" is a worse thing to
            debug than a disabled button.
          */}
          <ActionButton
            className="action--primary"
            disabledReason={
              state.expedition.status === "surface"
                ? null
                : "Not while an expedition is under way."
            }
            onClick={() => {
              send(maxOutPatch());
            }}
          >
            Max me out
          </ActionButton>
          <p className="description">
            Every resource, collectible, gear level, research rank and perk at its
            maximum. Machines go to level {devMaximumMachineLevel()}. A cap exists
            so the resource fields still show numbers worth reading rather than
            rolling straight over to INF; it is a level rather than an income
            budget, which is what used to hold this at 39.
          </p>
          {/*
            Said on the button rather than only in the code, because the absence
            is the feature: a button that quietly stopped setting something is
            the failure the machine level's own docstring warns about.
          */}
          <p className="description">
            It does not touch deepest depth, prestige count or cats found. Those
            record what this save has done rather than what it holds, and the
            fields under Progress are where they are edited.
          </p>

          <Section title="Resources">
            <div className="dev-grid">
              {RESOURCE_IDS.map((id) => (
                <NumberField
                  key={id}
                  label={id}
                  value={state.resources[id as ResourceId]}
                  onCommit={(next) => {
                    send({ resources: { [id as ResourceId]: next } });
                  }}
                />
              ))}
            </div>
          </Section>

          <Section title="Progress">
            <div className="dev-grid">
              <NumberField
                label="Cats found"
                value={state.statistics.catsFound}
                onCommit={(next) => {
                  send({ catsFound: next });
                }}
              />
              <NumberField
                label="Deepest depth"
                value={state.statistics.deepestDepth}
                onCommit={(next) => {
                  send({ deepestDepth: next });
                }}
              />
              <NumberField
                label="Prestiges"
                value={state.prestige.count}
                onCommit={(next) => {
                  send({ prestigeCount: next });
                }}
              />
              <NumberField
                label="Tank level"
                value={state.gear.tankLevel}
                onCommit={(next) => {
                  send({ tankLevel: next });
                }}
              />
              <NumberField
                label="Pickaxe level"
                value={state.gear.pickaxeLevel}
                onCommit={(next) => {
                  send({ pickaxeLevel: next });
                }}
              />
            </div>
          </Section>

          <Section title="Trinkets">
            <ul className="dev-menu__list">
              {TRINKET_IDS.map((id) => {
                const progress = state.collection.trinkets[id as TrinketId];

                return (
                  <li key={id} className="dev-row">
                    <label className="dev-row__toggle">
                      <input
                        type="checkbox"
                        checked={progress.owned}
                        onChange={(event) => {
                          send({ trinkets: { [id]: { owned: event.target.checked } } });
                        }}
                      />
                      <span>{TRINKETS[id as TrinketId].displayName}</span>
                    </label>
                    <GradeSelect
                      grade={progress.grade}
                      onChange={(grade) => {
                        send({ trinkets: { [id]: { owned: true, grade } } });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Totems">
            <ul className="dev-menu__list">
              {TOTEM_IDS.map((id) => {
                const progress = state.collection.totems[id as TotemId];

                return (
                  <li key={id} className="dev-row">
                    <label className="dev-row__toggle">
                      <input
                        type="checkbox"
                        checked={progress.owned}
                        onChange={(event) => {
                          send({ totems: { [id]: { owned: event.target.checked } } });
                        }}
                      />
                      <span>{TOTEMS[id as TotemId].displayName}</span>
                    </label>
                    <GradeSelect
                      grade={progress.grade}
                      onChange={(grade) => {
                        send({ totems: { [id]: { owned: true, grade } } });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Machines">
            <ul className="dev-menu__list">
              {MACHINE_IDS.map((id) => {
                const progress = state.casino.machines[id as MachineId];
                const overclockId = MACHINES[id as MachineId].researchNodeIds.find(
                  (nodeId) => RESEARCH_NODES[nodeId].displayName === "Overclock",
                );

                return (
                  <li key={id} className="dev-row">
                    <label className="dev-row__toggle">
                      <input
                        type="checkbox"
                        checked={progress.unlocked}
                        onChange={(event) => {
                          send({ machines: { [id]: { unlocked: event.target.checked } } });
                        }}
                      />
                      <span>{MACHINES[id as MachineId].displayName}</span>
                    </label>
                    <NumberField
                      label="Level"
                      value={progress.level}
                      onCommit={(next) => {
                        send({ machines: { [id]: { level: next } } });
                      }}
                    />
                    <NumberField
                      label="Pieces"
                      value={progress.recipePieces}
                      onCommit={(next) => {
                        send({ machines: { [id]: { recipePieces: next } } });
                      }}
                    />
                    {overclockId === undefined ? null : (
                      <NumberField
                        label="Overclock"
                        value={progress.researchRanks[overclockId] ?? 0}
                        onCommit={(next) => {
                          send({ machines: { [id]: { researchRanks: { [overclockId]: next } } } });
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>

          {/*
            Grouped by branch, in the order the prestige panel shows them. A flat
            list put the branches in declaration order and left the capstone in
            the middle of it, which is not where the tree says it belongs.
          */}
          <Section title="Perks">
            {PERK_BRANCH_IDS.map((branchId) => {
              const perks = PRESTIGE_PERK_IDS.filter(
                (id) => PRESTIGE_PERKS[id as PrestigePerkId].branch === branchId,
              );

              if (perks.length === 0) {
                return null;
              }

              return (
                <div key={branchId} className="dev-subsection">
                  <h5 className="dev-subsection__name">
                    {PERK_BRANCHES[branchId].displayName}
                  </h5>
                  <div className="dev-grid">
                    {perks.map((id) => {
                      const perk = PRESTIGE_PERKS[id as PrestigePerkId];

                      return (
                        <NumberField
                          key={id}
                          /*
                            A repeatable perk has no maximum, and its
                            `maximumRank` is a placeholder of 1 — so the label
                            says "no max" rather than printing it beside a field
                            that accepts any number. `devPerkRank` is a different
                            fact: what "max me out" happens to give it.
                          */
                          label={`${perk.displayName} (${
                            perk.repeatable === true
                              ? "no max"
                              : `max ${String(perk.maximumRank)}`
                          })`}
                          value={state.prestige.perkRanks[id as PrestigePerkId] ?? 0}
                          onCommit={(next) => {
                            send({ perkRanks: { [id as PrestigePerkId]: next } });
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Section>
        </div>
      </Window>
    </div>
  );
}
