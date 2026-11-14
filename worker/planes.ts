/**
 * Live aircraft around ABE for the in-app map, from community ADS-B networks.
 *
 * GET /api/planes  → { source, updatedAt, planes: [...] }
 *
 * - adsb.lol first (free, open data under ODbL), airplanes.live as a backup
 *   (same response format; free for non-commercial use, 1 request/second).
 * - Neither sends CORS headers, so phones can't ask them directly; this
 *   worker asks for everyone and shares the answer for 8 seconds.
 */
import { corsHeaders, json } from "./calendar-service";
import { RawAircraft, toPlanes } from "./planes-data";

const ABE = { lat: 40.652363, lon: -75.440406 };
const RADIUS_NM = 35;
const SHARE_MS = 8_000;

const SOURCES = [
  {
    name: "adsb.lol",
    url: `https://api.adsb.lol/v2/point/${ABE.lat}/${ABE.lon}/${RADIUS_NM}`,
  },
  {
    name: "airplanes.live",
    url: `https://api.airplanes.live/v2/point/${ABE.lat}/${ABE.lon}/${RADIUS_NM}`,
  },
];

let shared: { at: number; body: Record<string, unknown> } | null = null;

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

  const now = Date.now();
  if (shared && now - shared.at < SHARE_MS) {
    return json(request, shared.body, 200, { "Cache-Control": "no-store" });
  }

  const errors: string[] = [];
  for (const source of SOURCES) {
    try {
      const response = await fetch(source.url, {
        headers: { Accept: "application/json", "User-Agent": "Shiftdeck (personal ramp app)" },
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = (await response.json()) as { ac?: RawAircraft[] };
      const body = {
        source: source.name,
        updatedAt: new Date(now).toISOString(),
        planes: toPlanes(data.ac ?? []),
      };
      shared = { at: now, body };
      return json(request, body, 200, { "Cache-Control": "no-store" });
    } catch (error) {
      errors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.error("Live planes failed:", errors.join("; "));
  if (shared) return json(request, { ...shared.body, stale: true }, 200, { "Cache-Control": "no-store" });
  return json(request, { error: "Live planes unavailable", detail: errors }, 502);
}
