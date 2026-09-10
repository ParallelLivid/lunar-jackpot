import { useEffect, useRef, useState } from "react";
import { SLOT_SYMBOLS } from "../../content/catalog";
import { formatCompact, formatPercent } from "../../domain/numbers";
import { selectGamblingView } from "../../domain/selectors";
import type { SpinSummary } from "../../domain/state";
import { useDerived, useDispatch } from "../layout";
import { ActionButton, DisabledNote, StatRow } from "../shared/Panel";
import { STAKE_EVERYTHING } from "../../content/chipGames";

/**
 * The result the reels are showing. Settling a spin clears `committedSpin`, so
 * without this the reels would blank the instant the animation finished and the
 * player would never read what they spun.
 *
 * Not taken from `recentResults[0]` directly, which is saved state and would show
 * the previous session's spin on open. The id sitting in the save at mount is
 * recorded and ignored, so only a spin settled while this window is open is
 * adopted and the reels read `???` again after a close and reopen.
 */
function useSettledSpin(recentResults: readonly SpinSummary[]): SpinSummary | null {
  const seenAtMount = useRef<string | null>(recentResults[0]?.betId ?? null);
  const [settled, setSettled] = useState<SpinSummary | null>(null);

  const latest = recentResults[0] ?? null;

  useEffect(() => {
    if (latest !== null && latest.betId !== seenAtMount.current) {
      setSettled(latest);
    }
  }, [latest]);

  return settled;
}

export function SlotGame() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectGamblingView(derived);
  const [payoutTableOpen, setPayoutTableOpen] = useState(false);

  const settled = useSettledSpin(view.recentResults);

  const committed = view.committedSpin;
  const spinning = committed !== null && committed.animationRemainingMs > 0;
  // A live spin wins over a settled one, so the next stake replaces the previous
  // result rather than leaving it under the animation.
  const shown = committed ?? settled;
  const reels =
    shown === null
      ? ["?", "?", "?"]
      : shown.symbolIds.map((symbolId) => SLOT_SYMBOLS[symbolId].glyph);

  return (
    <div className="chip-game">
      <div className={`reels${spinning && !derived.state.settings.reducedMotion ? " reels--spinning" : ""}`}>
        {reels.map((glyph, index) => (
          <span key={index} className="reel" aria-hidden="true">
            {spinning && !derived.state.settings.reducedMotion ? "*" : glyph}
          </span>
        ))}
      </div>
      {/*
        Announces whatever the reels are showing, settled or live, so the result
        is not something only sighted players get to read.
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {shown === null
          ? "No spin in progress."
          : `Reels: ${shown.symbolIds
              .map((symbolId) => SLOT_SYMBOLS[symbolId].displayName)
              .join(", ")}. Multiplier ${shown.multiplier}.`}
      </p>

      <StatRow label="Current luck" value={`${Math.round(view.luckPoints)} points`} />
      <StatRow
        label="Expected return"
        value={formatPercent(view.expectedReturn)}
        title={`Capped at ${formatPercent(view.maximumExpectedReturn, 0)} for the MVP.`}
      />

      <div className="wager-row" role="group" aria-label="Wager">
        {view.wagers.map((wager) => (
          <ActionButton
            key={wager.wager}
            pressed={!view.stakeIsEverything && wager.wager === view.selectedWager}
            disabledReason={wager.affordable ? null : wager.reason}
            onClick={() => {
              dispatch({ type: "SET_WAGER", wager: wager.wager });
            }}
          >
            {formatCompact(wager.wager)}
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
            dispatch({ type: "SET_WAGER", wager: STAKE_EVERYTHING });
          }}
        >
          Bet it all
        </ActionButton>
      </div>

      <ActionButton
        className="action--primary"
        availability={view.spin}
        onClick={() => {
          dispatch({ type: "START_SLOT_SPIN", wager: view.selectedWager });
        }}
      >
        Spin for {formatCompact(view.selectedWager)} chips
      </ActionButton>
      <DisabledNote availability={view.spin} />

      <div className="panel-section">
        <button
          type="button"
          className="disclosure"
          aria-expanded={payoutTableOpen}
          onClick={() => {
            setPayoutTableOpen((open) => !open);
          }}
        >
          {payoutTableOpen ? "Hide payout table" : "Show payout table"}
        </button>

        {payoutTableOpen ? (
          <table className="payout-table">
            <caption className="sr-only">
              Fixed slot payout multipliers. Luck changes symbol weights, never these multipliers.
            </caption>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Three</th>
                <th scope="col">Two</th>
              </tr>
            </thead>
            <tbody>
              {view.payoutTable.map((row) => (
                <tr key={row.symbolId}>
                  <th scope="row">
                    <span aria-hidden="true">{row.glyph}</span> {row.displayName}
                  </th>
                  <td>{row.tripleMultiplier}x</td>
                  <td>{row.pairMultiplier}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {view.recentResults.length === 0 ? null : (
        <div className="panel-section">
          <h4 className="subheading">This session</h4>
          <ul className="chip-list">
            {view.recentResults.map((result) => (
              <li key={result.betId}>
                {formatCompact(result.wager)} at {result.multiplier}x ={" "}
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
