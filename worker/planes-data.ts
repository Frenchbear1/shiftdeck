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
