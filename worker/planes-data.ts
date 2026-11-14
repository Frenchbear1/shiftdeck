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
