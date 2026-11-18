/**
 * What a share link carries, how it's packed, and how it's folded into what
 * a coworker already has (nothing is duplicated, and nothing they already
 * saved is overwritten).
 */
import { contactKey, type Contacts } from "./contacts-data.ts";
import { entryKey, findPerson, newEntryId, type DirectoryEntry } from "./directory-data.ts";

export type SharedSchedule = {
  name: string;
  type: string;
  dates: string[];
  /** The sender's copy (same photo → same hash). */
  hash: string;
  size: number;
};

export type ShareManifest = {
  v: 1;
  from: string;
  createdAt: string;
  schedules?: SharedSchedule[];
  directory?: DirectoryEntry[];
  contacts?: Contacts;
};

export type SharePackage = { manifest: ShareManifest; files: Blob[] };

const MAGIC = [83, 68, 75, 49]; // "SDK1"

/** [SDK1][u32 manifest length][manifest JSON][file bytes…] */
export async function packShare({ manifest, files }: SharePackage): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const fileBytes = await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));
  const total = 8 + json.length + fileBytes.reduce((sum, bytes) => sum + bytes.length, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length);
  out.set(json, 8);
  let offset = 8 + json.length;
  for (const bytes of fileBytes) {
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return out;
}

export function unpackShare(bytes: Uint8Array): SharePackage {
  if (bytes.length < 8 || MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new Error("This isn't a Shiftdeck share.");
  }
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as ShareManifest;
  if (manifest?.v !== 1) throw new Error("This share needs a newer version of Shiftdeck.");
  let offset = 8 + length;
  const files = (manifest.schedules ?? []).map((schedule) => {
    const file = new Blob([bytes.slice(offset, offset + schedule.size)], { type: schedule.type });
    offset += schedule.size;
    return file;
  });
  return { manifest, files };
}

const digits = (value?: string) => (value ?? "").replace(/\D/g, "");
const FILLABLE = ["department", "title", "phone", "ext", "cell", "email"] as const;

/** Adds people and lines they don't have; fills in only what's missing for ones they do. */
export function mergeSharedDirectory(current: DirectoryEntry[], incoming: DirectoryEntry[]) {
  const entries = current.map((entry) => ({ ...entry }));
  let added = 0;
  let updated = 0;
  let same = 0;
  for (const raw of incoming) {
    const { id: _id, check: _check, ...entry } = raw;
    void _id;
    void _check;
    const match = entry.line
      ? entries.find((item) => item.line && entryKey(item) === entryKey(entry) &&
        (!digits(item.phone) || !digits(entry.phone) || digits(item.phone) === digits(entry.phone)))
      : entries.find((item) => !item.line && entryKey(item) === entryKey(entry) &&
        (item.department ?? "") === (entry.department ?? "")) ??
        findPerson(entries, `${entry.first ?? ""} ${entry.last ?? ""}`, entry.email);
    if (!match) {
      entries.push({ ...entry, id: newEntryId() });
      added += 1;
      continue;
    }
    let changed = false;
    for (const field of FILLABLE) {
      if (!match[field] && entry[field]) {
        match[field] = entry[field];
        changed = true;
      }
    }
    if (changed) updated += 1;
    else same += 1;
  }
  return { entries, added, updated, same };
}

/** Adds emails and numbers they don't have; never replaces their own. */
export function mergeSharedContacts(current: Contacts, incoming: Contacts) {
  const contacts: Contacts = { ...current };
  let added = 0;
  let updated = 0;
  let same = 0;
  for (const [rawKey, contact] of Object.entries(incoming)) {
    const key = contactKey(rawKey);
    if (!key || (!contact?.email && !contact?.phone)) continue;
    const mine = contacts[key];
    if (!mine) {
      contacts[key] = { ...(contact.email ? { email: contact.email } : {}), ...(contact.phone ? { phone: contact.phone } : {}) };
      added += 1;
      continue;
    }
    const next = { ...mine };
    if (!next.email && contact.email) next.email = contact.email;
    if (!next.phone && contact.phone) next.phone = contact.phone;
    if (next.email !== mine.email || next.phone !== mine.phone) {
      contacts[key] = next;
      updated += 1;
    } else {
      same += 1;
    }
  }
  return { contacts, added, updated, same };
}

/** "12 new · 3 filled in · 40 already there" */
export function mergeSummary({ added, updated, same }: { added: number; updated: number; same: number }) {
  return [
    added && `${added} new`,
    updated && `${updated} filled in`,
    same && `${same} already there`,
  ].filter(Boolean).join(" · ") || "Nothing new";
}

/** "Nov 15 – 21" for a week of dates. */
export function weekLabel(dates: string[]) {
  const sorted = [...dates].sort();
  if (!sorted.length) return "Schedule";
  const day = (date: string) => new Date(`${date}T12:00:00`);
  const first = day(sorted[0]);
  const last = day(sorted.at(-1)!);
  const month = (date: Date) => date.toLocaleDateString("en-US", { month: "short" });
  return first.getMonth() === last.getMonth()
    ? `${month(first)} ${first.getDate()} – ${last.getDate()}`
    : `${month(first)} ${first.getDate()} – ${month(last)} ${last.getDate()}`;
}

/** First name only, for "David shared…". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
