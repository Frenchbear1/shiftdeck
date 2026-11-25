/**
 * Pasted JSON for Coworkers and the Directory, usually made by an AI model
 * from a list or photos, plus the instructions to give that model so its
 * answer comes back in the shape Shiftdeck reads.
 */

import { tidyEmail, tidyPhone as tidyContactPhone, type ContactEntry } from "./contacts-data.ts";
import { entryId, tidyExt, tidyPhone, type DirectoryEntry } from "./directory-data.ts";

export const DIRECTORY_JSON_PROMPT = `Turn the phone directory I give you (pasted text, photos or a file) into JSON for my Shiftdeck app. Reply with only the JSON, nothing else.

Format:
{"directory": [
  {"first": "Dana", "last": "Miller", "department": "Operations", "title": "Supervisor", "phone": "610-555-1234", "ext": "4021", "cell": "484-555-9876", "email": "dmiller@example.com"},
  {"line": "Ticket Counter", "department": "Allegiant Air", "ext": "4022 / 4023", "note": "only day-of-departure calls"}
]}

Rules:
- One object per person, or per shared line (a desk, office, room or company that isn't a person).
- People get "first" and "last". Shared lines get "line" instead.
- "department": the heading, airline or company it's listed under.
- "phone": the full number with area code if shown, like 610-555-1234 (or 555-1234 if that's all there is).
- "ext": internal extension digits only. Two extensions: "4021 / 4022".
- "cell": a mobile number. "email" if listed.
- "title": a person's job. "note": anything else worth keeping (hours, when to call, who to ask for).
- Leave out any field that isn't there. Never make up or guess numbers. Keep the spelling from the source.
- Skip page headers and footers ("Last printed…", page numbers).`;

export const COWORKERS_JSON_PROMPT = `Turn the list of coworkers I give you (pasted text, photos or a file) into JSON for my Shiftdeck app. Reply with only the JSON, nothing else.

Format:
{"coworkers": [
  {"name": "Landon Weber", "email": "landon.weber@example.com", "phone": "610-555-1234"},
  {"name": "Nicole Watson", "phone": "484-555-9876"}
]}

Rules:
- One object per person, with their full name as written ("First Last").
- "phone": their cell or personal number, like 610-555-1234. "email" if listed.
- Leave out any field that isn't there. Never make up or guess emails or numbers.`;

/** Does this look like JSON (or JSON in a ``` block) rather than a plain list? */
export const looksLikeJson = (text: string) => /^\s*(?:```|\[|\{)/.test(text);

/** The JSON inside: code fences and any chat around it are dropped. Throws when it isn't JSON. */
function readJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.search(/[[{]/);
  const end = Math.max(fenced.lastIndexOf("]"), fenced.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error("not json");
  return JSON.parse(fenced.slice(start, end + 1));
}

/** The list of items: a bare array, or the first array under a known (or any) key. */
function itemsOf(data: unknown, keys: string[]): Array<Record<string, unknown>> {
  const records = (list: unknown[]) => list.filter((item): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !Array.isArray(item));
  if (Array.isArray(data)) return records(data);
  if (typeof data !== "object" || data === null) return [];
  const object = data as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(object[key])) return records(object[key] as unknown[]);
  const any = Object.values(object).find(Array.isArray);
  return any ? records(any) : [];
}

/** A field by any of its usual names, as trimmed text. */
const field = (item: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const found = Object.keys(item).find((key) => key.toLowerCase().replace(/[^a-z]/g, "") === name);
    const value = found === undefined ? undefined : item[found];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
};

/** "Weber, Landon" → Landon Weber. */
const fullName = (name: string) =>
  name.includes(",") ? name.split(",").map((part) => part.trim()).reverse().join(" ") : name;

/** Coworkers from pasted JSON. Throws when the text isn't JSON. */
export function parseCoworkersJson(text: string): ContactEntry[] {
  const entries: ContactEntry[] = [];
  for (const item of itemsOf(readJson(text), ["coworkers", "contacts", "people", "directory"])) {
    const name = fullName(field(item, "name", "fullname") ||
      [field(item, "first", "firstname"), field(item, "last", "lastname")].filter(Boolean).join(" "));
    const email = tidyEmail(field(item, "email", "mail"));
    const phone = tidyContactPhone(field(item, "phone", "cell", "mobile", "cellphone", "number"));
    if (!name || (!email && !phone)) continue;
    entries.push({ name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
  }
  return entries;
}

/** Directory entries from pasted JSON. Throws when the text isn't JSON. */
export function parseDirectoryJson(text: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (const item of itemsOf(readJson(text), ["directory", "entries", "people", "contacts", "coworkers"])) {
    let first = field(item, "first", "firstname");
    let last = field(item, "last", "lastname");
    const name = field(item, "name", "fullname");
    if (!first && !last && name) {
      const parts = fullName(name).split(/\s+/);
      last = parts.length > 1 ? parts.pop()! : "";
      first = parts.join(" ");
    }
    const line = field(item, "line", "label", "place", "location", "desk", "office");
    const phone = tidyPhone(field(item, "phone", "number", "desk", "deskphone", "workphone"));
    const cell = tidyPhone(field(item, "cell", "mobile", "cellphone"));
    // Extensions keep apart: "4021 / 4022".
    const ext = field(item, "ext", "extension").split(/[/,;]|\bor\b/).map(tidyExt).filter(Boolean).join(" / ");
    const email = tidyEmail(field(item, "email", "mail"));
    const title = [field(item, "title", "role", "job", "position"), field(item, "note", "notes", "hours")]
      .filter(Boolean).join(" · ");
    const department = field(item, "department", "dept", "section", "heading", "company", "airline", "group");
    const person = Boolean(first || last);
    if (!person && !line) continue;
    if (!phone && !ext && !cell && !email) continue;
    const entry: Omit<DirectoryEntry, "id"> = {
      ...(person ? { ...(first ? { first } : {}), ...(last ? { last } : {}) } : { line }),
      ...(department ? { department } : {}),
      ...(title ? { title } : {}),
      ...(phone ? { phone } : {}),
      ...(ext ? { ext } : {}),
      ...(cell ? { cell } : {}),
      ...(email ? { email } : {}),
    };
    entries.push({ ...entry, id: entryId(entry) });
  }
  return entries;
}
