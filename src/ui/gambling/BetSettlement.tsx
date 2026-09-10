/**
 * Settles committed chip bets once their animation has played out.
 *
 * Mounted by the dashboard rather than the gambling window, which is the whole
 * point of it existing separately: settlement is an obligation the runtime owes
 * a bet that has already been paid for, not a behaviour of whichever panel is on
 * screen. With the timers inside the game components, closing the window left a
 * committed bet unsettled — and since a committed bet blocks prestige, the block
 * outlived any way of clearing it short of reopening that exact tab.
 *
 * The animation clock keeps ticking either way, so by the time a bet is settled
 * from here its owed time is usually already zero.
 */

import { useEffect } from "react";
import { useDerived, useDispatch } from "../layout";

export function BetSettlement() {
  const derived = useDerived();
  const dispatch = useDispatch();

  const spin = derived.state.gambling.committedSpin;
  const spinBetId = spin?.betId ?? null;
  const spinRemaining = spin?.animationRemainingMs ?? 0;

  const wheel = derived.state.gambling.roulette.committedBet;
  const wheelBetId = wheel?.betId ?? null;
  const wheelRemaining = wheel?.animationRemainingMs ?? 0;

  useEffect(() => {
    if (spinBetId === null) {
      return;
    }

    const timer = setTimeout(
      () => {
        dispatch({ type: "COMPLETE_SLOT_SPIN", betId: spinBetId });
      },
      Math.max(0, spinRemaining),
    );

    return () => {
      clearTimeout(timer);
    };
    // Only the bet identity restarts the timer; the remaining time is read once,
    // when that bet begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinBetId, dispatch]);

  useEffect(() => {
    if (wheelBetId === null) {
      return;
    }

    const timer = setTimeout(
      () => {
        dispatch({ type: "COMPLETE_ROULETTE_SPIN", betId: wheelBetId });
      },
      Math.max(0, wheelRemaining),
    );

    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelBetId, dispatch]);

  return null;
}
