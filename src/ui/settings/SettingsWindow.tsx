/** Audio, motion, and number-format preferences. The rules live in Help. */

import type { ChangeEvent } from "react";
import { useDispatch, useGameState } from "../layout";

export function SettingsWindow() {
  const state = useGameState();
  const dispatch = useDispatch();

  const volume = (
    label: string,
    key: "masterVolume" | "musicVolume" | "sfxVolume" | "machineVolume",
    description?: string,
  ) => (
    <label className="setting" title={description}>
      <span className="setting__label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(state.settings[key] * 100)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          dispatch({
            type: "UPDATE_SETTINGS",
            patch: { [key]: Number(event.target.value) / 100 },
          });
        }}
      />
      <span className="setting__value">{Math.round(state.settings[key] * 100)}</span>
    </label>
  );

  const toggle = (
    label: string,
    key: "muted" | "reducedMotion" | "screenShake" | "singleWindowMode",
    description: string,
  ) => (
    <label className="setting setting--toggle" title={description}>
      <input
        type="checkbox"
        checked={state.settings[key]}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          dispatch({ type: "UPDATE_SETTINGS", patch: { [key]: event.target.checked } });
        }}
      />
      <span className="setting__label">{label}</span>
    </label>
  );

  return (
    <div className="panel--settings window-panel settings-grid">
      {volume("Master", "masterVolume")}
      {volume(
        "Music",
        "musicVolume",
        "The casino and each depth band have their own track. Set this to zero to stop the music entirely.",
      )}
      {volume("Effects", "sfxVolume")}
      {/*
        Under Effects, because that is what it is a part of: the machine cue is a
        sub-mix of the effects channel rather than a channel of its own.

        A slider rather than a switch: the cue is the loudest repeated sound in
        the game, so "too much" is the commoner complaint and a switch can only
        answer "at all". Zero is still the switch for anyone who wanted that.
      */}
      {volume(
        "Machines",
        "machineVolume",
        "The payout cue, ten machines at a time on a full floor. Set this to zero to silence it while keeping every other sound.",
      )}
      {toggle("Mute", "muted", "Silences all audio.")}
      {toggle(
        "Reduced motion",
        "reducedMotion",
        "Replaces scrolling and reel animation with instant state changes. Timing and rewards are unchanged.",
      )}
      {toggle("Screen shake", "screenShake", "Toggles impact shake effects.")}
      {toggle(
        "One window at a time",
        "singleWindowMode",
        "Opening a panel from the rail closes the one already open. Turn this off to keep several open side by side.",
      )}
      <label className="setting setting--toggle">
        <input
          type="checkbox"
          checked={state.settings.numberFormat === "exact"}
          onChange={(event) => {
            dispatch({
              type: "UPDATE_SETTINGS",
              patch: { numberFormat: event.target.checked ? "exact" : "compact" },
            });
          }}
        />
        <span className="setting__label">Always show exact numbers</span>
      </label>

      {/*
        No "How it works" list here: every line of it is a topic in the Help
        window, stated properly rather than a sentence each, and a summary of the
        whole game under the volume sliders is clutter.

        One line stays, because it is not help text. The fictional-currency
        statement is a compliance line and belongs somewhere a player does not
        have to go looking for it. It appears in Help too, deliberately.
      */}
      <p className="description">
        All currency here is fictional. There is no real-money play of any kind.
      </p>
    </div>
  );
}
