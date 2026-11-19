/** Puts together what's being sent: a link, a team post, or "send this import". */
import type { Contacts } from "./contacts-data";
import type { DirectoryEntry } from "./directory-data";
import { firstName, weekLabel, type ShareManifest, type SharePackage, type SharedRead } from "./share-data.ts";
import type { Flight, Shift } from "./sample-data.ts";
import { SCHEDULE_PARSER_VERSION, type ScheduleSourceLayout } from "./schedule-parser.ts";
import { shareableSchedule } from "./share-link.ts";

export type ShareableDocument = {
  id: string;
  hash: string;
  name: string;
  dates: string[];
  mimeType?: string;
  shifts?: Shift[];
  flights?: Flight[];
  parserVersion?: number;
  review?: { sourceLayout?: ScheduleSourceLayout; deskewed?: boolean; uncertainShifts?: string[] };
};

/** What this phone read, to send along so the other phone can skip scanning. */
function readOf(document: ShareableDocument): SharedRead | undefined {
  if (!document.shifts?.length && !document.flights?.length) return undefined;
  const uncertain = new Set(document.review?.uncertainShifts ?? []);
  return {
    parserVersion: document.parserVersion ?? SCHEDULE_PARSER_VERSION,
    dates: document.dates,
    shifts: document.shifts ?? [],
    flights: document.flights ?? [],
    sourceLayout: document.review?.sourceLayout,
    uncertain: (document.shifts ?? []).filter((shift) => uncertain.has(shift.id))
      .map((shift) => `${shift.date}|${shift.worker}|${shift.start}`),
  };
}

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
  /** `straightened`: the copy the scan straightened (the one the row layout matches), if any. */
  loadFile: (id: string, straightened?: boolean) => Promise<Blob | undefined>;
}): Promise<{ share: SharePackage; what: string }> {
  const files: Blob[] = [];
  const schedules: NonNullable<ShareManifest["schedules"]> = [];
  const people = new Set<string>();
  for (const document of documents) {
    // A tilted photo the scan straightened goes as the straightened copy, which the read's layout matches.
    const straightened = document.review?.deskewed
      ? await loadFile(document.id, true).catch(() => undefined)
      : undefined;
    const original = straightened ?? await loadFile(document.id).catch(() => undefined);
    if (!original) continue;
    const file = await shareableSchedule(original);
    files.push(file);
    const read = readOf(document);
    schedules.push({
      name: document.name,
      type: file.type || document.mimeType || "application/octet-stream",
      dates: document.dates,
      hash: document.hash,
      size: file.size,
      ...(read && (!document.review?.deskewed || straightened) ? { read } : {}),
    });
    for (const shift of document.shifts ?? []) if (shift.worker) people.add(shift.worker);
  }
  const sendDirectory = Boolean(directory?.length);
  const sendContacts = Boolean(contacts && contactCount(contacts));
  if (!schedules.length && !sendDirectory && !sendContacts) {
    throw new Error(documents.length
      ? "The schedule photos aren’t on this device anymore. Import them again to share."
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
