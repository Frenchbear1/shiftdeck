import webpush from "web-push";
import { notificationSchemaStatements } from "../db/schema.ts";
import type { CalendarDatabase } from "./calendar-service";

export type PushEnvironment = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  SHIFTDECK_APP_URL?: string;
};

type NotificationEvent = {
  key?: string;
  date?: string;
  start?: string;
  end?: string;
  startAt?: string;
  title?: string;
};

type NotificationPayload = {
  title?: string;
  location?: string;
  timezone?: string;
  alerts?: number[];
  events?: NotificationEvent[];
};

type PushSubscriptionPayload = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  deviceName?: string;
};

type DeliveryRow = {
  profile_id: string;
  event_key: string;
  alert_minutes: number;
  subscription_id: string;
  due_at: string;
  attempts: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  default_title: string;
  location: string;
  timezone: string;
  start_at: string;
};

const ALLOWED_ORIGINS = new Set([
  "https://shiftdeck-schedule.frenchbear.chatgpt.site",
  "https://frenchbear1.github.io",
]);
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const DEFAULT_APP_URL = "https://frenchbear1.github.io/shiftdeck/";
const MAX_EVENTS = 400;
const MAX_ALERTS = 12;
const MAX_ALERT_MINUTES = 7 * 24 * 60;

let schemaReady = false;

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch(
    notificationSchemaStatements.map((statement) => db.prepare(statement)),
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
      : (ALLOWED_ORIGINS.values().next().value ?? ""),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request) },
  });
}

function isAllowedBrowserOrigin(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return (
    ALLOWED_ORIGINS.has(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
}

function randomToken(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength)
    : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeNotificationPayload(payload: NotificationPayload) {
  const title = cleanText(payload.title, 100) || "Work";
  const location = cleanText(payload.location, 180);
  const timezoneCandidate = cleanText(payload.timezone, 80);
  const timezone = validTimezone(timezoneCandidate)
    ? timezoneCandidate
    : "America/New_York";
  const alerts = [
    ...new Set(
      (Array.isArray(payload.alerts) ? payload.alerts : [120])
        .map(Number)
        .filter(
          (minutes) =>
            Number.isInteger(minutes) &&
            minutes >= 0 &&
            minutes <= MAX_ALERT_MINUTES,
        ),
    ),
  ]
    .sort((first, second) => second - first)
    .slice(0, MAX_ALERTS);
  if (!alerts.length) alerts.push(120);

  const seen = new Set<string>();
  const events = (Array.isArray(payload.events) ? payload.events : [])
    .slice(0, MAX_EVENTS)
    .flatMap((event) => {
      const key = cleanText(event.key, 180);
      const date = cleanText(event.date, 10);
      const start = cleanText(event.start, 5);
      const end = cleanText(event.end, 5);
      const eventTitle = cleanText(event.title, 100) || title;
      const startAtDate = new Date(cleanText(event.startAt, 40));
      if (
        !key ||
        seen.has(key) ||
        !validDate(date) ||
        !validTime(start) ||
        !validTime(end) ||
        Number.isNaN(startAtDate.valueOf())
      ) {
        return [];
      }
      seen.add(key);
      return [
        {
          key,
          date,
          start,
          end,
          startAt: startAtDate.toISOString(),
          title: eventTitle,
        },
      ];
    });

  return { title, location, timezone, alerts, events };
}

async function authorizeProfile(
  request: Request,
  db: CalendarDatabase,
  profileId: string,
) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT id, write_token_hash FROM notification_profiles
       WHERE id = ?1 AND revoked_at IS NULL`,
    )
    .bind(profileId)
    .first<{ id: string; write_token_hash: string }>();
  if (!row || (await sha256(token)) !== row.write_token_hash) return null;
  return row;
}

async function runBatches(
  db: CalendarDatabase,
  statements: ReturnType<CalendarDatabase["prepare"]>[],
) {
  for (let index = 0; index < statements.length; index += 75) {
    await db.batch(statements.slice(index, index + 75));
  }
}

async function rebuildDeliveries(
  db: CalendarDatabase,
  profileId: string,
  alertsJson: string,
  subscriptionId?: string,
) {
  if (!subscriptionId) {
    await db
      .prepare(
        `DELETE FROM notification_deliveries
         WHERE profile_id = ?1 AND status != 'sent'
           AND (
             NOT EXISTS (
               SELECT 1 FROM notification_events e
               WHERE e.profile_id = notification_deliveries.profile_id
                 AND e.event_key = notification_deliveries.event_key
                 AND e.status = 'confirmed'
             )
             OR alert_minutes NOT IN (
               SELECT CAST(value AS INTEGER) FROM json_each(?2)
             )
           )`,
      )
      .bind(profileId, alertsJson)
      .run();
  }

  const subscriptionFilter = subscriptionId ? "AND s.id = ?3" : "";
  const statement = db
    .prepare(
      `INSERT INTO notification_deliveries
       (profile_id, event_key, alert_minutes, subscription_id, due_at,
        status, attempts, next_attempt_at, claimed_at, sent_at, last_error, updated_at)
       SELECT e.profile_id, e.event_key, CAST(a.value AS INTEGER), s.id,
         strftime('%Y-%m-%dT%H:%M:%SZ', e.start_at,
           printf('-%d minutes', CAST(a.value AS INTEGER))),
         'pending', 0, NULL, NULL, NULL, NULL, ?2
       FROM notification_events e
       JOIN push_subscriptions s ON s.profile_id = e.profile_id
       JOIN json_each(?1) a
       WHERE e.profile_id = ?4 AND e.status = 'confirmed'
         ${subscriptionFilter}
         AND datetime(e.start_at) >= datetime('now', '-1 day')
       ON CONFLICT(profile_id, event_key, alert_minutes, subscription_id)
       DO UPDATE SET
         due_at = excluded.due_at,
         status = CASE
           WHEN notification_deliveries.status = 'sent'
             AND notification_deliveries.due_at = excluded.due_at
             THEN 'sent'
           ELSE 'pending'
         END,
         attempts = CASE
           WHEN notification_deliveries.due_at = excluded.due_at
             THEN notification_deliveries.attempts
           ELSE 0
         END,
         next_attempt_at = CASE
           WHEN notification_deliveries.due_at = excluded.due_at
             THEN notification_deliveries.next_attempt_at
           ELSE NULL
         END,
         claimed_at = CASE
           WHEN notification_deliveries.due_at = excluded.due_at
             THEN notification_deliveries.claimed_at
           ELSE NULL
         END,
         sent_at = CASE
           WHEN notification_deliveries.status = 'sent'
             AND notification_deliveries.due_at = excluded.due_at
             THEN notification_deliveries.sent_at
           ELSE NULL
         END,
         last_error = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(alertsJson, new Date().toISOString(), subscriptionId ?? "", profileId);
  await statement.run();
}

async function createProfile(request: Request, db: CalendarDatabase) {
  if (!isAllowedBrowserOrigin(request)) {
    return json(request, { error: "Origin not allowed" }, 403);
  }
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const clientHash = await sha256(
    `push|${
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "local"
    }`,
  );
  const creation = await db
    .prepare(
      `SELECT count FROM calendar_feed_creations
       WHERE client_hash = ?1 AND day = ?2`,
    )
    .bind(clientHash, day)
    .first<{ count: number }>();
  if ((creation?.count ?? 0) >= 10) {
    return json(request, { error: "Notification setup limit reached for today" }, 429);
  }
  const id = randomToken(18);
  const writeToken = randomToken(32);
  await db.batch([
    db
      .prepare(
        `INSERT INTO notification_profiles
         (id, write_token_hash, default_title, location, timezone, alerts_json,
          created_at, updated_at)
         VALUES (?1, ?2, 'Work', '', 'America/New_York', '[120]', ?3, ?3)`,
      )
      .bind(id, await sha256(writeToken), now),
    db
      .prepare(
        `INSERT INTO calendar_feed_creations (client_hash, day, count)
         VALUES (?1, ?2, 1)
         ON CONFLICT(client_hash, day) DO UPDATE SET count = count + 1`,
      )
      .bind(clientHash, day),
  ]);
  return json(request, { id, writeToken, createdAt: now }, 201);
}

async function syncProfile(
  request: Request,
  db: CalendarDatabase,
  profileId: string,
) {
  if (!(await authorizeProfile(request, db, profileId))) {
    return json(request, { error: "Notification profile not found" }, 404);
  }
  let raw: NotificationPayload;
  try {
    raw = (await request.json()) as NotificationPayload;
  } catch {
    return json(request, { error: "Invalid notification data" }, 400);
  }
  const payload = normalizeNotificationPayload(raw);
  const now = new Date().toISOString();
  const alertsJson = JSON.stringify(payload.alerts);
  const current = await db
    .prepare(
      `SELECT event_key FROM notification_events
       WHERE profile_id = ?1 AND status = 'confirmed'`,
    )
    .bind(profileId)
    .all<{ event_key: string }>();
  const incomingKeys = new Set(payload.events.map((event) => event.key));
  const statements = [
    db
      .prepare(
        `UPDATE notification_profiles
         SET default_title = ?2, location = ?3, timezone = ?4,
             alerts_json = ?5, updated_at = ?6
         WHERE id = ?1 AND revoked_at IS NULL`,
      )
      .bind(
        profileId,
        payload.title,
        payload.location,
        payload.timezone,
        alertsJson,
        now,
      ),
    ...payload.events.map((event) =>
      db
        .prepare(
          `INSERT INTO notification_events
           (profile_id, event_key, date, start_time, end_time, start_at,
            title, status, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'confirmed', ?8)
           ON CONFLICT(profile_id, event_key) DO UPDATE SET
             date = excluded.date,
             start_time = excluded.start_time,
             end_time = excluded.end_time,
             start_at = excluded.start_at,
             title = excluded.title,
             status = 'confirmed',
             updated_at = excluded.updated_at`,
        )
        .bind(
          profileId,
          event.key,
          event.date,
          event.start,
          event.end,
          event.startAt,
          event.title,
          now,
        ),
    ),
    ...(current.results ?? [])
      .filter((event) => !incomingKeys.has(event.event_key))
      .map((event) =>
        db
          .prepare(
            `UPDATE notification_events
             SET status = 'cancelled', updated_at = ?3
             WHERE profile_id = ?1 AND event_key = ?2`,
          )
          .bind(profileId, event.event_key, now),
      ),
  ];
  await runBatches(db, statements);
  await rebuildDeliveries(db, profileId, alertsJson);
  return json(request, { syncedAt: now });
}

async function addSubscription(
  request: Request,
  db: CalendarDatabase,
  profileId: string,
) {
  if (!(await authorizeProfile(request, db, profileId))) {
    return json(request, { error: "Notification profile not found" }, 404);
  }
  let payload: PushSubscriptionPayload;
  try {
    payload = (await request.json()) as PushSubscriptionPayload;
  } catch {
    return json(request, { error: "Invalid push subscription" }, 400);
  }
  const endpoint = cleanText(payload.endpoint, 2048);
  const p256dh = cleanText(payload.keys?.p256dh, 512);
  const auth = cleanText(payload.keys?.auth, 256);
  const deviceName = cleanText(payload.deviceName, 80) || "Shiftdeck device";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return json(request, { error: "Invalid push subscription" }, 400);
  }
  const existing = await db
    .prepare("SELECT id, profile_id FROM push_subscriptions WHERE endpoint = ?1")
    .bind(endpoint)
    .first<{ id: string; profile_id: string }>();
  const subscriptionId = existing?.id ?? randomToken(18);
  const now = new Date().toISOString();
  if (existing && existing.profile_id !== profileId) {
    await db
      .prepare("DELETE FROM notification_deliveries WHERE subscription_id = ?1")
      .bind(subscriptionId)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO push_subscriptions
       (id, profile_id, endpoint, p256dh, auth, expiration_time, device_name,
        created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(endpoint) DO UPDATE SET
         profile_id = excluded.profile_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         expiration_time = excluded.expiration_time,
         device_name = excluded.device_name,
         updated_at = excluded.updated_at`,
    )
    .bind(
      subscriptionId,
      profileId,
      endpoint,
      p256dh,
      auth,
      payload.expirationTime ?? null,
      deviceName,
      now,
    )
    .run();
  const profile = await db
    .prepare("SELECT alerts_json FROM notification_profiles WHERE id = ?1")
    .bind(profileId)
    .first<{ alerts_json: string }>();
  await rebuildDeliveries(
    db,
    profileId,
    profile?.alerts_json ?? "[120]",
    subscriptionId,
  );
  return json(request, { id: subscriptionId, subscribedAt: now }, 201);
}

async function removeSubscription(
  request: Request,
  db: CalendarDatabase,
  profileId: string,
  subscriptionId: string,
) {
  if (!(await authorizeProfile(request, db, profileId))) {
    return json(request, { error: "Notification profile not found" }, 404);
  }
  await db
    .prepare(
      "DELETE FROM push_subscriptions WHERE id = ?1 AND profile_id = ?2",
    )
    .bind(subscriptionId, profileId)
    .run();
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function configureWebPush(env: PushEnvironment) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error("Push keys are not configured");
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || "mailto:notifications@frenchbear.chatgpt.site",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
}

function appUrl(env: PushEnvironment) {
  const candidate = env.SHIFTDECK_APP_URL || DEFAULT_APP_URL;
  return candidate.endsWith("/") ? candidate : `${candidate}/`;
}

function offsetLabel(minutes: number) {
  if (minutes === 0) return "now";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function notificationPayload(
  env: PushEnvironment,
  row: Pick<
    DeliveryRow,
    | "profile_id"
    | "event_key"
    | "alert_minutes"
    | "title"
    | "default_title"
    | "location"
    | "timezone"
    | "start_at"
  >,
) {
  const navigate = appUrl(env);
  const icon = `${navigate}icon-192.png`;
  const start = new Intl.DateTimeFormat("en-US", {
    timeZone: row.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(row.start_at));
  const timing =
    row.alert_minutes === 0
      ? "Your shift starts now"
      : `Your shift starts in ${offsetLabel(row.alert_minutes)}`;
  const body = `${timing} · ${start}${row.location ? ` · ${row.location}` : ""}`;
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: row.title || row.default_title || "Work",
      body,
      navigate,
      icon,
      badge: icon,
      tag: `shiftdeck-${row.profile_id}-${row.event_key}-${row.alert_minutes}`,
      silent: false,
      app_badge: "1",
    },
  });
}

function pushStatus(error: unknown) {
  return typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode?: number }).statusCode) || 0
    : 0;
}

async function sendTest(
  request: Request,
  db: CalendarDatabase,
  env: PushEnvironment,
  profileId: string,
) {
  if (!(await authorizeProfile(request, db, profileId))) {
    return json(request, { error: "Notification profile not found" }, 404);
  }
  configureWebPush(env);
  const subscriptions = await db
    .prepare(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
       WHERE profile_id = ?1`,
    )
    .bind(profileId)
    .all<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  const navigate = appUrl(env);
  const icon = `${navigate}icon-192.png`;
  let delivered = 0;
  for (const subscription of subscriptions.results ?? []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          web_push: 8030,
          notification: {
            title: "Shiftdeck notifications are on",
            body: "This is a test. Your shift alerts will arrive here.",
            navigate,
            icon,
            badge: icon,
            tag: `shiftdeck-test-${Date.now()}`,
            silent: false,
          },
        }),
        { TTL: 300, urgency: "high" },
      );
      delivered += 1;
    } catch (error) {
      if ([404, 410].includes(pushStatus(error))) {
        await db
          .prepare("DELETE FROM push_subscriptions WHERE id = ?1")
          .bind(subscription.id)
          .run();
      }
    }
  }
  return json(
    request,
    { delivered },
    delivered > 0 ? 200 : 503,
  );
}

async function revokeProfile(
  request: Request,
  db: CalendarDatabase,
  profileId: string,
) {
  if (!(await authorizeProfile(request, db, profileId))) {
    return json(request, { error: "Notification profile not found" }, 404);
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("DELETE FROM push_subscriptions WHERE profile_id = ?1")
      .bind(profileId),
    db
      .prepare(
        "UPDATE notification_profiles SET revoked_at = ?2, updated_at = ?2 WHERE id = ?1",
      )
      .bind(profileId, now),
  ]);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function handlePushRequest(
  request: Request,
  db: CalendarDatabase | undefined,
  env: PushEnvironment,
) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/notifications")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (!db) return json(request, { error: "Notification storage unavailable" }, 503);
  await ensureSchema(db);

  if (request.method === "GET" && url.pathname === "/api/notifications/vapid-key") {
    if (!env.VAPID_PUBLIC_KEY) {
      return json(request, { error: "Notifications are not configured" }, 503);
    }
    return json(request, { publicKey: env.VAPID_PUBLIC_KEY });
  }
  if (request.method === "POST" && url.pathname === "/api/notifications/profiles") {
    return createProfile(request, db);
  }
  const profileMatch = url.pathname.match(
    /^\/api\/notifications\/profiles\/([A-Za-z0-9_-]+)$/,
  );
  if (profileMatch && request.method === "PUT") {
    return syncProfile(request, db, profileMatch[1]);
  }
  if (profileMatch && request.method === "DELETE") {
    return revokeProfile(request, db, profileMatch[1]);
  }
  const subscriptionsMatch = url.pathname.match(
    /^\/api\/notifications\/profiles\/([A-Za-z0-9_-]+)\/subscriptions$/,
  );
  if (subscriptionsMatch && request.method === "POST") {
    return addSubscription(request, db, subscriptionsMatch[1]);
  }
  const subscriptionMatch = url.pathname.match(
    /^\/api\/notifications\/profiles\/([A-Za-z0-9_-]+)\/subscriptions\/([A-Za-z0-9_-]+)$/,
  );
  if (subscriptionMatch && request.method === "DELETE") {
    return removeSubscription(
      request,
      db,
      subscriptionMatch[1],
      subscriptionMatch[2],
    );
  }
  const testMatch = url.pathname.match(
    /^\/api\/notifications\/profiles\/([A-Za-z0-9_-]+)\/test$/,
  );
  if (testMatch && request.method === "POST") {
    return sendTest(request, db, env, testMatch[1]);
  }
  return json(request, { error: "Not found" }, 404);
}

export async function sendDueNotifications(
  db: CalendarDatabase,
  env: PushEnvironment,
  scheduledAt = Date.now(),
) {
  await ensureSchema(db);
  configureWebPush(env);
  const now = new Date(scheduledAt).toISOString();
  const candidates = await db
    .prepare(
      `SELECT d.profile_id, d.event_key, d.alert_minutes, d.subscription_id,
              d.due_at, d.attempts, s.endpoint, s.p256dh, s.auth,
              e.title, p.default_title, p.location, p.timezone, e.start_at
       FROM notification_deliveries d
       JOIN push_subscriptions s
         ON s.id = d.subscription_id AND s.profile_id = d.profile_id
       JOIN notification_events e
         ON e.profile_id = d.profile_id AND e.event_key = d.event_key
       JOIN notification_profiles p ON p.id = d.profile_id
       WHERE p.revoked_at IS NULL AND e.status = 'confirmed'
         AND (
           d.status IN ('pending', 'retry')
           OR (d.status = 'sending' AND datetime(d.claimed_at) < datetime(?1, '-10 minutes'))
         )
         AND datetime(d.due_at) <= datetime(?1)
         AND datetime(d.due_at) >= datetime(?1, '-1 day')
         AND (d.next_attempt_at IS NULL OR datetime(d.next_attempt_at) <= datetime(?1))
       ORDER BY datetime(d.due_at)
       LIMIT 50`,
    )
    .bind(now)
    .all<DeliveryRow>();

  for (const row of candidates.results ?? []) {
    const claimed = await db
      .prepare(
        `UPDATE notification_deliveries
         SET status = 'sending', claimed_at = ?5, updated_at = ?5
         WHERE profile_id = ?1 AND event_key = ?2 AND alert_minutes = ?3
           AND subscription_id = ?4
           AND (
             status IN ('pending', 'retry')
             OR (status = 'sending' AND datetime(claimed_at) < datetime(?5, '-10 minutes'))
           )
         RETURNING profile_id`,
      )
      .bind(
        row.profile_id,
        row.event_key,
        row.alert_minutes,
        row.subscription_id,
        now,
      )
      .first<{ profile_id: string }>();
    if (!claimed) continue;

    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        notificationPayload(env, row),
        { TTL: 86400, urgency: "high" },
      );
      await db
        .prepare(
          `UPDATE notification_deliveries
           SET status = 'sent', attempts = attempts + 1, sent_at = ?5,
               next_attempt_at = NULL, last_error = NULL, updated_at = ?5
           WHERE profile_id = ?1 AND event_key = ?2 AND alert_minutes = ?3
             AND subscription_id = ?4`,
        )
        .bind(
          row.profile_id,
          row.event_key,
          row.alert_minutes,
          row.subscription_id,
          now,
        )
        .run();
    } catch (error) {
      const status = pushStatus(error);
      if (status === 404 || status === 410) {
        await db
          .prepare("DELETE FROM push_subscriptions WHERE id = ?1")
          .bind(row.subscription_id)
          .run();
        continue;
      }
      const attempts = row.attempts + 1;
      const retry = attempts < 4 && (status === 0 || status >= 500);
      const nextAttempt = retry
        ? new Date(scheduledAt + attempts * 5 * 60 * 1000).toISOString()
        : null;
      await db
        .prepare(
          `UPDATE notification_deliveries
           SET status = ?5, attempts = ?6, next_attempt_at = ?7,
               last_error = ?8, updated_at = ?9
           WHERE profile_id = ?1 AND event_key = ?2 AND alert_minutes = ?3
             AND subscription_id = ?4`,
        )
        .bind(
          row.profile_id,
          row.event_key,
          row.alert_minutes,
          row.subscription_id,
          retry ? "retry" : "failed",
          attempts,
          nextAttempt,
          status ? `Push service returned ${status}` : "Push delivery failed",
          now,
        )
        .run();
    }
  }
}
