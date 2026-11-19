"use client";

import { Check, ChevronDown, Crown, KeyRound, LoaderCircle, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { backdropClose } from "./home-sections";
import { recommendedSuccessor, type Me } from "./people";

const sinceLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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

export function LinkPhoneSheet({ name, ownerName, onLink, onNotMe, onClose }: {
  name: string;
  /** The name is the app owner's (so this would be another owner phone). */
  ownerName: boolean;
  onLink: (code: string) => Promise<void>;
  onNotMe: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
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

export function OwnerSheet({ me, names, onRename, onRemove, onDecide, onHandOver, onAddPhone, onClose }: {
  me: Me;
  /** Names to rename people to (from schedules). */
  names: string[];
  onRename: (personId: string, name: string) => Promise<void>;
  onRemove: (personId: string) => Promise<void>;
  onDecide: (requestId: string, approve: boolean) => Promise<void>;
  onHandOver: (personId: string) => Promise<void>;
  onAddPhone: () => void;
  onClose: () => void;
}) {
  const people = me.people ?? [];
  const requests = (me.requests ?? []).filter((request) => request.personId !== me.personId);
  const recommended = recommendedSuccessor(people, me.personId);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [handing, setHanding] = useState(false);
  const [successor, setSuccessor] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
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

  return (
    <Sheet title="Owner" onClose={onClose}>
      <div className="owner-head">
        <span className="share-choice-icon"><Crown /></span>
        <span className="share-choice-copy">
          <b>You own Shiftdeck</b>
          <small>{people.length} {people.length === 1 ? "person uses" : "people use"} it. Names are locked; only you change them.</small>
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

      <p className="share-section-title">Everyone, longest first</p>
      <div className="team-members">
        <ul>
          {people.map((person) => (
            <li key={person.id}>
              {editing === person.id ? (
                <span className="team-join-select team-member-rename">
                  <select
                    autoFocus
                    defaultValue=""
                    aria-label={`New name for ${person.name}`}
                    onChange={(event) => {
                      const name = event.target.value;
                      setEditing(null);
                      if (name) void run(() => onRename(person.id, name));
                    }}
                    onBlur={() => setEditing(null)}
                  >
                    <option value="" disabled>Rename {person.name.split(" ")[0]} to…</option>
                    {names.filter((name) => key(name) === key(person.name) || !people.some((other) => key(other.name) === key(name)))
                      .map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              ) : (
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
              )}
              {editing !== person.id && (
                <span className="team-member-actions">
                  <button type="button" onClick={() => setEditing(person.id)}>Rename</button>
                  {person.id !== me.personId && (
                    <button
                      type="button"
                      className={removing === person.id ? "confirm" : ""}
                      onClick={() => {
                        if (removing === person.id) {
                          setRemoving(null);
                          void run(() => onRemove(person.id));
                        } else {
                          setRemoving(person.id);
                          window.setTimeout(() => setRemoving((current) => current === person.id ? null : current), 3500);
                        }
                      }}
                    >
                      {removing === person.id ? "Tap to remove" : "Remove"}
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="share-note">Removing someone frees their name; their phone picks a name again next time it opens.</p>

      <p className="share-section-title">Leaving the job?</p>
      {!handing ? (
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
                else void run(() => onHandOver(picked.id));
              }}
            >
              {confirming ? <><Check /> Yes, make {picked.name.split(" ")[0]} the owner</> : <>Hand over to {picked.name.split(" ")[0]}</>}
            </button>
          )}
          {confirming && picked && (
            <p className="share-note">You (and your other phones) become a regular user. {picked.name.split(" ")[0]} can hand it back.</p>
          )}
        </div>
      )}
      {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
    </Sheet>
  );
}
