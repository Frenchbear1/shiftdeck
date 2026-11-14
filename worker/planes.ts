/**
 * Live aircraft around ABE for the in-app map, from community ADS-B networks.
 *
 * GET /api/planes?lat=&lon=&r=  → { source, updatedAt, radius, planes: [...] }
 *   (defaults: ABE, 35 nm; r is capped at the networks' 250 nm limit)
 *
 * - adsb.lol first (free, open data under ODbL), airplanes.live as a backup
 *   (same response format; free for non-commercial use, 1 request/second).
 * - Neither sends CORS headers, so phones can't ask them directly; this
 *   worker asks for everyone and shares each answer for 8 seconds. Views are
 *   snapped to a coarse grid so phones looking at about the same area share.
 */
import { corsHeaders, json } from "./calendar-service";
import { RawAircraft, snapView, toPlanes } from "./planes-data";

const ABE = { lat: 40.652363, lon: -75.440406 };
const DEFAULT_RADIUS_NM = 35;
const SHARE_MS = 8_000;

const SOURCES = [
  { name: "adsb.lol", base: "https://api.adsb.lol/v2/point" },
  { name: "airplanes.live", base: "https://api.airplanes.live/v2/point" },
];

const shared = new Map<string, { at: number; body: Record<string, unknown> }>();

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
  const view = snapView(
    number("lat", ABE.lat),
    number("lon", ABE.lon),
    number("r", DEFAULT_RADIUS_NM),
  );
  const key = `${view.lat},${view.lon},${view.r}`;
  const now = Date.now();
  const cached = shared.get(key);
  if (cached && now - cached.at < SHARE_MS) {
    return json(request, cached.body, 200, { "Cache-Control": "no-store" });
  }

  const errors: string[] = [];
  for (const source of SOURCES) {
    try {
      const response = await fetch(`${source.base}/${view.lat}/${view.lon}/${view.r}`, {
        headers: { Accept: "application/json", "User-Agent": "Shiftdeck (personal ramp app)" },
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = (await response.json()) as { ac?: RawAircraft[] };
      const body = {
        source: source.name,
        updatedAt: new Date(now).toISOString(),
        center: { lat: view.lat, lon: view.lon },
        radius: view.r,
        planes: toPlanes(data.ac ?? []),
      };
      shared.set(key, { at: now, body });
      // Keep the cache small: forget views nobody asked for in a while.
      for (const [oldKey, entry] of shared) {
        if (now - entry.at > 60_000) shared.delete(oldKey);
      }
      return json(request, body, 200, { "Cache-Control": "no-store" });
    } catch (error) {
      errors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.error("Live planes failed:", errors.join("; "));
  if (cached) return json(request, { ...cached.body, stale: true }, 200, { "Cache-Control": "no-store" });
  return json(request, { error: "Live planes unavailable", detail: errors }, 502);
}
