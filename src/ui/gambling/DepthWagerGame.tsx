import { useState } from "react";
import { formatCompact, formatPercent } from "../../domain/numbers";
import { selectDepthWagerView } from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { ActionButton, DisabledNote, StatRow } from "../shared/Panel";
import { STAKE_EVERYTHING } from "../../content/chipGames";

export function DepthWagerGame() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectDepthWagerView(derived);
  const [oddsOpen, setOddsOpen] = useState(false);

  const pending = view.pending;

  return (
    <div className="chip-game">
      {pending === null ? null : (
        <div className="wager-pending" role="status">
          <h4 className="subheading">Riding on your next run</h4>
          <p className="description">
            {formatCompact(pending.stake)} chips on reaching depth {pending.targetDepth}, at{" "}
            {pending.multiplier.toFixed(2)}x.
          </p>
          {/*
            Said plainly, because both halves surprise people: an unlaunched
            wager does not expire, and a run that dies past the target still pays.
          */}
          <p className="description">
            It settles on your next completed run, whether you come home or not. Reaching the
            depth is what pays.
          </p>
        </div>
      )}

      <StatRow
        label="Your deepest ever"
        value={`${view.referenceDepth}${view.referenceIsFloor ? " (house minimum)" : ""}`}
        title={
          view.referenceIsFloor
            ? "The house prices against a minimum record until you have set a deeper one of your own."
            : "Every price on this board is derived from this number."
        }
      />
      <StatRow label="Current luck" value={`${Math.round(view.luckPoints)} points`} />

      <label className="field">
        <span className="field__label">
          Target depth ({view.minimumTarget} to {view.maximumTarget})
        </span>
        <input
          className="field__slider"
          type="range"
          min={view.minimumTarget}
          max={view.maximumTarget}
          step={1}
          value={view.selectedTarget}
          disabled={pending !== null}
          onChange={(event) => {
            dispatch({
              type: "SET_DEPTH_WAGER",
              targetDepth: Number(event.target.value),
              stake: view.selectedStake,
            });
          }}
        />
        <span className="field__value">Depth {view.selectedTarget}</span>
      </label>

      <StatRow
        label="Chance the house gives you"
        value={formatPercent(view.successChance)}
        title={view.formula}
      />
      <StatRow
        label="Pays"
        value={`${view.offeredMultiplier.toFixed(2)}x`}
        title={`${view.baseMultiplier.toFixed(2)}x before luck. Luck shades the price, never the run — biasing the run would pay you twice for the same stat.`}
      />

      <div className="wager-row" role="group" aria-label="Stake">
        {view.stakes.map((stake) => (
          <ActionButton
            key={stake.wager}
            pressed={!view.stakeIsEverything && stake.wager === view.selectedStake}
            disabledReason={stake.affordable ? null : stake.reason}
            onClick={() => {
              dispatch({
                type: "SET_DEPTH_WAGER",
                targetDepth: view.selectedTarget,
                stake: stake.wager,
              });
            }}
          >
            {formatCompact(stake.wager)}
          </ActionButton>
        ))}
        {/*
          A rung like any other, selected the same way. Its *value* is the
          balance rather than a fixed amount, which is why the selection is
          stored as a mode and resolved at play time — see `ChipStake`. It sits
          on its own row beneath the numbered rungs because it is not one of
          them, and centred because it is the only thing on that row.
        */}
        <ActionButton
          className="action--everything"
          pressed={view.stakeIsEverything}
          disabledReason={
            view.betEverything.available.available ? null : view.betEverything.available.reason
          }
          onClick={() => {
            dispatch({
              type: "SET_DEPTH_WAGER",
              targetDepth: view.selectedTarget,
              stake: STAKE_EVERYTHING,
            });
          }}
        >
          Bet it all
        </ActionButton>
      </div>

      <ActionButton
        className="action--primary"
        availability={view.place}
        onClick={() => {
          dispatch({
            type: "PLACE_DEPTH_WAGER",
            targetDepth: view.selectedTarget,
            stake: view.selectedStake,
          });
        }}
      >
        Stake {formatCompact(view.selectedStake)} to win {formatCompact(view.potentialPayout)}
      </ActionButton>
      <DisabledNote availability={view.place} />

      <div className="panel-section">
        <button
          type="button"
          className="disclosure"
          aria-expanded={oddsOpen}
          onClick={() => {
            setOddsOpen((open) => !open);
          }}
        >
          {oddsOpen ? "Hide how the price is set" : "Show how the price is set"}
        </button>

        {oddsOpen ? (
          <ul className="rule-list">
            <li>{view.formula}</li>
            <li>The price is fixed when you place the bet and is never recalculated.</li>
            <li>Over only. There is no bet on staying shallow, because you could simply not go.</li>
            <li>
              Settles on depth reached. A run that runs out of oxygen past your target still
              pays.
            </li>
            <li>One wager at a time, and only from the surface.</li>
          </ul>
        ) : null}
      </div>

      {view.recentResults.length === 0 ? null : (
        <div className="panel-section">
          <h4 className="subheading">This session</h4>
          <ul className="chip-list">
            {view.recentResults.map((result) => (
              <li key={result.wagerId}>
                Depth {result.targetDepth}, reached {result.depthReached} ={" "}
                {result.net >= 0 ? "+" : ""}
                {formatCompact(result.net)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
