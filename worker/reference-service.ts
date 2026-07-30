import { referenceSchemaStatements } from "../db/schema";
import type { CalendarDatabase } from "./calendar-service";

type ReferenceEnv = {
  REFERENCE_OWNER_CODE?: string;
};

type ReferenceRequestRow = {
  id: string;
  request_token_hash: string;
  device_name: string;
  status: "pending" | "approved" | "denied" | "superseded";
  issued_token: string | null;
  created_at: string;
  resolved_at: string | null;
};

type ReferenceSessionRow = {
  id: string;
  is_owner: number;
  expires_at: string;
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const ALLOWED_ORIGINS = new Set([
  "https://shiftdeck-schedule.frenchbear.chatgpt.site",
  "https://frenchbear1.github.io",
]);

let schemaReady = false;

async function ensureReferenceSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch(
    referenceSchemaStatements.map((statement) => db.prepare(statement)),
  );
  schemaReady = true;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed =
    ALLOWED_ORIGINS.has(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed
      ? origin
      : ALLOWED_ORIGINS.values().next().value,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request),
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

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validId(value: string) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(value);
}

async function clientHash(request: Request) {
  return sha256(
    request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "local",
  );
}

async function authorizedSession(
  request: Request,
  db: CalendarDatabase,
  ownerOnly = false,
) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const session = await db
    .prepare(
      `SELECT id, is_owner, expires_at
       FROM reference_sessions
       WHERE token_hash = ?1
         AND revoked_at IS NULL
         AND expires_at > ?2`,
    )
    .bind(tokenHash, now)
    .first<ReferenceSessionRow>();
  if (!session || (ownerOnly && session.is_owner !== 1)) return null;
  return session;
}

async function createAccessRequest(
  request: Request,
  db: CalendarDatabase,
) {
  let payload: { deviceId?: string; deviceName?: string };
  try {
    payload = (await request.json()) as {
      deviceId?: string;
      deviceName?: string;
    };
  } catch {
    return json(request, { error: "Invalid request" }, 400);
  }
  const deviceId = cleanText(payload.deviceId, 100);
  const deviceName = cleanText(payload.deviceName, 80) || "Unknown device";
  if (!deviceId || !/^[A-Za-z0-9_-]{12,100}$/.test(deviceId)) {
    return json(request, { error: "Invalid device" }, 400);
  }

  const hash = await clientHash(request);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reference_access_requests
       WHERE client_hash = ?1 AND created_at >= ?2`,
    )
    .bind(hash, since)
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= 8) {
    return json(
      request,
      { error: "Too many access requests. Try again tomorrow." },
      429,
    );
  }

  const now = new Date().toISOString();
  const id = randomToken(18);
  const requestToken = randomToken(32);
  await db.batch([
    db
      .prepare(
        `UPDATE reference_access_requests
         SET status = 'superseded', resolved_at = ?2
         WHERE device_id = ?1 AND status = 'pending'`,
      )
      .bind(deviceId, now),
    db
      .prepare(
        `INSERT INTO reference_access_requests
         (id, request_token_hash, client_hash, device_id, device_name,
          status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)`,
      )
      .bind(
        id,
        await sha256(requestToken),
        hash,
        deviceId,
        deviceName,
        now,
      ),
  ]);
  return json(
    request,
    {
      id,
      requestToken,
      status: "pending",
      createdAt: now,
    },
    201,
  );
}

async function accessRequestStatus(
  request: Request,
  db: CalendarDatabase,
  id: string,
) {
  if (!validId(id)) return json(request, { error: "Request not found" }, 404);
  const token = bearerToken(request);
  if (!token) return json(request, { error: "Request not found" }, 404);
  const row = await db
    .prepare(
      `SELECT id, request_token_hash, device_name, status, issued_token,
        created_at, resolved_at
       FROM reference_access_requests WHERE id = ?1`,
    )
    .bind(id)
    .first<ReferenceRequestRow>();
  if (!row || (await sha256(token)) !== row.request_token_hash) {
    return json(request, { error: "Request not found" }, 404);
  }
  return json(request, {
    id: row.id,
    deviceName: row.device_name,
    status: row.status,
    accessToken: row.status === "approved" ? row.issued_token : undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
}

async function ownerLogin(
  request: Request,
  db: CalendarDatabase,
  env: ReferenceEnv,
) {
  let payload: { code?: string; deviceName?: string };
  try {
    payload = (await request.json()) as {
      code?: string;
      deviceName?: string;
    };
  } catch {
    return json(request, { error: "Invalid request" }, 400);
  }
  if (!env.REFERENCE_OWNER_CODE) {
    return json(request, { error: "Owner access is not configured" }, 503);
  }

  const hash = await clientHash(request);
  const day = new Date().toISOString().slice(0, 10);
  const attempts = await db
    .prepare(
      `SELECT count FROM reference_owner_attempts
       WHERE client_hash = ?1 AND day = ?2`,
    )
    .bind(hash, day)
    .first<{ count: number }>();
  if ((attempts?.count ?? 0) >= 10) {
    return json(request, { error: "Too many owner sign-in attempts" }, 429);
  }
  await db
    .prepare(
      `INSERT INTO reference_owner_attempts (client_hash, day, count)
       VALUES (?1, ?2, 1)
       ON CONFLICT(client_hash, day) DO UPDATE SET count = count + 1`,
    )
    .bind(hash, day)
    .run();

  const submittedHash = await sha256(cleanText(payload.code, 160));
  const configuredHash = await sha256(env.REFERENCE_OWNER_CODE);
  if (submittedHash !== configuredHash) {
    return json(request, { error: "That owner code is not correct" }, 401);
  }

  const now = new Date();
  const expires = new Date(now);
  expires.setFullYear(expires.getFullYear() + 1);
  const ownerToken = randomToken(40);
  await db
    .prepare(
      `INSERT INTO reference_sessions
       (id, token_hash, device_name, is_owner, created_at, expires_at)
       VALUES (?1, ?2, ?3, 1, ?4, ?5)`,
    )
    .bind(
      randomToken(18),
      await sha256(ownerToken),
      cleanText(payload.deviceName, 80) || "Owner device",
      now.toISOString(),
      expires.toISOString(),
    )
    .run();
  return json(request, {
    ownerToken,
    expiresAt: expires.toISOString(),
  });
}

async function ownerRequests(request: Request, db: CalendarDatabase) {
  if (!(await authorizedSession(request, db, true))) {
    return json(request, { error: "Owner access required" }, 401);
  }
  const result = await db
    .prepare(
      `SELECT id, device_name, status, created_at, resolved_at
       FROM reference_access_requests
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .all<{
      id: string;
      device_name: string;
      status: string;
      created_at: string;
      resolved_at: string | null;
    }>();
  return json(
    request,
    (result.results ?? []).map((row) => ({
      id: row.id,
      deviceName: row.device_name,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    })),
  );
}

async function resolveAccessRequest(
  request: Request,
  db: CalendarDatabase,
  id: string,
  action: "approve" | "deny",
) {
  if (!(await authorizedSession(request, db, true))) {
    return json(request, { error: "Owner access required" }, 401);
  }
  if (!validId(id)) return json(request, { error: "Request not found" }, 404);
  const pending = await db
    .prepare(
      `SELECT id, device_name
       FROM reference_access_requests
       WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(id)
    .first<{ id: string; device_name: string }>();
  if (!pending) return json(request, { error: "Request not found" }, 404);

  const now = new Date();
  if (action === "deny") {
    await db
      .prepare(
        `UPDATE reference_access_requests
         SET status = 'denied', resolved_at = ?2
         WHERE id = ?1 AND status = 'pending'`,
      )
      .bind(id, now.toISOString())
      .run();
    return json(request, { status: "denied" });
  }

  const expires = new Date(now);
  expires.setFullYear(expires.getFullYear() + 1);
  const accessToken = randomToken(40);
  await db.batch([
    db
      .prepare(
        `INSERT INTO reference_sessions
         (id, token_hash, device_name, is_owner, created_at, expires_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)`,
      )
      .bind(
        randomToken(18),
        await sha256(accessToken),
        pending.device_name,
        now.toISOString(),
        expires.toISOString(),
      ),
    db
      .prepare(
        `UPDATE reference_access_requests
         SET status = 'approved', issued_token = ?2, resolved_at = ?3
         WHERE id = ?1 AND status = 'pending'`,
      )
      .bind(id, accessToken, now.toISOString()),
  ]);
  return json(request, { status: "approved" });
}

async function referenceVault(request: Request, db: CalendarDatabase) {
  if (!(await authorizedSession(request, db))) {
    return json(request, { error: "Reference access required" }, 401);
  }
  const vault = await db
    .prepare(
      `SELECT payload, updated_at
       FROM reference_vault WHERE id = 'main'`,
    )
    .first<{ payload: string; updated_at: string }>();
  if (!vault) {
    return json(request, { error: "References are not configured" }, 503);
  }
  try {
    return json(request, {
      ...JSON.parse(vault.payload),
      updatedAt: vault.updated_at,
    });
  } catch {
    return json(request, { error: "References are unavailable" }, 503);
  }
}

export async function handleReferenceRequest(
  request: Request,
  db: CalendarDatabase | undefined,
  env: ReferenceEnv,
) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/references")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (!isAllowedBrowserOrigin(request)) {
    return json(request, { error: "Origin not allowed" }, 403);
  }
  if (!db) {
    return json(request, { error: "Reference storage is not configured" }, 503);
  }
  await ensureReferenceSchema(db);

  if (request.method === "GET" && url.pathname === "/api/references") {
    return referenceVault(request, db);
  }
  if (request.method === "POST" && url.pathname === "/api/references/request") {
    return createAccessRequest(request, db);
  }
  const requestMatch = url.pathname.match(
    /^\/api\/references\/request\/([A-Za-z0-9_-]+)$/,
  );
  if (request.method === "GET" && requestMatch) {
    return accessRequestStatus(request, db, requestMatch[1]);
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/references/owner/login"
  ) {
    return ownerLogin(request, db, env);
  }
  if (
    request.method === "GET" &&
    url.pathname === "/api/references/owner/requests"
  ) {
    return ownerRequests(request, db);
  }
  const ownerActionMatch = url.pathname.match(
    /^\/api\/references\/owner\/requests\/([A-Za-z0-9_-]+)\/(approve|deny)$/,
  );
  if (request.method === "POST" && ownerActionMatch) {
    return resolveAccessRequest(
      request,
      db,
      ownerActionMatch[1],
      ownerActionMatch[2] as "approve" | "deny",
    );
  }
  return json(request, { error: "Not found" }, 404);
}
