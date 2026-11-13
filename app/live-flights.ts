"use client";

import { useEffect, useState } from "react";
import type { Flight } from "./sample-data";

/** Mirrors worker/flight-status.ts. */
export type LiveFlight = {
  id: string;
  ident: string;
  kind: "arrival" | "departure";
  other: string[];
  scheduled: string | null;
  estimated: string | null;
  status: string;
  cancelled: boolean;
  done?: boolean;
};

export type LiveFlights = {
  updatedAt: string | null;
  flights: LiveFlight[];
};

const REFRESH_MS = 5 * 60_000;

/**
 * Polls the worker while `active` (viewing today/tomorrow) and the app is on
 * screen. The worker caches and rations AeroAPI, so polling here is cheap.
 */
export function useLiveFlights(url: string, active: boolean) {
  const [live, setLive] = useState<LiveFlights | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(url, { cache: "no-store" });
          const data = (await response.json()) as {
            enabled?: boolean;
            updatedAt?: string;
            flights?: LiveFlight[];
          };
          if (!cancelled && data.enabled && Array.isArray(data.flights)) {
            setLive({ updatedAt: data.updatedAt ?? null, flights: data.flights });
          }
        } catch {
          // Offline or worker not deployed yet: keep schedule times.
        }
      }
      if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, active]);

  return live;
}

const pad = (value: number) => String(value).padStart(2, "0");
export const clockOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const airportCodes = (code?: string) => {
  const value = (code ?? "").trim().toUpperCase();
  if (!value) return [];
  return /^K[A-Z]{3}$/.test(value) ? [value, value.slice(1)] : [value, `K${value}`];
};

export type LiveMatch = {
  live: LiveFlight;
  /** Best current time as "HH:MM" local. */
  time: string;
  /** Minutes later (+) or earlier (−) than the airline's schedule. */
  delay: number;
  label: string | null;
};

/** Finds the live record for the leg a flight row shows (its arrival, or departure for "Out"). */
export function matchLiveFlight(
  flight: Flight,
  shownTime: string,
  live: LiveFlights | null,
): LiveMatch | null {
  if (!live?.flights.length) return null;
  const kind = flight.kind === "departure" ? "departure" : "arrival";
  const other =
    kind === "departure"
      ? flight.outboundAirport ?? flight.destination
      : flight.inboundAirport ?? flight.origin;
  const wanted = airportCodes(other);

  const [hours, minutes] = shownTime.split(":").map(Number);
  const base = new Date(`${flight.date}T00:00:00`);
  base.setHours(hours, minutes, 0, 0);
  // Night shifts can list an after-midnight flight under the evening's date.
  const targets = [base.getTime(), base.getTime() + 86_400_000];

  let best: { live: LiveFlight; gap: number } | null = null;
  for (const candidate of live.flights) {
    if (candidate.kind !== kind || !candidate.scheduled) continue;
    const sameAirport =
      !wanted.length || candidate.other.some((code) => wanted.includes(code));
    if (!sameAirport) continue;
    const scheduled = Date.parse(candidate.scheduled);
    const gap = Math.min(...targets.map((target) => Math.abs(scheduled - target)));
    const limit = wanted.length ? 45 * 60_000 : 10 * 60_000;
    if (gap <= limit && (!best || gap < best.gap)) best = { live: candidate, gap };
  }
  if (!best) return null;

  const match = best.live;
  const current = new Date(match.estimated ?? match.scheduled ?? "");
  const delay = Math.round(
    (current.getTime() - Date.parse(match.scheduled ?? "")) / 60_000,
  );
  const label = match.cancelled
    ? "Cancelled"
    : match.done
      ? match.kind === "arrival"
        ? "Landed"
        : "Left"
      : /en route|taxiing|landed|arrived|departed/i.test(match.status)
        ? match.status.replace(/\s*\/.*$/, "")
        : null;
  return { live: match, time: clockOf(current), delay, label };
}
