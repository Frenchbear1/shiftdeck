/** Flight alerts: the choices, and what a flight's state calls for (pure, for tests). */
import type { LiveFlight } from "./live-flight-data";

export type FlightAlertPrefs = {
  /** Which flights: the ones in your shifts, every Allegiant flight, or none. */
  which: "shifts" | "all" | "off";
  /** Minutes before landing (null: no landing reminder). */
  landingLead: number | null;
  cancelled: boolean;
  delayed: boolean;
  inAir: boolean;
  landed: boolean;
  gate: boolean;
};

/** A flight in one of your shifts (from the schedule). */
export type WatchedFlight = { ident: string; kind: "arrival" | "departure"; at: string };

export const DEFAULT_FLIGHT_ALERTS: FlightAlertPrefs = {
  which: "shifts",
  landingLead: 10,
  cancelled: true,
  delayed: true,
  inAir: true,
  landed: false,
  gate: true,
};

const MINUTE = 60_000;
const DELAY_STEP = 15;
const MAX_WATCH = 120;

/* ---------- saving a profile's choices ---------- */

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const identOf = (value: unknown) => {
  const match = String(value ?? "").toUpperCase().replace(/\s+/g, "").match(/^(?:G4|AAY)(\d{1,4})$/);
  return match ? `G4${Number(match[1])}` : null;
};

export function normalizeFlightAlerts(raw: unknown): FlightAlertPrefs {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof FlightAlertPrefs, unknown>>;
  const lead = Number(value.landingLead);
  return {
    which: value.which === "all" || value.which === "off" ? value.which : "shifts",
    landingLead: value.landingLead === null ? null
      : Number.isFinite(lead) && lead >= 1 && lead <= 180 ? Math.round(lead) : DEFAULT_FLIGHT_ALERTS.landingLead,
    cancelled: bool(value.cancelled, DEFAULT_FLIGHT_ALERTS.cancelled),
    delayed: bool(value.delayed, DEFAULT_FLIGHT_ALERTS.delayed),
    inAir: bool(value.inAir, DEFAULT_FLIGHT_ALERTS.inAir),
    landed: bool(value.landed, DEFAULT_FLIGHT_ALERTS.landed),
    gate: bool(value.gate, DEFAULT_FLIGHT_ALERTS.gate),
  };
}

export function normalizeWatch(raw: unknown): WatchedFlight[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_WATCH).flatMap((item) => {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const ident = identOf(entry.ident);
    const at = Date.parse(String(entry.at ?? ""));
    const kind = entry.kind === "departure" ? "departure" : "arrival";
    const key = `${ident}|${kind}|${at}`;
    if (!ident || !Number.isFinite(at) || seen.has(key)) return [];
    seen.add(key);
    return [{ ident, kind, at: new Date(at).toISOString() }];
  });
}

/** One of your shifts, as instants (from the shifts the app already syncs for reminders). */
export type ShiftWindow = { start: number; end: number };

const ARRIVAL_LEAD = 45 * MINUTE;
const DELAY_GRACE = 6 * 60 * MINUTE;

/** A shift row (start_at in UTC, HH:MM start/end) → its window; overnight shifts end the next day. */
export function shiftWindow(startAt: string, startTime: string, endTime: string): ShiftWindow | null {
  const start = Date.parse(startAt);
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const from = toMinutes(startTime);
  const to = toMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const length = ((to - from + 1440) % 1440) || 1440;
  return { start, end: start + length * MINUTE };
}

/**
 * Is this flight in one of your shifts? Same rule as Home's "My shift": its live
 * time is in the shift (arrivals up to 45 min before you start), or it was
 * scheduled in the shift and is no more than 6 hours late past the end.
 */
export function inShifts(flight: LiveFlight, windows: ShiftWindow[]) {
  const scheduled = instant(flight.scheduled);
  const live = flight.kind === "arrival" ? landingAt(flight) : instant(flight.estimated) ?? scheduled;
  const lead = flight.kind === "arrival" ? ARRIVAL_LEAD : 0;
  return windows.some(({ start, end }) => {
    const inside = (time: number | null) => time !== null && time >= start - lead && time <= end;
    return inside(live) || (inside(scheduled) && (live === null || live <= end + DELAY_GRACE));
  });
}

/* ---------- what's worth telling ---------- */

export type FlightNews = { kind: string; title: string; body: string; silent?: boolean };

export const instant = (value: string | null | undefined) => {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
};

/** When it touches down: our tracking first, then FlightAware's runway time, then the gate time. */
export const landingAt = (flight: LiveFlight) =>
  instant(flight.liveEta?.landing) ?? instant(flight.estimatedOn) ?? instant(flight.estimated) ?? instant(flight.scheduled);

/** The flight's key, shared by everyone: G4854-arrival-2026-11-19 (ABE's date). */
export function flightKey(flight: LiveFlight, timezone = "America/New_York") {
  const scheduled = instant(flight.scheduled) ?? 0;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(scheduled);
  return `${flight.ident.replace(/^AAY/, "G4")}-${flight.kind}-${day}`;
}

/** Down: a touchdown seen, or the board's "Arrived" (unless our tracking still has it flying). */
export const isLanded = (flight: LiveFlight) =>
  Boolean(flight.landedAt || flight.atGateAt) ||
  (flight.kind === "arrival" && Boolean(flight.done) && !flight.cancelled && !flight.liveEta);

/**
 * The alerts a flight calls for right now, given what was already sent for it
 * (kinds like "cancelled", "delay:2", "gate:8"). Pure, for tests.
 */
export function flightNews(
  flight: LiveFlight,
  prefs: FlightAlertPrefs,
  sent: Set<string>,
  now: number,
  airborneAt: number | null,
  clock: (time: number) => string,
): FlightNews[] {
  const name = `${flight.ident.replace(/^(G4|AAY)/, "G4 ")}`;
  const place = flight.other.find((code) => /^[A-Z]{3}$/.test(code)) ?? flight.other[0] ?? "";
  const route = place ? (flight.kind === "arrival" ? ` from ${place}` : ` to ${place}`) : "";
  const gate = flight.gate ? `Gate ${flight.gate}` : "";
  const news: FlightNews[] = [];
  const landing = flight.kind === "arrival" ? landingAt(flight) : null;
  const landsText = landing ? `lands about ${clock(landing)}` : "";

  if (flight.cancelled) {
    if (prefs.cancelled && !sent.has("cancelled")) {
      const scheduled = instant(flight.scheduled);
      news.push({ kind: "cancelled", title: `${name}${route} is cancelled`, body: scheduled ? `It was due at ${clock(scheduled)}.` : "Check the flight board." });
    }
    return news;
  }

  // The first gate it's given isn't news; a change is.
  if (flight.gate) {
    const gates = [...sent].filter((kind) => kind.startsWith("gate:"));
    const kind = `gate:${flight.gate}`;
    if (!gates.length) news.push({ kind, title: "", body: "", silent: true });
    else if (!sent.has(kind)) {
      const was = gates.at(-1)!.slice(5);
      news.push({ kind, title: `${name} gate change: now Gate ${flight.gate}`, body: [`Was gate ${was}`, landsText].filter(Boolean).join(" · "), silent: !prefs.gate });
    }
  }

  const landed = isLanded(flight);
  if (flight.kind === "arrival" && !landed) {
    const flying = airborneAt !== null || Boolean(flight.tookOffAt) || Boolean(flight.liveEta);
    if (flying && !sent.has("inair")) {
      news.push({ kind: "inair", title: `${name}${route} is in the air`, body: [landsText, gate].filter(Boolean).join(" · "), silent: !prefs.inAir });
    }
    // Only from a real estimate (or once it's flying), never from the timetable alone.
    const estimated = Boolean(flight.liveEta || flight.estimatedOn || flight.estimated) || flying;
    const lead = prefs.landingLead;
    if (lead && landing && estimated && !sent.has("landing")) {
      const left = (landing - now) / MINUTE;
      if (left <= lead && left > -3) {
        const minutes = Math.max(1, Math.round(left));
        // The gate up front: it's where you're headed.
        news.push({
          kind: "landing",
          title: `${name} lands in ~${minutes} min · ${flight.gate ? `Gate ${flight.gate}` : "gate not posted yet"}`,
          body: [place ? `From ${place}` : "", `about ${clock(landing)}`].filter(Boolean).join(" · "),
        });
      }
    }
  }
  if (landed && flight.kind === "arrival" && !sent.has("landed")) {
    news.push({ kind: "landed", title: `${name}${route} landed`, body: gate || "At ABE", silent: !prefs.landed });
  }

  // Delays: once at 15 minutes late, again at 30, 45…
  const delay = flight.delayMinutes ?? null;
  if (!landed && delay !== null && delay >= DELAY_STEP) {
    const step = Math.floor(delay / DELAY_STEP);
    const already = Math.max(0, ...[...sent].filter((kind) => kind.startsWith("delay:")).map((kind) => Number(kind.slice(6)) || 0));
    if (step > already) {
      const scheduled = instant(flight.scheduled);
      const expected = instant(flight.estimated) ?? (scheduled !== null ? scheduled + delay * MINUTE : null);
      news.push({
        kind: `delay:${step}`,
        title: `${name}${route} is delayed ${delay} min`,
        body: [expected ? `Now about ${clock(expected)}` : "", scheduled ? `was ${clock(scheduled)}` : ""].filter(Boolean).join(", "),
        silent: !prefs.delayed,
      });
    }
  }
  return news;
}

