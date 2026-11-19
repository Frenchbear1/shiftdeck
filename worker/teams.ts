/**
 * Teams: coworkers who join from an invite link and get whatever a member
 * sends to the team (schedules, the directory, coworker contacts).
 *
 * What's sent is encrypted on the sender's phone with the team key, which
 * only travels in invite links' #fragment, and stored as a share (see
 * shares.ts). This keeps the team's name, members' first names, and each
 * post's sender and a short "what" line, so the bell can say
 * "David shared Nov 22 – 28". Members with notifications on get a push.
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
  await db.prepare("INSERT INTO teams (id, name, join_hash, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, name, await sha256(joinSecret), Date.now())
    .run();
  return json(request, { id, name, ...(await addMember(request, db, id, body)) }, 201);
}

async function teamFor(db: CalendarDatabase, id: string) {
  return db.prepare("SELECT id, name, join_hash FROM teams WHERE id = ?1").bind(id).first<{ id: string; name: string; join_hash: string }>();
}

async function names(db: CalendarDatabase, teamId: string) {
  const rows = await db.prepare("SELECT name FROM team_members WHERE team_id = ?1 ORDER BY joined_at")
    .bind(teamId).all<{ name: string }>();
  return (rows.results ?? []).map((row) => row.name);
}

/** For an invite link: the team's name and who's in it (needs the join secret). */
async function preview(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  if (!team || typeof body?.joinSecret !== "string" || team.join_hash !== await sha256(body.joinSecret)) {
    return json(request, { error: "This invite link doesn't work anymore." }, 404);
  }
  return json(request, { name: team.name, members: await names(db, teamId) });
}

async function join(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  if (!body || !team || typeof body.joinSecret !== "string" || team.join_hash !== await sha256(body.joinSecret)) {
    return json(request, { error: "This invite link doesn't work anymore." }, 404);
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM team_members WHERE team_id = ?1").bind(teamId).first<{ count: number }>();
  if ((count?.count ?? 0) >= 200) return json(request, { error: "This team is full." }, 409);
  return json(request, { id: team.id, name: team.name, ...(await addMember(request, db, teamId, body)) }, 201);
}

/** A member's view: the team, who's in it, and recent posts. Also links their notifications. */
async function state(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  const me = body && team ? await member(db, teamId, body) : null;
  if (!team || !me || !body) return json(request, { error: "You're not on this team anymore." }, 403);
  const profile = await ownedProfile(request, db, body);
  if (profile) {
    await db.prepare("UPDATE team_members SET profile_id = ?3 WHERE team_id = ?1 AND member_id = ?2")
      .bind(teamId, me.member_id, profile).run();
  }
  const posts = await db.prepare(`SELECT id, member_id, share_id, from_name, what, created_at, expires_at FROM team_posts
    WHERE team_id = ?1 AND expires_at > ?2 ORDER BY created_at DESC LIMIT 30`)
    .bind(teamId, Date.now())
    .all<{ id: string; member_id: string; share_id: string; from_name: string; what: string; created_at: number; expires_at: number }>();
  return json(request, {
    name: team.name,
    members: await names(db, teamId),
    posts: (posts.results ?? []).map((post) => ({
      id: post.id,
      shareId: post.share_id,
      from: post.from_name,
      what: post.what,
      mine: post.member_id === me.member_id,
      createdAt: new Date(post.created_at).toISOString(),
      expiresAt: new Date(post.expires_at).toISOString(),
    })),
  });
}

async function post(request: Request, db: CalendarDatabase, env: PushEnvironment, teamId: string) {
  const body = await readBody(request);
  const team = await teamFor(db, teamId);
  const me = body && team ? await member(db, teamId, body) : null;
  if (!team || !me || !body) return json(request, { error: "You're not on this team anymore." }, 403);
  const shareId = typeof body.shareId === "string" && ID.test(body.shareId) ? body.shareId : "";
  const share = shareId
    ? await db.prepare("SELECT expires_at FROM shares WHERE id = ?1").bind(shareId).first<{ expires_at: number }>()
    : null;
  if (!share) return json(request, { error: "Nothing to send" }, 400);
  const what = clean(body.what, 120) || "an update";
  const id = newId();
  await db.prepare(`INSERT INTO team_posts (id, team_id, member_id, share_id, from_name, what, created_at, expires_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id, teamId, me.member_id, shareId, me.name, what, Date.now(), share.expires_at)
    .run();
  const others = await db.prepare(`SELECT DISTINCT profile_id FROM team_members
    WHERE team_id = ?1 AND member_id != ?2 AND profile_id IS NOT NULL`)
    .bind(teamId, me.member_id)
    .all<{ profile_id: string }>();
  let notified = 0;
  for (const { profile_id: profileId } of others.results ?? []) {
    notified += await sendProfilePush(db, env, profileId, {
      title: team.name,
      body: `${me.name.split(" ")[0]} shared ${what}`,
      tag: `team-${id}`,
      path: "?notifications=1",
    }).catch(() => 0);
  }
  return json(request, { id, notified }, 201);
}

async function leave(request: Request, db: CalendarDatabase, teamId: string) {
  const body = await readBody(request);
  const me = body ? await member(db, teamId, body) : null;
  if (me) {
    await db.prepare("DELETE FROM team_members WHERE team_id = ?1 AND member_id = ?2").bind(teamId, me.member_id).run();
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
  const match = url.pathname.match(/^\/api\/teams\/([A-Za-z0-9_-]{16,40})\/(preview|join|state|posts|leave)$/);
  if (!match) return json(request, { error: "Not found" }, 404);
  const [, teamId, action] = match;
  if (action === "preview") return preview(request, db, teamId);
  if (action === "join") return join(request, db, teamId);
  if (action === "state") return state(request, db, teamId);
  if (action === "posts") return post(request, db, env, teamId);
  return leave(request, db, teamId);
}

/** Posts go when their share does. */
export async function deleteExpiredTeamPosts(db: CalendarDatabase, at = Date.now()) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM team_posts WHERE expires_at < ?1").bind(at).run();
}
