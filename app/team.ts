/**
 * The team is everyone who uses Shiftdeck. Anything sent to it is encrypted
 * on the phone with the team key (see team-key.ts), which the server never
 * sees; the post itself (who sent what, to whom) goes through people.ts.
 */
import type { SharePackage } from "./share-data.ts";
import { uploadShare } from "./share-link.ts";
import { sendPost } from "./people.ts";

export type TeamPerson = { id: string; name: string };

/** You and everyone you can send things to. */
export type Team = {
  /** How the team is named in the app ("Send … to everyone?"). */
  name: string;
  /** Encrypts what's sent. */
  key: string;
  /** You (your person id). */
  memberId: string;
  people: TeamPerson[];
  ownerId?: string;
  /** Names on everyone's schedules. */
  roster?: string[];
};

export type TeamPost = {
  id: string;
  /** "share" (schedules, directory, contacts) or "swap" (a swap request; shareId is the swap's id). */
  kind?: "share" | "swap";
  shareId: string;
  from: string;
  what: string;
  mine: boolean;
  /** Sent to picked people, not everyone. */
  direct?: boolean;
  /** Who you sent it to (your own direct posts). */
  to?: string[];
  /** How many times something was added to it since it was sent (each time it's new again). */
  rev?: number;
  createdAt: string;
  expiresAt: string;
};

/** What "seen" is kept under: a post that had something added is new again. */
export const postSeenKey = (post: Pick<TeamPost, "id" | "rev">) => (post.rev ? `${post.id}#${post.rev}` : post.id);

/** What teams used to be stored as (before the app was one team): its key can become the team key. */
const LEGACY_TEAM_KEY = "shiftdeck.team";
export const TEAM_SEEN_KEY = "shiftdeck.teamSeen";

export function legacyTeamKey(): string | null {
  try {
    const team = JSON.parse(localStorage.getItem(LEGACY_TEAM_KEY) ?? "null");
    return typeof team?.key === "string" ? team.key : null;
  } catch {
    return null;
  }
}

export function forgetLegacyTeam() {
  try {
    localStorage.removeItem(LEGACY_TEAM_KEY);
  } catch {
    // Not worth failing over.
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

/**
 * Encrypts with the team key, uploads, and tells everyone, or only the
 * picked people (`to`: person ids). Those with notifications on get a push.
 */
export async function postToTeam(service: string, team: Team, share: SharePackage, what: string, to?: string[], amend?: string) {
  const { id: shareId } = await uploadShare(share, { service, days: 7, key: team.key });
  return sendPost(service, { shareId, what, ...(to?.length ? { to } : {}), ...(amend ? { amend } : {}) });
}

/** Sends a swap request to one person inside the app (the swap is registered first). */
export const postSwapToTeam = (service: string, swapId: string, to: string) =>
  sendPost(service, { kind: "swap", shareId: swapId, to: [to] });

export const isOwner = (team: Team | null) => Boolean(team && team.ownerId && team.ownerId === team.memberId);

/** Everyone other than you. */
export const teammates = (team: Team | null) =>
  (team?.people ?? []).filter((person) => person.id !== team?.memberId);
