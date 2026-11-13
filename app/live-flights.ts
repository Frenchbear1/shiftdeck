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
  gate?: string | null;
  baggage?: string | null;
  aircraft?: string | null;
  registration?: string | null;
  delayMinutes?: number | null;
  leftGateAt?: string | null;
  tookOffAt?: string | null;
  landedAt?: string | null;
  atGateAt?: string | null;
  progress?: number | null;
};

export type LiveStatus = {
  dailyLimit: number;
  used: number;
  emergencyLimit: number;
  emergencyUsed: number;
  cooldownMinutes: number;
  nextAt: string | null;
  monthSpentCents: number;
  monthFreeCents: number;
  budgetCents: number;
  /** What tapping refresh does right now. */
  available: "normal" | "emergency" | "cooldown" | "none" | "budget";
};

export type LiveFlights = {
  updatedAt: string | null;
  flights: LiveFlight[];
  status: LiveStatus | null;
};

export type RefreshResult = "ok" | "needs-emergency" | "cooldown" | "none" | "budget" | "error";

const READ_EVERY_MS = 2 * 60_000;

/**
 * Reads the shared copy of live times from the worker (free; it never calls
 * FlightAware). Only `refresh` asks FlightAware, and the worker limits that
 * for everyone combined.
 */
export function useLiveFlights(baseUrl: string) {
  const [live, setLive] = useState<LiveFlights | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const accept = (data: {
    enabled?: boolean;
    updatedAt?: string | null;
    flights?: LiveFlight[];
    status?: LiveStatus;
  }) => {
    if (!data.enabled || !Array.isArray(data.flights)) return;
    setLive({
      updatedAt: data.updatedAt ?? null,
      flights: data.flights,
      status: data.status ?? null,
    });
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(baseUrl, { cache: "no-store" });
          const data = await response.json();
          if (!cancelled) accept(data);
        } catch {
          // Offline or worker not deployed yet: keep schedule times.
        }
      }
      if (!cancelled) timer = window.setTimeout(load, READ_EVERY_MS);
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
  }, [baseUrl]);

  const refresh = async (emergency = false): Promise<RefreshResult> => {
    if (refreshing) return "cooldown";
    setRefreshing(true);
    try {
      const url = new URL(baseUrl, window.location.href);
      url.pathname = url.pathname.replace(/\/?$/, "/refresh");
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emergency }),
      });
      const data = await response.json();
      accept(data);
      if (response.ok) return "ok";
      return (data.refused as RefreshResult | undefined) ?? "error";
    } catch {
      return "error";
    } finally {
      setRefreshing(false);
    }
  };

  return { live, refresh, refreshing };
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
