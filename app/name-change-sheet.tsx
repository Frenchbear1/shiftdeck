"use client";

import { ChevronDown, LoaderCircle, Lock, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { backdropClose } from "./home-sections";

/** Your name is locked on this phone; the app's owner changes it when you ask. */
export function NameChangeSheet({ current, ownerName, pending, names, onRequest, onWithdraw, onAddPhone, onClose }: {
  current: string;
  ownerName: string | null;
  /** Your request that's waiting on the owner, if any. */
  pending: { id: string; name: string } | null;
  /** Names to pick from (your schedules). */
  names: string[];
  onRequest: (name: string) => Promise<void>;
  onWithdraw: (requestId: string) => Promise<void>;
  onAddPhone: () => void;
  onClose: () => void;
}) {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  const choices = names.filter((name) => key(name) !== key(current));
  const [choice, setChoice] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const typing = choice === "__other__";
  const wanted = typing ? typed.trim() : choice;
  const owner = ownerName?.split(" ")[0] ?? "the app’s owner";

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet" role="dialog" aria-modal="true" aria-label="Your name">
        <header className="sheet-head sheet-head-tools">
          <h2>Your name</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          <div className="share-done">
            <span className="share-done-icon"><Lock /></span>
            <p>{current}</p>
            <small>
              Your name is locked, so nobody can switch names to see someone else’s things. Only {owner} can change it.
            </small>
          </div>
          {pending ? (
            <div className="share-iphone">
              <b>Waiting on {owner}</b>
              <small>You asked to be {pending.name}. You’ll get a ping when it’s decided.</small>
              <button
                type="button"
                className="button soft"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onWithdraw(pending.id);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Take it back
              </button>
            </div>
          ) : (
            <form
              className="team-join"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!wanted) return;
                setBusy(true);
                setProblem("");
                try {
                  await onRequest(wanted);
                } catch (failure) {
                  setProblem(failure instanceof Error ? failure.message : "That couldn’t be sent.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="team-join-name">
                <span>Ask {owner} to change it to</span>
                <span className="team-join-select">
                  <select value={choice} onChange={(event) => setChoice(event.target.value)} aria-label="New name">
                    <option value="" disabled>Pick a name</option>
                    {choices.map((name) => <option key={name} value={name}>{name}</option>)}
                    <option value="__other__">Someone else…</option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
                {typing && (
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder="First and last name"
                    aria-label="Type the name"
                    autoFocus
                    maxLength={40}
                  />
                )}
              </label>
              {problem && <p className="contacts-notice share-error" role="alert">{problem}</p>}
              <button type="submit" className="button primary share-make" disabled={busy || !wanted}>
                {busy ? <LoaderCircle className="spin" /> : null} Send request
              </button>
            </form>
          )}
          <p className="share-section-title">Another device?</p>
          <button type="button" className="button soft share-make" onClick={onAddPhone}>
            <Smartphone /> Add a device
          </button>
        </div>
      </section>
    </div>
  );
}
