"use client";

import { BookUser, ClipboardPaste, Contact as ContactIcon, Image as ImageIcon, Mail, MessageSquare, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { backdropClose } from "./home-sections";
import { addPeopleToDirectory, type DirectoryEntry } from "./directory-data";
import { ReadingBar } from "./reading-bar";
import { AddMenu, SearchToggle } from "./sheet-tools";
import { TeamSendPrompt } from "./share-sheet";
import type { Team } from "./team";
import { coolReader, warmReader } from "./ocr-reader";
import type { ReadProgress } from "./read-progress";
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
  workers, contacts, focus, onChange, directory, onDirectoryChange, team, onSendToTeam, onClose,
}: {
  workers: string[];
  contacts: Contacts;
  /** People who aren't on your schedules can go to the Directory instead. */
  directory: DirectoryEntry[];
  onDirectoryChange: (entries: DirectoryEntry[]) => void;
  /** After an import, offers to send coworker contacts to this team. */
  team?: Team | null;
  onSendToTeam?: (to: string[]) => Promise<number>;
  /** Opened from a swap match: show just this person first. */
  focus?: string;
  onChange: (contacts: Contacts) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(focus ?? "");
  const [offerTeam, setOfferTeam] = useState(0);
  const [searching, setSearching] = useState(Boolean(focus));
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [unmatched, setUnmatched] = useState<ContactEntry[]>([]);
  const [notice, setNotice] = useState("");
  const picker = contactPicker();
  const screenshotInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<ReadProgress | null>(null);
  // A reader warmed by the + menu but never used is shut down with the sheet.
  useEffect(() => coolReader, []);
  const toDirectory = useMemo(() => addPeopleToDirectory(directory, unmatched), [directory, unmatched]);
  const directoryCount = toDirectory.added + toDirectory.updated;

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
    if (matched.length) {
      onChange(mergeContacts(contacts, matched));
      setOfferTeam((count) => count + 1);
    }
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
        <header className="sheet-head sheet-head-tools">
          <h2>
            Coworker contacts
            {workers.length > 0 && <small aria-label={`${saved} of ${workers.length} saved`}>{saved}/{workers.length}</small>}
          </h2>
          <div className="sheet-tools">
            <SearchToggle
              open={searching}
              label="Search coworkers"
              onToggle={() => {
                if (searching) setQuery("");
                setSearching(!searching);
              }}
            />
            <AddMenu
              label="Add emails and numbers"
                onOpen={() => void warmReader().catch(() => undefined)}
              busy={Boolean(reading)}
              note="Member list screenshots (like an Outlook group) work: each name with its email below. Read and saved only on this phone."
              items={[
                ...(picker ? [{
                  icon: ContactIcon,
                  label: "Pick from contacts",
                  onSelect: async () => {
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
                  },
                }] : []),
                { icon: ImageIcon, label: "Screenshots", onSelect: () => screenshotInput.current?.click() },
                { icon: ClipboardPaste, label: "Paste a list", onSelect: () => setPasting(true) },
              ]}
            />
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close coworker contacts"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {searching && (
            <label className="contacts-search">
              <Search />
              <input
                type="search"
                value={query}
                autoFocus={!focus}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search coworkers"
                aria-label="Search coworkers"
              />
            </label>
          )}
          <div hidden>
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
                setReading({ label: "Starting the reader…", fraction: 0, secondsLeft: null });
                try {
                  const { readContactScreenshots } = await import("./contacts-ocr");
                  const entries = await readContactScreenshots(files, setReading);
                  if (entries.length) addEntries(entries);
                  else setNotice("No emails found in those screenshots. Try zooming in so the text is larger.");
                } catch {
                  setNotice("The screenshots couldn’t be read. Paste a list instead.");
                } finally {
                  setReading(null);
                }
              }}
            />
          </div>
          {pasting && (
            <div className="contacts-paste">
              <textarea
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                rows={5}
                placeholder={"One person per line, in any order:\nLandon Weber, landon@email.com, 610-555-1234\nNicole Watson 484-555-9876"}
                aria-label="Pasted contacts"
                autoFocus
              />
              <div className="contacts-paste-actions">
                <button type="button" className="button soft" onClick={() => { setPasting(false); setPasted(""); }}>Cancel</button>
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
            </div>
          )}
          {reading && <ReadingBar progress={reading} />}
          {notice && <p className="contacts-notice" role="status">{notice}</p>}
          {team && onSendToTeam && offerTeam > 0 && !reading && (
            <TeamSendPrompt key={offerTeam} team={team} what="coworker contacts" onSend={onSendToTeam} />
          )}

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
              <div className="contacts-unmatched-actions">
                {directoryCount > 0 && (
                  <button
                    type="button"
                    className="button soft contacts-to-directory"
                    onClick={() => {
                      onDirectoryChange(toDirectory.entries);
                      setUnmatched([]);
                      setNotice(
                        [
                          toDirectory.added && `Added ${toDirectory.added} to Directory`,
                          toDirectory.updated && `filled in ${toDirectory.updated} already there`,
                        ].filter(Boolean).join(" · "),
                      );
                    }}
                  >
                    <BookUser /> Add {directoryCount === unmatched.length && directoryCount > 1 ? "all" : directoryCount} to Directory
                  </button>
                )}
                <button type="button" className="contacts-skip" onClick={() => setUnmatched([])}>Skip the rest</button>
              </div>
            </div>
          )}

          {searching && query.trim() && !shown.length && <p className="contacts-notice">Nobody matches that search.</p>}
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
