import { useEffect, useRef } from "react";
import { formatCompact, formatPercent } from "../../domain/numbers";
import {
  describeGrants,
  selectExpeditionView,
  selectHeldConsumables,
  selectRunSummaryView,
  type RunSummaryView,
} from "../../domain/selectors";
import type { RunSummary } from "../../domain/commands";
import { startAnimationClock } from "../../rendering/animationClock";
import {
  createExpeditionRenderer,
  type ExpeditionRenderer,
  type ExpeditionScene,
} from "../../rendering/expeditionRenderer";
import { useDerived, useDispatch, useRuntime, useRuntimeStatus } from "../layout";
import { PixelSprite } from "../shared/PixelSprite";
import { ActionButton, DisabledNote, Panel, ProgressBar } from "../shared/Panel";

/** Keeps the canvas in step with domain state without owning any of it. */
function ExpeditionCanvas({ scene }: { scene: ExpeditionScene }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ExpeditionRenderer | null>(null);
  const sceneRef = useRef(scene);

  sceneRef.current = scene;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    const renderer = createExpeditionRenderer(canvas);
    rendererRef.current = renderer;

    const clock = startAnimationClock((timeMs) => {
      renderer.render(sceneRef.current, timeMs);
    });

    /*
     * The canvas watches its own box, not the window. A canvas has two sizes —
     * the element the browser lays out and the backing store the renderer draws
     * into — and `renderer.resize()` re-matches them, so it has to run whenever
     * the element's box changes, whatever changed it.
     *
     * A window listener is not enough: this panel is `.panel__fit--fill`, so the
     * canvas width moves whenever the fit re-settles, in a layout effect and a
     * `ResizeObserver` that fire no window resize. Observing the element covers
     * every cause and fires after layout rather than racing it.
     */
    const observer = new ResizeObserver(() => {
      renderer.resize();
    });

    observer.observe(canvas);

    return () => {
      observer.disconnect();
      clock.stop();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="expedition-canvas"
      role="img"
      aria-label={
        scene.status === "surface"
          ? "Expedition scene: on the surface."
          : `Expedition scene at depth ${scene.depth}, oxygen ${Math.round(scene.oxygenRatio * 100)} percent.`
      }
    />
  );
}

/**
 * What a finished run brought back, as icons. The floating reward pops are
 * `aria-hidden` on the grounds that this card announces the totals, so the
 * announcement is a single visually-hidden sentence from
 * `selectRunSummaryView`; the tiles themselves are hidden too, since reading
 * "chips 412 components 3" tile by tile is worse than one sentence.
 */
function RunSummaryCard({ summary }: { summary: RunSummary }) {
  const runtime = useRuntime();
  const view = selectRunSummaryView(summary);

  const tiles = (items: RunSummaryView["recovered"], lost: boolean) => (
    <ul className={`summary-haul${lost ? " summary-haul--lost" : ""}`} aria-hidden="true">
      {items.map((item) => (
        <li key={item.key} className="summary-haul__item" title={item.label}>
          <PixelSprite spriteId={item.spriteId} scale={2} />
          <span className="summary-haul__amount">
            {lost ? "-" : ""}
            {formatCompact(item.amount)}
          </span>
        </li>
      ))}
    </ul>
  );

  /*
    Three rows: the card covers the scene exactly rather than floating in it. The
    heading and footer are fixed and the haul between them gives, because it is
    the row that varies — a failed run carries a second list of tiles under its
    own caption, and 128px of stage has no height for both.
  */
  return (
    <div className={`run-summary run-summary--${view.outcome}`} role="status" aria-live="polite">
      <span className="sr-only">{view.announcement}</span>

      <div className="run-summary__head" aria-hidden="true">
        <h4 className="subheading">{view.heading}</h4>
        {/*
          Beside the heading rather than under it. It is four words, the row has
          the width for it, and the line it used to occupy is most of what made
          this card taller than the box it covers.
        */}
        <p className="description run-summary__detail">
          {view.detail}
          {view.modifierName === null ? null : ` · under ${view.modifierName}`}
        </p>
      </div>

      <div className="run-summary__haul" aria-hidden="true">
        {/*
          The Company's word on the run.

          `aria-hidden` like everything else on this card: the `sr-only` sentence
          above carries the facts, and a screen reader does not need the joke
          read to it after every expedition.
        */}
        <p className="description run-summary__notice">{view.notice}</p>

        {view.recovered.length === 0 ? (
          <p className="description">Nothing came back.</p>
        ) : (
          tiles(view.recovered, false)
        )}

        {/*
          The caption sits beside its tiles rather than above them. It labels
          one row, and the line it used to take is height this box does not
          have — see `.run-summary__lost`.
        */}
        {view.lost.length === 0 ? null : (
          <div className="run-summary__lost">
            <p className="description summary-haul__caption">Lost to the dark</p>
            {tiles(view.lost, true)}
          </div>
        )}
      </div>

      <div className="run-summary__footer">
        <ActionButton
          onClick={() => {
            runtime.dismissRunSummary();
          }}
        >
          Dismiss
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * Critical strikes, over the encounter that took them. Their own lane above the
 * reward pops: a crit adds nothing to the run, and at a high crit chance they
 * arrive fast enough to bury a reward. Decorative and hidden from assistive
 * technology — the durability bar is the accessible signal.
 */
function CriticalPops({ reducedMotion }: { reducedMotion: boolean }) {
  const pops = useRuntimeStatus().criticalPops;

  if (pops.length === 0) {
    return null;
  }

  return (
    <div className="critical-pops" aria-hidden="true">
      {pops.map((pop) => (
        <div
          key={pop.id}
          className={`critical-pop${reducedMotion ? " critical-pop--static" : ""}`}
          style={{ animationDuration: `${pop.expiresAtMs - pop.createdAtMs}ms` }}
        >
          <span className="critical-pop__label">
            {pop.count > 1 ? `Critical ×${pop.count}` : "Critical"}
          </span>
          <span className="critical-pop__damage">+{Math.round(pop.damage)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Floating indicators over the scene, one line per resource collected. The run
 * summary already announces totals, so these are decorative and hidden from
 * assistive technology.
 */
function RewardPops({ reducedMotion }: { reducedMotion: boolean }) {
  const pops = useRuntimeStatus().rewardPops;

  if (pops.length === 0) {
    return null;
  }

  return (
    <div className="reward-pops" aria-hidden="true">
      {pops.map((pop) => (
        <div
          key={pop.id}
          className={`reward-pop${reducedMotion ? " reward-pop--static" : ""}`}
          style={{ animationDuration: `${pop.expiresAtMs - pop.createdAtMs}ms` }}
        >
          {describeGrants(pop.grants, pop.oxygenDelta).map((grant) => (
            <span
              key={grant.key}
              className={`reward-pop__item${grant.amount < 0 ? " reward-pop__item--cost" : ""}`}
            >
              {grant.spriteId === null ? null : (
                <PixelSprite spriteId={grant.spriteId} scale={2} />
              )}
              {grant.amount > 0 ? "+" : ""}
              {grant.amount}
              {grant.unit} {grant.label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ExpeditionPanel() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const runtime = useRuntime();
  const view = selectExpeditionView(derived);
  const held = selectHeldConsumables(derived);
  const status = useRuntimeStatus();
  const summary = status.runSummary;
  const reducedMotion = derived.state.settings.reducedMotion;
  const autoContinue = derived.state.settings.autoContinue;
  // Sorted most-urgent-first by the selector, so the head is what the header
  // shows and the tail is what the "+n" stands for.
  const [lead = null, ...others] = view.commitments;

  const scene: ExpeditionScene = {
    status: view.status,
    depth: view.depth,
    oxygenRatio: view.oxygenRatio,
    oxygenIsLow: view.oxygenIsLow,
    encounterSpriteId: view.encounter?.spriteId ?? null,
    approachRatio: view.encounter?.approachProgressRatio ?? 0,
    resolveRatio: view.encounter?.resolveProgressRatio ?? 0,
    durabilityRatio: view.encounter?.durabilityRatio ?? null,
    resolveElapsedMs: view.encounter?.resolveElapsedMs ?? 0,
    encounterFamily: view.encounter?.family ?? null,
    reducedMotion,
    dissolve: status.encounterDissolve,
    playerSpriteId: view.playerSpriteId,
    playerStrideSpriteId: view.playerStrideSpriteId,
  };

  return (
    <Panel
      className="panel--expedition"
      anchorId="expedition"
      title="Launch Expedition"
      fit
      fill
      /*
        A lower floor than the rest of the dashboard, because this panel carries
        a reserved encounter box — see `.expedition-slot`. Measured with it in
        place: 0.523 at 1440x700, 0.547 at 1280x720, 0.523 at 1060x900, all under
        the shared 0.55. Falling through a floor hands back the full size and a
        scrollbar rather than shrinking further.
      */
      fitFloor={0.5}
      actions={
        <span className="panel__status">
          {view.status === "surface"
            ? "Surface"
            : `Depth ${view.depth} · ${view.depthBandName}`}
          {view.activeModifier === null ? null : (
            <span className="run-modifier" title={view.activeModifier.description}>
              {view.activeModifier.displayName}
            </span>
          )}

          {/*
            The most urgent commitment, on the heading row.

            It used to be a stacked list in the scene column, which was fine for
            one and pushed the panel into a scrollbar at two — a contract, a
            locked exit and a staked wager can all be live on the same descent.
            One chip beside the depth is the version that fits whatever the run
            is carrying, and the ordering that decides which one it is lives in
            `selectRunCommitments` rather than here.

            Hidden from assistive technology, because reading a name, a
            percentage and a target as three fragments is worse than the one
            sentence below, which covers every commitment rather than just this
            one — the same split the run summary card already uses for its haul.
          */}
          {lead === null ? null : (
            <span
              className={`run-commitment run-commitment--${lead.tone}`}
              title={lead.detail}
              aria-hidden="true"
            >
              <span className="run-commitment__name">{lead.displayName}</span>
              <ProgressBar
                ratio={lead.progressRatio}
                label={`${lead.displayName} progress`}
                tone={lead.tone === "imposed" ? "warning" : "neutral"}
              />
              <span className="run-commitment__target">
                {lead.depthsRemaining === 0
                  ? "Reached"
                  : `${lead.depthsRemaining} to depth ${lead.targetDepth}`}
              </span>
              {others.length === 0 ? null : (
                <span
                  className="run-commitment__more"
                  title={others
                    .map((commitment) => `${commitment.displayName} — ${commitment.detail}`)
                    .join("\n")}
                >
                  +{others.length}
                </span>
              )}
            </span>
          )}
          {view.commitments.length === 0 ? null : (
            <span className="sr-only">
              {view.commitments
                .map(
                  (commitment) =>
                    `${commitment.displayName}: ${
                      commitment.depthsRemaining === 0
                        ? "target reached"
                        : `${commitment.depthsRemaining} more depths to depth ${commitment.targetDepth}`
                    }. ${commitment.detail}`,
                )
                .join(" ")}
            </span>
          )}
        </span>
      }
    >
      <div className="expedition-layout">
        <div className="expedition-scene">
          <div className="expedition-stage">
            <ExpeditionCanvas scene={scene} />
            <RewardPops reducedMotion={reducedMotion} />
            <CriticalPops reducedMotion={reducedMotion} />

            {/*
              The summary overlays the scene it is reporting on rather than
              sitting below the controls, and the launch command clears it, so a
              new run never starts underneath the previous run's card.
            */}
            {summary === null ? null : <RunSummaryCard summary={summary} />}
          </div>

          <div className="expedition-meters">
            <span className="meter__label">
              Oxygen {Math.round(view.oxygen)} / {Math.round(view.maxOxygen)}
              {view.oxygenIsLow ? " — LOW" : ""}
            </span>
            <ProgressBar
              ratio={view.oxygenRatio}
              label="Oxygen remaining"
              tone={view.oxygenIsLow ? "warning" : "neutral"}
            />
            <span className="meter__note">
              Pickaxe {formatCompact(view.pickaxeDamage)}/s · loss on failure{" "}
              {formatPercent(view.failureLossChance, 0)} per unit
            </span>
          </div>

          {/*
            Pinned to the bottom of the scene column, so it never shifts when the
            encounter card beside it changes.
          */}
          <div className="run-inventory">
            <h4 className="subheading">Carrying</h4>
            {view.runInventory.isEmpty ? (
              <p className="empty-note">Nothing yet.</p>
            ) : (
              <ul className="run-inventory__list">
                {view.runInventory.items.map((item) => (
                  <li
                    key={item.key}
                    className="run-chip"
                    title={`${item.displayName} — ${item.detail}`}
                  >
                    <PixelSprite spriteId={item.spriteId} scale={2} />
                    {/*
                      Truncated like every other quantity on screen. The exact
                      figure stays in the tooltip and in the line below, which is
                      the same split the resource bar uses.
                    */}
                    <span className="run-chip__amount">{item.displayAmount}</span>
                    <span className="sr-only">
                      {item.displayName}: {item.amount}. {item.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/*
              Already banked, and shown apart from the cargo above it.

              Selenite from a maxed-out find and a cat met on the way down are
              both permanent the moment they happen — no oxygen failure takes
              them and no safe return converts them. Listing them beside the ore
              would put them under the "banks as N chips" line, which is a claim
              about the cargo and false of these.
            */}
            {view.runInventory.secured.length === 0 ? null : (
              <>
                <p className="run-inventory__caption">Kept</p>
                <ul className="run-inventory__list">
                  {view.runInventory.secured.map((item) => (
                    <li
                      key={item.key}
                      className="run-chip run-chip--secured"
                      title={`${item.displayName} — ${item.detail}`}
                    >
                      <PixelSprite spriteId={item.spriteId} scale={2} />
                      <span className="run-chip__amount">{item.displayAmount}</span>
                      <span className="sr-only">
                        {item.displayName}: {item.amount}. {item.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {view.runInventory.items.length === 0 ? null : (
              <p className="description">
                Banks as {view.runInventory.chipsIfBankedText} chips on a safe return.
              </p>
            )}
          </div>
        </div>

        <div className="expedition-controls">
          {/*
            One box for whichever of the three states is on screen.

            The panel is `fit fill`, so `useFitScale` scales its contents to
            their natural height — and without a reserve that height follows the
            run. Measured at 1440x900: 243px on the surface, 293px at an ordinary
            encounter, 368px at a three-option choice, settling at 1.000, 0.958
            and 0.761, so every glyph in the panel changed size the moment a fork
            appeared. Below 1051px, where the shell's rows are `auto`, the box
            grew instead and took the page with it.

            Reserving the tallest state makes the natural height a property of
            the layout rather than of the run: it resizes with the window, not
            with the encounter. The reserve is on `.expedition-slot`; see
            `styles.css` for why 16rem.
          */}
          <div className="expedition-slot">
            {view.status === "surface" ? (
              <div className="expedition-launch">
                {/*
                  The four rules of a run — oxygen refills free, ore banks only on
                  return, encounter length is unpredictable, and an oxygen failure
                  rolls each unbanked unit separately — are in the help window's
                  "Expeditions" topic. They are how the mode works, not something
                  to re-read before every launch.

                  The failure chance itself is not lost: the meters above still
                  print "loss on failure N% per unit" during and before a run.
                */}
                {/*
                  Shown where the decision is made, not only where they were
                  bought. A consumable packed ten minutes ago and forgotten is a
                  consumable that never affected a choice — and these are spent on
                  launch whether or not the run comes home, so the last honest
                  moment to see them is immediately above the button that spends
                  them.
                */}
                {held.length > 0 ? (
                  <div className="expedition-supplies">
                    <span className="expedition-supplies__label">Packed</span>
                    <ul className="expedition-supplies__list">
                      {held.map((item) => (
                        <li key={item.id} className="expedition-supplies__item">
                          <PixelSprite spriteId={item.spriteId} scale={2} />
                          <span className="sr-only">
                            {item.displayName}: {item.effectSummary}. Spent on launch.
                          </span>
                          <span aria-hidden="true" className="expedition-supplies__name">
                            {item.displayName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <ActionButton
                  className="action--launch"
                  availability={view.canLaunch}
                  onClick={() => {
                    dispatch({ type: "LAUNCH_EXPEDITION" });
                  }}
                >
                  Launch expedition
                </ActionButton>
                <DisabledNote availability={view.canLaunch} />
              </div>
            ) : view.encounter === null ? (
              <p className="description">Travelling…</p>
            ) : (
              <div className="encounter-card">
                <h3 className="subheading">{view.encounter.displayName}</h3>
                <p className="description">
                  {view.encounter.difficultyLabel} · {view.encounter.rewardSummary}
                </p>

                {/*
                  The approach used to render nothing at all, which made the oxygen
                  drain during travel look unexplained.
                */}
                {view.status === "approaching" ? (
                  <>
                    <p className="description">Approaching. Oxygen drains while you travel.</p>
                    <ProgressBar
                      ratio={view.encounter.approachProgressRatio}
                      label="Approach progress"
                    />
                  </>
                ) : null}

                {view.status === "decision" ? (
                  <>
                    {/*
                      The forecast replaces the "sight unseen" line rather than
                      sitting beside it: leaving both would have the panel state
                      the rule and break it in consecutive sentences.
                    */}
                    {view.forecast === null ? (
                      <p className="description">
                        Press on and you are committed to whatever comes next, sight unseen.
                      </p>
                    ) : (
                      <p className="description description--forecast">
                        Ahead: <strong>{view.forecast.label}</strong>. Press on and you are
                        committed to it.
                      </p>
                    )}
                    <div className="button-row">
                      <ActionButton
                        className="action--primary"
                        availability={view.canContinue}
                        onClick={() => {
                          dispatch({ type: "CONTINUE_EXPEDITION" });
                        }}
                      >
                        Press on
                      </ActionButton>
                      <ActionButton
                        availability={view.canReturn}
                        onClick={() => {
                          dispatch({ type: "RETURN_FROM_EXPEDITION" });
                        }}
                      >
                        Return and bank
                      </ActionButton>
                    </div>
                    {/*
                      Sealed orders holds the exit shut, and a disabled button whose
                      reason has to be hovered for is the difference between a hard
                      modifier and a broken one. Only rendered when Return is the
                      thing that is blocked — at a decision, that is the lock.
                    */}
                    <DisabledNote availability={view.canReturn} />
                  </>
                ) : null}

                {view.status === "choice" ? (
                  <ul className="option-list">
                    {view.encounter.options.map((option) => (
                      <li key={option.id} className="option">
                        <div className="option__body">
                          <span className="option__name">{option.label}</span>
                          <span className="option__detail">
                            {option.description}
                            {option.oxygenCost > 0
                              ? ` · ${option.oxygenCost}s of oxygen to begin`
                              : ""}
                          </span>
                        </div>
                        <ActionButton
                          onClick={() => {
                            dispatch({ type: "CHOOSE_ENCOUNTER_OPTION", optionId: option.id });
                          }}
                        >
                          Choose
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {view.status === "resolving" ? (
                  <>
                    <p className="description">Resolving. You cannot return until it finishes.</p>
                    <ProgressBar
                      ratio={
                        view.encounter.durabilityRatio === null
                          ? view.encounter.resolveProgressRatio
                          : 1 - view.encounter.durabilityRatio
                      }
                      label="Encounter progress"
                      tone="positive"
                    />
                  </>
                ) : null}

                {/*
                  The reward beat, which used to render nothing at all.

                  None of the blocks above match `"reward"`, so between an
                  encounter finishing and the decision appearing the card showed a
                  name and a difficulty line and went silent. That is a few hundred
                  milliseconds ordinarily — and three seconds when a cat holds the
                  run still, which is exactly when the silence reads as a hang
                  rather than a beat.
                */}
                {view.status === "reward" ? (
                  view.metCat ? (
                    <p className="description description--cat" role="status">
                      A cat. It follows you down — permanent luck, and it comes home
                      whatever happens to this run.
                    </p>
                  ) : (
                    <p className="description">Collected.</p>
                  )
                ) : null}
              </div>
            )}
          </div>

          {/*
            The two run preferences, side by side along the bottom: what the run
            does on its own, then how fast it does it.
          */}
          <div className="expedition-footer">
            <div className="auto-continue">
              <label className="setting setting--toggle">
                <input
                  type="checkbox"
                  checked={autoContinue.enabled}
                  onChange={(event) => {
                    dispatch({
                      type: "UPDATE_SETTINGS",
                      patch: { autoContinue: { ...autoContinue, enabled: event.target.checked } },
                    });
                  }}
                />
                <span className="setting__label">Auto-continue</span>
              </label>
              <label className="setting" title="Pressing on stops at this much oxygen remaining.">
                <span className="setting__label">Stop at</span>
                <input
                  type="range"
                  min={Math.round(view.autoContinueMinimumRatio * 100)}
                  max={90}
                  step={5}
                  value={Math.round(autoContinue.oxygenThresholdRatio * 100)}
                  onChange={(event) => {
                    dispatch({
                      type: "UPDATE_SETTINGS",
                      patch: {
                        autoContinue: {
                          ...autoContinue,
                          oxygenThresholdRatio: Number(event.target.value) / 100,
                        },
                      },
                    });
                  }}
                />
                <span className="setting__value">
                  {Math.round(autoContinue.oxygenThresholdRatio * 100)}%
                </span>
              </label>
              <p className="description">
                Presses on by itself while oxygen is above this.
              </p>
            </div>

            {/*
              Only shown once the pace perk has unlocked something to choose. A
              control offering one option is noise.
            */}
            {view.availableSpeeds.length > 1 ? (
              <div className="run-speed" role="group" aria-label="Expedition speed">
                <span className="setting__label">Speed</span>
                {view.availableSpeeds.map((speed) => (
                  <ActionButton
                    key={speed}
                    className={speed === view.speed ? "action--primary" : ""}
                    pressed={speed === view.speed}
                    onClick={() => {
                      dispatch({ type: "UPDATE_SETTINGS", patch: { expeditionSpeed: speed } });
                    }}
                  >
                    {speed}x
                  </ActionButton>
                ))}
              </div>
            ) : null}
          </div>

        </div>
      </div>
    </Panel>
  );
}
