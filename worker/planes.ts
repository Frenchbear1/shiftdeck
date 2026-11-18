/**
 * Live aircraft for the in-app map, from community ADS-B networks.
 *
 * GET /api/planes?lat=&lon=&r=  → { source, updatedAt, radius, planes: [...] }
 *   (defaults: ABE, 35 nm)
 *
 * The worker keeps ONE snapshot of everything within 250 nm of ABE (the
 * networks' limit), refreshed at most every 10 seconds no matter how many
 * phones are looking or panning, and hands each phone only the planes in its
 * view. That keeps us far under the networks' rate limits.
 *
 * - adsb.lol (free, open data under ODbL), ADSB One, adsb.fi and
 *   airplanes.live (personal, non-commercial use, credited in the app) are
 *   asked at once and their planes combined, so one network being down or
 *   missing a plane doesn't empty the map. Each allows about 1 request a
 *   second; we make at most one every 10 seconds.
 * - adsb.fi and airplanes.live refuse (403) requests from cloud servers like
 *   this one, so a 403 rests a network for 30 minutes before trying again.
 * - OpenSky is the last resort: only asked when every other network failed,
 *   at most once a minute, because anonymous use is limited to 400 credits a
 *   day (our area costs 2).
 * - None send CORS headers, so phones can't ask them directly.
 * - A network that says "slow down" (429) is skipped for a minute; one that
 *   errors or times out is skipped for 20 seconds.
 * - If every network fails, the last good snapshot is served (marked stale)
 *   for up to 3 minutes instead of an empty map.
 */
import { corsHeaders, json } from "./calendar-service";
import { fromOpenSky, mergeAircraft, Plane, planesInView, RawAircraft, toPlanes } from "./planes-data";

const ABE = { lat: 40.652363, lon: -75.440406 };
const SNAPSHOT_NM = 250;
const DEFAULT_RADIUS_NM = 35;
const SNAPSHOT_MS = 10_000;
const BACKOFF_MS = 60_000;
const ERROR_BACKOFF_MS = 20_000;
const BLOCKED_BACKOFF_MS = 30 * 60_000;
const LAST_RESORT_MS = 60_000;
const FETCH_TIMEOUT_MS = 6_000;
/** How long the last good snapshot may stand in when every network fails. */
const STALE_LIMIT_MS = 180_000;
const CACHE_URL = "https://shiftdeck-cache.internal/planes-snapshot";

const SOURCES = [
  {
    name: "adsb.lol",
    url: `https://api.adsb.lol/v2/point/${ABE.lat}/${ABE.lon}/${SNAPSHOT_NM}`,
  },
  {
    name: "adsb.fi",
    url: `https://opendata.adsb.fi/api/v2/lat/${ABE.lat}/lon/${ABE.lon}/dist/${SNAPSHOT_NM}`,
  },
  {
    name: "airplanes.live",
    url: `https://api.airplanes.live/v2/point/${ABE.lat}/${ABE.lon}/${SNAPSHOT_NM}`,
  },
  {
    name: "adsb.one",
    url: `https://api.adsb.one/v2/point/${ABE.lat}/${ABE.lon}/${SNAPSHOT_NM}`,
  },
];

// 250 nm around ABE as a box (1° latitude = 60 nm).
const BOX_LAT = SNAPSHOT_NM / 60;
const BOX_LON = SNAPSHOT_NM / (60 * Math.cos((ABE.lat * Math.PI) / 180));
const OPENSKY = {
  name: "opensky-network.org",
  url: `https://opensky-network.org/api/states/all?lamin=${(ABE.lat - BOX_LAT).toFixed(3)}&lomin=${(ABE.lon - BOX_LON).toFixed(3)}&lamax=${(ABE.lat + BOX_LAT).toFixed(3)}&lomax=${(ABE.lon + BOX_LON).toFixed(3)}`,
};
let lastResortAt = 0;

export type Snapshot = { at: number; source: string; planes: Plane[] };

let memory: Snapshot | null = null;
let refreshing: Promise<Snapshot | null> | null = null;
const backoffUntil = new Map<string, number>();
/** Last result per network ("ok", an HTTP status, or an error), for checking reliability. */
const lastResult = new Map<string, { at: number; result: string }>();

async function fetchSource(source: { name: string; url: string }, now: number) {
  try {
    const response = await fetch(source.url, {
      headers: { Accept: "application/json", "User-Agent": "Shiftdeck (personal ramp app)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status === 429) {
      backoffUntil.set(source.name, now + BACKOFF_MS);
      throw new Error("429");
    }
    if (response.status === 403) {
      backoffUntil.set(source.name, now + BLOCKED_BACKOFF_MS);
      throw new Error("403");
    }
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as {
      ac?: RawAircraft[]; aircraft?: RawAircraft[]; states?: unknown[][] | null;
    };
    const aircraft = source === OPENSKY
      ? fromOpenSky(data.states ?? [], Math.floor(now / 1000))
      : data.ac ?? data.aircraft;
    if (!Array.isArray(aircraft)) throw new Error("no aircraft list");
    lastResult.set(source.name, { at: now, result: "ok" });
    return aircraft;
  } catch (error) {
    if ((backoffUntil.get(source.name) ?? 0) <= now) {
      backoffUntil.set(source.name, now + ERROR_BACKOFF_MS);
    }
    const reason = error instanceof Error ? error.message : String(error);
    lastResult.set(source.name, { at: now, result: reason });
    console.error(`Live planes from ${source.name} failed:`, reason);
    return null;
  }
}

async function fetchSnapshot(now: number): Promise<Snapshot | null> {
  const ready = SOURCES.filter((source) => (backoffUntil.get(source.name) ?? 0) <= now);
  // If every network is resting, still try adsb.lol rather than show nothing.
  const asked = ready.length ? ready : [SOURCES[0]];
  const results = await Promise.all(asked.map((source) => fetchSource(source, now)));
  const answered = asked.filter((_, index) => results[index]);
  if (!answered.length && now - lastResortAt >= LAST_RESORT_MS &&
    (backoffUntil.get(OPENSKY.name) ?? 0) <= now) {
    lastResortAt = now;
    const backup = await fetchSource(OPENSKY, now);
    if (backup) return { at: now, source: OPENSKY.name, planes: toPlanes(backup) };
  }
  if (!answered.length) return null;
  return {
    at: now,
    source: answered.map((source) => source.name).join(" + "),
    planes: toPlanes(mergeAircraft(results.filter((list): list is RawAircraft[] => Boolean(list)))),
  };
}

/** One shared snapshot per data center (Cache API) and per isolate (memory). */
export async function getSnapshot(now: number): Promise<{ snapshot: Snapshot | null; stale: boolean }> {
  if (memory && now - memory.at < SNAPSHOT_MS) return { snapshot: memory, stale: false };
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  let saved: Snapshot | null = null;
  if (cache) {
    const hit = await cache.match(CACHE_URL);
    if (hit) {
      saved = (await hit.json()) as Snapshot;
      if (now - saved.at < SNAPSHOT_MS) {
        memory = saved;
        return { snapshot: saved, stale: false };
      }
    }
  }
  // Only one upstream request at a time per isolate.
  refreshing ??= fetchSnapshot(now).finally(() => {
    refreshing = null;
  });
  const fresh = await refreshing;
  if (fresh) {
    memory = fresh;
    if (cache) {
      await cache.put(
        CACHE_URL,
        new Response(JSON.stringify(fresh), {
          // Kept longer than it's fresh so it can stand in during an outage.
          headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${STALE_LIMIT_MS / 1000}` },
        }),
      );
    }
    return { snapshot: fresh, stale: false };
  }
  const fallback = [memory, saved]
    .filter((snapshot): snapshot is Snapshot => Boolean(snapshot) && now - snapshot!.at < STALE_LIMIT_MS)
    .sort((a, b) => b.at - a.at)[0] ?? null;
  return { snapshot: fallback, stale: true };
}

export async function handlePlanesRequest(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/planes") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request) as Record<string, string>,
    });
  }
  if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);

  const number = (name: string, fallback: number) => {
    const value = Number(url.searchParams.get(name));
    return url.searchParams.has(name) && Number.isFinite(value) ? value : fallback;
  };
  const lat = number("lat", ABE.lat);
  const lon = number("lon", ABE.lon);
  const radius = Math.min(Math.max(number("r", DEFAULT_RADIUS_NM), 1), SNAPSHOT_NM);

  const now = Date.now();
  const { snapshot, stale } = await getSnapshot(now);
  if (!snapshot) {
    return json(request, { error: "Live planes unavailable" }, 502, { "Cache-Control": "no-store" });
  }
  return json(
    request,
    {
      source: snapshot.source,
      updatedAt: new Date(snapshot.at).toISOString(),
      radius,
      stale,
      networks: Object.fromEntries([...SOURCES, OPENSKY].map(({ name }) => {
        const last = lastResult.get(name);
        return [name, last ? `${last.result} ${Math.round((now - last.at) / 1000)}s ago` : "not asked here yet"];
      })),
      planes: planesInView(snapshot.planes, lat, lon, radius),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
