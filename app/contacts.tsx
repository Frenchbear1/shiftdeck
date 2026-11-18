"use client";

import { ClipboardPaste, Contact as ContactIcon, Image as ImageIcon, Mail, MessageSquare, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { backdropClose } from "./home-sections";
import {
  contactKey,
  formatPhone,
  matchContact,
  mergeContacts,
  parseContactLines,
  tidyEmail,
  tidyPhone,
  type ContactEntry,
  type Contacts,
} from "./contacts-data";

type PickedContact = { name?: string[]; email?: string[]; tel?: string[] };
type ContactPicker = {
  select: (properties: string[], options: { multiple: boolean }) => Promise<PickedContact[]>;
};

/** Android Chrome (and some other Android browsers) can open the phone's contacts. */
const contactPicker = () =>
  typeof navigator !== "undefined" && "contacts" in navigator
    ? (navigator as Navigator & { contacts: ContactPicker }).contacts
    : null;

/**
 * Coworker emails and numbers for Shift swap. Fastest is pasting a whole
 * list or picking several people from the phone's contacts at once; each
 * person can also be typed in. Everything stays on this device.
 */
export function ContactsSheet({
  workers, contacts, focus, onChange, onClose,
}: {
  workers: string[];
  contacts: Contacts;
  /** Opened from a swap match: show just this person first. */
  focus?: string;
  onChange: (contacts: Contacts) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(focus ?? "");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [unmatched, setUnmatched] = useState<ContactEntry[]>([]);
  const [notice, setNotice] = useState("");
  const picker = contactPicker();
  const screenshotInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState("");

  const sorted = useMemo(() => [...workers].sort((a, b) => a.localeCompare(b)), [workers]);
  const shown = sorted.filter((worker) =>
    !query.trim() || worker.toLowerCase().includes(query.trim().toLowerCase()));
  const saved = workers.filter((worker) => {
    const contact = contacts[contactKey(worker)];
    return Boolean(contact?.email || contact?.phone);
  }).length;

  const addEntries = (entries: ContactEntry[]) => {
    const matched: Array<{ worker: string; email?: string; phone?: string }> = [];
    const leftover: ContactEntry[] = [];
    for (const entry of entries) {
      const worker = matchContact(entry, workers);
      if (worker) matched.push({ worker, email: entry.email, phone: entry.phone });
      else leftover.push(entry);
    }
    if (matched.length) onChange(mergeContacts(contacts, matched));
    setUnmatched(leftover);
    setNotice(
      `Added ${matched.length} ${matched.length === 1 ? "person" : "people"}` +
      (leftover.length ? ` · ${leftover.length} to match below` : ""),
    );
  };

  const update = (worker: string, field: "email" | "phone", value: string) => {
    const key = contactKey(worker);
    const next = { ...contacts, [key]: { ...contacts[key], [field]: value || undefined } };
    if (!next[key].email && !next[key].phone) delete next[key];
    onChange(next);
  };

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet contacts-sheet" role="dialog" aria-modal="true" aria-label="Coworker contacts">
        <header className="sheet-head">
          <div>
            <h2>Coworker contacts</h2>
            <p>For quick swap emails and texts. Saved only on this phone.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close coworker contacts"><X /></button>
        </header>
        <div className="sheet-scroll">
          <div className="contacts-quick">
            {picker && (
              <button
                type="button"
                className="button soft"
                onClick={async () => {
                  try {
                    const picked = await picker.select(["name", "email", "tel"], { multiple: true });
                    addEntries(picked.map((person) => ({
                      name: person.name?.[0] ?? "",
                      email: tidyEmail(person.email?.[0] ?? "") || undefined,
                      phone: tidyPhone(person.tel?.[0] ?? "") || undefined,
                    })).filter((entry) => entry.email || entry.phone));
                  } catch {
                    setNotice("Contacts couldn’t be opened. Paste a list instead.");
                  }
                }}
              >
                <ContactIcon /> Pick from contacts
              </button>
            )}
            <button
              type="button"
              className="button soft"
              disabled={Boolean(reading)}
              onClick={() => screenshotInput.current?.click()}
            >
              <ImageIcon /> {reading || "Screenshots"}
            </button>
            <button type="button" className="button soft" onClick={() => setPasting((open) => !open)}>
              <ClipboardPaste /> Paste a list
            </button>
            <input
              ref={screenshotInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label="Member list screenshots"
              onChange={async (event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (!files.length) return;
                setNotice("");
                setReading("Reading…");
                try {
                  const { readContactScreenshots } = await import("./contacts-ocr");
                  const entries = await readContactScreenshots(files, (done, total) =>
                    setReading(total > 1 ? `Reading ${Math.min(done + 1, total)} of ${total}…` : "Reading…"));
                  if (entries.length) addEntries(entries);
                  else setNotice("No emails found in those screenshots. Try zooming in so the text is larger.");
                } catch {
                  setNotice("The screenshots couldn’t be read. Paste a list instead.");
                } finally {
                  setReading("");
                }
              }}
            />
          </div>
          <p className="contacts-hint">
            Screenshots of a member list (like an Outlook group) work: each name with its email below.
            They’re read on this phone.
          </p>
          {pasting && (
            <div className="contacts-paste">
              <textarea
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                rows={5}
                placeholder={"One person per line, in any order:\nLandon Weber, landon@email.com, 610-555-1234\nNicole Watson 484-555-9876"}
                aria-label="Pasted contacts"
              />
              <button
                type="button"
                className="button primary"
                disabled={!pasted.trim()}
                onClick={() => {
                  const entries = parseContactLines(pasted);
                  if (!entries.length) {
                    setNotice("No emails or phone numbers found in that text.");
                    return;
                  }
                  addEntries(entries);
                  setPasted("");
                  setPasting(false);
                }}
              >
                Add
              </button>
            </div>
          )}
          {notice && <p className="contacts-notice" role="status">{notice}</p>}

          {unmatched.length > 0 && (
            <div className="contacts-unmatched">
              <h3>Who is this?</h3>
              {unmatched.map((entry, index) => (
                <label key={`${entry.name}-${index}`}>
                  <span>
                    <b>{entry.name || "No name"}</b>
                    <small>{[entry.email, entry.phone && formatPhone(entry.phone)].filter(Boolean).join(" · ")}</small>
                  </span>
                  <select
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      onChange(mergeContacts(contacts, [{ worker: event.target.value, email: entry.email, phone: entry.phone }]));
                      setUnmatched((current) => current.filter((_, i) => i !== index));
                    }}
                  >
                    <option value="">Choose…</option>
                    {sorted.map((worker) => <option key={worker} value={worker}>{worker}</option>)}
                  </select>
                </label>
              ))}
              <button type="button" className="contacts-skip" onClick={() => setUnmatched([])}>Skip the rest</button>
            </div>
          )}

          <div className="contacts-list-head">
            <label className="contacts-search">
              <Search />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search coworkers"
                aria-label="Search coworkers"
              />
            </label>
            <small>{saved} of {workers.length} saved</small>
          </div>
          <ul className="contacts-list">
            {shown.map((worker) => {
              const contact = contacts[contactKey(worker)] ?? {};
              return (
                <li key={worker}>
                  <b>{worker}</b>
                  <label>
                    <Mail aria-hidden="true" />
                    <input
                      key={contact.email ?? ""}
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      placeholder="Email"
                      defaultValue={contact.email ?? ""}
                      aria-label={`${worker} email`}
                      onBlur={(event) => {
                        const value = tidyEmail(event.target.value);
                        if (event.target.value.trim() && !value) return;
                        if (value !== (contact.email ?? "")) update(worker, "email", value);
                      }}
                    />
                  </label>
                  <label>
                    <MessageSquare aria-hidden="true" />
                    <input
                      key={contact.phone ?? ""}
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      placeholder="Phone"
                      defaultValue={contact.phone ? formatPhone(contact.phone) : ""}
                      aria-label={`${worker} phone`}
                      onBlur={(event) => {
                        const value = tidyPhone(event.target.value);
                        if (event.target.value.trim() && !value) return;
                        if (value !== (contact.phone ?? "")) update(worker, "phone", value);
                      }}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          {!workers.length && (
            <p className="contacts-notice">Import a schedule first so names can be matched.</p>
          )}
        </div>
      </section>
    </div>
  );
}
