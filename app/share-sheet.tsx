"use client";

import { BookUser, CalendarDays, Check, ChevronDown, Copy, LoaderCircle, Lock, Send, UserPlus, Users, X } from "lucide-react";
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
import { isOwner, teamInText, teammates, type NameRequest, type Team, type TeamInvite } from "./team";

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

/* ---------- the team card (in the share sheet) ---------- */

/** Who's on the team. The owner can rename or remove anyone and decide name changes. */
function TeamMembers({ team, requests, onRename, onRemove, onDecide }: {
  team: Team;
  requests: NameRequest[];
  onRename: (memberId: string, name: string) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  onDecide: (requestId: string, approve: boolean) => Promise<void>;
}) {
  const owner = isOwner(team);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const people = team.people ?? [];
  if (!people.length) return null;
  const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  const run = async (action: () => Promise<void>) => {
    setProblem("");
    try {
      await action();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That didn’t work.");
    }
  };
  return (
    <div className="team-members">
      {owner && requests.filter((request) => request.memberId !== team.memberId).map((request) => (
        <div key={request.id} className="team-request">
          <span><b>{request.from}</b> asks to be <b>{request.name}</b></span>
          <span className="team-request-actions">
            <button type="button" className="button soft" onClick={() => void run(() => onDecide(request.id, false))}>Deny</button>
            <button type="button" className="button primary" onClick={() => void run(() => onDecide(request.id, true))}>Approve</button>
          </span>
        </div>
      ))}
      <ul>
        {people.map((member) => {
          const me = member.id === team.memberId;
          const isTheOwner = member.id === team.ownerId;
          return (
            <li key={member.id}>
              {editing === member.id ? (
                <span className="team-join-select team-member-rename">
                  <select
                    autoFocus
                    defaultValue=""
                    aria-label={`New name for ${member.name}`}
                    onChange={(event) => {
                      const name = event.target.value;
                      setEditing(null);
                      if (name) void run(() => onRename(member.id, name));
                    }}
                    onBlur={() => setEditing(null)}
                  >
                    <option value="" disabled>Rename {member.name.split(" ")[0]} to…</option>
                    {(team.roster ?? []).filter((name) =>
                      key(name) === key(member.name) || !people.some((other) => key(other.name) === key(name)),
                    ).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              ) : (
                <span className="team-member-name">
                  {member.name}
                  {me && <small>You</small>}
                  {isTheOwner && <small className="owner">Owner</small>}
                </span>
              )}
              {owner && editing !== member.id && (
                <span className="team-member-actions">
                  <button type="button" onClick={() => setEditing(member.id)}>Rename</button>
                  {!me && (
                    <button
                      type="button"
                      className={removing === member.id ? "confirm" : ""}
                      onClick={() => {
                        if (removing === member.id) {
                          setRemoving(null);
                          void run(() => onRemove(member.id));
                        } else {
                          setRemoving(member.id);
                          window.setTimeout(() => setRemoving((current) => current === member.id ? null : current), 3500);
                        }
                      }}
                    >
                      {removing === member.id ? "Tap to remove" : "Remove"}
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
      <p className="share-note">
        {owner
          ? "You run this team: names are locked, and only you can change or remove them."
          : "Names are locked. Only the owner can change them; ask from Settings → your name."}
      </p>
    </div>
  );
}

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

/* ---------- the team sheet: start/join, invite, send ---------- */

export function ShareSheet({
  schedules, today, directory, contacts, person, loadFile,
  team, inviteUrl, onCreateTeam, onLeaveTeam, onSendToTeam, requests, onRename, onRemove, onDecide, onOpenInvite, onClose,
}: {
  schedules: ShareableDocument[];
  today: string;
  directory: DirectoryEntry[];
  contacts: Contacts;
  person: string;
  loadFile: (id: string) => Promise<Blob | undefined>;
  team: Team | null;
  inviteUrl: string;
  onCreateTeam: (teamName: string) => Promise<void>;
  onLeaveTeam: () => void;
  /** Resolves with how many teammates got a notification. `to` empty = everyone. */
  onSendToTeam: (share: SharePackage, what: string, to: string[]) => Promise<number>;
  requests: NameRequest[];
  onRename: (memberId: string, name: string) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  onDecide: (requestId: string, approve: boolean) => Promise<void>;
  /** An invite someone sent, pasted here (iPhone links open in Safari, not the app). */
  onOpenInvite: (invite: TeamInvite) => void;
  onClose: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const pastedInvite = teamInText(pasted);
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
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ what: string; notified: number; to: string[] } | null>(null);
  const [to, setTo] = useState<string[]>([]);

  const picked = sorted.filter((document) => weeks.has(document.id));
  const nothing = !picked.length && !withDirectory && !withContacts;

  const send = async () => {
    setState("sending");
    setError("");
    try {
      const { share, what } = await buildShare({
        documents: picked,
        directory: withDirectory ? directory : undefined,
        contacts: withContacts ? contacts : undefined,
        person,
        loadFile,
      });
      setSent({ what, to, notified: await onSendToTeam(share, what, to) });
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
          <h2>Team</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close team"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {sent ? (
            <div className="share-done">
              <span className="share-done-icon"><Send /></span>
              <p>Sent to {team ? recipientsLabel(team, sent.to) : ""}</p>
              <small>
                {sent.what.charAt(0).toUpperCase() + sent.what.slice(1)} is in {sent.to.length ? "their" : "everyone’s"} Notifications
                {sent.notified ? `, and ${sent.notified} ${sent.notified === 1 ? "phone" : "phones"} got a ping` : ""}.
                {sent.to.length ? " Nobody else on the team sees it." : ""} It’s there for a week.
              </small>
              <button type="button" className="share-again" onClick={() => setSent(null)}>Send something else</button>
            </div>
          ) : (
            <>
              <TeamCard team={team} person={person} inviteUrl={inviteUrl} onCreateTeam={onCreateTeam} onLeaveTeam={onLeaveTeam} />
              {team && <TeamMembers team={team} requests={requests} onRename={onRename} onRemove={onRemove} onDecide={onDecide} />}
              {team && (
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
                    <p className="quiet-line">Import a schedule to send it.</p>
                  )}
                  <p className="share-section-title">Also send</p>
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
                  <RecipientPicker team={team} value={to} onChange={setTo} />
                  {state === "error" && <p className="contacts-notice share-error" role="alert">{error}</p>}
                  <button type="button" className="button primary share-make" disabled={nothing || state === "sending"} onClick={() => void send()}>
                    {state === "sending" ? <><LoaderCircle className="spin" /> Sending…</> : <><Send /> Send to {recipientsLabel(team, to)}</>}
                  </button>
                  <p className="share-note">
                    Encrypted on this phone first, so only your team can open it. Their phones keep what they
                    already have and add only what’s new. Imports also ask if you want to send them here.
                  </p>
                </>
              )}
              <p className="share-section-title">{team ? "Got an invite to another team?" : "Got an invite?"}</p>
              <div className="share-paste">
                <input
                  type="url"
                  inputMode="url"
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="Paste the invite link"
                  aria-label="Paste a team invite link"
                />
                <button
                  type="button"
                  className="button soft"
                  disabled={!pastedInvite}
                  onClick={() => pastedInvite && onOpenInvite(pastedInvite)}
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

export function SharedImportSheet({ share, error, loading, person, haveWeek, directory, contacts, onImport, onClose }: {
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
                  <p className="share-note">This locks your name on this phone. Only your team’s owner can change it later.</p>
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
                    // Named by week, not by who sent it.
                    return [new File([share.files[index]], `Schedule ${weekLabel(schedule.dates)}.${extension}`, { type: schedule.type })];
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

const SOMEONE_ELSE = "__someone-else__";

export function TeamJoinSheet({ preview, error, leaving, link, defaultName, lockedName, onJoin, onClose }: {
  preview: { name: string; members: string[]; roster?: string[] } | null;
  error: string;
  /** The other team this phone is on, which joining would leave. */
  leaving?: string;
  /** On an iPhone in Safari: the invite to paste into the Home Screen app instead. */
  link?: string;
  defaultName: string;
  /** This phone's name is already chosen (and locked): it joins with that. */
  lockedName?: string;
  onJoin: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  // The name already in this phone's Settings goes first and is picked, even
  // if the schedules spell it a little differently.
  const listed = preview?.roster ?? [];
  const fromSettings = defaultName.trim()
    ? listed.find((name) => key(name) === key(defaultName)) ?? defaultName.trim()
    : "";
  const roster = fromSettings ? [fromSettings, ...listed.filter((name) => key(name) !== key(fromSettings))] : listed;
  const joined = new Set((preview?.members ?? []).map(key));
  const selected = choice ?? (roster.length ? fromSettings : SOMEONE_ELSE);
  const typing = !lockedName && selected === SOMEONE_ELSE;
  const name = lockedName ?? (typing ? typed.trim() : selected);

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
          {link && (
            <div className="share-iphone">
              <b>Join from your Home Screen app</b>
              <small>
                iPhone opened this in Safari, which keeps its own copy of Shiftdeck. Copy the invite, open
                Shiftdeck from its icon, then paste it in Settings → Team.
              </small>
              <button type="button" className="button soft" onClick={() => void navigator.clipboard?.writeText(link).catch(() => undefined)}>
                <Copy /> Copy invite
              </button>
            </div>
          )}
          {preview && (
            <form
              className="team-join"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!name) return;
                setBusy(true);
                setProblem("");
                try {
                  await onJoin(name);
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
              {lockedName ? (
                <div className="team-join-name">
                  <span>Joining as</span>
                  <b className="team-join-locked"><Lock aria-hidden="true" /> {lockedName}</b>
                  <small>Your name is locked on this phone. If it’s wrong, the team’s owner can change it after you join.</small>
                </div>
              ) : (
              <label className="team-join-name">
                <span>Which name is yours?</span>
                {roster.length > 0 && (
                  <span className="team-join-select">
                    <select value={selected} onChange={(event) => setChoice(event.target.value)} aria-label="Your name">
                      <option value="" disabled>Pick your name</option>
                      {roster.map((option) => {
                        const taken = joined.has(key(option)) && key(option) !== key(defaultName);
                        return (
                          <option key={option} value={option} disabled={taken}>
                            {taken ? `${option} (on the team)` : option}
                          </option>
                        );
                      })}
                      <option value={SOMEONE_ELSE}>Someone else…</option>
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </span>
                )}
                {typing && (
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder="First and last name"
                    aria-label={roster.length ? "Type your name" : "Your name"}
                    autoComplete="name"
                    autoFocus={roster.length > 0}
                    maxLength={40}
                  />
                )}
                <small>This name gets locked to this phone. Only the team’s owner can change it later.</small>
              </label>
              )}
              {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
              <button type="submit" className="button primary share-make" disabled={busy || !name}>
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
  /** Resolves with how many teammates got a notification. `to` empty = everyone. */
  onSend: (to: string[]) => Promise<number>;
}) {
  const [state, setState] = useState<"ask" | "sending" | "sent" | "error" | "dismissed">("ask");
  const [to, setTo] = useState<string[]>([]);
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
        <b>{state === "sent" ? `Sent to ${recipientsLabel(team, to)}` : `Send ${what} to ${team.name}?`}</b>
        <small>
          {state === "sent"
            ? notified ? `${notified} ${notified === 1 ? "phone" : "phones"} got a ping.` : to.length ? "It’s in their Notifications." : "It’s in everyone’s Notifications."
            : state === "error" ? error : to.length ? "Only who you pick gets it." : "Everyone on the team gets it in Notifications."}
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
                setNotified(await onSend(to));
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
