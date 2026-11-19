import type { Flight, Shift } from "./sample-data";

type OcrWord = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  rowY: number;
};

type DatedWord = OcrWord & {
  value: Date;
};

type SourceBand = { top: number; bottom: number };

export type ScanMark = {
  id: string;
  kind: "date" | "name" | "shift" | "flight" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
  unreadable: boolean;
  worker?: string;
  date?: string;
  flight?: Flight;
  period?: Flight["period"];
  shift?: Pick<Shift, "date" | "start" | "end">;
  /** The whole grid cell in image pixels, used to re-read just that cell. */
  cell?: { x: number; y: number; width: number; height: number };
  /** Why a read was flagged or trusted (e.g. "Read the same 3 ways"). */
  note?: string;
};

export type ScanGeometry = {
  width: number;
  height: number;
  marks: ScanMark[];
  workerRows: Array<{ name: string; top: number; bottom: number }>;
  dates?: string[];
  dateHeader?: SourceBand;
  grid?: { left: number; right: number; slope: number };
};

export const scanConfidence = ({ confidence, unreadable }: ScanMark) =>
  unreadable || confidence < 48 ? "unreadable" : confidence < 82 ? "check" : "confident";

type CollectScanMark = (
  mark: Omit<ScanMark, "x" | "y" | "width" | "height" | "text" | "confidence">,
  words: OcrWord[],
) => void;

export type ScheduleSourceLayout = {
  width: number;
  height: number;
  left: number;
  right: number;
  slope: number;
  spacing: number;
  centers: number[];
  header: SourceBand;
  rows: Array<SourceBand & { name: string }>;
};

export type ParsedSchedule = {
  dates: string[];
  shifts: Shift[];
  flights: Flight[];
  confidence: number;
  warnings: string[];
  sourceLayout?: ScheduleSourceLayout;
};

export const SCHEDULE_PARSER_VERSION = 6;

const DAY_MS = 86_400_000;

export function isScheduleRevision(
  existingDates: string[],
  incomingDates: string[],
) {
  const existing = new Set(existingDates);
  const incoming = new Set(incomingDates);
  const smallerWeekSize = Math.min(existing.size, incoming.size);
  if (!smallerWeekSize) return false;

  const overlappingDates = [...existing].filter((date) =>
    incoming.has(date),
  ).length;

  if (smallerWeekSize < 5) {
    return (
      overlappingDates === existing.size &&
      overlappingDates === incoming.size
    );
  }

  return (
    overlappingDates >= 5 &&
    overlappingDates >= Math.ceil(smallerWeekSize * 0.7)
  );
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const average = (values: number[]) =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

const addDays = (value: Date, days: number) =>
  new Date(value.getTime() + days * DAY_MS);

const parseDateToken = (raw: string) => {
  const normalized = raw
    .replace(/[|Il]/g, "/")
    .replace(/[^\d/.-]/g, "")
    .replace(/[.-]/g, "/");
  const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCMonth() === month - 1 && value.getUTCDate() === day
    ? value
    : null;
};

const linearSlope = (words: DatedWord[]) => {
  if (words.length < 2) return 0;
  const meanX = average(words.map((word) => word.centerX));
  const meanY = average(words.map((word) => word.centerY));
  const numerator = words.reduce(
    (total, word) => total + (word.centerX - meanX) * (word.centerY - meanY),
    0,
  );
  const denominator = words.reduce(
    (total, word) => total + (word.centerX - meanX) ** 2,
    0,
  );
  return denominator ? numerator / denominator : 0;
};

const parseWords = (tsv: string) =>
  tsv
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((parts) => parts[0] === "5" && parts.length >= 12 && parts[11]?.trim())
    .map<OcrWord>((parts) => {
      const x = Number(parts[6]);
      const y = Number(parts[7]);
      const width = Number(parts[8]);
      const height = Number(parts[9]);
      return {
        text: parts.slice(11).join("\t").trim(),
        confidence: Number(parts[10]),
        x,
        y,
        width,
        height,
        centerX: x + width / 2,
        centerY: y + height / 2,
        rowY: y + height / 2,
      };
    })
    .filter(
      (word) =>
        Number.isFinite(word.x) &&
        Number.isFinite(word.y) &&
        Number.isFinite(word.width) &&
        Number.isFinite(word.height),
    );

const dateDay = (value: Date) => Math.round(value.getTime() / DAY_MS);

const selectScheduleDateRow = (candidates: DatedWord[]) => {
  if (candidates.length < 4) return null;

  const typicalHeight =
    median(candidates.map((word) => word.height).filter(Boolean)) || 10;
  const rowTolerance = Math.max(6, typicalHeight * 0.8);
  const rows: DatedWord[][] = [];

  [...candidates]
    .sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX)
    .forEach((word) => {
      const matchingRow = rows.find(
        (row) =>
          Math.abs(word.centerY - average(row.map((item) => item.centerY))) <=
          rowTolerance,
      );
      if (matchingRow) {
        matchingRow.push(word);
      } else {
        rows.push([word]);
      }
    });

  const sequences = rows.flatMap((row) => {
    const ordered = [...row].sort((a, b) => a.centerX - b.centerX);
    return ordered.flatMap((first, startIndex) => {
      const firstDay = dateDay(first.value);
      const sequence = ordered
        .slice(startIndex)
        .filter((word) => {
          const difference = dateDay(word.value) - firstDay;
          return difference >= 0 && difference <= 6;
        })
        .filter(
          (word, index, values) =>
            index === 0 || dateDay(word.value) > dateDay(values[index - 1].value),
        );
      return sequence.length >= 4 ? [sequence] : [];
    });
  });

  return (
    sequences
      .map((sequence) => {
        const spacingSamples = sequence.slice(1).map((word, index) => {
          const previous = sequence[index];
          const dayGap = dateDay(word.value) - dateDay(previous.value);
          return (word.centerX - previous.centerX) / dayGap;
        });
        const spacing = median(spacingSamples);
        const spacingError = spacing
          ? average(spacingSamples.map((sample) => Math.abs(sample - spacing))) /
            spacing
          : 1;
        const daySpan =
          dateDay(sequence.at(-1)!.value) - dateDay(sequence[0].value);
        return {
          sequence,
          spacing,
          score:
            sequence.length * 100 +
            daySpan * 10 +
            average(sequence.map((word) => word.confidence)) -
            spacingError * 100,
        };
      })
      .filter((candidate) => candidate.spacing > 0)
      .sort((a, b) => b.score - a.score)[0] ?? null
  );
};

const deriveWeek = (words: OcrWord[]) => {
  const candidates = words
    .map((word) => {
      const value = parseDateToken(word.text);
      return value ? ({ ...word, value } satisfies DatedWord) : null;
    })
    .filter((word): word is DatedWord => Boolean(word));

  const selected = selectScheduleDateRow(candidates);
  if (!selected) return null;
  const selectedDates = selected.sequence;
  const spacing = selected.spacing;
  const firstDate = selectedDates[0].value;
  const baseDate = addDays(firstDate, -firstDate.getUTCDay());

  const centersByIndex = new Map<number, number>();
  selectedDates.forEach((word) =>
    centersByIndex.set(word.value.getUTCDay(), word.centerX),
  );
  const centerPairs = [...centersByIndex.entries()].sort((a, b) => a[0] - b[0]);
  const inferredSpacing = median(
    centerPairs.slice(1).map(([index, x], pairIndex) => {
      const [previousIndex, previousX] = centerPairs[pairIndex];
      return (x - previousX) / (index - previousIndex);
    }),
  ) || spacing;
  const inferredFirstX = median(
    centerPairs.map(([index, x]) => x - inferredSpacing * index),
  );
  const columnCenters = Array.from(
    { length: 7 },
    (_, index) => centersByIndex.get(index) ?? inferredFirstX + inferredSpacing * index,
  );
  const slope = linearSlope(selectedDates);
  const correctedHeaderY = median(
    selectedDates.map((word) => word.centerY - slope * word.centerX),
  );

  return {
    dates: Array.from({ length: 7 }, (_, index) => isoDate(addDays(baseDate, index))),
    columnCenters,
    spacing: inferredSpacing,
    slope,
    correctedHeaderY,
    headerWords: selectedDates,
    confidence: average(selectedDates.map((word) => word.confidence)),
  };
};

/**
 * Two words read without a space ("kodyHermany", "DevinBauer") come apart;
 * name prefixes that are really written that way (LaBarre, LeCompte,
 * McDonald, DeLuca) stay together.
 */
export const splitGluedWords = (raw: string) =>
  raw.replace(/([a-z]{3,})(?=[A-Z][a-z])/g, (whole, left: string) =>
    /^(?:mac|van|von|del|der|den|des|dos|las|los)$/i.test(left) ? whole : `${left} `);

const cleanNameWord = (raw: string) => {
  const cleaned = raw
    .replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, "")
    // "Smith-S", "Watson-" : a trailing tag or dash isn't part of the name.
    .replace(/(?<=[A-Za-z]{3})[-–'’]+[A-Za-z]?$/, "")
    // Names start with a capital, and a capital I reads as a lowercase l
    // ("lannelli" is Iannelli, "lan" is Ian); a capital L looks different.
    .replace(/^l(?=[a-z]+$)/, "I");
  if (!cleaned) return "";
  if (cleaned === cleaned.toLowerCase() || cleaned === cleaned.toUpperCase()) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }
  return cleaned;
};

const SCHEDULE_PERSON_ALIASES = new Map([
  ["davidlabare", "David LaBarre"],
  ["davidlabarre", "David LaBarre"],
]);

export const canonicalSchedulePersonName = (name: string) => {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const key = trimmed.toLowerCase().replace(/[^a-z]/g, "");
  return SCHEDULE_PERSON_ALIASES.get(key) ?? trimmed;
};

export const canonicalizeScheduleShifts = (shifts: Shift[]) =>
  Array.from(
    new Map(
      shifts.map((shift) => {
        const worker = canonicalSchedulePersonName(shift.worker);
        const id = `${shift.date}-${worker}-${
          shift.status === "working" ? shift.start : shift.status
        }`;
        return [id, { ...shift, id, worker }] as const;
      }),
    ).values(),
  );

const NON_NAME_WORDS = new Set([
  "subject",
  "change",
  "schedule",
  "amazon",
  "morning",
  "afternoon",
  "evening",
  "open",
  "flight",
  "flights",
  "arrival",
  "arrivals",
  "departure",
  "departures",
  "airport",
  "shift",
  "shifts",
  "worker",
  "workers",
  "employee",
  "employees",
  "date",
  "time",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
]);

/** Notes written after a name on the schedule ("Dawn Smith Deice"). */
const NAME_NOTES = new Set([
  "deice", "deicing", "training", "trng", "trn", "build", "chtr", "charter", "commissary", "com", "nho", "cbt", "ilt",
  "new", "hire", "trainee", "lead", "supv", "gsc",
]);

/** "Dawn Smith Deice" → "Dawn Smith". */
export const withoutNameNotes = (name: string) => {
  const parts = name.trim().split(/\s+/);
  while (parts.length > 2 && NAME_NOTES.has(parts.at(-1)!.toLowerCase().replace(/[^a-z]/g, ""))) parts.pop();
  return parts.join(" ");
};

const WEEKDAY = /^(?:sun|mon|tue|wed|thu|fri|sat)/i;
/** Notes on a schedule that say someone's leaving or starting. */
export const FAREWELL_NOTE = /\b(?:GOOD\s*LUCK|LUCK|BYE|GOOD\s*BYE|FAREWELL|LAST\s*DAY|MISS\s*YOU)\b/i;
export const FIRST_DAY_NOTE = /\b(?:FIRST\s*DAY|1ST\s*DAY|NHO|NEW\s*HIRE|WELCOME)\b/i;
const ROSTER_NOTE = new RegExp(`${FAREWELL_NOTE.source}|${FIRST_DAY_NOTE.source}|\\bGOOD\\b`, "i");

export const isPlausibleWorkerName = (name: string) => {
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.toLowerCase().replace(/[^a-z]/g, ""))
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts.some((part) => NON_NAME_WORDS.has(part))) return false;
  if (parts.at(-1)!.length < 4) return false;
  if (parts.length >= 3 && parts.every((part) => part.length <= 3)) return false;
  return parts.join("").length >= 6;
};

const personNameTokens = (name: string) =>
  name
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z]/g, ""))
    .filter(Boolean);

const editDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

const schedulePersonDistance = (left: string, right: string) => {
  const leftTokens = personNameTokens(canonicalSchedulePersonName(left));
  const rightTokens = personNameTokens(canonicalSchedulePersonName(right));
  if (leftTokens.length < 2 || leftTokens.length !== rightTokens.length) {
    return Number.POSITIVE_INFINITY;
  }
  const distances = leftTokens.map((token, index) =>
    editDistance(token, rightTokens[index]),
  );
  const allowed = leftTokens.map((token, index) =>
    Math.max(token.length, rightTokens[index].length) >= 7 ? 2 : 1,
  );
  return distances.every((distance, index) => distance <= allowed[index])
    ? distances.reduce((total, distance) => total + distance, 0)
    : Number.POSITIVE_INFINITY;
};

export const isSameSchedulePerson = (left: string, right: string) =>
  Number.isFinite(schedulePersonDistance(left, right));

const firstAndLast = (name: string) => {
  const tokens = personNameTokens(canonicalSchedulePersonName(name));
  return tokens.length >= 2 ? { first: tokens[0], last: tokens[tokens.length - 1], middle: tokens.length - 2 } : null;
};

const typosAllowed = (word: string) => (word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0);

/** One word could be a misread or clipped reading of the other. */
const wordMatches = (short: string, full: string, clipStart: boolean) => {
  if (short === full) return true;
  if (editDistance(short, full) <= typosAllowed(full)) return true;
  const shorter = full.length - short.length;
  if (shorter <= 0 || shorter > 4) return false;
  // The scan cut letters off the start ("ody" → "kody", "ctoria" → "victoria")…
  if (clipStart && short.length >= 2 && full.endsWith(short)) return true;
  if (clipStart && short.length >= 2 && shorter <= 2 && full.includes(short)) return true;
  // …or off the end, or both ("will" → "williams", "annel" → "iannelli").
  return short.length >= 4 && full.includes(short);
};

/**
 * Whether two names read from schedules are the same person, allowing a
 * misread letter or two and the clipped first letters scans often produce
 * ("Ody Hermany" and "Kody Hermany", "Devin Baver" and "Devin Bauer").
 * Middle words are ignored ("Christopher Ris Williams").
 */
export const isLikelySamePerson = (left: string, right: string) => {
  const a = firstAndLast(left);
  const b = firstAndLast(right);
  if (!a || !b) return false;
  const [short, full] = a.first.length + a.last.length <= b.first.length + b.last.length ? [a, b] : [b, a];
  if (!wordMatches(short.last, full.last, true)) return false;
  if (wordMatches(short.first, full.first, true)) return true;
  // Same long last name: the first name can be read a bit worse ("Letrane" for "Coletrane").
  return short.last === full.last && full.last.length >= 5 && short.first.length >= 4 &&
    editDistance(short.first, full.first) <= typosAllowed(full.first) + 1;
};

/** How complete a reading looks: longer first and last names, fewer stray middle words. */
const completeness = (name: string) => {
  const parts = firstAndLast(name);
  return parts ? parts.first.length + parts.last.length - parts.middle * 3 : 0;
};

/**
 * Groups the readings of each person and picks one name for each: the most
 * complete reading, then the one seen most often (`weight`). `keep` names
 * (yours) always win their group.
 */
export function canonicalWorkerNames(
  readings: Array<{ name: string; weight: number }>,
  keep: string[] = [],
): Map<string, string> {
  const kept = new Set(keep.filter(Boolean).map((name) => name.toLowerCase()));
  const totals = new Map<string, number>();
  for (const { name, weight } of readings) totals.set(name, (totals.get(name) ?? 0) + weight);
  const ordered = [...totals.entries()].sort((a, b) =>
    Number(kept.has(b[0].toLowerCase())) - Number(kept.has(a[0].toLowerCase())) ||
    completeness(b[0]) - completeness(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]));
  const chosen: string[] = [];
  const map = new Map<string, string>();
  for (const [name] of ordered) {
    const match = chosen.find((candidate) => isLikelySamePerson(name, candidate));
    if (match) map.set(name, match);
    else {
      chosen.push(name);
      map.set(name, name);
    }
  }
  return map;
}

/** Two names read as one ("Kody Hermany Devin Bauer") when both are known on their own. */
export const isTwoNamesGlued = (name: string, others: string[]) => {
  // Saved before glued words were split: "kodyWermany DevinBaver".
  const tokens = splitGluedWords(name).trim().split(/\s+/);
  if (tokens.length < 4) return false;
  for (let split = 2; split <= tokens.length - 2; split += 1) {
    const left = tokens.slice(0, split).join(" ");
    const right = tokens.slice(split).join(" ");
    const known = (part: string) => others.some((other) => other !== name && isLikelySamePerson(part, other));
    if (known(left) && known(right)) return true;
  }
  return false;
};

/**
 * Cleans up the names across saved schedules: clipped and misread readings
 * of a person become one name, and rows that were two people read as one
 * are dropped when both people have their own rows.
 */
/** tidyScheduleWorkers for one list of shifts. */
export const tidyScheduleShifts = (shifts: Shift[], keep: string[] = []) =>
  tidyScheduleWorkers([{ shifts }], keep)[0].shifts;

export function tidyScheduleWorkers<T extends { shifts: Shift[] }>(documents: T[], keep: string[] = []): T[] {
  // How often a name was read: the days it's on, across every saved week.
  const readings = documents.flatMap((document) => {
    const days = new Map<string, Set<string>>();
    for (const shift of document.shifts) days.set(shift.worker, (days.get(shift.worker) ?? new Set()).add(shift.date));
    return [...days].map(([name, dates]) => ({ name, weight: dates.size }));
  });
  const map = canonicalWorkerNames(readings, keep);
  return documents.map((document) => {
    const names = [...new Set(document.shifts.map((shift) => map.get(shift.worker) ?? shift.worker))];
    const glued = new Set(names.filter((name) => isTwoNamesGlued(name, names)));
    const shifts = new Map<string, Shift>();
    for (const shift of document.shifts) {
      const worker = map.get(shift.worker) ?? shift.worker;
      if (glued.has(worker)) continue;
      const key = `${shift.date}|${worker}`;
      const current = shifts.get(key);
      if (!current || (current.status !== "working" && shift.status === "working")) {
        shifts.set(key, {
          ...shift,
          worker,
          id: `${shift.date}-${worker}-${shift.status === "working" ? shift.start : shift.status}`,
        });
      }
    }
    const changed = shifts.size !== document.shifts.length ||
      document.shifts.some((shift) => (map.get(shift.worker) ?? shift.worker) !== shift.worker);
    return changed ? { ...document, shifts: [...shifts.values()] } : document;
  });
}

export const resolveSchedulePersonName = (
  scannedName: string,
  knownNames: string[],
) => {
  const scanned = canonicalSchedulePersonName(scannedName);
  const exact = resolveByDistance(scannedName, knownNames);
  // A fuller reading than the one already known ("Kody" after "Ody") is kept;
  // the saved weeks are tidied to it afterwards.
  if (exact !== scanned) return completeness(scanned) > completeness(exact) && isLikelySamePerson(scanned, exact) ? scanned : exact;
  // A clipped reading ("Ody Hermany") of exactly one known person.
  const clipped = [...new Set(knownNames.map(canonicalSchedulePersonName).filter(Boolean))]
    .filter((name) => name !== exact && isLikelySamePerson(exact, name) && completeness(name) > completeness(exact));
  return clipped.length === 1 ? clipped[0] : exact;
};

const resolveByDistance = (
  scannedName: string,
  knownNames: string[],
) => {
  const canonicalScannedName = canonicalSchedulePersonName(scannedName);
  const matches = Array.from(
    new Set(
      knownNames
        .map(canonicalSchedulePersonName)
        .filter(Boolean),
    ),
  )
    .map((name) => ({ name, distance: schedulePersonDistance(canonicalScannedName, name) }))
    .filter((match) => Number.isFinite(match.distance))
    .sort((left, right) => left.distance - right.distance);
  if (!matches.length) return canonicalScannedName;
  if (matches.length > 1 && matches[0].distance === matches[1].distance) {
    return canonicalScannedName;
  }
  return matches[0].name;
};

const parseSignal = (schedule: ParsedSchedule) => {
  const workingShifts = schedule.shifts.filter(
    (shift) => shift.status === "working",
  ).length;
  const workers = new Set(schedule.shifts.map((shift) => shift.worker)).size;
  return workingShifts * 20 + schedule.flights.length * 8 + workers * 3 +
    schedule.confidence / 100;
};

const flightIdentity = (flight: Flight) =>
  [
    flight.date,
    flight.source ?? "schedule",
    flight.trackingId ?? "",
    flight.kind,
    flight.origin,
    flight.destination ?? "",
    flight.arrival ?? "",
    flight.departure ?? "",
  ].join("|");

/**
 * OCR passes often recognize different parts of the same image. Keep the most
 * complete week and fill its gaps with details recovered by the other passes.
 */
export function mergeScheduleParses(
  schedules: ParsedSchedule[],
): ParsedSchedule | null {
  if (!schedules.length) return null;

  const weekGroups = new Map<string, ParsedSchedule[]>();
  schedules.forEach((schedule) => {
    const key = [...schedule.dates].sort().join("|");
    weekGroups.set(key, [...(weekGroups.get(key) ?? []), schedule]);
  });
  const matchingWeek = [...weekGroups.values()].sort(
    (left, right) =>
      right.reduce((total, schedule) => total + parseSignal(schedule), 0) -
      left.reduce((total, schedule) => total + parseSignal(schedule), 0),
  )[0];
  const ranked = [...matchingWeek].sort(
    (left, right) => parseSignal(right) - parseSignal(left),
  );

  // The passes read names a little differently ("Ody Hermany", "Kody Hermany",
  // "Devin Baver"): each person gets one name, the most complete reading
  // (then the most common, then the best pass's).
  const readings = ranked.flatMap((schedule, rank) =>
    [...new Set(schedule.shifts.map((shift) => canonicalSchedulePersonName(shift.worker)))]
      .map((name) => ({ name, weight: 1 + (ranked.length - rank) / 100 })));
  const names = canonicalWorkerNames(readings);
  const people = [...new Set(names.values())];
  const glued = new Set(people.filter((name) => isTwoNamesGlued(name, people)));
  // A stray bit of another row ("El Smith", all days off): a one- or two-letter
  // first name with at most one shift is a misread, not a person.
  for (const name of people) {
    if ((firstAndLast(name)?.first.length ?? 9) > 2) continue;
    const working = ranked.flatMap((schedule) => schedule.shifts)
      .filter((shift) => names.get(canonicalSchedulePersonName(shift.worker)) === name && shift.status === "working");
    if (new Set(working.map((shift) => shift.date)).size <= 1) glued.add(name);
  }

  const shifts = new Map<string, Shift>();
  ranked.forEach((schedule) => {
    schedule.shifts.forEach((shift) => {
      const worker = names.get(canonicalSchedulePersonName(shift.worker)) ?? canonicalSchedulePersonName(shift.worker);
      if (glued.has(worker)) return;
      const key = `${shift.date}|${worker}`;
      const current = shifts.get(key);
      // A note one pass caught on a day off ("BYE") is kept.
      if (current && current.status === "off" && shift.status === "off" && !current.note && shift.note) {
        shifts.set(key, { ...current, note: shift.note });
        return;
      }
      if (!current || (current.status !== "working" && shift.status === "working")) {
        shifts.set(key, {
          ...shift,
          id: `${shift.date}-${worker}-${
            shift.status === "working" ? shift.start : shift.status
          }`,
          worker,
        });
      }
    });
  });

  const flights = new Map<string, Flight>();
  ranked.forEach((schedule) => {
    schedule.flights.forEach((flight) => {
      const key = flightIdentity(flight);
      if (!flights.has(key)) flights.set(key, flight);
    });
  });

  return {
    dates: ranked[0].dates,
    shifts: [...shifts.values()],
    flights: [...flights.values()],
    confidence: Math.max(...ranked.map((schedule) => schedule.confidence)),
    warnings: Array.from(
      new Set([
        ...ranked.flatMap((schedule) => schedule.warnings),
        ...(ranked.length > 1
          ? ["Combined the readable details from several scans of this file."]
          : []),
      ]),
    ),
  };
}

const normalizedCellText = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[–—_]/g, "-")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizedTimeRange = (raw: string) => {
  const compact = normalizedCellText(raw)
    .replace(/[Oo]/g, "0")
    .replace(/(?<=\d)[IL](?=\d)/g, "1")
    .replace(/\s+/g, "");
  const match = compact.match(/(\d{3,4})-(\d{3,4})/);
  if (!match) return null;
  const padTime = (time: string) => time.padStart(4, "0");
  const start = padTime(match[1]);
  const end = padTime(match[2]);
  const valid = (time: string) =>
    Number(time.slice(0, 2)) <= 23 && Number(time.slice(2)) <= 59;
  return valid(start) && valid(end)
    ? {
        start: `${start.slice(0, 2)}:${start.slice(2)}`,
        end: `${end.slice(0, 2)}:${end.slice(2)}`,
        matched: match[0],
      }
    : null;
};

/** Reads "1700-0100" style ranges, tolerating common OCR letter swaps. */
export const readTimeRange = (raw: string) => {
  const range = normalizedTimeRange(raw);
  return range ? { start: range.start, end: range.end } : null;
};

/**
 * A cell can pick up text from the row above or below when rows are tight.
 * Use the line of words closest to the worker's row that holds a time range.
 */
const closestCellLine = (words: OcrWord[], rowY: number, typicalHeight: number) => {
  if (words.length < 2) return words;
  const lines: OcrWord[][] = [];
  [...words].sort((a, b) => a.rowY - b.rowY).forEach((word) => {
    const last = lines.at(-1);
    if (last && Math.abs(word.rowY - average(last.map((item) => item.rowY))) <= typicalHeight * 0.55) {
      last.push(word);
    } else {
      lines.push([word]);
    }
  });
  if (lines.length < 2) return words;
  const ranked = lines
    .map((line) => ({
      line: line.sort((a, b) => a.x - b.x),
      distance: Math.abs(average(line.map((item) => item.rowY)) - rowY),
    }))
    .sort((a, b) => a.distance - b.distance);
  return ranked.find(({ line }) =>
    normalizedTimeRange(normalizedCellText(line.map((word) => word.text).join(" "))),
  )?.line ?? words;
};

const nearestColumn = (x: number, centers: number[], spacing: number) => {
  let index = 0;
  let distance = Number.POSITIVE_INFINITY;
  centers.forEach((center, candidate) => {
    const nextDistance = Math.abs(x - center);
    if (nextDistance < distance) {
      distance = nextDistance;
      index = candidate;
    }
  });
  return distance <= spacing * 0.58 ? index : -1;
};

const parseShifts = (
  words: OcrWord[],
  week: NonNullable<ReturnType<typeof deriveWeek>>,
  collect?: CollectScanMark,
) => {
  const nameBoundary = week.columnCenters[0] - week.spacing * 0.5;
  const adjusted = words.map((word) => ({
    ...word,
    rowY: word.centerY - week.slope * word.centerX,
  }));
  const nameWords = adjusted.filter(
    (word) =>
      word.centerX < nameBoundary &&
      word.rowY > week.correctedHeaderY + Math.max(8, word.height * 0.7) &&
      /[A-Za-z]/.test(word.text),
  );
  const typicalHeight = median(nameWords.map((word) => word.height).filter(Boolean)) || 10;
  const groupingTolerance = Math.max(5, typicalHeight * 0.8);
  const groups: OcrWord[][] = [];

  nameWords
    .sort((a, b) => a.rowY - b.rowY || a.x - b.x)
    .forEach((word) => {
      const last = groups.at(-1);
      const lastY = last ? average(last.map((item) => item.rowY)) : 0;
      if (!last || Math.abs(word.rowY - lastY) > groupingTolerance) {
        groups.push([word]);
      } else {
        last.push(word);
      }
    });

  // Two tightly packed rows can land in one group. Words on one line never
  // sit on top of each other, so a group with stacked words is split where
  // the gap between lines is widest (again, until no words overlap).
  const overlapping = (a: OcrWord, b: OcrWord) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > Math.min(a.width, b.width) * 0.35;
  const splitStacked = (group: OcrWord[]): OcrWord[][] => {
    if (group.length < 2) return [group];
    const stacked = group.some((word, index) => group.slice(index + 1).some((other) => overlapping(word, other)));
    if (!stacked) return [group];
    const sorted = [...group].sort((a, b) => a.rowY - b.rowY);
    let cut = 1;
    let widest = -Infinity;
    for (let index = 1; index < sorted.length; index += 1) {
      const gap = sorted[index].rowY - sorted[index - 1].rowY;
      if (gap > widest) {
        widest = gap;
        cut = index;
      }
    }
    if (widest < typicalHeight * 0.3) return [group];
    return [...splitStacked(sorted.slice(0, cut)), ...splitStacked(sorted.slice(cut))];
  };
  const lines = groups.flatMap(splitStacked);

  const namedRows = lines
    .map((group) => {
      const name = withoutNameNotes(group
        .sort((a, b) => a.x - b.x)
        .flatMap((word) => splitGluedWords(word.text).split(/\s+/))
        .map((word) => cleanNameWord(word))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim());
      const nameParts = name.split(" ");
      const withoutTrailingCode =
        nameParts.length >= 3 && nameParts.at(-1)!.length <= 2
          ? nameParts.slice(0, -1)
          : nameParts;
      return {
        name: canonicalSchedulePersonName(
          withoutTrailingCode.length >= 3 && withoutTrailingCode[0].length <= 2
            ? withoutTrailingCode.slice(1).join(" ")
            : withoutTrailingCode.join(" "),
        ),
        y: average(group.map((word) => word.rowY)),
        words: group,
      };
    })
    .filter((row) => isPlausibleWorkerName(row.name))
    .filter((row) => row.name.toLowerCase() !== "open");

  if (!namedRows.length) return { shifts: [], rows: [] };
  const rowGaps = namedRows
    .slice(1)
    .map((row, index) => row.y - namedRows[index].y)
    .filter((gap) => gap > groupingTolerance);
  const rowSpacing = median(rowGaps) || typicalHeight * 2.2;
  const rowTolerance = Math.max(
    5,
    Math.min(typicalHeight * 0.9, rowSpacing * 0.43),
  );
  const cellWords = adjusted.filter(
    (word) =>
      word.centerX >= nameBoundary &&
      word.rowY > week.correctedHeaderY + typicalHeight * 0.7,
  );

  // The line under the dates ("*Subject to Change*  Sun  Mon …") isn't anyone's row.
  const workerRows = namedRows.filter((row) => cellWords
    .filter((word) => Math.abs(word.rowY - row.y) <= rowTolerance && WEEKDAY.test(word.text.replace(/[^A-Za-z]/g, "")))
    .length < 3);

  const rows = workerRows.map((row, index) => {
    const cells = cellWords.filter(
      (word) => Math.abs(word.rowY - row.y) <= rowTolerance,
    );
    collect?.({ id: `name:${row.name}`, kind: "name", worker: row.name, unreadable: false }, row.words);
    const band = sourceBand([...row.words, ...cells], week.slope);
    return {
      name: row.name,
      y: row.y,
      cells,
      left: Math.min(...row.words.map((word) => word.x)),
      top: Math.max(band.top, index ? (workerRows[index - 1].y + row.y) / 2 : -Infinity),
      bottom: Math.min(band.bottom, index + 1 < workerRows.length
        ? (row.y + workerRows[index + 1].y) / 2 : Infinity),
    };
  });

  const shifts = rows.flatMap<Shift>((row) => {
    const rowY = row.y;
    return week.dates.map((date, columnIndex) => {
      const cellWords = row.cells
        .filter(
          (word) =>
            nearestColumn(word.centerX, week.columnCenters, week.spacing) === columnIndex,
        )
        .sort((a, b) => a.x - b.x);
      const words = closestCellLine(cellWords, rowY, typicalHeight);
      const normalized = normalizedCellText(words.map((word) => word.text).join(" "));
      const range = normalizedTimeRange(normalized);
      if (words.length) {
        const center = week.columnCenters[columnIndex];
        const top = Number.isFinite(row.top) ? row.top : rowY - rowSpacing / 2;
        const bottom = Number.isFinite(row.bottom) ? row.bottom : rowY + rowSpacing / 2;
        collect?.({
          id: `shift:${row.name}:${date}`,
          kind: "shift",
          worker: row.name,
          date,
          unreadable: !range && !/^(?:OFF|PTO|X|[-–—]+)(?:\s|$)/.test(normalized),
          shift: range ? { date, start: range.start, end: range.end } : undefined,
          cell: {
            x: center - week.spacing / 2,
            y: top + week.slope * center,
            width: week.spacing,
            height: bottom - top,
          },
        }, words);
      }
      if (range) {
        const note = normalized
          .replace(range.matched, "")
          .replace(/^[\s|:-]+|[\s|:-]+$/g, "")
          .trim();
        return {
          id: `${date}-${row.name}-${range.start}`,
          date,
          worker: row.name,
          start: range.start,
          end: range.end,
          status: "working",
          note: note || undefined,
        };
      }
      if (/PTO/.test(normalized)) {
        return {
          id: `${date}-${row.name}-pto`,
          date,
          worker: row.name,
          start: "",
          end: "",
          status: "pto",
        };
      }
      // A day off can carry a note worth keeping: "GOOD", "BYE", "LUCK!" on someone's last week.
      const note = ROSTER_NOTE.test(normalized) ? normalized.replace(/^[\s|:-]+|[\s|:-]+$/g, "") : undefined;
      return {
        id: `${date}-${row.name}-off`,
        date,
        worker: row.name,
        start: "",
        end: "",
        status: "off",
        ...(note ? { note } : {}),
      };
    });
  });
  return { shifts, rows };
};

// Store vertical bounds in the same slope-corrected coordinates as the parser.
const sourceBand = (words: OcrWord[], slope: number): SourceBand => {
  const padding = Math.max(2, median(words.map((word) => word.height)) * 0.2);
  const top = Math.min(...words.map((word) => word.y - slope * word.centerX));
  const bottom = Math.max(
    ...words.map((word) => word.y + word.height - slope * word.centerX),
  );
  return { top: top - padding, bottom: bottom + padding };
};

const sourceLayoutFor = (
  tsv: string,
  week: NonNullable<ReturnType<typeof deriveWeek>>,
  rows: ReturnType<typeof parseShifts>["rows"],
): ScheduleSourceLayout | undefined => {
  const { width, height } = scanPageSize(tsv);
  if (!(width > 0 && height > 0 && rows.length)) return undefined;
  const left = Math.max(0, Math.floor(Math.min(
    ...rows.map((row) => row.left - week.spacing * 0.04),
    week.columnCenters[0] - week.spacing / 2,
  )));
  const right = Math.min(width, Math.ceil(week.columnCenters[6] + week.spacing / 2));
  if (right <= left) return undefined;
  return {
    width,
    height,
    left,
    right,
    slope: week.slope,
    spacing: week.spacing,
    centers: week.columnCenters,
    header: sourceBand(week.headerWords, week.slope),
    rows: rows.map(({ name, top, bottom }) => ({ name, top, bottom })),
  };
};

const parseClock = (raw: string) => {
  const digits = raw.replace(/\D/g, "").padStart(4, "0");
  if (digits.length !== 4) return null;
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  return hours <= 23 && minutes <= 59
    ? `${digits.slice(0, 2)}:${digits.slice(2)}`
    : null;
};

const parseFlightCell = (
  rawText: string,
  date: string,
  period: Flight["period"],
  index: number,
) => {
  const raw = rawText
    .toUpperCase()
    .replace(/\b(?:SC|F)\b/g, "")
    .replace(/[^A-Z0-9/\s]/g, " ")
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const cleanAirport = (airport: string) => {
    if (airport === "MICO") return "MCO";
    if (airport === "SRA") return "SRQ";
    return airport;
  };
  const route = raw.match(/\b([A-Z]{3,4})\s+(\d{3,4})\s*\/\s*(\d{3,4})\s+([A-Z]{3,4})\b/);
  if (route) {
    const arrival = parseClock(route[2]);
    const departure = parseClock(route[3]);
    if (!arrival || !departure) return null;
    return {
      id: `${date}-${period}-${index}-${arrival}`,
      date,
      period,
      kind: "turnaround" as const,
      raw: rawText,
      origin: cleanAirport(route[1]),
      destination: cleanAirport(route[4]),
      inboundAirport: cleanAirport(route[1]),
      outboundAirport: cleanAirport(route[4]),
      arrival,
      departure,
      start: arrival,
      end: departure,
    };
  }
  const explicitInbound = /\bIN\b/.test(raw);
  const explicitOutbound = /\bOUT\b/.test(raw);
  const outbound = raw.match(/(?:^|\bOUT\s+)(\d{3,4})\s+([A-Z]{3,4})\b/);
  if (outbound) {
    const departure = parseClock(outbound[1]);
    if (!departure) return null;
    return {
      id: `${date}-${period}-${index}-${departure}`,
      date,
      period,
      kind: "departure" as const,
      raw: rawText,
      origin: "HOME",
      destination: cleanAirport(outbound[2]),
      outboundAirport: cleanAirport(outbound[2]),
      departure,
      start: departure,
    };
  }
  const inbound = raw.match(/(?:^|\bIN\s+)([A-Z]{3,4})\s+(\d{3,4})\b/);
  if (!inbound) return null;
  if (explicitOutbound && !explicitInbound) return null;
  const arrival = parseClock(inbound[2]);
  if (!arrival) return null;
  return {
    id: `${date}-${period}-${index}-${arrival}`,
    date,
    period,
    kind: "arrival" as const,
    raw: rawText,
    origin: cleanAirport(inbound[1]),
    inboundAirport: cleanAirport(inbound[1]),
    arrival,
    start: arrival,
  };
};

const parseFlights = (
  words: OcrWord[],
  week: NonNullable<ReturnType<typeof deriveWeek>>,
  collect?: CollectScanMark,
) => {
  const nameBoundary = week.columnCenters[0] - week.spacing * 0.5;
  const adjusted = words.map((word) => ({
    ...word,
    rowY: word.centerY - week.slope * word.centerX,
  }));
  const periodLabels = adjusted
    .filter(
      (word) =>
        word.centerX < nameBoundary &&
        word.rowY < week.correctedHeaderY &&
        /^(morning|afternoon|evening)$/i.test(word.text.replace(/[^A-Za-z]/g, "")),
    )
    .map((word) => ({
      period: (word.text.charAt(0).toUpperCase() +
        word.text.slice(1).toLowerCase()) as Flight["period"],
      y: word.rowY,
    }))
    .sort((a, b) => a.y - b.y);
  const flightWords = adjusted.filter(
    (word) =>
      word.centerX >= nameBoundary &&
      word.rowY < week.correctedHeaderY - Math.max(5, word.height * 0.5),
  );
  const typicalHeight = median(flightWords.map((word) => word.height).filter(Boolean)) || 10;
  const tolerance = Math.max(5, typicalHeight * 0.75);
  const rowGroups: OcrWord[][] = [];
  flightWords
    .sort((a, b) => a.rowY - b.rowY || a.x - b.x)
    .forEach((word) => {
      const last = rowGroups.at(-1);
      const lastY = last ? average(last.map((item) => item.rowY)) : 0;
      if (!last || Math.abs(word.rowY - lastY) > tolerance) {
        rowGroups.push([word]);
      } else {
        last.push(word);
      }
    });

  const flights: Flight[] = [];
  const periodForTime = (time: string): Flight["period"] => {
    const hour = Number(time.slice(0, 2));
    if (hour < 11) return "Morning";
    if (hour < 19) return "Afternoon";
    return "Evening";
  };
  rowGroups.forEach((row, rowIndex) => {
    const y = average(row.map((word) => word.rowY));
    const labelPeriod =
      [...periodLabels].reverse().find((label) => label.y <= y + tolerance)?.period ??
      null;
    week.columnCenters.forEach((_, columnIndex) => {
      const words = row
        .filter(
          (word) =>
            nearestColumn(word.centerX, week.columnCenters, week.spacing) === columnIndex,
        )
        .sort((a, b) => a.x - b.x);
      const cellText = words.map((word) => word.text).join(" ").trim();
      if (!cellText) return;
      const provisional = parseFlightCell(
        cellText,
        week.dates[columnIndex],
        labelPeriod ?? "Morning",
        rowIndex * 7 + columnIndex,
      );
      const period = labelPeriod ?? (provisional ? periodForTime(provisional.start) : undefined);
      const flight = provisional && period ? {
        ...provisional,
        id: `${provisional.date}-${period}-${rowIndex * 7 + columnIndex}-${provisional.start}`,
        period,
      } : undefined;
      collect?.({
        id: `flight:${rowIndex}:${columnIndex}`,
        kind: "flight",
        date: week.dates[columnIndex],
        period,
        unreadable: !flight,
        flight,
      }, words);
      if (flight) flights.push(flight);
    });
  });
  return flights;
};

function scanPageSize(tsv: string) {
  const page = tsv.match(/^1\t[^\r\n]+/m)?.[0].split("\t");
  return { width: Number(page?.[8]), height: Number(page?.[9]) };
}

export function parseScheduleTsv(
  tsv: string,
  ocrConfidence = 0,
  onGeometry?: (geometry: ScanGeometry) => void,
): ParsedSchedule | null {
  const words = parseWords(tsv);
  const week = deriveWeek(words);
  const marks = new Map<string, ScanMark>();
  const markedWords = new Set<string>();
  const wordKey = (word: OcrWord) => `${word.x}:${word.y}:${word.width}:${word.height}`;
  const collect: CollectScanMark | undefined = onGeometry && ((mark, group) => {
    group.forEach((word) => markedWords.add(wordKey(word)));
    const x = Math.min(...group.map((word) => word.x));
    const y = Math.min(...group.map((word) => word.y));
    marks.set(mark.id, {
      ...mark,
      x, y,
      width: Math.max(...group.map((word) => word.x + word.width)) - x,
      height: Math.max(...group.map((word) => word.y + word.height)) - y,
      text: group.map((word) => word.text).join(" "),
      confidence: Math.min(...group.map((word) => word.confidence)),
    });
  });
  const emit = (layout?: ScheduleSourceLayout) => {
    if (!collect || !onGeometry) return;
    const size = scanPageSize(tsv);
    if (!(size.width > 0 && size.height > 0)) return;
    for (const word of words) {
      if (markedWords.has(wordKey(word))) continue;
      collect({
        id: `text:${Math.round(word.centerX / size.width * 160)}:${Math.round(word.centerY / size.height * 160)}`,
        kind: "text",
        unreadable: false,
      }, [word]);
    }
    onGeometry({
      ...size, marks: [...marks.values()], workerRows: layout?.rows ?? [], dates: week?.dates,
      dateHeader: week ? sourceBand(week.headerWords, week.slope) : undefined,
      grid: layout && { left: layout.left, right: layout.right, slope: layout.slope },
    });
  };
  if (!week) {
    emit();
    return null;
  }
  for (const word of week.headerWords) {
    collect?.({ id: `date:${isoDate(word.value)}`, kind: "date", date: isoDate(word.value), unreadable: false }, [word]);
  }
  const { shifts, rows } = parseShifts(words, week, collect);
  const flights = parseFlights(words, week, collect);
  const sourceLayout = sourceLayoutFor(tsv, week, rows);
  emit(sourceLayout);
  const workingShifts = shifts.filter((shift) => shift.status === "working");
  if (!workingShifts.length && !flights.length) return null;

  const warnings: string[] = [];
  if (week.confidence < 65 || ocrConfidence < 45) {
    warnings.push("Some text was difficult to read. Check your shift and worker names.");
  }
  if (!flights.length) {
    warnings.push("No flight rows were confidently recognized.");
  }
  if (!workingShifts.length) {
    warnings.push(
      "No work hours were confidently recognized, so only the readable flights were imported.",
    );
  }
  return {
    dates: week.dates,
    shifts,
    flights,
    confidence: Math.round((week.confidence + Math.max(0, ocrConfidence)) / 2),
    warnings,
    sourceLayout,
  };
}
