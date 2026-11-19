"use client";

import { Ban, Check, ChevronDown, ChevronRight, Copy, Crown, KeyRound, LoaderCircle, ShieldCheck, Smartphone, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { backdropClose } from "./home-sections";
import { recommendedSuccessor, type LogEntry, type Me, type PersonSummary, type PhoneSummary } from "./people";

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

export function OwnerSheet({
  me, names, onRename, onRemove, onBlock, onUnblock, onRenamePhone, onMovePhone, onRemovePhone, onDecide,
  onStartHandover, onCancelHandover, onMakeRecoveryKey, onAddPhone, learning, onClose,
}: PhoneActions & {
  me: Me;
  /** Names to rename people to (from schedules). */
  names: string[];
  onRename: (personId: string, name: string) => Promise<void>;
  onRemove: (personId: string) => Promise<void>;
  onBlock: (personId: string) => Promise<void>;
  onUnblock: (personId: string) => Promise<void>;
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
  const requests = (me.requests ?? []).filter((request) => request.personId !== me.personId);
  const recommended = recommendedSuccessor(people, me.personId);
  const [open, setOpen] = useState<string | null>(null);
  const confirm = useConfirm();
  const [handing, setHanding] = useState(false);
  const [successor, setSuccessor] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [handoverKey, setHandoverKey] = useState<{ key: string; expiresAt: string; name: string } | null>(null);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [showAllLog, setShowAllLog] = useState(false);
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
  const picked = people.find((person) => person.id === successor);
  const log = me.log ?? [];
  const shownLog = showAllLog ? log : log.slice(0, 5);

  return (
    <Sheet title="Owner" onClose={onClose}>
      <div className="owner-head">
        <span className="share-choice-icon"><Crown /></span>
        <span className="share-choice-copy">
          <b>You own Shiftdeck</b>
          <small>
            {people.length} {people.length === 1 ? "person uses" : "people use"} it{blocked.length ? `, ${blocked.length} blocked` : ""}.
            Names are locked; only you change them.
          </small>
        </span>
      </div>
      <button type="button" className="button soft share-make owner-add-phone" onClick={onAddPhone}>
        <Smartphone /> Add another phone of mine
      </button>

      {requests.length > 0 && (
        <>
          <p className="share-section-title">Name changes</p>
          <div className="team-members">
            {requests.map((request) => (
              <div key={request.id} className="team-request">
                <span><b>{request.from}</b> asks to be <b>{request.name}</b></span>
                <span className="team-request-actions">
                  <button type="button" className="button soft" onClick={() => void run(() => onDecide(request.id, false))}>Deny</button>
                  <button type="button" className="button primary" onClick={() => void run(() => onDecide(request.id, true))}>Approve</button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {log.length > 0 && (
        <>
          <p className="share-section-title">New phones</p>
          <ul className="owner-log">
            {shownLog.map((entry) => (
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
          {log.length > 5 && (
            <button type="button" className="share-again owner-log-more" onClick={() => setShowAllLog(!showAllLog)}>
              {showAllLog ? "Show less" : `Show all ${log.length}`}
            </button>
          )}
        </>
      )}

      <p className="share-section-title">Everyone, longest first</p>
      <div className="owner-people">
        {people.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            me={me}
            open={open === person.id}
            onToggle={() => setOpen((current) => current === person.id ? null : person.id)}
            renameTo={names.filter((name) => key(name) === key(person.name) || !people.some((other) => key(other.name) === key(name)))}
            moveTo={[...new Set([...people.filter((other) => !other.owner).map((other) => other.name), ...names])]
              .filter((name) => key(name) !== key(person.name) && !people.some((other) => other.owner && key(other.name) === key(name)))
              .sort((a, b) => a.localeCompare(b))}
            confirm={confirm}
            run={run}
            onRename={onRename}
            onRemove={onRemove}
            onBlock={onBlock}
            onRenamePhone={onRenamePhone}
            onMovePhone={onMovePhone}
            onRemovePhone={onRemovePhone}
          />
        ))}
      </div>
      <p className="share-note">
        Tap a name to see their phones. Block stops someone using the app on every phone of theirs (you can undo it).
        Remove frees their name instead.
      </p>

      {blocked.length > 0 && (
        <>
          <p className="share-section-title">Blocked</p>
          <div className="team-members owner-blocked">
            <ul>
              {blocked.map((person) => (
                <li key={person.id}>
                  <span className="owner-person">
                    <span className="team-member-name"><Ban className="owner-blocked-icon" aria-hidden="true" /> {person.name}</span>
                    <small>
                      Blocked {person.blockedAt ? sinceLabel(person.blockedAt) : ""} · {person.devices} {person.devices === 1 ? "phone" : "phones"}
                    </small>
                  </span>
                  <span className="team-member-actions">
                    <button type="button" className="owner-unblock" onClick={() => void run(() => onUnblock(person.id))}>
                      <Undo2 aria-hidden="true" /> Unblock
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {learning && (
        <>
          <p className="share-section-title">Only you see this</p>
          {learning}
        </>
      )}

      <p className="share-section-title">If you lose your phones</p>
      {recoveryKey ? (
        <div className="owner-key-box">
          <p className="owner-key">{grouped(recoveryKey)}</p>
          <small>
            Save this somewhere only you can get to (written down, or a screenshot in a private album). If every phone of
            yours is lost, pick your name on a new phone and use this key. It works once. You won’t see it again here.
          </small>
          <button type="button" className="button soft share-make" onClick={() => {
            void navigator.clipboard?.writeText(recoveryKey).catch(() => undefined);
          }}>
            <Copy /> Copy
          </button>
          <button type="button" className="share-again" onClick={() => setRecoveryKey("")}>I saved it</button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="button soft share-make owner-handover"
            onClick={() => void run(async () => setRecoveryKey(await onMakeRecoveryKey()))}
          >
            <ShieldCheck /> {me.recoveryKeyMadeAt ? "Make a new recovery key" : "Make a recovery key"}
          </button>
          <p className="share-note">
            {me.recoveryKeyMadeAt
              ? `You made one ${sinceLabel(me.recoveryKeyMadeAt)}. A new one replaces it.`
              : "A 20-digit key that gets you back in if all your phones are lost. Nobody else can become the owner without you."}
          </p>
        </>
      )}

      <p className="share-section-title">Leaving the job?</p>
      {handoverKey ? (
        <div className="owner-key-box">
          <p className="owner-key">{grouped(handoverKey.key)}</p>
          <small>
            Give this to {handoverKey.name.split(" ")[0]} in person. On their phone, Settings shows “Become the owner”; they type
            this key. It works for 24 hours. Until then you’re still the owner, and you can cancel.
          </small>
          <button type="button" className="share-again" onClick={() => setHandoverKey(null)}>Done</button>
        </div>
      ) : me.handover ? (
        <div className="owner-handover-box">
          <p className="owner-handover-status">
            Handing over to <b>{me.handover.name}</b>. Waiting for them to type the key (until {timeLabel(me.handover.expiresAt)}).
          </p>
          <span className="owner-card-actions">
            <button type="button" className="danger" onClick={() => void run(onCancelHandover)}>Cancel handover</button>
            <button type="button" onClick={() => void run(async () => setHandoverKey(await onStartHandover(me.handover!.personId)))}>
              New key
            </button>
          </span>
        </div>
      ) : !handing ? (
        <button type="button" className="button soft share-make owner-handover" onClick={() => setHanding(true)}>
          <Crown /> Hand over ownership
        </button>
      ) : (
        <div className="owner-handover-box">
          <label className="team-join-name">
            <span>Who takes over?</span>
            <span className="team-join-select">
              <select value={successor} onChange={(event) => {
                setSuccessor(event.target.value);
                setConfirming(false);
              }} aria-label="New owner">
                <option value="" disabled>Pick someone</option>
                {people.filter((person) => person.id !== me.personId).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}{recommended?.id === person.id ? " · Recommended (longest here)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
            {recommended && <small>Recommended: {recommended.name}, using it since {sinceLabel(recommended.since)}.</small>}
          </label>
          {picked && (
            <button
              type="button"
              className={`button share-make ${confirming ? "danger" : "primary"}`}
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
              {confirming ? <><Check /> Yes, make a key for {picked.name.split(" ")[0]}</> : <>Hand over to {picked.name.split(" ")[0]}</>}
            </button>
          )}
          {confirming && picked && (
            <p className="share-note">
              You’ll get a 16-digit key to give {picked.name.split(" ")[0]} in person. Ownership only moves when they type it in.
              Then your phones become regular users.
            </p>
          )}
        </div>
      )}
      {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
    </Sheet>
  );
}

/* ---------- one person, and their phones ---------- */

function PersonCard({ person, me, open, onToggle, renameTo, moveTo, confirm, run, onRename, onRemove, onBlock, onRenamePhone, onMovePhone, onRemovePhone }: PhoneActions & {
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
    <div className={`owner-card${open ? " open" : ""}`}>
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
    <li className={`owner-log-row${entry.blocked ? " blocked" : ""}`}>
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
