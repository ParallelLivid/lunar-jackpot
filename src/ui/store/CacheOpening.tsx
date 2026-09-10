/**
 * What came out of the caches, played in. The result already exists when this
 * mounts: `openCaches` resolves the whole batch in one command, as a slot spin
 * commits its symbols before the reels move. So this is presentation over a
 * decided outcome and holds no game state — closing it or reloading
 * mid-animation loses nothing.
 *
 * Mounted outside the window layer, like `BetSettlement`, so it survives the
 * store window closing while it is still playing.
 */

import { useEffect, useState } from "react";
import { CACHE_TYPES } from "../../content/catalog";
import { selectCacheResultsView } from "../../domain/selectors";
import { useGameState, useRuntime, useRuntimeStatus } from "../layout";
import { GradeBadge } from "../gear/GearPanel";
import { PixelSprite } from "../shared/PixelSprite";
import { ActionButton } from "../shared/Panel";
import { Window } from "../shared/Window";

/** How long the crate rattles before it gives anything up. */
const SHAKE_MS = 420;

export function CacheOpening() {
  const runtime = useRuntime();
  const state = useGameState();
  const batch = useRuntimeStatus().cacheResults;
  const reducedMotion = state.settings.reducedMotion;

  // Reduced motion skips straight to the result rather than shortening the wait:
  // the setting is about movement, not duration.
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (batch === null || reducedMotion) {
      setShaking(false);

      return;
    }

    setShaking(true);

    const timer = setTimeout(() => {
      setShaking(false);
    }, SHAKE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [batch, reducedMotion]);

  if (batch === null) {
    return null;
  }

  const view = selectCacheResultsView(state, batch);
  const close = (): void => {
    runtime.dismissCacheResults();
  };

  return (
    <div className="cache-opening-layer">
      <Window title={view.title} onClose={close} fit={false}>
        <div className="cache-opening">
          <span className="sr-only" role="status">
            {view.announcement}
          </span>

          {shaking ? (
            <div className="cache-opening__crate" aria-hidden="true">
              <PixelSprite
                spriteId={CACHE_TYPES[batch.cacheTypeId].spriteId}
                scale={5}
              />
            </div>
          ) : (
            <>
              {/*
                One grid, animated in as a group. A hundred caches opened one
                reveal at a time is not a feature, it is a wait.
              */}
              <ul
                className={`cache-opening__grid${
                  reducedMotion ? "" : " cache-opening__grid--enter"
                }`}
                aria-hidden="true"
              >
                {view.rows.map((row) => (
                  <li key={row.key} className="cache-opening__item" title={row.detail}>
                    <PixelSprite spriteId={row.spriteId} scale={3} />
                    <span className="cache-opening__name">{row.displayName}</span>
                    <span className="cache-opening__detail">{row.detail}</span>
                    {row.grade === null ? null : <GradeBadge grade={row.grade} />}
                    {row.count > 1 ? (
                      <span className="cache-opening__count">x{row.count}</span>
                    ) : null}
                  </li>
                ))}
              </ul>

              <p className="description">
                {view.opened === 1
                  ? "One opened."
                  : `${String(view.opened)} opened.`}
                {view.shortfall > 0
                  ? ` ${String(view.shortfall)} more would not open — check your keys.`
                  : ""}
              </p>

              <ActionButton className="action--primary" onClick={close}>
                Done
              </ActionButton>
            </>
          )}
        </div>
      </Window>
    </div>
  );
}
