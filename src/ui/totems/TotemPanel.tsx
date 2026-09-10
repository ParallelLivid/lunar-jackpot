import { ECONOMY, TOTEMS } from "../../content/catalog";
import { formatPercent } from "../../domain/numbers";
import { selectLoadoutView, selectTotemViews } from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { GradeBadge } from "../gear/GearPanel";
import { PixelSprite } from "../shared/PixelSprite";
import { ActionButton, EmptyNote, StatRow } from "../shared/Panel";

export function TotemPanel() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const totems = selectTotemViews(derived.state);
  const loadout = selectLoadoutView(derived);
  const owned = totems.filter((totem) => totem.owned);
  const slots = derived.state.collection.activeTotemIds;
  const duringRun = derived.state.expedition.status !== "surface";
  // The slots hold ids; the tiles want the view, which carries the grade and the
  // effect summary the tooltip needs.
  const equipped = new Map(totems.map((totem) => [totem.id, totem]));

  return (
    <div className="panel--totems window-panel">
      <p className="window-panel__status">Luck {Math.round(loadout.luckPoints)}</p>
      <StatRow
        label="Luck effect"
        value={formatPercent(loadout.luckFactor)}
        title="Diminishing-return curve applied to encounter and slot weights"
      />

      {/*
        The same tiles the gear panel uses for trinket slots, rather than three
        labelled rows with a Remove button each. Three rows of text for three
        icons was the widest thing in the window and read as a different game to
        the one next door; a totem in a slot is the same idea as a trinket in a
        slot, so it should look like one.

        A row's Remove button is gone with the row. Clicking an occupied tile is
        what clears it now, which is also how a trinket slot already worked.
      */}
      <ul className="slot-grid slot-grid--centred">
        {slots.map((totemId, index) => {
          const totem = totemId === null ? null : (equipped.get(totemId) ?? null);
          const position = `totem slot ${index + 1}`;
          const blocked = duringRun ? "Not while an expedition is under way." : null;

          return (
            <li key={index}>
              <button
                type="button"
                className={`slot-tile${totem === null ? " slot-tile--empty" : ""}`}
                aria-label={
                  totem === null
                    ? `Empty ${position}`
                    : `${totem.displayName}, grade ${totem.grade}, in ${position}. Removes it.`
                }
                title={
                  totem === null
                    ? "Empty. Equip a totem from the list below."
                    : (blocked ?? `${totem.displayName} — ${totem.effectSummary}`)
                }
                disabled={totem === null || blocked !== null}
                onClick={() => {
                  dispatch({ type: "EQUIP_TOTEM", slot: index, totemId: null });
                }}
              >
                {totem === null ? (
                  <span className="slot-tile__empty" aria-hidden="true">
                    +
                  </span>
                ) : (
                  <PixelSprite spriteId={totem.spriteId} scale={3} />
                )}
                <span className="slot-tile__index">{index + 1}</span>
                {totem === null ? null : <GradeBadge grade={totem.grade} />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="panel-section">
        <h4 className="subheading">Owned</h4>
        {owned.length === 0 ? (
          <EmptyNote>No totems yet. They come from opened caches.</EmptyNote>
        ) : (
          <ul className="option-list">
            {owned.map((totem) => {
              const firstFreeSlot = slots.indexOf(null);
              const alreadyActive = totem.activeSlot !== null;

              return (
                <li key={totem.id} className="option">
                  <PixelSprite
                    spriteId={TOTEMS[totem.id].spriteId}
                    scale={2}
                    label={totem.displayName}
                  />
                  <div className="option__body">
                    <span className="option__name">
                      {totem.displayName} <GradeBadge grade={totem.grade} />
                    </span>
                    <span className="option__detail">{totem.effectSummary}</span>
                    {totem.upgradeCost === null ? null : (
                      <span className="option__detail">
                        {totem.fragments}/{totem.upgradeCost} fragments toward Grade{" "}
                        {totem.nextGrade}
                      </span>
                    )}
                  </div>
                  <div className="button-row">
                    <ActionButton
                      disabledReason={
                        duringRun
                          ? "Not while an expedition is under way."
                          : alreadyActive
                            ? `Already in slot ${(totem.activeSlot ?? 0) + 1}.`
                            : firstFreeSlot === -1
                              ? `All ${ECONOMY.activeTotemSlots} slots are full.`
                              : null
                      }
                      onClick={() => {
                        dispatch({ type: "EQUIP_TOTEM", slot: firstFreeSlot, totemId: totem.id });
                      }}
                    >
                      Equip
                    </ActionButton>
                    <ActionButton
                      availability={totem.upgrade}
                      onClick={() => {
                        dispatch({ type: "UPGRADE_TOTEM", totemId: totem.id });
                      }}
                    >
                      {totem.upgradeCost === null
                        ? "Max rank"
                        : `Rank up (${totem.fragments}/${totem.upgradeCost})`}
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
