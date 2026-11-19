"use client";

import { ChevronDown } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import type { LiveStatus } from "./live-flights";

/** One-line summary that expands to the full card when tapped. */
function Collapsible({
  title,
  summary,
  tone,
  children,
}: {
  title: string;
  summary: ReactNode;
  tone?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`live-status-setting collapsible ${open ? "open" : ""}`}>
      <button type="button" className="collapsible-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        <b className={tone}>{summary}</b>
        <ChevronDown />
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const clock = (date: Date) =>
  date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Shared refresh usage for live flight times, shown in Settings. */
export function LiveStatusSetting({
  status,
  updatedAt,
}: {
  status: LiveStatus;
  updatedAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const nextAt = status.nextAt ? Date.parse(status.nextAt) : 0;
  const waiting = nextAt > now;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const left = Math.max(0, Math.ceil((nextAt - now) / 1000));
  const emergencyLeft = Math.max(0, status.emergencyLimit - status.emergencyUsed);
  const next =
    status.available === "budget"
      ? "Paused until next month (free amount used)"
      : waiting
        ? `Next refresh in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
        : status.available === "none"
          ? "All refreshes used · resets at midnight"
          : status.available === "emergency"
            ? "Next refresh: emergency only"
            : "Next refresh: available now";

  const short = waiting
    ? `next ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
    : status.available === "none"
      ? "used up"
      : status.available === "budget"
        ? "paused"
        : "ready";
  return (
    <Collapsible
      title="Live times"
      summary={`${status.used}/${status.dailyLimit} today · ${short}`}
      tone={waiting ? "waiting" : ""}
    >
      <span>Shared by everyone</span>
      <b>
        {status.used} of {status.dailyLimit} refreshes used today · {emergencyLeft} emergency left
      </b>
      <div className="live-status-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (status.used / status.dailyLimit) * 100)}%` }} />
      </div>
      <small className={waiting ? "waiting" : ""}>{next}</small>
      <small>
        This month: {money(status.monthSpentCents)} of {money(status.monthFreeCents)} free used
        {updatedAt ? ` · last updated ${clock(new Date(updatedAt))}` : ""}
      </small>
    </Collapsible>
  );
}

type LearningResults = {
  enabled: boolean;
  since: string | null;
  tracking: number;
  storageKb: number;
  flights: number;
  seen: number;
  firstSeenNm: number | null;
  faErr30: number | null;
  faErr15: number | null;
  ourErr30: number | null;
  ourErr15: number | null;
  ourSamples: number;
  runways: { runway: string; flights: number; taxiMin: number | null }[];
  aircraft?: { family: string; flights: number; ourErr15: number | null }[];
};

const minutes = (value: number | null) => (value === null ? "—" : `~${value} min`);

/**
 * Learning results are fetched once in the background (when the app has
 * live times) and kept here, so Settings opens with them already in place
 * instead of the row popping in a moment later.
 */
let learning: { url: string; results: LearningResults | null; done: boolean; pending?: Promise<void> } | null = null;
const listeners = new Set<() => void>();

export function prefetchLearning(url: string) {
  if (learning?.url === url && (learning.done || learning.pending)) return learning.pending;
  learning = { url, results: learning?.url === url ? learning.results : null, done: false };
  const current = learning;
  current.pending = fetch(url, { cache: "no-store" })
    .then((response) => response.json())
    .then((data: LearningResults) => {
      current.results = data?.enabled ? data : null;
    })
    .catch(() => undefined)
    .finally(() => {
      current.done = true;
      current.pending = undefined;
      listeners.forEach((listener) => listener());
    });
  return current.pending;
}

/** A same-height stand-in while something in Settings is still on its way. */
export function SettingPlaceholder({ title }: { title: string }) {
  return (
    <div className="live-status-setting collapsible is-loading" aria-busy="true">
      <div className="collapsible-head">
        <span>{title}</span>
        <b><i className="setting-shimmer" /></b>
        <ChevronDown />
      </div>
    </div>
  );
}

/** What the flight-learning worker has figured out so far, shown in Settings. */
export function LearningSetting({ url }: { url: string }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((count) => count + 1);
    listeners.add(listener);
    void prefetchLearning(url);
    return () => {
      listeners.delete(listener);
    };
  }, [url]);

  const state = learning?.url === url ? learning : null;
  if (!state?.done && !state?.results) return <SettingPlaceholder title="Flight learning" />;
  const results = state.results;
  if (!results) return null;
  const since = results.since
    ? new Date(results.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const seenPct = results.flights ? Math.round((results.seen / results.flights) * 100) : 0;

  const summary = !results.flights
    ? results.tracking
      ? `watching ${results.tracking}`
      : "collecting"
    : results.ourErr15 !== null && results.faErr15 !== null
      ? `${results.flights} logged · ±${results.ourErr15} vs ±${results.faErr15} min`
      : `${results.flights} logged · ${seenPct}% seen`;
  return (
    <Collapsible title="Flight learning" summary={summary}>
      <span>{since ? `Since ${since}` : "Flight learning"}</span>
      {results.flights === 0 ? (
        <small>
          Collecting{results.tracking ? ` · watching ${results.tracking} flight${results.tracking === 1 ? "" : "s"}` : ""}.
          Results show here after the first few arrivals.
        </small>
      ) : (
        <>
          <b>
            {results.flights} arrival{results.flights === 1 ? "" : "s"} logged · free tracking saw{" "}
            {results.seen} ({seenPct}%)
          </b>
          {results.firstSeenNm !== null && (
            <small>Usually first spotted ~{Math.round(results.firstSeenNm)} nm out</small>
          )}
          <div className="learning-compare">
            <span />
            <span>30 min out</span>
            <span>15 min out</span>
            <span>FlightAware</span>
            <span>{minutes(results.faErr30)}</span>
            <span>{minutes(results.faErr15)}</span>
            <span>Shiftdeck</span>
            <span>{minutes(results.ourErr30)}</span>
            <span>{minutes(results.ourErr15)}</span>
          </div>
          <small>
            How far off each landing estimate typically was
            {results.ourSamples ? ` · Shiftdeck from ${results.ourSamples} tracked landing${results.ourSamples === 1 ? "" : "s"}` : ""}
          </small>
          {results.runways.length > 0 && (
            <small>
              {results.runways
                .map(
                  (runway) =>
                    `Rwy ${runway.runway}: ${runway.flights}${runway.taxiMin !== null ? ` · taxi ~${runway.taxiMin} min` : ""}`,
                )
                .join("  ·  ")}
            </small>
          )}
          {results.aircraft && results.aircraft.length > 0 && (
            <small>
              {results.aircraft
                .map(
                  (group) =>
                    `${group.family}s: ${group.flights}${group.ourErr15 !== null ? ` · ±${group.ourErr15} min` : ""}`,
                )
                .join("  ·  ")}
            </small>
          )}
        </>
      )}
      <small>Storage ~{results.storageKb} KB · odd flights cleared after 90 days</small>
    </Collapsible>
  );
}
