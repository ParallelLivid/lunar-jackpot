import { useState } from "react";
import { formatCompact, formatDuration, formatRate } from "../../domain/numbers";
import { selectMachineView } from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { ActionButton, DisabledNote, Panel, PriceButton, StatRow, StatValue } from "../shared/Panel";

export function MachinePanel() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectMachineView(derived, derived.state.casino.selectedMachineId);

  /*
   * Whether either collapsible section is open, which decides between fitting
   * the panel and scrolling it.
   *
   * Closed, the panel is 331px of content in 388px of space at 1440x900, and
   * fitting is what keeps it from scrolling when a machine's numbers grow a
   * digit. Opening Research takes the content to 567px, which a fitted panel
   * answers by shrinking to 0.63 — shrinking the machine's own level and payout
   * along with the section just opened — and opening both scrolls anyway.
   *
   * So the fit follows the sections: a scrollbar is right for content the player
   * deliberately expanded and wrong for a panel that already fits. No CSS is
   * needed, since `.panel__body` is `overflow: auto` whenever a panel is unfitted.
   *
   * Presentation state, so it lives here rather than in the saved game.
   *
   * The `<details>` are controlled from it rather than merely reporting to it.
   * Switching `fit` changes the shape of the tree `Panel` renders — a fitted body
   * wraps its children in `.panel__fit` — so React remounts the children on the
   * very toggle that opens a section, and an uncontrolled `<details>` would come
   * back closed.
   */
  const [openSections, setOpenSections] = useState({ research: false, spec: false });
  const anySectionOpen = openSections.research || openSections.spec;

  return (
    <Panel className="panel--machines" title="Machine" anchorId="machines" fit={!anySectionOpen}>
      <h3 className="subheading">{view.unlocked ? view.displayName : "Locked position"}</h3>
      {/*
        Only the locked line survives.

        An unlocked machine's flavour description was here and repeated in prose
        what the stat rows below state in numbers, on the panel the player looks
        at most often. What a machine's four upgrade routes actually are is in
        the help window's "Machines" topic.

        The locked line is not flavour — it is the only place the game says how a
        machine is unlocked at all — so it stays.
      */}
      {view.unlocked ? null : (
        <p className="description">
          Recover {view.recipePiecesRequired} recipe pieces on expeditions to reveal this machine.
        </p>
      )}

      {view.unlocked ? (
        <>
          {/* Levels are uncapped, so there is no "of N" to show against. */}
          <StatRow label="Level" value={view.level} />
          {view.researchMultiplier > 1 ? (
            <StatRow
              label="Overclock"
              value={`x${formatCompact(view.researchMultiplier)}`}
              title="Total payout multiplier from researched ranks"
            />
          ) : null}
          <StatRow
            label={view.payoutIsAverage ? "Payout (avg)" : "Payout"}
            value={<StatValue breakdown={view.payoutBreakdown} format={formatCompact} />}
            next={
              view.nextLevel === null ? undefined : (
                <StatValue breakdown={view.nextLevel.payoutBreakdown} format={formatCompact} />
              )
            }
            title={
              view.payoutIsAverage
                ? "Average cash per completed cycle. This spec redraws its payout every cycle."
                : "Cash granted by one completed cycle"
            }
          />
          <StatRow
            label="Cycle"
            value={formatDuration(view.cycleMs)}
            title={
              view.flywheelRatio === null
                ? undefined
                : `Flywheel has wound this to ${Math.round(view.flywheelRatio * 100)}% of the base cycle`
            }
          />
          <StatRow label="Rate" value={`${formatRate(view.cashPerSecond)} cash/s`} />

          <div className="panel-section">
            <h4 className="subheading">Upgrade</h4>
            {view.nextLevel === null ? (
              <p className="empty-note">This machine is at its maximum level.</p>
            ) : (
              <>
                {/*
                  One level, ten, or a hundred.

                  A batch is all or nothing: it costs the sum of the single
                  purchases it replaces and is refused entire if any part cannot
                  be paid for, so the number on the button is always the number
                  of levels it buys. The costs come from the selector rather than
                  being multiplied here, because the curve is not linear and a
                  panel guessing at it would disagree with the charge.

                  Every one of them states its price. A bare `x10 → 11` with the
                  cost only in the `aria-label` is a quantity button that says
                  nothing about what it charges.

                  There is no `Level N cost` stat row above this: it would state
                  the single purchase's price, which is on the single purchase's
                  button, and a panel that says the same number twice within 14px
                  is arguing with itself.
                */}
                <div className="button-row">
                  {view.bulkLevels.map((batch) => (
                    <PriceButton
                      key={batch.quantity}
                      className={batch.quantity === 1 ? "action--primary" : ""}
                      availability={batch.purchase}
                      {...(batch.quantity === 1
                        ? {}
                        : {
                            /*
                              Only the batches: "Level 53, 106 cash" already reads
                              aloud, while "x10 → 62" does not read at all.
                            */
                            ariaLabel: `Buy ${String(batch.quantity)} levels, to level ${String(
                              batch.targetLevel,
                            )}, for ${formatCompact(batch.cashCost)} cash${
                              batch.componentCost > 0
                                ? ` and ${formatCompact(batch.componentCost)} components`
                                : ""
                            }`,
                          })}
                      onClick={() => {
                        dispatch({
                          type: "BUY_MACHINE_LEVEL",
                          machineId: view.id,
                          quantity: batch.quantity,
                        });
                      }}
                      /* `targetLevel` at quantity 1 is the next level, so the
                         single button needs no separate source for it. */
                      what={
                        batch.quantity === 1
                          ? `Level ${String(batch.targetLevel)}`
                          : `x${String(batch.quantity)} → ${String(batch.targetLevel)}`
                      }
                      /*
                        The component cost takes its own line rather than running
                        on after the cash. Measured at 1280x720: on one line the
                        batch buttons come to 364px in a 353px row and wrap in
                        two, taking the panel's fit scale to 0.775. Broken, all
                        three fit on one line.
                      */
                      cost={
                        batch.componentCost > 0 ? (
                          <>
                            {formatCompact(batch.cashCost)} cash
                            <br />+ {formatCompact(batch.componentCost)} components
                          </>
                        ) : (
                          `${formatCompact(batch.cashCost)} cash`
                        )
                      }
                    />
                  ))}
                </div>
                {/*
                  The single purchase explains itself; a x100 that is
                  unaffordable when x1 is not needs no line of its own, and three
                  notes stacked would be the panel arguing with itself.
                */}
                <DisabledNote availability={view.purchase} />
              </>
            )}
          </div>

          <details
            className="panel-section"
            open={openSections.research}
            onToggle={(event) => {
              const open = event.currentTarget.open;

              setOpenSections((sections) => ({ ...sections, research: open }));
            }}
          >
            <summary className="subheading subheading--summary">Research</summary>
            <ul className="option-list">
              {view.research.map((node) => (
                <li key={node.id} className="option">
                  <div className="option__body">
                    {/* The name already carries the rank it is offering. */}
                    <span className="option__name">{node.displayName}</span>
                    <span className="option__detail">{node.description}</span>
                  </div>
                  {node.chipCost === null ? (
                    <span className="option__state">
                      {node.repeatable ? `Rank ${node.rank} max` : "Researched"}
                    </span>
                  ) : (
                    /*
                      "Buy", not the rank and not "Research". Not the rank,
                      because the row beside it already reads "Overclock II". Not
                      "Research", which is the name of the section these rows sit
                      in, so the panel would hold a Research section full of
                      Research buttons.
                    */
                    <PriceButton
                      availability={node.purchase}
                      onClick={() => {
                        dispatch({ type: "RESEARCH_NODE", nodeId: node.id });
                      }}
                      ariaLabel={`Research ${node.displayName}, ${formatCompact(node.chipCost)} chips`}
                      what="Buy"
                      cost={`${formatCompact(node.chipCost)} chips`}
                    />
                  )}
                </li>
              ))}
            </ul>
          </details>

          <details
            className="panel-section"
            open={openSections.spec}
            onToggle={(event) => {
              const open = event.currentTarget.open;

              setOpenSections((sections) => ({ ...sections, spec: open }));
            }}
          >
            <summary className="subheading subheading--summary">Spec</summary>
            {/*
              One spec at a time, switching is free, and what a switch keeps or
              resets is in the help window's "Machines" topic. The Active/Use
              buttons already show that exactly one is on, and the rest is a rule
              about the system rather than about this machine.
            */}
            <ul className="option-list">
              <li className="option">
                <div className="option__body">
                  <span className="option__name">Standard</span>
                  <span className="option__detail">No tradeoff applied.</span>
                </div>
                <ActionButton
                  pressed={view.specs.every((spec) => !spec.active)}
                  onClick={() => {
                    dispatch({ type: "SET_MACHINE_SPEC", machineId: view.id, specId: null });
                  }}
                >
                  {view.specs.every((spec) => !spec.active) ? "Active" : "Use"}
                </ActionButton>
              </li>
              {view.specs.map((spec) => (
                <li key={spec.id} className="option">
                  <div className="option__body">
                    <span className="option__name">{spec.displayName}</span>
                    <span className="option__detail">{spec.description}</span>
                  </div>
                  <ActionButton
                    pressed={spec.active}
                    disabledReason={spec.researched ? null : "Needs research first."}
                    onClick={() => {
                      dispatch({ type: "SET_MACHINE_SPEC", machineId: view.id, specId: spec.id });
                    }}
                  >
                    {spec.active ? "Active" : "Use"}
                  </ActionButton>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <div className="panel-section">
          <StatRow
            label="Recipe pieces"
            value={`${view.recipePieces} / ${view.recipePiecesRequired}`}
          />
          <ActionButton
            className="action--primary"
            availability={view.unlockAction}
            onClick={() => {
              dispatch({ type: "UNLOCK_MACHINE", machineId: view.id });
            }}
          >
            Install machine
          </ActionButton>
          <DisabledNote availability={view.unlockAction} />
        </div>
      )}
    </Panel>
  );
}
