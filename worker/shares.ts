/**
 * Share links: schedules, the directory and coworker contacts sent from one
 * phone to coworkers.
 *
 * The phone encrypts everything with a random key before upload; the key
 * rides in the link's #fragment, which browsers never send to a server. So
 * this only ever holds bytes it can't read. Each share is split into rows
 * (D1 caps a row at ~2 MB) and deleted when it expires (1 or 7 days, or 30
 * for schedules synced to your own phones).
 */
import { corsHeaders, json, type CalendarDatabase } from "./calendar-service";

const CHUNK = 1_500_000;
const MAX_BYTES = 30_000_000;
const PER_HOUR = 12;
const DAY = 86_400_000;

let schemaReady = false;

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      parts INTEGER NOT NULL,
      sender TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS share_parts (
      id TEXT NOT NULL,
      part INTEGER NOT NULL,
      data BLOB NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (id, part)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS shares_sender ON shares (sender, created_at)"),
  ]);
  schemaReady = true;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** D1 returns BLOBs as an ArrayBuffer or an array of byte values, depending on version. */
const asBytes = (value: unknown) =>
  value instanceof ArrayBuffer ? new Uint8Array(value)
    : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : Array.isArray(value) ? Uint8Array.from(value as number[])
        : new Uint8Array();

async function createShare(request: Request, db: CalendarDatabase) {
  const url = new URL(request.url);
  const asked = url.searchParams.get("days");
  const days = asked === "30" ? 30 : asked === "7" ? 7 : 1;
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BYTES) return json(request, { error: "That's too big to share (30 MB max)." }, 413);
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length) return json(request, { error: "Nothing to share" }, 400);
  if (body.length > MAX_BYTES) return json(request, { error: "That's too big to share (30 MB max)." }, 413);

  const now = Date.now();
  const sender = await sha256(`share|${request.headers.get("CF-Connecting-IP") ?? "local"}`);
  const recent = await db
    .prepare("SELECT COUNT(*) AS count FROM shares WHERE sender = ?1 AND created_at > ?2")
    .bind(sender, now - 3_600_000)
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= PER_HOUR) return json(request, { error: "Too many share links this hour. Try again later." }, 429);

  const id = newId();
  const expiresAt = now + days * DAY;
  const parts = Math.ceil(body.length / CHUNK);
  try {
    // One part per write keeps each request well under D1's size limits; the
    // share only becomes readable once every part is in.
    for (let part = 0; part < parts; part += 1) {
      await db.prepare("INSERT INTO share_parts (id, part, data, expires_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(id, part, body.slice(part * CHUNK, (part + 1) * CHUNK), expiresAt)
        .run();
    }
    await db.prepare("INSERT INTO shares (id, size, parts, sender, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(id, body.length, parts, sender, now, expiresAt)
      .run();
  } catch {
    await db.prepare("DELETE FROM share_parts WHERE id = ?1").bind(id).run().catch(() => undefined);
    return json(request, { error: "The share couldn't be saved. Try again." }, 500);
  }
  return json(request, { id, expiresAt: new Date(expiresAt).toISOString() }, 201);
}

async function readShare(request: Request, db: CalendarDatabase, id: string) {
  const share = await db
    .prepare("SELECT size, parts, expires_at FROM shares WHERE id = ?1")
    .bind(id)
    .first<{ size: number; parts: number; expires_at: number }>();
  if (!share || share.expires_at < Date.now()) {
    return json(request, { error: "This share link has expired." }, 410);
  }
  const body = new Uint8Array(share.size);
  let offset = 0;
  for (let part = 0; part < share.parts; part += 1) {
    const row = await db
      .prepare("SELECT data FROM share_parts WHERE id = ?1 AND part = ?2")
      .bind(id, part)
      .first<{ data: unknown }>();
    const bytes = asBytes(row?.data);
    if (!bytes.length) return json(request, { error: "This share link is incomplete." }, 410);
    body.set(bytes.subarray(0, share.size - offset), offset);
    offset += bytes.length;
  }
  return new Response(body, {
    headers: {
      ...(corsHeaders(request) as Record<string, string>),
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Share-Expires": new Date(share.expires_at).toISOString(),
      "Access-Control-Expose-Headers": "X-Share-Expires",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function handleShareRequest(request: Request, db: CalendarDatabase | undefined) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/shares")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) as Record<string, string> });
  }
  if (!db) return json(request, { error: "Share storage unavailable" }, 503);
  await ensureSchema(db);
  if (request.method === "POST" && url.pathname === "/api/shares") return createShare(request, db);
  const match = url.pathname.match(/^\/api\/shares\/([A-Za-z0-9_-]{16,40})$/);
  if (request.method === "GET" && match) return readShare(request, db, match[1]);
  return json(request, { error: "Not found" }, 404);
}

/** Deletes expired shares (run from the cron). */
export async function deleteExpiredShares(db: CalendarDatabase, at = Date.now()) {
  await ensureSchema(db);
  await db.batch([
    db.prepare("DELETE FROM share_parts WHERE expires_at < ?1").bind(at),
    db.prepare("DELETE FROM shares WHERE expires_at < ?1").bind(at),
  ]);
}
