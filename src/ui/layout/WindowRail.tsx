/**
 * The right-edge rail that opens the windowed systems.
 *
 * Every button is icon-only, so each carries an accessible name and a tooltip,
 * and an attention marker is a shape rather than a colour alone.
 */

import type { RefObject } from "react";
import { ECONOMY } from "../../content/catalog";
import { selectRailAttention, type WindowId } from "../../domain/selectors";
import type { GameState } from "../../domain/state";
import { PixelSprite } from "../shared/PixelSprite";
import { useDerived } from "./GameRuntimeContext";

export interface RailEntry {
  id: WindowId;
  title: string;
  spriteId: string;
  hint: string;
  /**
   * Set where a window needs more than the default frame width. Named rather
   * than a boolean, because the store wants a third width that the two-column
   * perk tree does not.
   */
  width?: "wide" | "widest";
  /**
   * Lay the window's contents out to fill its frame rather than leaving the
   * right-hand edge blank once they are scaled. See `.panel__fit--fill`.
   */
  fill?: boolean;
  /**
   * When present, the entry is absent from the rail until this returns true. A
   * predicate, because the rail is a module-level constant and the condition is
   * a fact about the save. Absent rather than disabled: a greyed button would
   * announce a reward the player has not found yet.
   */
  unlockedWhen?: (state: GameState) => boolean;
}

/**
 * The entries this save may open, used by the rail and by the window layer in
 * `GameApp`. Filtering only the rail would leave a locked window openable from a
 * stale `openWindows` entry after an import.
 */
export function unlockedRailEntries(state: GameState): RailEntry[] {
  return RAIL_ENTRIES.filter((entry) => entry.unlockedWhen?.(state) ?? true);
}

/** Icons reuse existing sprites rather than inventing a second art set. */
export const RAIL_ENTRIES: RailEntry[] = [
  {
    id: "settings",
    title: "Settings",
    spriteId: "sprite.trinket.regulator",
    hint: "Audio, motion, number format, and the rules",
  },
  {
    id: "save",
    title: "Save",
    spriteId: "sprite.resource.cash",
    hint: "Save status, export, import, and reset",
  },
  {
    id: "store",
    title: "The Company Store",
    spriteId: "sprite.resource.keys",
    hint: "Buy keys and caches, and open them",
    // Three columns — supply, expedition supplies, caches — which need more
    // frame than the two the perk tree is sized for: at 46rem they come out
    // 227px each, narrow enough that a cache offer's text wraps the window taller.
    width: "widest",
    // Its columns are `auto-fit`, which fill mode is normally kept away from —
    // but with three sections there are only three tracks to hand out, so a
    // wider layout widens the columns rather than multiplying them. Measured:
    // 171px of dead space at 1280x720 without it, 2px with.
    fill: true,
  },
  {
    id: "gambling",
    title: "Chip Gambling",
    spriteId: "sprite.totem.gambler",
    hint: "Slots, roulette, blackjack, and the depth wager",
  },
  {
    id: "prestige",
    title: "Prestige",
    spriteId: "sprite.prestige",
    hint: "Selenite, permanent perks, and the reset",
    // Three perk branches side by side; the default frame is a single column.
    width: "wide",
  },
  {
    id: "gear",
    title: "Gear and Trinkets",
    spriteId: "sprite.gear.pickaxe",
    hint: "Tank, pickaxe, and trinkets",
    // Tank and pickaxe side by side with their trinkets beneath: four columns
    // the single-column frame cannot hold without every card becoming a strip.
    width: "wide",
  },
  {
    id: "totems",
    title: "Totems",
    spriteId: "sprite.totem.prospector",
    hint: "Active totems and luck",
  },
  {
    id: "skins",
    title: "Skins",
    spriteId: "sprite.cat.rest",
    hint: "Looks for your cats and your miner",
    // Two collections side by side; a single column would stack twelve tiles.
    width: "wide",
  },
  {
    id: "statSheet",
    // "Buffs" to the player, `statSheet` in the code: the id is a key in
    // `WindowId`, `WINDOW_CONTENT` and `selectRailAttention`.
    title: "Buffs",
    // The lantern, not the regulator: Settings owns that one, and in an
    // icon-only rail two identical icons are indistinguishable.
    spriteId: "sprite.totem.lantern",
    hint: "Every gear, trinket, totem, cat and perk bonus in one place",
    // Five groups — gear, expedition, casino, prestige, luck — which stacked is
    // taller than any screen. Side by side they read as a sheet.
    width: "wide",
    // Unfilled, this draws its contents at `scale` of the frame's width and
    // leaves the rest blank — 73px at 800x600, 48px at 1280x620, anywhere the
    // fit drops below 1. Safe here only because `.stat-sheet-groups` states its
    // track floor in drawn pixels; without that the groups would stop
    // collapsing on a narrow frame, which is why the flag is opt-in.
    fill: true,
  },
  {
    id: "help",
    title: "Help",
    spriteId: "sprite.help",
    hint: "How every system works, in one place",
    // Two panes, a topic list beside the topic, in the widest frame the rail
    // offers, because the body is laid out in columns rather than scrolled.
    width: "widest",
    // Nothing here may scroll, and an unfilled window leaves the right-hand edge
    // blank — which on a short viewport is where the columns need the room.
    fill: true,
  },
  {
    id: "jukebox",
    title: "Jukebox",
    spriteId: "sprite.jukebox",
    hint: "Choose the music, and keep it",
    // Last on the rail, and the only entry that is not always there. Appended
    // rather than slotted in, so every other button stays where the player
    // learned it on the day this one appears.
    unlockedWhen: (state) => state.statistics.deepestDepth >= ECONOMY.jukeboxUnlockDepth,
  },
  {
    id: "stats",
    title: "Statistics",
    spriteId: "sprite.totem.ledger",
    hint: "What this save has done, since the beginning",
    // A column of label-and-value rows, with no column count for a wider layout
    // to get wrong, so filling buys back 61px at 1280x720 and costs nothing.
    fill: true,
  },
];

interface WindowRailProps {
  openWindows: readonly WindowId[];
  onToggle: (id: WindowId) => void;
  buttonRefs: RefObject<Partial<Record<WindowId, HTMLButtonElement | null>>>;
}

export function WindowRail({ buttonRefs, onToggle, openWindows }: WindowRailProps) {
  const derived = useDerived();
  const attention = selectRailAttention(derived);

  return (
    <nav className="window-rail" aria-label="Panels" data-tutorial-anchor="rail">
      <ul className="window-rail__list">
        {unlockedRailEntries(derived.state).map((entry) => {
          const open = openWindows.includes(entry.id);
          const marker = attention[entry.id];
          // Two different claims, so two different words: announcing "action
          // available" over a wheel the player can only wait for would mislead.
          const markerLabel =
            marker === "action" ? " (action available)" : marker === "busy" ? " (in progress)" : "";

          return (
            <li key={entry.id}>
              <button
                type="button"
                ref={(element) => {
                  buttonRefs.current[entry.id] = element;
                }}
                className={`rail-button${open ? " rail-button--open" : ""}`}
                // One anchor per button, so a tutorial card can point at the
                // window it means. The nav keeps `rail` for a card meaning all.
                data-tutorial-anchor={`rail.${entry.id}`}
                aria-pressed={open}
                aria-label={`${entry.title}${markerLabel}`}
                title={`${entry.title} — ${entry.hint}`}
                onClick={() => {
                  onToggle(entry.id);
                }}
              >
                <PixelSprite spriteId={entry.spriteId} scale={3} />
                <span className="rail-button__label">{entry.title}</span>
                {marker === "none" ? null : (
                  <span
                    className={`rail-button__dot rail-button__dot--${marker}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        A save that has been edited says so, permanently.

        Outside the button list and not focusable: it is a note about the save,
        not somewhere to go. Nothing clears it — a full reset builds a different
        save, which is why "until the save is reset" needed no code.
      */}
      {derived.state.devMenuUsed ? (
        <p className="window-rail__mark" title="Developer tools have been used on this save.">
          <span aria-hidden="true">DEV</span>
          <span className="sr-only">Developer tools have been used on this save.</span>
        </p>
      ) : null}
    </nav>
  );
}
