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
 * - adsb.lol first (free, open data under ODbL), adsb.fi as a backup
 *   (personal, non-commercial use, credited in the app).
 * - Neither sends CORS headers, so phones can't ask them directly.
 * - If a network says "slow down" (429), it's skipped for a minute.
 */
import { corsHeaders, json } from "./calendar-service";
import { Plane, planesInView, RawAircraft, toPlanes } from "./planes-data";

const ABE = { lat: 40.652363, lon: -75.440406 };
const SNAPSHOT_NM = 250;
const DEFAULT_RADIUS_NM = 35;
const SNAPSHOT_MS = 10_000;
const BACKOFF_MS = 60_000;
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
];

type Snapshot = { at: number; source: string; planes: Plane[] };

let memory: Snapshot | null = null;
let refreshing: Promise<Snapshot | null> | null = null;
const backoffUntil = new Map<string, number>();

async function fetchSnapshot(now: number): Promise<Snapshot | null> {
  for (const source of SOURCES) {
    if ((backoffUntil.get(source.name) ?? 0) > now) continue;
    try {
      const response = await fetch(source.url, {
        headers: { Accept: "application/json", "User-Agent": "Shiftdeck (personal ramp app)" },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.status === 429) {
        backoffUntil.set(source.name, now + BACKOFF_MS);
        throw new Error("429");
      }
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { ac?: RawAircraft[]; aircraft?: RawAircraft[] };
      return { at: now, source: source.name, planes: toPlanes(data.ac ?? data.aircraft ?? []) };
    } catch (error) {
      console.error(`Live planes from ${source.name} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return null;
}

/** One shared snapshot per data center (Cache API) and per isolate (memory). */
async function getSnapshot(now: number): Promise<{ snapshot: Snapshot | null; stale: boolean }> {
  if (memory && now - memory.at < SNAPSHOT_MS) return { snapshot: memory, stale: false };
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (cache) {
    const hit = await cache.match(CACHE_URL);
    if (hit) {
      const saved = (await hit.json()) as Snapshot;
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
          headers: { "Content-Type": "application/json", "Cache-Control": "max-age=10" },
        }),
      );
    }
    return { snapshot: fresh, stale: false };
  }
  return { snapshot: memory, stale: true };
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
      planes: planesInView(snapshot.planes, lat, lon, radius),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
