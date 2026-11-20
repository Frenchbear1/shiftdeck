/**
 * Shiftdeck is one team: everyone who picks a name on a phone is on it.
 *
 * Each phone registers with a random device id and secret (only a hash of
 * the secret is stored). Each name belongs to one person; a person can have
 * several phones, added with a one-time code from a phone they already have.
 * Names are locked: only the owner changes them (people ask from Settings).
 *
 * What's sent to the team is encrypted on the phone with the team key, which
 * the server never sees: a new phone makes a key pair, and a phone that
 * already has the team key wraps it for that phone's public key.
 *
 * The owner is a person, so all of the owner's phones have owner access.
 * Ownership only ever moves two ways, both started on an owner phone: a
 * handover (the new owner types a 16-digit key the owner gives them) or the
 * owner's recovery key (a new phone of the owner's, for when all theirs are
 * lost). The owner can't be removed, blocked, or moved onto.
 */
import { mergeState, readState } from "./synced-state";
import { corsHeaders, json, type CalendarDatabase } from "./calendar-service";
import { ownsNotificationProfile, sendProfilePush, type PushEnvironment } from "./push-service";
import { matchName, tidyName } from "./name-match";

const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const HANDOVER_HOURS = 24;
const HANDOVER_TRIES = 5;
const RECOVERY_TRIES_PER_HOUR = 5;
const ROSTER_LIMIT = 300;

let schemaReady = false;

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS app_people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      is_owner INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_devices (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      profile_id TEXT,
      created_at INTEGER NOT NULL,
      seen_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_link_codes (
      person_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_name_requests (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    // Phones the owner took off the app: told once, then they pick a name again.
    db.prepare(`CREATE TABLE IF NOT EXISTS app_reset_devices (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
    // New phones and names, for the owner.
    db.prepare(`CREATE TABLE IF NOT EXISTS app_log (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      person_id TEXT,
      name TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL
    )`),
    // What people send each other (encrypted shares, or swap requests).
    db.prepare(`CREATE TABLE IF NOT EXISTS app_posts (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      share_id TEXT NOT NULL,
      from_name TEXT NOT NULL,
      what TEXT NOT NULL,
      kind TEXT,
      recipients TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS app_posts_time ON app_posts (created_at)"),
    // Each person's own things on all their devices (time clock, settings), encrypted on the device.
    db.prepare(`CREATE TABLE IF NOT EXISTS app_vault (
      person_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    // A handover the owner started: the person it's for types the key.
    db.prepare(`CREATE TABLE IF NOT EXISTS app_handover (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0
    )`),
  ]);
  for (const [table, column] of [
    ["app_devices", "model TEXT"],
    ["app_devices", "label TEXT"],
    ["app_devices", "public_key TEXT"],
    ["app_devices", "wrapped_key TEXT"],
    ["app_devices", "has_key INTEGER NOT NULL DEFAULT 0"],
    ["app_people", "blocked_at INTEGER"],
    // The owner lets picked people send things to the team.
    ["app_people", "can_share INTEGER NOT NULL DEFAULT 0"],
    // What each person dealt with (dismissed and read notifications), the same on all their phones.
    ["app_people", "synced_state TEXT"],
    // A post to your own phones: which schedules (photo hashes) it carries.
    ["app_posts", "hashes TEXT"],
  ]) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column}`).run().catch(() => undefined);
  }
  schemaReady = true;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const newId = (bytes = 16) => {
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A long number to type in: groups of 4 digits. */
const digits = (groups: number) =>
  [...crypto.getRandomValues(new Uint32Array(groups))].map((value) => String(value % 10_000).padStart(4, "0")).join("");

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
const DEVICE = /^[A-Za-z0-9_-]{16,40}$/;
const ID = /^[A-Za-z0-9_-]{16,40}$/;
const CHECK = /^[0-9a-f]{64}$/;
const iso = (at: number) => new Date(at).toISOString();

type Body = Record<string, unknown>;
type Person = {
  id: string; name: string; name_key: string; is_owner: number; created_at: number; blocked_at: number | null; can_share: number;
  synced_state?: string | null;
};

async function syncState(db: CalendarDatabase, person: Person, sent: unknown) {
  const saved = readState(person.synced_state);
  if (!sent) return saved;
  const merged = mergeState(saved, sent);
  const value = JSON.stringify(merged);
  if (value !== JSON.stringify(saved)) {
    await db.prepare("UPDATE app_people SET synced_state = ?2 WHERE id = ?1").bind(person.id, value).run();
  }
  return merged;
}
type DeviceRow = {
  id: string; person_id: string; model: string | null; label: string | null; created_at: number; seen_at: number;
  public_key: string | null; wrapped_key: string | null; has_key: number; profile_id: string | null;
};
type Me = { device: DeviceRow; person: Person };

async function readBody(request: Request): Promise<Body | null> {
  try {
    const value = JSON.parse(await request.text());
    return value && typeof value === "object" ? value as Body : null;
  } catch {
    return null;
  }
}

async function setting(db: CalendarDatabase, key: string) {
  return (await db.prepare("SELECT value FROM app_settings WHERE key = ?1").bind(key).first<{ value: string }>())?.value ?? null;
}

async function setSetting(db: CalendarDatabase, key: string, value: string | null) {
  if (value === null) await db.prepare("DELETE FROM app_settings WHERE key = ?1").bind(key).run();
  else await db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)").bind(key, value).run();
}

/** The phone and person, if the device id and secret check out (blocked or not). */
async function deviceOf(db: CalendarDatabase, body: Body): Promise<Me | null> {
  const deviceId = typeof body.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : "";
  const token = typeof body.deviceToken === "string" ? body.deviceToken : "";
  if (!deviceId || token.length < 20) return null;
  const device = await db.prepare("SELECT * FROM app_devices WHERE id = ?1").bind(deviceId)
    .first<DeviceRow & { token_hash: string }>();
  if (!device || device.token_hash !== await sha256(token)) return null;
  const person = await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(device.person_id).first<Person>();
  return person ? { device, person } : null;
}

const blocked = (request: Request) =>
  json(request, { blocked: true, error: "You’ve been blocked from Shiftdeck. Ask the owner if this is a mistake." }, 403);

/** A signed-in, not-blocked phone, or the response to send instead. */
async function signedIn(request: Request, db: CalendarDatabase): Promise<{ me: Me; body: Body } | Response> {
  const body = await readBody(request);
  const me = body ? await deviceOf(db, body) : null;
  if (!me || !body) return json(request, { error: "This device isn't set up yet." }, 403);
  if (me.person.blocked_at) return blocked(request);
  return { me, body };
}

async function personByName(db: CalendarDatabase, name: string) {
  return db.prepare("SELECT * FROM app_people WHERE name_key = ?1").bind(nameKey(name)).first<Person>();
}

async function ownerPerson(db: CalendarDatabase) {
  return db.prepare("SELECT * FROM app_people WHERE is_owner = 1 LIMIT 1").first<Person>();
}

/**
 * A brand-new app has no owner: the first person to use it (whoever set it
 * up) becomes it. Once there's an owner, this never happens again.
 */
async function ensureOwner(db: CalendarDatabase) {
  if (await ownerPerson(db)) return;
  const first = await db.prepare("SELECT id FROM app_people WHERE blocked_at IS NULL ORDER BY created_at LIMIT 1").first<{ id: string }>();
  if (first) await db.prepare("UPDATE app_people SET is_owner = 1 WHERE id = ?1").bind(first.id).run();
}

/* ---------- small helpers ---------- */

async function rememberModel(db: CalendarDatabase, deviceId: string, body: Body) {
  const model = clean(body.model, 40);
  if (model) await db.prepare("UPDATE app_devices SET model = ?2 WHERE id = ?1").bind(deviceId, model).run();
}

async function rememberPublicKey(db: CalendarDatabase, deviceId: string, body: Body) {
  const key = typeof body.publicKey === "string" && body.publicKey.length < 600 ? body.publicKey : "";
  if (!key) return;
  try {
    const parsed = JSON.parse(key);
    if (parsed?.kty !== "EC" || parsed?.crv !== "P-256" || parsed?.d) return;
  } catch {
    return;
  }
  await db.prepare("UPDATE app_devices SET public_key = ?2 WHERE id = ?1 AND (public_key IS NULL OR public_key != ?2)")
    .bind(deviceId, key).run();
}

async function rememberProfile(request: Request, db: CalendarDatabase, deviceId: string, body: Body) {
  const profileId = typeof body.profileId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.profileId) ? body.profileId : "";
  const profileToken = typeof body.profileToken === "string" ? body.profileToken : "";
  if (!profileId || !profileToken) return;
  const owns = await ownsNotificationProfile(
    new Request(request.url, { headers: { Authorization: `Bearer ${profileToken}` } }), db, profileId,
  );
  if (owns) await db.prepare("UPDATE app_devices SET profile_id = ?2 WHERE id = ?1").bind(deviceId, profileId).run();
}

/** Everything a phone tells us each time it checks in. */
async function remember(request: Request, db: CalendarDatabase, deviceId: string, body: Body) {
  await rememberModel(db, deviceId, body);
  await rememberPublicKey(db, deviceId, body);
  await rememberProfile(request, db, deviceId, body);
}

function cleanRoster(...lists: unknown[]) {
  const seen = new Map<string, string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const name = clean(value, 40);
      const key = nameKey(name);
      if (key.length >= 2 && !seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, ROSTER_LIMIT);
}

async function roster(db: CalendarDatabase) {
  try {
    return cleanRoster(JSON.parse(await setting(db, "roster") ?? "[]"));
  } catch {
    return [];
  }
}

/** Phones add the names on their schedules, so everyone picks their name from a list. */
async function mergeRoster(db: CalendarDatabase, body: Body) {
  if (!Array.isArray(body.roster) || !body.roster.length) return;
  const current = await roster(db);
  const merged = cleanRoster(current, body.roster);
  if (merged.length !== current.length) await setSetting(db, "roster", JSON.stringify(merged));
}

async function log(db: CalendarDatabase, kind: string, person: { id: string; name: string }, model: string) {
  await db.prepare("INSERT INTO app_log (id, kind, person_id, name, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(newId(), kind, person.id, person.name, model || null, Date.now()).run();
  // Keep the last couple hundred.
  await db.prepare("DELETE FROM app_log WHERE id NOT IN (SELECT id FROM app_log ORDER BY created_at DESC LIMIT 200)").run();
}

/**
 * Pings every phone of a person (or of the owner). Blocked people get nothing.
 * `open` is where tapping it goes in the app (see the app's openFromLink).
 */
async function ping(
  db: CalendarDatabase, env: PushEnvironment, where: { personId?: string; owner?: boolean }, body: string,
  tag = "names", open = "notifications",
) {
  const rows = where.owner
    ? await db.prepare(`SELECT d.profile_id FROM app_devices d JOIN app_people p ON p.id = d.person_id
        WHERE p.is_owner = 1 AND d.profile_id IS NOT NULL`).all<{ profile_id: string }>()
    : await db.prepare(`SELECT d.profile_id FROM app_devices d JOIN app_people p ON p.id = d.person_id
        WHERE d.person_id = ?1 AND d.profile_id IS NOT NULL AND p.blocked_at IS NULL`)
      .bind(where.personId).all<{ profile_id: string }>();
  let sent = 0;
  for (const profileId of new Set((rows.results ?? []).map((row) => row.profile_id))) {
    sent += await sendProfilePush(db, env, profileId, {
      title: "Shiftdeck", body, tag, path: `?open=${encodeURIComponent(open)}`,
    }).catch(() => 0);
  }
  return sent;
}

async function addDevice(db: CalendarDatabase, personId: string, deviceId: string, token: string) {
  const now = Date.now();
  await db.prepare(`INSERT OR REPLACE INTO app_devices (id, person_id, token_hash, created_at, seen_at, has_key)
    VALUES (?1, ?2, ?3, ?4, ?4, 0)`)
    .bind(deviceId, personId, await sha256(token), now).run();
}

/** Takes a phone off the app; it's told next time it checks in. Its person goes too if that was their last phone. */
async function dropDevice(db: CalendarDatabase, deviceId: string, personId: string) {
  await db.batch([
    db.prepare("DELETE FROM app_devices WHERE id = ?1").bind(deviceId),
    db.prepare("INSERT OR REPLACE INTO app_reset_devices (id, created_at) VALUES (?1, ?2)").bind(deviceId, Date.now()),
  ]);
  await dropIfEmpty(db, personId);
}

/** A person with no phones left (not the owner, not blocked) frees their name. */
async function dropIfEmpty(db: CalendarDatabase, personId: string) {
  const left = await db.prepare("SELECT COUNT(*) AS count FROM app_devices WHERE person_id = ?1").bind(personId).first<{ count: number }>();
  const person = await db.prepare("SELECT is_owner, blocked_at FROM app_people WHERE id = ?1").bind(personId)
    .first<{ is_owner: number; blocked_at: number | null }>();
  if (!person || person.is_owner === 1 || person.blocked_at || (left?.count ?? 0) > 0) return;
  await db.batch([
    db.prepare("DELETE FROM app_name_requests WHERE person_id = ?1").bind(personId),
    db.prepare("DELETE FROM app_link_codes WHERE person_id = ?1").bind(personId),
    db.prepare("DELETE FROM app_people WHERE id = ?1").bind(personId),
  ]);
}

const recipientsOf = (value: string | null) => {
  if (!value) return null;
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
};

/* ---------- what a phone sees ---------- */

async function view(db: CalendarDatabase, me: Me) {
  const { person, device } = me;
  const now = Date.now();
  const own = await db.prepare("SELECT id, name, created_at FROM app_name_requests WHERE person_id = ?1")
    .bind(person.id).first<{ id: string; name: string; created_at: number }>();
  const everyone = await db.prepare(`SELECT p.id, p.name, p.is_owner, p.created_at, p.blocked_at, p.can_share, COUNT(d.id) AS devices,
      MAX(d.seen_at) AS seen FROM app_people p LEFT JOIN app_devices d ON d.person_id = p.id
      GROUP BY p.id ORDER BY p.created_at`)
    .all<{ id: string; name: string; is_owner: number; created_at: number; blocked_at: number | null; can_share: number; devices: number; seen: number | null }>();
  const people = everyone.results ?? [];
  const nameOf = new Map(people.map((row) => [row.id, row.name]));
  const owner = people.find((row) => row.is_owner === 1);

  // The team key: whether this phone has it, a wrapped copy for it, and phones it can pass it to.
  const keyCheck = await setting(db, "key_check");
  const key: Record<string, unknown> = { check: keyCheck };
  if (device.has_key) {
    const waiting = await db.prepare(`SELECT d.id, d.public_key FROM app_devices d JOIN app_people p ON p.id = d.person_id
        WHERE d.has_key = 0 AND d.wrapped_key IS NULL AND d.public_key IS NOT NULL AND p.blocked_at IS NULL LIMIT 20`)
      .all<{ id: string; public_key: string }>();
    key.wrapFor = (waiting.results ?? []).map((row) => ({ deviceId: row.id, publicKey: row.public_key }));
  } else if (device.wrapped_key) {
    key.wrapped = device.wrapped_key;
  }

  const posts = await db.prepare(`SELECT id, person_id, share_id, from_name, what, kind, recipients, created_at, expires_at
      FROM app_posts WHERE expires_at > ?1 AND (kind IS NULL OR kind != 'self') ORDER BY created_at DESC LIMIT 80`)
    .bind(now).all<{ id: string; person_id: string; share_id: string; from_name: string; what: string; kind: string | null;
      recipients: string | null; created_at: number; expires_at: number }>();

  // Schedules you imported on your other phones (only you see these).
  // The newest 60 (oldest first), and every schedule any of them carries, so a device never sends one again.
  const mySchedules = await db.prepare(`SELECT id, share_id, what, hashes, created_at, expires_at FROM app_posts
      WHERE person_id = ?1 AND kind = 'self' AND expires_at > ?2 ORDER BY created_at DESC LIMIT 60`)
    .bind(person.id, now).all<{ id: string; share_id: string; what: string; hashes: string | null; created_at: number; expires_at: number }>();
  const allSelfHashes = await db.prepare(`SELECT hashes FROM app_posts WHERE person_id = ?1 AND kind = 'self' AND expires_at > ?2 LIMIT 1000`)
    .bind(person.id, now).all<{ hashes: string | null }>();
  const vault = await db.prepare("SELECT version FROM app_vault WHERE person_id = ?1").bind(person.id).first<{ version: number }>();

  const handover = await db.prepare("SELECT person_id, expires_at, tries FROM app_handover WHERE id = 'offer'")
    .first<{ person_id: string; expires_at: number; tries: number }>();
  const liveHandover = handover && handover.expires_at > now && handover.tries < HANDOVER_TRIES ? handover : null;

  const result: Record<string, unknown> = {
    ownerName: owner?.name ?? null,
    personId: person.id,
    name: person.name,
    owner: person.is_owner === 1,
    // Sending to the team is up to the owner.
    canShare: person.is_owner === 1 || person.can_share === 1,
    devices: people.find((row) => row.id === person.id)?.devices ?? 1,
    request: own ? { id: own.id, name: own.name, createdAt: iso(own.created_at) } : null,
    // Everyone on the team, to send things to.
    crew: people.filter((row) => !row.blocked_at).map((row) => ({ id: row.id, name: row.name })),
    roster: await roster(db),
    key,
    posts: (posts.results ?? []).flatMap((post) => {
      const recipients = recipientsOf(post.recipients);
      const mine = post.person_id === person.id;
      if (recipients && !mine && !recipients.includes(person.id)) return [];
      return [{
        id: post.id,
        kind: post.kind ?? "share",
        shareId: post.share_id,
        from: post.from_name,
        what: post.what,
        mine,
        direct: Boolean(recipients),
        to: recipients && mine ? recipients.map((id) => nameOf.get(id) ?? "Someone who left") : undefined,
        createdAt: iso(post.created_at),
        expiresAt: iso(post.expires_at),
      }];
    }).slice(0, 40),
    state: readState(person.synced_state),
    vaultVersion: vault?.version ?? 0,
    selfHashes: [...new Set((allSelfHashes.results ?? []).flatMap((row) => recipientsOf(row.hashes) ?? []))],
    selfPosts: (mySchedules.results ?? []).reverse().map((post) => ({
      id: post.id,
      shareId: post.share_id,
      what: post.what,
      hashes: recipientsOf(post.hashes) ?? [],
      createdAt: iso(post.created_at),
      expiresAt: iso(post.expires_at),
    })),
    // The owner offered to hand the app over to you.
    handoverOffer: liveHandover && liveHandover.person_id === person.id
      ? { from: owner?.name ?? "The owner", expiresAt: iso(liveHandover.expires_at) }
      : null,
  };

  if (person.is_owner === 1) {
    const phones = await db.prepare("SELECT * FROM app_devices ORDER BY created_at").all<DeviceRow>();
    const requests = await db.prepare(`SELECT r.id, r.person_id, r.name, r.created_at, p.name AS current
        FROM app_name_requests r JOIN app_people p ON p.id = r.person_id WHERE p.blocked_at IS NULL ORDER BY r.created_at`)
      .all<{ id: string; person_id: string; name: string; created_at: number; current: string }>();
    const entries = await db.prepare("SELECT id, kind, person_id, name, model, created_at FROM app_log ORDER BY created_at DESC LIMIT 40")
      .all<{ id: string; kind: string; person_id: string | null; name: string; model: string | null; created_at: number }>();
    const recovery = await setting(db, "recovery_at");
    result.people = people.map((row) => ({
      id: row.id,
      name: row.name,
      owner: row.is_owner === 1,
      blocked: Boolean(row.blocked_at),
      blockedAt: row.blocked_at ? iso(row.blocked_at) : null,
      canShare: row.is_owner === 1 || row.can_share === 1,
      devices: row.devices,
      since: iso(row.created_at),
      seen: row.seen ? iso(row.seen) : null,
      phones: (phones.results ?? []).filter((phone) => phone.person_id === row.id).map((phone) => ({
        id: phone.id,
        label: phone.label || phone.model || "Device",
        model: phone.model,
        named: Boolean(phone.label),
        current: phone.id === device.id,
        since: iso(phone.created_at),
        seen: iso(phone.seen_at),
      })),
    }));
    result.requests = (requests.results ?? []).map((row) => ({
      id: row.id,
      personId: row.person_id,
      from: row.current,
      name: row.name,
      createdAt: iso(row.created_at),
    }));
    result.log = (entries.results ?? []).map((row) => {
      const who = people.find((other) => other.id === row.person_id);
      return {
        id: row.id,
        kind: row.kind,
        personId: who ? row.person_id : null,
        name: who?.name ?? row.name,
        model: row.model,
        blocked: Boolean(who?.blocked_at),
        owner: who?.is_owner === 1,
        at: iso(row.created_at),
      };
    });
    result.handover = liveHandover
      ? { personId: liveHandover.person_id, name: nameOf.get(liveHandover.person_id) ?? "", expiresAt: iso(liveHandover.expires_at) }
      : null;
    result.recoveryKeyMadeAt = recovery ? iso(Number(recovery)) : null;
  }
  return result;
}

/* ---------- checking in, and new phones ---------- */

async function sync(request: Request, db: CalendarDatabase, env: PushEnvironment) {
  const body = await readBody(request);
  if (!body) return json(request, { error: "Invalid request" }, 400);
  const known = await deviceOf(db, body);
  if (known) {
    await db.prepare("UPDATE app_devices SET seen_at = ?2 WHERE id = ?1").bind(known.device.id, Date.now()).run();
    if (known.person.blocked_at) return blocked(request);
    await remember(request, db, known.device.id, body);
    await mergeRoster(db, body);
    await syncState(db, known.person, body.state);
    await ensureOwner(db);
    // The team key. A phone proves it has it with a hash of it (proof); the
    // server keeps and shows only a hash of that (check), so seeing the check
    // doesn't let anyone claim to have the key. The owner's phone sets it once.
    const proof = typeof body.keyProof === "string" && CHECK.test(body.keyProof) ? body.keyProof : "";
    if (proof) {
      const current = await setting(db, "key_check");
      const check = await sha256(proof);
      const person = await db.prepare("SELECT is_owner FROM app_people WHERE id = ?1").bind(known.person.id).first<{ is_owner: number }>();
      if (!current && person?.is_owner === 1) await setSetting(db, "key_check", check);
      if (current === check || (!current && person?.is_owner === 1)) {
        await db.prepare("UPDATE app_devices SET has_key = 1, wrapped_key = NULL WHERE id = ?1").bind(known.device.id).run();
      }
    } else if (known.device.has_key || body.badWrap === true) {
      // No key on the phone anymore (wiped, or what it got didn't open): another phone passes it on again.
      await db.prepare("UPDATE app_devices SET has_key = 0, wrapped_key = NULL WHERE id = ?1").bind(known.device.id).run();
    }
    const fresh = await deviceOf(db, body);
    return json(request, await view(db, fresh ?? known));
  }

  const deviceId = typeof body.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : "";
  const token = typeof body.deviceToken === "string" ? body.deviceToken : "";
  if (deviceId && await db.prepare("SELECT id FROM app_reset_devices WHERE id = ?1").bind(deviceId).first()) {
    // The owner took this phone off: it picks its name again (once).
    await db.prepare("DELETE FROM app_reset_devices WHERE id = ?1").bind(deviceId).run();
    return json(request, { reset: true, error: "The owner reset this device. Pick your name in Settings." }, 410);
  }
  if (deviceId && await db.prepare("SELECT id FROM app_devices WHERE id = ?1").bind(deviceId).first()) {
    return json(request, { error: "This device's sign-in doesn't match. Reinstall or ask the owner." }, 403);
  }
  // A new phone types a first and last name; it's matched to a name the app
  // knows (people and names on schedules), allowing small typos.
  const first = clean(body.first, 30);
  const last = clean(body.last, 30);
  let name = clean(body.name, 40);
  if (first || last) {
    if (nameKey(first).length < 2 || nameKey(last).length < 2) return json(request, { error: "Type your first and last name." }, 400);
    const typed = tidyName(first, last);
    name = typed;
    if (body.exact !== true) {
      const people = await db.prepare("SELECT name FROM app_people").all<{ name: string }>();
      const known = [...(people.results ?? []).map((row) => row.name), ...await roster(db)];
      const exact = known.find((option) => nameKey(option) === nameKey(typed));
      const close = exact ?? matchName(typed, known);
      if (exact) name = exact;
      else if (close) return json(request, { suggest: close, error: `Did you mean ${close}?` }, 422);
      else return json(request, { unknown: true, name: typed, error: `${typed} isn't on any schedule yet.` }, 404);
    }
  }
  if (!deviceId || token.length < 20 || nameKey(name).length < 2) return json(request, { error: "Pick your name first." }, 400);
  const model = clean(body.model, 40);
  const existing = await personByName(db, name);
  if (existing?.blocked_at) {
    await log(db, "blocked-try", existing, model);
    return blocked(request);
  }
  if (existing) {
    // A second phone of theirs needs a code from their first.
    return json(request, {
      taken: true,
      name: existing.name,
      ownerName: existing.is_owner === 1,
      error: `${existing.name} is already set up on another device.`,
    }, 409);
  }
  const personId = newId();
  await db.prepare("INSERT INTO app_people (id, name, name_key, is_owner, created_at) VALUES (?1, ?2, ?3, 0, ?4)")
    .bind(personId, name, nameKey(name), Date.now()).run();
  await addDevice(db, personId, deviceId, token);
  await remember(request, db, deviceId, body);
  await mergeRoster(db, body);
  await ensureOwner(db);
  const me = await deviceOf(db, body);
  if (me && me.person.is_owner !== 1) {
    await log(db, "new", me.person, model);
    await ping(db, env, { owner: true }, `New on Shiftdeck: ${name}${model ? ` (${model})` : ""}`, "people", `owner:person:${me.person.id}`);
  }
  return json(request, await view(db, me!), 201);
}

/** A one-time code to set up another phone as you. */
async function linkCode(request: Request, db: CalendarDatabase) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const { me } = auth;
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const expiresAt = Date.now() + CODE_MINUTES * 60_000;
  await db.prepare("INSERT OR REPLACE INTO app_link_codes (person_id, code_hash, expires_at, tries) VALUES (?1, ?2, ?3, 0)")
    .bind(me.person.id, await sha256(`${me.person.id}:${code}`), expiresAt).run();
  return json(request, { code, expiresAt: iso(expiresAt) });
}

/** The new phone: name + code from the other phone. Five wrong tries and the code is dead. */
async function link(request: Request, db: CalendarDatabase, env: PushEnvironment) {
  const body = await readBody(request);
  const deviceId = typeof body?.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : "";
  const token = typeof body?.deviceToken === "string" ? body.deviceToken : "";
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
  const person = body ? await personByName(db, clean(body.name, 40)) : null;
  if (!body || !deviceId || token.length < 20 || code.length !== 6 || !person) {
    return json(request, { error: "That code doesn't work." }, 400);
  }
  if (person.blocked_at) return blocked(request);
  if (await db.prepare("SELECT id FROM app_devices WHERE id = ?1").bind(deviceId).first()) {
    return json(request, { error: "This device is already set up." }, 409);
  }
  const row = await db.prepare("SELECT code_hash, expires_at, tries FROM app_link_codes WHERE person_id = ?1")
    .bind(person.id).first<{ code_hash: string; expires_at: number; tries: number }>();
  if (!row) return json(request, { error: "That code doesn't work. Make one on your other device first." }, 403);
  if (row.expires_at < Date.now() || row.tries >= CODE_TRIES) {
    return json(request, { error: "That code has expired. Make a new one on your other device." }, 410);
  }
  if (row.code_hash !== await sha256(`${person.id}:${code}`)) {
    await db.prepare("UPDATE app_link_codes SET tries = tries + 1 WHERE person_id = ?1").bind(person.id).run();
    const left = CODE_TRIES - row.tries - 1;
    return json(request, { error: left > 0 ? `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many tries. Make a new code." }, 403);
  }
  await db.prepare("DELETE FROM app_link_codes WHERE person_id = ?1").bind(person.id).run();
  await addDevice(db, person.id, deviceId, token);
  await remember(request, db, deviceId, body);
  const model = clean(body.model, 40);
  await log(db, person.is_owner === 1 ? "owner-phone" : "phone", person, model);
  await ping(db, env, { owner: true }, person.is_owner === 1
    ? `A new device of yours was added${model ? ` (${model})` : ""}`
    : `${person.name} added a device${model ? ` (${model})` : ""}`, "people", `owner:person:${person.id}`);
  const me = await deviceOf(db, body);
  return json(request, await view(db, me!), 201);
}

/**
 * The owner's recovery key, for a new phone when all the owner's phones are
 * gone. Works once; a handful of wrong tries an hour (from anyone) locks it.
 */
async function recover(request: Request, db: CalendarDatabase, env: PushEnvironment) {
  const body = await readBody(request);
  const deviceId = typeof body?.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : "";
  const token = typeof body?.deviceToken === "string" ? body.deviceToken : "";
  const key = typeof body?.key === "string" ? body.key.replace(/\D/g, "") : "";
  if (!body || !deviceId || token.length < 20 || key.length !== 20) return json(request, { error: "That key doesn't work." }, 400);
  const fails = JSON.parse(await setting(db, "recovery_fails") ?? "{\"count\":0,\"since\":0}") as { count: number; since: number };
  const now = Date.now();
  if (now - fails.since > 3_600_000) Object.assign(fails, { count: 0, since: now });
  if (fails.count >= RECOVERY_TRIES_PER_HOUR) return json(request, { error: "Too many tries. Wait an hour." }, 429);
  const hash = await setting(db, "recovery_hash");
  const owner = await ownerPerson(db);
  if (!hash || !owner || hash !== await sha256(`recovery:${key}`)) {
    fails.count += 1;
    await setSetting(db, "recovery_fails", JSON.stringify(fails));
    return json(request, { error: "That key doesn't work." }, 403);
  }
  if (await db.prepare("SELECT id FROM app_devices WHERE id = ?1").bind(deviceId).first()) {
    return json(request, { error: "This device is already set up." }, 409);
  }
  // One use: the owner makes a new one afterwards.
  await setSetting(db, "recovery_hash", null);
  await setSetting(db, "recovery_at", null);
  await addDevice(db, owner.id, deviceId, token);
  await remember(request, db, deviceId, body);
  await log(db, "recovered", owner, clean(body.model, 40));
  await ping(db, env, { owner: true }, "Your recovery key was used to set up a new device", "people", "owner:log");
  const me = await deviceOf(db, body);
  return json(request, await view(db, me!), 201);
}

/* ---------- the team key and posts ---------- */

/** A phone with the team key passes it (wrapped for each phone's public key) to phones without it. */
async function keys(request: Request, db: CalendarDatabase) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const { me, body } = auth;
  if (!me.device.has_key) return json(request, { error: "This device doesn't have the key." }, 403);
  const wraps = Array.isArray(body.wraps) ? body.wraps.slice(0, 20) : [];
  let saved = 0;
  for (const raw of wraps) {
    const wrap = raw as Body;
    const target = typeof wrap?.deviceId === "string" && DEVICE.test(wrap.deviceId) ? wrap.deviceId : "";
    const data = typeof wrap?.data === "string" && wrap.data.length < 2000 ? wrap.data : "";
    if (!target || !data) continue;
    const result = await db.prepare(`UPDATE app_devices SET wrapped_key = ?2 WHERE id = ?1 AND has_key = 0 AND wrapped_key IS NULL
        AND person_id IN (SELECT id FROM app_people WHERE blocked_at IS NULL)`).bind(target, data).run();
    saved += (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
  }
  return json(request, { ok: true, saved });
}

/** Sends something to everyone, or to picked people (person ids). */
async function post(request: Request, db: CalendarDatabase, env: PushEnvironment) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const { me, body } = auth;
  const swap = body.kind === "swap";
  const self = body.kind === "self";
  // Swap requests are between two people, and anyone can send to their own phones;
  // sending to the team needs the owner's OK.
  if (!swap && !self && me.person.is_owner !== 1 && me.person.can_share !== 1) {
    return json(request, { error: "The owner hasn't turned on sending to the team for you." }, 403);
  }
  const shareId = typeof body.shareId === "string" && ID.test(body.shareId) ? body.shareId : "";
  const share = !shareId
    ? null
    : swap
      ? await db.prepare("SELECT expires_at FROM swap_requests WHERE id = ?1").bind(shareId).first<{ expires_at: string }>()
        .then((row) => row && { expires_at: Date.parse(row.expires_at) })
        .catch(() => null)
      : await db.prepare("SELECT expires_at FROM shares WHERE id = ?1").bind(shareId).first<{ expires_at: number }>().catch(() => null);
  if (!share) return json(request, { error: "Nothing to send" }, 400);
  if (self) {
    const hashes = Array.isArray(body.hashes)
      ? [...new Set(body.hashes.filter((hash): hash is string => typeof hash === "string" && /^[a-f0-9]{16,128}$/i.test(hash)))].slice(0, 20)
      : [];
    const id = newId();
    // Quietly: your other phones pick it up when they check in.
    await db.prepare(`INSERT INTO app_posts (id, person_id, share_id, from_name, what, kind, recipients, hashes, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'self', ?6, ?7, ?8, ?9)`)
      .bind(id, me.person.id, shareId, me.person.name, clean(body.what, 120) || "a schedule",
        JSON.stringify([me.person.id]), JSON.stringify(hashes), Date.now(), share.expires_at)
      .run();
    return json(request, { id, notified: 0, to: 1 }, 201);
  }
  const what = swap ? "a shift swap" : clean(body.what, 120) || "an update";
  const everyone = await db.prepare("SELECT id FROM app_people WHERE blocked_at IS NULL").all<{ id: string }>();
  const ids = new Set((everyone.results ?? []).map((row) => row.id));
  const picked = Array.isArray(body.to)
    ? [...new Set(body.to.filter((id): id is string => typeof id === "string"))].filter((id) => id !== me.person.id && ids.has(id))
    : [];
  const recipients = picked.length ? picked : null;
  if (swap && recipients?.length !== 1) return json(request, { error: "A swap goes to one person." }, 400);
  const id = newId();
  await db.prepare(`INSERT INTO app_posts (id, person_id, share_id, from_name, what, kind, recipients, created_at, expires_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(id, me.person.id, shareId, me.person.name, what, swap ? "swap" : null,
      recipients ? JSON.stringify(recipients) : null, Date.now(), share.expires_at)
    .run();
  const first = me.person.name.split(" ")[0];
  const message = swap ? `${first} wants to swap shifts` : recipients ? `${first} sent you ${what}` : `${first} shared ${what}`;
  let notified = 0;
  for (const personId of recipients ?? [...ids].filter((other) => other !== me.person.id)) {
    notified += await ping(db, env, { personId }, message, `post-${id}`, `post:${id}`);
  }
  return json(request, { id, notified, to: recipients?.length ?? null }, 201);
}

/* ---------- names ---------- */

async function requestName(request: Request, db: CalendarDatabase, env: PushEnvironment) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const { me, body } = auth;
  const name = clean(body.name, 40);
  if (nameKey(name).length < 2 || nameKey(name) === me.person.name_key) return json(request, { error: "Pick a different name." }, 400);
  const taken = await personByName(db, name);
  if (taken) return json(request, { error: `${taken.name} is already someone's name.` }, 409);
  if (me.person.is_owner === 1) {
    await rename(db, me.person.id, name);
    return json(request, { ok: true, name });
  }
  await db.prepare("INSERT OR REPLACE INTO app_name_requests (id, person_id, name, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(newId(), me.person.id, name, Date.now()).run();
  await ping(db, env, { owner: true }, `${me.person.name.split(" ")[0]} asks to change their name to ${name}`, "names", "owner:requests");
  return json(request, { ok: true, pending: true });
}

async function rename(db: CalendarDatabase, personId: string, name: string) {
  await db.prepare("UPDATE app_people SET name = ?2, name_key = ?3 WHERE id = ?1").bind(personId, name, nameKey(name)).run();
  await db.prepare("DELETE FROM app_name_requests WHERE person_id = ?1").bind(personId).run();
}

/* ---------- handing over ---------- */

/** The person the owner picked types the key the owner gave them. */
async function acceptHandover(request: Request, db: CalendarDatabase, env: PushEnvironment) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const { me, body } = auth;
  const key = typeof body.key === "string" ? body.key.replace(/\D/g, "") : "";
  const offer = await db.prepare("SELECT person_id, key_hash, expires_at, tries FROM app_handover WHERE id = 'offer'")
    .first<{ person_id: string; key_hash: string; expires_at: number; tries: number }>();
  if (!offer || offer.person_id !== me.person.id) return json(request, { error: "There's no handover for you." }, 404);
  if (offer.expires_at < Date.now() || offer.tries >= HANDOVER_TRIES) {
    return json(request, { error: "That handover expired. Ask the owner to start it again." }, 410);
  }
  if (offer.key_hash !== await sha256(`handover:${me.person.id}:${key}`)) {
    await db.prepare("UPDATE app_handover SET tries = tries + 1 WHERE id = 'offer'").run();
    const left = HANDOVER_TRIES - offer.tries - 1;
    return json(request, { error: left > 0 ? `That key doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many tries. Ask the owner to start again." }, 403);
  }
  const previous = await ownerPerson(db);
  await db.batch([
    db.prepare("UPDATE app_people SET is_owner = 0 WHERE is_owner = 1"),
    db.prepare("UPDATE app_people SET is_owner = 1, blocked_at = NULL WHERE id = ?1").bind(me.person.id),
    db.prepare("DELETE FROM app_handover WHERE id = 'offer'"),
  ]);
  // The old owner's recovery key is theirs, not the new owner's.
  await setSetting(db, "recovery_hash", null);
  await setSetting(db, "recovery_at", null);
  await log(db, "owner", me.person, "");
  if (previous) await ping(db, env, { personId: previous.id }, `${me.person.name} is now the owner of Shiftdeck`, "people", "home");
  const fresh = await deviceOf(db, body);
  return json(request, await view(db, fresh!));
}

/* ---------- the owner ---------- */

async function ownerAction(request: Request, db: CalendarDatabase, env: PushEnvironment, action: string) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const { me, body } = auth;
  const own = action === "withdraw";
  if (!own && me.person.is_owner !== 1) return json(request, { error: "Only the app's owner can do that." }, 403);

  if (action === "decide" || action === "withdraw") {
    const row = typeof body.requestId === "string"
      ? await db.prepare("SELECT id, person_id, name FROM app_name_requests WHERE id = ?1").bind(body.requestId)
        .first<{ id: string; person_id: string; name: string }>()
      : null;
    if (!row || (own && row.person_id !== me.person.id)) return json(request, { error: "That request is gone." }, 404);
    if (!own && body.approve === true) {
      const taken = await personByName(db, row.name);
      if (taken && taken.id !== row.person_id) return json(request, { error: `${taken.name} is already someone's name.` }, 409);
      await rename(db, row.person_id, row.name);
      await ping(db, env, { personId: row.person_id }, `Your name is now ${row.name}`, "names", "settings");
    } else {
      await db.prepare("DELETE FROM app_name_requests WHERE id = ?1").bind(row.id).run();
      if (!own) await ping(db, env, { personId: row.person_id }, "Your name change wasn't approved", "names", "settings");
    }
    return json(request, { ok: true });
  }
  if (action.startsWith("device-")) return deviceAction(request, db, env, action, body, me.device.id);
  if (action === "recovery-key") {
    const key = digits(5);
    await setSetting(db, "recovery_hash", await sha256(`recovery:${key}`));
    await setSetting(db, "recovery_at", String(Date.now()));
    await setSetting(db, "recovery_fails", null);
    return json(request, { key });
  }
  if (action === "handover-cancel") {
    await db.prepare("DELETE FROM app_handover WHERE id = 'offer'").run();
    return json(request, { ok: true });
  }
  if (action === "log-clear") {
    await db.prepare("DELETE FROM app_log").run();
    return json(request, { ok: true });
  }

  const target = typeof body.personId === "string"
    ? await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(body.personId).first<Person>()
    : null;
  if (!target) return json(request, { error: "They're not in the app anymore." }, 404);
  const self = target.id === me.person.id;

  if (action === "rename") {
    const name = clean(body.name, 40);
    if (nameKey(name).length < 2) return json(request, { error: "Pick a name." }, 400);
    const taken = await personByName(db, name);
    if (taken && taken.id !== target.id) return json(request, { error: `${taken.name} is already someone's name.` }, 409);
    await rename(db, target.id, name);
    if (!self) await ping(db, env, { personId: target.id }, `Your name is now ${name}`, "names", "settings");
    return json(request, { ok: true, name });
  }
  if (self) return json(request, { error: "That's you." }, 400);
  if (action === "remove") {
    // Frees the name; their phones pick a name again next time they open.
    const theirs = await db.prepare("SELECT id FROM app_devices WHERE person_id = ?1").bind(target.id).all<{ id: string }>();
    const now = Date.now();
    await db.batch([
      ...(theirs.results ?? []).map((phone) =>
        db.prepare("INSERT OR REPLACE INTO app_reset_devices (id, created_at) VALUES (?1, ?2)").bind(phone.id, now)),
      db.prepare("DELETE FROM app_devices WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_name_requests WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_link_codes WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_handover WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_vault WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_people WHERE id = ?1").bind(target.id),
    ]);
    return json(request, { ok: true });
  }
  if (action === "block") {
    // Their phones stop working; their name stays taken so they can't come back as it.
    await db.batch([
      db.prepare("UPDATE app_people SET blocked_at = ?2 WHERE id = ?1").bind(target.id, Date.now()),
      db.prepare("DELETE FROM app_name_requests WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_link_codes WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_handover WHERE person_id = ?1").bind(target.id),
    ]);
    return json(request, { ok: true });
  }
  if (action === "share-access") {
    await db.prepare("UPDATE app_people SET can_share = ?2 WHERE id = ?1").bind(target.id, body.allow === true ? 1 : 0).run();
    return json(request, { ok: true });
  }
  if (action === "unblock") {
    await db.prepare("UPDATE app_people SET blocked_at = NULL WHERE id = ?1").bind(target.id).run();
    return json(request, { ok: true });
  }
  if (action === "handover") {
    if (target.blocked_at) return json(request, { error: "Unblock them first." }, 400);
    const key = digits(4);
    const expiresAt = Date.now() + HANDOVER_HOURS * 3_600_000;
    await db.prepare("INSERT OR REPLACE INTO app_handover (id, person_id, key_hash, expires_at, tries) VALUES ('offer', ?1, ?2, ?3, 0)")
      .bind(target.id, await sha256(`handover:${target.id}:${key}`), expiresAt).run();
    await ping(db, env, { personId: target.id }, `${me.person.name.split(" ")[0]} wants to make you the owner of Shiftdeck`, "people", "handover");
    return json(request, { key, expiresAt: iso(expiresAt), name: target.name });
  }
  return json(request, { error: "Not found" }, 404);
}

/** Owner only: rename one phone, move it to another name, or take it off the app. */
async function deviceAction(request: Request, db: CalendarDatabase, env: PushEnvironment, action: string, body: Body, myDeviceId: string) {
  const id = typeof body.targetDeviceId === "string" && DEVICE.test(body.targetDeviceId) ? body.targetDeviceId : "";
  const phone = id ? await db.prepare("SELECT * FROM app_devices WHERE id = ?1").bind(id).first<DeviceRow>() : null;
  if (!phone) return json(request, { error: "That device isn't in the app anymore." }, 404);

  if (action === "device-rename") {
    const label = clean(body.label, 30);
    await db.prepare("UPDATE app_devices SET label = ?2 WHERE id = ?1").bind(phone.id, label || null).run();
    return json(request, { ok: true });
  }
  if (phone.id === myDeviceId) return json(request, { error: "That's the device you're using. Do it from another device." }, 400);
  if (action === "device-remove") {
    await dropDevice(db, phone.id, phone.person_id);
    return json(request, { ok: true });
  }
  if (action === "device-move") {
    const name = clean(body.name, 40);
    if (nameKey(name).length < 2) return json(request, { error: "Pick a name." }, 400);
    let to = await personByName(db, name);
    if (to?.id === phone.person_id) return json(request, { ok: true });
    // Owner access only comes with a code from an owner phone.
    if (to?.is_owner === 1) return json(request, { error: "Your devices are added with a code from Add another device of mine." }, 400);
    if (to?.blocked_at) return json(request, { error: `${to.name} is blocked.` }, 400);
    if (!to) {
      const personId = newId();
      await db.prepare("INSERT INTO app_people (id, name, name_key, is_owner, created_at) VALUES (?1, ?2, ?3, 0, ?4)")
        .bind(personId, name, nameKey(name), Date.now()).run();
      to = await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(personId).first<Person>();
    }
    await db.prepare("UPDATE app_devices SET person_id = ?2 WHERE id = ?1").bind(phone.id, to!.id).run();
    await dropIfEmpty(db, phone.person_id);
    if (phone.profile_id) {
      await sendProfilePush(db, env, phone.profile_id, { title: "Shiftdeck", body: `This device is now set up as ${to!.name}`, tag: "names", path: "?open=settings" }).catch(() => 0);
    }
    return json(request, { ok: true, name: to!.name });
  }
  return json(request, { error: "Not found" }, 404);
}

const OWNER_ACTIONS = [
  "decide", "withdraw", "rename", "remove", "block", "unblock", "share-access", "handover", "handover-cancel", "recovery-key", "log-clear",
  "device-rename", "device-move", "device-remove",
];

export async function handlePeopleRequest(request: Request, db: CalendarDatabase | undefined, env: PushEnvironment) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/people")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) as Record<string, string> });
  }
  if (!db) return json(request, { error: "Unavailable" }, 503);
  if (request.method !== "POST") return json(request, { error: "Not found" }, 404);
  await ensureSchema(db);
  const action = url.pathname.replace(/^\/api\/people\/?/, "");
  if (action === "sync") return sync(request, db, env);
  if (action === "link-code") return linkCode(request, db);
  if (action === "link") return link(request, db, env);
  if (action === "recover") return recover(request, db, env);
  if (action === "keys") return keys(request, db);
  if (action === "post") return post(request, db, env);
  if (action === "vault") return vaultGet(request, db);
  if (action === "vault-put") return vaultPut(request, db);
  if (action === "name-request") return requestName(request, db, env);
  if (action === "accept-handover") return acceptHandover(request, db, env);
  if (OWNER_ACTIONS.includes(action)) return ownerAction(request, db, env, action);
  return json(request, { error: "Not found" }, 404);
}

/** Your vault, if it's newer than the version this device has (`have`). */
async function vaultGet(request: Request, db: CalendarDatabase) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const row = await db.prepare("SELECT data, version FROM app_vault WHERE person_id = ?1").bind(auth.me.person.id)
    .first<{ data: string; version: number }>();
  const have = Number(auth.body.have);
  if (!row) return json(request, { version: 0, data: null });
  return json(request, { version: row.version, data: row.version === have ? null : row.data });
}

const VAULT_MAX = 1_800_000;

/** Saves your vault on top of the version it was merged with (`base`); 409 if another device saved first. */
async function vaultPut(request: Request, db: CalendarDatabase) {
  const auth = await signedIn(request, db);
  if (auth instanceof Response) return auth;
  const data = typeof auth.body.data === "string" ? auth.body.data : "";
  const base = Number(auth.body.base);
  if (!data || data.length > VAULT_MAX || !/^[A-Za-z0-9_-]+$/.test(data)) return json(request, { error: "Too big to save" }, 413);
  if (!Number.isInteger(base) || base < 0) return json(request, { error: "Bad version" }, 400);
  const id = auth.me.person.id;
  const now = Date.now();
  const result = base === 0
    ? await db.prepare("INSERT OR IGNORE INTO app_vault (person_id, data, version, updated_at) VALUES (?1, ?2, 1, ?3)").bind(id, data, now).run()
    : await db.prepare("UPDATE app_vault SET data = ?2, version = version + 1, updated_at = ?3 WHERE person_id = ?1 AND version = ?4")
      .bind(id, data, now, base).run();
  if (!result.meta?.changes) {
    const row = await db.prepare("SELECT version FROM app_vault WHERE person_id = ?1").bind(id).first<{ version: number }>();
    return json(request, { conflict: true, version: row?.version ?? 0 }, 409);
  }
  return json(request, { version: base + 1 });
}

/** Posts go when their share does. */
export async function deleteExpiredPosts(db: CalendarDatabase, at = Date.now()) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM app_posts WHERE expires_at < ?1").bind(at).run();
}
