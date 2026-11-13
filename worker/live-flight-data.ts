/** Pure AeroAPI → Shiftdeck flight helpers (no imports, so tests can load them). */

export type LiveFlight = {
  id: string;
  ident: string;
  kind: "arrival" | "departure";
  /** The other airport (origin for arrivals, destination for departures). */
  other: string[];
  scheduled: string | null;
  estimated: string | null;
  status: string;
  cancelled: boolean;
  /** Set once the flight leaves AeroAPI's "scheduled" lists. */
  done?: boolean;
  /** Gate at the home airport (arrival gate, or departure gate for "Out"). */
  gate?: string | null;
  baggage?: string | null;
  aircraft?: string | null;
  registration?: string | null;
  /** Minutes late (+) or early (−) per FlightAware. */
  delayMinutes?: number | null;
  /** Arrivals: when it left the gate / took off at the origin. */
  leftGateAt?: string | null;
  tookOffAt?: string | null;
  /** Arrivals: landed / reached the gate here. Departures: left the gate / took off here. */
  landedAt?: string | null;
  atGateAt?: string | null;
  progress?: number | null;
};

export type AeroAirport = {
  code?: string | null;
  code_iata?: string | null;
  code_icao?: string | null;
  code_lid?: string | null;
} | null;

export type AeroFlight = {
  fa_flight_id: string;
  ident?: string | null;
  ident_iata?: string | null;
  origin?: AeroAirport;
  destination?: AeroAirport;
  scheduled_out?: string | null;
  estimated_out?: string | null;
  scheduled_off?: string | null;
  estimated_off?: string | null;
  scheduled_on?: string | null;
  estimated_on?: string | null;
  scheduled_in?: string | null;
  estimated_in?: string | null;
  actual_out?: string | null;
  actual_off?: string | null;
  actual_on?: string | null;
  actual_in?: string | null;
  gate_origin?: string | null;
  gate_destination?: string | null;
  baggage_claim?: string | null;
  aircraft_type?: string | null;
  registration?: string | null;
  departure_delay?: number | null;
  arrival_delay?: number | null;
  progress_percent?: number | null;
  status?: string | null;
  cancelled?: boolean | null;
};

const codes = (airport: AeroAirport) =>
  [airport?.code_iata, airport?.code_lid, airport?.code_icao, airport?.code]
    .filter((code): code is string => Boolean(code))
    .map((code) => code.toUpperCase())
    .filter((code, index, all) => all.indexOf(code) === index);

export function toLiveFlight(
  flight: AeroFlight,
  kind: "arrival" | "departure",
): LiveFlight {
  return {
    id: flight.fa_flight_id,
    ident: flight.ident_iata ?? flight.ident ?? "",
    kind,
    other: codes(kind === "arrival" ? flight.origin ?? null : flight.destination ?? null),
    scheduled:
      kind === "arrival"
        ? flight.scheduled_in ?? flight.scheduled_on ?? null
        : flight.scheduled_out ?? flight.scheduled_off ?? null,
    estimated:
      kind === "arrival"
        ? flight.estimated_in ?? flight.estimated_on ?? null
        : flight.estimated_out ?? flight.estimated_off ?? null,
    status: flight.status ?? "",
    cancelled: Boolean(flight.cancelled),
    gate: (kind === "arrival" ? flight.gate_destination : flight.gate_origin)?.trim() || null,
    baggage: kind === "arrival" ? flight.baggage_claim?.trim() || null : null,
    aircraft: flight.aircraft_type?.trim() || null,
    registration: flight.registration?.trim() || null,
    delayMinutes: (() => {
      const seconds = kind === "arrival" ? flight.arrival_delay : flight.departure_delay;
      return typeof seconds === "number" ? Math.round(seconds / 60) : null;
    })(),
    leftGateAt: flight.actual_out ?? null,
    tookOffAt: flight.actual_off ?? null,
    landedAt: kind === "arrival" ? flight.actual_on ?? null : null,
    atGateAt: kind === "arrival" ? flight.actual_in ?? null : null,
    progress: typeof flight.progress_percent === "number" ? flight.progress_percent : null,
  };
}

/**
 * Newer lists win. A flight we saw before that is gone from the "scheduled"
 * lists has landed/left, so it keeps its last estimate and is marked done.
 */
export function mergeLiveFlights(
  previous: LiveFlight[],
  fresh: LiveFlight[],
  now: number,
) {
  const freshIds = new Set(fresh.map((flight) => flight.id));
  const kept = previous
    .filter((flight) => !freshIds.has(flight.id))
    .filter((flight) => {
      const time = Date.parse(flight.estimated ?? flight.scheduled ?? "");
      return Number.isFinite(time) && now - time < 30 * 3_600_000;
    })
    .map((flight) => {
      if (flight.done || flight.cancelled) return flight;
      const time = Date.parse(flight.estimated ?? flight.scheduled ?? "");
      // Dropped off early (e.g. list window moved) — don't call it done yet.
      if (time - now > 20 * 60_000) return flight;
      return {
        ...flight,
        done: true,
        status: flight.kind === "arrival" ? "Arrived" : "Departed",
      };
    });
  return [...fresh, ...kept];
}
