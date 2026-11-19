"use client";

import {
  ChevronDown, FileText, Image as ImageIcon, Mail, MessageSquare, Phone, Plus, Search, Smartphone, Trash2, UserPlus, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { backdropClose } from "./home-sections";
import {
  callLink,
  departmentsOf,
  entryName,
  formatDirectoryPhone,
  mergeDirectory,
  newEntryId,
  searchDirectory,
  applyKnownNames,
  withCoworkers,
  COWORKERS,
  type DirectoryEntry,
} from "./directory-data";
import type { Contacts } from "./contacts-data";
import { ReadingBar } from "./reading-bar";
import { AddMenu, SearchToggle } from "./sheet-tools";
import { TeamSendPrompt } from "./share-sheet";
import type { Team } from "./team";
import { coolReader, warmReader } from "./ocr-reader";
import type { ReadProgress } from "./read-progress";

type Draft = Omit<DirectoryEntry, "id" | "check"> & { id?: string; coworker?: string; fromSchedule?: boolean };

const FIELDS: Array<[Exclude<keyof Draft, "id" | "coworker" | "fromSchedule">, string, string]> = [
  ["first", "First name", "text"],
  ["last", "Last name", "text"],
  ["line", "Or a shared line (e.g. Operations Center)", "text"],
  ["department", "Department", "text"],
  ["title", "Title", "text"],
  ["phone", "Phone", "tel"],
  ["ext", "Ext", "tel"],
  ["cell", "Cell", "tel"],
  ["email", "Email", "email"],
];

function EntryForm({ draft, departments, onSave, onCancel }: {
  draft: Draft;
  departments: string[];
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<Draft>(draft);
  const named = Boolean(value.first?.trim() || value.last?.trim() || value.line?.trim());
  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (named) onSave(value);
      }}
    >
      <datalist id="directory-departments">
        {departments.map((department) => <option key={department} value={department} />)}
      </datalist>
      {FIELDS.map(([field, label, type]) => (
        <label key={field} className={`directory-field field-${field}`}>
          <span>{label}</span>
          <input
            type={type}
            inputMode={type === "tel" ? "tel" : undefined}
            list={field === "department" ? "directory-departments" : undefined}
            value={value[field] ?? ""}
            onChange={(event) => setValue({ ...value, [field]: event.target.value })}
          />
        </label>
      ))}
      <div className="directory-form-actions">
        <button type="button" className="button soft" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button primary" disabled={!named}>Save</button>
      </div>
    </form>
  );
}

/**
 * The work phone directory: read from screenshots or a PDF of the list (on
 * this phone), or typed in. Search, department tabs, and one-tap calls
 * (the extension is dialed after a pause) and texts.
 */
export function DirectorySheet({ entries, workers, coworkers, contacts, team, onSendToTeam, onChange, onClose }: {
  entries: DirectoryEntry[];
  /** Names on your schedules, for spelling ("LABARRE" → "LaBarre"). */
  workers: string[];
  /** Everyone you work with; they're always in the directory. */
  coworkers: string[];
  contacts: Contacts;
  /** After an import, offers to send the directory to this team. */
  team?: Team | null;
  onSendToTeam?: () => Promise<number>;
  onChange: (entries: DirectoryEntry[]) => void;
  onClose: () => void;
}) {
  const [offerTeam, setOfferTeam] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [department, setDepartment] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [reading, setReading] = useState<ReadProgress | null>(null);
  // A reader warmed by the + menu but never used is shut down with the sheet.
  useEffect(() => coolReader, []);
  const [notice, setNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const images = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);

  const everyone = useMemo(() => withCoworkers(entries, coworkers, contacts), [contacts, coworkers, entries]);
  const departments = useMemo(() => departmentsOf(entries).filter((item) => item !== COWORKERS), [entries]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of everyone) if (entry.department) map.set(entry.department, (map.get(entry.department) ?? 0) + 1);
    map.set(COWORKERS, everyone.filter((entry) => entry.coworker || entry.department === COWORKERS).length);
    return map;
  }, [everyone]);
  const shown = useMemo(() => department === COWORKERS
    ? searchDirectory(everyone.filter((entry) => entry.coworker || entry.department === COWORKERS), query, null)
      .sort((a, b) => (a.last ?? a.first ?? "").localeCompare(b.last ?? b.first ?? "") || (a.first ?? "").localeCompare(b.first ?? ""))
    : searchDirectory(everyone, query, department), [department, everyone, query]);
  const tabs = [null, ...(counts.get(COWORKERS) ? [COWORKERS] : []), ...departments];

  const importEntries = async (read: () => Promise<DirectoryEntry[]>) => {
    setNotice("");
    setReading({ label: "Starting the reader…", fraction: 0, secondsLeft: null });
    try {
      const found = applyKnownNames(await read(), workers);
      if (!found.length) {
        setNotice("No directory rows found. Make sure the column headings (LAST, FIRST, PHONE…) are in the first screenshot.");
        return;
      }
      const { entries: next, added, updated } = mergeDirectory(entries, found);
      onChange(next);
      if (added || updated) setOfferTeam((count) => count + 1);
      const toCheck = found.filter((entry) => entry.check?.length).length;
      setNotice(
        `Added ${added}${updated ? ` · updated ${updated}` : ""}` +
        (toCheck ? ` · ${toCheck} with a number to check` : ""),
      );
    } catch {
      setNotice("That couldn’t be read. Try clearer screenshots, or add people by hand.");
    } finally {
      setReading(null);
    }
  };

  const save = ({ coworker: _coworker, fromSchedule, ...draft }: Draft) => {
    void _coworker;
    if (fromSchedule) delete draft.id;
    const clean = Object.fromEntries(Object.entries(draft)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter(([, value]) => value)) as Draft;
    for (const field of ["phone", "cell"] as const) {
      if (clean[field]) clean[field] = formatDirectoryPhone(clean[field]!);
    }
    if (clean.ext) clean.ext = clean.ext.replace(/\D/g, "");
    if (clean.line) {
      delete clean.first;
      delete clean.last;
    }
    const entry: DirectoryEntry = { ...clean, id: draft.id ?? newEntryId() };
    onChange(draft.id ? entries.map((item) => item.id === draft.id ? entry : item) : [...entries, entry]);
    setEditing(null);
    setOpen(entry.id);
  };

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet directory-sheet" role="dialog" aria-modal="true" aria-label="Directory">
        <header className="sheet-head sheet-head-tools">
          <h2>{editing ? (editing.id && !editing.fromSchedule ? "Edit" : "Add to directory") : "Directory"}</h2>
          <div className="sheet-tools">
            {!editing && everyone.length > 0 && (
              <SearchToggle
                open={searching}
                label="Search the directory"
                onToggle={() => {
                  if (searching) setQuery("");
                  setSearching(!searching);
                }}
              />
            )}
            {!editing && (
              <AddMenu
                label="Add to the directory"
                onOpen={() => void warmReader().catch(() => undefined)}
                busy={Boolean(reading)}
                note="Screenshot each page of the directory and pick them all at once. Read and saved only on this phone."
                items={[
                  { icon: ImageIcon, label: "Screenshots", onSelect: () => images.current?.click() },
                  { icon: FileText, label: "PDF", onSelect: () => pdf.current?.click() },
                  { icon: UserPlus, label: "Add by hand", onSelect: () => setEditing({ department: department && department !== COWORKERS ? department : undefined }) },
                ]}
              />
            )}
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close directory"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {editing ? (
            <EntryForm draft={editing} departments={departments} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <>
              <div hidden>
                <input
                  ref={images}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  aria-label="Directory screenshots"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (!files.length) return;
                    void importEntries(async () => {
                      const { readDirectoryImages } = await import("./directory-ocr");
                      return readDirectoryImages(files, setReading);
                    });
                  }}
                />
                <input
                  ref={pdf}
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  aria-label="Directory PDF"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void importEntries(async () => {
                      const { readDirectoryPdf } = await import("./directory-ocr");
                      return readDirectoryPdf(file, setReading);
                    });
                  }}
                />
              </div>
              {reading && <ReadingBar progress={reading} />}
              {!everyone.length && !notice && !reading && (
                <div className="sheet-empty">
                  <p>No one here yet</p>
                  <small>
                    Tap <Plus aria-label="plus" /> to add screenshots of the directory (LAST · FIRST · DEPARTMENT ·
                    TITLE · PHONE · EXT · CELL), its PDF, or people by hand.
                  </small>
                </div>
              )}
              {notice && <p className="contacts-notice" role="status">{notice}</p>}
              {team && onSendToTeam && offerTeam > 0 && !reading && (
                <TeamSendPrompt key={offerTeam} team={team} what="the directory" onSend={onSendToTeam} />
              )}

              {everyone.length > 0 && (
                <>
                  {searching && (
                    <label className="contacts-search">
                      <Search />
                      <input
                        type="search"
                        value={query}
                        autoFocus
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search names, titles, numbers"
                        aria-label="Search the directory"
                      />
                    </label>
                  )}
                  <div className="directory-tabs" role="tablist" aria-label="Departments">
                    {tabs.map((item) => (
                      <button
                        key={item ?? "all"}
                        type="button"
                        role="tab"
                        aria-selected={department === item}
                        className={department === item ? "active" : ""}
                        onClick={() => setDepartment(item)}
                      >
                        {item ?? "All"} <small>{item ? counts.get(item) : everyone.length}</small>
                      </button>
                    ))}
                  </div>
                  <ul className="directory-list">
                    {shown.map((entry, index) => {
                      const showHeading = !department && entry.department !== shown[index - 1]?.department;
                      const expanded = open === entry.id;
                      return (
                        <li key={entry.id} className={`${entry.line ? "is-line" : ""}${expanded ? " open" : ""}`}>
                          {showHeading && <h3 className="directory-heading">{entry.department ?? "No department"}</h3>}
                          <div className="directory-row">
                            <button type="button" className="directory-name" onClick={() => setOpen(expanded ? null : entry.id)} aria-expanded={expanded}>
                              <b>{entryName(entry)}</b>
                              {department === COWORKERS
                                ? (entry.department !== COWORKERS || entry.title) && (
                                  <small>{[entry.department !== COWORKERS && entry.department, entry.title].filter(Boolean).join(" · ")}</small>
                                )
                                : (entry.title || (department && entry.line)) && <small>{entry.title}</small>}
                              {entry.check?.length ? <i className="directory-check">Check number</i> : null}
                            </button>
                            <div className="directory-actions">
                              {entry.phone && (
                                <a href={callLink(entry.phone, entry.ext)} aria-label={`Call ${entryName(entry)}${entry.ext ? ` at extension ${entry.ext}` : ""}`}>
                                  <Phone />
                                </a>
                              )}
                              {!entry.phone && !entry.cell && entry.email && (
                                <a href={`mailto:${entry.email}`} aria-label={`Email ${entryName(entry)}`}><Mail /></a>
                              )}
                              {entry.cell && (
                                <>
                                  <a href={callLink(entry.cell)} aria-label={`Call ${entryName(entry)}'s cell`}><Smartphone /></a>
                                  <a href={`sms:${entry.cell.replace(/\D/g, "")}`} aria-label={`Text ${entryName(entry)}`}><MessageSquare /></a>
                                </>
                              )}
                              <ChevronDown className="directory-chevron" aria-hidden="true" />
                            </div>
                          </div>
                          {expanded && (
                            <div className="directory-details">
                              <dl>
                                {entry.department && <div><dt>Department</dt><dd>{entry.department}</dd></div>}
                                {entry.phone && (
                                  <div><dt>Phone</dt><dd>
                                    <a href={callLink(entry.phone, entry.ext)}>{entry.phone}{entry.ext ? ` · ext ${entry.ext}` : ""}</a>
                                    {entry.check?.some((field) => field === "phone" || field === "ext") && <i className="directory-check">Check</i>}
                                  </dd></div>
                                )}
                                {!entry.phone && entry.ext && <div><dt>Ext</dt><dd>{entry.ext}</dd></div>}
                                {entry.cell && (
                                  <div><dt>Cell</dt><dd>
                                    <a href={callLink(entry.cell)}>{entry.cell}</a>
                                    {entry.check?.includes("cell") && <i className="directory-check">Check</i>}
                                  </dd></div>
                                )}
                                {entry.email && <div><dt>Email</dt><dd><a href={`mailto:${entry.email}`}>{entry.email}</a></dd></div>}
                              </dl>
                              {entry.fromSchedule && (
                                <p className="directory-from-schedule">From your schedules. Edit to save them with a department and numbers.</p>
                              )}
                              <div className="directory-detail-actions">
                                <button type="button" className="button soft" onClick={() => setEditing(entry)}>Edit</button>
                                {!entry.fromSchedule && <button
                                  type="button"
                                  className="button soft danger-text"
                                  onClick={() => {
                                    onChange(entries.filter((item) => item.id !== entry.id));
                                    setOpen(null);
                                  }}
                                >
                                  Delete
                                </button>}
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {!shown.length && <p className="contacts-notice">Nobody matches that search.</p>}
                  <button
                    type="button"
                    className="button danger subtle upload-clear-all"
                    onClick={() => {
                      if (!confirmClear) {
                        setConfirmClear(true);
                        return;
                      }
                      onChange([]);
                      setConfirmClear(false);
                      setNotice("");
                    }}
                    onBlur={() => setConfirmClear(false)}
                  >
                    <Trash2 /> {confirmClear ? "Tap again to clear the directory" : "Clear directory"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
