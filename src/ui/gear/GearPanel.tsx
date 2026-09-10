import { useState } from "react";
import type { GearId, GradeId, TrinketId } from "../../content/catalog";
import { HIGHEST_GRADE, gradeIndex } from "../../content/grades";
import { formatPercent } from "../../domain/numbers";
import {
  selectGearView,
  selectLoadoutView,
  selectTrinketViews,
  type GearView,
  type TrinketView,
} from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { PixelSprite } from "../shared/PixelSprite";
import { ActionButton, DisabledNote, EmptyNote, PriceButton, StatRow, StatValue } from "../shared/Panel";

/** A duplicate is worth one fragment now, so "1 fragments" comes up constantly. */
function fragmentLabel(count: number): string {
  return `${count} ${count === 1 ? "fragment" : "fragments"}`;
}

/**
 * A grade shown as its letter. Pips do not survive eight steps in a slot tile,
 * so the top three grades are separated by weight and a doubled border, which
 * works without colour.
 */
export function GradeBadge({ grade }: { grade: GradeId }) {
  const high = gradeIndex(grade) >= gradeIndex("S");

  return (
    <span
      className={`grade-badge${high ? " grade-badge--high" : ""}`}
      aria-label={`Grade ${grade} of ${HIGHEST_GRADE}`}
    >
      {grade}
    </span>
  );
}

function GearCard({
  view,
  selectedTrinket,
  onSlotClick,
}: {
  view: GearView;
  selectedTrinket: TrinketView | null;
  onSlotClick: (gearId: GearId, slotIndex: number) => void;
}) {
  const dispatch = useDispatch();

  return (
    <article className="gear-card">
      <header className="gear-card__header">
        <PixelSprite spriteId={`sprite.gear.${view.id}`} scale={3} label={view.displayName} />
        <div>
          <h4 className="subheading">{view.displayName}</h4>
          <p className="description">{view.description}</p>
        </div>
      </header>

      <StatRow
        label={view.statLabel}
        value={<StatValue breakdown={view.statBreakdown} unit={view.statUnit} />}
        next={
          view.nextStatBreakdown === null ? undefined : (
            <StatValue breakdown={view.nextStatBreakdown} unit={view.statUnit} />
          )
        }
      />
      <StatRow label="Level" value={`${view.level} / ${view.maximumLevel}`} />

      {/*
        Two lines when there is something to spend, one when there is not.
        "Maximum level" is a state rather than a purchase, so it keeps the plain
        button: a button that spends states its price, and this has nothing left
        to charge.
      */}
      {view.relicCost === null ? (
        <ActionButton
          availability={view.upgrade}
          onClick={() => {
            dispatch({ type: "BUY_GEAR_LEVEL", gearId: view.id });
          }}
        >
          Maximum level
        </ActionButton>
      ) : (
        <PriceButton
          availability={view.upgrade}
          onClick={() => {
            dispatch({ type: "BUY_GEAR_LEVEL", gearId: view.id });
          }}
          what={`Level ${String(view.level + 1)}`}
          cost={`${String(view.relicCost)} relics`}
        />
      )}
      <DisabledNote availability={view.upgrade} />

      {view.nextSlotUnlockLevel === null ? null : (
        <p className="description">
          Next trinket slot unlocks at level {view.nextSlotUnlockLevel}.
        </p>
      )}

      <ul className="slot-grid">
        {view.slots.map((slot) => {
          const isTarget =
            selectedTrinket !== null &&
            slot.unlocked &&
            selectedTrinket.targetGearId === view.id;

          const label = slot.unlocked
            ? slot.displayName === null
              ? `Empty ${view.displayName} slot ${slot.index + 1}`
              : `${slot.displayName}, grade ${String(slot.grade)}, in ${view.displayName} slot ${slot.index + 1}`
            : `${view.displayName} slot ${slot.index + 1}, locked until level ${String(slot.requiredGearLevel)}`;

          return (
            <li key={slot.index}>
              <button
                type="button"
                className={`slot-tile${slot.unlocked ? "" : " slot-tile--locked"}${
                  isTarget ? " slot-tile--target" : ""
                }`}
                aria-label={label}
                title={slot.effectSummary ?? label}
                disabled={!slot.unlocked}
                onClick={() => {
                  onSlotClick(view.id, slot.index);
                }}
              >
                {slot.spriteId === null ? (
                  <span className="slot-tile__empty" aria-hidden="true">
                    {slot.unlocked ? "+" : "-"}
                  </span>
                ) : (
                  <PixelSprite spriteId={slot.spriteId} scale={3} />
                )}
                <span className="slot-tile__index">{slot.index + 1}</span>
                {slot.grade === null ? null : <GradeBadge grade={slot.grade} />}
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/**
 * The trinkets that fit one piece of gear, under that gear's own column. Split by
 * target rather than listed together, since a trinket only ever fits one of the
 * two. The groups share the two-column grid of the cards above them, so each
 * list sits directly under the gear it belongs to.
 */
function TrinketGroup({
  gear,
  onSelect,
  selected,
  trinkets,
}: {
  gear: GearView;
  onSelect: (trinketId: TrinketId) => void;
  selected: TrinketView | null;
  trinkets: TrinketView[];
}) {
  const dispatch = useDispatch();

  return (
    <section className="trinket-group">
      <h5 className="trinket-group__heading">{gear.displayName}</h5>
      {trinkets.length === 0 ? (
        <EmptyNote>None yet.</EmptyNote>
      ) : (
        <ul className="item-grid">
          {trinkets.map((trinket) => (
            <li key={trinket.trinketId}>
              <button
                type="button"
                className={`item-tile${
                  selected?.trinketId === trinket.trinketId ? " item-tile--selected" : ""
                }`}
                aria-pressed={selected?.trinketId === trinket.trinketId}
                // The fragment count lives here and nowhere else on the tile: the
                // button below already prints it, but this is the only place a
                // screen reader gets it.
                aria-label={`${trinket.displayName}, grade ${trinket.grade} of ${trinket.maximumGrade}, ${trinket.effectSummary}, ${fragmentLabel(trinket.fragments)}`}
                title={`${trinket.displayName} — ${trinket.effectSummary}`}
                onClick={() => {
                  onSelect(trinket.trinketId);
                }}
              >
                <PixelSprite spriteId={trinket.spriteId} scale={3} />
                <GradeBadge grade={trinket.grade} />
                {trinket.equippedSlot === null ? null : (
                  <span className="item-tile__equipped" aria-hidden="true">
                    E
                  </span>
                )}
              </button>
              <ActionButton
                className="item-tile__action"
                availability={trinket.upgrade}
                onClick={() => {
                  dispatch({ type: "UPGRADE_TRINKET", trinketId: trinket.trinketId });
                }}
              >
                {trinket.upgradeCost === null || trinket.nextGrade === null
                  ? "Max"
                  : `${trinket.fragments}/${trinket.upgradeCost} -> ${trinket.nextGrade}`}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function GearPanel() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const loadout = selectLoadoutView(derived);
  const trinkets = selectTrinketViews(derived.state);
  const owned = trinkets.filter((trinket) => trinket.owned);
  const gearIds: GearId[] = ["tank", "pickaxe"];
  // Resolved once for both rows, so the cards and the collection columns cannot
  // fall out of order.
  const gearViews = gearIds.map((gearId) => selectGearView(derived, gearId));

  // Which trinket is armed for placement. Presentational, so it is not saved.
  const [selectedId, setSelectedId] = useState<TrinketId | null>(null);
  const selected = owned.find((trinket) => trinket.trinketId === selectedId) ?? null;

  const handleSlotClick = (gearId: GearId, slotIndex: number): void => {
    const slot = selectGearView(derived, gearId).slots[slotIndex];

    if (selected !== null && selected.targetGearId === gearId) {
      dispatch({ type: "EQUIP_TRINKET", gearId, slot: slotIndex, trinketId: selected.trinketId });
      setSelectedId(null);

      return;
    }

    if (slot.trinketId !== null) {
      dispatch({ type: "UNEQUIP_TRINKET", gearId, slot: slotIndex });
    }
  };

  return (
    <div className="panel--gear window-panel">
      <p
        className="window-panel__status"
        title="Chance each unbanked unit is lost on oxygen failure"
      >
        Failure loss {formatPercent(loadout.failureLossChance, 0)}
      </p>
      <div className="gear-grid">
        {gearViews.map((view) => (
          <GearCard
            key={view.id}
            view={view}
            selectedTrinket={selected}
            onSlotClick={handleSlotClick}
          />
        ))}
      </div>

      <div className="panel-section">
        <h4 className="subheading">Collection</h4>
        {owned.length === 0 ? (
          <EmptyNote>
            No trinkets yet. Buy a key, find a cache on an expedition, then open it below.
          </EmptyNote>
        ) : (
          <>
            <p className="description">
              {selected === null
                ? "Pick a trinket, then pick a slot to fit it in."
                : `Pick a ${selected.targetGearId} slot for ${selected.displayName}, or pick it again to cancel.`}
            </p>
            <div className="gear-grid">
              {gearViews.map((view) => (
                <TrinketGroup
                  key={view.id}
                  gear={view}
                  trinkets={owned.filter((trinket) => trinket.targetGearId === view.id)}
                  selected={selected}
                  onSelect={(trinketId) => {
                    setSelectedId(selectedId === trinketId ? null : trinketId);
                  }}
                />
              ))}
            </div>
            {/*
              What is selected, under the grid it was selected from.

              Its own class only so it can be given room: flush against the row
              of upgrade buttons above, it reads as a fourth line of the last
              tile rather than a line about the whole selection.
            */}
            {selected === null ? null : (
              <p className="description trinket-detail">
                {selected.displayName}: {selected.effectSummary}
                {selected.nextEffectSummary === null
                  ? ` (Grade ${selected.maximumGrade}, the highest)`
                  : ` -> Grade ${String(selected.nextGrade)}, ${selected.nextEffectSummary}, for ${fragmentLabel(selected.upgradeCost ?? 0)}`}
              </p>
            )}
          </>
        )}
      </div>

    </div>
  );
}
