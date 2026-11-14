/**
 * Live arrival/departure times from the ABE board and optional FlightAware AeroAPI,
 * shared by everyone who uses Shiftdeck (no accounts).
 *
 * GET  /api/flights/live?airport=ABE           → last saved times + usage status
 *                                                 (never calls AeroAPI, free)
 * POST /api/flights/live/refresh?airport=ABE   → asks AeroAPI once and saves it
 *      body { "emergency": true } to use an emergency refresh
 *
 * Limits are shared by every phone:
 * - 10 refreshes a day, then 3 emergency refreshes (day = Allentown time)
 * - 10 minutes between refreshes
 * - stops for the month once spend reaches AEROAPI_MONTHLY_BUDGET_CENTS
 *   (default 450, under AeroAPI Personal's $5 free allowance)
 *
 * Only the optional manual FlightAware refresh needs AEROAPI_KEY.
 */
import { CalendarDatabase, corsHeaders, json } from "./calendar-service";
import { attachLiveEtas } from "./flight-learning";
import { ABE_BOARD_AIRPORT, mergeAbeBoard, readAbeAlerts, readAbeBoard } from "./abe-flight-board";
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
const DAILY_LIMIT = 10;
const EMERGENCY_LIMIT = 3;
const COOLDOWN_MS = 10 * 60_000;
const FREE_CENTS = 500;
const TIME_ZONE = "America/New_York";

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
    db.prepare(
      "CREATE TABLE IF NOT EXISTS flight_refresh_days (day TEXT PRIMARY KEY, normal INTEGER NOT NULL DEFAULT 0, emergency INTEGER NOT NULL DEFAULT 0)",
    ),
  ]);
  schemaReady = true;
}

/** "2026-11-13" and "2026-11" in Allentown time. */
function localKeys(now: number) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return { day, month: day.slice(0, 7) };
}

async function readState(
  db: CalendarDatabase,
  airport: string,
  now: number,
  env: FlightStatusEnvironment,
) {
  const { day, month } = localKeys(now);
  const [row, usage, counts] = await Promise.all([
    db
      .prepare("SELECT payload FROM flight_status_cache WHERE airport = ?")
      .bind(airport)
      .first<{ payload: string }>(),
    db
      .prepare("SELECT millicents FROM aeroapi_usage WHERE month = ?")
      .bind(month)
      .first<{ millicents: number }>(),
    db
      .prepare("SELECT normal, emergency FROM flight_refresh_days WHERE day = ?")
      .bind(day)
      .first<{ normal: number; emergency: number }>(),
  ]);
  let cached: CachePayload | null = null;
  try {
    cached = row ? (JSON.parse(row.payload) as CachePayload) : null;
  } catch {
    cached = null;
  }
  const budgetCents = Number(env.AEROAPI_MONTHLY_BUDGET_CENTS ?? "450") || 450;
  const spentMillicents = usage?.millicents ?? 0;
  const used = counts?.normal ?? 0;
  const emergencyUsed = counts?.emergency ?? 0;
  const nextAt = cached ? cached.fetchedAt + COOLDOWN_MS : 0;
  const overBudget =
    spentMillicents + 2 * QUERY_COST_MILLICENTS > budgetCents * 1000;
  const status = {
    dailyLimit: DAILY_LIMIT,
    used,
    emergencyLimit: EMERGENCY_LIMIT,
    emergencyUsed,
    cooldownMinutes: COOLDOWN_MS / 60_000,
    nextAt: nextAt > now ? new Date(nextAt).toISOString() : null,
    monthSpentCents: Math.round(spentMillicents / 1000),
    monthFreeCents: FREE_CENTS,
    budgetCents,
    /** What tapping refresh would do right now. */
    available: overBudget
      ? "budget"
      : nextAt > now
        ? "cooldown"
        : used < DAILY_LIMIT
          ? "normal"
          : emergencyUsed < EMERGENCY_LIMIT
            ? "emergency"
            : "none",
  } as const;
  return { cached, status, day, month };
}

async function aeroGet(path: string, key: string) {
  const response = await fetch(`${AEROAPI}${path}`, {
    headers: { "x-apikey": key, Accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`AeroAPI ${response.status}: ${body}`);
  }
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
  const isRefresh = url.pathname === "/api/flights/live/refresh";
  if (url.pathname !== "/api/flights/live" && !isRefresh) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request) as Record<string, string>,
    });
  }
  if (!db) return json(request, { enabled: false, flights: [] });

  const raw = (url.searchParams.get("airport") ?? "ABE").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(raw)) {
    return json(request, { error: "Use an airport code" }, 400);
  }
  const airport = /^[A-Z]{3}$/.test(raw) ? `K${raw}` : raw;
  const isAbe = airport === ABE_BOARD_AIRPORT;
  if (!env.AEROAPI_KEY && !isAbe) return json(request, { enabled: false, flights: [] });
  if (request.method !== (isRefresh ? "POST" : "GET")) return json(request, { error: "Method not allowed" }, 405);

  const now = Date.now();
  const [board, alerts] = isAbe
    ? await Promise.all([readAbeBoard(db), readAbeAlerts(db)])
    : [null, null];
  const reply = async (
    payload: CachePayload | null,
    status: Awaited<ReturnType<typeof readState>>["status"] | null,
    extra: Record<string, unknown> = {},
    code = 200,
  ) => {
    const updatedAt = Math.max(payload?.fetchedAt ?? 0, board?.fetchedAt ?? 0);
    const flights = mergeAbeBoard(payload?.flights ?? [], board, payload?.fetchedAt ?? 0);
    return json(
      request,
      {
        enabled: true,
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
        flights: flights.length ? await attachLiveEtas(db, flights, now) : [],
        status,
        airportBoardUpdatedAt: board ? new Date(board.fetchedAt).toISOString() : null,
        airportAlerts: alerts ? { updatedAt: new Date(alerts.fetchedAt).toISOString(), notices: alerts.data } : null,
        ...extra,
      },
      code,
      { "Cache-Control": "no-store" },
    );
  };

  if (!env.AEROAPI_KEY) return reply(null, null);

  await ensureSchema(db);
  const state = await readState(db, airport, now, env);
  if (!isRefresh) return reply(state.cached, state.status);

  let emergency = false;
  try {
    emergency = Boolean(((await request.json()) as { emergency?: boolean }).emergency);
  } catch {
    emergency = false;
  }
  const { available } = state.status;
  if (available === "cooldown" || available === "none" || available === "budget") {
    return reply(state.cached, state.status, { refused: available }, 429);
  }
  if (available === "emergency" && !emergency) {
    return reply(state.cached, state.status, { refused: "needs-emergency" }, 409);
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
      flights: mergeLiveFlights(state.cached?.flights ?? [], fresh, now),
    };
    const column = available === "emergency" ? "emergency" : "normal";
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
        .bind(state.month, pages * QUERY_COST_MILLICENTS),
      db
        .prepare(
          `INSERT INTO flight_refresh_days (day, ${column}) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET ${column} = ${column} + 1`,
        )
        .bind(state.day),
    ]);
    const after = await readState(db, airport, now, env);
    return reply(payload, after.status);
  } catch (error) {
    // The reason never includes the API key (it is only sent as a header).
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Live flight refresh failed:", detail);
    return reply(state.cached, state.status, { refused: "error", detail }, 502);
  }
}
