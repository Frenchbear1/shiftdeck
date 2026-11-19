/**
 * Who's who across the whole app.
 *
 * Every phone that has picked a name registers it here with a random device
 * token (only its hash is stored). Each name belongs to one person; a
 * person can have several phones, added with a short one-time code from a
 * phone they already have. Names are locked: only the app's owner changes
 * them (people ask from Settings).
 *
 * The owner is a person, so all of the owner's phones have owner access. The
 * first owner is whoever runs the oldest team (the app's creator); after
 * that, ownership only moves when the owner hands it over.
 */
import { corsHeaders, json, type CalendarDatabase } from "./calendar-service";
import { ownsNotificationProfile, sendProfilePush, type PushEnvironment } from "./push-service";

const CODE_MINUTES = 10;
const CODE_TRIES = 5;

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
  ]);
  // What kind of phone it is (from the phone) and a name the owner gave it.
  for (const column of ["model TEXT", "label TEXT"]) {
    await db.prepare(`ALTER TABLE app_devices ADD COLUMN ${column}`).run().catch(() => undefined);
  }
  schemaReady = true;
}

/**
 * Team members point at the person they are, so team names follow app names.
 * The teams table may not exist yet on a new database, so this is set up the
 * first time it's needed (and retried until it works).
 */
let teamLinkReady = false;
async function ensureTeamLink(db: CalendarDatabase) {
  if (teamLinkReady) return true;
  try {
    await db.prepare("ALTER TABLE team_members ADD COLUMN person_id TEXT").run();
    teamLinkReady = true;
  } catch (error) {
    // Already added (fine), or no teams table yet (try again next time).
    teamLinkReady = /duplicate column/i.test(error instanceof Error ? error.message : String(error));
  }
  return teamLinkReady;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const newId = (bytes = 16) => {
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
const DEVICE = /^[A-Za-z0-9_-]{16,40}$/;

type Body = Record<string, unknown>;
type Person = { id: string; name: string; name_key: string; is_owner: number; created_at: number };

async function readBody(request: Request): Promise<Body | null> {
  try {
    const value = JSON.parse(await request.text());
    return value && typeof value === "object" ? value as Body : null;
  } catch {
    return null;
  }
}

/** The person this phone is, if its id and token check out. */
async function deviceOf(db: CalendarDatabase, body: Body) {
  const deviceId = typeof body.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : "";
  const token = typeof body.deviceToken === "string" ? body.deviceToken : "";
  if (!deviceId || token.length < 20) return null;
  const device = await db.prepare("SELECT id, person_id, token_hash FROM app_devices WHERE id = ?1")
    .bind(deviceId).first<{ id: string; person_id: string; token_hash: string }>();
  if (!device || device.token_hash !== await sha256(token)) return null;
  const person = await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(device.person_id).first<Person>();
  return person ? { device, person } : null;
}

async function personByName(db: CalendarDatabase, name: string) {
  return db.prepare("SELECT * FROM app_people WHERE name_key = ?1").bind(nameKey(name)).first<Person>();
}

async function ownerExists(db: CalendarDatabase) {
  return Boolean(await db.prepare("SELECT id FROM app_people WHERE is_owner = 1 LIMIT 1").first<{ id: string }>());
}

/**
 * The first owner: whoever runs the oldest team. Proven with that team's
 * member credentials, and only while the app has no owner yet.
 */
async function provesFirstOwner(db: CalendarDatabase, body: Body) {
  if (await ownerExists(db)) return false;
  const teams = Array.isArray(body.teams) ? body.teams.slice(0, 5) : [];
  const oldest = await db.prepare("SELECT id, owner_id FROM teams ORDER BY created_at LIMIT 1")
    .first<{ id: string; owner_id: string | null }>()
    .catch(() => null);
  if (!oldest) return;
  for (const raw of teams) {
    const team = raw as Body;
    if (team?.teamId !== oldest.id || typeof team.memberId !== "string" || typeof team.memberToken !== "string") continue;
    const ownerId = oldest.owner_id ?? (await db.prepare(
      "SELECT member_id FROM team_members WHERE team_id = ?1 ORDER BY joined_at LIMIT 1",
    ).bind(oldest.id).first<{ member_id: string }>())?.member_id;
    if (team.memberId !== ownerId) continue;
    const member = await db.prepare("SELECT token_hash FROM team_members WHERE team_id = ?1 AND member_id = ?2")
      .bind(oldest.id, team.memberId).first<{ token_hash: string }>();
    if (member && member.token_hash === await sha256(team.memberToken)) return true;
  }
  return false;
}

async function claimFirstOwner(db: CalendarDatabase, personId: string, body: Body) {
  if (await provesFirstOwner(db, body)) {
    await db.prepare("UPDATE app_people SET is_owner = 1 WHERE id = ?1").bind(personId).run();
  }
}

/** Points this phone's team memberships at its person, and gives them the person's name. */
async function linkTeams(db: CalendarDatabase, person: Person, body: Body) {
  const teams = Array.isArray(body.teams) ? body.teams.slice(0, 5) : [];
  if (!teams.length || !await ensureTeamLink(db)) return;
  for (const raw of teams) {
    const team = raw as Body;
    if (typeof team?.teamId !== "string" || typeof team.memberId !== "string" || typeof team.memberToken !== "string") continue;
    const member = await db.prepare("SELECT token_hash FROM team_members WHERE team_id = ?1 AND member_id = ?2")
      .bind(team.teamId, team.memberId).first<{ token_hash: string }>()
      .catch(() => null);
    if (member && member.token_hash === await sha256(team.memberToken)) {
      await db.prepare("UPDATE team_members SET person_id = ?3, name = ?4 WHERE team_id = ?1 AND member_id = ?2")
        .bind(team.teamId, team.memberId, person.id, person.name).run();
    }
  }
}

/** What kind of phone this is, as the phone describes itself ("iPhone · app"). */
async function rememberModel(db: CalendarDatabase, deviceId: string, body: Body) {
  const model = clean(body.model, 40);
  if (model) await db.prepare("UPDATE app_devices SET model = ?2 WHERE id = ?1").bind(deviceId, model).run();
}

/** Takes a phone off the app; it's told next time it checks in. Its person goes too if that was their last phone. */
async function dropDevice(db: CalendarDatabase, deviceId: string, personId: string) {
  await db.batch([
    db.prepare("DELETE FROM app_devices WHERE id = ?1").bind(deviceId),
    db.prepare("INSERT OR REPLACE INTO app_reset_devices (id, created_at) VALUES (?1, ?2)").bind(deviceId, Date.now()),
  ]);
  await dropIfEmpty(db, personId);
}

/** A person with no phones left (and not the owner) frees their name. */
async function dropIfEmpty(db: CalendarDatabase, personId: string) {
  const left = await db.prepare("SELECT COUNT(*) AS count FROM app_devices WHERE person_id = ?1").bind(personId).first<{ count: number }>();
  const person = await db.prepare("SELECT is_owner FROM app_people WHERE id = ?1").bind(personId).first<{ is_owner: number }>();
  if (!person || person.is_owner === 1 || (left?.count ?? 0) > 0) return;
  await db.batch([
    db.prepare("DELETE FROM app_name_requests WHERE person_id = ?1").bind(personId),
    db.prepare("DELETE FROM app_link_codes WHERE person_id = ?1").bind(personId),
    db.prepare("DELETE FROM app_people WHERE id = ?1").bind(personId),
  ]);
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

/** Pings every phone of a person (or of the owner). */
async function ping(db: CalendarDatabase, env: PushEnvironment, where: { personId?: string; owner?: boolean }, body: string) {
  const rows = where.owner
    ? await db.prepare(`SELECT d.profile_id FROM app_devices d JOIN app_people p ON p.id = d.person_id
        WHERE p.is_owner = 1 AND d.profile_id IS NOT NULL`).all<{ profile_id: string }>()
    : await db.prepare("SELECT profile_id FROM app_devices WHERE person_id = ?1 AND profile_id IS NOT NULL")
      .bind(where.personId).all<{ profile_id: string }>();
  for (const profileId of new Set((rows.results ?? []).map((row) => row.profile_id))) {
    await sendProfilePush(db, env, profileId, { title: "Shiftdeck", body, tag: "names", path: "?notifications=1" }).catch(() => 0);
  }
}

type DeviceRow = { id: string; person_id: string; model: string | null; label: string | null; created_at: number; seen_at: number };

/** What a phone needs to know about itself (and, for the owner, about everyone). */
async function view(db: CalendarDatabase, person: Person, deviceId: string) {
  const own = await db.prepare("SELECT id, name, created_at FROM app_name_requests WHERE person_id = ?1")
    .bind(person.id).first<{ id: string; name: string; created_at: number }>();
  const devices = await db.prepare("SELECT COUNT(*) AS count FROM app_devices WHERE person_id = ?1")
    .bind(person.id).first<{ count: number }>();
  const owner = await db.prepare("SELECT name FROM app_people WHERE is_owner = 1 LIMIT 1").first<{ name: string }>();
  const result: Record<string, unknown> = {
    ownerName: owner?.name ?? null,
    personId: person.id,
    name: person.name,
    owner: person.is_owner === 1,
    devices: devices?.count ?? 1,
    request: own ? { id: own.id, name: own.name, createdAt: new Date(own.created_at).toISOString() } : null,
  };
  if (person.is_owner === 1) {
    const everyone = await db.prepare(`SELECT p.id, p.name, p.is_owner, p.created_at, COUNT(d.id) AS devices,
        MAX(d.seen_at) AS seen FROM app_people p LEFT JOIN app_devices d ON d.person_id = p.id
        GROUP BY p.id ORDER BY p.created_at`)
      .all<{ id: string; name: string; is_owner: number; created_at: number; devices: number; seen: number | null }>();
    const requests = await db.prepare(`SELECT r.id, r.person_id, r.name, r.created_at, p.name AS current
        FROM app_name_requests r JOIN app_people p ON p.id = r.person_id ORDER BY r.created_at`)
      .all<{ id: string; person_id: string; name: string; created_at: number; current: string }>();
    const phones = await db.prepare("SELECT id, person_id, model, label, created_at, seen_at FROM app_devices ORDER BY created_at")
      .all<DeviceRow>();
    result.people = (everyone.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      owner: row.is_owner === 1,
      devices: row.devices,
      since: new Date(row.created_at).toISOString(),
      seen: row.seen ? new Date(row.seen).toISOString() : null,
      phones: (phones.results ?? []).filter((phone) => phone.person_id === row.id).map((phone) => ({
        id: phone.id,
        label: phone.label || phone.model || "Phone",
        model: phone.model,
        named: Boolean(phone.label),
        current: phone.id === deviceId,
        since: new Date(phone.created_at).toISOString(),
        seen: new Date(phone.seen_at).toISOString(),
      })),
    }));
    result.requests = (requests.results ?? []).map((row) => ({
      id: row.id,
      personId: row.person_id,
      from: row.current,
      name: row.name,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
  return result;
}

async function addDevice(db: CalendarDatabase, personId: string, deviceId: string, token: string) {
  const now = Date.now();
  await db.prepare("INSERT OR REPLACE INTO app_devices (id, person_id, token_hash, created_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?4)")
    .bind(deviceId, personId, await sha256(token), now).run();
}

/**
 * A phone checks in: registers its name the first time (or is told the name
 * is someone else's), and from then on learns its locked name and, if it's
 * the owner, everyone's.
 */
async function sync(request: Request, db: CalendarDatabase) {
  const body = await readBody(request);
  if (!body) return json(request, { error: "Invalid request" }, 400);
  const known = await deviceOf(db, body);
  if (known) {
    await db.prepare("UPDATE app_devices SET seen_at = ?2 WHERE id = ?1").bind(known.device.id, Date.now()).run();
    await rememberModel(db, known.device.id, body);
    await rememberProfile(request, db, known.device.id, body);
    await claimFirstOwner(db, known.person.id, body);
    await linkTeams(db, known.person, body);
    const person = await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(known.person.id).first<Person>();
    return json(request, await view(db, person ?? known.person, known.device.id));
  }

  const deviceId = typeof body.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : "";
  const token = typeof body.deviceToken === "string" ? body.deviceToken : "";
  const name = clean(body.name, 40);
  if (deviceId && await db.prepare("SELECT id FROM app_reset_devices WHERE id = ?1").bind(deviceId).first()) {
    // The owner took this phone off: it picks its name again (once).
    await db.prepare("DELETE FROM app_reset_devices WHERE id = ?1").bind(deviceId).run();
    return json(request, { reset: true, error: "The owner reset this phone. Pick your name in Settings." }, 410);
  }
  if (!deviceId || token.length < 20 || nameKey(name).length < 2) return json(request, { error: "Pick your name first." }, 400);
  if (await db.prepare("SELECT id FROM app_devices WHERE id = ?1").bind(deviceId).first()) {
    return json(request, { error: "This phone's sign-in doesn't match. Reinstall or ask the owner." }, 403);
  }
  const existing = await personByName(db, name);
  // The app's first owner taking their name back from whoever grabbed it first.
  if (existing && await provesFirstOwner(db, body)) {
    await db.prepare("DELETE FROM app_devices WHERE person_id = ?1").bind(existing.id).run();
    await addDevice(db, existing.id, deviceId, token);
    await db.prepare("UPDATE app_people SET is_owner = 1 WHERE id = ?1").bind(existing.id).run();
    await rememberProfile(request, db, deviceId, body);
    await rememberModel(db, deviceId, body);
    const person = await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(existing.id).first<Person>();
    await linkTeams(db, person!, body);
    return json(request, await view(db, person!, deviceId), 201);
  }
  if (existing) {
    // Someone already has this name: a second phone of theirs needs a code from their first.
    return json(request, {
      taken: true,
      name: existing.name,
      ownerName: existing.is_owner === 1,
      error: `${existing.name} is already set up on another phone.`,
    }, 409);
  }
  const personId = newId();
  await db.prepare("INSERT INTO app_people (id, name, name_key, is_owner, created_at) VALUES (?1, ?2, ?3, 0, ?4)")
    .bind(personId, name, nameKey(name), Date.now()).run();
  await addDevice(db, personId, deviceId, token);
  await rememberProfile(request, db, deviceId, body);
  await rememberModel(db, deviceId, body);
  await claimFirstOwner(db, personId, body);
  const person = await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(personId).first<Person>();
  await linkTeams(db, person!, body);
  return json(request, await view(db, person!, deviceId), 201);
}

/** A one-time code to set up another phone as you (owner access comes with it). */
async function linkCode(request: Request, db: CalendarDatabase) {
  const body = await readBody(request);
  const me = body ? await deviceOf(db, body) : null;
  if (!me) return json(request, { error: "This phone isn't set up yet." }, 403);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const expiresAt = Date.now() + CODE_MINUTES * 60_000;
  await db.prepare("INSERT OR REPLACE INTO app_link_codes (person_id, code_hash, expires_at, tries) VALUES (?1, ?2, ?3, 0)")
    .bind(me.person.id, await sha256(`${me.person.id}:${code}`), expiresAt).run();
  return json(request, { code, expiresAt: new Date(expiresAt).toISOString() });
}

/** The new phone: name + code from the other phone. Five wrong tries and the code is dead. */
async function link(request: Request, db: CalendarDatabase) {
  const body = await readBody(request);
  const deviceId = typeof body?.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : "";
  const token = typeof body?.deviceToken === "string" ? body.deviceToken : "";
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
  const person = body ? await personByName(db, clean(body.name, 40)) : null;
  if (!body || !deviceId || token.length < 20 || code.length !== 6 || !person) {
    return json(request, { error: "That code doesn't work." }, 400);
  }
  const row = await db.prepare("SELECT code_hash, expires_at, tries FROM app_link_codes WHERE person_id = ?1")
    .bind(person.id).first<{ code_hash: string; expires_at: number; tries: number }>();
  if (!row) return json(request, { error: "That code doesn't work. Make one on your other phone first." }, 403);
  if (row.expires_at < Date.now() || row.tries >= CODE_TRIES) {
    return json(request, { error: "That code has expired. Make a new one on your other phone." }, 410);
  }
  if (row.code_hash !== await sha256(`${person.id}:${code}`)) {
    await db.prepare("UPDATE app_link_codes SET tries = tries + 1 WHERE person_id = ?1").bind(person.id).run();
    const left = CODE_TRIES - row.tries - 1;
    return json(request, { error: left > 0 ? `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many tries. Make a new code." }, 403);
  }
  await db.prepare("DELETE FROM app_link_codes WHERE person_id = ?1").bind(person.id).run();
  await addDevice(db, person.id, deviceId, token);
  await rememberProfile(request, db, deviceId, body);
  await rememberModel(db, deviceId, body);
  await linkTeams(db, person, body);
  return json(request, await view(db, person, deviceId), 201);
}

/** Ask the owner for a new name (the owner's own change goes straight through). */
async function requestName(request: Request, db: CalendarDatabase, env: PushEnvironment) {
  const body = await readBody(request);
  const me = body ? await deviceOf(db, body) : null;
  if (!me || !body) return json(request, { error: "This phone isn't set up yet." }, 403);
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
  await ping(db, env, { owner: true }, `${me.person.name.split(" ")[0]} asks to change their name to ${name}`);
  return json(request, { ok: true, pending: true });
}

async function rename(db: CalendarDatabase, personId: string, name: string) {
  await db.prepare("UPDATE app_people SET name = ?2, name_key = ?3 WHERE id = ?1").bind(personId, name, nameKey(name)).run();
  await db.prepare("DELETE FROM app_name_requests WHERE person_id = ?1").bind(personId).run();
  if (await ensureTeamLink(db)) {
    await db.prepare("UPDATE team_members SET name = ?2 WHERE person_id = ?1").bind(personId, name).run().catch(() => undefined);
  }
}

/** Owner only: decide a request, rename or remove anyone, or hand the app over. */
async function ownerAction(request: Request, db: CalendarDatabase, env: PushEnvironment, action: string) {
  const body = await readBody(request);
  const me = body ? await deviceOf(db, body) : null;
  if (!me || !body) return json(request, { error: "This phone isn't set up yet." }, 403);
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
      await ping(db, env, { personId: row.person_id }, `Your name is now ${row.name}`);
    } else {
      await db.prepare("DELETE FROM app_name_requests WHERE id = ?1").bind(row.id).run();
      if (!own) await ping(db, env, { personId: row.person_id }, "Your name change wasn't approved");
    }
    return json(request, { ok: true });
  }

  if (action.startsWith("device-")) return deviceAction(request, db, env, action, body, me.device.id);

  const target = typeof body.personId === "string"
    ? await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(body.personId).first<Person>()
    : null;
  if (!target) return json(request, { error: "They're not in the app anymore." }, 404);

  if (action === "rename") {
    const name = clean(body.name, 40);
    if (nameKey(name).length < 2) return json(request, { error: "Pick a name." }, 400);
    const taken = await personByName(db, name);
    if (taken && taken.id !== target.id) return json(request, { error: `${taken.name} is already someone's name.` }, 409);
    await rename(db, target.id, name);
    if (target.id !== me.person.id) await ping(db, env, { personId: target.id }, `Your name is now ${name}`);
    return json(request, { ok: true, name });
  }
  if (action === "remove") {
    if (target.id === me.person.id) return json(request, { error: "Hand over ownership first." }, 400);
    // Frees the name; their phones pick a name again next time they open.
    const theirs = await db.prepare("SELECT id FROM app_devices WHERE person_id = ?1").bind(target.id).all<{ id: string }>();
    const now = Date.now();
    await db.batch([
      ...(theirs.results ?? []).map((phone) =>
        db.prepare("INSERT OR REPLACE INTO app_reset_devices (id, created_at) VALUES (?1, ?2)").bind(phone.id, now)),
      db.prepare("DELETE FROM app_devices WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_name_requests WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_link_codes WHERE person_id = ?1").bind(target.id),
      db.prepare("DELETE FROM app_people WHERE id = ?1").bind(target.id),
    ]);
    return json(request, { ok: true });
  }
  if (action === "transfer") {
    if (target.id === me.person.id) return json(request, { error: "You're already the owner." }, 400);
    await db.batch([
      db.prepare("UPDATE app_people SET is_owner = 0 WHERE is_owner = 1"),
      db.prepare("UPDATE app_people SET is_owner = 1 WHERE id = ?1").bind(target.id),
    ]);
    await ping(db, env, { personId: target.id }, `${me.person.name.split(" ")[0]} made you the owner of Shiftdeck`);
    return json(request, { ok: true });
  }
  return json(request, { error: "Not found" }, 404);
}

/** Owner only: rename one phone, move it to another name, or take it off the app. */
async function deviceAction(request: Request, db: CalendarDatabase, env: PushEnvironment, action: string, body: Body, myDeviceId: string) {
  const id = typeof body.targetDeviceId === "string" && DEVICE.test(body.targetDeviceId) ? body.targetDeviceId : "";
  const phone = id
    ? await db.prepare("SELECT id, person_id, model, label, created_at, seen_at FROM app_devices WHERE id = ?1").bind(id).first<DeviceRow>()
    : null;
  if (!phone) return json(request, { error: "That phone isn't in the app anymore." }, 404);

  if (action === "device-rename") {
    const label = clean(body.label, 30);
    await db.prepare("UPDATE app_devices SET label = ?2 WHERE id = ?1").bind(phone.id, label || null).run();
    return json(request, { ok: true });
  }
  if (phone.id === myDeviceId) return json(request, { error: "That's the phone you're using. Do it from another phone." }, 400);
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
    if (to?.is_owner === 1) return json(request, { error: "Your phones are added with a code from Add another phone of mine." }, 400);
    if (!to) {
      const personId = newId();
      await db.prepare("INSERT INTO app_people (id, name, name_key, is_owner, created_at) VALUES (?1, ?2, ?3, 0, ?4)")
        .bind(personId, name, nameKey(name), Date.now()).run();
      to = await db.prepare("SELECT * FROM app_people WHERE id = ?1").bind(personId).first<Person>();
    }
    await db.prepare("UPDATE app_devices SET person_id = ?2 WHERE id = ?1").bind(phone.id, to!.id).run();
    await dropIfEmpty(db, phone.person_id);
    // Just that phone hears about it.
    const profile = await db.prepare("SELECT profile_id FROM app_devices WHERE id = ?1").bind(phone.id).first<{ profile_id: string | null }>();
    if (profile?.profile_id) {
      await sendProfilePush(db, env, profile.profile_id, { title: "Shiftdeck", body: `This phone is now set up as ${to!.name}`, tag: "names", path: "?notifications=1" }).catch(() => 0);
    }
    return json(request, { ok: true, name: to!.name });
  }
  return json(request, { error: "Not found" }, 404);
}

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
  if (action === "sync") return sync(request, db);
  if (action === "link-code") return linkCode(request, db);
  if (action === "link") return link(request, db);
  if (action === "name-request") return requestName(request, db, env);
  if (["decide", "withdraw", "rename", "remove", "transfer", "device-rename", "device-move", "device-remove"].includes(action)) return ownerAction(request, db, env, action);
  return json(request, { error: "Not found" }, 404);
}
