/**
 * Progress for reading screenshots, with a time-left estimate measured from
 * how long this phone actually takes (not a guess).
 */

export type ReadProgress = {
  label: string;
  /** 0–1 */
  fraction: number;
  /** null until there's enough to go on. */
  secondsLeft: number | null;
};

/**
 * Work is counted in units (one screenshot = 1). Each step can say how much
 * of its unit is done; time per unit is learned as it goes, so the estimate
 * settles quickly and stays honest.
 */
const WINDOW_MS = 8000;

export function progressClock(report: (progress: ReadProgress) => void, now = () => Date.now()) {
  let total = 1;
  let done = 0;
  let label = "Starting…";
  // Recent (time, units done) points; the pace comes from the last few seconds,
  // so a slow warm-up doesn't inflate the estimate.
  let samples: Array<{ at: number; done: number }> | null = null;
  let lastSent = 0;
  let carried: { left: number; at: number } | null = null;

  const send = (force = false) => {
    const at = now();
    if (!force && at - lastSent < 120) return;
    lastSent = at;
    const fraction = Math.max(0, Math.min(1, done / total));
    let secondsLeft: number | null = null;
    if (samples) {
      samples.push({ at, done });
      while (samples.length > 2 && at - samples[1].at >= WINDOW_MS) samples.shift();
      const progressed = done - samples[0].done;
      const elapsed = at - samples[0].at;
      if (progressed > 0.2 && elapsed > 800) {
        secondsLeft = Math.max(0, ((total - done) * elapsed) / progressed / 1000);
        carried = { left: secondsLeft, at };
      }
    }
    // While a new step is still being timed, keep counting down the last estimate.
    if (secondsLeft === null && carried) secondsLeft = Math.max(0, carried.left - (at - carried.at) / 1000);
    report({ label, fraction, secondsLeft });
  };

  return {
    /** Total units of work (can change once more is known). */
    setTotal(units: number) {
      total = Math.max(units, done, 0.0001);
      send(true);
    },
    /** Starts timing from here (after the reader loads, or when a different kind of step begins). */
    startTiming() {
      samples = [{ at: now(), done }];
    },
    step(text: string) {
      label = text;
      send(true);
    },
    /** Sets how many units are finished, including part of the current one. */
    at(units: number) {
      done = Math.min(total, Math.max(done, units));
      send();
    },
    finish(text = "Done") {
      label = text;
      done = total;
      send(true);
    },
  };
}

export function formatTimeLeft(seconds: number | null) {
  if (seconds === null) return "Estimating time…";
  if (seconds < 4) return "Almost done";
  if (seconds < 60) return `About ${Math.ceil(seconds / 5) * 5} sec left`;
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? "About 1 min left" : `About ${minutes} min left`;
}
