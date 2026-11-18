"use client";

import { BookUser, CalendarDays, Check, Copy, Link2, LoaderCircle, Share2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { backdropClose } from "./home-sections";
import type { Contacts } from "./contacts-data";
import type { DirectoryEntry } from "./directory-data";
import {
  firstName,
  mergeSharedContacts,
  mergeSharedDirectory,
  mergeSummary,
  weekLabel,
  type ShareManifest,
} from "./share-data";
import { createShareLink, shareableSchedule, shareInText, type CreatedShare, type ShareKey } from "./share-link";

export type ShareableDocument = { id: string; hash: string; name: string; dates: string[]; mimeType?: string };

const contactCount = (contacts: Contacts) =>
  Object.values(contacts).filter((contact) => contact?.email || contact?.phone).length;

const untilLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

function Choice({ on, onToggle, icon: Icon, title, detail, disabled }: {
  on: boolean;
  onToggle: () => void;
  icon: typeof Users;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      className={`share-choice${on ? " on" : ""}`}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="share-choice-icon"><Icon /></span>
      <span className="share-choice-copy">
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <span className="share-check" aria-hidden="true">{on && <Check />}</span>
    </button>
  );
}

/* ---------- sending ---------- */

export function ShareSheet({ schedules, today, directory, contacts, person, service, appUrl, loadFile, onOpenLink, onClose }: {
  schedules: ShareableDocument[];
  today: string;
  directory: DirectoryEntry[];
  contacts: Contacts;
  person: string;
  service: string;
  appUrl: string;
  loadFile: (id: string) => Promise<Blob | undefined>;
  /** A share link someone sent, pasted here (iPhone links open in Safari, not the app). */
  onOpenLink: (share: ShareKey) => void;
  onClose: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const pastedShare = shareInText(pasted);
  const sorted = useMemo(() =>
    [...schedules].sort((a, b) => ([...b.dates].sort()[0] ?? "").localeCompare([...a.dates].sort()[0] ?? "")),
  [schedules]);
  // This week and later go by default; older weeks are one tap away.
  const [weeks, setWeeks] = useState<Set<string>>(() => {
    const current = sorted.filter((document) => document.dates.some((date) => date >= today));
    return new Set((current.length ? current : sorted.slice(0, 1)).map((document) => document.id));
  });
  const [withDirectory, setWithDirectory] = useState(directory.length > 0);
  const [withContacts, setWithContacts] = useState(contactCount(contacts) > 0);
  const [days, setDays] = useState<1 | 7>(7);
  const [state, setState] = useState<"idle" | "making" | "error">("idle");
  const [error, setError] = useState("");
  const [made, setMade] = useState<CreatedShare | null>(null);
  const [copied, setCopied] = useState(false);

  const picked = sorted.filter((document) => weeks.has(document.id));
  const nothing = !picked.length && !withDirectory && !withContacts;
  const what = [
    picked.length && (picked.length === 1 ? "a schedule" : "schedules"),
    withDirectory && "the directory",
    withContacts && "coworker contacts",
  ].filter(Boolean) as string[];
  const whatText = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what.at(-1)}` : what[0] ?? "";

  const make = async () => {
    setState("making");
    setError("");
    try {
      const files: Blob[] = [];
      const shared: NonNullable<ShareManifest["schedules"]> = [];
      for (const document of picked) {
        const original = await loadFile(document.id);
        if (!original) continue;
        const file = await shareableSchedule(original);
        files.push(file);
        shared.push({
          name: document.name,
          type: file.type || document.mimeType || "application/octet-stream",
          dates: document.dates,
          hash: document.hash,
          size: file.size,
        });
      }
      if (picked.length && !shared.length && !withDirectory && !withContacts) {
        throw new Error("The schedule photos aren’t on this phone anymore. Import them again to share.");
      }
      const manifest: ShareManifest = {
        v: 1,
        from: firstName(person),
        createdAt: new Date().toISOString(),
        ...(shared.length ? { schedules: shared } : {}),
        ...(withDirectory ? { directory } : {}),
        ...(withContacts ? { contacts } : {}),
      };
      setMade(await createShareLink({ manifest, files }, { service, appUrl, days }));
      setState("idle");
    } catch (problem) {
      setState("error");
      setError(problem instanceof Error ? problem.message : "The link couldn’t be made. Try again.");
    }
  };

  const message = `${firstName(person) || "A coworker"} shared ${whatText} on Shiftdeck. Open this on your phone to add it:`;

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet" role="dialog" aria-modal="true" aria-label="Share with coworkers">
        <header className="sheet-head sheet-head-tools">
          <h2>Share with coworkers</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close sharing"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {made ? (
            <div className="share-done">
              <span className="share-done-icon"><Link2 /></span>
              <p>Your link is ready</p>
              <small>
                Works until {untilLabel(made.expiresAt)}. It’s locked with a key that’s only in the link,
                so anyone you send it to can open it, and nobody else.
              </small>
              <code>{made.url}</code>
              <div className="share-done-actions">
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void navigator.share({ title: "Shiftdeck", text: message, url: made.url }).catch(() => undefined)}
                  >
                    <Share2 /> Send
                  </button>
                )}
                <button
                  type="button"
                  className="button soft"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${message}\n${made.url}`);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1800);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <button type="button" className="share-again" onClick={() => setMade(null)}>Make a different link</button>
            </div>
          ) : (
            <>
              <p className="share-section-title">Schedules</p>
              {sorted.length ? (
                <div className="share-weeks">
                  {sorted.map((document) => {
                    const on = weeks.has(document.id);
                    return (
                      <button
                        key={document.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        className={`share-week${on ? " on" : ""}`}
                        onClick={() => setWeeks((current) => {
                          const next = new Set(current);
                          if (next.has(document.id)) next.delete(document.id);
                          else next.add(document.id);
                          return next;
                        })}
                      >
                        <CalendarDays aria-hidden="true" />
                        {weekLabel(document.dates)}
                        <span className="share-check" aria-hidden="true">{on && <Check />}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="quiet-line">Import a schedule to share it.</p>
              )}
              <p className="share-section-title">Also send</p>
              <div className="share-choices">
                <Choice
                  on={withDirectory}
                  onToggle={() => setWithDirectory(!withDirectory)}
                  icon={BookUser}
                  title="Directory"
                  detail={directory.length ? `${directory.length} people & lines` : "Nothing saved yet"}
                  disabled={!directory.length}
                />
                <Choice
                  on={withContacts}
                  onToggle={() => setWithContacts(!withContacts)}
                  icon={Users}
                  title="Coworker contacts"
                  detail={contactCount(contacts) ? `${contactCount(contacts)} emails & numbers` : "Nothing saved yet"}
                  disabled={!contactCount(contacts)}
                />
              </div>
              <div className="share-expiry">
                <span>Link works for</span>
                <div role="radiogroup" aria-label="Link works for">
                  {([1, 7] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={days === value}
                      className={days === value ? "active" : ""}
                      onClick={() => setDays(value)}
                    >
                      {value === 1 ? "1 day" : "1 week"}
                    </button>
                  ))}
                </div>
              </div>
              {state === "error" && <p className="contacts-notice share-error" role="alert">{error}</p>}
              <button type="button" className="button primary share-make" disabled={nothing || state === "making"} onClick={() => void make()}>
                {state === "making" ? <><LoaderCircle className="spin" /> Locking & uploading…</> : <><Link2 /> Make link</>}
              </button>
              <p className="share-note">
                Everything is encrypted on this phone first and deleted from the server when the link expires.
                When it’s opened, their phone keeps what it already has and adds only what’s new.
              </p>
              <p className="share-section-title">Got a link from someone?</p>
              <div className="share-paste">
                <input
                  type="url"
                  inputMode="url"
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="Paste it here"
                  aria-label="Paste a share link"
                />
                <button type="button" className="button soft" disabled={!pastedShare} onClick={() => pastedShare && onOpenLink(pastedShare)}>
                  Open
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------- receiving ---------- */

export type OpenedShare = { manifest: ShareManifest; files: Blob[]; expiresAt: string };

export type SharedImport = {
  directory?: DirectoryEntry[];
  contacts?: Contacts;
  files: File[];
  summary: string[];
};

export function SharedImportSheet({ share, error, loading, link, haveWeek, directory, contacts, onImport, onClose }: {
  share: OpenedShare | null;
  error: string;
  loading: boolean;
  /** On an iPhone in Safari: the link to paste into the Home Screen app instead. */
  link?: string;
  /** Whether this phone already has that week (the same photo or the same dates). */
  haveWeek: (schedule: NonNullable<ShareManifest["schedules"]>[number]) => boolean;
  directory: DirectoryEntry[];
  contacts: Contacts;
  onImport: (result: SharedImport) => void;
  onClose: () => void;
}) {
  const manifest = share?.manifest;
  const schedules = useMemo(() => manifest?.schedules ?? [], [manifest]);
  const directoryMerge = useMemo(() =>
    manifest?.directory ? mergeSharedDirectory(directory, manifest.directory) : null, [directory, manifest]);
  const contactsMerge = useMemo(() =>
    manifest?.contacts ? mergeSharedContacts(contacts, manifest.contacts) : null, [contacts, manifest]);
  const [weeks, setWeeks] = useState<Set<number> | null>(null);
  const [skipDirectory, setSkipDirectory] = useState(false);
  const [skipContacts, setSkipContacts] = useState(false);
  // New weeks are picked; weeks already on this phone are left off.
  const pickedWeeks = weeks ?? new Set(schedules.map((_, index) => index).filter((index) => !haveWeek(schedules[index])));
  const useDirectory = Boolean(directoryMerge && (directoryMerge.added || directoryMerge.updated) && !skipDirectory);
  const useContacts = Boolean(contactsMerge && (contactsMerge.added || contactsMerge.updated) && !skipContacts);
  const nothing = !pickedWeeks.size && !useDirectory && !useContacts;
  const from = manifest?.from || "A coworker";

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet" role="dialog" aria-modal="true" aria-label="Shared with you">
        <header className="sheet-head sheet-head-tools">
          <h2>{manifest ? `From ${from}` : "Shared with you"}</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {loading && (
            <div className="sheet-empty">
              <LoaderCircle className="spin share-loading" />
              <p>Opening the share…</p>
              <small>Unlocking it on this phone.</small>
            </div>
          )}
          {!loading && error && (
            <div className="sheet-empty">
              <p>Couldn’t open this link</p>
              <small>{error}</small>
            </div>
          )}
          {!loading && link && (
            <div className="share-iphone">
              <b>Use Shiftdeck from your Home Screen?</b>
              <small>
                iPhone opens links in Safari, which keeps its own copy of the app. Copy this link, open
                Shiftdeck from its icon, then paste it in Settings → Share with coworkers.
              </small>
              <button type="button" className="button soft" onClick={() => void navigator.clipboard?.writeText(link).catch(() => undefined)}>
                <Copy /> Copy link
              </button>
            </div>
          )}
          {!loading && manifest && (
            <>
              {schedules.length > 0 && (
                <>
                  <p className="share-section-title">Schedules</p>
                  <div className="share-choices">
                    {schedules.map((schedule, index) => {
                      const have = haveWeek(schedule);
                      const on = pickedWeeks.has(index);
                      return (
                        <Choice
                          key={`${schedule.hash}-${index}`}
                          on={on}
                          icon={CalendarDays}
                          title={weekLabel(schedule.dates)}
                          detail={have ? (on ? "Replaces your copy of this week" : "You already have this week") : "New"}
                          onToggle={() => {
                            const next = new Set(pickedWeeks);
                            if (on) next.delete(index);
                            else next.add(index);
                            setWeeks(next);
                          }}
                        />
                      );
                    })}
                  </div>
                </>
              )}
              {(directoryMerge || contactsMerge) && <p className="share-section-title">Also shared</p>}
              <div className="share-choices">
                {directoryMerge && (
                  <Choice
                    on={useDirectory}
                    icon={BookUser}
                    title="Directory"
                    detail={mergeSummary(directoryMerge)}
                    disabled={!directoryMerge.added && !directoryMerge.updated}
                    onToggle={() => setSkipDirectory(!skipDirectory)}
                  />
                )}
                {contactsMerge && (
                  <Choice
                    on={useContacts}
                    icon={Users}
                    title="Coworker contacts"
                    detail={mergeSummary(contactsMerge)}
                    disabled={!contactsMerge.added && !contactsMerge.updated}
                    onToggle={() => setSkipContacts(!skipContacts)}
                  />
                )}
              </div>
              <button
                type="button"
                className="button primary share-make"
                disabled={nothing}
                onClick={() => {
                  const files = schedules.flatMap((schedule, index) => {
                    if (!pickedWeeks.has(index) || !share.files[index]) return [];
                    const extension = schedule.type === "application/pdf" ? "pdf" : schedule.type === "image/png" ? "png" : "jpg";
                    return [new File([share.files[index]], `${from}’s schedule ${weekLabel(schedule.dates)}.${extension}`, { type: schedule.type })];
                  });
                  onImport({
                    directory: useDirectory ? directoryMerge!.entries : undefined,
                    contacts: useContacts ? contactsMerge!.contacts : undefined,
                    files,
                    summary: [
                      useDirectory && `Directory: ${mergeSummary({ ...directoryMerge!, same: 0 })}`,
                      useContacts && `Contacts: ${mergeSummary({ ...contactsMerge!, same: 0 })}`,
                    ].filter(Boolean) as string[],
                  });
                }}
              >
                {nothing ? "You already have all of this" : pickedWeeks.size ? "Import & verify my hours" : "Import"}
              </button>
              {pickedWeeks.size > 0 && (
                <p className="share-note">
                  The schedule is read on your phone, then you check your hours against the photo.
                </p>
              )}
              {share?.expiresAt && <p className="share-note">This link works until {untilLabel(share.expiresAt)}.</p>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
