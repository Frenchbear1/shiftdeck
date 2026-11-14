"use client";

import { useEffect, useState } from "react";
import type { Flight } from "./sample-data";
import type { AirportAlert } from "../worker/live-flight-data";

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
  estimatedOn?: string | null;
  airportBoardId?: string;
  airportBoardSeenAt?: number;
  /** Shiftdeck's own estimate while it tracks the plane (free ADS-B + history). */
  liveEta?: {
    landing: string;
    gate: string;
    distanceNm: number;
    seenAt: string;
    method: "history" | "physics" | string;
  } | null;
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
  airportBoardUpdatedAt?: string | null;
  airportAlerts?: { updatedAt: string; notices: AirportAlert[] } | null;
};

export type RefreshResult = "ok" | "needs-emergency" | "cooldown" | "none" | "budget" | "error";

// Reading is free (it never calls FlightAware), and tracked flights change every minute.
const READ_EVERY_MS = 60_000;

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
    airportBoardUpdatedAt?: string | null;
    airportAlerts?: LiveFlights["airportAlerts"];
  }) => {
    if (!data.enabled || !Array.isArray(data.flights)) return;
    setLive({
      updatedAt: data.updatedAt ?? null,
      flights: data.flights,
      status: data.status ?? null,
      airportBoardUpdatedAt: data.airportBoardUpdatedAt ?? null,
      airportAlerts: data.airportAlerts ?? null,
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

const abeClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const abeWallInstant = (instant: number) => Date.parse(abeClock.format(instant).replace(" ", "T") + ":00Z");

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
  /** Set when the time comes from Shiftdeck's own tracking, not FlightAware. */
  tracked: LiveFlight["liveEta"];
};

/** Finds the live record for the leg a flight row shows (its arrival, or departure for "Out"). */
export function matchLiveFlight(
  flight: Flight,
  shownTime: string,
  live: LiveFlights | null,
): LiveMatch | null {
  if (!live?.flights.length) return null;
  const kind = flight.kind === "departure" ? "departure" : "arrival";
  const ident = flight.trackingId?.toUpperCase().replace(/^AAY/, "G4");
  const other =
    kind === "departure"
      ? flight.outboundAirport ?? flight.destination
      : flight.inboundAirport ?? flight.origin;
  const wanted = airportCodes(other);

  const [hours, minutes] = shownTime.split(":").map(Number);
  const base = new Date(`${flight.date}T00:00:00`);
  base.setHours(hours, minutes, 0, 0);
  // Night shifts can list an after-midnight flight under the evening's date.
  const nextDay = new Date(base);
  nextDay.setDate(nextDay.getDate() + 1);
  const aeroTargets = [base.getTime(), nextDay.getTime()];
  const wallTime = Date.parse(`${flight.date}T${shownTime}:00Z`);
  const boardTargets = hours < 6 && flight.source !== "airport-board" ? [wallTime, wallTime + 86_400_000] : [wallTime];

  let best: { live: LiveFlight; gap: number; exactIdent: boolean } | null = null;
  for (const candidate of live.flights) {
    if (candidate.kind !== kind || !candidate.scheduled) continue;
    const exactIdent = Boolean(ident && ident === candidate.ident.replace(/^AAY/, "G4"));
    if (candidate.airportBoardId && ident && !exactIdent) continue;
    const sameAirport = exactIdent || (!wanted.length || candidate.other.some((code) => wanted.includes(code)));
    if (!sameAirport) continue;
    const instant = Date.parse(candidate.scheduled);
    if (!Number.isFinite(instant)) continue;
    const scheduled = candidate.airportBoardId ? abeWallInstant(instant) : instant;
    const targets = candidate.airportBoardId ? boardTargets : aeroTargets;
    const gap = Math.min(...targets.map((target) => Math.abs(scheduled - target)));
    const limit = exactIdent ? 3 * 60 * 60_000 : wanted.length ? 45 * 60_000 : 10 * 60_000;
    if (gap <= limit && (!best || (exactIdent === best.exactIdent ? gap < best.gap : exactIdent))) {
      best = { live: candidate, gap, exactIdent };
    }
  }
  if (!best) return null;

  const match = best.live;
  // Our tracked estimate is newer than FlightAware's between refreshes.
  const tracked = match.kind === "arrival" && !match.done && !match.cancelled ? match.liveEta ?? null : null;
  const current = new Date(tracked?.gate ?? match.estimated ?? match.scheduled ?? "");
  const delay = Math.round(
    (current.getTime() - Date.parse(match.scheduled ?? "")) / 60_000,
  );
  const label = match.cancelled
    ? "Cancelled"
    : match.airportBoardId && match.done
      ? match.status
    : tracked
      ? `${Math.max(1, Math.round(tracked.distanceNm))} nm out`
      : match.done
      ? match.kind === "arrival"
        ? "Landed"
        : "Left"
      : /en route|taxiing|landed|arrived|departed|in air|delay|diverted|boarding|early|on time/i.test(match.status)
        ? match.status.replace(/\s*\/.*$/, "")
        : null;
  const time = match.airportBoardId ? abeClock.format(current).slice(-5) : clockOf(current);
  return { live: match, time, delay, label, tracked };
}

/** Show board flights even if they were omitted from the imported shift schedule. */
export function addAbeBoardFlights(flights: Flight[], date: string, live: LiveFlights | null) {
  if (!live?.airportBoardUpdatedAt) return flights;
  const matches = new Set<string>();
  for (const flight of flights) {
    const match = matchLiveFlight(flight, flight.kind === "departure" ? flight.departure ?? flight.start : flight.arrival ?? flight.start, live);
    if (match) matches.add(match.live.id);
    if (flight.kind === "turnaround" && flight.departure) {
      const out = matchLiveFlight({ ...flight, kind: "departure" }, flight.departure, live);
      if (out) matches.add(out.live.id);
    }
  }
  const additional: Flight[] = [];
  for (const flight of live.flights) {
    if (!flight.airportBoardId || !flight.scheduled || matches.has(flight.id)) continue;
    const [day, time] = abeClock.format(Date.parse(flight.scheduled)).split(" ");
    if (day !== date) continue;
    const hour = Number(time.slice(0, 2));
    const other = flight.other[0] ?? "TBD";
    additional.push({
      id: flight.airportBoardId, date, start: time, raw: flight.ident,
      period: hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening",
      kind: flight.kind, trackingId: flight.ident, source: "airport-board",
      ...(flight.kind === "arrival" ? { origin: other } : { origin: "ABE", destination: other }),
    });
  }
  return additional.length ? [...flights, ...additional] : flights;
}
