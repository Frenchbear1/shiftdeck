/**
 * Live arrival/departure times for the home airport, from FlightAware AeroAPI.
 *
 * GET /api/flights/live?airport=ABE
 *
 * Needs the AEROAPI_KEY secret (`npx wrangler secret put AEROAPI_KEY`).
 * Without it the endpoint answers { enabled: false } and the app keeps
 * showing schedule times.
 *
 * Cost control (AeroAPI Personal tier gives $5 of free queries a month):
 * - one shared cache in D1, so every phone reads the same copy;
 * - each refresh is 2 queries (scheduled arrivals + scheduled departures,
 *   Allegiant only) at $0.005 each;
 * - refreshes every 5 min while a flight is close, otherwise every 20 min;
 * - stops calling AeroAPI once the month's spend reaches the budget
 *   (AEROAPI_MONTHLY_BUDGET_CENTS, default 450) and serves the last copy.
 */
import { CalendarDatabase, corsHeaders, json } from "./calendar-service";
import {
  AeroFlight,
  LiveFlight,
  mergeLiveFlights,
  toLiveFlight,
} from "./live-flight-data";

export type FlightStatusEnvironment = {
  AEROAPI_KEY?: string;
  AEROAPI_MONTHLY_BUDGET_CENTS?: string;
};

type CachePayload = { fetchedAt: number; flights: LiveFlight[] };

const AEROAPI = "https://aeroapi.flightaware.com/aeroapi";
const AIRLINE = "AAY";
const QUERY_COST_MILLICENTS = 500; // $0.005 per result set
const NEAR_TTL = 5 * 60_000;
const FAR_TTL = 20 * 60_000;

let schemaReady = false;

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS flight_status_cache (airport TEXT PRIMARY KEY, payload TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS aeroapi_usage (month TEXT PRIMARY KEY, millicents INTEGER NOT NULL DEFAULT 0)",
    ),
  ]);
  schemaReady = true;
}

function ttlFor(payload: CachePayload, now: number) {
  const near = payload.flights.some((flight) => {
    if (flight.done || flight.cancelled) return false;
    const time = Date.parse(flight.estimated ?? flight.scheduled ?? "");
    return time - now < 90 * 60_000 && time - now > -60 * 60_000;
  });
  return near ? NEAR_TTL : FAR_TTL;
}

async function aeroGet(path: string, key: string) {
  const response = await fetch(`${AEROAPI}${path}`, {
    headers: { "x-apikey": key, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`AeroAPI ${response.status}`);
  return (await response.json()) as Record<string, unknown> & {
    num_pages?: number;
  };
}

export async function handleFlightStatusRequest(
  request: Request,
  db: CalendarDatabase | undefined,
  env: FlightStatusEnvironment,
) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/flights/live") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request) as Record<string, string>,
    });
  }
  if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);
  if (!env.AEROAPI_KEY || !db) return json(request, { enabled: false, flights: [] });

  const raw = (url.searchParams.get("airport") ?? "ABE").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(raw)) {
    return json(request, { error: "Use an airport code" }, 400);
  }
  const airport = /^[A-Z]{3}$/.test(raw) ? `K${raw}` : raw;

  await ensureSchema(db);
  const now = Date.now();
  const row = await db
    .prepare("SELECT payload FROM flight_status_cache WHERE airport = ?")
    .bind(airport)
    .first<{ payload: string }>();
  let cached: CachePayload | null = null;
  try {
    cached = row ? (JSON.parse(row.payload) as CachePayload) : null;
  } catch {
    cached = null;
  }
  const reply = (payload: CachePayload, stale = false) =>
    json(request, {
      enabled: true,
      stale,
      updatedAt: new Date(payload.fetchedAt).toISOString(),
      flights: payload.flights,
    });

  if (cached && now - cached.fetchedAt < ttlFor(cached, now)) return reply(cached);

  const month = new Date(now).toISOString().slice(0, 7);
  const budget =
    Number(env.AEROAPI_MONTHLY_BUDGET_CENTS ?? "450") * 1000 || 450_000;
  const usage = await db
    .prepare("SELECT millicents FROM aeroapi_usage WHERE month = ?")
    .bind(month)
    .first<{ millicents: number }>();
  if ((usage?.millicents ?? 0) + 2 * QUERY_COST_MILLICENTS > budget) {
    return cached
      ? reply(cached, true)
      : json(request, { enabled: true, stale: true, flights: [] });
  }

  const window = new URLSearchParams({
    airline: AIRLINE,
    start: new Date(now - 3 * 3_600_000).toISOString().slice(0, 19) + "Z",
    end: new Date(now + 21 * 3_600_000).toISOString().slice(0, 19) + "Z",
    max_pages: "1",
  });
  try {
    const [arrivals, departures] = await Promise.all([
      aeroGet(`/airports/${airport}/flights/scheduled_arrivals?${window}`, env.AEROAPI_KEY),
      aeroGet(`/airports/${airport}/flights/scheduled_departures?${window}`, env.AEROAPI_KEY),
    ]);
    const pages = (arrivals.num_pages ?? 1) + (departures.num_pages ?? 1);
    const fresh = [
      ...((arrivals.scheduled_arrivals as AeroFlight[] | undefined) ?? []).map(
        (flight) => toLiveFlight(flight, "arrival"),
      ),
      ...((departures.scheduled_departures as AeroFlight[] | undefined) ?? []).map(
        (flight) => toLiveFlight(flight, "departure"),
      ),
    ];
    const payload: CachePayload = {
      fetchedAt: now,
      flights: mergeLiveFlights(cached?.flights ?? [], fresh, now),
    };
    await db.batch([
      db
        .prepare(
          "INSERT INTO flight_status_cache (airport, payload) VALUES (?, ?) ON CONFLICT(airport) DO UPDATE SET payload = excluded.payload",
        )
        .bind(airport, JSON.stringify(payload)),
      db
        .prepare(
          "INSERT INTO aeroapi_usage (month, millicents) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET millicents = millicents + excluded.millicents",
        )
        .bind(month, pages * QUERY_COST_MILLICENTS),
    ]);
    return reply(payload);
  } catch {
    return cached
      ? reply(cached, true)
      : json(request, { enabled: true, stale: true, flights: [] });
  }
}
