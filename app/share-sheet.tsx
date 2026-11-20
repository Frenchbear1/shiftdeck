"use client";

import { Disclosure } from "./sheet-tools";
import { BookUser, CalendarDays, Check, ChevronDown, LoaderCircle, Send, UserPlus, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { backdropClose } from "./home-sections";
import type { Contacts } from "./contacts-data";
import type { DirectoryEntry } from "./directory-data";
import { contactCount, type ShareableDocument } from "./share-build";
import {
  firstName,
  mergeSharedContacts,
  mergeSharedDirectory,
  mergeSummary,
  weekLabel,
  type ShareManifest,
  type SharedRead,
} from "./share-data";
import { teammates, type Team } from "./team";

export type { ShareableDocument };

const untilLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};


/** Opens the phone's share menu, or copies when there isn't one. Returns true once copied. */
async function sendOrCopy(text: string, url: string) {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ title: "Shiftdeck", text, url });
      return false;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
    }
  }
  await navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => undefined);
  return true;
}

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

/* ---------- who gets it: everyone, or picked teammates ---------- */

/** Names for the picker: first names, unless two teammates share one. */
function pickerNames(people: Array<{ id: string; name: string }>) {
  const counts = new Map<string, number>();
  for (const person of people) counts.set(firstName(person.name), (counts.get(firstName(person.name)) ?? 0) + 1);
  return new Map(people.map((person) => [person.id, (counts.get(firstName(person.name)) ?? 0) > 1 ? person.name : firstName(person.name)]));
}

/** "Nicole" · "Nicole and Landon" · "3 teammates" */
export function recipientsLabel(team: Team, to: string[]) {
  if (!to.length) return team.name;
  const names = pickerNames(teammates(team));
  const picked = to.map((id) => names.get(id)).filter(Boolean) as string[];
  if (picked.length === 1) return picked[0];
  if (picked.length === 2) return `${picked[0]} and ${picked[1]}`;
  return `${picked.length} teammates`;
}

export function RecipientPicker({ team, value, onChange }: {
  team: Team;
  value: string[];
  onChange: (to: string[]) => void;
}) {
  const others = teammates(team);
  if (!others.length) return null;
  const names = pickerNames(others);
  return (
    <div className="share-to" role="group" aria-label="Send to">
      <span>To</span>
      <button type="button" aria-pressed={!value.length} className={!value.length ? "on" : ""} onClick={() => onChange([])}>
        Everyone
      </button>
      {others.map((person) => {
        const on = value.includes(person.id);
        return (
          <button
            key={person.id}
            type="button"
            aria-pressed={on}
            className={on ? "on" : ""}
            onClick={() => onChange(on ? value.filter((id) => id !== person.id) : [...value, person.id])}
          >
            {names.get(person.id)}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- inviting: anyone who opens the app and picks their name is on the team ---------- */

function InviteButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button soft share-make share-invite"
      onClick={async () => {
        const done = await sendOrCopy("Get Shiftdeck for our schedules. Open it, add it to your Home Screen, and pick your name:", url);
        if (done) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }
      }}
    >
      {copied ? <Check /> : <UserPlus />} {copied ? "Copied" : "Invite a coworker"}
    </button>
  );
}

const OLDER_BATCH = 8;
const shiftDay = (day: string, days: number) => {
  const at = new Date(`${day}T12:00:00`);
  at.setDate(at.getDate() + days);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

export function ShareSheet({
  schedules, today, directory, contacts, team, signedIn, inviteUrl, onSendToTeam, onClose,
}: {
  schedules: ShareableDocument[];
  today: string;
  directory: DirectoryEntry[];
  contacts: Contacts;
  /** Null until this phone has a name and the team key. */
  team: Team | null;
  /** This phone has picked its name. */
  signedIn: boolean;
  /** The app's address, to invite coworkers. */
  inviteUrl: string;
  /** Resolves with how many people got a notification. `to` empty = everyone. */
  /** Sends what's picked (`to` empty = everyone); may add it to your last send. */
  onSendToTeam: (part: { documentIds: string[]; directory: boolean; contacts: boolean }, to: string[]) => Promise<TeamSendResult>;
  onClose: () => void;
}) {
  const sorted = useMemo(() =>
    [...schedules].sort((a, b) => ([...b.dates].sort()[0] ?? "").localeCompare([...a.dates].sort()[0] ?? "")),
  [schedules]);
  // This week and later go by default; older weeks are one tap away.
  const [weeks, setWeeks] = useState<Set<string>>(() => {
    const current = sorted.filter((document) => document.dates.some((date) => date >= today));
    return new Set((current.length ? current : sorted.slice(0, 1)).map((document) => document.id));
  });
  // Off unless picked (in "Also send", closed to start).
  const [withDirectory, setWithDirectory] = useState(false);
  const [withContacts, setWithContacts] = useState(false);
  // Last week on shows; older weeks come a batch at a time with "Show more".
  const recentFrom = shiftDay(today, -7);
  const recent = sorted.filter((document) => document.dates.some((date) => date >= recentFrom));
  const older = sorted.filter((document) => !recent.includes(document));
  const [olderShown, setOlderShown] = useState(0);
  const shownWeeks = [...recent, ...older.slice(0, olderShown)];
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<(TeamSendResult & { to: string[] }) | null>(null);
  const [to, setTo] = useState<string[]>([]);

  const picked = sorted.filter((document) => weeks.has(document.id));
  const nothing = !picked.length && !withDirectory && !withContacts;

  const send = async () => {
    setState("sending");
    setError("");
    try {
      const result = await onSendToTeam({ documentIds: picked.map((document) => document.id), directory: withDirectory, contacts: withContacts }, to);
      setSent({ ...result, to });
      setState("idle");
    } catch (problem) {
      setState("error");
      setError(problem instanceof Error ? problem.message : "That couldn’t be sent. Try again.");
    }
  };

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet" role="dialog" aria-modal="true" aria-label="Team">
        <header className="sheet-head sheet-head-tools">
          <h2>Send to the team</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close team"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {sent ? (
            <div className="share-done">
              <span className="share-done-icon"><Send /></span>
              <p>{sent.added ? "Added to what you sent" : "Sent to"} {team ? recipientsLabel(team, sent.to) : ""}</p>
              <small>
                {sent.added
                  ? <>Still one notification: it now has {sent.what}.</>
                  : <>{sent.what.charAt(0).toUpperCase() + sent.what.slice(1)} is in {sent.to.length ? "their" : "everyone’s"} Notifications</>}
                {sent.notified ? `${sent.added ? " " : ", and "}${sent.notified} ${sent.notified === 1 ? "device" : "devices"} got a ping${sent.added ? "." : ""}` : ""}
                {sent.added ? "" : "."}
                {sent.to.length && !sent.added ? " Nobody else on the team sees it." : ""} {sent.added ? "" : "It’s there for a week."}
              </small>
              <button type="button" className="share-again" onClick={() => setSent(null)}>Send something else</button>
            </div>
          ) : (
            <>
              <div className="owner-head">
                <span className="share-choice-icon"><Users /></span>
                <span className="share-choice-copy">
                  <b>Everyone on Shiftdeck</b>
                  <small>
                    {!signedIn
                      ? "Pick your name in Settings to send and get schedules."
                      : !team
                        ? "Getting the team key from a coworker’s device. This takes a minute the first time."
                        : `${team.people.length} ${team.people.length === 1 ? "person" : "people"}. Send to everyone or pick who.`}
                  </small>
                </span>
              </div>
              {team && (
                <>
                  <p className="share-section-title">Schedules</p>
                  {sorted.length ? (
                    <div className="share-weeks">
                      {shownWeeks.map((document) => {
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
                      {olderShown < older.length && (
                        <button type="button" className="share-more" onClick={() => setOlderShown((count) => count + OLDER_BATCH)}>
                          <ChevronDown aria-hidden="true" />
                          Show more · {Math.min(OLDER_BATCH, older.length - olderShown)} older
                          {older.length - olderShown > OLDER_BATCH ? ` of ${older.length - olderShown}` : ""}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="quiet-line">Import a schedule to send it.</p>
                  )}
                  <Disclosure
                    icon={BookUser}
                    title="Also send"
                    className="share-also"
                    summary={[withDirectory && "Directory", withContacts && "Contacts"].filter(Boolean).join(" · ") || "Nothing"}
                  >
                  <div className="share-choices">
                    <Choice
                      on={withDirectory}
                      onToggle={() => setWithDirectory(!withDirectory)}
                      icon={BookUser}
                      title="Directory"
                      detail={directory.length ? `${directory.length} ${directory.length === 1 ? "entry" : "people & lines"}` : "Nothing saved yet"}
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
                  </Disclosure>
                  <RecipientPicker team={team} value={to} onChange={setTo} />
                  {state === "error" && <p className="contacts-notice share-error" role="alert">{error}</p>}
                  <button type="button" className="button primary share-make" disabled={nothing || state === "sending"} onClick={() => void send()}>
                    {state === "sending" ? <><LoaderCircle className="spin" /> Sending…</> : <><Send /> Send to {recipientsLabel(team, to)}</>}
                  </button>
                  <p className="share-note">
                    Encrypted on this device first, so only people on Shiftdeck can open it. Their devices keep what they
                    already have and add only what’s new. Imports also ask if you want to send them here.
                  </p>
                </>
              )}
              <InviteButton url={inviteUrl} />
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
  /** What the sender's phone read from each file (same order), so it isn't scanned again. */
  reads?: Array<SharedRead | undefined>;
  summary: string[];
  /** Who this phone belongs to, when it was picked here. */
  person?: string;
};

export function SharedImportSheet({ share, error, loading, person, haveWeek, directory, contacts, onImport, onAlreadyHave, onClose }: {
  /** Opened and there's nothing new in it: whatever pointed here can be cleared. */
  onAlreadyHave?: () => void;
  share: OpenedShare | null;
  error: string;
  loading: boolean;
  /** The name in Settings; when there isn't one, it's asked here, before reading. */
  person: string;
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
  const [chosen, setChosen] = useState<string | null>(null);
  // New weeks are picked; weeks already on this phone are left off.
  const pickedWeeks = weeks ?? new Set(schedules.map((_, index) => index).filter((index) => !haveWeek(schedules[index])));
  const useDirectory = Boolean(directoryMerge && (directoryMerge.added || directoryMerge.updated) && !skipDirectory);
  const useContacts = Boolean(contactsMerge && (contactsMerge.added || contactsMerge.updated) && !skipContacts);
  const nothing = !pickedWeeks.size && !useDirectory && !useContacts;
  // Nothing in it this phone doesn't already have (before anything was toggled).
  const alreadyHad = Boolean(manifest) && weeks === null && !skipDirectory && !skipContacts && nothing;
  useEffect(() => {
    if (alreadyHad) onAlreadyHave?.();
    // Once, when it's opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyHad]);
  const from = manifest?.from || "A coworker";
  const people = manifest?.people ?? [];
  const askName = !person && pickedWeeks.size > 0 && people.length > 0;
  const waitingForName = askName && chosen === null;

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
              <p>Opening…</p>
              <small>Unlocking it on this device.</small>
            </div>
          )}
          {!loading && error && (
            <div className="sheet-empty">
              <p>Couldn’t open this</p>
              <small>{error}</small>
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
              {askName && (
                <>
                  <p className="share-section-title">Which name is yours?</p>
                  <div className="share-names" role="radiogroup" aria-label="Which name is yours?">
                    {people.map((name) => (
                      <button
                        key={name}
                        type="button"
                        role="radio"
                        aria-checked={chosen === name}
                        className={chosen === name ? "on" : ""}
                        onClick={() => setChosen(name)}
                      >
                        {name}
                      </button>
                    ))}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={chosen === ""}
                      className={`share-names-none${chosen === "" ? " on" : ""}`}
                      onClick={() => setChosen("")}
                    >
                      I’m not on it
                    </button>
                  </div>
                  <p className="share-note">This locks your name on this device. Only the owner can change it later.</p>
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
                disabled={nothing || waitingForName}
                onClick={() => {
                  const picked = schedules.flatMap((schedule, index) => {
                    if (!pickedWeeks.has(index) || !share.files[index]) return [];
                    const extension = schedule.type === "application/pdf" ? "pdf" : schedule.type === "image/png" ? "png" : "jpg";
                    // Named by week, not by who sent it.
                    return [{
                      file: new File([share.files[index]], `Schedule ${weekLabel(schedule.dates)}.${extension}`, { type: schedule.type }),
                      read: schedule.read,
                    }];
                  });
                  onImport({
                    files: picked.map((item) => item.file),
                    reads: picked.map((item) => item.read),
                    directory: useDirectory ? directoryMerge!.entries : undefined,
                    contacts: useContacts ? contactsMerge!.contacts : undefined,
                    person: askName && chosen ? chosen : undefined,
                    summary: [
                      useDirectory && `Directory: ${mergeSummary({ ...directoryMerge!, same: 0 })}`,
                      useContacts && `Contacts: ${mergeSummary({ ...contactsMerge!, same: 0 })}`,
                    ].filter(Boolean) as string[],
                  });
                }}
              >
                {nothing
                  ? "You already have all of this"
                  : waitingForName
                    ? "Pick your name first"
                    : pickedWeeks.size && chosen !== "" ? "Import & verify my hours" : "Import"}
              </button>
              {pickedWeeks.size > 0 && !waitingForName && chosen !== "" && (
                <p className="share-note">
                  The schedule is read on your device, then you check your hours against the photo.
                </p>
              )}
              {share?.expiresAt && <p className="share-note">This works until {untilLabel(share.expiresAt)}.</p>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------- "send this to the team?" after an import ---------- */

/** How a send to the team went: who got a ping, and whether it went into your last send. */
export type TeamSendResult = { notified: number; added: boolean; what: string };

export function TeamSendPrompt({ team, what, onSend }: {
  team: Team;
  /** "the Nov 22 – 28 schedule" */
  what: string;
  /** Resolves with how many teammates got a ping, and whether it was added to your last send. `to` empty = everyone. */
  onSend: (to: string[]) => Promise<TeamSendResult>;
}) {
  const [state, setState] = useState<"ask" | "sending" | "sent" | "error" | "dismissed">("ask");
  const [to, setTo] = useState<string[]>([]);
  const [notified, setNotified] = useState(0);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (state !== "sent") return;
    const timer = window.setTimeout(() => setState("dismissed"), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);
  if (state === "dismissed") return null;
  return (
    <div className="team-prompt" role="status">
      <span className="share-choice-icon">{state === "sent" ? <Check /> : <Send />}</span>
      <span className="share-choice-copy">
        <b>{state === "sent" ? `${added ? "Added to what you sent" : "Sent to"} ${recipientsLabel(team, to)}` : `Send ${what} to ${to.length ? recipientsLabel(team, to) : "everyone"}?`}</b>
        <small>
          {state === "sent"
            ? added ? "Still one notification on their end." : notified ? `${notified} ${notified === 1 ? "device" : "devices"} got a ping.` : to.length ? "It’s in their Notifications." : "It’s in everyone’s Notifications."
            : state === "error" ? error : to.length ? "Only who you pick gets it." : "Everyone on Shiftdeck gets it in Notifications."}
        </small>
      </span>
      {state !== "sent" && (
        <div className="team-prompt-to">
          <RecipientPicker team={team} value={to} onChange={setTo} />
        </div>
      )}
      {(state === "ask" || state === "error" || state === "sending") && (
        <span className="team-prompt-actions">
          <button type="button" className="button soft" onClick={() => setState("dismissed")} disabled={state === "sending"}>Not now</button>
          <button
            type="button"
            className="button primary"
            disabled={state === "sending"}
            onClick={async () => {
              setState("sending");
              try {
                const result = await onSend(to);
                setNotified(result.notified);
                setAdded(result.added);
                setState("sent");
              } catch (problem) {
                setError(problem instanceof Error ? problem.message : "Couldn’t send. Try again.");
                setState("error");
              }
            }}
          >
            {state === "sending" ? <LoaderCircle className="spin" /> : "Send"}
          </button>
        </span>
      )}
    </div>
  );
}
