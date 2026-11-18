/**
 * Swap requests sent from Shift swap by email or text.
 *
 * The app makes the request's id and a private token on the phone, puts a
 * link to /swap/<id> in the message, and registers it here. The coworker
 * opens the link and taps Works for me / Can't (a form POST, so mail apps
 * that preview links can't answer by accident). The requester is told by a
 * push notification (if they have shift alerts on) and the app's
 * Notifications popup, which checks /api/swaps/status with the token.
 *
 * Only first names and the two shifts are stored, and each request is
 * deleted two days after the later shift.
 */
import { corsHeaders, json, type CalendarDatabase } from "./calendar-service";
import { ownsNotificationProfile, sendProfilePush, type PushEnvironment } from "./push-service";
import { answerNotification, answerPage, readSwapRequest, rowOptions, swapExpiry, type SwapRow } from "./swap-data";

let schemaReady = false;

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS swap_requests (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    profile_id TEXT,
    from_name TEXT NOT NULL,
    to_name TEXT NOT NULL,
    give_date TEXT NOT NULL,
    give_start TEXT NOT NULL,
    give_end TEXT NOT NULL,
    take_date TEXT,
    take_start TEXT,
    take_end TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    answered_at TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    options_json TEXT
  )`).run();
  // Tables made before options existed get the column added once.
  await db.prepare("ALTER TABLE swap_requests ADD COLUMN options_json TEXT").run().catch(() => undefined);
  schemaReady = true;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });

const ROW_COLUMNS = `id, from_name, to_name, give_date, give_start, give_end,
  take_date, take_start, take_end, status, answered_at, options_json`;

async function createRequest(request: Request, db: CalendarDatabase) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const input = readSwapRequest(body);
  if (!input) return json(request, { error: "Invalid swap request" }, 400);
  const profileId = typeof body?.profileId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.profileId)
    ? body.profileId
    : null;
  // The app sends the profile's write token in the body (not a header) so the
  // request needs no CORS preflight and can finish after the mail app opens.
  const profileToken = typeof body?.profileToken === "string" ? body.profileToken : "";
  const owned = profileId && profileToken && (await ownsNotificationProfile(
    new Request(request.url, { headers: { Authorization: `Bearer ${profileToken}` } }), db, profileId,
  )) ? profileId : null;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM swap_requests WHERE expires_at < ?1").bind(now),
    // An id is only ever registered once; resending the same one changes nothing.
    db.prepare(`INSERT OR IGNORE INTO swap_requests
      (id, token_hash, profile_id, from_name, to_name, give_date, give_start, give_end,
       take_date, take_start, take_end, status, created_at, expires_at, options_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'waiting', ?12, ?13, ?14)`).bind(
      input.id, await sha256(input.token), owned, input.from, input.to,
      input.give.date, input.give.start, input.give.end,
      input.take?.date ?? null, input.take?.start ?? null, input.take?.end ?? null,
      now, swapExpiry(input), input.options ? JSON.stringify(input.options) : null,
    ),
  ]);
  return json(request, { ok: true, notifications: Boolean(owned) }, 201);
}

async function requestStatuses(request: Request, db: CalendarDatabase) {
  const body = await request.json().catch(() => null) as { requests?: Array<{ id?: unknown; token?: unknown }> } | null;
  const asked = (body?.requests ?? []).slice(0, 60).filter((item) =>
    typeof item.id === "string" && typeof item.token === "string");
  const statuses = [];
  for (const item of asked) {
    const row = await db
      .prepare("SELECT id, token_hash, status, answered_at, take_date, take_start, take_end FROM swap_requests WHERE id = ?1")
      .bind(item.id as string)
      .first<{
        id: string; token_hash: string; status: string; answered_at: string | null;
        take_date: string | null; take_start: string | null; take_end: string | null;
      }>();
    if (!row) {
      statuses.push({ id: item.id, status: "gone" });
    } else if (row.token_hash === (await sha256(item.token as string))) {
      statuses.push({
        id: row.id, status: row.status, answeredAt: row.answered_at,
        // Which of their shifts they picked, when they had a choice.
        take: row.take_date && row.take_start && row.take_end
          ? { date: row.take_date, start: row.take_start, end: row.take_end }
          : undefined,
      });
    }
  }
  return json(request, { statuses });
}

async function cancelRequest(request: Request, db: CalendarDatabase) {
  const body = await request.json().catch(() => null) as { id?: unknown; token?: unknown } | null;
  if (typeof body?.id !== "string" || typeof body.token !== "string") {
    return json(request, { error: "Invalid request" }, 400);
  }
  await db
    .prepare("UPDATE swap_requests SET status = 'cancelled', answered_at = ?3 WHERE id = ?1 AND token_hash = ?2")
    .bind(body.id, await sha256(body.token), new Date().toISOString())
    .run();
  return json(request, { ok: true });
}

async function answer(request: Request, db: CalendarDatabase, env: PushEnvironment, id: string) {
  const form = await request.formData().catch(() => null);
  const raw = String(form?.get("answer") ?? "");
  const [choice, index] = raw.split(":");
  const back = () => Response.redirect(new URL(`/swap/${id}`, request.url).href, 303);
  if (choice !== "yes" && choice !== "no") return back();
  const row = await db
    .prepare(`SELECT ${ROW_COLUMNS}, profile_id FROM swap_requests WHERE id = ?1`)
    .bind(id)
    .first<SwapRow & { profile_id: string | null }>();
  if (!row) return html(answerPage(null), 404);
  if (row.status === "cancelled") return back();
  const options = rowOptions(row);
  const picked = choice === "yes" && options.length > 1 ? options[Number(index)] : undefined;
  if (choice === "yes" && options.length > 1 && !picked) return back();
  const take = picked
    ? { take_date: picked.date, take_start: picked.start, take_end: picked.end }
    : options.length > 1
      ? { take_date: null, take_start: null, take_end: null }
      : { take_date: row.take_date, take_start: row.take_start, take_end: row.take_end };
  const changed = row.status !== choice || row.take_date !== take.take_date;
  if (changed) {
    const answeredAt = new Date().toISOString();
    await db.prepare(`UPDATE swap_requests SET status = ?2, answered_at = ?3,
      take_date = ?4, take_start = ?5, take_end = ?6 WHERE id = ?1`)
      .bind(id, choice, answeredAt, take.take_date, take.take_start, take.take_end).run();
    if (row.profile_id) {
      try {
        await sendProfilePush(db, env, row.profile_id, {
          ...answerNotification({ ...row, ...take, status: choice }),
          path: "?notifications=1",
        });
      } catch (error) {
        console.error("Swap answer push failed:", error instanceof Error ? error.message : error);
      }
    }
  }
  return Response.redirect(new URL(`/swap/${id}?done=1`, request.url).href, 303);
}

export async function handleSwapRequest(request: Request, db: CalendarDatabase | undefined, env: PushEnvironment) {
  const url = new URL(request.url);
  const page = url.pathname.match(/^\/swap\/([A-Za-z0-9_-]{16,40})$/);
  if (!url.pathname.startsWith("/api/swaps") && !page) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) as Record<string, string> });
  }
  if (!db) return json(request, { error: "Swap storage unavailable" }, 503);
  await ensureSchema(db);

  if (page) {
    if (request.method === "POST") return answer(request, db, env, page[1]);
    const row = await db
      .prepare(`SELECT ${ROW_COLUMNS} FROM swap_requests WHERE id = ?1 AND expires_at >= ?2`)
      .bind(page[1], new Date().toISOString())
      .first<SwapRow>();
    return html(answerPage(row, url.searchParams.has("done")), row ? 200 : 404);
  }
  if (request.method === "POST" && url.pathname === "/api/swaps") return createRequest(request, db);
  if (request.method === "POST" && url.pathname === "/api/swaps/status") return requestStatuses(request, db);
  if (request.method === "POST" && url.pathname === "/api/swaps/cancel") return cancelRequest(request, db);
  return json(request, { error: "Not found" }, 404);
}
