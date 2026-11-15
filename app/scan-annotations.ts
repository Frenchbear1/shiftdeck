import type { ScanMark } from "./schedule-parser";

export const scanMeaningLabels = {
  time: "Scheduled time",
  range: "Time range",
  off: "No scheduled time (X)",
  flight: "Flight",
  pto: "Paid time off (PTO)",
  date: "Date",
  person: "Worker name",
  note: "Other / note",
} as const;

export type ScanMeaning =
  | { kind: "time"; time: string }
  | { kind: "range"; start: string; end: string }
  | { kind: "off" }
  | { kind: "flight"; identifier: string; origin: string; destination: string; arrival: string; departure: string }
  | { kind: "pto" }
  | { kind: "date"; date: string }
  | { kind: "person"; text: string }
  | { kind: "note"; text: string };

type StoredDefinition = string | ScanMeaning[];

export type ScanDefinitions = {
  spots: Record<string, StoredDefinition>;
  matching: Record<string, StoredDefinition>;
  confirmed?: Record<string, "verified" | "corrected">;
};

export const SCAN_DEFINITIONS_KEY = "shiftdeck.scanDefinitions";
export const emptyScanDefinitions: ScanDefinitions = { spots: {}, matching: {} };

export function newScanMeaning(kind: ScanMeaning["kind"]): ScanMeaning {
  switch (kind) {
    case "time": return { kind, time: "" };
    case "range": return { kind, start: "", end: "" };
    case "flight": return { kind, identifier: "", origin: "", destination: "", arrival: "", departure: "" };
    case "date": return { kind, date: "" };
    case "person":
    case "note": return { kind, text: "" };
    default: return { kind };
  }
}

const isTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isAirport = (value: string) => !value.trim() || /^[a-z0-9]{3,4}$/i.test(value.trim());

export function isCompleteScanMeaning(meaning: ScanMeaning) {
  switch (meaning.kind) {
    case "time": return isTime(meaning.time);
    case "range": return isTime(meaning.start) && isTime(meaning.end);
    case "flight":
      return Boolean(meaning.identifier.trim() || meaning.origin.trim() || meaning.destination.trim() ||
        meaning.arrival || meaning.departure) && isAirport(meaning.origin) && isAirport(meaning.destination) &&
        (!meaning.arrival || isTime(meaning.arrival)) && (!meaning.departure || isTime(meaning.departure));
    case "date": return isDate(meaning.date);
    case "person":
    case "note": return Boolean(meaning.text.trim());
    case "off":
    case "pto": return true;
  }
}

const tidyMeaning = (meaning: ScanMeaning): ScanMeaning => {
  if (meaning.kind === "person" || meaning.kind === "note") {
    return { ...meaning, text: meaning.text.trim().slice(0, 160) };
  }
  if (meaning.kind === "flight") {
    return {
      ...meaning,
      identifier: meaning.identifier.trim().slice(0, 16).toUpperCase(),
      origin: meaning.origin.trim().toUpperCase(),
      destination: meaning.destination.trim().toUpperCase(),
    };
  }
  return meaning;
};

export function formatScanMeaning(meaning: ScanMeaning) {
  switch (meaning.kind) {
    case "time": return `Scheduled ${meaning.time}`;
    case "range": return `${meaning.start}–${meaning.end}`;
    case "off": return "No scheduled time (X)";
    case "pto": return "Paid time off (PTO)";
    case "flight": {
      const route = [meaning.origin, meaning.destination].filter(Boolean).join(" → ");
      return [
        meaning.identifier ? `Flight ${meaning.identifier}` : "Flight",
        route,
        meaning.arrival && `Arrives ${meaning.arrival}`,
        meaning.departure && `Departs ${meaning.departure}`,
      ].filter(Boolean).join(" · ");
    }
    case "date": return meaning.date;
    case "person":
    case "note": return meaning.text;
  }
}

const markText = (mark: ScanMark) => mark.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const spotKey = (hash: string, mark: ScanMark) => JSON.stringify([hash, mark.id, markText(mark)]);
const matchKey = (mark: ScanMark) => JSON.stringify([mark.kind, markText(mark)]);

export function getScanDefinition(definitions: ScanDefinitions, hash: string, mark: ScanMark) {
  const spot = definitions.spots[spotKey(hash, mark)];
  const repeat = definitions.matching[matchKey(mark)];
  const stored = spot ?? repeat;
  const meanings: ScanMeaning[] = typeof stored === "string"
    ? [{ kind: "note", text: stored }]
    : stored ?? [];
  return {
    meanings,
    value: meanings.map(formatScanMeaning).join(" · "),
    repeat: spot === undefined && repeat !== undefined,
  };
}

export function saveScanDefinition(
  definitions: ScanDefinitions, hash: string, mark: ScanMark, meanings: ScanMeaning[], repeat: boolean,
): ScanDefinitions {
  if (!meanings.length || !meanings.every(isCompleteScanMeaning)) return definitions;
  const saved = meanings.map(tidyMeaning);
  const key = spotKey(hash, mark);
  if (!repeat) return { ...definitions, spots: { ...definitions.spots, [key]: saved } };
  const spots = { ...definitions.spots };
  delete spots[key];
  return { ...definitions, spots, matching: { ...definitions.matching, [matchKey(mark)]: saved } };
}

export function getScanConfirmation(definitions: ScanDefinitions, hash: string, mark: ScanMark) {
  return definitions.confirmed?.[spotKey(hash, mark)];
}

export function confirmScanMark(
  definitions: ScanDefinitions, hash: string, mark: ScanMark, action: "verified" | "corrected",
): ScanDefinitions {
  return {
    ...definitions,
    confirmed: { ...definitions.confirmed, [spotKey(hash, mark)]: action },
  };
}

/** Ordering is visual only. The OCR worker can start its next pass immediately. */
export function scanSweepDelays(marks: ScanMark[]) {
  const heights = marks.map(({ height }) => height).sort((a, b) => a - b);
  const halfHeight = (heights[Math.floor(heights.length / 2)] ?? 1) * 0.55;
  const center = (mark: ScanMark) => mark.y + mark.height / 2;
  const rows: ScanMark[][] = [];
  for (const mark of [...marks].sort((a, b) => center(a) - center(b) || a.x - b.x)) {
    const last = rows.at(-1);
    if (last && center(mark) - center(last[0]) <= halfHeight) last.push(mark);
    else rows.push([mark]);
  }
  const ordered = rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
  const step = Math.min(34, 730 / Math.max(1, ordered.length - 1));
  return new Map(ordered.map((mark, index) => [mark.id, Math.round(index * step)]));
}
