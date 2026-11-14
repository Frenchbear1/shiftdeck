import type { CalendarDatabase } from "./calendar-service";
import type { AirportAlert, LiveFlight } from "./live-flight-data";

export const ABE_BOARD_AIRPORT = "KABE";
export const ABE_BOARD_CRON = "*/5 * * * *";
const BOARD_URL = "https://www.flyabe.com/wp-json/flyabe-flight-status/v1/flights";
const ALERTS_URL = "https://www.flyabe.com/flights/";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const htmlEntities: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};
const localClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// The board publishes city names. ABE lists Orlando and Sanford separately.
const airports: Readonly<Partial<Record<string, string>>> = {
  denver: "DEN", "fort lauderdale": "FLL", "ft lauderdale": "FLL",
  "fort myers": "RSW", "ft myers": "RSW", melbourne: "MLB",
  "myrtle beach": "MYR", nashville: "BNA", orlando: "MCO",
  "orlando international": "MCO", "orlando sanford": "SFB", sanford: "SFB",
  "punta gorda": "PGD", sarasota: "SRQ", "sarasota bradenton": "SRQ",
  "st pete clearwater": "PIE", "st petersburg": "PIE", clearwater: "PIE",
  "fort lauderdale hollywood": "FLL", "orlando sanford international": "SFB",
  "st petersburg clearwater": "PIE", "tampa bay st pete": "PIE",
};

type Snapshot<T> = { fetchedAt: number; data: T };

function decodeText(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return Object.hasOwn(htmlEntities, code) ? htmlEntities[code] : entity;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  }).replace(/\s+/g, " ").trim();
}

function clockMinutes(value: string) {
  const match = value.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*([AP]M)$/i);
  if (!match) return null;
  return (Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match[2]);
}

/** Convert the board's Eastern wall time to an instant, including DST. */
function boardTime(wallTime: number, reference: number) {
  const wall = new Date(wallTime).toISOString().slice(0, 16).replace("T", " ");
  const candidates = [4, 5].map((offset) => wallTime + offset * 60 * MINUTE);
  const valid = candidates.filter((time) => localClock.format(time) === wall);
  if (!valid.length) return null;
  return new Date(valid.reduce((a, b) => Math.abs(a - reference) <= Math.abs(b - reference) ? a : b)).toISOString();
}

function cell(row: string, field: string) {
  const value = row.match(new RegExp(`<span\\s+class="[^"]*\\b${field}\\b[^"]*"[^>]*\\bdata-value="([^"]*)"`, "i"))?.[1] ?? "";
  return decodeText(value);
}

function parseList(html: string, kind: LiveFlight["kind"], now: number) {
  const rows = [...html.matchAll(/<li\b[^>]*\bclass="[^"]*\bflight\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
  if (!rows.length && html.trim()) throw new Error(`Unexpected ABE ${kind} markup`);

  const wallNow = Date.parse(localClock.format(now).replace(" ", "T") + ":00Z");
  let day = Math.floor(wallNow / DAY) * DAY;
  let lastClock: number | null = null;
  const flights: LiveFlight[] = [];
  for (const [, row] of rows) {
    const clock = clockMinutes(cell(row, "time"));
    if (clock === null) continue;
    if (lastClock === null) {
      const gap = day + clock * MINUTE - wallNow;
      // The board can list the upcoming afternoon just after midnight.
      if (gap > 16 * 60 * MINUTE) day -= DAY;
      if (gap < -DAY / 2) day += DAY;
    } else if (clock + 12 * 60 < lastClock) {
      day += DAY;
    }
    lastClock = clock;

    if (!/^allegiant(?: air)?$/i.test(cell(row, "airline"))) continue;
    const number = cell(row, "number").match(/^(?:G4\s*|AAY\s*)?(\d{1,4})$/i)?.[1];
    const scheduled = boardTime(day + clock * MINUTE, now);
    if (!number || !scheduled) continue;

    // A changed time can be displayed in the Status column in place of a word.
    const statusText = row.match(/<span\s+class="[^"]*\bstatus\b[^"]*"[^>]*>\s*<span[^>]*>[^<]*<\/span>\s*([^<]*)/i)?.[1].trim() ?? "";
    const rawStatus = cell(row, "status");
    const newClock = clockMinutes(decodeText(statusText)) ?? clockMinutes(rawStatus.replace(/-(?=[AP]M$)/i, " "));
    const delta = newClock === null ? null : (newClock - clock + 2160) % 1440 - 720;
    const status = delta === null ? decodeText(statusText) || rawStatus.replace(/-/g, " ") : delta > 0 ? "Delayed" : delta < 0 ? "Early" : "On Time";
    const cancelled = /\bcancell?ed\b/i.test(status);
    const done = !cancelled && (kind === "arrival" ? /^(arrived|landed|at gate)\b/i : /^(departed|in air|airborne|took off)\b/i).test(status);
    const city = cell(row, "city");
    const cityKey = city.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const code = Object.hasOwn(airports, cityKey) ? airports[cityKey] : undefined;
    const ident = `G4${Number(number)}`;
    const id = `abe-${kind}-${ident}-${new Date(day).toISOString().slice(0, 10)}`;
    flights.push({
      id, ident, kind, other: code ? [code, `K${code}`] : city ? [city] : [],
      scheduled, estimated: delta === null ? null : boardTime(day + (clock + delta) * MINUTE, Date.parse(scheduled)),
      status, cancelled, done, gate: cell(row, "gate") || null,
      delayMinutes: delta, airportBoardId: id, airportBoardSeenAt: now,
    });
  }
  return flights;
}

export function parseAbeBoard(data: unknown, now: number): LiveFlight[] {
  const board = data as { code?: unknown; arrivals?: unknown; departures?: unknown } | null;
  if (board?.code !== "ok" || typeof board.arrivals !== "string" || typeof board.departures !== "string") {
    throw new Error("Unexpected ABE flight board response");
  }
  return [...parseList(board.arrivals, "arrival", now), ...parseList(board.departures, "departure", now)];
}

let boardReady = false;
async function ensureBoard(db: CalendarDatabase) {
  if (boardReady) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS abe_board_cache (source TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, payload TEXT NOT NULL)").run();
  boardReady = true;
}

async function readSnapshot<T>(db: CalendarDatabase, source: "flights" | "alerts"): Promise<Snapshot<T> | null> {
  await ensureBoard(db);
  const row = await db.prepare("SELECT fetched_at, payload FROM abe_board_cache WHERE source = ?")
    .bind(source).first<{ fetched_at: number; payload: string }>();
  return row ? { fetchedAt: row.fetched_at, data: JSON.parse(row.payload) as T } : null;
}

export const readAbeBoard = (db: CalendarDatabase) => readSnapshot<LiveFlight[]>(db, "flights");
export const readAbeAlerts = (db: CalendarDatabase) => readSnapshot<AirportAlert[]>(db, "alerts");

async function fetchFresh(url: string, now: number, accept: string) {
  // The ordinary URL sometimes returns cached data from several hours ago.
  const response = await fetch(`${url}?shiftdeck=${Math.floor(now / (5 * MINUTE))}`, {
    cache: "no-store",
    headers: { Accept: accept, "User-Agent": "Shiftdeck (ABE flight status)" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`ABE board HTTP ${response.status}`);
  const modified = Date.parse(response.headers.get("last-modified") ?? "");
  if (Number(response.headers.get("age")) > 15 * 60 || now - modified > 15 * MINUTE) {
    throw new Error("Cached ABE board response is stale");
  }
  return response;
}

async function saveSnapshot(db: CalendarDatabase, source: "flights" | "alerts", now: number, data: unknown) {
  await db.prepare(`INSERT INTO abe_board_cache (source, fetched_at, payload) VALUES (?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload
    WHERE excluded.fetched_at > abe_board_cache.fetched_at`)
    .bind(source, now, JSON.stringify(data)).run();
}

export async function refreshAbeBoard(db: CalendarDatabase, scheduledTime: number) {
  const previous = await readAbeBoard(db);
  if (previous && previous.fetchedAt >= scheduledTime) return;

  const response = await fetchFresh(BOARD_URL, scheduledTime, "application/json");
  const flights = new Map<string, LiveFlight>();
  for (const flight of previous?.data ?? []) {
    if (Date.parse(flight.scheduled ?? "") >= scheduledTime - 36 * 60 * MINUTE) flights.set(flight.id, flight);
  }
  for (const flight of parseAbeBoard(await response.json(), scheduledTime)) flights.set(flight.id, flight);
  await saveSnapshot(db, "flights", scheduledTime, [...flights.values()]);
}

export function parseAbeAlerts(html: string): AirportAlert[] {
  if (!/<header\b[^>]*\bid="main"/i.test(html)) throw new Error("Unexpected ABE website response");
  const banner = html.match(/<section\b[^>]*\bid="announcement"[^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? "";
  return [...banner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].flatMap(([, paragraph]) => {
    const text = decodeText(paragraph.replace(/<[^>]*>/g, " "));
    if (!text) return [];
    const href = paragraph.match(/<a\b[^>]*\bhref=["']([^"']+)["']/i)?.[1];
    const link = href ? URL.parse(decodeText(href), ALERTS_URL) : null;
    return [{ text, url: link?.protocol === "https:" ? link.href : undefined }];
  });
}

export async function refreshAbeAlerts(db: CalendarDatabase, scheduledTime: number) {
  const previous = await readAbeAlerts(db);
  if (previous && previous.fetchedAt >= scheduledTime) return;
  const response = await fetchFresh(ALERTS_URL, scheduledTime, "text/html");
  await saveSnapshot(db, "alerts", scheduledTime, parseAbeAlerts(await response.text()));
}

/** Combine the airport status with any existing FlightAware enrichment. */
export function mergeAbeBoard(aero: LiveFlight[], board: Snapshot<LiveFlight[]> | null, aeroAt: number) {
  if (!board) return aero;
  const merged = [...aero];
  for (const flight of board.data) {
    const index = aero.findIndex((candidate) => candidate.kind === flight.kind &&
      candidate.ident.replace(/^AAY/, "G4") === flight.ident &&
      Math.abs(Date.parse(candidate.scheduled ?? "") - Date.parse(flight.scheduled ?? "")) < 3 * 60 * MINUTE);
    if (index === -1) {
      merged.push(flight);
      continue;
    }
    const candidate = aero[index];
    const completed = Boolean(flight.kind === "arrival" ? candidate.atGateAt : candidate.tookOffAt);
    const preferBoard = (flight.airportBoardSeenAt ?? board.fetchedAt) >= aeroAt;
    merged[index] = preferBoard ? {
      ...candidate,
      airportBoardId: flight.id,
      airportBoardSeenAt: flight.airportBoardSeenAt,
      status: flight.status || candidate.status,
      gate: flight.gate ?? candidate.gate,
      estimated: flight.estimated ?? (/^on time$/i.test(flight.status) ? flight.scheduled : candidate.estimated),
      cancelled: flight.status ? flight.cancelled : candidate.cancelled,
      done: !flight.cancelled && (flight.done || completed),
      delayMinutes: flight.delayMinutes ?? (/^on time$/i.test(flight.status) ? 0 : candidate.delayMinutes),
    } : { ...candidate, airportBoardId: flight.id };
  }
  return merged;
}
