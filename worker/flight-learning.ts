/**
 * Shiftdeck flight learning: logs free data about Allegiant arrivals at ABE
 * and learns how long flights really take to land and reach the gate.
 *
 * Runs every minute from the worker's cron, but only does real work while an
 * arrival is due (2 hours either side). Each run, at most:
 *   - one shared ADS-B snapshot (the same one the Live map uses, adsb.lol)
 *   - one ABE weather report every 10 minutes (aviationweather.gov, NOAA)
 * FlightAware estimates are copied from the shared refresh cache (no extra cost).
 *
 * Storage stays small: raw minute-by-minute positions are kept 3 days, then
 * only a one-row summary per flight remains. Summaries older than 90 days that
 * are odd balls (far outside the usual times) are deleted; everything is
 * dropped after a year.
 *
 * GET /api/flights/learning → results for Settings.
 */
import { CalendarDatabase, corsHeaders, json } from "./calendar-service";
import {
  ABE,
  checkpointTimes,
  distanceNm,
  estimateArrival,
  FinishedFlight,
  HistoryFlight,
  landedObservation,
  Observation,
  runwayFromWind,
  runwayUsed,
  summarize,
  withoutOutliers,
} from "./learning-data";
import type { LiveFlight } from "./live-flight-data";
import { getSnapshot } from "./planes";

const DAY = 86_400_000;
const AIRPORT = "KABE";
const WINDOW_BEFORE = 2 * 3_600_000; // start tracking 2 h before the expected landing
const WINDOW_AFTER = 2 * 3_600_000; // give up 2 h after it
const METAR_EVERY = 10 * 60_000;
const FINALIZE_AFTER_LANDING = 15 * 60_000;
const RAW_KEEP = 3 * DAY;
const ODDBALL_AGE = 90 * DAY;
const MAX_AGE = 365 * DAY;
const LIVE_FRESH = 3 * 60_000;

let schemaReady = false;

/** D1 rows, never undefined. */
async function allRows<T>(statement: ReturnType<CalendarDatabase["prepare"]>) {
  return (await statement.all<T>()).results ?? [];
}

async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS learn_flights (
      id TEXT PRIMARY KEY, ident TEXT, origin TEXT, registration TEXT,
      sched_on INTEGER, created INTEGER,
      first_seen_ts INTEGER, first_seen_nm REAL,
      landed_ts INTEGER, landed_src TEXT, gate_ts INTEGER,
      runway TEXT, wind_runway TEXT, wind_from INTEGER, wind_kt INTEGER,
      checkpoints TEXT, taxi_s INTEGER,
      fa_err30 REAL, fa_err15 REAL, our_err30 REAL, our_err15 REAL,
      status TEXT NOT NULL DEFAULT 'open', finished INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS learn_obs (
      id TEXT NOT NULL, ts INTEGER NOT NULL, lat REAL, lon REAL, dist REAL,
      alt INTEGER, gs INTEGER, track REAL, ground INTEGER,
      our_landing INTEGER, our_gate INTEGER, method TEXT,
      PRIMARY KEY (id, ts))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS learn_fa (
      id TEXT NOT NULL, fetched INTEGER NOT NULL, est_on INTEGER,
      PRIMARY KEY (id, fetched))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS learn_meta (k TEXT PRIMARY KEY, v TEXT)`),
  ]);
  schemaReady = true;
}

type FlightRow = {
  id: string;
  ident: string | null;
  origin: string | null;
  registration: string | null;
  sched_on: number | null;
  created: number;
  first_seen_ts: number | null;
  first_seen_nm: number | null;
  landed_ts: number | null;
  landed_src: string | null;
  gate_ts: number | null;
  wind_runway: string | null;
  wind_from: number | null;
  wind_kt: number | null;
  status: string;
};

const callsignFor = (ident: string | null) => {
  const match = (ident ?? "").match(/^G4(\d+)$/);
  return match ? `AAY${match[1]}` : ident ?? "";
};

async function readCache(db: CalendarDatabase) {
  try {
    const row = await db
      .prepare("SELECT payload FROM flight_status_cache WHERE airport = ?")
      .bind(AIRPORT)
      .first<{ payload: string }>();
    return row ? (JSON.parse(row.payload) as { fetchedAt: number; flights: LiveFlight[] }) : null;
  } catch {
    return null; // Live times not set up yet.
  }
}

async function meta(db: CalendarDatabase, key: string) {
  const row = await db.prepare("SELECT v FROM learn_meta WHERE k = ?").bind(key).first<{ v: string }>();
  return row?.v ?? null;
}

async function setMeta(db: CalendarDatabase, key: string, value: string) {
  await db
    .prepare("INSERT INTO learn_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .bind(key, value)
    .run();
}

/** ABE wind from the latest METAR (true degrees it blows from, knots). */
async function currentWind(db: CalendarDatabase, now: number) {
  const saved = await meta(db, "wind");
  let wind = saved ? (JSON.parse(saved) as { at: number; from: number | null; kt: number | null }) : null;
  if (!wind || now - wind.at > METAR_EVERY) {
    try {
      const response = await fetch(
        `https://aviationweather.gov/api/data/metar?ids=${AIRPORT}&format=json`,
        { headers: { "User-Agent": "Shiftdeck (personal ramp app)" }, signal: AbortSignal.timeout(6_000) },
      );
      const [report] = (await response.json()) as { wdir?: number | string; wspd?: number }[];
      wind = {
        at: now,
        from: typeof report?.wdir === "number" ? report.wdir : null, // "VRB" → unknown
        kt: typeof report?.wspd === "number" ? report.wspd : null,
      };
      await setMeta(db, "wind", JSON.stringify(wind));
    } catch {
      // Keep the last wind we had.
    }
  }
  return wind;
}

async function loadHistory(db: CalendarDatabase): Promise<HistoryFlight[]> {
  const results = await allRows<{ runway: string | null; origin: string | null; checkpoints: string; taxi_s: number | null }>(db
    .prepare(
      "SELECT runway, origin, checkpoints, taxi_s FROM learn_flights WHERE status = 'done' AND checkpoints IS NOT NULL ORDER BY finished DESC LIMIT 400",
    ));
  return results.map((row) => ({
    runway: row.runway,
    origin: row.origin,
    checkpoints: JSON.parse(row.checkpoints) as Record<string, number>,
    taxiS: row.taxi_s,
  }));
}

const errorAt = (actual: number, estimate: number | null | undefined) =>
  typeof estimate === "number" ? Math.round((Math.abs(estimate - actual) / 60_000) * 10) / 10 : null;

async function finalize(db: CalendarDatabase, flight: FlightRow, now: number) {
  const results = await allRows<{ ts: number; lat: number; lon: number; dist: number; alt: number | null; gs: number | null; track: number | null; ground: number; our_landing: number | null }>(db
    .prepare("SELECT ts, lat, lon, dist, alt, gs, track, ground, our_landing FROM learn_obs WHERE id = ? ORDER BY ts")
    .bind(flight.id));
  const observations: Observation[] = results.map((row) => ({ ...row, ground: row.ground === 1 }));
  const landed = flight.landed_ts;

  let checkpoints: Record<string, number> | null = null;
  let runway: string | null = null;
  let taxi: number | null = null;
  let faErr30: number | null = null;
  let faErr15: number | null = null;
  let ourErr30: number | null = null;
  let ourErr15: number | null = null;

  if (landed) {
    if (observations.length >= 3) {
      const times = checkpointTimes(observations, landed);
      checkpoints = Object.keys(times).length ? times : null;
      runway = runwayUsed(observations, landed);
    }
    if (flight.gate_ts && flight.gate_ts > landed && flight.gate_ts - landed < 40 * 60_000) {
      taxi = Math.round((flight.gate_ts - landed) / 1000);
    }
    for (const minutes of [30, 15]) {
      const at = landed - minutes * 60_000;
      const fa = await db
        .prepare("SELECT est_on FROM learn_fa WHERE id = ? AND fetched <= ? ORDER BY fetched DESC LIMIT 1")
        .bind(flight.id, at)
        .first<{ est_on: number | null }>();
      const ours = results
        .filter((row) => row.our_landing && Math.abs(row.ts - at) <= 150_000)
        .sort((a, b) => Math.abs(a.ts - at) - Math.abs(b.ts - at))[0];
      if (minutes === 30) {
        faErr30 = errorAt(landed, fa?.est_on);
        ourErr30 = errorAt(landed, ours?.our_landing);
      } else {
        faErr15 = errorAt(landed, fa?.est_on);
        ourErr15 = errorAt(landed, ours?.our_landing);
      }
    }
  }

  await db
    .prepare(
      `UPDATE learn_flights SET status = 'done', finished = ?, checkpoints = ?, runway = ?, taxi_s = ?,
       fa_err30 = ?, fa_err15 = ?, our_err30 = ?, our_err15 = ? WHERE id = ?`,
    )
    .bind(
      now,
      checkpoints ? JSON.stringify(checkpoints) : null,
      runway ?? flight.wind_runway,
      taxi,
      faErr30,
      faErr15,
      ourErr30,
      ourErr15,
      flight.id,
    )
    .run();
}

/** Keep storage small (see the file header). Runs about once an hour. */
async function prune(db: CalendarDatabase, now: number) {
  await db.batch([
    db.prepare("DELETE FROM learn_obs WHERE ts < ?").bind(now - RAW_KEEP),
    db.prepare("DELETE FROM learn_fa WHERE fetched < ?").bind(now - RAW_KEEP),
    db.prepare("DELETE FROM learn_flights WHERE created < ?").bind(now - MAX_AGE),
    // Flights never seen and never landed teach nothing after a few months.
    db
      .prepare("DELETE FROM learn_flights WHERE status = 'done' AND landed_ts IS NULL AND created < ?")
      .bind(now - ODDBALL_AGE),
  ]);
  // Odd balls: old flights whose time from 20 nm (or taxi) is far from the usual.
  const results = await allRows<{ id: string; checkpoints: string; taxi_s: number | null }>(db
    .prepare("SELECT id, checkpoints, taxi_s FROM learn_flights WHERE status = 'done' AND checkpoints IS NOT NULL"));
  const at20 = results
    .map((row) => (JSON.parse(row.checkpoints) as Record<string, number>)["20"])
    .filter((value): value is number => typeof value === "number");
  const taxis = results.map((row) => row.taxi_s).filter((value): value is number => typeof value === "number");
  const keep20 = new Set(withoutOutliers(at20));
  const keepTaxi = new Set(withoutOutliers(taxis));
  if (at20.length < 8) return;
  const oddballs = results.filter((row) => {
    const value = (JSON.parse(row.checkpoints) as Record<string, number>)["20"];
    return (typeof value === "number" && !keep20.has(value)) || (row.taxi_s !== null && taxis.length >= 8 && !keepTaxi.has(row.taxi_s));
  });
  // D1 allows up to 100 bound values per statement, so delete in chunks.
  for (let index = 0; index < oddballs.length; index += 90) {
    const ids = oddballs.slice(index, index + 90).map((row) => row.id);
    await db
      .prepare(`DELETE FROM learn_flights WHERE created < ? AND id IN (${ids.map(() => "?").join(",")})`)
      .bind(now - ODDBALL_AGE, ...ids)
      .run();
  }
}

/** Called every minute by the worker's cron. */
export async function collectFlightLearning(db: CalendarDatabase | undefined, now = Date.now()) {
  if (!db) return;
  try {
    await ensureSchema(db);
    const cache = await readCache(db);

    // 1. Register upcoming arrivals and copy FlightAware's latest estimates.
    const writes = [];
    for (const flight of cache?.flights ?? []) {
      if (flight.kind !== "arrival" || flight.cancelled) continue;
      const expected = Date.parse(flight.estimatedOn ?? flight.estimated ?? flight.scheduled ?? "");
      if (!Number.isFinite(expected) || expected < now - WINDOW_AFTER || expected > now + 6 * 3_600_000) continue;
      writes.push(
        db
          .prepare(
            "INSERT INTO learn_flights (id, ident, origin, registration, sched_on, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET registration = COALESCE(excluded.registration, registration)",
          )
          .bind(flight.id, flight.ident, flight.other[0] ?? null, flight.registration ?? null, Date.parse(flight.scheduled ?? "") || null, now),
      );
      const estOn = Date.parse(flight.estimatedOn ?? flight.estimated ?? "");
      if (cache && Number.isFinite(estOn)) {
        writes.push(
          db.prepare("INSERT OR IGNORE INTO learn_fa (id, fetched, est_on) VALUES (?, ?, ?)").bind(flight.id, cache.fetchedAt, estOn),
        );
      }
      // FlightAware's own landed/at-gate times, when a refresh caught them.
      const landedAt = Date.parse(flight.landedAt ?? "");
      const atGateAt = Date.parse(flight.atGateAt ?? "");
      if (Number.isFinite(landedAt)) {
        writes.push(
          db
            .prepare("UPDATE learn_flights SET landed_ts = COALESCE(landed_ts, ?), landed_src = COALESCE(landed_src, 'flightaware') WHERE id = ?")
            .bind(landedAt, flight.id),
        );
      }
      if (Number.isFinite(atGateAt)) {
        writes.push(db.prepare("UPDATE learn_flights SET gate_ts = ? WHERE id = ?").bind(atGateAt, flight.id));
      }
    }
    if (writes.length) await db.batch(writes);

    const open = await allRows<FlightRow>(db
      .prepare("SELECT * FROM learn_flights WHERE status = 'open'"));

    // 2. Track the ones due now.
    const expectedFor = (row: FlightRow) => {
      const live = cache?.flights.find((flight) => flight.id === row.id);
      return Date.parse(live?.estimatedOn ?? live?.estimated ?? "") || row.sched_on || row.created;
    };
    const due = open.filter((row) => {
      const expected = expectedFor(row);
      return !row.landed_ts && now >= expected - WINDOW_BEFORE && now <= expected + WINDOW_AFTER;
    });
    if (due.length) {
      const [{ snapshot }, wind, history] = await Promise.all([
        getSnapshot(now),
        currentWind(db, now),
        loadHistory(db),
      ]);
      const windRunway = runwayFromWind(wind?.from ?? null, wind?.kt ?? null);
      const obsWrites = [];
      for (const row of due) {
        const callsign = callsignFor(row.ident);
        const plane = snapshot?.planes.find(
          (candidate) =>
            (candidate.callsign && candidate.callsign === callsign) ||
            (row.registration && candidate.registration === row.registration),
        );
        if (!plane) continue;
        const dist = Math.round(distanceNm(ABE.lat, ABE.lon, plane.lat, plane.lon) * 10) / 10;
        const estimate = estimateArrival(history, now, dist, plane.speed, windRunway);
        const observation: Observation = {
          ts: now,
          lat: plane.lat,
          lon: plane.lon,
          dist,
          alt: plane.altitude,
          gs: plane.speed,
          track: plane.track,
          ground: plane.ground,
        };
        const landed = landedObservation([observation]);
        obsWrites.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO learn_obs (id, ts, lat, lon, dist, alt, gs, track, ground, our_landing, our_gate, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
              row.id,
              now,
              plane.lat,
              plane.lon,
              dist,
              plane.altitude,
              plane.speed,
              plane.track,
              plane.ground ? 1 : 0,
              landed ? null : estimate.landingTs,
              landed ? null : estimate.gateTs,
              estimate.method,
            ),
          db
            .prepare(
              "UPDATE learn_flights SET first_seen_ts = COALESCE(first_seen_ts, ?), first_seen_nm = COALESCE(first_seen_nm, ?), wind_runway = ?, wind_from = ?, wind_kt = ? WHERE id = ?",
            )
            .bind(now, dist, windRunway, wind?.from ?? null, wind?.kt ?? null, row.id),
        );
        if (landed) {
          obsWrites.push(
            db
              .prepare("UPDATE learn_flights SET landed_ts = COALESCE(landed_ts, ?), landed_src = COALESCE(landed_src, 'adsb') WHERE id = ?")
              .bind(now, row.id),
          );
        }
      }
      if (obsWrites.length) await db.batch(obsWrites);
    }

    // 3. Wrap up flights that landed a while ago, or never showed up.
    const refreshed = await allRows<FlightRow>(db
      .prepare("SELECT * FROM learn_flights WHERE status = 'open'"));
    for (const row of refreshed) {
      const landedLongAgo = row.landed_ts && now - row.landed_ts > FINALIZE_AFTER_LANDING;
      const gaveUp = !row.landed_ts && now > expectedFor(row) + WINDOW_AFTER;
      if (landedLongAgo || gaveUp) await finalize(db, row, now);
    }

    // 4. Tidy up about once an hour.
    const lastPrune = Number((await meta(db, "pruned")) ?? 0);
    if (now - lastPrune > 3_600_000) {
      await prune(db, now);
      await setMeta(db, "pruned", String(now));
    }
  } catch (error) {
    console.error("Flight learning failed:", error instanceof Error ? error.message : error);
  }
}

/** Adds Shiftdeck's own live estimate to arrivals being tracked right now. */
export async function attachLiveEtas(db: CalendarDatabase, flights: LiveFlight[], now = Date.now()) {
  try {
    await ensureSchema(db);
    const results = await allRows<{ id: string; ts: number; dist: number; our_landing: number | null; our_gate: number | null; method: string }>(db
      .prepare(
        `SELECT o.id, o.ts, o.dist, o.our_landing, o.our_gate, o.method FROM learn_obs o
         JOIN (SELECT id, MAX(ts) AS ts FROM learn_obs WHERE ts >= ? GROUP BY id) latest
         ON latest.id = o.id AND latest.ts = o.ts`,
      )
      .bind(now - LIVE_FRESH));
    const byId = new Map(results.map((row) => [row.id, row]));
    return flights.map((flight) => {
      const row = byId.get(flight.id);
      if (!row || !row.our_landing || !row.our_gate || flight.done) return flight;
      return {
        ...flight,
        liveEta: {
          landing: new Date(row.our_landing).toISOString(),
          gate: new Date(row.our_gate).toISOString(),
          distanceNm: row.dist,
          seenAt: new Date(row.ts).toISOString(),
          method: row.method,
        },
      };
    });
  } catch {
    return flights;
  }
}

/** GET /api/flights/learning */
export async function handleLearningRequest(request: Request, db: CalendarDatabase | undefined) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/flights/learning") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) as Record<string, string> });
  }
  if (!db) return json(request, { enabled: false });
  await ensureSchema(db);
  const results = await allRows<{ first_seen_nm: number | null; runway: string | null; taxi_s: number | null; fa_err30: number | null; fa_err15: number | null; our_err30: number | null; our_err15: number | null; landed_ts: number | null; created: number }>(db
    .prepare(
      "SELECT first_seen_nm, runway, taxi_s, fa_err30, fa_err15, our_err30, our_err15, landed_ts, created FROM learn_flights WHERE status = 'done'",
    ));
  const finished: FinishedFlight[] = results.map((row) => ({
    seen: row.first_seen_nm !== null,
    firstSeenNm: row.first_seen_nm,
    runway: row.runway,
    taxiS: row.taxi_s,
    faErr30: row.fa_err30,
    faErr15: row.fa_err15,
    ourErr30: row.our_err30,
    ourErr15: row.our_err15,
  }));
  const counts = await db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM learn_flights) AS flights, (SELECT COUNT(*) FROM learn_obs) AS obs, (SELECT COUNT(*) FROM learn_flights WHERE status = 'open') AS tracking, (SELECT MIN(created) FROM learn_flights) AS since",
    )
    .first<{ flights: number; obs: number; tracking: number; since: number | null }>();
  return json(
    request,
    {
      enabled: true,
      since: counts?.since ? new Date(counts.since).toISOString() : null,
      tracking: counts?.tracking ?? 0,
      // Rough size: ~0.5 KB per flight summary, ~0.1 KB per raw position.
      storageKb: Math.round(((counts?.flights ?? 0) * 0.5 + (counts?.obs ?? 0) * 0.1) * 10) / 10,
      ...summarize(finished),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
