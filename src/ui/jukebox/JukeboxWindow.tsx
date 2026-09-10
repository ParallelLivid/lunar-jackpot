/**
 * The jukebox: a standing choice of music that nothing in the game overrides.
 * Unlocked at `ECONOMY.jukeboxUnlockDepth`, so there is no locked state to
 * render — `unlockedRailEntries` keeps it out of both the rail and the window
 * layer until then.
 *
 * The whole window is one radio group. "Follow the scene" is the first option
 * rather than a checkbox above the list, because it is a seventh answer to one
 * question rather than a mode the six tracks sit inside.
 */

import { MUSIC_TRACKS, MUSIC_TRACK_IDS, type MusicTrackId } from "../../content/music";
import { DEPTH_BANDS, type DepthBandId } from "../../content/depthBands";
import { useDispatch, useGameState } from "../layout";

const FOLLOW_THE_SCENE = "follow";

/** Where a track is normally heard, so the list reads as places, not filenames. */
function whereItPlays(trackId: MusicTrackId): string {
  if (trackId === "music.casino") {
    return "The casino, and the surface";
  }

  const band = DEPTH_BANDS[trackId.slice("music.".length) as DepthBandId];

  return band.maximum === null
    ? `Depth ${String(band.minimum)} and below`
    : `Depth ${String(band.minimum)} to ${String(band.maximum)}`;
}

export function JukeboxWindow() {
  const state = useGameState();
  const dispatch = useDispatch();
  const { jukebox } = state.settings;
  const selected = jukebox.enabled ? jukebox.trackId : FOLLOW_THE_SCENE;

  const choose = (value: string): void => {
    dispatch({
      type: "UPDATE_SETTINGS",
      patch:
        value === FOLLOW_THE_SCENE
          ? // The track is kept, not cleared: switching back returns to whatever
            // was last chosen rather than to the casino.
            { jukebox: { enabled: false, trackId: jukebox.trackId } }
          : { jukebox: { enabled: true, trackId: value as MusicTrackId } },
    });
  };

  const option = (value: string, name: string, detail: string) => (
    <li className="option" key={value}>
      <label className="jukebox-option">
        <input
          type="radio"
          name="jukebox-track"
          value={value}
          checked={selected === value}
          onChange={() => {
            choose(value);
          }}
        />
        <span className="option__body">
          <span className="option__name">
            <span className="option__name-text">{name}</span>
          </span>
          <span className="option__detail">{detail}</span>
        </span>
      </label>
    </li>
  );

  return (
    <div
      className="panel--jukebox window-panel"
      // What is playing, for the end-to-end tests: music is not audible to a
      // browser harness, and asserting on the checked radio would test the
      // control rather than the state it produced.
      data-track={selected}
    >
      <ul className="option-list" role="radiogroup" aria-label="Music">
        {option(
          FOLLOW_THE_SCENE,
          "Follow the scene",
          "The casino on the surface, and each depth band as you reach it.",
        )}
        {MUSIC_TRACK_IDS.map((trackId) =>
          option(trackId, MUSIC_TRACKS[trackId].displayName, whereItPlays(trackId)),
        )}
      </ul>

      {/*
        The one thing a player will otherwise report as a bug.

        Someone who picks a track with the music slider at zero hears nothing and
        has no way to tell the jukebox from a broken jukebox. Said here rather
        than only in Settings, because this is the window they are looking at.
      */}
      <p className="description">
        {state.settings.muted || state.settings.musicVolume === 0
          ? "Music is currently silenced in Settings. Raise the music volume to hear this."
          : "Volume stays in Settings. A chosen track plays through launches, depth changes and failures."}
      </p>
    </div>
  );
}
