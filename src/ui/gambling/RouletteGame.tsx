import { useState } from "react";
import { ROULETTE_BETS, type RouletteColour } from "../../content/roulette";
import { formatCompact, formatPercent } from "../../domain/numbers";
import { selectRouletteView } from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { ActionButton, DisabledNote, StatRow } from "../shared/Panel";
import { STAKE_EVERYTHING } from "../../content/chipGames";

/**
 * A pocket, drawn so its colour survives a monochrome palette: red is solid,
 * black is outlined, green is solid under a hatch. One component for all three
 * places a pocket appears — the wheel, the bet buttons, the session list — so
 * the convention has a single implementation. The pattern is for sighted
 * players; the accessible name says the colour in words.
 */
function Pocket({
  colour,
  label,
  size = "chip",
  text,
}: {
  colour: RouletteColour;
  /** Overrides the spoken name, where the surrounding text already says more. */
  label?: string;
  size?: "chip" | "wheel";
  text: string;
}) {
  return (
    <span
      className={`pocket pocket--${colour} pocket--${size}`}
      aria-label={label ?? `${text}, ${colour}`}
      role="img"
    >
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

export function RouletteGame() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectRouletteView(derived);
  const [betTableOpen, setBetTableOpen] = useState(false);

  const committed = view.committedBet;
  const spinning = committed !== null && committed.animationRemainingMs > 0;
  // The wheel keeps showing the last pocket once the bet has settled. Without
  // this the number is never visible: settlement is scheduled for the instant
  // the animation ends, so the pocket would be drawn for a single frame.
  const showing = committed?.pocket ?? view.recentResults[0]?.pocket ?? null;
  const colour = showing === null ? "green" : view.colourOf(showing);
  const needsNumber = ROULETTE_BETS[view.selectedBetTypeId].pockets === null;

  return (
    <div className="chip-game">
      <div className={`wheel${spinning && !derived.state.settings.reducedMotion ? " wheel--spinning" : ""}`}>
        <span className="wheel__pocket">
          {spinning && !derived.state.settings.reducedMotion ? (
            <Pocket colour="black" size="wheel" text="*" label="Spinning." />
          ) : showing === null ? (
            <Pocket colour="black" size="wheel" text="?" label="No pocket yet." />
          ) : (
            <Pocket colour={colour} size="wheel" text={String(showing)} />
          )}
        </span>
      </div>

      {/*
        The pattern has to be learnable, and one line beside the wheel is where a
        player will look for it.
      */}
      <p className="pocket-legend">
        <Pocket colour="red" text="7" label="Red is a solid tile." />
        <span>Red</span>
        <Pocket colour="black" text="8" label="Black is an outlined tile." />
        <span>Black</span>
        <Pocket colour="green" text="0" label="Green is a hatched tile." />
        <span>Green</span>
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {committed === null
          ? "No bet on the table."
          : `Pocket ${String(committed.pocket)}, ${view.colourOf(committed.pocket)}. ${
              committed.multiplier > 0 ? "The bet pays." : "The bet loses."
            }`}
      </p>

      <StatRow label="Current luck" value={`${Math.round(view.luckPoints)} points`} />
      {/*
        Roulette has published odds, so luck here moves the wheel rather than the
        payouts — and a wheel that has been leaned on has to say so. The edge is
        stated for the bet currently selected, because the cap bites differently
        on a straight-up bet than on an even-money one.
      */}
      <StatRow
        label="House edge, this bet"
        value={formatPercent(view.houseEdge)}
        title={`Expected return ${formatPercent(view.expectedReturn)}, capped at ${formatPercent(view.maximumExpectedReturn, 0)}. Luck leans the wheel toward the pockets you back; it never changes a payout.`}
      />

      <div className="bet-grid" role="group" aria-label="Bet">
        {view.bets.map((bet) => (
          <ActionButton
            key={bet.betTypeId}
            className="bet-grid__option"
            pressed={bet.selected}
            disabledReason={spinning ? "The wheel is still turning." : null}
            ariaLabel={`${bet.displayName}, pays ${String(bet.multiplier)} times the stake. ${bet.description}`}
            onClick={() => {
              dispatch({
                type: "SET_ROULETTE_BET",
                betTypeId: bet.betTypeId,
                straightNumber: view.selectedNumber,
              });
            }}
          >
            {/*
              A swatch on the three colour bets, in the same pattern the wheel
              uses, so "Red" and a red result are recognisably the same claim.
              Hidden from assistive technology: the button already says "Red".
            */}
            {bet.colour === null ? null : (
              <span className={`pocket pocket--${bet.colour} pocket--swatch`} aria-hidden="true" />
            )}
            {bet.displayName}
          </ActionButton>
        ))}
      </div>

      {needsNumber ? (
        <label className="field">
          <span className="field__label">Number (0 to 36)</span>
          <input
            className="field__input"
            type="number"
            min={0}
            max={view.pocketCount - 1}
            step={1}
            value={view.selectedNumber}
            disabled={spinning}
            onChange={(event) => {
              dispatch({
                type: "SET_ROULETTE_BET",
                betTypeId: view.selectedBetTypeId,
                straightNumber: Number(event.target.value),
              });
            }}
          />
        </label>
      ) : null}

      <div className="wager-row" role="group" aria-label="Stake">
        {view.wagers.map((wager) => (
          <ActionButton
            key={wager.wager}
            pressed={!view.stakeIsEverything && wager.wager === view.selectedWager}
            disabledReason={wager.affordable ? null : wager.reason}
            onClick={() => {
              dispatch({ type: "SET_ROULETTE_WAGER", wager: wager.wager });
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
            dispatch({ type: "SET_ROULETTE_WAGER", wager: STAKE_EVERYTHING });
          }}
        >
          Bet it all
        </ActionButton>
      </div>

      <ActionButton
        className="action--primary"
        availability={view.spin}
        onClick={() => {
          dispatch({ type: "START_ROULETTE_SPIN", wager: view.selectedWager });
        }}
      >
        Spin for {formatCompact(view.selectedWager)} chips
      </ActionButton>
      <DisabledNote availability={view.spin} />

      <div className="panel-section">
        <button
          type="button"
          className="disclosure"
          aria-expanded={betTableOpen}
          onClick={() => {
            setBetTableOpen((open) => !open);
          }}
        >
          {betTableOpen ? "Hide bet table" : "Show bet table"}
        </button>

        {betTableOpen ? (
          <table className="payout-table">
            <caption className="sr-only">
              European single-zero wheel. Multipliers include the stake and never change; luck
              only moves the wheel.
            </caption>
            <thead>
              <tr>
                <th scope="col">Bet</th>
                <th scope="col">Pays</th>
                <th scope="col">Wins on</th>
              </tr>
            </thead>
            <tbody>
              {view.bets.map((bet) => (
                <tr key={bet.betTypeId}>
                  <th scope="row">{bet.displayName}</th>
                  <td>{bet.multiplier}x</td>
                  <td>{bet.description}</td>
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
                {ROULETTE_BETS[result.betTypeId].displayName} on{" "}
                <Pocket colour={view.colourOf(result.pocket)} text={String(result.pocket)} /> ={" "}
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
