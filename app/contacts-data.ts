/**
 * Coworker emails and phone numbers. They're saved only on this device
 * (localStorage), never sent to Shiftdeck's server or kept in the code.
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

/** A short, friendly swap request ready to send. */
export function swapMessage({ to, from, give, take }: {
  to: string;
  from: string;
  give: SwapDay;
  take?: SwapDay;
}) {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";
  const subject = `Shift swap? ${dayLabel(give.date)}`;
  const body = [
    `Hi ${first(to)}, would you want to swap shifts?`,
    take
      ? `You'd take my ${dayLabel(give.date)} (${range(give)}) and I'd take your ${dayLabel(take.date)} (${range(take)}).`
      : `Could you take my ${dayLabel(give.date)} (${range(give)})?`,
    "Let me know!",
    from ? `– ${first(from)}` : "",
  ].filter(Boolean).join("\n");
  return { subject, body };
}

export const emailLink = (email: string, message: { subject: string; body: string }) =>
  `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;

/** iPhones read the body after "&", other phones after "?". */
export const textLink = (phone: string, body: string, apple: boolean) =>
  `sms:${phone}${apple ? "&" : "?"}body=${encodeURIComponent(body)}`;
