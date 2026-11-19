/**
 * Teams: coworkers who join from an invite link and get whatever a member
 * sends to the team (schedules, the directory, coworker contacts).
 *
 * What's sent is encrypted on the sender's phone with the team key, which
 * only travels in invite links' #fragment, and stored as a share (see
 * shares.ts). This keeps the team's name, members' first names, and each
 * post's sender and a short "what" line, so the bell can say
 * "David shared Nov 22 – 28". A post can go to everyone or to picked
 * members only; only they see it and get the push. A post can also be a
 * shift swap request sent to one teammate inside the app.
 *
 * Names are who's who: each name is on a team once, and only the team's
 * owner (whoever started it) can change or remove anyone. Members ask the
 * owner to change their name.
 */
import { corsHeaders, json, type CalendarDatabase } from "./calendar-service";
import { ownsNotificationProfile, sendProfilePush, type PushEnvironment } from "./push-service";

let schemaReady = false;

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      join_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      profile_id TEXT,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, member_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_posts (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      share_id TEXT NOT NULL,
      from_name TEXT NOT NULL,
      what TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS team_posts_team ON team_posts (team_id, created_at)"),
  ]);
  // Posts made before picking people existed went to everyone.
  await db.prepare("ALTER TABLE team_posts ADD COLUMN recipients TEXT").run().catch(() => undefined);
  // Names on members' schedules, so someone joining picks theirs from a list.
  await db.prepare("ALTER TABLE teams ADD COLUMN roster TEXT").run().catch(() => undefined);
  // Whoever started the team (older teams: the first member) runs it.
  await db.prepare("ALTER TABLE teams ADD COLUMN owner_id TEXT").run().catch(() => undefined);
  // What a post is: something shared (null) or a shift swap request ("swap").
  await db.prepare("ALTER TABLE team_posts ADD COLUMN kind TEXT").run().catch(() => undefined);
  await db.prepare(`CREATE TABLE IF NOT EXISTS team_name_requests (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`).run();
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

const ID = /^[A-Za-z0-9_-]{16,40}$/;
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";

type Body = Record<string, unknown>;

const ROSTER_LIMIT = 300;

/** A clean, sorted, de-duplicated list of names (at most a few hundred). */
function cleanRoster(...lists: unknown[]) {
  const seen = new Map<string, string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const name = clean(value, 40);
      const key = name.toLowerCase().replace(/[^a-z]/g, "");
      if (key.length >= 2 && !seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, ROSTER_LIMIT);
}

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

/** The member who runs the team. */
async function ownerOf(db: CalendarDatabase, team: { id: string; owner_id?: string | null }) {
  if (team.owner_id) return team.owner_id;
  const first = await db.prepare("SELECT member_id FROM team_members WHERE team_id = ?1 ORDER BY joined_at LIMIT 1")
    .bind(team.id).first<{ member_id: string }>();
  return first?.member_id ?? null;
}

/** Who already has this name on the team (other than `except`). */
async function nameTakenBy(db: CalendarDatabase, teamId: string, name: string, except?: string) {
  const rows = await db.prepare("SELECT member_id, name FROM team_members WHERE team_id = ?1")
    .bind(teamId).all<{ member_id: string; name: string }>();
  return (rows.results ?? []).find((row) => row.member_id !== except && nameKey(row.name) === nameKey(name)) ?? null;
}

const parseRoster = (value: string | null | undefined) => {
  try {
    return cleanRoster(JSON.parse(value ?? "[]"));
  } catch {
    return [];
  }
};

async function readBody(request: Request): Promise<Body | null> {
  try {
    const value = JSON.parse(await request.text());
    return value && typeof value === "object" ? value as Body : null;
  } catch {
    return null;
  }
}

/** The notification profile to ping, if the phone proved it owns one. */
async function ownedProfile(request: Request, db: CalendarDatabase, body: Body) {
  const profileId = typeof body.profileId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.profileId) ? body.profileId : "";
  const profileToken = typeof body.profileToken === "string" ? body.profileToken : "";
  if (!profileId || !profileToken) return null;
  const owns = await ownsNotificationProfile(
    new Request(request.url, { headers: { Authorization: `Bearer ${profileToken}` } }), db, profileId,
  );
  return owns ? profileId : null;
}

async function member(db: CalendarDatabase, teamId: string, body: Body) {
  const memberId = typeof body.memberId === "string" ? body.memberId : "";
  const token = typeof body.memberToken === "string" ? body.memberToken : "";
  if (!memberId || !token) return null;
  const row = await db
    .prepare("SELECT member_id, token_hash, name FROM team_members WHERE team_id = ?1 AND member_id = ?2")
    .bind(teamId, memberId)
    .first<{ member_id: string; token_hash: string; name: string }>();
  return row && row.token_hash === await sha256(token) ? row : null;
}

async function addMember(request: Request, db: CalendarDatabase, teamId: string, body: Body) {
  const memberId = newId(12);
  const memberToken = newId(24);
  const name = clean(body.name, 40) || "A coworker";
  await db.prepare(`INSERT INTO team_members (team_id, member_id, token_hash, name, profile_id, joined_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(teamId, memberId, await sha256(memberToken), name, await ownedProfile(request, db, body), Date.now())
    .run();
  return { memberId, memberToken };
}

async function createTeam(request: Request, db: CalendarDatabase) {
  const body = await readBody(request);
  const joinSecret = typeof body?.joinSecret === "string" ? body.joinSecret : "";
  if (!body || joinSecret.length < 16) return json(request, { error: "Invalid team" }, 400);
  const id = newId();
  const name = clean(body.teamName, 40) || "My team";
  await db.prepare("INSERT INTO teams (id, name, join_hash, created_at, roster) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, name, await sha256(joinSecret), Date.now(), JSON.stringify(cleanRoster(body.roster)))
    .run();
  const owner = await addMember(request, db, id, body);
  await db.prepare("UPDATE teams SET owner_id = ?2 WHERE id = ?1").bind(id, owner.memberId).run();
  return json(request, { id, name, ...owner, ownerId: owner.memberId }, 201);
}

async function teamFor(db: CalendarDatabase, id: string) {
  return db.prepare("SELECT id, name, join_hash, roster, owner_id FROM teams WHERE id = ?1").bind(id)
    .first<{ id: string; name: string; join_hash: string; roster: string | null; owner_id: string | null }>();
}

async function people(db: CalendarDatabase, teamId: string) {
  const rows = await db.prepare("SELECT member_id, name, profile_id FROM team_members WHERE team_id = ?1 ORDER BY joined_at")
    .bind(teamId).all<{ member_id: string; name: string; profile_id: string | null }>();
  return rows.results ?? [];
}

async function names(db: CalendarDatabase, teamId: string) {
  return (await people(db, teamId)).map((row) => row.name);
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

/** For an invite link: the team's name and who's in it (needs the join secret). */
async function preview(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  if (!team || typeof body?.joinSecret !== "string" || team.join_hash !== await sha256(body.joinSecret)) {
    return json(request, { error: "This invite link doesn't work anymore." }, 404);
  }
  return json(request, { name: team.name, members: await names(db, teamId), roster: parseRoster(team.roster) });
}

async function join(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  if (!body || !team || typeof body.joinSecret !== "string" || team.join_hash !== await sha256(body.joinSecret)) {
    return json(request, { error: "This invite link doesn't work anymore." }, 404);
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM team_members WHERE team_id = ?1").bind(teamId).first<{ count: number }>();
  if ((count?.count ?? 0) >= 200) return json(request, { error: "This team is full." }, 409);
  // Each name is on the team once; only the owner can sort out a mix-up.
  const wanted = clean(body.name, 40);
  if (wanted && await nameTakenBy(db, teamId, wanted)) {
    const ownerId = await ownerOf(db, team);
    const owner = ownerId
      ? await db.prepare("SELECT name FROM team_members WHERE team_id = ?1 AND member_id = ?2").bind(teamId, ownerId).first<{ name: string }>()
      : null;
    return json(request, {
      error: `${wanted} is already on ${team.name}. If that's you, ask ${owner?.name.split(" ")[0] ?? "the team owner"} to sort it out.`,
    }, 409);
  }
  const ownerId = await ownerOf(db, team);
  return json(request, { id: team.id, name: team.name, ownerId, ...(await addMember(request, db, teamId, body)) }, 201);
}

/** A member's view: the team, who's in it, and recent posts. Also links their notifications. */
async function state(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  const me = body && team ? await member(db, teamId, body) : null;
  if (!team || !me || !body) return json(request, { error: "You're not on this team anymore." }, 403);
  // Members' phones add the names on their schedules to the team's list.
  if (Array.isArray(body.roster) && body.roster.length) {
    const current = parseRoster(team.roster);
    const merged = cleanRoster(current, body.roster);
    if (merged.length !== current.length) {
      await db.prepare("UPDATE teams SET roster = ?2 WHERE id = ?1").bind(teamId, JSON.stringify(merged)).run();
    }
  }
  const profile = await ownedProfile(request, db, body);
  if (profile) {
    await db.prepare("UPDATE team_members SET profile_id = ?3 WHERE team_id = ?1 AND member_id = ?2")
      .bind(teamId, me.member_id, profile).run();
  }
  const posts = await db.prepare(`SELECT id, member_id, share_id, from_name, what, created_at, expires_at, recipients FROM team_posts
    WHERE team_id = ?1 AND expires_at > ?2 ORDER BY created_at DESC LIMIT 60`)
    .bind(teamId, Date.now())
    .all<{ id: string; member_id: string; share_id: string; from_name: string; what: string; created_at: number; expires_at: number; recipients: string | null }>();
  const everyone = await people(db, teamId);
  const nameOf = new Map(everyone.map((row) => [row.member_id, row.name]));
  const ownerId = await ownerOf(db, team);
  const requests = await db.prepare("SELECT id, member_id, name, created_at FROM team_name_requests WHERE team_id = ?1 ORDER BY created_at")
    .bind(teamId).all<{ id: string; member_id: string; name: string; created_at: number }>();
  const pending = (requests.results ?? []).filter((row) => nameOf.has(row.member_id));
  const kinds = await db.prepare("SELECT id, kind FROM team_posts WHERE team_id = ?1 AND kind IS NOT NULL")
    .bind(teamId).all<{ id: string; kind: string }>();
  const kindOf = new Map((kinds.results ?? []).map((row) => [row.id, row.kind]));
  return json(request, {
    name: team.name,
    me: me.member_id,
    myName: me.name,
    owner: ownerId,
    roster: parseRoster(team.roster),
    // The owner sees everyone's name-change requests; a member sees their own.
    requests: (me.member_id === ownerId ? pending : pending.filter((row) => row.member_id === me.member_id)).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      from: nameOf.get(row.member_id) ?? "",
      name: row.name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    members: everyone.map((row) => row.name),
    people: everyone.map((row) => ({ id: row.member_id, name: row.name })),
    posts: (posts.results ?? []).flatMap((post) => {
      const recipients = recipientsOf(post.recipients);
      const mine = post.member_id === me.member_id;
      // Picked people only: everyone else never sees it.
      if (recipients && !mine && !recipients.includes(me.member_id)) return [];
      return [{
        id: post.id,
        kind: kindOf.get(post.id) ?? "share",
        shareId: post.share_id,
        from: post.from_name,
        what: post.what,
        mine,
        direct: Boolean(recipients),
        to: recipients && mine ? recipients.map((id) => nameOf.get(id) ?? "Someone who left") : undefined,
        createdAt: new Date(post.created_at).toISOString(),
        expiresAt: new Date(post.expires_at).toISOString(),
      }];
    }).slice(0, 30),
  });
}

async function post(request: Request, db: CalendarDatabase, env: PushEnvironment, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  const me = body && team ? await member(db, teamId, body) : null;
  if (!team || !me || !body) return json(request, { error: "You're not on this team anymore." }, 403);
  const swap = body.kind === "swap";
  const shareId = typeof body.shareId === "string" && ID.test(body.shareId) ? body.shareId : "";
  // A swap request points at the swap (which keeps its own expiry); anything else at a share.
  const share = !shareId
    ? null
    : swap
      ? await db.prepare("SELECT expires_at FROM swap_requests WHERE id = ?1").bind(shareId).first<{ expires_at: string }>()
        .then((row) => row && { expires_at: Date.parse(row.expires_at) })
        .catch(() => null)
      : await db.prepare("SELECT expires_at FROM shares WHERE id = ?1").bind(shareId).first<{ expires_at: number }>();
  if (!share) return json(request, { error: "Nothing to send" }, 400);
  const what = swap ? "a shift swap" : clean(body.what, 120) || "an update";
  const everyone = await people(db, teamId);
  // To picked teammates only, or (no list, or nobody valid picked) everyone.
  const picked = Array.isArray(body.to)
    ? [...new Set(body.to.filter((id): id is string => typeof id === "string"))]
      .filter((id) => id !== me.member_id && everyone.some((row) => row.member_id === id))
    : [];
  const recipients = picked.length ? picked : null;
  if (swap && recipients?.length !== 1) return json(request, { error: "A swap goes to one teammate." }, 400);
  const id = newId();
  await db.prepare(`INSERT INTO team_posts (id, team_id, member_id, share_id, from_name, what, created_at, expires_at, recipients, kind)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(id, teamId, me.member_id, shareId, me.name, what, Date.now(), share.expires_at,
      recipients ? JSON.stringify(recipients) : null, swap ? "swap" : null)
    .run();
  const profiles = new Set(everyone
    .filter((row) => row.member_id !== me.member_id && row.profile_id && (!recipients || recipients.includes(row.member_id)))
    .map((row) => row.profile_id!));
  const first = me.name.split(" ")[0];
  let notified = 0;
  for (const profileId of profiles) {
    notified += await sendProfilePush(db, env, profileId, {
      title: team.name,
      body: swap ? `${first} wants to swap shifts` : recipients ? `${first} sent you ${what}` : `${first} shared ${what}`,
      tag: `team-${id}`,
      path: "?notifications=1",
    }).catch(() => 0);
  }
  return json(request, { id, notified, to: recipients?.length ?? null }, 201);
}

/** Tells one member something (if they have notifications on). */
async function ping(db: CalendarDatabase, env: PushEnvironment, teamId: string, memberId: string, title: string, body: string) {
  const row = await db.prepare("SELECT profile_id FROM team_members WHERE team_id = ?1 AND member_id = ?2")
    .bind(teamId, memberId).first<{ profile_id: string | null }>();
  if (row?.profile_id) {
    await sendProfilePush(db, env, row.profile_id, { title, body, tag: `team-name-${memberId}`, path: "?notifications=1" }).catch(() => 0);
  }
}

async function setName(db: CalendarDatabase, teamId: string, memberId: string, name: string) {
  await db.prepare("UPDATE team_members SET name = ?3 WHERE team_id = ?1 AND member_id = ?2").bind(teamId, memberId, name).run();
  await db.prepare("DELETE FROM team_name_requests WHERE team_id = ?1 AND member_id = ?2").bind(teamId, memberId).run();
}

/** Owner only: rename anyone (including themselves), or remove someone. */
async function manage(request: Request, db: CalendarDatabase, env: PushEnvironment, teamId: string, action: "rename" | "remove") {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  const me = body && team ? await member(db, teamId, body) : null;
  if (!team || !me || !body) return json(request, { error: "You're not on this team anymore." }, 403);
  if (await ownerOf(db, team) !== me.member_id) return json(request, { error: "Only the team's owner can do that." }, 403);
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const target = await db.prepare("SELECT member_id, name FROM team_members WHERE team_id = ?1 AND member_id = ?2")
    .bind(teamId, targetId).first<{ member_id: string; name: string }>();
  if (!target) return json(request, { error: "They're not on the team anymore." }, 404);
  if (action === "remove") {
    if (target.member_id === me.member_id) return json(request, { error: "You run the team, so you can't remove yourself." }, 400);
    await db.prepare("DELETE FROM team_members WHERE team_id = ?1 AND member_id = ?2").bind(teamId, target.member_id).run();
    await db.prepare("DELETE FROM team_name_requests WHERE team_id = ?1 AND member_id = ?2").bind(teamId, target.member_id).run();
    return json(request, { ok: true });
  }
  const name = clean(body.name, 40);
  if (!name) return json(request, { error: "Pick a name." }, 400);
  const taken = await nameTakenBy(db, teamId, name, target.member_id);
  if (taken) return json(request, { error: `${taken.name} is already on the team.` }, 409);
  await setName(db, teamId, target.member_id, name);
  if (target.member_id !== me.member_id) {
    await ping(db, env, teamId, target.member_id, team.name, `Your name is now ${name}`);
  }
  return json(request, { ok: true, name });
}

/** A member asks the owner to change their name. */
async function requestName(request: Request, db: CalendarDatabase, env: PushEnvironment, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  const me = body && team ? await member(db, teamId, body) : null;
  if (!team || !me || !body) return json(request, { error: "You're not on this team anymore." }, 403);
  const name = clean(body.name, 40);
  if (!name || nameKey(name) === nameKey(me.name)) return json(request, { error: "Pick a different name." }, 400);
  const taken = await nameTakenBy(db, teamId, name, me.member_id);
  if (taken) return json(request, { error: `${taken.name} is already on the team.` }, 409);
  const ownerId = await ownerOf(db, team);
  if (ownerId === me.member_id) {
    await setName(db, teamId, me.member_id, name);
    return json(request, { ok: true, name });
  }
  await db.prepare("DELETE FROM team_name_requests WHERE team_id = ?1 AND member_id = ?2").bind(teamId, me.member_id).run();
  await db.prepare("INSERT INTO team_name_requests (id, team_id, member_id, name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(newId(), teamId, me.member_id, name, Date.now()).run();
  if (ownerId) await ping(db, env, teamId, ownerId, team.name, `${me.name.split(" ")[0]} asks to change their name to ${name}`);
  return json(request, { ok: true, pending: true });
}

/** The owner approves or turns down a name change. */
async function decide(request: Request, db: CalendarDatabase, env: PushEnvironment, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  const me = body && team ? await member(db, teamId, body) : null;
  if (!team || !me || !body) return json(request, { error: "You're not on this team anymore." }, 403);
  const row = typeof body.requestId === "string"
    ? await db.prepare("SELECT id, member_id, name FROM team_name_requests WHERE team_id = ?1 AND id = ?2")
      .bind(teamId, body.requestId).first<{ id: string; member_id: string; name: string }>()
    : null;
  if (!row) return json(request, { error: "That request is gone." }, 404);
  const ownerId = await ownerOf(db, team);
  // The owner decides; a member can only take back their own request.
  if (ownerId !== me.member_id && !(row.member_id === me.member_id && body.approve !== true)) {
    return json(request, { error: "Only the team's owner can do that." }, 403);
  }
  if (body.approve === true) {
    const taken = await nameTakenBy(db, teamId, row.name, row.member_id);
    if (taken) return json(request, { error: `${taken.name} is already on the team.` }, 409);
    await setName(db, teamId, row.member_id, row.name);
    await ping(db, env, teamId, row.member_id, team.name, `Your name is now ${row.name}`);
  } else {
    await db.prepare("DELETE FROM team_name_requests WHERE id = ?1").bind(row.id).run();
    if (row.member_id !== me.member_id) await ping(db, env, teamId, row.member_id, team.name, "Your name change wasn't approved");
  }
  return json(request, { ok: true });
}

async function leave(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const me = body ? await member(db, teamId, body) : null;
  if (me) {
    const team = await teamFor(db, teamId);
    const wasOwner = team ? await ownerOf(db, team) === me.member_id : false;
    await db.prepare("DELETE FROM team_members WHERE team_id = ?1 AND member_id = ?2").bind(teamId, me.member_id).run();
    await db.prepare("DELETE FROM team_name_requests WHERE team_id = ?1 AND member_id = ?2").bind(teamId, me.member_id).run();
    // The owner leaving hands the team to whoever's been on it longest.
    if (wasOwner) {
      const next = await db.prepare("SELECT member_id FROM team_members WHERE team_id = ?1 ORDER BY joined_at LIMIT 1")
        .bind(teamId).first<{ member_id: string }>();
      await db.prepare("UPDATE teams SET owner_id = ?2 WHERE id = ?1").bind(teamId, next?.member_id ?? null).run();
    }
  }
  return json(request, { ok: true });
}

export async function handleTeamRequest(request: Request, db: CalendarDatabase | undefined, env: PushEnvironment) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/teams")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) as Record<string, string> });
  }
  if (!db) return json(request, { error: "Team storage unavailable" }, 503);
  if (request.method !== "POST") return json(request, { error: "Not found" }, 404);
  await ensureSchema(db);
  if (url.pathname === "/api/teams") return createTeam(request, db);
  const match = url.pathname.match(/^\/api\/teams\/([A-Za-z0-9_-]{16,40})\/(preview|join|state|posts|leave|rename|remove|name-request|decide)$/);
  if (!match) return json(request, { error: "Not found" }, 404);
  const [, teamId, action] = match;
  if (action === "preview") return preview(request, db, teamId);
  if (action === "join") return join(request, db, teamId);
  if (action === "state") return state(request, db, teamId);
  if (action === "posts") return post(request, db, env, teamId);
  if (action === "rename" || action === "remove") return manage(request, db, env, teamId, action);
  if (action === "name-request") return requestName(request, db, env, teamId);
  if (action === "decide") return decide(request, db, env, teamId);
  return leave(request, db, teamId);
}

/** Posts go when their share does. */
export async function deleteExpiredTeamPosts(db: CalendarDatabase, at = Date.now()) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM team_posts WHERE expires_at < ?1").bind(at).run();
}
