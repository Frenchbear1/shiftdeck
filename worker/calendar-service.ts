import { calendarSchemaStatements } from "../db/schema";
import { renderAppleTimedAlarm } from "./calendar-alarms";
import {
  FLIGHTAWARE_ORIGIN,
  matchFlightAwareResult,
} from "./flightaware";

type D1Result<T = unknown> = {
  results?: T[];
  success?: boolean;
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};

export type CalendarDatabase = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

type CalendarFeedRow = {
  id: string;
  write_token_hash: string;
  name: string;
  location: string;
  location_lat: number | null;
  location_lon: number | null;
  notes: string;
  reminder1: string;
  reminder2: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

type CalendarEventRow = {
  calendar_id: string;
  event_key: string;
  date: string;
  start_time: string;
  end_time: string;
  base_title: string;
  signature: string;
  sequence: number;
  status: "confirmed" | "cancelled";
  updated_at: string;
};

type IncomingEvent = {
  key: string;
  date: string;
  start: string;
  end: string;
  title?: string;
};

type SyncPayload = {
  name?: string;
  title?: string;
  location?: string;
  locationLat?: number | null;
  locationLon?: number | null;
  notes?: string;
  reminder1?: string;
  reminder2?: string;
  events?: IncomingEvent[];
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const CALENDAR_FORMAT_VERSION = 3;

const ALLOWED_ORIGINS = new Set([
  "https://shiftdeck-schedule.frenchbear.chatgpt.site",
  "https://frenchbear1.github.io",
]);

let schemaReady = false;

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch(
    calendarSchemaStatements.map((statement) => db.prepare(statement)),
  );
  schemaReady = true;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed =
    ALLOWED_ORIGINS.has(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS.values().next().value,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  request: Request,
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

function isAllowedBrowserOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  return (
    ALLOWED_ORIGINS.has(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
}

function randomToken(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bearerToken(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function validFeedId(value: string) {
  return /^[A-Za-z0-9_-]{24,80}$/.test(value);
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function searchPlaces(request: Request) {
  if (!isAllowedBrowserOrigin(request)) {
    return json(request, { error: "Origin not allowed" }, 403);
  }
  const query = cleanText(new URL(request.url).searchParams.get("q"), 160);
  if (query.length < 3) return json(request, { features: [] });
  try {
    const response = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=en&limit=10&countrycode=US`,
      {
        headers: { Accept: "application/json" },
        cf: { cacheEverything: true, cacheTtl: 3600 },
      } as RequestInit,
    );
    if (!response.ok) {
      return json(request, { error: "Place search failed" }, 502);
    }
    const result = (await response.json()) as { features?: unknown[] };
    return json(
      request,
      { features: Array.isArray(result.features) ? result.features : [] },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  } catch {
    return json(request, { error: "Place search failed" }, 502);
  }
}

function validAirport(value: string) {
  return /^[A-Z]{3,4}$/.test(value);
}

async function resolveFlightAwareFlight(request: Request) {
  const url = new URL(request.url);
  const origin = cleanText(url.searchParams.get("origin"), 4).toUpperCase();
  const destination = cleanText(
    url.searchParams.get("destination"),
    4,
  ).toUpperCase();
  const date = cleanText(url.searchParams.get("date"), 10);
  const time = cleanText(url.searchParams.get("time"), 5);
  const matchField =
    url.searchParams.get("match") === "departure" ? "departure" : "arrival";
  const fallback = new URL("/live/findflight", FLIGHTAWARE_ORIGIN);
  fallback.searchParams.set("origin", origin);
  fallback.searchParams.set("destination", destination);

  if (
    !validAirport(origin) ||
    !validAirport(destination) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  ) {
    return new Response(null, {
      status: 302,
      headers: { Location: fallback.toString(), "Cache-Control": "no-store" },
    });
  }

  let destinationUrl = fallback.toString();
  try {
    const response = await fetch(fallback, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; Shiftdeck/1.0)",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (response.ok) {
      destinationUrl =
        matchFlightAwareResult(
          await response.text(),
          date,
          time,
          matchField,
        ) ?? destinationUrl;
    }
  } catch {
    // FlightAware can change or temporarily block its result page. The route
    // list remains a safe fallback so the card never becomes a dead link.
  }

  return new Response(null, {
    status: 302,
    headers: { Location: destinationUrl, "Cache-Control": "no-store" },
  });
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizePayload(payload: SyncPayload) {
  const title = cleanText(payload.title, 160) || "Work";
  const name = cleanText(payload.name, 100) || "Shiftdeck";
  const location = cleanText(payload.location, 300);
  const locationLat =
    typeof payload.locationLat === "number" &&
    Number.isFinite(payload.locationLat) &&
    payload.locationLat >= -90 &&
    payload.locationLat <= 90
      ? payload.locationLat
      : null;
  const locationLon =
    typeof payload.locationLon === "number" &&
    Number.isFinite(payload.locationLon) &&
    payload.locationLon >= -180 &&
    payload.locationLon <= 180
      ? payload.locationLon
      : null;
  const notes = cleanText(payload.notes, 1000);
  const reminder1 = cleanText(payload.reminder1, 20);
  const reminder2 = cleanText(payload.reminder2, 20);
  const allowedReminders = new Set([
    "",
    "PT0M",
    "PT15M",
    "PT30M",
    "PT1H",
    "PT2H",
    "P1D",
    "P2D",
    "P1W",
  ]);
  const seen = new Set<string>();
  const events = (Array.isArray(payload.events) ? payload.events : [])
    .slice(0, 400)
    .flatMap((event) => {
      const key = cleanText(event?.key, 180);
      const date = cleanText(event?.date, 10);
      const start = cleanText(event?.start, 5);
      const end = cleanText(event?.end, 5);
      const eventTitle = cleanText(event?.title, 160) || title;
      if (
        !key ||
        seen.has(key) ||
        !validDate(date) ||
        !validTime(start) ||
        !validTime(end)
      ) {
        return [];
      }
      seen.add(key);
      return [{ key, date, start, end, title: eventTitle }];
    });
  return {
    name,
    title,
    location,
    locationLat,
    locationLon,
    notes,
    reminder1: allowedReminders.has(reminder1) ? reminder1 : "",
    reminder2: allowedReminders.has(reminder2) ? reminder2 : "",
    events,
  };
}

function safeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDateTime(date: string, time: string, nextDay = false) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (nextDay) value.setUTCDate(value.getUTCDate() + 1);
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
}

function icsStamp(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function uidFor(calendarId: string, eventKey: string) {
  const cleanKey = eventKey.toLowerCase().replace(/[^a-z0-9:-]+/g, "-");
  return `${cleanKey}.${calendarId.slice(0, 12)}@shiftdeck.app`;
}

function renderCalendar(feed: CalendarFeedRow, events: CalendarEventRow[]) {
  const reminders = Array.from(
    new Set(
      [feed.reminder1, feed.reminder2].filter(
        (reminder) => reminder && reminder !== "TIME_TO_LEAVE",
      ),
    ),
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Shiftdeck//Automatic Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${safeIcsText(feed.name)}`,
    "X-WR-TIMEZONE:America/New_York",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  events.forEach((event) => {
    const overnight = event.end_time <= event.start_time;
    const title = event.base_title;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidFor(feed.id, event.event_key)}`,
      `DTSTAMP:${icsStamp(event.updated_at)}`,
      `LAST-MODIFIED:${icsStamp(event.updated_at)}`,
      `SEQUENCE:${event.sequence}`,
      `DTSTART:${icsDateTime(event.date, event.start_time)}`,
      `DTEND:${icsDateTime(event.date, event.end_time, overnight)}`,
      `SUMMARY:${safeIcsText(title)}`,
      `STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      `X-SHIFTDECK-REVISION:${event.sequence}`,
    );
    if (event.status === "confirmed") {
      if (feed.location) lines.push(`LOCATION:${safeIcsText(feed.location)}`);
      if (feed.notes) lines.push(`DESCRIPTION:${safeIcsText(feed.notes)}`);
      reminders.forEach((reminder) => {
        lines.push(
          ...renderAppleTimedAlarm(feed.id, event.event_key, reminder),
        );
      });
    }
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

async function getAuthorizedFeed(
  request: Request,
  db: CalendarDatabase,
  id: string,
) {
  if (!validFeedId(id)) return null;
  const token = bearerToken(request);
  if (!token) return null;
  const feed = await db
    .prepare(
      `SELECT id, write_token_hash, name, location, location_lat, location_lon,
        notes, reminder1, reminder2, created_at, updated_at, revoked_at
       FROM calendar_feeds
       WHERE id = ?1 AND revoked_at IS NULL`,
    )
    .bind(id)
    .first<CalendarFeedRow>();
  if (!feed || (await sha256(token)) !== feed.write_token_hash) return null;
  return feed;
}

async function createFeed(request: Request, db: CalendarDatabase) {
  if (!isAllowedBrowserOrigin(request)) {
    return json(request, { error: "Origin not allowed" }, 403);
  }
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const clientHash = await sha256(
    request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "local",
  );
  const creationRow = await db
    .prepare(
      `SELECT count FROM calendar_feed_creations
       WHERE client_hash = ?1 AND day = ?2`,
    )
    .bind(clientHash, day)
    .first<{ count: number }>();
  if ((creationRow?.count ?? 0) >= 10) {
    return json(
      request,
      { error: "Calendar setup limit reached for today" },
      429,
    );
  }
  const id = randomToken(27);
  const writeToken = randomToken(32);
  const writeHash = await sha256(writeToken);
  await db.batch([
    db
      .prepare(
        `INSERT INTO calendar_feeds
         (id, write_token_hash, name, location, notes, reminder1, reminder2, created_at, updated_at)
         VALUES (?1, ?2, 'Shiftdeck', '', '', '', '', ?3, ?3)`,
      )
      .bind(id, writeHash, now),
    db
      .prepare(
        `INSERT INTO calendar_feed_creations (client_hash, day, count)
         VALUES (?1, ?2, 1)
         ON CONFLICT(client_hash, day) DO UPDATE SET count = count + 1`,
      )
      .bind(clientHash, day),
  ]);
  const origin = new URL(request.url).origin;
  return json(
    request,
    {
      id,
      writeToken,
      feedUrl: `${origin}/calendar/${id}.ics`,
      createdAt: now,
    },
    201,
  );
}

async function syncFeed(
  request: Request,
  db: CalendarDatabase,
  id: string,
) {
  const feed = await getAuthorizedFeed(request, db, id);
  if (!feed) return json(request, { error: "Calendar not found" }, 404);

  let rawPayload: SyncPayload;
  try {
    rawPayload = (await request.json()) as SyncPayload;
  } catch {
    return json(request, { error: "Invalid calendar data" }, 400);
  }
  const payload = normalizePayload(rawPayload);
  const existingResult = await db
    .prepare(
      `SELECT calendar_id, event_key, date, start_time, end_time, base_title,
        signature, sequence, status, updated_at
       FROM calendar_events WHERE calendar_id = ?1`,
    )
    .bind(id)
    .all<CalendarEventRow>();
  const existing = new Map(
    (existingResult.results ?? []).map((event) => [event.event_key, event]),
  );
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE calendar_feeds
         SET name = ?2, location = ?3, location_lat = ?4, location_lon = ?5,
            notes = ?6, reminder1 = ?7, reminder2 = ?8, updated_at = ?9
         WHERE id = ?1`,
      )
      .bind(
        id,
        payload.name,
        payload.location,
        payload.locationLat,
        payload.locationLon,
        payload.notes,
        payload.reminder1,
        payload.reminder2,
        now,
      ),
  ];
  let created = 0;
  let revised = 0;
  let cancelled = 0;

  payload.events.forEach((event) => {
    const signature = JSON.stringify([
      event.date,
      event.start,
      event.end,
      event.title,
      payload.location,
      payload.locationLat,
      payload.locationLon,
      payload.notes,
      payload.reminder1,
      payload.reminder2,
    ]);
    const previous = existing.get(event.key);
    const changed =
      !previous ||
      previous.signature !== signature ||
      previous.status !== "confirmed";
    const sequence = previous
      ? previous.sequence + (changed ? 1 : 0)
      : 0;
    if (!previous) created += 1;
    else if (changed) revised += 1;
    statements.push(
      db
        .prepare(
          `INSERT INTO calendar_events
           (calendar_id, event_key, date, start_time, end_time, base_title,
             signature, sequence, status, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'confirmed', ?9)
           ON CONFLICT(calendar_id, event_key) DO UPDATE SET
             date = excluded.date,
             start_time = excluded.start_time,
             end_time = excluded.end_time,
             base_title = excluded.base_title,
             signature = excluded.signature,
             sequence = excluded.sequence,
             status = 'confirmed',
             updated_at = CASE
               WHEN calendar_events.signature != excluded.signature
                 OR calendar_events.status != 'confirmed'
               THEN excluded.updated_at
               ELSE calendar_events.updated_at
             END`,
        )
        .bind(
          id,
          event.key,
          event.date,
          event.start,
          event.end,
          event.title,
          signature,
          sequence,
          now,
        ),
    );
    existing.delete(event.key);
  });

  existing.forEach((event) => {
    if (event.status !== "confirmed") return;
    cancelled += 1;
    statements.push(
      db
        .prepare(
          `UPDATE calendar_events
           SET status = 'cancelled', sequence = sequence + 1, updated_at = ?3
           WHERE calendar_id = ?1 AND event_key = ?2`,
        )
        .bind(id, event.event_key, now),
    );
  });

  await db.batch(statements);
  return json(request, {
    syncedAt: now,
    eventCount: payload.events.length,
    created,
    revised,
    cancelled,
  });
}

async function revokeFeed(
  request: Request,
  db: CalendarDatabase,
  id: string,
) {
  const feed = await getAuthorizedFeed(request, db, id);
  if (!feed) return json(request, { error: "Calendar not found" }, 404);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE calendar_feeds
       SET revoked_at = ?2, write_token_hash = '', updated_at = ?2
       WHERE id = ?1`,
    )
    .bind(id, now)
    .run();
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

async function serveFeed(request: Request, db: CalendarDatabase, id: string) {
  if (!validFeedId(id)) return new Response("Calendar not found", { status: 404 });
  const feed = await db
    .prepare(
      `SELECT id, write_token_hash, name, location, location_lat, location_lon,
        notes, reminder1, reminder2, created_at, updated_at, revoked_at
       FROM calendar_feeds WHERE id = ?1`,
    )
    .bind(id)
    .first<CalendarFeedRow>();
  if (!feed) return new Response("Calendar not found", { status: 404 });
  if (feed.revoked_at) {
    return new Response("This Shiftdeck calendar link was reset.", {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const eventsResult = await db
    .prepare(
      `SELECT calendar_id, event_key, date, start_time, end_time, base_title,
        signature, sequence, status, updated_at
       FROM calendar_events
       WHERE calendar_id = ?1
       ORDER BY date, start_time, event_key`,
    )
    .bind(id)
    .all<CalendarEventRow>();
  const etag = `"shiftdeck-v${CALENDAR_FORMAT_VERSION}-${Date.parse(feed.updated_at)}"`;
  const lastModified = new Date(feed.updated_at).toUTCString();
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        "Cache-Control": "public, no-cache, must-revalidate",
        ETag: etag,
        "Last-Modified": lastModified,
      },
    });
  }
  return new Response(renderCalendar(feed, eventsResult.results ?? []), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="Shiftdeck.ics"',
      "Cache-Control": "public, no-cache, must-revalidate",
      ETag: etag,
      "Last-Modified": lastModified,
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function handleCalendarRequest(
  request: Request,
  db: CalendarDatabase | undefined,
) {
  const url = new URL(request.url);
  const isCalendarRoute =
    url.pathname.startsWith("/api/calendar-feeds") ||
    url.pathname === "/api/flights/resolve" ||
    url.pathname === "/api/places" ||
    url.pathname.startsWith("/calendar/");
  if (!isCalendarRoute) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method === "GET" && url.pathname === "/api/places") {
    return searchPlaces(request);
  }
  if (request.method === "GET" && url.pathname === "/api/flights/resolve") {
    return resolveFlightAwareFlight(request);
  }
  if (!db) {
    return json(
      request,
      { error: "Calendar storage is not configured" },
      503,
    );
  }
  await ensureSchema(db);

  if (request.method === "POST" && url.pathname === "/api/calendar-feeds") {
    return createFeed(request, db);
  }
  const apiMatch = url.pathname.match(
    /^\/api\/calendar-feeds\/([A-Za-z0-9_-]+)$/,
  );
  if (apiMatch && request.method === "PUT") {
    return syncFeed(request, db, apiMatch[1]);
  }
  if (apiMatch && request.method === "DELETE") {
    return revokeFeed(request, db, apiMatch[1]);
  }
  const feedMatch = url.pathname.match(
    /^\/calendar\/([A-Za-z0-9_-]+)\.ics$/,
  );
  if (feedMatch && request.method === "GET") {
    return serveFeed(request, db, feedMatch[1]);
  }
  return json(request, { error: "Not found" }, 404);
}
