import { useState } from "react";
import { formatCompact, formatPercent } from "../../domain/numbers";
import { selectBlackjackView, type BlackjackCardView } from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { ActionButton, DisabledNote, StatRow } from "../shared/Panel";
import { STAKE_EVERYTHING } from "../../content/chipGames";

function Cards({
  cards,
  hidden,
  label,
}: {
  cards: BlackjackCardView[];
  hidden: boolean;
  label: string;
}) {
  return (
    <div className="card-row" aria-label={label}>
      {cards.map((card) => (
        <span key={card.key} className="card" aria-hidden="true">
          {card.label}
        </span>
      ))}
      {/*
        The hole card is drawn face down rather than omitted, so the hand reads
        as two cards from the first frame and does not jump when it is turned.
      */}
      {hidden ? (
        <span className="card card--facedown" aria-hidden="true">
          ?
        </span>
      ) : null}
    </div>
  );
}

/** Why the stake ladder is untouchable between the deal and the settlement. */
const HAND_IN_PROGRESS = "Finish the hand you are playing first.";

export function BlackjackGame() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectBlackjackView(derived);
  const [rulesOpen, setRulesOpen] = useState(false);
  const live = view.status === "player";

  return (
    <div className="chip-game">
      <div className="blackjack-table">
        <div className="blackjack-side">
          <span className="blackjack-side__label">
            Dealer{view.dealerCards.length === 0 ? "" : ` — ${String(view.dealerTotal)}`}
            {view.dealerHidden ? "+" : ""}
          </span>
          <Cards cards={view.dealerCards} hidden={view.dealerHidden} label="Dealer hand" />
        </div>
        <div className="blackjack-side">
          <span className="blackjack-side__label">
            You{view.playerCards.length === 0 ? "" : ` — ${String(view.playerTotal)}`}
            {view.playerSoft ? " soft" : ""}
          </span>
          <Cards cards={view.playerCards} hidden={false} label="Your hand" />
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {view.status === "idle"
          ? "No hand dealt."
          : `Your hand: ${view.playerCards.map((card) => card.label).join(", ")}, totalling ${String(view.playerTotal)}. Dealer showing ${view.dealerCards.map((card) => card.label).join(", ")}.${view.outcomeLabel === null ? "" : ` ${view.outcomeLabel}.`}`}
      </p>

      {/*
        Always rendered, and merely invisible when there is nothing to report.
        Appearing and disappearing between hands was one of the two things
        moving the buttons underneath it.

        `aria-hidden` while empty rather than `role="status"`: the settled hand is
        already announced by the live region above, and a blank status region is
        a thing screen readers stop on for no reason.
      */}
      <p
        className={`blackjack-outcome${(view.lastNet ?? 0) >= 0 ? " blackjack-outcome--won" : ""}${
          view.outcomeLabel === null ? " blackjack-outcome--empty" : ""
        }`}
        aria-hidden={view.outcomeLabel === null}
      >
        {view.outcomeLabel === null ? (
          " "
        ) : (
          <>
            {view.outcomeLabel}
            {view.lastNet === null
              ? ""
              : ` (${view.lastNet >= 0 ? "+" : ""}${formatCompact(view.lastNet)} chips)`}
          </>
        )}
      </p>

      <StatRow label="Current luck" value={`${Math.round(view.luckPoints)} points`} />
      {/*
        Blackjack is the one game where the player acts after seeing a card, so
        the same lean on the shoe is worth more here than anywhere else. The
        figure quoted is measured from simulated basic-strategy play rather than
        derived from the opening deal — see BLACKJACK_MEASURED_RETURN.
      */}
      <StatRow
        label="House edge"
        value={formatPercent(view.houseEdge)}
        title={`Measured from simulated play. Without luck this shoe returns ${formatPercent(view.baseReturn)}; luck leans it toward aces and tens, capped at ${formatPercent(view.maximumExpectedReturn, 0)}.`}
      />

      {/*
        The stake ladder is always here, disabled while a hand is live.

        It used to be swapped out for the Hit/Stand/Double row, which is what
        moved the buttons: three rows of rungs plus a Deal button is about 140px
        more than one row of three, so dealing a hand shortened the window by
        that much and pressing Stand grew it back. Keeping the ladder mounted
        costs nothing — it is disabled, not hidden — and the swap below is now
        one row of buttons for another.
      */}
      <div className="wager-row" role="group" aria-label="Stake">
        {view.wagers.map((wager) => (
          <ActionButton
            key={wager.wager}
            pressed={!view.stakeIsEverything && wager.wager === view.selectedWager}
            disabledReason={
              live ? HAND_IN_PROGRESS : wager.affordable ? null : wager.reason
            }
            onClick={() => {
              dispatch({ type: "SET_BLACKJACK_WAGER", wager: wager.wager });
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
            dispatch({ type: "SET_BLACKJACK_WAGER", wager: STAKE_EVERYTHING });
          }}
        >
          Bet it all
        </ActionButton>
      </div>

      {/*
        One row of buttons in either state, in a box that reserves its height, so
        Hit lands exactly where Deal was.
      */}
      <div className="blackjack-controls">
        {live ? (
          <div className="action-row" role="group" aria-label="Play">
            <ActionButton
              className="action--primary"
              availability={view.hit}
              onClick={() => {
                dispatch({ type: "BLACKJACK_HIT" });
              }}
            >
              Hit
            </ActionButton>
            <ActionButton
              availability={view.stand}
              onClick={() => {
                dispatch({ type: "BLACKJACK_STAND" });
              }}
            >
              Stand
            </ActionButton>
            <ActionButton
              availability={view.double}
              onClick={() => {
                dispatch({ type: "BLACKJACK_DOUBLE" });
              }}
            >
              Double
            </ActionButton>
          </div>
        ) : (
          <ActionButton
            className="action--primary action--deal"
            availability={view.deal}
            onClick={() => {
              dispatch({ type: "DEAL_BLACKJACK", wager: view.selectedWager });
            }}
          >
            Deal for {formatCompact(view.selectedWager)} chips
          </ActionButton>
        )}
      </div>
      {/*
        Whichever control is on screen explains itself. Not reserved: it only
        appears when the stake is unaffordable, it sits below every button, and
        an always-present blank line under the controls would be a permanent cost
        to prevent a rare shift in the one state where the player cannot play
        anyway.
      */}
      <DisabledNote availability={live ? view.hit : view.deal} />

      <div className="panel-section">
        <button
          type="button"
          className="disclosure"
          aria-expanded={rulesOpen}
          onClick={() => {
            setRulesOpen((open) => !open);
          }}
        >
          {rulesOpen ? "Hide rules" : "Show rules"}
        </button>

        {rulesOpen ? (
          <ul className="rule-list">
            <li>Six-deck shoe, reshuffled every hand.</li>
            <li>Dealer stands on all 17, soft included.</li>
            <li>Blackjack pays 3 to 2. A push returns your stake.</li>
            <li>Hit, stand and double. No splitting, insurance or surrender.</li>
            <li>
              Every card for the hand is dealt into the shoe before you see the first one, so
              reloading deals exactly the same cards.
            </li>
          </ul>
        ) : null}
      </div>

      {view.recentResults.length === 0 ? null : (
        <div className="panel-section">
          <h4 className="subheading">This session</h4>
          <ul className="chip-list">
            {view.recentResults.map((result) => (
              <li key={result.betId}>
                {result.playerTotal} against {result.dealerTotal} ={" "}
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
