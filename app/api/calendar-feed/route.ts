import { env } from "cloudflare:workers";

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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      token?: string;
      calendarName?: string;
      ics?: string;
    };
    const ics = payload.ics?.trim() ?? "";

    if (!ics.startsWith("BEGIN:VCALENDAR") || !ics.includes("END:VCALENDAR")) {
      return Response.json({ error: "Valid calendar data is required." }, { status: 400 });
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

    return Response.json({
      token,
      calendarName,
      updatedAt,
      ...calendarUrls(request, token),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save feed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
