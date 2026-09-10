/**
 * The chip floor: four games behind one set of tabs rather than four rail
 * windows. The rail is a set of reference panels for different systems, and
 * these are four faces of one — choosing between roulette and blackjack is a
 * decision inside gambling. It also means the "virtual chips only" statement is
 * made once above all four rather than four times.
 *
 * Which tab is open is presentation state and is not saved.
 */

import { useState, type ReactNode } from "react";
import { CHIP_GAME_NAMES, type ChipGameId } from "../../content/chipGames";
import { useDerived } from "../layout";
import { BlackjackGame } from "./BlackjackGame";
import { DepthWagerGame } from "./DepthWagerGame";
import { RouletteGame } from "./RouletteGame";
import { SlotGame } from "./SlotGame";

const GAME_ORDER: ChipGameId[] = [
  "game.slots",
  "game.roulette",
  "game.blackjack",
  "game.depthWager",
];

const GAME_CONTENT: Record<ChipGameId, () => ReactNode> = {
  "game.slots": () => <SlotGame />,
  "game.roulette": () => <RouletteGame />,
  "game.blackjack": () => <BlackjackGame />,
  "game.depthWager": () => <DepthWagerGame />,
};

/**
 * A tab is marked when that game is holding something of the player's. Switching
 * tabs mid-hand loses nothing, since every commitment lives in the save, but a
 * player who wandered off should be able to see where their chips are.
 */
function useLiveGames(): Set<ChipGameId> {
  const gambling = useDerived().state.gambling;
  const live = new Set<ChipGameId>();

  if (gambling.committedSpin !== null) {
    live.add("game.slots");
  }

  if (gambling.roulette.committedBet !== null) {
    live.add("game.roulette");
  }

  if (gambling.blackjack.hand?.status === "player") {
    live.add("game.blackjack");
  }

  if (gambling.depthWager.pending !== null) {
    live.add("game.depthWager");
  }

  return live;
}

export function GamblingPanel() {
  const [openGame, setOpenGame] = useState<ChipGameId>("game.slots");
  const live = useLiveGames();

  return (
    <div className="panel--gambling window-panel">
      <p className="window-panel__status">Virtual chips only</p>

      <div className="game-tabs" role="tablist" aria-label="Chip games">
        {GAME_ORDER.map((gameId) => (
          <button
            key={gameId}
            type="button"
            role="tab"
            id={`game-tab-${gameId}`}
            aria-selected={gameId === openGame}
            aria-controls={`game-panel-${gameId}`}
            className={`game-tab${gameId === openGame ? " game-tab--open" : ""}`}
            onClick={() => {
              setOpenGame(gameId);
            }}
          >
            {CHIP_GAME_NAMES[gameId]}
            {live.has(gameId) ? (
              <>
                <span className="game-tab__dot" aria-hidden="true" />
                <span className="sr-only"> (in play)</span>
              </>
            ) : null}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`game-panel-${openGame}`}
        aria-labelledby={`game-tab-${openGame}`}
      >
        {GAME_CONTENT[openGame]()}
      </div>
    </div>
  );
}
