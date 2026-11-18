/** Pure ADS-B → map plane helpers (no imports, so tests can load them). */

export type RawAircraft = {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  true_heading?: number;
  baro_rate?: number;
  seen_pos?: number;
};

export type Plane = {
  hex: string;
  callsign: string | null;
  registration: string | null;
  type: string | null;
  lat: number;
  lon: number;
  /** Feet; null on the ground. */
  altitude: number | null;
  ground: boolean;
  speed: number | null;
  track: number | null;
  climb: number | null;
};

export function toPlanes(aircraft: RawAircraft[]): Plane[] {
  return aircraft
    .filter(
      (plane) =>
        typeof plane.lat === "number" &&
        typeof plane.lon === "number" &&
        (plane.seen_pos ?? 0) < 60,
    )
    .map((plane) => ({
      hex: plane.hex ?? `${plane.lat},${plane.lon}`,
      callsign: plane.flight?.trim() || null,
      registration: plane.r?.trim() || null,
      type: plane.t?.trim() || null,
      lat: plane.lat!,
      lon: plane.lon!,
      altitude: typeof plane.alt_baro === "number" ? plane.alt_baro : null,
      ground: plane.alt_baro === "ground",
      speed: typeof plane.gs === "number" ? Math.round(plane.gs) : null,
      track:
        typeof plane.track === "number"
          ? plane.track
          : typeof plane.true_heading === "number"
            ? plane.true_heading
            : null,
      climb: typeof plane.baro_rate === "number" ? plane.baro_rate : null,
    }));
}

/**
 * OpenSky's state vectors (arrays, metric units) in the same shape as the
 * other networks' aircraft: [icao24, callsign, country, time_position,
 * last_contact, lon, lat, baro_altitude m, on_ground, velocity m/s,
 * true_track, vertical_rate m/s, ...].
 */
export function fromOpenSky(states: unknown[][], nowSeconds: number): RawAircraft[] {
  return states.flatMap((state) => {
    const [hex, callsign, , timePosition, , lon, lat, altitude, onGround, velocity, track, rate] = state as [
      string, string | null, string, number | null, number, number | null, number | null,
      number | null, boolean, number | null, number | null, number | null,
    ];
    if (typeof lat !== "number" || typeof lon !== "number") return [];
    return [{
      hex,
      flight: callsign ?? undefined,
      lat,
      lon,
      alt_baro: onGround ? "ground" as const : typeof altitude === "number" ? Math.round(altitude * 3.28084) : undefined,
      gs: typeof velocity === "number" ? velocity * 1.943844 : undefined,
      track: typeof track === "number" ? track : undefined,
      baro_rate: typeof rate === "number" ? Math.round(rate * 196.8504) : undefined,
      seen_pos: typeof timePosition === "number" ? Math.max(0, nowSeconds - timePosition) : undefined,
    }];
  });
}

/**
 * Combines the aircraft lists from several networks. Each network has its own
 * receivers, so together they see more; a plane seen by more than one keeps
 * the freshest position.
 */
export function mergeAircraft(lists: RawAircraft[][]): RawAircraft[] {
  const byHex = new Map<string, RawAircraft>();
  const unnamed: RawAircraft[] = [];
  for (const list of lists) {
    for (const plane of list) {
      if (!plane.hex) {
        unnamed.push(plane);
        continue;
      }
      const key = plane.hex.toLowerCase();
      const current = byHex.get(key);
      if (!current || (plane.seen_pos ?? Infinity) < (current.seen_pos ?? Infinity)) {
        byHex.set(key, current ? { ...current, ...plane } : plane);
      }
    }
  }
  return [...byHex.values(), ...unnamed];
}

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Planes inside the phone's view circle. */
export function planesInView(planes: Plane[], lat: number, lon: number, radius: number) {
  return planes.filter((plane) => distanceNm(lat, lon, plane.lat, plane.lon) <= radius);
}
