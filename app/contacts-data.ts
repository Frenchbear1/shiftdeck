/**
 * Coworker emails and phone numbers. Saved on this device (localStorage) and
 * on your own other devices through your vault, encrypted on the device first
 * (the server only stores what it can't read). Never kept in the code.
 */

export type Contact = { email?: string; phone?: string };
export type Contacts = Record<string, Contact>;
export type ContactEntry = { name: string; email?: string; phone?: string };

export const CONTACTS_KEY = "shiftdeck.contacts";

export const contactKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;

/** Keeps digits (and a leading +); US numbers without a country code stay 10 digits. */
export const tidyPhone = (raw: string) => {
  const plus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return "";
  return `${plus ? "+" : ""}${digits}`;
};

export const tidyEmail = (raw: string) => {
  const match = raw.match(EMAIL);
  return match ? match[0].toLowerCase() : "";
};

/** Shows 6105551234 as (610) 555-1234. */
export const formatPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10
    ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : phone;
};

/**
 * Reads a pasted list: one person per line, in any order, separated by
 * commas, tabs or spaces, e.g. "Landon Weber, landon@x.com, 610-555-1234".
 * Lines without an email or number (like a spreadsheet header) are skipped.
 */
export function parseContactLines(text: string): ContactEntry[] {
  const entries: ContactEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const email = tidyEmail(line);
    const withoutEmail = email ? line.replace(EMAIL, " ") : line;
    const phoneMatch = withoutEmail.match(PHONE);
    const phone = phoneMatch ? tidyPhone(phoneMatch[0]) : "";
    if (!email && !phone) continue;
    const name = (phoneMatch ? withoutEmail.replace(phoneMatch[0], " ") : withoutEmail)
      .replace(/[<>()"';,|\t]+/g, " ")
      .replace(/\b(?:email|e-mail|phone|cell|mobile|name)\b:?/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    entries.push({ name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
  }
  return entries;
}

const tokens = (name: string) =>
  name.toLowerCase().split(/[\s,.-]+/).map((part) => part.replace(/[^a-z]/g, "")).filter(Boolean);

const editDistance = (a: string, b: string) => {
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
  return row[b.length];
};

/**
 * Finds which schedule name a contact belongs to. Handles "Last, First",
 * middle names or initials, and small misspellings. Returns null when it's
 * unclear, so the person can choose.
 */
export function matchWorker(name: string, workers: string[]): string | null {
  const ordered = name.includes(",") ? name.split(",").reverse().join(" ") : name;
  const found = matchTokens(tokens(ordered), workers);
  if (found !== undefined) return found;
  // Lists often put the last name first without a comma.
  return matchTokens(tokens(ordered).reverse(), workers) ?? null;
}

/** undefined: nothing close; null: several equally close. */
function matchTokens(wanted: string[], workers: string[]): string | null | undefined {
  if (!wanted.length) return undefined;
  const exact = workers.filter((worker) => contactKey(worker) === contactKey(wanted.join("")));
  if (exact.length === 1) return exact[0];
  const scored = workers.map((worker) => {
    const theirs = tokens(worker);
    if (theirs.length < 2 || wanted.length < 2) return { worker, score: Infinity };
    const [first, last] = [wanted[0], wanted.at(-1)!];
    const [theirFirst, theirLast] = [theirs[0], theirs.at(-1)!];
    const lastScore = editDistance(last, theirLast);
    const firstScore = first === theirFirst ? 0
      : theirFirst.startsWith(first) || first.startsWith(theirFirst) ? 1
        : editDistance(first, theirFirst);
    const allowed = (word: string) => (word.length >= 6 ? 2 : 1);
    return {
      worker,
      score: lastScore <= allowed(last) && firstScore <= allowed(first) ? lastScore + firstScore : Infinity,
    };
  }).filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score);
  if (!scored.length) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].worker;
}

/**
 * Text read from screenshots of a member list (Outlook and similar), where
 * each person's name sits on the line above their email. OCR often turns
 * "@" into "©" or "®", which is fixed first.
 */
export function parseListScreenshotText(text: string): ContactEntry[] {
  const ROLE = /\b(?:owner|member|guest|admin(?:istrator)?|external)\b/gi;
  const lines = text
    .replace(/[©®]/g, "@")
    .replace(/\s*@\s*/g, "@")
    .split(/\r?\n/)
    .map((line) => line.replace(ROLE, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const entries: ContactEntry[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const email = tidyEmail(line);
    if (!email || seen.has(email)) return;
    seen.add(email);
    const sameLine = line.replace(EMAIL, " ").replace(/[<>()"'|;:,]+/g, " ").replace(/\s+/g, " ").trim();
    let name = /[a-z]{2,}\s+[a-z]/i.test(sameLine) ? sameLine : "";
    for (let back = index - 1; !name && back >= 0 && back >= index - 2; back -= 1) {
      const candidate = lines[back];
      if (tidyEmail(candidate)) break;
      if (/[a-z]{2,}/i.test(candidate) && candidate.length <= 48) {
        name = candidate.replace(/[^A-Za-z' ,.-]+/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    entries.push({ name, email });
  });
  return entries;
}

/**
 * Work emails nearly always contain the last name ("lweber@", "landon.weber@",
 * "weberl@"), so that alone usually finds the person; the first name or
 * initial settles ties between people who share a last name.
 */
export function matchWorkerByEmail(email: string, workers: string[]): string | null {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  if (!local) return null;
  const candidates = workers.filter((worker) => {
    const last = tokens(worker).at(-1) ?? "";
    return last.length >= 3 && local.includes(last);
  });
  if (candidates.length === 1) return candidates[0];
  const byFirst = candidates.filter((worker) => {
    const [first = "", last = ""] = [tokens(worker)[0], tokens(worker).at(-1)];
    const rest = local.replace(last, " ");
    return rest.includes(first) || rest.trim().startsWith(first[0]) || rest.trim().endsWith(first[0]);
  });
  return byFirst.length === 1 ? byFirst[0] : null;
}

/** Name first; the email settles it when the name is unclear or misread. */
export function matchContact(entry: ContactEntry, workers: string[]): string | null {
  const byName = entry.name ? matchWorker(entry.name, workers) : null;
  const byEmail = entry.email ? matchWorkerByEmail(entry.email, workers) : null;
  if (byName && byEmail && byName !== byEmail) return null;
  return byName ?? byEmail;
}

/** Adds entries to the saved contacts; a new value replaces the old one. */
export function mergeContacts(contacts: Contacts, entries: Array<{ worker: string; email?: string; phone?: string }>) {
  const next = { ...contacts };
  for (const { worker, email, phone } of entries) {
    const key = contactKey(worker);
    next[key] = { ...next[key], ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
  }
  return next;
}

type SwapDay = { date: string; start: string; end: string };

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${date}T12:00:00`));

const timeLabel = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  const hour = hours % 12 || 12;
  return `${hour}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours < 12 ? "AM" : "PM"}`;
};

const range = ({ start, end }: SwapDay) => `${timeLabel(start)}–${timeLabel(end)}`;

/**
 * A short swap request ready to send, laid out in small sections. With
 * several of their shifts offered, they pick one on the answer page.
 */
export function swapMessage({ to, from, give, take, options, link }: {
  to: string;
  from: string;
  give: SwapDay;
  take?: SwapDay;
  options?: SwapDay[];
  /** Page where they answer. */
  link?: string;
}) {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";
  const line = (day: SwapDay) => `${dayLabel(day.date)} · ${range(day)}`;
  const choices = !take && options && options.length > 1 ? options : null;
  const theirs = take ?? (options?.length === 1 ? options[0] : undefined);
  const subject = `Shift swap? ${dayLabel(give.date)}`;
  const body = [
    `Hi ${first(to)},`,
    "Would you want to swap shifts?",
    `My shift you'd take:\n${line(give)}`,
    choices
      ? `I could take any one of yours:\n${choices.map((day) => `• ${line(day)}`).join("\n")}`
      : theirs
        ? `Your shift I'd take:\n${line(theirs)}`
        : "",
    link
      ? `${choices ? "Pick one or say no here" : "Tap to answer"}:\n${link}`
      : "Let me know!",
    from ? `Thanks,\n${first(from)}` : "Thanks!",
  ].filter(Boolean).join("\n\n");
  return { subject, body };
}

export const emailLink = (email: string, message: { subject: string; body: string }) =>
  `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;

/** iPhones read the body after "&", other phones after "?". */
export const textLink = (phone: string, body: string, apple: boolean) =>
  `sms:${phone}${apple ? "&" : "?"}body=${encodeURIComponent(body)}`;
