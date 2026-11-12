import type { Flight, Shift } from "./sample-data";
import type { ParsedSchedule } from "./schedule-parser";

/* ---------- import progress ---------- */

export const IMPORT_STAGES = [
  "Getting ready",
  "Reading",
  "Double-checking",
  "Saving",
] as const;

export type ImportSnapshot = {
  progress: number;
  stage: number;
  detail: string;
};

/**
 * Progress for a whole import batch. Every value only moves forward, so the
 * bar and the status line never jump back between OCR passes or files.
 */
export function createImportProgress(
  fileCount: number,
  emit: (snapshot: ImportSnapshot) => void,
) {
  let progress = 0;
  let stage = 0;
  let detail = "";
  const files = Math.max(1, fileCount);
  const push = () => emit({ progress: Math.floor(progress), stage, detail });
  return {
    stage(next: number) {
      if (next <= stage) return;
      stage = Math.min(next, IMPORT_STAGES.length - 1);
      push();
    },
    detail(text: string) {
      if (text === detail) return;
      detail = text;
      push();
    },
    file(index: number, fraction: number) {
      const clamped = Math.max(0, Math.min(1, fraction));
      const value = 2 + ((index + clamped) / files) * 92;
      if (Math.floor(value) <= Math.floor(progress)) return;
      progress = value;
      push();
    },
    finish() {
      stage = IMPORT_STAGES.length - 1;
      progress = 100;
      push();
    },
    snapshot: (): ImportSnapshot => ({ progress: Math.floor(progress), stage, detail }),
  };
}

/** Good enough that another OCR pass is unlikely to recover more. */
export function isStrongScheduleRead(parsed: ParsedSchedule | null) {
  if (!parsed) return false;
  const working = parsed.shifts.filter((shift) => shift.status === "working");
  const workers = new Set(parsed.shifts.map((shift) => shift.worker));
  return (
    parsed.confidence >= 72 &&
    parsed.dates.length >= 7 &&
    parsed.flights.length > 0 &&
    workers.size >= 3 &&
    working.length >= workers.size
  );
}

/* ---------- time + date helpers ---------- */

export const toMinutes = (time: string) => {
  if (!time) return 0;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/** Start/end in minutes, with the end pushed past midnight for overnight shifts. */
export const normalizedInterval = (start: string, end: string) => {
  const startMinutes = toMinutes(start);
  let endMinutes = toMinutes(end);
  if (endMinutes <= startMinutes) endMinutes += 1440;
  return [startMinutes, endMinutes] as const;
};

export const shiftsOverlap = (first: Shift, second: Shift) => {
  const [aStart, aEnd] = normalizedInterval(first.start, first.end);
  let [bStart, bEnd] = normalizedInterval(second.start, second.end);
  if (aStart > 720 && bStart < 360) {
    bStart += 1440;
    bEnd += 1440;
  }
  return aStart < bEnd && bStart < aEnd;
};

/** "21:30" → "9:30p", "21:00" → "9p". */
export const compactTime = (time: string) => {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "p" : "a";
  const hour = hours % 12 || 12;
  return `${hour}${minutes ? `:${`${minutes}`.padStart(2, "0")}` : ""}${suffix}`;
};

export const minutesToClock = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${`${Math.floor(normalized / 60)}`.padStart(2, "0")}:${`${normalized % 60}`.padStart(2, "0")}`;
};

export const durationLabel = (start: string, end: string) => {
  const [startMinutes, endMinutes] = normalizedInterval(start, end);
  const total = endMinutes - startMinutes;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

const keyFor = (value: Date) =>
  `${value.getFullYear()}-${`${value.getMonth() + 1}`.padStart(2, "0")}-${`${value.getDate()}`.padStart(2, "0")}`;

const dateFor = (key: string) => new Date(`${key}T12:00:00`);

export const addDays = (key: string, amount: number) => {
  const value = dateFor(key);
  value.setDate(value.getDate() + amount);
  return keyFor(value);
};

export const daysBetween = (from: string, to: string) =>
  Math.round((dateFor(to).getTime() - dateFor(from).getTime()) / 86_400_000);

export const startOfWeek = (key: string) => addDays(key, -dateFor(key).getDay());

/* ---------- schedule windows ---------- */

export type ScheduleRange = "3d" | "week" | "2week" | "month";

export const SCHEDULE_RANGES: Array<{ value: ScheduleRange; label: string }> = [
  { value: "3d", label: "3 days" },
  { value: "week", label: "Week" },
  { value: "2week", label: "2 weeks" },
  { value: "month", label: "Month" },
];

export const isScheduleRange = (value: unknown): value is ScheduleRange =>
  value === "3d" || value === "week" || value === "2week" || value === "month";

export type WindowDay = { date: string; inMonth: boolean };

export type ScheduleWindow = {
  days: WindowDay[];
  title: string;
  columns: number;
};

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const shortFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const rangeTitle = (first: string, last: string) => {
  const start = dateFor(first);
  const end = dateFor(last);
  if (start.getMonth() === end.getMonth()) {
    return `${shortFormatter.format(start)} – ${end.getDate()}`;
  }
  return `${shortFormatter.format(start)} – ${shortFormatter.format(end)}`;
};

export function scheduleWindow(
  range: ScheduleRange,
  anchor: string,
  offset: number,
): ScheduleWindow {
  if (range === "month") {
    const base = dateFor(anchor);
    const first = new Date(base.getFullYear(), base.getMonth() + offset, 1, 12);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
    const gridStart = startOfWeek(keyFor(first));
    const gridEnd = addDays(keyFor(last), 6 - last.getDay());
    const total = daysBetween(gridStart, gridEnd) + 1;
    return {
      title: monthFormatter.format(first),
      columns: 7,
      days: Array.from({ length: total }, (_, index) => {
        const date = addDays(gridStart, index);
        return { date, inMonth: dateFor(date).getMonth() === first.getMonth() };
      }),
    };
  }
  const length = range === "3d" ? 3 : range === "week" ? 7 : 14;
  const start =
    range === "3d"
      ? addDays(anchor, offset * 3)
      : addDays(startOfWeek(anchor), offset * length);
  const days = Array.from({ length }, (_, index) => ({
    date: addDays(start, index),
    inMonth: true,
  }));
  return {
    title: rangeTitle(days[0].date, days[days.length - 1].date),
    columns: range === "3d" ? 3 : 7,
    days,
  };
}

/** The window offset that contains `date`, so a selected day stays visible. */
export function offsetContaining(
  range: ScheduleRange,
  anchor: string,
  date: string,
) {
  if (range === "month") {
    const from = dateFor(anchor);
    const to = dateFor(date);
    return (
      (to.getFullYear() - from.getFullYear()) * 12 +
      to.getMonth() -
      from.getMonth()
    );
  }
  if (range === "3d") return Math.floor(daysBetween(anchor, date) / 3);
  const length = range === "week" ? 7 : 14;
  return Math.floor(daysBetween(startOfWeek(anchor), date) / length);
}

/* ---------- flights ---------- */

export type FlightTag = "RON" | "Turn" | "Out";

export const flightTag = (flight: Flight): FlightTag =>
  flight.kind === "turnaround" ? "Turn" : flight.kind === "departure" ? "Out" : "RON";

export const flightTime = (flight: Flight) =>
  flight.kind === "departure"
    ? flight.departure ?? flight.start
    : flight.arrival ?? flight.start;

export const flightPlace = (flight: Flight) =>
  flight.kind === "departure"
    ? flight.outboundAirport ?? flight.destination ?? "TBD"
    : flight.inboundAirport ?? flight.origin;

/** Minutes on the shift's clock, so a 12:30a arrival sorts after 11p on a night shift. */
export const flightMinutesOnShift = (flight: Flight, shift?: Shift | null) => {
  let time = toMinutes(flightTime(flight));
  if (shift && toMinutes(shift.start) > 720 && time < 360) time += 1440;
  return time;
};

export const isFlightInShift = (flight: Flight, shift?: Shift | null) => {
  if (!shift) return false;
  const [start, end] = normalizedInterval(shift.start, shift.end);
  const times = [flight.arrival, flight.departure, flight.start, flight.end].filter(
    (time): time is string => Boolean(time),
  );
  return times.some((value) => {
    let time = toMinutes(value);
    if (start > 720 && time < 360) time += 1440;
    return time >= start && time <= end;
  });
};

/* ---------- crew timeline ---------- */

export type CrewRelation = "mine" | "same" | "overlap";

export type CrewRow = {
  key: string;
  workers: string[];
  start: string;
  end: string;
  left: number;
  width: number;
  relation: CrewRelation;
};

export type CrewTimeline = {
  axisStart: number;
  axisEnd: number;
  rows: CrewRow[];
  ticks: Array<{ left: number; minutes: number }>;
  band: { left: number; width: number } | null;
};

/**
 * Rows for everyone working a day. When you work, only people whose hours
 * overlap yours are kept and the axis frames your shift; on a day off it shows
 * the whole day's crew.
 */
export function buildCrewTimeline(
  dayShifts: Shift[],
  person: string,
  myShift: Shift | null | undefined,
): CrewTimeline | null {
  const working = dayShifts.filter(
    (shift) => shift.status === "working" && shift.start && shift.end,
  );
  const visible = myShift
    ? working.filter(
        (shift) => shift.worker === person || shiftsOverlap(myShift, shift),
      )
    : working.filter((shift) => shift.worker !== person);
  if (!visible.length) return null;

  const eveningAnchor = myShift
    ? toMinutes(myShift.start) > 720
    : visible.some((shift) => toMinutes(shift.start) > 720);
  const intervalOf = (shift: Shift) => {
    let [start, end] = normalizedInterval(shift.start, shift.end);
    if (eveningAnchor && start < 240) {
      start += 1440;
      end += 1440;
    }
    return [start, end] as const;
  };

  const intervals = visible.map(intervalOf);
  let axisStart: number;
  let axisEnd: number;
  if (myShift) {
    const [mineStart, mineEnd] = intervalOf(myShift);
    axisStart = Math.min(mineStart - 60, ...intervals.map(([start]) => start));
    axisEnd = Math.max(mineEnd + 60, ...intervals.map(([, end]) => end));
  } else {
    axisStart = Math.min(...intervals.map(([start]) => start)) - 30;
    axisEnd = Math.max(...intervals.map(([, end]) => end)) + 30;
  }
  axisStart = Math.floor(axisStart / 60) * 60;
  axisEnd = Math.ceil(axisEnd / 60) * 60;
  const span = Math.max(60, axisEnd - axisStart);
  const position = (start: number, end: number) => ({
    left: ((start - axisStart) / span) * 100,
    width: ((end - start) / span) * 100,
  });

  const [mineStart, mineEnd] = myShift ? intervalOf(myShift) : [0, 0];
  const groups = new Map<string, CrewRow>();
  visible.forEach((shift) => {
    const [start, end] = intervalOf(shift);
    const relation: CrewRelation =
      shift.worker === person
        ? "mine"
        : myShift && start === mineStart && end === mineEnd
          ? "same"
          : "overlap";
    const key = `${relation === "mine" ? "mine" : "crew"}-${start}-${end}`;
    const current = groups.get(key);
    if (current) {
      current.workers.push(shift.worker);
      return;
    }
    groups.set(key, {
      key,
      workers: [shift.worker],
      start: shift.start,
      end: shift.end,
      relation,
      ...position(start, end),
    });
  });

  const rows = [...groups.values()].sort((first, second) => {
    if (first.relation === "mine") return -1;
    if (second.relation === "mine") return 1;
    return first.left - second.left || first.width - second.width;
  });
  rows.forEach((row) => row.workers.sort((a, b) => a.localeCompare(b)));

  const step = span > 600 ? 180 : span > 300 ? 120 : 60;
  const ticks: CrewTimeline["ticks"] = [];
  for (let minutes = Math.ceil(axisStart / step) * step; minutes <= axisEnd; minutes += step) {
    ticks.push({ minutes, left: ((minutes - axisStart) / span) * 100 });
  }

  return {
    axisStart,
    axisEnd,
    rows,
    ticks,
    band: myShift ? position(mineStart, mineEnd) : null,
  };
}

/* ---------- shift swap ---------- */

export type SwapDay = {
  date: string;
  start: string;
  end: string;
  score: number;
};

export type SwapMatch = {
  worker: string;
  offDayStatus: "off" | "unscheduled";
  usualStart: number;
  usualEnd: number;
  sampleCount: number;
  swapDays: SwapDay[];
  score: number;
};

export type SwapAnalysis = {
  myShift: Shift | null;
  matches: SwapMatch[];
  coverOnly: SwapMatch[];
};

const closeness = (startA: number, endA: number, startB: number, endB: number) =>
  Math.max(
    0,
    Math.min(100, Math.round(100 - (Math.abs(startA - startB) + Math.abs(endA - endB)) / 9)),
  );

/**
 * Finds coworkers who are free on the day you want off and who work on a day
 * you are off, so both of you keep the same number of shifts.
 */
export function analyzeSwap({
  shifts,
  person,
  offDate,
  swapDate,
  candidateDates,
}: {
  shifts: Shift[];
  person: string;
  offDate: string;
  swapDate?: string | null;
  candidateDates: string[];
}): SwapAnalysis {
  const myShift =
    shifts.find(
      (shift) =>
        shift.worker === person &&
        shift.date === offDate &&
        shift.status === "working",
    ) ?? null;
  if (!myShift) return { myShift: null, matches: [], coverOnly: [] };

  const [myStart, myEnd] = normalizedInterval(myShift.start, myShift.end);
  const byWorker = new Map<string, Shift[]>();
  shifts.forEach((shift) => {
    if (shift.worker === person) return;
    byWorker.set(shift.worker, [...(byWorker.get(shift.worker) ?? []), shift]);
  });

  const myBusyDates = new Set(
    shifts
      .filter(
        (shift) =>
          shift.worker === person &&
          (shift.status === "working" || shift.status === "pto"),
      )
      .map((shift) => shift.date),
  );
  const swapDates = (swapDate ? [swapDate] : candidateDates).filter(
    (date) => date !== offDate && !myBusyDates.has(date),
  );

  const matches: SwapMatch[] = [];
  const coverOnly: SwapMatch[] = [];

  byWorker.forEach((workerShifts, worker) => {
    const onOffDate = workerShifts.filter((shift) => shift.date === offDate);
    if (
      onOffDate.some(
        (shift) => shift.status === "working" || shift.status === "pto",
      )
    ) {
      return;
    }
    // Only trust "free" when the worker is on the schedule that week.
    const onSchedule = workerShifts.some(
      (shift) => Math.abs(daysBetween(offDate, shift.date)) <= 6,
    );
    if (!onSchedule) return;

    const history = workerShifts.filter(
      (shift) => shift.status === "working" && shift.start && shift.end,
    );
    if (!history.length) return;
    const intervals = history.map((shift) =>
      normalizedInterval(shift.start, shift.end),
    );
    const usualStart =
      intervals.reduce((total, [start]) => total + start, 0) / intervals.length;
    const usualEnd =
      intervals.reduce((total, [, end]) => total + end, 0) / intervals.length;
    const usualScore = closeness(myStart, myEnd, usualStart, usualEnd);

    const swapDays = swapDates
      .flatMap<SwapDay>((date) => {
        const theirs = history.find((shift) => shift.date === date);
        if (!theirs) return [];
        const [start, end] = normalizedInterval(theirs.start, theirs.end);
        const tradeScore = closeness(myStart, myEnd, start, end);
        return [
          {
            date,
            start: theirs.start,
            end: theirs.end,
            score: Math.round(tradeScore * 0.65 + usualScore * 0.35),
          },
        ];
      })
      .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));

    const match: SwapMatch = {
      worker,
      offDayStatus: onOffDate.length ? "off" : "unscheduled",
      usualStart,
      usualEnd,
      sampleCount: history.length,
      swapDays,
      score: swapDays[0]?.score ?? usualScore,
    };
    (swapDays.length ? matches : coverOnly).push(match);
  });

  const order = (a: SwapMatch, b: SwapMatch) =>
    b.score - a.score || a.worker.localeCompare(b.worker);
  return {
    myShift,
    matches: matches.sort(order),
    coverOnly: coverOnly.sort(order),
  };
}
