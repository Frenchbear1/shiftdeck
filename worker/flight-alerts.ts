/**
 * Flight alerts: pushes about Allegiant flights at ABE, per notification
 * profile. Runs every minute from the cron, on data that's already free:
 * the ABE flight board (every 5 minutes), FlightAware's last refresh,
 * Shiftdeck's own ADS-B tracking (landing estimates within ~250 nm), and an
 * adsb.lol callsign lookup to catch the moment an arrival takes off.
 *
 * Each alert goes once per flight (a delay again each time it grows 15 more
 * minutes; a gate again each time it changes).
 */
import type { CalendarDatabase } from "./calendar-service";
import type { LiveFlight } from "./live-flight-data";
import { mergeAbeBoard, readAbeBoard } from "./abe-flight-board";
import { attachLiveEtas } from "./flight-learning";
import { sendProfilePush, type PushEnvironment } from "./push-service";
import {
  flightKey,
  flightNews,
  instant,
  isLanded,
  landingAt,
  normalizeFlightAlerts,
  normalizeWatch,
  type WatchedFlight,
} from "./flight-alerts-data";

export { DEFAULT_FLIGHT_ALERTS, type FlightAlertPrefs } from "./flight-alerts-data";

const MINUTE = 60_000;
const AIRPORT = "KABE";
const LOOKUP_EVERY = 3 * MINUTE;
const LOOKUP_BEFORE = 5 * 60 * MINUTE; // start looking for the takeoff 5 h before landing

let schemaReady = false;
async function ensureSchema(db: CalendarDatabase) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS flight_alert_profiles (
      profile_id TEXT PRIMARY KEY, prefs TEXT NOT NULL, watch TEXT NOT NULL, timezone TEXT, updated_at INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS flight_alert_sent (
      profile_id TEXT NOT NULL, flight_key TEXT NOT NULL, kind TEXT NOT NULL, sent_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, flight_key, kind))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS flight_airborne (
      flight_key TEXT PRIMARY KEY, seen_ts INTEGER, checked_ts INTEGER NOT NULL)`),
  ]);
  schemaReady = true;
}

/** Called when a profile syncs (Save changes in the alerts settings). */
export async function saveFlightAlerts(db: CalendarDatabase, profileId: string, prefs: unknown, watch: unknown, timezone: string) {
  if (prefs === undefined && watch === undefined) return;
  await ensureSchema(db);
  await db.prepare(`INSERT INTO flight_alert_profiles (profile_id, prefs, watch, timezone, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(profile_id) DO UPDATE SET prefs = excluded.prefs, watch = excluded.watch, timezone = excluded.timezone, updated_at = excluded.updated_at`)
    .bind(profileId, JSON.stringify(normalizeFlightAlerts(prefs)), JSON.stringify(normalizeWatch(watch)), timezone, Date.now())
    .run();
}

/* ---------- every minute ---------- */

async function currentFlights(db: CalendarDatabase, now: number) {
  let cached: { fetchedAt: number; flights: LiveFlight[] } | null = null;
  try {
    const row = await db.prepare("SELECT payload FROM flight_status_cache WHERE airport = ?").bind(AIRPORT).first<{ payload: string }>();
    cached = row ? JSON.parse(row.payload) : null;
  } catch {
    cached = null; // Live times not set up.
  }
  const board = await readAbeBoard(db).catch(() => null);
  const merged = mergeAbeBoard(cached?.flights ?? [], board, cached?.fetchedAt ?? 0);
  return attachLiveEtas(db, merged, now);
}

/** Has this arrival taken off yet? (adsb.lol, by callsign; free, checked every few minutes). */
async function checkAirborne(db: CalendarDatabase, flights: LiveFlight[], now: number) {
  const due = flights.filter((flight) => {
    const landing = landingAt(flight);
    return flight.kind === "arrival" && !flight.cancelled && !isLanded(flight) && !flight.tookOffAt && !flight.liveEta &&
      landing !== null && landing - now <= LOOKUP_BEFORE && landing - now > -30 * MINUTE;
  });
  if (!due.length) return new Map<string, number>();
  const keys = due.map((flight) => flightKey(flight));
  const rows = await db.prepare(`SELECT flight_key, seen_ts, checked_ts FROM flight_airborne WHERE flight_key IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys).all<{ flight_key: string; seen_ts: number | null; checked_ts: number }>();
  const known = new Map((rows.results ?? []).map((row) => [row.flight_key, row]));
  const seen = new Map<string, number>();
  for (const flight of due) {
    const key = flightKey(flight);
    const row = known.get(key);
    if (row?.seen_ts) {
      seen.set(key, row.seen_ts);
      continue;
    }
    if (row && now - row.checked_ts < LOOKUP_EVERY) continue;
    let airborne = false;
    try {
      const callsign = `AAY${flight.ident.replace(/^(G4|AAY)/, "")}`;
      const response = await fetch(`https://api.adsb.lol/v2/callsign/${callsign}`, { headers: { Accept: "application/json" } });
      if (response.ok) {
        const data = await response.json() as { ac?: Array<{ alt_baro?: number | string; gs?: number }> };
        airborne = (data.ac ?? []).some((plane) => typeof plane.alt_baro === "number" && plane.alt_baro > 500 && (plane.gs ?? 0) > 80);
      }
    } catch {
      airborne = false;
    }
    await db.prepare(`INSERT INTO flight_airborne (flight_key, seen_ts, checked_ts) VALUES (?1, ?2, ?3)
        ON CONFLICT(flight_key) DO UPDATE SET seen_ts = COALESCE(flight_airborne.seen_ts, excluded.seen_ts), checked_ts = excluded.checked_ts`)
      .bind(key, airborne ? now : null, now).run();
    if (airborne) seen.set(key, now);
  }
  return seen;
}

const watches = (flight: LiveFlight, watch: WatchedFlight[]) => {
  const ident = flight.ident.replace(/^AAY/, "G4");
  const scheduled = instant(flight.scheduled);
  return scheduled !== null && watch.some((item) =>
    item.ident === ident && item.kind === flight.kind && Math.abs(Date.parse(item.at) - scheduled) <= 3 * 60 * MINUTE);
};

export async function sendFlightAlerts(db: CalendarDatabase, env: PushEnvironment, now = Date.now()) {
  await ensureSchema(db);
  const profiles = (await db.prepare(`SELECT f.profile_id, f.prefs, f.watch, f.timezone FROM flight_alert_profiles f
      JOIN notification_profiles p ON p.id = f.profile_id AND p.revoked_at IS NULL
      WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.profile_id = f.profile_id)`)
    .all<{ profile_id: string; prefs: string; watch: string; timezone: string | null }>()).results ?? [];
  const active = profiles
    .map((row) => ({ ...row, settings: normalizeFlightAlerts(JSON.parse(row.prefs)), list: normalizeWatch(JSON.parse(row.watch)) }))
    .filter((row) => row.settings.which !== "off" && (row.settings.which === "all" || row.list.length));
  if (!active.length) return;

  // Only flights near now: from 3 hours ago to 12 hours ahead.
  const flights = (await currentFlights(db, now)).filter((flight) => {
    const time = landingAt(flight) ?? instant(flight.scheduled);
    return /^(G4|AAY)\d+$/.test(flight.ident) && time !== null && time > now - 3 * 60 * MINUTE && time < now + 12 * 60 * MINUTE;
  });
  if (!flights.length) return;
  const wanted = flights.filter((flight) => active.some((row) => row.settings.which === "all" || watches(flight, row.list)));
  const airborne = await checkAirborne(db, wanted, now);

  for (const row of active) {
    const timezone = row.timezone || "America/New_York";
    const clock = (time: number) => new Date(time).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
    const mine = wanted.filter((flight) => row.settings.which === "all" || watches(flight, row.list));
    if (!mine.length) continue;
    const keys = mine.map((flight) => flightKey(flight));
    const sentRows = (await db.prepare(`SELECT flight_key, kind FROM flight_alert_sent WHERE profile_id = ?1 AND flight_key IN (${keys.map((_, index) => `?${index + 2}`).join(",")})`)
      .bind(row.profile_id, ...keys).all<{ flight_key: string; kind: string }>()).results ?? [];
    for (const flight of mine) {
      const key = flightKey(flight);
      const sent = new Set(sentRows.filter((item) => item.flight_key === key).map((item) => item.kind));
      const news = flightNews(flight, row.settings, sent, now, airborne.get(key) ?? null, clock);
      for (const item of news) {
        // Record first, so a slow push never sends twice.
        const fresh = await db.prepare("INSERT OR IGNORE INTO flight_alert_sent (profile_id, flight_key, kind, sent_at) VALUES (?1, ?2, ?3, ?4)")
          .bind(row.profile_id, key, item.kind, now).run();
        if (item.silent || !(fresh.meta?.changes ?? 1)) continue;
        await sendProfilePush(db, env, row.profile_id, {
          title: item.title,
          body: item.body,
          tag: `flight-${key}-${item.kind.split(":")[0]}`,
          path: `?open=flight:${encodeURIComponent(flight.id)}`,
        }).catch(() => 0);
      }
    }
  }
  // Old records go after two days.
  await db.prepare("DELETE FROM flight_alert_sent WHERE sent_at < ?1").bind(now - 2 * 24 * 60 * MINUTE).run();
  await db.prepare("DELETE FROM flight_airborne WHERE checked_ts < ?1").bind(now - 2 * 24 * 60 * MINUTE).run();
}
