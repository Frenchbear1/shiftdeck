/**
 * Decides a shift's time from several independent reads of the same cell:
 * the full-page OCR passes plus a digits-only re-read of just that cell.
 * Previous weeks and coworkers on the same day only break ties or raise a
 * "check" flag; they never overrule reads that all agree.
 */

export type TimeReading = {
  start: string;
  end: string;
  /** 0–1, from the OCR word confidence. */
  weight: number;
  source: "page" | "cell";
};

export type TimePrior = {
  field: "start" | "end";
  value: string;
  /** Weeks (or coworkers) that had this time. */
  count: number;
  from: "history" | "coworkers";
};

export type TimeVerdict = {
  start: string;
  end: string;
  level: "confident" | "check";
  note?: string;
  /** Number of independent reads that match the result exactly. */
  support: number;
};

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const compact = (time: string) => time.replace(":", "");

/** Shown as "1 AM", "5:30 PM" in notes. */
export const spokenTime = (time: string) => {
  const hours = Number(time.slice(0, 2));
  const mins = time.slice(3, 5);
  const suffix = hours < 12 ? "AM" : "PM";
  const hour = hours % 12 || 12;
  return mins === "00" ? `${hour} ${suffix}` : `${hour}:${mins} ${suffix}`;
};

/** True when two HH:MM times differ in exactly one digit (0100 vs 0200). */
export const oneDigitApart = (left: string, right: string) => {
  const a = compact(left);
  const b = compact(right);
  if (a.length !== b.length || a === b) return false;
  let differences = 0;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) differences += 1;
  return differences === 1;
};

/**
 * Digits-only reads come back like "1700-0100". A grid line at the edge of the
 * cell can add a stray "1", so keep the four digits nearest the dash.
 */
export function readCellDigits(text: string) {
  const parts = text.replace(/[–—_~]/g, "-").replace(/[^\d-]/g, "").split(/-+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [left, right] = parts;
  if (left.length < 3 || right.length < 3) return null;
  const clock = (digits: string) => {
    const hours = Number(digits.slice(0, 2));
    const mins = Number(digits.slice(2));
    return hours <= 23 && mins <= 59 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : null;
  };
  const start = clock((left.length > 4 ? left.slice(-4) : left).padStart(4, "0"));
  const end = clock((right.length > 4 ? right.slice(0, 4) : right).padStart(4, "0"));
  return start && end ? { start, end } : null;
}

const PRIOR_WEIGHT = { history: 0.3, coworkers: 0.15 } as const;

function pick(readings: TimeReading[], field: "start" | "end", priors: TimePrior[], contested: boolean) {
  const scores = new Map<string, number>();
  for (const reading of readings) {
    const value = reading[field];
    scores.set(value, (scores.get(value) ?? 0) + reading.weight * (reading.source === "cell" ? 1.25 : 1));
  }
  if (contested) {
    for (const prior of priors) {
      if (prior.field !== field || !scores.has(prior.value)) continue;
      scores.set(prior.value, scores.get(prior.value)! + PRIOR_WEIGHT[prior.from] * Math.min(prior.count, 4));
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function decideShiftTime(readings: TimeReading[], priors: TimePrior[] = []): TimeVerdict | null {
  const usable = readings.filter((reading) => /^\d\d:\d\d$/.test(reading.start) && /^\d\d:\d\d$/.test(reading.end));
  if (!usable.length) return null;
  const contested = new Set(usable.map((reading) => `${reading.start}-${reading.end}`)).size > 1;
  const start = pick(usable, "start", priors, contested);
  const end = pick(usable, "end", priors, contested);
  const agreeing = usable.filter((reading) => reading.start === start && reading.end === end);
  const support = agreeing.length;
  const best = Math.max(...agreeing.map((reading) => reading.weight), 0);
  const cellAgrees = agreeing.some((reading) => reading.source === "cell");

  let level: TimeVerdict["level"] = !contested && (support >= 2 || best >= 0.82) ? "confident" : "check";
  let note: string | undefined;

  if (contested) {
    const others = [...new Set(usable
      .filter((reading) => reading.start !== start || reading.end !== end)
      .map((reading) => `${compact(reading.start)}–${compact(reading.end)}`))];
    note = `Also read as ${others.join(", ")}`;
    // A clear majority that includes the digits-only cell read is still trusted.
    if (cellAgrees && support >= 2 && support > usable.length - support && best >= 0.82) {
      level = "confident";
      note = `Read ${support} of ${usable.length} ways the same`;
    }
  } else if (support >= 2) {
    note = `Read the same ${support} ways`;
  }

  // Shift times are written on 5-minute marks and last 2–16 hours.
  const length = (minutes(end) - minutes(start) + 1440) % 1440 || 1440;
  if (Number(start.slice(3)) % 5 || Number(end.slice(3)) % 5) {
    level = "check";
    note = "Unusual minutes";
  } else if (length < 120 || length > 16 * 60) {
    level = "check";
    note = "Unusual shift length";
  }

  // A one-digit slip (0100 → 0200) is the classic misread. When it doesn't
  // match what this person usually works on this weekday, or what coworkers
  // work that day, say so unless three separate reads agree.
  if (support < 3) {
    for (const field of ["end", "start"] as const) {
      const value = field === "start" ? start : end;
      const strong = priors
        .filter((prior) => prior.field === field && prior.value !== value &&
          (prior.from === "history" ? prior.count >= 2 : prior.count >= 3) &&
          oneDigitApart(prior.value, value))
        .sort((a, b) => b.count - a.count)[0];
      const seen = priors.some((prior) => prior.field === field && prior.value === value);
      if (strong && !seen) {
        level = "check";
        note = strong.from === "history"
          ? `${field === "end" ? "Usually ends" : "Usually starts"} ${spokenTime(strong.value)} on this day`
          : `Coworkers ${field === "end" ? "end" : "start"} ${spokenTime(strong.value)} that day`;
        break;
      }
    }
  }

  return { start, end, level, note, support };
}
