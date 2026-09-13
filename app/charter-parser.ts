import type { Flight, Shift } from "./sample-data";

export type CharterTextItem = {
  text: string;
  x: number;
  y: number;
  page?: number;
};

export type ParsedCharterSchedule = {
  dates: string[];
  shifts: Shift[];
  flights: Flight[];
  confidence: number;
  warnings: string[];
};

type CharterHeader = {
  operator: string;
  aircraft: string;
  trackingId: string;
};

const HEADER_PATTERN =
  /\b([A-Z][A-Z0-9 ]*?)\s*\|\s*([A-Z0-9-]+)\s*\|\s*([A-Z0-9-]+)\b/i;
const LEG_PATTERN =
  /\b(Inbound|Return|Reposition\s*\/\s*Ferry)\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+([A-Z]{3,4})\s+([A-Z]{3,4})\s+(\d{3,4})\s+(\d{3,4})\b/i;

const cleanLabel = (value: string) =>
  value.replace(/\s+/g, " ").trim().toUpperCase();

const parseCharterDate = (value: string) => {
  const match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
};

const parseCharterClock = (value: string) => {
  const digits = value.replace(/\D/g, "").padStart(4, "0");
  if (digits.length !== 4) return null;
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  return hours <= 23 && minutes <= 59
    ? `${digits.slice(0, 2)}:${digits.slice(2)}`
    : null;
};

const periodForTime = (time: string): Flight["period"] => {
  const hour = Number(time.slice(0, 2));
  if (hour < 11) return "Morning";
  if (hour < 19) return "Afternoon";
  return "Evening";
};

export const normalizeFlightAwareIdent = (value: string) => {
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^C[FG][A-Z]{3}$/.test(compact)
    ? `${compact[0]}-${compact.slice(1)}`
    : compact;
};

const textLines = (items: CharterTextItem[]) => {
  const pages = new Map<number, CharterTextItem[]>();
  items.forEach((item) => {
    const page = item.page ?? 1;
    pages.set(page, [...(pages.get(page) ?? []), item]);
  });

  return [...pages.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, pageItems]) => {
      const lines: CharterTextItem[][] = [];
      [...pageItems]
        .filter((item) => item.text.trim())
        .sort((left, right) => right.y - left.y || left.x - right.x)
        .forEach((item) => {
          const line = lines.find(
            (candidate) =>
              Math.abs(
                item.y -
                  candidate.reduce((total, word) => total + word.y, 0) /
                    candidate.length,
              ) <= 3,
          );
          if (line) line.push(item);
          else lines.push([item]);
        });
      return lines
        .sort(
          (left, right) =>
            right.reduce((total, word) => total + word.y, 0) / right.length -
            left.reduce((total, word) => total + word.y, 0) / left.length,
        )
        .map((line) =>
          line
            .sort((left, right) => left.x - right.x)
            .map((item) => item.text.trim())
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        );
    });
};

export function parseCharterTextItems(
  items: CharterTextItem[],
): ParsedCharterSchedule | null {
  const flights: Flight[] = [];
  let header: CharterHeader | null = null;

  textLines(items).forEach((line, lineIndex) => {
    const headerMatch = line.match(HEADER_PATTERN);
    if (headerMatch) {
      header = {
        operator: cleanLabel(headerMatch[1]),
        aircraft: cleanLabel(headerMatch[2]),
        trackingId: normalizeFlightAwareIdent(headerMatch[3]),
      };
      return;
    }

    const leg = line.match(LEG_PATTERN);
    if (!leg || !header) return;
    const date = parseCharterDate(leg[2]);
    const departure = parseCharterClock(leg[5]);
    const arrival = parseCharterClock(leg[6]);
    if (!date || !departure || !arrival) return;
    const origin = leg[3].toUpperCase();
    const destination = leg[4].toUpperCase();
    const kind: Flight["kind"] =
      /^return$/i.test(leg[1]) ? "departure" : "arrival";
    const start = kind === "departure" ? departure : arrival;

    flights.push({
      id: `${date}-charter-${header.trackingId}-${lineIndex}-${start}`,
      date,
      period: periodForTime(start),
      kind,
      raw: `${header.operator} | ${header.aircraft} | ${header.trackingId} - ${leg[1]}`,
      origin,
      destination,
      inboundAirport: kind === "arrival" ? origin : undefined,
      outboundAirport: kind === "departure" ? destination : undefined,
      arrival,
      departure,
      start,
      end: kind === "arrival" ? arrival : undefined,
      source: "charter",
      operator: header.operator,
      aircraft: header.aircraft,
      trackingId: header.trackingId,
    });
  });

  if (!flights.length) return null;
  return {
    dates: Array.from(new Set(flights.map((flight) => flight.date))).sort(),
    shifts: [],
    flights,
    confidence: 100,
    warnings: [],
  };
}

export async function parseCharterPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const document = await loadingTask.promise;
  const items: CharterTextItem[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      content.items.forEach((item) => {
        if (!("str" in item) || !item.str.trim()) return;
        items.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          page: pageNumber,
        });
      });
    }
  } finally {
    await document.destroy();
  }
  return parseCharterTextItems(items);
}
