/**
 * Paycom's Web Time Sheet (a PDF from the Paycom app: Time Sheet → share):
 * read its punches, add the ones missing here, and compare the rest with
 * your own clock-ins so anything that's off stands out.
 */
import { addDays, punchDay, punchHours, roundPunch, type ClockSettings, type Punch } from "./time-clock.ts";

export type SheetPair = { in: string; out?: string };
export type SheetRow = { date: string; pairs: SheetPair[]; hours: number | null };
export type PaycomSheet = { start: string; end: string; rows: SheetRow[]; total: number | null; readAt: string };

type TextItem = { text: string; x: number; y: number; page: number };

const TIME = /(\d{1,2}):(\d{2})\s*([AP])M/gi;
const DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*\s+(\d{1,2})\/(\d{1,2})\b/i;
const RANGE = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const pad = (value: number | string) => String(value).padStart(2, "0");

const clock24 = (hour: string, minute: string, half: string) =>
  `${pad((Number(hour) % 12) + (half.toUpperCase() === "P" ? 12 : 0))}:${minute}`;

/** Text pieces grouped into lines (same page, about the same height), left to right. */
function linesOf(items: TextItem[]) {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Array<{ page: number; y: number; items: TextItem[] }> = [];
  for (const item of sorted) {
    const line = lines.at(-1);
    if (line && line.page === item.page && Math.abs(line.y - item.y) <= 3) line.items.push(item);
    else lines.push({ page: item.page, y: item.y, items: [item] });
  }
  return lines.map((line) => {
    const pieces = line.items.sort((a, b) => a.x - b.x);
    return { ...line, items: pieces, text: pieces.map((piece) => piece.text).join(" ") };
  });
}

/** Reads a time sheet's text (from pdf.js). Null when it isn't one. */
export function parsePaycomSheet(items: TextItem[], now = new Date()): PaycomSheet | null {
  const lines = linesOf(items);
  const all = lines.map((line) => line.text).join("\n");
  if (!/time sheet/i.test(all)) return null;
  const range = all.match(RANGE);
  if (!range) return null;
  const start = `${range[3]}-${pad(range[1])}-${pad(range[2])}`;
  const end = `${range[6]}-${pad(range[4])}-${pad(range[5])}`;
  const yearFor = (month: number) => (Number(range[1]) <= month ? Number(range[3]) : Number(range[6]));

  // Each day's label, and each line of punches (its row: the nearest day label).
  const days = lines.flatMap((line) => {
    const match = line.text.match(DAY);
    return match ? [{ page: line.page, y: line.y, date: `${yearFor(Number(match[2]))}-${pad(match[2])}-${pad(match[3])}` }] : [];
  });
  const rows = new Map<string, SheetRow>();
  for (const line of lines) {
    const times = [...line.text.matchAll(TIME)].map((match) => clock24(match[1], match[2], match[3]));
    if (!times.length || /selected pay period/i.test(line.text)) continue;
    const onPage = days.filter((day) => day.page === line.page);
    const sameLine = line.text.match(DAY);
    const day = sameLine
      ? onPage.find((candidate) => Math.abs(candidate.y - line.y) <= 3)
      : onPage.reduce<(typeof onPage)[number] | undefined>((best, candidate) =>
          !best || Math.abs(candidate.y - line.y) < Math.abs(best.y - line.y) ? candidate : best, undefined);
    if (!day) continue;
    // The numbers after the last time: Hours, then Total Hours.
    const afterTimes = line.text.slice(line.text.search(/\d{1,2}:\d{2}\s*[AP]M(?![\s\S]*\d{1,2}:\d{2}\s*[AP]M)/i));
    const numbers = [...afterTimes.replace(/\d{1,2}:\d{2}\s*[AP]M/gi, "").matchAll(/(?<![\d.])(\d{1,2}\.\d{2})(?![\d])/g)].map((match) => Number(match[1]));
    const pairs: SheetPair[] = [];
    for (let index = 0; index < times.length; index += 2) pairs.push({ in: times[index], out: times[index + 1] });
    const row = rows.get(day.date) ?? { date: day.date, pairs: [], hours: null };
    row.pairs.push(...pairs);
    if (numbers.length) row.hours = (row.hours ?? 0) + numbers[0];
    rows.set(day.date, row);
  }
  const totalLine = lines.find((line) => /pay period totals/i.test(line.text));
  const total = totalLine?.text.match(/(\d{1,3}\.\d{2})\s*$/) ?? totalLine?.text.match(/(\d{1,3}\.\d{2})/);
  return {
    start,
    end,
    rows: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)),
    total: total ? Number(total[1]) : null,
    readAt: now.toISOString(),
  };
}

/** Reads a Paycom time sheet PDF. */
export async function readPaycomSheet(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const items: TextItem[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      for (const item of content.items) {
        if ("str" in item && item.str.trim()) items.push({ text: item.str, x: item.transform[4], y: item.transform[5], page: pageNumber });
      }
    }
  } finally {
    await document.destroy().catch(() => undefined);
  }
  return parsePaycomSheet(items);
}

/** A sheet's punches as clock punches (an out before the in is the next morning). */
export function sheetPunches(sheet: PaycomSheet): Array<Punch & { row?: SheetRow }> {
  return sheet.rows.flatMap((row) => row.pairs.map((pair, index) => {
    const start = new Date(`${row.date}T${pair.in}:00`);
    const outDay = pair.out && pair.out <= pair.in ? addDays(row.date, 1) : row.date;
    return {
      id: `paycom-${row.date}-${pair.in.replace(":", "")}`,
      in: start.toISOString(),
      ...(pair.out ? { out: new Date(`${outDay}T${pair.out}:00`).toISOString() } : {}),
      from: "paycom" as const,
      ...(index === 0 ? { row } : {}),
    };
  }));
}

export type SheetCheck =
  | { kind: "match"; paycom: Punch; mine: Punch }
  | { kind: "rounds-same"; paycom: Punch; mine: Punch }
  | { kind: "differs"; paycom: Punch; mine: Punch; gap: number }
  | { kind: "missing-here"; paycom: Punch }
  | { kind: "not-on-paycom"; mine: Punch }
  | { kind: "paycom-math"; paycom: Punch; shown: number; worked: number }
  | { kind: "paycom-total"; shown: number; worked: number };

const minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);
const overlaps = (a: Punch, b: Punch) => {
  const aEnd = Date.parse(a.out ?? new Date().toISOString());
  const bEnd = Date.parse(b.out ?? new Date().toISOString());
  return Date.parse(a.in) < bEnd && Date.parse(b.in) < aEnd;
};

/**
 * Lines up Paycom's punches with yours: the same, the same once rounded,
 * different (a flag), on Paycom only, or here only (a flag: maybe a missed punch there).
 */
export function compareSheet(sheet: PaycomSheet, punches: Punch[], settings: ClockSettings) {
  const step = settings.roundTo;
  const mine = punches.filter((punch) => punchDay(punch) >= sheet.start && punchDay(punch) <= sheet.end);
  const used = new Set<string>();
  const checks: SheetCheck[] = [];
  const theirs = sheetPunches(sheet);
  for (const paycom of theirs) {
    const candidates = mine.filter((punch) => !used.has(punch.id) &&
      (overlaps(punch, paycom) || Math.abs(minute(punch.in) - minute(paycom.in)) <= 90));
    const best = candidates.sort((a, b) => Math.abs(minute(a.in) - minute(paycom.in)) - Math.abs(minute(b.in) - minute(paycom.in)))[0];
    // Paycom's hours for the day, against its own punches rounded by your rule.
    if (paycom.row?.hours !== null && paycom.row?.hours !== undefined && paycom.row.pairs.every((pair) => pair.out)) {
      const day = paycom.row;
      const worked = theirs.filter((punch) => punch.id.startsWith(`paycom-${day.date}-`))
        .reduce((sum, punch) => sum + punchHours(punch, step), 0);
      if (Math.abs(worked - day.hours!) > 0.001) checks.push({ kind: "paycom-math", paycom, shown: day.hours!, worked });
    }
    if (!best) {
      checks.push({ kind: "missing-here", paycom });
      continue;
    }
    used.add(best.id);
    const sameMinutes = minute(best.in) === minute(paycom.in) && (best.out && paycom.out ? minute(best.out) === minute(paycom.out) : !best.out && !paycom.out);
    const rounded = (iso?: string) => (iso ? roundPunch(new Date(iso), step).getTime() : null);
    const sameRounded = rounded(best.in) === rounded(paycom.in) && rounded(best.out) === rounded(paycom.out);
    checks.push(sameMinutes ? { kind: "match", paycom, mine: best }
      : sameRounded ? { kind: "rounds-same", paycom, mine: best }
        : { kind: "differs", paycom, mine: best, gap: punchHours(paycom, step) - punchHours(best, step) });
  }
  // Still clocked in, or after the sheet was saved: not expected on it yet.
  const readAt = Date.parse(sheet.readAt);
  for (const punch of mine) {
    if (!used.has(punch.id) && punch.out && Date.parse(punch.in) < readAt) checks.push({ kind: "not-on-paycom", mine: punch });
  }
  // The period total against its days.
  const days = sheet.rows.reduce((sum, row) => sum + (row.hours ?? 0), 0);
  if (sheet.total !== null && Math.abs(days - sheet.total) > 0.001) checks.push({ kind: "paycom-total", shown: sheet.total, worked: days });

  const order = { "paycom-total": 0, "paycom-math": 1, differs: 2, "not-on-paycom": 3, "missing-here": 4, "rounds-same": 5, match: 6 };
  const when = (check: SheetCheck) => ("paycom" in check ? check.paycom.in : "mine" in check ? check.mine.in : "");
  return checks.sort((a, b) => order[a.kind] - order[b.kind] || when(a).localeCompare(when(b)));
}

/** Flags worth a look (not matches). */
export const isFlag = (check: SheetCheck) => ["differs", "not-on-paycom", "paycom-math", "paycom-total"].includes(check.kind);

/** A sheet's punches as plain punches (to add here). */
export const asPunch = ({ id, in: start, out, from }: Punch): Punch => ({ id, in: start, ...(out ? { out } : {}), ...(from ? { from } : {}) });
