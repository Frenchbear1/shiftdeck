"use client";

import { Ban, Check, ChevronDown, ChevronRight, Copy, Crown, KeyRound, LoaderCircle, Send, ShieldCheck, Smartphone, Undo2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { backdropClose } from "./home-sections";
import { recommendedSuccessor, type LogEntry, type Me, type PersonSummary, type PhoneSummary } from "./people";
import { rosterLabel, type RosterStatus } from "./roster-status";

const sinceLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const timeLabel = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
};

/** "1234 5678 9012 3456" */
const grouped = (key: string) => key.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");

const seenLabel = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 5) return "active now";
  if (minutes < 60) return `active ${minutes}m ago`;
  if (minutes < 48 * 60) return `active ${Math.round(minutes / 60)}h ago`;
  return `active ${Math.round(minutes / 1440)}d ago`;
};

/** Two taps to do something you can't undo. */
function useConfirm() {
  const [armed, setArmed] = useState<string | null>(null);
  const tap = (id: string, action: () => void) => {
    if (armed === id) {
      setArmed(null);
      action();
    } else {
      setArmed(id);
      window.setTimeout(() => setArmed((current) => current === id ? null : current), 3500);
    }
  };
  return { armed, tap };
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head sheet-head-tools">
          <h2>{title}</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">{children}</div>
      </section>
    </div>
  );
}

/* ---------- this name is on another phone: enter its code ---------- */

export function LinkPhoneSheet({ name, ownerName, onLink, onRecover, onNotMe, onClose }: {
  name: string;
  /** The name is the app owner's (so this would be another owner phone). */
  ownerName: boolean;
  onLink: (code: string) => Promise<void>;
  /** The owner's 20-digit recovery key, for when all their phones are gone. */
  onRecover: (key: string) => Promise<void>;
  onNotMe: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  if (recovering) {
    return (
      <Sheet title="Recovery key" onClose={onClose}>
        <form
          className="team-join"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setProblem("");
            try {
              await onRecover(recoveryKey);
            } catch (failure) {
              setProblem(failure instanceof Error ? failure.message : "That key doesn’t work.");
              setBusy(false);
            }
          }}
        >
          <div className="share-done">
            <span className="share-done-icon"><ShieldCheck /></span>
            <p>Lost all your phones?</p>
            <small>Type the 20-digit recovery key you saved. It sets this phone up as you, with owner access, and then stops working.</small>
          </div>
          <input
            className="link-code-input long-key-input"
            value={grouped(recoveryKey)}
            onChange={(event) => setRecoveryKey(event.target.value.replace(/\D/g, "").slice(0, 20))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="0000 0000 0000 0000 0000"
            aria-label="20-digit recovery key"
            autoFocus
          />
          {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
          <button type="submit" className="button primary share-make" disabled={busy || recoveryKey.length !== 20}>
            {busy ? <LoaderCircle className="spin" /> : <KeyRound />} Use recovery key
          </button>
          <button type="button" className="share-again" onClick={() => setRecovering(false)}>Back to the 6-digit code</button>
        </form>
      </Sheet>
    );
  }
  return (
    <Sheet title="Set up this phone" onClose={onClose}>
      <form
        className="team-join"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setProblem("");
          try {
            await onLink(code);
          } catch (failure) {
            setProblem(failure instanceof Error ? failure.message : "That code doesn’t work.");
            setBusy(false);
          }
        }}
      >
        <div className="share-done">
          <span className="share-done-icon"><Smartphone /></span>
          <p>{name} is already set up</p>
          <small>
            If that’s you on a new phone, open Shiftdeck on your other phone and go to Settings →
            {ownerName ? " Owner → Add another phone of mine" : " your name → Add a phone"}. Type the 6-digit code here.
          </small>
        </div>
        <input
          className="link-code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          aria-label="6-digit code"
          autoFocus
        />
        {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
        <button type="submit" className="button primary share-make" disabled={busy || code.length !== 6}>
          {busy ? <LoaderCircle className="spin" /> : <KeyRound />} Set up this phone
        </button>
        {ownerName && (
          <button type="button" className="share-again" onClick={() => {
            setProblem("");
            setRecovering(true);
          }}>Lost your other phones? Use your recovery key</button>
        )}
        <button type="button" className="share-again" onClick={onNotMe}>That’s not me, pick another name</button>
      </form>
    </Sheet>
  );
}

/* ---------- a code for your other phone ---------- */

export function LinkCodeSheet({ owner, onMakeCode, onClose }: {
  owner: boolean;
  onMakeCode: () => Promise<{ code: string; expiresAt: string }>;
  onClose: () => void;
}) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    onMakeCode()
      .then((result) => !cancelled && setCode(result))
      .catch((failure: unknown) => !cancelled && setProblem(failure instanceof Error ? failure.message : "No code right now."));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const left = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;
  return (
    <Sheet title={owner ? "Add another phone of mine" : "Add a phone"} onClose={onClose}>
      <div className="share-done">
        <span className="share-done-icon"><Smartphone /></span>
        {code ? (
          <>
            <p className="link-code">{code.code.slice(0, 3)} {code.code.slice(3)}</p>
            <small>
              {left > 0
                ? `On your other phone, pick your name, then type this code. It works once and expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`
                : "This code expired. Close and open this again for a new one."}
              {owner ? " That phone gets owner access too." : ""}
            </small>
          </>
        ) : problem ? (
          <small>{problem}</small>
        ) : (
          <LoaderCircle className="spin share-loading" />
        )}
      </div>
      <p className="share-note">Only use this for your own phones. Anyone with the code becomes you in the app.</p>
    </Sheet>
  );
}

/* ---------- the owner's screen ---------- */

export type PhoneActions = {
  onRenamePhone: (deviceId: string, label: string) => Promise<void>;
  onMovePhone: (deviceId: string, name: string) => Promise<void>;
  onRemovePhone: (deviceId: string) => Promise<void>;
};

/** A section of the owner screen that opens and closes. */
function Section({ icon: Icon, title, summary, alert, defaultOpen = false, children }: {
  icon: typeof Crown;
  title: string;
  summary?: React.ReactNode;
  /** Something's waiting in it. */
  alert?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`owner-section${open ? " open" : ""}${alert ? " alert" : ""}`}>
      <button type="button" className="owner-section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon className="owner-section-icon" aria-hidden="true" />
        <span>{title}</span>
        {summary !== undefined && <b>{summary}</b>}
        <ChevronDown className="owner-section-chevron" aria-hidden="true" />
      </button>
      {open && <div className="owner-section-body">{children}</div>}
    </section>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`owner-switch${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function OwnerSheet({
  me, names, onRename, onRemove, onBlock, onUnblock, onShareAccess, onRenamePhone, onMovePhone, onRemovePhone, onDecide,
  onStartHandover, onCancelHandover, onMakeRecoveryKey, onAddPhone, learning, rosterFor, focus, onClose,
}: PhoneActions & {
  /** Opened from a notification: that section open, that person shown. */
  focus?: { section: "requests" | "log" | "people"; personId?: string };
  /** Where someone stands on the imported schedules (new, leaving, left). */
  rosterFor?: (name: string) => RosterStatus | undefined;
  me: Me;
  /** Names to rename people to (from schedules). */
  names: string[];
  onRename: (personId: string, name: string) => Promise<void>;
  onRemove: (personId: string) => Promise<void>;
  onBlock: (personId: string) => Promise<void>;
  onUnblock: (personId: string) => Promise<void>;
  onShareAccess: (personId: string, allow: boolean) => Promise<void>;
  onDecide: (requestId: string, approve: boolean) => Promise<void>;
  onStartHandover: (personId: string) => Promise<{ key: string; expiresAt: string; name: string }>;
  onCancelHandover: () => Promise<void>;
  onMakeRecoveryKey: () => Promise<string>;
  onAddPhone: () => void;
  /** Owner-only settings (flight learning). */
  learning?: React.ReactNode;
  onClose: () => void;
}) {
  const everyone = me.people ?? [];
  const people = everyone.filter((person) => !person.blocked);
  const blocked = everyone.filter((person) => person.blocked);
  const others = people.filter((person) => person.id !== me.personId);
  const senders = others.filter((person) => person.canShare);
  const requests = (me.requests ?? []).filter((request) => request.personId !== me.personId);
  const log = me.log ?? [];
  const recommended = recommendedSuccessor(people, me.personId);
  const [open, setOpen] = useState<string | null>(focus?.personId ?? null);
  const confirm = useConfirm();
  // Scroll the person a notification was about into view.
  useEffect(() => {
    if (!focus?.personId) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-person="${CSS.escape(focus.personId!)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [focus?.personId]);
  const [handing, setHanding] = useState(false);
  const [successor, setSuccessor] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [handoverKey, setHandoverKey] = useState<{ key: string; expiresAt: string; name: string } | null>(null);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [problem, setProblem] = useState("");
  const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  const run = async (action: () => Promise<void>) => {
    setProblem("");
    try {
      await action();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That didn’t work.");
    }
  };
  const picked = others.find((person) => person.id === successor);
  const firstOf = (name: string) => name.split(" ")[0];

  return (
    <Sheet title="Owner" onClose={onClose}>
      <div className="owner-top">
        <span className="owner-top-icon"><Crown /></span>
        <span className="owner-top-copy">
          <b>You own Shiftdeck</b>
          <small>
            {people.length} {people.length === 1 ? "person" : "people"}
            {blocked.length ? ` · ${blocked.length} blocked` : ""}
          </small>
        </span>
        <button type="button" className="owner-top-action" onClick={onAddPhone}>
          <Smartphone aria-hidden="true" /> Add my phone
        </button>
      </div>

      {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}

      <div className="owner-sections">
        {requests.length > 0 && (
          <Section icon={KeyRound} title="Name changes" summary={requests.length} alert defaultOpen>
            <ul className="owner-rows">
              {requests.map((request) => (
                <li key={request.id} className="owner-row">
                  <span className="owner-row-main">
                    <b>{request.from}</b>
                    <small>wants to be {request.name}</small>
                  </span>
                  <span className="owner-row-buttons">
                    <button type="button" className="owner-pill" onClick={() => void run(() => onDecide(request.id, false))}>Deny</button>
                    <button type="button" className="owner-pill primary" onClick={() => void run(() => onDecide(request.id, true))}>Approve</button>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          icon={Users}
          title="People"
          defaultOpen={focus?.section === "people"}
          summary={(() => {
            const gone = others.filter((person) => rosterFor?.(person.name)?.state === "left").length;
            return gone ? `${people.length} · ${gone} left the job` : people.length;
          })()}
          alert={others.some((person) => rosterFor?.(person.name)?.state === "left")}
        >
          <div className="owner-people">
            {people.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                me={me}
                open={open === person.id}
                onToggle={() => setOpen((current) => current === person.id ? null : person.id)}
                renameTo={names.filter((name) => key(name) === key(person.name) || !everyone.some((other) => key(other.name) === key(name)))}
                moveTo={[...new Set([...people.filter((other) => !other.owner).map((other) => other.name), ...names])]
                  .filter((name) => key(name) !== key(person.name) && !everyone.some((other) => (other.owner || other.blocked) && key(other.name) === key(name)))
                  .sort((a, b) => a.localeCompare(b))}
                confirm={confirm}
                run={run}
                roster={person.id === me.personId ? undefined : rosterFor?.(person.name)}
                onRename={onRename}
                onRemove={onRemove}
                onBlock={onBlock}
                onRenamePhone={onRenamePhone}
                onMovePhone={onMovePhone}
                onRemovePhone={onRemovePhone}
              />
            ))}
          </div>
        </Section>

        <Section icon={Send} title="Can send to the team" summary={others.length ? `${senders.length} of ${others.length}` : "Just you"}>
          {others.length ? (
            <ul className="owner-rows">
              {others.map((person) => (
                <li key={person.id} className="owner-row">
                  <span className="owner-row-main"><b>{person.name}</b></span>
                  <Switch
                    on={Boolean(person.canShare)}
                    label={`${person.name} can send to the team`}
                    onChange={(allow) => void run(() => onShareAccess(person.id, allow))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="owner-empty">Nobody else yet.</p>
          )}
        </Section>

        <Section icon={Smartphone} title="New phones" summary={log.length ? timeLabel(log[0].at) : "None yet"} defaultOpen={focus?.section === "log"}>
          {log.length ? (
            <ul className="owner-rows">
              {log.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  me={me}
                  confirm={confirm}
                  onBlock={(personId) => void run(() => onBlock(personId))}
                  onUnblock={(personId) => void run(() => onUnblock(personId))}
                />
              ))}
            </ul>
          ) : (
            <p className="owner-empty">New names and phones show up here.</p>
          )}
        </Section>

        {blocked.length > 0 && (
          <Section icon={Ban} title="Blocked" summary={blocked.length}>
            <ul className="owner-rows">
              {blocked.map((person) => (
                <li key={person.id} className="owner-row">
                  <span className="owner-row-main">
                    <b>{person.name}</b>
                    <small>Since {person.blockedAt ? sinceLabel(person.blockedAt) : "—"} · {person.devices} {person.devices === 1 ? "phone" : "phones"}</small>
                  </span>
                  <button type="button" className="owner-pill" onClick={() => void run(() => onUnblock(person.id))}>
                    <Undo2 aria-hidden="true" /> Unblock
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {learning}

        <Section
          icon={ShieldCheck}
          title="Ownership"
          summary={me.handover ? `Handing to ${firstOf(me.handover.name)}` : me.recoveryKeyMadeAt ? "Recovery key saved" : "No recovery key"}
          alert={!me.recoveryKeyMadeAt && !recoveryKey}
        >
          <div className="owner-ownership">
            <p className="owner-label">Recovery key</p>
            {recoveryKey ? (
              <div className="owner-key-box">
                <p className="owner-key">{grouped(recoveryKey)}</p>
                <small>Save it somewhere private. It sets up a new phone as you if all yours are lost. One use; not shown again.</small>
                <span className="owner-row-buttons">
                  <button type="button" className="owner-pill" onClick={() => {
                    void navigator.clipboard?.writeText(recoveryKey).catch(() => undefined);
                  }}><Copy aria-hidden="true" /> Copy</button>
                  <button type="button" className="owner-pill primary" onClick={() => setRecoveryKey("")}>I saved it</button>
                </span>
              </div>
            ) : (
              <div className="owner-row owner-row-flat">
                <span className="owner-row-main">
                  <small>{me.recoveryKeyMadeAt ? `Made ${sinceLabel(me.recoveryKeyMadeAt)}` : "Gets you back in if you lose every phone"}</small>
                </span>
                <button type="button" className="owner-pill" onClick={() => void run(async () => setRecoveryKey(await onMakeRecoveryKey()))}>
                  {me.recoveryKeyMadeAt ? "Make new" : "Make one"}
                </button>
              </div>
            )}

            <p className="owner-label">Hand over</p>
            {handoverKey ? (
              <div className="owner-key-box">
                <p className="owner-key">{grouped(handoverKey.key)}</p>
                <small>
                  Give this to {firstOf(handoverKey.name)} in person. They type it under Settings → Become the owner within 24 hours.
                  You stay owner until then.
                </small>
                <button type="button" className="owner-pill primary" onClick={() => setHandoverKey(null)}>Done</button>
              </div>
            ) : me.handover ? (
              <div className="owner-row owner-row-flat">
                <span className="owner-row-main">
                  <b>Waiting on {firstOf(me.handover.name)}</b>
                  <small>Until {timeLabel(me.handover.expiresAt)}</small>
                </span>
                <span className="owner-row-buttons">
                  <button type="button" className="owner-pill" onClick={() => void run(async () => setHandoverKey(await onStartHandover(me.handover!.personId)))}>New key</button>
                  <button type="button" className="owner-pill danger" onClick={() => void run(onCancelHandover)}>Cancel</button>
                </span>
              </div>
            ) : !handing ? (
              <div className="owner-row owner-row-flat">
                <span className="owner-row-main"><small>Leaving the job? They’ll need a key from you.</small></span>
                <button type="button" className="owner-pill" onClick={() => setHanding(true)} disabled={!others.length}>Hand over</button>
              </div>
            ) : (
              <div className="owner-handover-box">
                <span className="team-join-select">
                  <select value={successor} onChange={(event) => {
                    setSuccessor(event.target.value);
                    setConfirming(false);
                  }} aria-label="New owner">
                    <option value="" disabled>Who takes over?</option>
                    {others.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}{recommended?.id === person.id ? " · Recommended (longest here)" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
                <span className="owner-row-buttons">
                  <button type="button" className="owner-pill" onClick={() => {
                    setHanding(false);
                    setConfirming(false);
                    setSuccessor("");
                  }}>Cancel</button>
                  {picked && (
                    <button
                      type="button"
                      className={`owner-pill ${confirming ? "danger" : "primary"}`}
                      onClick={() => {
                        if (!confirming) setConfirming(true);
                        else {
                          void run(async () => {
                            setHandoverKey(await onStartHandover(picked.id));
                            setHanding(false);
                            setConfirming(false);
                          });
                        }
                      }}
                    >
                      {confirming ? `Yes, key for ${firstOf(picked.name)}` : `Hand to ${firstOf(picked.name)}`}
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>
        </Section>
      </div>
    </Sheet>
  );
}

/* ---------- one person, and their phones ---------- */

function PersonCard({ person, me, open, onToggle, renameTo, moveTo, confirm, run, roster, onRename, onRemove, onBlock, onRenamePhone, onMovePhone, onRemovePhone }: PhoneActions & {
  roster?: RosterStatus;
  person: PersonSummary;
  me: Me;
  open: boolean;
  onToggle: () => void;
  renameTo: string[];
  moveTo: string[];
  confirm: ReturnType<typeof useConfirm>;
  run: (action: () => Promise<void>) => Promise<void>;
  onRename: (personId: string, name: string) => Promise<void>;
  onRemove: (personId: string) => Promise<void>;
  onBlock: (personId: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const phones = person.phones ?? [];
  const first = person.name.split(" ")[0];
  return (
    <div className={`owner-card${open ? " open" : ""}`} data-person={person.id}>
      <button type="button" className="owner-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="owner-person">
          <span className="team-member-name">
            {person.name}
            {person.id === me.personId && <small>You</small>}
            {person.owner && <small className="owner">Owner</small>}
          </span>
          <small>
            Since {sinceLabel(person.since)} · {person.devices} {person.devices === 1 ? "phone" : "phones"}
          </small>
          {roster && roster.state !== "current" && (
            <small className={`roster-tag roster-${roster.state}`}>
              {roster.state === "left" ? `${rosterLabel(roster)} · still on the app` : rosterLabel(roster)}
            </small>
          )}
        </span>
        <ChevronRight className="owner-card-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="owner-card-body">
          {renaming ? (
            <span className="team-join-select team-member-rename">
              <select
                autoFocus
                defaultValue=""
                aria-label={`New name for ${person.name}`}
                onChange={(event) => {
                  const name = event.target.value;
                  setRenaming(false);
                  if (name) void run(() => onRename(person.id, name));
                }}
                onBlur={() => setRenaming(false)}
              >
                <option value="" disabled>Rename {first} to…</option>
                {renameTo.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          ) : (
            <span className="owner-card-actions">
              <button type="button" onClick={() => setRenaming(true)}>Rename {person.id === me.personId ? "me" : first}</button>
              {person.id !== me.personId && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => confirm.tap(`person:${person.id}`, () => void run(() => onRemove(person.id)))}
                >
                  {confirm.armed === `person:${person.id}` ? `Tap to remove ${first}` : `Remove ${first}`}
                </button>
              )}
              {person.id !== me.personId && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => confirm.tap(`block:${person.id}`, () => void run(() => onBlock(person.id)))}
                >
                  {confirm.armed === `block:${person.id}` ? `Tap to block ${first}` : `Block ${first}`}
                </button>
              )}
            </span>
          )}
          {phones.length > 0 ? (
            <ul className="owner-phones">
              {phones.map((phone) => (
                <PhoneRow
                  key={phone.id}
                  phone={phone}
                  moveTo={moveTo}
                  confirm={confirm}
                  run={run}
                  onRenamePhone={onRenamePhone}
                  onMovePhone={onMovePhone}
                  onRemovePhone={onRemovePhone}
                />
              ))}
            </ul>
          ) : (
            <p className="share-note">No phones right now.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PhoneRow({ phone, moveTo, confirm, run, onRenamePhone, onMovePhone, onRemovePhone }: PhoneActions & {
  phone: PhoneSummary;
  moveTo: string[];
  confirm: ReturnType<typeof useConfirm>;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"" | "label" | "move" | "newname">("");
  const [label, setLabel] = useState(phone.named ? phone.label : "");
  const [newName, setNewName] = useState("");
  const save = () => {
    setMode("");
    if (label.trim() !== (phone.named ? phone.label : "")) void run(() => onRenamePhone(phone.id, label.trim()));
  };
  return (
    <li className="owner-phone">
      <span className="owner-phone-icon"><Smartphone /></span>
      <span className="owner-phone-main">
        {mode === "label" ? (
          <form
            className="owner-phone-label"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              value={label}
              maxLength={30}
              placeholder={phone.model ?? "Phone name"}
              aria-label="Phone name"
              onChange={(event) => setLabel(event.target.value)}
              onBlur={save}
            />
            <button type="submit" aria-label="Save"><Check /></button>
          </form>
        ) : mode === "newname" ? (
          <form
            className="owner-phone-label"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newName.trim();
              setMode("");
              setNewName("");
              if (name) void run(() => onMovePhone(phone.id, name));
            }}
          >
            <input
              autoFocus
              value={newName}
              maxLength={40}
              placeholder="Their full name"
              aria-label="Whose phone is it?"
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" aria-label="Move" disabled={!newName.trim()}><Check /></button>
            <button type="button" className="ghost" aria-label="Cancel" onClick={() => setMode("")}><X /></button>
          </form>
        ) : mode === "move" ? (
          <span className="team-join-select team-member-rename">
            <select
              autoFocus
              defaultValue=""
              aria-label={`Move ${phone.label} to`}
              onChange={(event) => {
                const name = event.target.value;
                if (name === "\u0000new") {
                  setMode("newname");
                  return;
                }
                setMode("");
                if (name) void run(() => onMovePhone(phone.id, name));
              }}
              onBlur={() => setMode("")}
            >
              <option value="" disabled>This phone belongs to…</option>
              {moveTo.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value={"\u0000new"}>New name…</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
        ) : (
          <>
            <span className="owner-phone-name">
              {phone.label}
              {phone.current && <small>This phone</small>}
            </span>
            <small>
              {phone.named && phone.model ? `${phone.model} · ` : ""}Added {sinceLabel(phone.since)} · {seenLabel(phone.seen)}
            </small>
          </>
        )}
        {mode === "" && (
          <span className="owner-card-actions">
            <button type="button" onClick={() => setMode("label")}>Rename</button>
            {!phone.current && (
              <>
                <button type="button" onClick={() => setMode("move")}>Move to…</button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => confirm.tap(`phone:${phone.id}`, () => void run(() => onRemovePhone(phone.id)))}
                >
                  {confirm.armed === `phone:${phone.id}` ? "Tap to remove" : "Remove"}
                </button>
              </>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

/* ---------- a new phone or name, in the owner's log ---------- */

const LOG_TEXT: Record<string, string> = {
  new: "picked their name on a new phone",
  phone: "added a phone",
  "owner-phone": "added a phone (yours)",
  recovered: "used the recovery key on a new phone",
  "blocked-try": "tried a new phone while blocked",
  owner: "became the owner",
};

function LogRow({ entry, me, confirm, onBlock, onUnblock }: {
  entry: LogEntry;
  me: Me;
  confirm: ReturnType<typeof useConfirm>;
  onBlock: (personId: string) => void;
  onUnblock: (personId: string) => void;
}) {
  const canBlock = entry.personId && !entry.owner && entry.personId !== me.personId;
  const first = entry.name.split(" ")[0];
  return (
    <li className={`owner-row owner-log-row${entry.blocked ? " blocked" : ""}`}>
      <span className="owner-phone-icon">{entry.blocked ? <Ban /> : <Smartphone />}</span>
      <span className="owner-phone-main">
        <span className="owner-log-text"><b>{entry.name}</b> {LOG_TEXT[entry.kind] ?? "signed in"}</span>
        <small>{entry.model ? `${entry.model} · ` : ""}{timeLabel(entry.at)}</small>
      </span>
      {canBlock && (entry.blocked ? (
        <button type="button" className="owner-log-action" onClick={() => onUnblock(entry.personId!)}>
          <Undo2 aria-hidden="true" /> Unblock
        </button>
      ) : (
        <button
          type="button"
          className={`owner-log-action danger${confirm.armed === `log:${entry.id}` ? " armed" : ""}`}
          onClick={() => confirm.tap(`log:${entry.id}`, () => onBlock(entry.personId!))}
        >
          <Ban aria-hidden="true" /> {confirm.armed === `log:${entry.id}` ? `Block ${first}?` : "Block"}
        </button>
      ))}
    </li>
  );
}

/* ---------- the person the owner picked takes over ---------- */

export function AcceptHandoverSheet({ from, onAccept, onClose }: {
  from: string;
  onAccept: (key: string) => Promise<void>;
  onClose: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  return (
    <Sheet title="Become the owner" onClose={onClose}>
      <form
        className="team-join"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setProblem("");
          try {
            await onAccept(key);
          } catch (failure) {
            setProblem(failure instanceof Error ? failure.message : "That key doesn’t work.");
            setBusy(false);
          }
        }}
      >
        <div className="share-done">
          <span className="share-done-icon"><Crown /></span>
          <p>{from.split(" ")[0]} is handing Shiftdeck to you</p>
          <small>Type the 16-digit key {from.split(" ")[0]} gave you. You’ll run names, phones and who can use the app.</small>
        </div>
        <input
          className="link-code-input long-key-input"
          value={grouped(key)}
          onChange={(event) => setKey(event.target.value.replace(/\D/g, "").slice(0, 16))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0000 0000 0000 0000"
          aria-label="Handover key"
          autoFocus
        />
        {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
        <button type="submit" className="button primary share-make" disabled={busy || key.length !== 16}>
          {busy ? <LoaderCircle className="spin" /> : <Crown />} Become the owner
        </button>
      </form>
    </Sheet>
  );
}

/* ---------- blocked ---------- */

export function BlockedScreen({ name, onRetry }: { name: string; onRetry: () => void }) {
  return (
    <div className="blocked-screen" role="alertdialog" aria-modal="true" aria-label="Blocked">
      <span className="blocked-icon"><Ban /></span>
      <h2>You can’t use Shiftdeck</h2>
      <p>{name ? `${name} was` : "This phone was"} blocked by the app’s owner. Ask them if this is a mistake.</p>
      <button type="button" className="button soft" onClick={onRetry}>Check again</button>
    </div>
  );
}

/* ---------- a phone with no name yet: type it before using the app ---------- */

export type NameAttempt = "ok" | "taken" | "failed" | { suggest: string } | { unknown: string };

export function NamePickScreen({ reset, onTyped, onUseName }: {
  /** The owner reset this phone (not a brand-new one). */
  reset: boolean;
  /** Tries a typed name; `exact` skips matching it to a known name. */
  onTyped: (first: string, last: string, exact: boolean) => Promise<NameAttempt>;
  /** "Yes, that's me" to a suggested name. */
  onUseName: (name: string) => Promise<NameAttempt>;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [suggest, setSuggest] = useState("");
  const [unknown, setUnknown] = useState("");
  const ready = first.replace(/[^a-z]/gi, "").length >= 2 && last.replace(/[^a-z]/gi, "").length >= 2;
  const handle = async (attempt: () => Promise<NameAttempt>) => {
    setBusy(true);
    setProblem("");
    const result = await attempt();
    setBusy(false);
    setSuggest("");
    setUnknown("");
    if (result === "failed") setProblem("Couldn’t reach Shiftdeck. Check your connection and try again.");
    else if (typeof result === "object" && "suggest" in result) setSuggest(result.suggest);
    else if (typeof result === "object" && "unknown" in result) setUnknown(result.unknown);
  };
  // Shown the way the server saves it ("nicole" → "Nicole"; "LaBarre" stays).
  const tidy = (part: string) => {
    const trimmed = part.replace(/\s+/g, " ").trim();
    return trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase()
      ? trimmed.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, start: string, char: string) => start + char.toUpperCase())
      : trimmed;
  };
  const typedName = `${tidy(first)} ${tidy(last)}`;
  return (
    <div className="name-gate" role="dialog" aria-modal="true" aria-label="Who’s using this phone?">
      <form
        className="name-gate-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) void handle(() => onTyped(first, last, false));
        }}
      >
        <span className="blocked-icon name-gate-icon"><Smartphone /></span>
        <h2>Who’s using this phone?</h2>
        <p>{reset ? "The owner reset this phone. Type your name to keep using Shiftdeck." : "Type your name the way it is on the schedule."}</p>
        {suggest ? (
          <div className="name-gate-question">
            <b>Did you mean {suggest}?</b>
            <button type="button" className="button primary share-make" disabled={busy} onClick={() => void handle(() => onUseName(suggest))}>
              {busy ? <LoaderCircle className="spin" /> : <Check />} Yes, that’s me
            </button>
            <button type="button" className="share-again" disabled={busy} onClick={() => void handle(() => onTyped(first, last, true))}>
              No, I’m {typedName}
            </button>
          </div>
        ) : unknown ? (
          <div className="name-gate-question">
            <b>{unknown} isn’t on any schedule yet</b>
            <small>Check the spelling, or go ahead if you’re new.</small>
            <button type="button" className="button soft share-make" disabled={busy} onClick={() => setUnknown("")}>Fix the spelling</button>
            <button type="button" className="share-again" disabled={busy} onClick={() => void handle(() => onTyped(first, last, true))}>
              Continue as {unknown}
            </button>
          </div>
        ) : (
          <>
            <div className="name-gate-fields">
              <input
                className="name-gate-input"
                value={first}
                maxLength={30}
                autoComplete="given-name"
                autoCapitalize="words"
                placeholder="First name"
                aria-label="First name"
                required
                onChange={(event) => setFirst(event.target.value)}
              />
              <input
                className="name-gate-input"
                value={last}
                maxLength={30}
                autoComplete="family-name"
                autoCapitalize="words"
                placeholder="Last name"
                aria-label="Last name"
                required
                onChange={(event) => setLast(event.target.value)}
              />
            </div>
            <small>Your name gets locked to this phone. Only the owner can change it later.</small>
            {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
            <button type="submit" className="button primary share-make" disabled={busy || !ready}>
              {busy ? <LoaderCircle className="spin" /> : <Check />} Continue
            </button>
          </>
        )}
      </form>
    </div>
  );
}
