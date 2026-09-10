/**
 * Development-only diagnostics.
 *
 * It exposes the active RNG streams, recent random decisions, and the modifier
 * breakdown behind a stat. It renders nothing in a production build and grants
 * no resources, so it cannot mask a balance problem.
 */

import { useState } from "react";
import { formatCompact, formatPercent } from "../domain/numbers";
import { selectExpectedReturn } from "../domain/gambling";
import { selectLoadoutView } from "../domain/selectors";
import { useDerived } from "../ui/layout";

function isDevelopmentBuild(): boolean {
  return import.meta.env.DEV;
}

export function DevPanel() {
  const derived = useDerived();
  const [open, setOpen] = useState(false);

  if (!isDevelopmentBuild()) {
    return null;
  }

  const { state } = derived;
  const loadout = selectLoadoutView(derived);
  const streams = state.expedition.rngStreams;

  return (
    <aside className="dev-panel" aria-label="Developer diagnostics">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? "Hide diagnostics" : "Diagnostics"}
      </button>

      {open ? (
        <dl className="dev-list">
          <dt>Run seed</dt>
          <dd>{state.expedition.seed ?? "none"}</dd>

          <dt>Run id</dt>
          <dd>{state.expedition.runId ?? "none"}</dd>

          <dt>Stream draws</dt>
          <dd>
            {streams === null
              ? "no active run"
              : `gen ${streams["expedition-generation"].draws} · rew ${streams["expedition-rewards"].draws} · fail ${streams["expedition-failure"].draws}`}
          </dd>

          <dt>Global draws</dt>
          <dd>
            gambling {state.random.gambling.draws} · caches {state.random.cacheRewards.draws} ·
            seeds {state.random.expeditionSeeds.draws}
          </dd>

          <dt>Luck</dt>
          <dd>
            {Math.round(loadout.luckPoints)} points ({formatPercent(loadout.luckFactor)} curve)
          </dd>

          <dt>Slot expected return</dt>
          <dd>{formatPercent(selectExpectedReturn(derived.modifiers, derived.luckPoints))}</dd>

          <dt>Failure loss chance</dt>
          <dd>{formatPercent(loadout.failureLossChance)}</dd>

          <dt>Active modifiers</dt>
          <dd>
            {derived.modifiers.length === 0
              ? "none"
              : derived.modifiers
                  .map(
                    (modifier) =>
                      `${modifier.sourceId} ${modifier.operation} ${modifier.value} -> ${modifier.targetStat}`,
                  )
                  .join("; ")}
          </dd>

          <dt>Recent encounters</dt>
          <dd>
            {state.expedition.history.length === 0
              ? "none"
              : state.expedition.history
                  .slice(-6)
                  .map((entry) => `${entry.encounterId}@${entry.depth}`)
                  .join(", ")}
          </dd>

          <dt>Lifetime cash</dt>
          <dd>{formatCompact(state.prestige.lifetimeCashEarned)}</dd>
        </dl>
      ) : null}
    </aside>
  );
}
