/**
 * Progress for reading screenshots, driven by time rather than the OCR
 * engine's own percentages. Tesseract reports nothing while it lays out
 * the page, climbs to 70% while recognizing, then jumps to 100%; following
 * that made the bar stall, crawl and leap.
 *
 * Instead each step has an expected duration, learned from this phone's
 * past reads (kept on the phone) and corrected as the current run goes, and
 * the bar fills by the clock so it moves steadily and lands when the work does.
 */

export type ReadProgress = {
  label: string;
  /** 0–1 */
  fraction: number;
  /** null until there's enough to go on. */
  secondsLeft: number | null;
};

/** Kinds of work, each with its own learned pace. */
export type ReadStep = "load" | "contact-shot" | "directory-shot" | "number-check" | "pdf-page";

/** Starting guesses for a phone (ms per unit; screenshots are per megapixel). */
const DEFAULT_PACE: Record<ReadStep, number> = {
  load: 2500,
  "contact-shot": 1800,
  "directory-shot": 2600,
  "number-check": 140,
  "pdf-page": 120,
};

const SPEED_KEY = "shiftdeck.readSpeed";
/** Tesseract's recognizing progress ends at 70%, then it's done. */
const RECOGNIZED_AT = 0.7;

type Speed = Partial<Record<ReadStep, number>> & { checksPerShot?: number };

function loadSpeed(): Speed {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(SPEED_KEY) ?? "{}");
    return saved && typeof saved === "object" ? saved as Speed : {};
  } catch {
    return {};
  }
}

function saveSpeed(speed: Speed) {
  try {
    globalThis.localStorage?.setItem(SPEED_KEY, JSON.stringify(speed));
  } catch {
    // Private mode or full storage: the estimate just starts fresh next time.
  }
}

/** How many numbers a directory screenshot usually has, from past reads. */
export const expectedChecksPerShot = () => loadSpeed().checksPerShot ?? 20;

type Planned = { step: ReadStep; size: number };

export function progressClock(
  report: (progress: ReadProgress) => void,
  { now = () => Date.now(), tick = true }: { now?: () => number; tick?: boolean } = {},
) {
  const speed = loadSpeed();
  const pace = (step: ReadStep) => speed[step] ?? DEFAULT_PACE[step];
  const startedAt = now();
  let queue: Planned[] = [];
  let label = "Starting…";
  let current: (Planned & { at: number; recognizedFrom: number | null; recognized: number }) | null = null;
  // This run's actual time vs. expected, per kind, to correct what's left.
  const seen: Partial<Record<ReadStep, { actual: number; expected: number }>> = {};
  let lastFraction = 0;
  let lastSize = 3;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;

  const factor = (step: ReadStep) => {
    const run = seen[step];
    if (!run || run.expected <= 0) return 1;
    // This run's own pace is the best guess for the rest of it.
    return run.actual / run.expected;
  };
  const expected = (item: Planned) => pace(item.step) * item.size * factor(item.step);

  /** How long the current step will take in all, using its live progress once it has some. */
  const currentTotal = (at: number) => {
    if (!current) return 0;
    const elapsed = at - current.at;
    let total = expected(current);
    if (current.recognizedFrom !== null && current.recognized >= 0.08) {
      const share = Math.min(1, current.recognized / RECOGNIZED_AT);
      const measured = (current.recognizedFrom - current.at) + (at - current.recognizedFrom) / share;
      total = total * (1 - share) + measured * share;
    }
    // Running long: assume it's most of the way, never "done" early.
    return Math.max(total, elapsed / 0.92, elapsed + 250);
  };

  const send = () => {
    if (done) return;
    const at = now();
    const left = Math.max(0, (current ? currentTotal(at) - (at - current.at) : 0) +
      queue.reduce((sum, item) => sum + expected(item), 0));
    const elapsed = at - startedAt;
    const target = Math.min(0.99, elapsed / Math.max(1, elapsed + left));
    // Glide toward the estimate so a correction never shows as a jump; never go back.
    const fraction = Math.max(lastFraction, lastFraction + (target - lastFraction) * 0.35);
    lastFraction = fraction;
    // Before this phone has any history, wait for a little of the run first.
    const known = Object.keys(seen).some((step) => step !== "load") ||
      (current ? speed[current.step] !== undefined : false);
    report({ label, fraction, secondsLeft: known || elapsed > 2500 ? left / 1000 : null });
  };

  if (tick && typeof setInterval === "function") timer = setInterval(send, 200);

  return {
    /** What's still to come after the current step (replaces the earlier plan). */
    plan(items: Array<{ step: ReadStep; count?: number; size?: number }>) {
      queue = items.flatMap(({ step, count = 1, size }) =>
        Array.from({ length: Math.max(0, Math.round(count)) }, () =>
          ({ step, size: size ?? (step.endsWith("shot") ? lastSize : 1) })));
      send();
    },
    /** Starts the next step; it's taken off the plan if it was on it. */
    start(text: string, step: ReadStep, size?: number) {
      const index = queue.findIndex((item) => item.step === step);
      const planned = index >= 0 ? queue.splice(index, 1)[0] : null;
      current = {
        step,
        size: size ?? planned?.size ?? (step.endsWith("shot") ? lastSize : 1),
        at: now(),
        recognizedFrom: null,
        recognized: 0,
      };
      if (size) this.size(size);
      label = text;
      send();
    },
    /** Once a screenshot is opened, its real size (megapixels). */
    size(megapixels: number) {
      if (!current || !(megapixels > 0)) return;
      current.size = megapixels;
      lastSize = megapixels;
      for (const item of queue) if (item.step === current.step) item.size = megapixels;
    },
    /** Tesseract's "recognizing text" progress for the current step. */
    recognizing(progress: number) {
      if (!current) return;
      if (current.recognizedFrom === null) current.recognizedFrom = now();
      current.recognized = Math.max(current.recognized, progress);
    },
    /** The current step is done; its time teaches the estimate. */
    end() {
      if (!current) return;
      const actual = now() - current.at;
      // A reader that was already warm loads instantly; that says nothing about a cold load.
      if (current.step !== "load" || actual > 300) {
        const run = seen[current.step] ?? { actual: 0, expected: 0 };
        run.actual += actual;
        run.expected += pace(current.step) * current.size;
        seen[current.step] = run;
      }
      current = null;
      send();
    },
    /** Remembers how many numbers each directory screenshot had. */
    noteChecks(perShot: number) {
      speed.checksPerShot = Math.round(speed.checksPerShot === undefined ? perShot : speed.checksPerShot * 0.4 + perShot * 0.6);
    },
    finish(text = "Done") {
      if (done) return;
      if (timer) clearInterval(timer);
      timer = null;
      for (const [step, run] of Object.entries(seen) as Array<[ReadStep, { actual: number; expected: number }]>) {
        if (run.expected <= 0) continue;
        const observed = pace(step) * (run.actual / run.expected);
        speed[step] = Math.round(speed[step] === undefined ? observed : speed[step]! * 0.4 + observed * 0.6);
      }
      saveSpeed(speed);
      done = true;
      report({ label: text, fraction: 1, secondsLeft: 0 });
    },
    /** Reports now (the clock also does this on its own every 200 ms). */
    refresh: send,
    /** Stops the clock without learning (the read failed). */
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      done = true;
    },
  };
}

export function formatTimeLeft(seconds: number | null) {
  if (seconds === null) return "Estimating time…";
  if (seconds < 4) return "Almost done";
  if (seconds < 60) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} sec left`;
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? "About 1 min left" : `About ${minutes} min left`;
}
