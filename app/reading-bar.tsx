"use client";

import { formatTimeLeft, type ReadProgress } from "./read-progress";

/** A progress bar with what's being read and about how long is left. */
export function ReadingBar({ progress }: { progress: ReadProgress }) {
  const percent = Math.round(progress.fraction * 100);
  return (
    <div
      className="reading-bar"
      role="progressbar"
      aria-label={progress.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% · ${formatTimeLeft(progress.secondsLeft)}`}
    >
      <div className="reading-bar-text">
        <b>{progress.label}</b>
        <span>{percent}%</span>
      </div>
      <div className="reading-bar-track"><i style={{ width: `${Math.max(2, percent)}%` }} /></div>
      <small>{formatTimeLeft(progress.secondsLeft)}</small>
    </div>
  );
}
