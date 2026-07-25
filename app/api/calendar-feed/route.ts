import { env } from "cloudflare:workers";

const ALLOWED_ORIGINS = new Set([
  "https://frenchbear1.github.io",
  "https://shiftdeck-schedule.frenchbear.chatgpt.site",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  });

  if (ALLOWED_ORIGINS.has(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(request: Request, body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  return Response.json(body, { ...init, headers });
}

function getDatabase() {
  if (!env.DB) {
    throw new Error("Calendar feed storage is not available yet.");
  }
  return env.DB;
}

function makeToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeToken(value: unknown) {
  if (typeof value !== "string") return makeToken();
  const token = value.trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token.toLowerCase() : makeToken();
}

function calendarUrls(request: Request, token: string) {
  const origin = new URL(request.url).origin;
  const feedUrl = new URL(`/calendar/${token}.ics`, origin).toString();
  return {
    feedUrl,
    webcalUrl: feedUrl.replace(/^https?:/i, "webcal:"),
  };
}

export function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      token?: string;
      calendarName?: string;
      ics?: string;
    };
    const ics = payload.ics?.trim() ?? "";

    if (!ics.startsWith("BEGIN:VCALENDAR") || !ics.includes("END:VCALENDAR")) {
      return jsonResponse(request, { error: "Valid calendar data is required." }, { status: 400 });
    }

    const token = normalizeToken(payload.token);
    const calendarName = payload.calendarName?.trim() || "Shiftdeck";
    const updatedAt = new Date().toISOString();
    const database = getDatabase();

    await database
      .prepare(
        `INSERT INTO calendar_feeds (token, calendar_name, ics, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           calendar_name = excluded.calendar_name,
           ics = excluded.ics,
           updated_at = excluded.updated_at`,
      )
      .bind(token, calendarName, ics, updatedAt, updatedAt)
      .run();

    return jsonResponse(request, {
      token,
      calendarName,
      updatedAt,
      ...calendarUrls(request, token),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save feed.";
    return jsonResponse(request, { error: message }, { status: 500 });
  }
}
