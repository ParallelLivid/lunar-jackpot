import { formatCompact, formatDuration } from "../../domain/numbers";
import { selectMachineViews, type MachineView } from "../../domain/selectors";
import { MachineSprite } from "../shared/PixelSprite";
import { useDerived, useDispatch, useGameState } from "../layout";
import { ActionButton, Panel, ProgressBar } from "../shared/Panel";

function MachineTile({ view }: { view: MachineView }) {
  const dispatch = useDispatch();
  const reducedMotion = useGameState().settings.reducedMotion;

  if (!view.unlocked) {
    return (
      <li className="machine-tile machine-tile--locked">
        <button
          type="button"
          className="machine-tile__button"
          onClick={() => {
            dispatch({ type: "SELECT_MACHINE", machineId: view.id });
          }}
          aria-pressed={view.selected}
          aria-label={`Locked machine position. ${view.recipePieces} of ${view.recipePiecesRequired} recipe pieces found, which drop in ${view.recipeBandName}.`}
        >
          <MachineSprite spriteId={view.spriteId} locked animate={false} />
          <span className="machine-tile__name">Locked</span>
          <span className="machine-tile__detail">
            {view.recipePieces}/{view.recipePiecesRequired} pieces
          </span>
          {/* Pieces only drop in one band, so the tile has to say which. */}
          <span className="machine-tile__detail machine-tile__band">
            {view.recipeBandName}
          </span>
        </button>
        <ProgressBar
          ratio={view.recipePiecesRequired === 0 ? 0 : view.recipePieces / view.recipePiecesRequired}
          label={`Recipe progress for a locked machine`}
        />
        {view.unlockAction.available ? (
          <ActionButton
            className="action--primary"
            onClick={() => {
              dispatch({ type: "UNLOCK_MACHINE", machineId: view.id });
            }}
          >
            Install machine
          </ActionButton>
        ) : null}
      </li>
    );
  }

  return (
    <li className={`machine-tile${view.selected ? " machine-tile--selected" : ""}`}>
      <button
        type="button"
        className="machine-tile__button"
        onClick={() => {
          dispatch({ type: "SELECT_MACHINE", machineId: view.id });
        }}
        aria-pressed={view.selected}
        aria-label={`${view.displayName}, level ${view.level}, paying ${view.cyclePayout} cash every ${formatDuration(view.cycleMs)}`}
      >
        <MachineSprite
          spriteId={view.spriteId}
          progress={view.cycleProgressRatio}
          animate={!reducedMotion}
        />
        <span className="machine-tile__name">
          {view.displayName}
          {view.selected ? <span className="machine-tile__marker"> [selected]</span> : null}
        </span>
        <span className="machine-tile__detail">
          Level {view.level} · {formatCompact(view.cyclePayout)} per {formatDuration(view.cycleMs)}
        </span>
      </button>
      <ProgressBar
        ratio={view.cycleProgressRatio}
        label={`${view.displayName} cycle progress`}
        tone="positive"
      />
    </li>
  );
}

export function CasinoFloor({ onRename }: { onRename: () => void }) {
  const derived = useDerived();
  const machines = selectMachineViews(derived);
  const name = derived.state.settings.casinoName;

  return (
    <Panel
      className="panel--casino"
      title="Casino Floor"
      /*
        The player's name for the place, and a way back to changing it.

        `title` stays "Casino Floor" — see `Panel`'s `heading` prop. That is the
        region's accessible name and the handle ten end-to-end tests address it
        by, and it must not move every time the player changes their mind.

        The button carries its own accessible name because "Bob's Casino Floor"
        says what the floor is called and nothing about what pressing it does.
      */
      heading={
        <button
          type="button"
          className="panel__heading-button"
          aria-label="Rename the casino"
          title="Rename the casino"
          onClick={onRename}
        >
          {name === null ? "Casino Floor" : `${name}'s Casino Floor`}
        </button>
      }
      anchorId="casino"
      fit
      fill
    >
      <ul className="machine-grid">
        {machines.map((view) => (
          <MachineTile key={view.id} view={view} />
        ))}
      </ul>
    </Panel>
  );
}
