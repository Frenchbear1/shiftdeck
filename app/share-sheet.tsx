"use client";

import { BookUser, CalendarDays, Check, Copy, Link2, LoaderCircle, Send, Share2, UserPlus, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { backdropClose } from "./home-sections";
import type { Contacts } from "./contacts-data";
import type { DirectoryEntry } from "./directory-data";
import { buildShare, contactCount, type ShareableDocument } from "./share-build";
import {
  firstName,
  mergeSharedContacts,
  mergeSharedDirectory,
  mergeSummary,
  weekLabel,
  type ShareManifest,
  type SharePackage,
} from "./share-data";
import { createShareLink, shareInText, type CreatedShare, type ShareKey } from "./share-link";
import { teamInText, type Team, type TeamInvite } from "./team";

export type { ShareableDocument };

const untilLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const listNames = (names: string[]) => {
  const first = names.map(firstName).filter(Boolean);
  if (first.length <= 3) return first.join(", ");
  return `${first.slice(0, 3).join(", ")} and ${first.length - 3} more`;
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

/* ---------- the team card (in the share sheet) ---------- */

function TeamCard({ team, person, inviteUrl, onCreateTeam, onLeaveTeam }: {
  team: Team | null;
  person: string;
  inviteUrl: string;
  onCreateTeam: (teamName: string) => Promise<void>;
  onLeaveTeam: () => void;
}) {
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  if (!team) {
    return (
      <div className="team-card">
        <div className="team-card-head">
          <span className="share-choice-icon"><Users /></span>
          <span className="share-choice-copy">
            <b>Start a team</b>
            <small>Invite coworkers once, then send them anything in one tap.</small>
          </span>
        </div>
        <form
          className="share-paste"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onCreateTeam(teamName.trim() || "My team");
            } catch (problem) {
              setError(problem instanceof Error ? problem.message : "The team couldn’t be made.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            placeholder="Team name, like ABE Ramp"
            aria-label="Team name"
            maxLength={40}
          />
          <button type="submit" className="button soft" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : "Start"}
          </button>
        </form>
        {error && <p className="contacts-notice share-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="team-card">
      <div className="team-card-head">
        <span className="share-choice-icon"><Users /></span>
        <span className="share-choice-copy">
          <b>{team.name}</b>
          <small>
            {team.members?.length
              ? `${team.members.length} ${team.members.length === 1 ? "member" : "members"} · ${listNames(team.members)}`
              : "Your team"}
          </small>
        </span>
        <button
          type="button"
          className="button soft team-invite"
          onClick={async () => {
            const done = await sendOrCopy(
              `${firstName(person) || "A coworker"} invited you to ${team.name} on Shiftdeck. Open this on your phone to join:`,
              inviteUrl,
            );
            if (done) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }
          }}
        >
          {copied ? <Check /> : <UserPlus />} {copied ? "Copied" : "Invite"}
        </button>
      </div>
      <button
        type="button"
        className={`team-leave${leaving ? " confirm" : ""}`}
        onClick={() => {
          if (leaving) onLeaveTeam();
          else {
            setLeaving(true);
            window.setTimeout(() => setLeaving(false), 3500);
          }
        }}
      >
        {leaving ? "Tap again to leave the team" : "Leave team"}
      </button>
    </div>
  );
}

/* ---------- sending ---------- */

export function ShareSheet({
  schedules, today, directory, contacts, person, service, appUrl, loadFile,
  team, inviteUrl, onCreateTeam, onLeaveTeam, onSendToTeam, onOpenLink, onOpenInvite, onClose,
}: {
  schedules: ShareableDocument[];
  today: string;
  directory: DirectoryEntry[];
  contacts: Contacts;
  person: string;
  service: string;
  appUrl: string;
  loadFile: (id: string) => Promise<Blob | undefined>;
  team: Team | null;
  inviteUrl: string;
  onCreateTeam: (teamName: string) => Promise<void>;
  onLeaveTeam: () => void;
  /** Resolves with how many teammates got a notification. */
  onSendToTeam: (share: SharePackage, what: string) => Promise<number>;
  /** A share link someone sent, pasted here (iPhone links open in Safari, not the app). */
  onOpenLink: (share: ShareKey) => void;
  onOpenInvite: (invite: TeamInvite) => void;
  onClose: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const pastedShare = shareInText(pasted);
  const pastedInvite = pastedShare ? null : teamInText(pasted);
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
  const [linkMode, setLinkMode] = useState(false);
  const [state, setState] = useState<"idle" | "making" | "error">("idle");
  const [error, setError] = useState("");
  const [made, setMade] = useState<CreatedShare | null>(null);
  const [sent, setSent] = useState<{ what: string; notified: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const toTeam = Boolean(team) && !linkMode;

  const picked = sorted.filter((document) => weeks.has(document.id));
  const nothing = !picked.length && !withDirectory && !withContacts;

  const make = async () => {
    setState("making");
    setError("");
    try {
      const { share, what } = await buildShare({
        documents: picked,
        directory: withDirectory ? directory : undefined,
        contacts: withContacts ? contacts : undefined,
        person,
        loadFile,
      });
      if (toTeam) {
        setSent({ what, notified: await onSendToTeam(share, what) });
      } else {
        setMade(await createShareLink(share, { service, appUrl, days }));
      }
      setState("idle");
    } catch (problem) {
      setState("error");
      setError(problem instanceof Error ? problem.message : "That couldn’t be sent. Try again.");
    }
  };

  const message = `${firstName(person) || "A coworker"} shared Shiftdeck info with you. Open this on your phone to add it:`;

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
          {sent ? (
            <div className="share-done">
              <span className="share-done-icon"><Send /></span>
              <p>Sent to {team?.name}</p>
              <small>
                {sent.what.charAt(0).toUpperCase() + sent.what.slice(1)} is in everyone’s Notifications
                {sent.notified ? `, and ${sent.notified} ${sent.notified === 1 ? "phone" : "phones"} got a ping` : ""}.
                It’s there for a week.
              </small>
              <button type="button" className="share-again" onClick={() => setSent(null)}>Send something else</button>
            </div>
          ) : made ? (
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
              <TeamCard team={team} person={person} inviteUrl={inviteUrl} onCreateTeam={onCreateTeam} onLeaveTeam={onLeaveTeam} />
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
              {!toTeam && (
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
              )}
              {state === "error" && <p className="contacts-notice share-error" role="alert">{error}</p>}
              <button type="button" className="button primary share-make" disabled={nothing || state === "making"} onClick={() => void make()}>
                {state === "making"
                  ? <><LoaderCircle className="spin" /> {toTeam ? "Sending…" : "Locking & uploading…"}</>
                  : toTeam ? <><Send /> Send to {team!.name}</> : <><Link2 /> Make link</>}
              </button>
              {team && (
                <button type="button" className="share-again share-mode" onClick={() => setLinkMode(!linkMode)}>
                  {linkMode ? `Send to ${team.name} instead` : "Make a link instead"}
                </button>
              )}
              <p className="share-note">
                Everything is encrypted on this phone first. When it’s opened, their phone keeps what it
                already has and adds only what’s new.
              </p>
              <p className="share-section-title">Got a link from someone?</p>
              <div className="share-paste">
                <input
                  type="url"
                  inputMode="url"
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="Paste a share or team invite link"
                  aria-label="Paste a share link"
                />
                <button
                  type="button"
                  className="button soft"
                  disabled={!pastedShare && !pastedInvite}
                  onClick={() => {
                    if (pastedShare) onOpenLink(pastedShare);
                    else if (pastedInvite) onOpenInvite(pastedInvite);
                  }}
                >
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
  /** Who this phone belongs to, when it was picked here. */
  person?: string;
};

export function SharedImportSheet({ share, error, loading, link, person, haveWeek, directory, contacts, onImport, onClose }: {
  share: OpenedShare | null;
  error: string;
  loading: boolean;
  /** On an iPhone in Safari: the link to paste into the Home Screen app instead. */
  link?: string;
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
              <small>Unlocking it on this phone.</small>
            </div>
          )}
          {!loading && error && (
            <div className="sheet-empty">
              <p>Couldn’t open this</p>
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
                  <p className="share-note">Saved on this phone so your hours are picked out automatically. You can change it in Settings.</p>
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
                  const files = schedules.flatMap((schedule, index) => {
                    if (!pickedWeeks.has(index) || !share.files[index]) return [];
                    const extension = schedule.type === "application/pdf" ? "pdf" : schedule.type === "image/png" ? "png" : "jpg";
                    return [new File([share.files[index]], `${from}’s schedule ${weekLabel(schedule.dates)}.${extension}`, { type: schedule.type })];
                  });
                  onImport({
                    directory: useDirectory ? directoryMerge!.entries : undefined,
                    contacts: useContacts ? contactsMerge!.contacts : undefined,
                    files,
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
                  The schedule is read on your phone, then you check your hours against the photo.
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

/* ---------- joining a team ---------- */

export function TeamJoinSheet({ preview, error, leaving, defaultName, onJoin, onClose }: {
  preview: { name: string; members: string[] } | null;
  error: string;
  /** The other team this phone is on, which joining would leave. */
  leaving?: string;
  defaultName: string;
  onJoin: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet" role="dialog" aria-modal="true" aria-label="Join a team">
        <header className="sheet-head sheet-head-tools">
          <h2>{preview ? `Join ${preview.name}` : "Team invite"}</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {!preview && !error && (
            <div className="sheet-empty">
              <LoaderCircle className="spin share-loading" />
              <p>Opening the invite…</p>
            </div>
          )}
          {error && (
            <div className="sheet-empty">
              <p>Couldn’t open this invite</p>
              <small>{error}</small>
            </div>
          )}
          {preview && (
            <form
              className="team-join"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setProblem("");
                try {
                  await onJoin(name.trim());
                } catch (failure) {
                  setProblem(failure instanceof Error ? failure.message : "Couldn’t join. Try again.");
                  setBusy(false);
                }
              }}
            >
              <div className="share-done">
                <span className="share-done-icon"><Users /></span>
                <p>{preview.name}</p>
                <small>
                  {preview.members.length
                    ? `${listNames(preview.members)} ${preview.members.length === 1 ? "is" : "are"} on it. `
                    : ""}
                  You’ll get the schedules and info members send, in Notifications.
                </small>
              </div>
              {leaving && <p className="share-iphone"><small>Joining leaves {leaving}.</small></p>}
              <label className="team-join-name">
                <span>Your name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="First and last name"
                  autoComplete="name"
                  maxLength={40}
                  required
                />
              </label>
              {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
              <button type="submit" className="button primary share-make" disabled={busy || !name.trim()}>
                {busy ? <><LoaderCircle className="spin" /> Joining…</> : <><UserPlus /> Join team</>}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------- "send this to the team?" after an import ---------- */

export function TeamSendPrompt({ team, what, onSend }: {
  team: Team;
  /** "the Nov 22 – 28 schedule" */
  what: string;
  /** Resolves with how many teammates got a notification. */
  onSend: () => Promise<number>;
}) {
  const [state, setState] = useState<"ask" | "sending" | "sent" | "error" | "dismissed">("ask");
  const [notified, setNotified] = useState(0);
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
        <b>{state === "sent" ? `Sent to ${team.name}` : `Send ${what} to ${team.name}?`}</b>
        <small>
          {state === "sent"
            ? notified ? `${notified} ${notified === 1 ? "phone" : "phones"} got a ping.` : "It’s in everyone’s Notifications."
            : state === "error" ? error : "Everyone on the team gets it in Notifications."}
        </small>
      </span>
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
                setNotified(await onSend());
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
