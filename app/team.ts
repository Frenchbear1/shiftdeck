/**
 * Your team: coworkers who joined from an invite link. Anything sent to the
 * team is encrypted with the team key, which only ever travels inside
 * invite links' #fragment and lives on members' phones.
 */
import type { SharePackage } from "./share-data.ts";
import { randomKey, uploadShare } from "./share-link.ts";

export type Team = {
  id: string;
  name: string;
  /** Encrypts what's sent to the team. */
  key: string;
  /** Lets anyone with the invite link join. */
  joinSecret: string;
  memberId: string;
  memberToken: string;
  members?: string[];
  /** Everyone on the team (including you), for picking who gets something. */
  people?: TeamPerson[];
  /** The member who runs the team (renames and removes people). */
  ownerId?: string;
  /** Names on members' schedules. */
  roster?: string[];
};

/** A name change waiting on the owner. */
export type NameRequest = { id: string; memberId: string; from: string; name: string; createdAt: string };

export type TeamPerson = { id: string; name: string };

export type TeamPost = {
  id: string;
  /** "share" (schedules, directory, contacts) or "swap" (a swap request; shareId is the swap's id). */
  kind?: "share" | "swap";
  shareId: string;
  from: string;
  what: string;
  mine: boolean;
  /** Sent to picked people, not the whole team. */
  direct?: boolean;
  /** Who you sent it to (your own direct posts). */
  to?: string[];
  createdAt: string;
  expiresAt: string;
};

export type TeamInvite = { id: string; key: string; joinSecret: string };
type Profile = { id: string; writeToken: string } | null | undefined;

export const TEAM_KEY = "shiftdeck.team";
export const TEAM_SEEN_KEY = "shiftdeck.teamSeen";

export function loadTeam(): Team | null {
  try {
    const team = JSON.parse(localStorage.getItem(TEAM_KEY) ?? "null");
    return team?.id && team?.key && team?.memberToken ? team as Team : null;
  } catch {
    return null;
  }
}

export function saveTeam(team: Team | null) {
  try {
    if (team) localStorage.setItem(TEAM_KEY, JSON.stringify(team));
    else localStorage.removeItem(TEAM_KEY);
  } catch {
    // Storage full or blocked: the team lasts until the app closes.
  }
}

export function loadSeenPosts(): string[] {
  try {
    const seen = JSON.parse(localStorage.getItem(TEAM_SEEN_KEY) ?? "[]");
    return Array.isArray(seen) ? seen.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveSeenPosts(ids: string[]) {
  try {
    localStorage.setItem(TEAM_SEEN_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Not worth failing over.
  }
}

export function inviteLink(team: Team, appUrl: string) {
  const url = new URL(appUrl);
  url.search = "";
  url.searchParams.set("team", team.id);
  url.hash = `t=${team.key}&j=${team.joinSecret}`;
  return url.href;
}

export function teamInLocation(location: { search: string; hash: string }): TeamInvite | null {
  const id = new URLSearchParams(location.search).get("team");
  const fragment = new URLSearchParams(location.hash.slice(1));
  const key = fragment.get("t");
  const joinSecret = fragment.get("j");
  return id && key && joinSecret && /^[A-Za-z0-9_-]{16,40}$/.test(id) ? { id, key, joinSecret } : null;
}

export function teamInText(text: string): TeamInvite | null {
  for (const match of text.match(/https?:\/\/\S+/g) ?? []) {
    try {
      const found = teamInLocation(new URL(match.replace(/[).,]+$/, "")));
      if (found) return found;
    } catch {
      // Not a link.
    }
  }
  return null;
}

async function call<T>(service: string, path: string, body: object): Promise<T> {
  // text/plain keeps these "simple" requests (no CORS preflight).
  const response = await fetch(`${service}${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(result.error ?? "Couldn’t reach the team. Check your connection."), { status: response.status });
  return result;
}

const profileFields = (profile: Profile) => profile ? { profileId: profile.id, profileToken: profile.writeToken } : {};

export async function createTeam(
  service: string,
  { teamName, name, profile, roster }: { teamName: string; name: string; profile?: Profile; roster?: string[] },
): Promise<Team> {
  const key = randomKey();
  const joinSecret = randomKey(18);
  const result = await call<{ id: string; name: string; memberId: string; memberToken: string }>(service, "/api/teams", {
    teamName, name, joinSecret, roster, ...profileFields(profile),
  });
  return {
    id: result.id, name: result.name, key, joinSecret, memberId: result.memberId, memberToken: result.memberToken,
    members: [name], ownerId: result.memberId,
  };
}

/** The team's name, who's on it, and the names on its schedules (to pick yours from). */
export const previewTeam = (service: string, invite: TeamInvite) =>
  call<{ name: string; members: string[]; roster?: string[] }>(service, `/api/teams/${invite.id}/preview`, { joinSecret: invite.joinSecret });

export async function joinTeam(service: string, invite: TeamInvite, { name, profile }: { name: string; profile?: Profile }): Promise<Team> {
  const result = await call<{ id: string; name: string; memberId: string; memberToken: string; ownerId?: string }>(service, `/api/teams/${invite.id}/join`, {
    joinSecret: invite.joinSecret, name, ...profileFields(profile),
  });
  return {
    id: result.id, name: result.name, key: invite.key, joinSecret: invite.joinSecret,
    memberId: result.memberId, memberToken: result.memberToken, ownerId: result.ownerId,
  };
}

/** Also adds the names on this phone's schedules to the team's list (`roster`). */
export const teamState = (service: string, team: Team, profile?: Profile, roster?: string[]) =>
  call<{
    name: string;
    me?: string;
    /** Your name on the team; it's what this phone's name is locked to. */
    myName?: string;
    owner?: string | null;
    roster?: string[];
    requests?: NameRequest[];
    members: string[];
    people?: TeamPerson[];
    posts: TeamPost[];
  }>(service, `/api/teams/${team.id}/state`, {
    memberId: team.memberId, memberToken: team.memberToken, ...(roster?.length ? { roster } : {}), ...profileFields(profile),
  });

/**
 * Encrypts with the team key, uploads, and tells the team, or only the
 * picked teammates (`to`: member ids). Those with notifications on get a push.
 */
export async function postToTeam(service: string, team: Team, share: SharePackage, what: string, to?: string[]) {
  const { id: shareId } = await uploadShare(share, { service, days: 7, key: team.key });
  return call<{ id: string; notified: number }>(service, `/api/teams/${team.id}/posts`, {
    memberId: team.memberId, memberToken: team.memberToken, shareId, what, ...(to?.length ? { to } : {}),
  });
}

/** Sends a swap request to one teammate inside the app (the swap is registered first). */
export const postSwapToTeam = (service: string, team: Team, swapId: string, to: string) =>
  call<{ id: string; notified: number }>(service, `/api/teams/${team.id}/posts`, {
    memberId: team.memberId, memberToken: team.memberToken, kind: "swap", shareId: swapId, to: [to],
  });

const auth = (team: Team) => ({ memberId: team.memberId, memberToken: team.memberToken });

/** Owner: change anyone's name (yours included). */
export const renameMember = (service: string, team: Team, targetId: string, name: string) =>
  call<{ ok: boolean; name: string }>(service, `/api/teams/${team.id}/rename`, { ...auth(team), targetId, name });

/** Owner: take someone off the team. */
export const removeMember = (service: string, team: Team, targetId: string) =>
  call<{ ok: boolean }>(service, `/api/teams/${team.id}/remove`, { ...auth(team), targetId });

/** Ask the owner to change your name (the owner's own change goes straight through). */
export const requestNameChange = (service: string, team: Team, name: string) =>
  call<{ ok: boolean; pending?: boolean; name?: string }>(service, `/api/teams/${team.id}/name-request`, { ...auth(team), name });

/** Owner: approve or turn down a name change (a member can withdraw their own). */
export const decideNameRequest = (service: string, team: Team, requestId: string, approve: boolean) =>
  call<{ ok: boolean }>(service, `/api/teams/${team.id}/decide`, { ...auth(team), requestId, approve });

export const isOwner = (team: Team | null) => Boolean(team && team.ownerId && team.ownerId === team.memberId);

/** Teammates other than you. */
export const teammates = (team: Team | null) =>
  (team?.people ?? []).filter((person) => person.id !== team?.memberId);

export const leaveTeam = (service: string, team: Team) =>
  call<{ ok: boolean }>(service, `/api/teams/${team.id}/leave`, { memberId: team.memberId, memberToken: team.memberToken });
