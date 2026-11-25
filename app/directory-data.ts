/**
 * The work phone directory (LAST · FIRST · DEPARTMENT · TITLE · PHONE · EXT ·
 * CELL), read from screenshots or a PDF and kept only on this device.
 */

import { contactKey, matchWorker, type ContactEntry, type Contacts } from "./contacts-data.ts";
import { parseListPage } from "./directory-lists.ts";

export type DirectoryEntry = {
  id: string;
  /** A person… */
  first?: string;
  last?: string;
  /** …or a shared line like "AIRLINE SERVICES (SUPV OR LEAD ON DUTY)". */
  line?: string;
  department?: string;
  title?: string;
  phone?: string;
  ext?: string;
  cell?: string;
  email?: string;
  /** Numbers whose two reads disagreed, to double-check. */
  check?: Array<"phone" | "ext" | "cell">;
};

/** Where each number was read, so it can be re-read on its own. */
export type NumberBoxes = Partial<Record<"phone" | "ext" | "cell", { x: number; y: number; width: number; height: number; group: number }>>;

export const DIRECTORY_KEY = "shiftdeck.directory";

/** A piece of text with its box, in top-down page coordinates. */
export type PlacedText = {
  text: string; x: number; y: number; width: number; height: number; group?: number;
  /** OCR's confidence, 0–100 (PDF text has none: it's exact). */
  conf?: number;
};

type Column = "last" | "first" | "department" | "title" | "phone" | "ext" | "cell" | "email";

const HEADERS: Array<[Column, RegExp]> = [
  ["last", /^(?:last|lastname|surname)$/],
  ["first", /^(?:first|firstname)$/],
  ["department", /^(?:department|dept|departments)$/],
  ["title", /^(?:title|position|job)$/],
  ["phone", /^(?:phone|office|desk|work|telephone)$/],
  ["ext", /^(?:ext|extension|x)$/],
  ["cell", /^(?:cell|mobile|cellphone)$/],
  ["email", /^(?:email|e-mail|mail)$/],
];

const headerColumn = (text: string) => {
  const word = text.toLowerCase().replace(/[^a-z-]/g, "");
  return HEADERS.find(([, pattern]) => pattern.test(word))?.[0];
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** Grid lines and stray marks OCR reads as text. */
const isNoise = (text: string) => /^[|[\]_—–\-=:;.,'`"~]+$/.test(text.trim());

const digits = (text: string) => text.replace(/\D/g, "");

/** 10-digit numbers as 484-426-8119; anything else as read. */
export const formatDirectoryPhone = (phone: string) => {
  const number = digits(phone);
  const local = number.length === 11 && number.startsWith("1") ? number.slice(1) : number;
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}` : phone.trim();
};

/** OCR swaps for digits inside phone numbers (O→0, l→1, S→5, B→8). */
const phoneText = (text: string) =>
  text.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");

export const tidyPhone = (text: string) => {
  const number = digits(phoneText(text));
  return number.length >= 7 && number.length <= 11 ? formatDirectoryPhone(number) : "";
};

export const tidyExt = (text: string) => {
  const number = digits(phoneText(text));
  return number.length >= 2 && number.length <= 6 ? number : "";
};

const tidyName = (text: string) => text.replace(/[^A-Za-z' .,()&/-]+/g, " ").replace(/\s+/g, " ").trim();

const tidyLabel = (text: string) =>
  text.replace(/[|_[\]{}]+/g, " ").replace(/\s+/g, " ").replace(/^[^A-Za-z0-9(]+|[^A-Za-z0-9)]+$/g, "").trim();

/** Short codes that stay capitalized. */
const ACRONYMS = new Set([
  "abe", "tsa", "gsc", "faa", "arff", "cbp", "atc", "fbo", "it", "hr", "id", "vp", "avp", "svp", "evp",
  "ceo", "cfo", "coo", "cio", "gm", "agm", "us", "usa", "pa", "nj", "ny", "llc", "inc", "ii", "iii", "iv",
  "emt", "k9", "ops", "aoc", "soc", "lnai", "dhs", "fbi", "ice", "tso", "sso", "bso", "pr", "qa", "ap", "ar",
  "lnaa", "fsdo", "afsfo", "atct", "tracon", "qc", "pbx", "lvas", "lccc", "opx", "gca", "vip", "fss", "lv", "ga",
  "ups", "dhl", "usps", "dgs", "lvip", "muse", "did",
]);
const SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "vs"]);

/**
 * "AIRLINE SERVICES (SUPV OR LEAD ON DUTY)" → "Airline Services (Supv or
 * Lead on Duty)". Text that already has mixed case is left as written.
 */
export function smartCase(text: string, allCaps = false) {
  if (!text) return text;
  if (allCaps) text = text.toUpperCase();
  // Typed names keep their capitals; mostly-uppercase text (OCR of an
  // all-caps list reads some letters lowercase) is recased.
  const letters = text.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (letters && upper / letters.length < 0.6 && /[A-Z]/.test(text) && /[a-z]/.test(text)) return text;
  return text.toLowerCase().split(/(\s+)/).map((word, index) => {
    if (/^\s+$/.test(word)) return word;
    const bare = word.replace(/[^a-z0-9]/g, "");
    if (ACRONYMS.has(bare)) return word.toUpperCase();
    // "faa/fsdo", "afsfo/allan": each side on its own.
    if (word.includes("/") && word.split("/").some((part) => ACRONYMS.has(part.replace(/[^a-z0-9]/g, "")))) {
      return word.split("/").map((part) => ACRONYMS.has(part.replace(/[^a-z0-9]/g, ""))
        ? part.toUpperCase()
        : part.replace(/(^|[-'’(&.])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())).join("/");
    }
    if (index > 0 && SMALL.has(bare) && !/^\(/.test(word)) return word;
    return word
      .replace(/(^|[-(/&.])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())
      // O'Brien, D'Angelo — but not Hotel's.
      .replace(/^([A-Za-z])['’]([a-z])/, (_, first: string, letter: string) => `${first}'${letter.toUpperCase()}`)
      .replace(/^Mc([a-z])/, (_, letter: string) => `Mc${letter.toUpperCase()}`);
  }).join("");
}

/**
 * Uses the schedule's spelling for people on it ("LABARRE" → "LaBarre"),
 * since all-caps text can't say where capitals go inside a name.
 */
export function applyKnownNames(entries: DirectoryEntry[], workers: string[]) {
  const known = workers
    .map((worker) => worker.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({ first: parts[0], last: parts.at(-1)! }));
  const close = (a: string, b: string) => {
    a = a.toLowerCase();
    b = b.toLowerCase();
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 2) return false;
    let differences = 0;
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    differences = row[b.length];
    return differences <= (Math.max(a.length, b.length) >= 6 ? 2 : 1);
  };
  return entries.map((entry) => {
    if (!entry.first || !entry.last) return entry;
    // Same last name and a first name within a typo or two.
    const matches = known.filter((name) => name.last.toLowerCase() === entry.last!.toLowerCase() && close(name.first, entry.first!));
    const match = matches.length === 1 ? matches[0] : null;
    return match ? { ...entry, first: match.first, last: match.last } : entry;
  });
}

/** Sorts text into lines, top to bottom, then left to right. */
function lines(items: PlacedText[]) {
  const height = median(items.map((item) => item.height)) || 10;
  const rows: PlacedText[][] = [];
  for (const item of [...items].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))) {
    const center = item.y + item.height / 2;
    const row = rows.at(-1);
    const rowCenter = row ? median(row.map((word) => word.y + word.height / 2)) : 0;
    if (row && Math.abs(center - rowCenter) <= height * 0.6) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

/** Joins words that sit close together into phrases (a cell's text). */
function phrases(row: PlacedText[]) {
  const height = median(row.map((item) => item.height)) || 10;
  const groups: PlacedText[][] = [];
  for (const word of row) {
    const last = groups.at(-1)?.at(-1);
    if (last && word.x - (last.x + last.width) <= height * 0.85) groups.at(-1)!.push(word);
    else groups.push([word]);
  }
  return groups.map((words) => ({
    words,
    text: words.map((word) => word.text).join(" "),
    x: words[0].x,
    right: words.at(-1)!.x + words.at(-1)!.width,
  }));
}

type Layout = Array<{ column: Column; x: number }>;

function findHeader(rows: PlacedText[][]): { index: number; layout: Layout } | null {
  for (let index = 0; index < rows.length; index += 1) {
    const found = new Map<Column, number>();
    for (const word of rows[index]) {
      const column = headerColumn(word.text);
      if (column && !found.has(column)) found.set(column, word.x);
    }
    const hasName = found.has("last") || found.has("first");
    const hasNumber = found.has("phone") || found.has("cell") || found.has("ext");
    if (found.size >= 3 && hasName && hasNumber) {
      // A misread header word (TITLE read as "Time") sitting between known
      // columns takes the missing column that belongs there.
      const ORDER = HEADERS.map(([column]) => column);
      for (const word of rows[index]) {
        if (headerColumn(word.text) || !/[a-z]{3,}/i.test(word.text)) continue;
        const known = [...found.entries()].sort((a, b) => a[1] - b[1]);
        const left = known.filter(([, x]) => x < word.x).at(-1);
        const right = known.find(([, x]) => x > word.x);
        const from = left ? ORDER.indexOf(left[0]) + 1 : 0;
        const to = right ? ORDER.indexOf(right[0]) : ORDER.length;
        const missing = ORDER.slice(from, to).find((column) => !found.has(column));
        if (missing) found.set(missing, word.x);
      }
      return { index, layout: [...found.entries()].map(([column, x]) => ({ column, x })).sort((a, b) => a.x - b.x) };
    }
  }
  return null;
}

/**
 * Reads the table. Each group (one screenshot or PDF page) finds its own
 * header row; a group without one reuses the previous group's columns.
 */
export function parseDirectory(items: PlacedText[]): DirectoryEntry[] {
  const groups = new Map<number, PlacedText[]>();
  for (const item of items) {
    if (!item.text.trim() || isNoise(item.text)) continue;
    const key = item.group ?? 0;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const entries: DirectoryEntry[] = [];
  let layout: Layout | null = null;
  // An all-caps directory is read with some stray lowercase letters; recase it all.
  const letters = items.map((item) => item.text).join("").replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length > 0 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.7;
  const recase = (text: string) => smartCase(text, allCaps);
  let section = "";
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const rows = lines(groups.get(key)!);
    const header = findHeader(rows);
    if (header) layout = header.layout;
    else {
      // No LAST/FIRST/PHONE header: a printed list ("Ticket Counter ...... 4021" under headings).
      const listed = parseListPage(groups.get(key)!, key, recase);
      if (listed.length >= 2 || !layout) {
        for (const { boxes, ...entry } of listed) entries.push(withBoxes({ ...entry, id: entryId(entry) }, boxes));
        continue;
      }
    }
    if (!layout) continue;
    const slack = median(rows.flat().map((item) => item.height)) * 0.6 || 6;
    const columnAt = (x: number) => [...layout!].reverse().find((column) => x >= column.x - slack)?.column ?? layout![0].column;
    const NUMBER: Column[] = ["phone", "ext", "cell", "email"];
    for (const row of rows.slice(header ? header.index + 1 : 0)) {
      if (findHeader([row])) continue;
      const rowPhrases = phrases(row);
      const textPhrases = rowPhrases.filter((phrase) => !NUMBER.includes(columnAt(phrase.x)));
      const crosses = (phrase: { x: number; right: number }) =>
        layout!.some((column) => column.x > phrase.x + slack && column.x < phrase.right - slack);
      // One continuous phrase across the name columns (with no other text) is
      // a shared line or a heading, like "AIRLINE SERVICES (SUPV OR LEAD ON DUTY)".
      const spanning = textPhrases.length === 1 && crosses(textPhrases[0]) ? textPhrases[0].text : "";
      const cells: Partial<Record<Column, string>> = {};
      const placed: Partial<Record<Column, PlacedText[]>> = {};
      for (const phrase of rowPhrases) {
        if (spanning && phrase === textPhrases[0]) continue;
        // Otherwise each word goes in the column it starts under.
        for (const word of phrase.words) {
          const column = columnAt(word.x);
          cells[column] = [cells[column], word.text].filter(Boolean).join(" ");
          placed[column] = [...(placed[column] ?? []), word];
        }
      }
      const boxes: NumberBoxes = {};
      for (const column of ["phone", "ext", "cell"] as const) {
        const words = placed[column];
        if (!words?.length) continue;
        const x = Math.min(...words.map((word) => word.x));
        const y = Math.min(...words.map((word) => word.y));
        boxes[column] = {
          x, y, group: key,
          width: Math.max(...words.map((word) => word.x + word.width)) - x,
          height: Math.max(...words.map((word) => word.y + word.height)) - y,
        };
      }
      const phone = tidyPhone(cells.phone ?? "");
      const cell = tidyPhone(cells.cell ?? "");
      const ext = tidyExt(cells.ext ?? "");
      const email = (cells.email ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
      const last = recase(tidyName(cells.last ?? ""));
      const first = recase(tidyName(cells.first ?? ""));
      const spanText = recase(tidyLabel(spanning));
      if (!phone && !cell && !ext && !email) {
        // Words with no number: a section heading for the rows below it.
        const label = recase(tidyLabel([spanning, cells.last, cells.first, cells.department, cells.title]
          .filter(Boolean).join(" ")));
        if (label) section = label;
        continue;
      }
      const department = recase(tidyLabel(cells.department ?? "")) || section;
      const title = recase(tidyLabel(cells.title ?? ""));
      const base = {
        ...(department ? { department } : {}),
        ...(title ? { title } : {}),
        ...(phone ? { phone } : {}),
        ...(ext ? { ext } : {}),
        ...(cell ? { cell } : {}),
        ...(email ? { email } : {}),
      };
      if (spanText || (!first && last)) {
        const line = spanText || last;
        const { department: _ignored, ...rest } = base;
        void _ignored;
        // A shared line with no department cell is filed with the people below it.
        entries.push(withBoxes({
          id: entryId({ line, ...rest }), line, ...rest,
          ...(cells.department ? { department } : section ? { department: section } : { needsDepartment: true }),
        } as DirectoryEntry, boxes));
      } else if (last || first) {
        entries.push(withBoxes({
          id: entryId({ first, last, ...base }), ...(first ? { first } : {}), ...(last ? { last } : {}), ...base,
        }, boxes));
      }
    }
  }
  // Shared lines take the department of the next person listed (or the one before).
  return entries.map((entry, index) => {
    const pending = entry as DirectoryEntry & { needsDepartment?: boolean };
    if (!pending.needsDepartment) return entry;
    const { needsDepartment: _flag, ...clean } = pending;
    void _flag;
    const near = entries.slice(index + 1).find((item) => !item.line && item.department)?.department ??
      entries.slice(0, index).reverse().find((item) => !item.line && item.department)?.department;
    return withBoxes({ ...clean, ...(near ? { department: near } : {}) } as DirectoryEntry, numberBoxes(entry));
  });
}

const BOXES = Symbol("boxes");

/** Number boxes ride along on parsed entries without being saved. */
const withBoxes = (entry: DirectoryEntry, boxes: NumberBoxes) =>
  Object.defineProperty(entry, BOXES, { value: boxes, enumerable: false });

export const numberBoxes = (entry: DirectoryEntry): NumberBoxes =>
  (entry as DirectoryEntry & { [BOXES]?: NumberBoxes })[BOXES] ?? {};

/**
 * Applies a digits-only re-read of one number. The re-read wins when it's a
 * valid number; if the two reads differ, the number is marked to check.
 */
export function applyNumberReread(entry: DirectoryEntry, field: "phone" | "ext" | "cell", reread: string) {
  const value = field === "ext" ? tidyExt(reread) : tidyPhone(reread);
  if (!value || value === entry[field]) return entry;
  return { ...entry, [field]: value, check: [...new Set([...(entry.check ?? []), field])] } as DirectoryEntry;
}

export const entryName = (entry: DirectoryEntry) =>
  entry.line ?? [entry.first, entry.last].filter(Boolean).join(" ");

export const entryKey = (entry: Pick<DirectoryEntry, "first" | "last" | "line">) =>
  (entry.line ?? `${entry.last ?? ""}|${entry.first ?? ""}`).toLowerCase().replace(/[^a-z|]/g, "");

export const entryId = (entry: Omit<DirectoryEntry, "id">) =>
  `${entryKey(entry)}|${entry.line ? `${(entry.department ?? "").toLowerCase()}|` : ""}${(entry.phone ?? entry.cell ?? entry.ext ?? "").replace(/\D/g, "")}`;

/** Adds imported entries; someone already saved is updated, not duplicated. */
export function mergeDirectory(current: DirectoryEntry[], incoming: DirectoryEntry[]) {
  const next = [...current];
  let added = 0;
  let updated = 0;
  for (const entry of incoming) {
    const index = next.findIndex((item) => entryKey(item) === entryKey(entry) &&
      (item.department ?? "") === (entry.department ?? ""));
    if (index >= 0) {
      next[index] = { ...next[index], ...entry, id: next[index].id };
      updated += 1;
    } else {
      next.push(entry);
      added += 1;
    }
  }
  return { entries: next, added, updated };
}

export const newEntryId = () => `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Calls the desk phone and dials the extension after a pause (the first one, if there are two). */
export const callLink = (phone: string, ext?: string) => {
  const first = ext?.split(/[/,]/)[0] ?? "";
  return `tel:${digits(phone)}${digits(first) ? `,${digits(first)}` : ""}`;
};

export const departmentsOf = (entries: DirectoryEntry[]) =>
  [...new Set(entries.map((entry) => entry.department).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b));

export function searchDirectory<T extends DirectoryEntry>(entries: T[], query: string, department: string | null): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => !department || entry.department === department)
    .filter((entry) => {
      if (!words.length) return true;
      const haystack = [entryName(entry), entry.department, entry.title, entry.phone, entry.ext, entry.cell, entry.email]
        .filter(Boolean).join(" ").toLowerCase();
      const numbers = haystack.replace(/\D/g, "");
      return words.every((word) => haystack.includes(word) || (/^\d+$/.test(word) && numbers.includes(word)));
    })
    .sort((a, b) =>
      (a.department ?? "").localeCompare(b.department ?? "") ||
      Number(Boolean(b.line)) - Number(Boolean(a.line)) ||
      (a.last ?? a.line ?? "").localeCompare(b.last ?? b.line ?? "") ||
      (a.first ?? "").localeCompare(b.first ?? ""));
}

/** Word boxes from Tesseract's TSV output. */
export function wordsFromTsv(tsv: string, group = 0): PlacedText[] {
  return tsv.split(/\r?\n/).map((line) => line.split("\t"))
    .filter((parts) => parts[0] === "5" && parts.length >= 12 && parts[11]?.trim())
    .map((parts) => ({
      text: parts.slice(11).join(" ").trim(),
      x: Number(parts[6]), y: Number(parts[7]), width: Number(parts[8]), height: Number(parts[9]),
      conf: Number(parts[10]),
      group,
    }))
    .filter((word) => Number.isFinite(word.x) && Number(word.height) > 0);
}

/** The tab for people on your schedules (and from your coworker lists). */
export const COWORKERS = "Coworkers";

/** An entry as the Directory shows it: coworkers are folded in on the fly. */
export type ShownEntry = DirectoryEntry & {
  /** Their schedule name, when they work with you. */
  coworker?: string;
  /** Only on the schedule, not saved in the directory itself. */
  fromSchedule?: boolean;
};

const numberDigits = (value?: string) => (value ?? "").replace(/\D/g, "").slice(-10);

/** The directory person this is (same email, or the same name in any order). */
export function findPerson<T extends DirectoryEntry>(entries: T[], name: string, email?: string): T | null {
  const people = entries.filter((entry) => !entry.line && (entry.first || entry.last));
  if (email) {
    const byEmail = people.find((entry) => entry.email?.toLowerCase() === email.toLowerCase());
    if (byEmail) return byEmail;
  }
  if (!name.trim()) return null;
  const names = [...new Set(people.map(entryName))];
  const match = matchWorker(name, names);
  return match ? people.find((entry) => entryName(entry) === match) ?? null : null;
}

/** "Weber, Landon" or "landon weber" → first and last, properly capitalized. */
export function splitName(name: string) {
  const ordered = name.includes(",") ? name.split(",").reverse().join(" ") : name;
  const parts = smartCase(ordered.replace(/\s+/g, " ").trim()).split(" ").filter(Boolean);
  return parts.length > 1
    ? { first: parts.slice(0, -1).join(" "), last: parts.at(-1)! }
    : { first: parts[0] ?? "" };
}

/**
 * The directory with everyone from your schedules in it. Someone already
 * listed gets their saved email and phone; anyone else shows under
 * Coworkers. Nothing is copied, so nobody is ever listed twice.
 */
export function withCoworkers(entries: DirectoryEntry[], workers: string[], contacts: Contacts): ShownEntry[] {
  const shown: ShownEntry[] = entries.map((entry) => ({ ...entry }));
  const saved = shown.slice();
  for (const worker of workers) {
    const contact = contacts[contactKey(worker)] ?? {};
    const listed = findPerson(saved, worker, contact.email);
    if (listed) {
      listed.coworker = worker;
      if (!listed.email && contact.email) listed.email = contact.email;
      if (!listed.cell && contact.phone && numberDigits(contact.phone) !== numberDigits(listed.phone)) {
        listed.cell = formatDirectoryPhone(contact.phone);
      }
      continue;
    }
    shown.push({
      id: `coworker:${contactKey(worker)}`,
      ...splitName(worker),
      department: COWORKERS,
      email: contact.email,
      cell: contact.phone ? formatDirectoryPhone(contact.phone) : undefined,
      coworker: worker,
      fromSchedule: true,
    });
  }
  return shown;
}

/**
 * People from a coworker list who aren't on your schedules. Anyone already
 * in the directory only gets a missing email or cell filled in.
 */
export function addPeopleToDirectory(entries: DirectoryEntry[], people: ContactEntry[]) {
  const next = entries.map((entry) => ({ ...entry }));
  let added = 0;
  let updated = 0;
  for (const person of people) {
    const listed = findPerson(next, person.name, person.email);
    if (listed) {
      let changed = false;
      if (!listed.email && person.email) {
        listed.email = person.email;
        changed = true;
      }
      if (!listed.cell && person.phone && numberDigits(person.phone) !== numberDigits(listed.phone)) {
        listed.cell = formatDirectoryPhone(person.phone);
        changed = true;
      }
      if (changed) updated += 1;
      continue;
    }
    if (!/[a-z]{2,}/i.test(person.name)) continue;
    next.push({
      id: newEntryId(),
      ...splitName(person.name),
      department: COWORKERS,
      email: person.email,
      cell: person.phone ? formatDirectoryPhone(person.phone) : undefined,
    });
    added += 1;
  }
  return { entries: next, added, updated };
}

/** Swap emails and texts can use the directory for anyone not saved in contacts. */
export function contactsWithDirectory(contacts: Contacts, workers: string[], entries: DirectoryEntry[]): Contacts {
  const next = { ...contacts };
  for (const worker of workers) {
    const key = contactKey(worker);
    const current = next[key] ?? {};
    if (current.email && current.phone) continue;
    const listed = findPerson(entries, worker, current.email);
    if (!listed) continue;
    const email = current.email ?? listed.email;
    const phone = current.phone ?? (listed.cell ? numberDigits(listed.cell) : undefined);
    if (email || phone) next[key] = { email, phone };
  }
  return next;
}
