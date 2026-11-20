/**
 * Your schedules on all your phones. A schedule imported on one phone is
 * encrypted with the team key and posted to your own phones only (no
 * notification); your other phones import it quietly, with what the first
 * phone read, so nothing is scanned or imported twice.
 */
import { buildShare, type ShareableDocument } from "./share-build.ts";
import { uploadShare } from "./share-link.ts";
import { sendPost, type SelfPost } from "./people.ts";

const APPLIED_KEY = "shiftdeck.selfSynced";
/** Schedules older than this aren't sent to a new phone (two weeks of history covers who's left). */
export const SYNC_BACK_DAYS = 28;
/** A post's photos stay this long; a phone that hasn't checked in by then misses them. */
export const SYNC_DAYS = 30;
/** Photos per post (each share is capped at 30 MB). */
const PER_POST = 5;

/** Posts this phone made or already picked up. */
export function loadApplied(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(APPLIED_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveApplied(ids: string[]) {
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify([...new Set(ids)].slice(-200)));
  } catch {
    // Picked up again next time (and skipped: the schedules are already here).
  }
}

/** Hashes with when they were noted, kept on this device for as long as a post lasts. */
function noted(key: string): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    const since = Date.now() - SYNC_DAYS * 86_400_000;
    return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && entry[1] > since));
  } catch {
    return {};
  }
}
function note(key: string, ids: string[]) {
  if (!ids.length) return;
  const now = Date.now();
  try {
    localStorage.setItem(key, JSON.stringify({ ...noted(key), ...Object.fromEntries(ids.map((id) => [id, now])) }));
  } catch {
    // Only this visit remembers.
  }
}
const SENT_KEY = "shiftdeck.selfSent";
const UNSENDABLE_KEY = "shiftdeck.selfUnsendable";
const FAILED_KEY = "shiftdeck.selfFailed";
/** Schedules this device sent to your others. */
export const loadSent = () => new Set(Object.keys(noted(SENT_KEY)));
export const rememberSent = (hashes: string[]) => note(SENT_KEY, hashes);
/** Schedules whose photo isn't on this device anymore (nothing to send). */
export const loadUnsendable = () => new Set(Object.keys(noted(UNSENDABLE_KEY)));
export const rememberUnsendable = (hashes: string[]) => note(UNSENDABLE_KEY, hashes);
/** A post that couldn't be picked up is tried this many times, then left. */
export const POST_TRIES = 3;
export function failedTries(postId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(FAILED_KEY) ?? "{}") as Record<string, number>;
    return Number(saved[postId]) || 0;
  } catch {
    return 0;
  }
}
export function noteFailure(postId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(FAILED_KEY) ?? "{}") as Record<string, number>;
    const next = { ...saved, [postId]: (Number(saved[postId]) || 0) + 1 };
    localStorage.setItem(FAILED_KEY, JSON.stringify(Object.fromEntries(Object.entries(next).slice(-100))));
  } catch {
    // Tried again next time.
  }
}

type SyncDocument = ShareableDocument & { updatedAt?: string };

/**
 * Schedules on this phone your other phones don't have yet: recent ones not in
 * any post, not already sent from here (`alsoSent`: kept on this device, so a
 * missed check-in never sends one twice).
 */
export function toSend(documents: SyncDocument[], posts: SelfPost[], today: string, alsoSent: Iterable<string> = []) {
  const posted = new Set([...posts.flatMap((post) => post.hashes), ...alsoSent]);
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - SYNC_BACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  return documents.filter((document) =>
    !posted.has(document.hash) && document.dates.some((date) => date >= since));
}

/** Sends schedules to your other phones, a few per post. Returns the posts made. */
export async function sendToMyPhones({ service, key, documents, person, loadFile }: {
  service: string;
  key: string;
  documents: SyncDocument[];
  person: string;
  loadFile: (id: string, straightened?: boolean) => Promise<Blob | undefined>;
}) {
  const made: string[] = [];
  const sent: string[] = [];
  for (let start = 0; start < documents.length; start += PER_POST) {
    const batch = documents.slice(start, start + PER_POST);
    const { share, what } = await buildShare({ documents: batch, person, loadFile });
    const hashes = (share.manifest.schedules ?? []).map((schedule) => schedule.hash);
    if (!hashes.length) continue;
    const { id: shareId } = await uploadShare(share, { service, days: SYNC_DAYS, key });
    const { id } = await sendPost(service, { kind: "self", shareId, what, hashes });
    made.push(id);
    sent.push(...hashes);
    rememberSent(hashes);
  }
  return { made, sent };
}

/**
 * Which of a post's schedules this phone should take: not one it has (same
 * photo), and not a week it has a newer copy of.
 */
export function wanted(
  hashes: string[],
  weeks: string[][],
  postedAt: string,
  local: Array<{ hash: string; dates: string[]; updatedAt: string }>,
  sameWeek: (a: string[], b: string[]) => boolean,
) {
  return hashes.map((hash, index) => {
    if (local.some((document) => document.hash === hash)) return false;
    const week = weeks[index] ?? [];
    const copy = local.find((document) => sameWeek(document.dates, week));
    return !copy || copy.updatedAt < postedAt;
  });
}
