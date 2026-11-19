/** Puts together what's being sent: a link, a team post, or "send this import". */
import type { Contacts } from "./contacts-data";
import type { DirectoryEntry } from "./directory-data";
import { firstName, weekLabel, type ShareManifest, type SharePackage } from "./share-data.ts";
import { shareableSchedule } from "./share-link.ts";

export type ShareableDocument = {
  id: string;
  hash: string;
  name: string;
  dates: string[];
  mimeType?: string;
  shifts?: Array<{ worker: string }>;
};

export const contactCount = (contacts: Contacts) =>
  Object.values(contacts).filter((contact) => contact?.email || contact?.phone).length;

/** "the Nov 22 – 28 schedule and the directory" */
export function describeShare({ weeks, directory, contacts }: { weeks: string[][]; directory?: boolean; contacts?: boolean }) {
  const parts = [
    weeks.length === 1 ? `the ${weekLabel(weeks[0])} schedule` : weeks.length ? `${weeks.length} schedules` : "",
    directory ? "the directory" : "",
    contacts ? "coworker contacts" : "",
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "";
}

export async function buildShare({ documents, directory, contacts, person, loadFile }: {
  documents: ShareableDocument[];
  directory?: DirectoryEntry[];
  contacts?: Contacts;
  person: string;
  loadFile: (id: string) => Promise<Blob | undefined>;
}): Promise<{ share: SharePackage; what: string }> {
  const files: Blob[] = [];
  const schedules: NonNullable<ShareManifest["schedules"]> = [];
  const people = new Set<string>();
  for (const document of documents) {
    const original = await loadFile(document.id).catch(() => undefined);
    if (!original) continue;
    const file = await shareableSchedule(original);
    files.push(file);
    schedules.push({
      name: document.name,
      type: file.type || document.mimeType || "application/octet-stream",
      dates: document.dates,
      hash: document.hash,
      size: file.size,
    });
    for (const shift of document.shifts ?? []) if (shift.worker) people.add(shift.worker);
  }
  const sendDirectory = Boolean(directory?.length);
  const sendContacts = Boolean(contacts && contactCount(contacts));
  if (!schedules.length && !sendDirectory && !sendContacts) {
    throw new Error(documents.length
      ? "The schedule photos aren’t on this phone anymore. Import them again to share."
      : "Pick something to send.");
  }
  const manifest: ShareManifest = {
    v: 1,
    from: firstName(person),
    createdAt: new Date().toISOString(),
    ...(schedules.length ? { schedules, people: [...people].sort() } : {}),
    ...(sendDirectory ? { directory } : {}),
    ...(sendContacts ? { contacts } : {}),
  };
  return {
    share: { manifest, files },
    what: describeShare({ weeks: schedules.map((schedule) => schedule.dates), directory: sendDirectory, contacts: sendContacts }),
  };
}
