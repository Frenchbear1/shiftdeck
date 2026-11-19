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

type SyncDocument = ShareableDocument & { updatedAt?: string };

/** Schedules on this phone your other phones don't have yet: recent ones not in any post. */
export function toSend(documents: SyncDocument[], posts: SelfPost[], today: string) {
  const posted = new Set(posts.flatMap((post) => post.hashes));
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
  for (let start = 0; start < documents.length; start += PER_POST) {
    const batch = documents.slice(start, start + PER_POST);
    const { share, what } = await buildShare({ documents: batch, person, loadFile });
    const hashes = (share.manifest.schedules ?? []).map((schedule) => schedule.hash);
    if (!hashes.length) continue;
    const { id: shareId } = await uploadShare(share, { service, days: SYNC_DAYS, key });
    const { id } = await sendPost(service, { kind: "self", shareId, what, hashes });
    made.push(id);
  }
  return made;
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
