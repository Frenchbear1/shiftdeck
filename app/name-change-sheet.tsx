"use client";

import { ChevronDown, LoaderCircle, Lock, X } from "lucide-react";
import { useState } from "react";
import { backdropClose } from "./home-sections";
import type { NameRequest, Team } from "./team";

/**
 * Your name is locked on this phone. On a team, you ask its owner to change
 * it; without one there's nobody to ask yet.
 */
export function NameChangeSheet({ current, team, pending, names, taken, onRequest, onWithdraw, onClose }: {
  current: string;
  team: Team | null;
  /** Your request that's waiting on the owner, if any. */
  pending: NameRequest | null;
  /** Names to pick from (the team's list and your schedules). */
  names: string[];
  /** Names other teammates already have. */
  taken: string[];
  onRequest: (name: string) => Promise<void>;
  onWithdraw: (requestId: string) => Promise<void>;
  onClose: () => void;
}) {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  const takenKeys = new Set(taken.map(key));
  const choices = names.filter((name) => key(name) !== key(current));
  const [choice, setChoice] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(false);
  const typing = choice === "__other__";
  const wanted = typing ? typed.trim() : choice;
  const owner = team?.people?.find((person) => person.id === team.ownerId)?.name.split(" ")[0] ?? "the team owner";

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet" role="dialog" aria-modal="true" aria-label="Change your name">
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
              Your name is locked on this phone, so nobody can switch names to see someone else’s things.
              {team ? ` Only ${owner}, who runs ${team.name}, can change it.` : ""}
            </small>
          </div>
          {!team ? (
            <p className="share-note">
              To change it, join your team (from an invite link), then ask its owner from here.
            </p>
          ) : pending || sent ? (
            <div className="share-iphone">
              <b>Waiting on {owner}</b>
              <small>{pending ? `You asked to be ${pending.name}.` : "Your request was sent."} You’ll get a ping when it’s decided.</small>
              {pending && (
                <button
                  type="button"
                  className="button soft"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onWithdraw(pending.id);
                      setSent(false);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Take it back
                </button>
              )}
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
                  setSent(true);
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
                    {choices.map((name) => (
                      <option key={name} value={name} disabled={takenKeys.has(key(name))}>
                        {takenKeys.has(key(name)) ? `${name} (on the team)` : name}
                      </option>
                    ))}
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
        </div>
      </section>
    </div>
  );
}
