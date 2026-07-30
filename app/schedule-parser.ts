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

export type ParsedSchedule = {
  dates: string[];
  shifts: Shift[];
  flights: Flight[];
  confidence: number;
  warnings: string[];
};

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

const deriveWeek = (words: OcrWord[]) => {
  const candidates = words
    .map((word) => {
      const value = parseDateToken(word.text);
      return value ? ({ ...word, value } satisfies DatedWord) : null;
    })
    .filter((word): word is DatedWord => Boolean(word))
    .sort((a, b) => a.centerX - b.centerX);

  if (candidates.length < 4) return null;

  const gaps = candidates
    .slice(1)
    .map((word, index) => word.centerX - candidates[index].centerX)
    .filter((gap) => gap > 0);
  const smallestGaps = [...gaps].sort((a, b) => a - b).slice(
    0,
    Math.max(2, Math.min(6, gaps.length)),
  );
  const spacing = median(smallestGaps);
  if (!spacing) return null;

  const firstX = candidates[0].centerX;
  const indexed = candidates.map((word) => ({
    ...word,
    index: Math.max(0, Math.min(6, Math.round((word.centerX - firstX) / spacing))),
  }));
  const baseDays = indexed.map(
    (word) => Math.round(word.value.getTime() / DAY_MS) - word.index,
  );
  const counts = new Map<number, number>();
  baseDays.forEach((day) => counts.set(day, (counts.get(day) ?? 0) + 1));
  const baseDay = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || Math.abs(a[0] - median(baseDays)) - Math.abs(b[0] - median(baseDays)),
  )[0][0];
  const baseDate = new Date(baseDay * DAY_MS);

  const centersByIndex = new Map<number, number>();
  indexed.forEach((word) => centersByIndex.set(word.index, word.centerX));
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
  const slope = linearSlope(candidates);
  const correctedHeaderY = median(
    candidates.map((word) => word.centerY - slope * word.centerX),
  );

  return {
    dates: Array.from({ length: 7 }, (_, index) => isoDate(addDays(baseDate, index))),
    columnCenters,
    spacing: inferredSpacing,
    slope,
    correctedHeaderY,
    confidence: average(candidates.map((word) => word.confidence)),
  };
};

const cleanNameWord = (raw: string) => {
  const cleaned = raw.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, "");
  if (!cleaned) return "";
  if (cleaned === cleaned.toLowerCase() || cleaned === cleaned.toUpperCase()) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }
  return cleaned;
};

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

  const namedRows = groups
    .map((group) => {
      const name = group
        .sort((a, b) => a.x - b.x)
        .map((word) => cleanNameWord(word.text))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const nameParts = name.split(" ");
      return {
        name:
          nameParts.length >= 3 && nameParts[0].length <= 2
            ? nameParts.slice(1).join(" ")
            : name,
        y: average(group.map((word) => word.rowY)),
      };
    })
    .filter((row) => isPlausibleWorkerName(row.name))
    .filter((row) => row.name.toLowerCase() !== "open");

  if (!namedRows.length) return [];
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

  return namedRows.flatMap<Shift>((row) => {
    const wordsForRow = cellWords.filter(
      (word) => Math.abs(word.rowY - row.y) <= rowTolerance,
    );
    return week.dates.map((date, columnIndex) => {
      const cellText = wordsForRow
        .filter(
          (word) =>
            nearestColumn(word.centerX, week.columnCenters, week.spacing) === columnIndex,
        )
        .sort((a, b) => a.x - b.x)
        .map((word) => word.text)
        .join(" ");
      const normalized = normalizedCellText(cellText);
      const range = normalizedTimeRange(normalized);
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
      return {
        id: `${date}-${row.name}-off`,
        date,
        worker: row.name,
        start: "",
        end: "",
        status: "off",
      };
    });
  });
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
    .replace(/\bSC\b/g, "")
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
  const outbound = raw.match(/^(\d{3,4})\s+([A-Z]{3,4})$/);
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
  const inbound = raw.match(/^([A-Z]{3,4})\s+(\d{3,4})$/);
  if (!inbound) return null;
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
      const cellText = row
        .filter(
          (word) =>
            nearestColumn(word.centerX, week.columnCenters, week.spacing) === columnIndex,
        )
        .sort((a, b) => a.x - b.x)
        .map((word) => word.text)
        .join(" ")
        .trim();
      if (!cellText) return;
      const provisional = parseFlightCell(
        cellText,
        week.dates[columnIndex],
        labelPeriod ?? "Morning",
        rowIndex * 7 + columnIndex,
      );
      if (!provisional) return;
      const period = labelPeriod ?? periodForTime(provisional.start);
      flights.push({
        ...provisional,
        id: `${provisional.date}-${period}-${rowIndex * 7 + columnIndex}-${provisional.start}`,
        period,
      });
    });
  });
  return flights;
};

export function parseScheduleTsv(tsv: string, ocrConfidence = 0): ParsedSchedule | null {
  const words = parseWords(tsv);
  const week = deriveWeek(words);
  if (!week) return null;
  words.forEach((word) => {
    word.rowY = word.centerY - week.slope * word.centerX;
  });
  const shifts = parseShifts(words, week);
  const flights = parseFlights(words, week);
  const workingShifts = shifts.filter((shift) => shift.status === "working");
  if (!workingShifts.length) return null;

  const warnings: string[] = [];
  if (week.confidence < 65 || ocrConfidence < 45) {
    warnings.push("Some text was difficult to read. Check your shift and worker names.");
  }
  if (!flights.length) {
    warnings.push("No flight rows were confidently recognized.");
  }
  return {
    dates: week.dates,
    shifts,
    flights,
    confidence: Math.round((week.confidence + Math.max(0, ocrConfidence)) / 2),
    warnings,
  };
}
