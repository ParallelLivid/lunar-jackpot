import { useState } from "react";
import { PERK_BRANCHES, PERK_BRANCH_IDS } from "../../content/catalog";
import type { PerkBranchId } from "../../content/catalog";
import { formatCompact } from "../../domain/numbers";
import { PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY } from "../../domain/prestige";
import { selectPrestigeView } from "../../domain/selectors";
import { useDerived, useDispatch } from "../layout";
import { PixelSprite } from "../shared/PixelSprite";
import { ActionButton, DisabledNote, PriceButton, ProgressBar, StatRow } from "../shared/Panel";

/**
 * A perk's rank as filled pips, so progress is readable without arithmetic. A
 * repeatable perk gets a number instead: pips describe progress toward an end,
 * and there is none.
 */
function RankPips({
  maximumRank,
  rank,
  repeatable,
}: {
  maximumRank: number;
  rank: number;
  repeatable: boolean;
}) {
  if (repeatable) {
    return <span className="rank-count">Rank {formatCompact(rank)}</span>;
  }

  return (
    <span className="rank-pips" aria-label={`Rank ${rank} of ${maximumRank}`}>
      {Array.from({ length: maximumRank }, (_, index) => (
        <span
          key={index}
          className={`rank-pip${index < rank ? " rank-pip--filled" : ""}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

export function PrestigePanel() {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectPrestigeView(derived.state, PRESTIGE_RESET_SUMMARY, PRESTIGE_RETAIN_SUMMARY);
  const [confirming, setConfirming] = useState(false);

  const renderBranch = (branchId: PerkBranchId, className = "") => {
    const perks = view.perks.filter((perk) => perk.branchId === branchId);

    if (perks.length === 0) {
      return null;
    }

    return (
      <section key={branchId} className={`perk-branch ${className}`.trim()}>
        {/*
          The branch's one-line description is a tooltip rather than a paragraph.
          Four of them stacked cost about sixty pixels of height — enough to put
          the window into a scroll — and they are orientation rather than
          information a purchase turns on.
        */}
        <h5 className="perk-branch__name" title={PERK_BRANCHES[branchId].description}>
          {PERK_BRANCHES[branchId].displayName}
        </h5>
        <ul className="option-list">
          {perks.map((perk) => (
            <li key={perk.id} className="option perk">
              <div className="option__body">
                {/*
                  The description moves to a tooltip in a column this narrow. It
                  is flavour that repeats what "Next:" says in numbers, and the
                  numbers are what a purchase is decided on.
                */}
                <span className="option__name" title={perk.description}>
                  {/*
                    The name in its own element so the row can be a flex line
                    with the rank held on it. As a bare text node beside the
                    rank there was nothing for the layout to shrink, so at ten
                    pips in a 13rem column the rank wrapped under the name at
                    some widths and not others.
                  */}
                  <span className="option__name-text">{perk.displayName}</span>
                  <RankPips
                    rank={perk.rank}
                    maximumRank={perk.maximumRank}
                    repeatable={perk.repeatable}
                  />
                </span>
                {/* What the next rank buys, so nobody spends blind. */}
                {perk.nextEffectSummary === null ? null : (
                  <span className="option__detail perk__next">
                    Next: {perk.nextEffectSummary}
                  </span>
                )}
                {/*
                  Prerequisites are shown only while they are still holding the
                  perk shut. Once it is buyable they are history, and history is
                  what a three-column layout has no room for.
                */}
                {perk.prerequisitePerkIds.length === 0 || perk.purchase.available ? null : (
                  <span className="option__detail">
                    Requires: {perk.prerequisiteSummary}
                  </span>
                )}
              </div>
              {perk.seleniteCost === null ? (
                <span className="option__state">Rank {perk.rank} max</span>
              ) : (
                /*
                  The rank it buys, over what it charges: a price alone says
                  nothing about what it bought, which on a repeatable perk is the
                  whole question.
                */
                <PriceButton
                  availability={perk.purchase}
                  onClick={() => {
                    dispatch({ type: "BUY_PRESTIGE_PERK", perkId: perk.id });
                  }}
                  ariaLabel={`Buy ${perk.displayName} rank ${String(perk.rank + 1)}, ${String(perk.seleniteCost)} selenite`}
                  what={`Rank ${String(perk.rank + 1)}`}
                  cost={`${String(perk.seleniteCost)} selenite`}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="panel--prestige window-panel">
      <p className="window-panel__status">
        <PixelSprite spriteId="sprite.prestige" scale={2} />
        {view.selenite} selenite
      </p>
      <StatRow
        label="Cash earned this cycle"
        value={formatCompact(view.metric)}
        next={formatCompact(view.threshold)}
      />
      <ProgressBar ratio={view.progressRatio} label="Progress toward prestige" />
      <StatRow label="Projected award" value={`${view.projectedSelenite} selenite`} />
      <StatRow label="Prestiges" value={view.count} />

      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm prestige">
          <h4 className="subheading">Prestige resets progress</h4>
          <p className="description">This is destructive and cannot be undone.</p>
          {/*
            The Company's line, *after* the warning and never instead of it.
            
            The sentence above is the safety statement for a destructive action
            and is the one thing on this panel that may not be made cleverer. The
            lists below are the exact reset matrix. This sits between them, where
            it colours the moment without standing between the player and a fact.
          */}
          <p className="description">
            COMPLIANCE: severance is paid in selenite. Your contract renews immediately.
          </p>
          <p className="description">Reset:</p>
          <ul className="chip-list">
            {view.resetSummary.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <p className="description">Retained:</p>
          <ul className="chip-list">
            {view.retainSummary.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <div className="button-row">
            <ActionButton
              className="action--primary"
              availability={view.prestige}
              onClick={() => {
                setConfirming(false);
                dispatch({ type: "PRESTIGE" });
              }}
            >
              Prestige for {view.projectedSelenite} selenite
            </ActionButton>
            <ActionButton
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </ActionButton>
          </div>
        </div>
      ) : (
        <>
          <ActionButton
            className="action--primary"
            availability={view.prestige}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Prestige
          </ActionButton>
          <DisabledNote availability={view.prestige} />
        </>
      )}

      <div className="panel-section perk-tree">
        <h4 className="subheading">Permanent perks</h4>

        {/*
          The root spans the full width rather than taking a column of its own:
          it is the thing all three branches hang off, and reading it first is
          the order the tree is actually learnt in.

          It holds the tree's entry point and, once the tree is finished, its
          capstone — which is why the comment here used to say "one perk" and had
          been wrong since the capstone landed. Two full-width cards side by side
          is what `.perk-branch--root .option-list` lays them out as.
        */}
        {renderBranch("branch.root", "perk-branch--root")}

        <div className="perk-columns">
          {PERK_BRANCH_IDS.filter((branchId) => branchId !== "branch.root").map((branchId) =>
            renderBranch(branchId),
          )}
        </div>
      </div>
    </div>
  );
}
