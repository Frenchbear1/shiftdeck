/**
 * Pure helpers for Shiftdeck's flight learning (no imports, so tests can load
 * them). The worker in flight-learning.ts stores data and calls these.
 */

export const ABE = { lat: 40.652363, lon: -75.440406, elevationFt: 394 };

/** True headings of ABE's runway ends (FAA). */
export const RUNWAYS = [
  { name: "06", heading: 51 },
  { name: "24", heading: 231 },
  { name: "13", heading: 123 },
  { name: "31", heading: 303 },
] as const;

/** Distances (nm from ABE) we remember "time left to touchdown" at. */
export const CHECKPOINTS_NM = [5, 10, 15, 20, 30, 40, 60, 80, 100, 150] as const;

const DEFAULT_TAXI_S = 5 * 60;
const MIN_HISTORY = 3;

export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const angleBetween = (a: number, b: number) => {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
};

/** The runway a plane is lined up on, from its final-approach track. */
export function runwayFromTrack(track: number | null | undefined) {
  if (typeof track !== "number") return null;
  const best = RUNWAYS.map((runway) => ({ runway, off: angleBetween(track, runway.heading) })).sort(
    (a, b) => a.off - b.off,
  )[0];
  return best.off <= 25 ? best.runway.name : null;
}

/**
 * Likely runway from the wind (true direction it blows FROM, knots).
 * Jets use 06/24 by preference (noise rule), so 13/31 only wins when the
 * crosswind on 06/24 is strong and 13/31 has a real headwind.
 */
export function runwayFromWind(windFrom: number | null, windKt: number | null) {
  // Calm or unknown wind: no guess (either end of 06/24 is likely).
  if (windFrom === null || windKt === null || windKt < 4) return null;
  const component = (heading: number) => {
    const angle = ((windFrom - heading) * Math.PI) / 180;
    return { head: windKt * Math.cos(angle), cross: Math.abs(windKt * Math.sin(angle)) };
  };
  const main = component(51).head >= 0 ? "06" : "24";
  const mainCross = component(51).cross;
  const side = component(123).head >= 0 ? "13" : "31";
  if (mainCross >= 20 && Math.abs(component(123).head) >= 10) return side;
  return main;
}

export type Observation = {
  ts: number;
  dist: number;
  alt: number | null;
  gs: number | null;
  track: number | null;
  ground: boolean;
  lat: number;
  lon: number;
};

/** First time a plane counts as landed at ABE: on the ground, or very low and slow, near the field. */
export function landedObservation(observations: Observation[]) {
  return (
    observations.find(
      (obs) =>
        obs.dist <= 3 &&
        (obs.ground || ((obs.alt ?? 9999) <= ABE.elevationFt + 150 && (obs.gs ?? 999) <= 140)),
    ) ?? null
  );
}

/** Runway actually used: the average track over the last airborne miles before touchdown. */
export function runwayUsed(observations: Observation[], landedTs: number) {
  const finals = observations.filter(
    (obs) => obs.ts <= landedTs && !obs.ground && obs.dist <= 8 && (obs.alt ?? 99999) <= 4000,
  );
  for (let index = finals.length - 1; index >= 0; index -= 1) {
    const runway = runwayFromTrack(finals[index].track);
    if (runway) return runway;
  }
  return null;
}

/** Seconds from each checkpoint distance to touchdown, from one flight's track. */
export function checkpointTimes(observations: Observation[], landedTs: number) {
  const result: Record<string, number> = {};
  const airborne = observations.filter((obs) => obs.ts <= landedTs);
  for (const checkpoint of CHECKPOINTS_NM) {
    // Last moment the plane was still farther out than the checkpoint, and first moment inside it.
    let outside: Observation | null = null;
    let inside: Observation | null = null;
    for (const obs of airborne) {
      if (obs.dist > checkpoint) outside = obs;
      else if (outside && !inside) inside = obs;
    }
    if (!outside || !inside) continue;
    const span = outside.dist - inside.dist;
    const fraction = span > 0 ? (outside.dist - checkpoint) / span : 0;
    const crossed = outside.ts + fraction * (inside.ts - outside.ts);
    result[String(checkpoint)] = Math.round((landedTs - crossed) / 1000);
  }
  return result;
}

/**
 * Allegiant flies two families that land a little differently:
 * Airbus A319/A320 and Boeing 737 (737-8200 "B38M"). Accepts ADS-B type
 * codes ("A320", "B38M") or FlightAware names.
 */
export function aircraftFamily(type: string | null | undefined): "A320" | "737" | null {
  const code = (type ?? "").toUpperCase().replace(/\s+/g, "");
  if (/^(A3(19|20|21)|A32[0-9]N|AIRBUSA3(19|20|21))/.test(code)) return "A320";
  if (/^(B73[0-9]|B3[789]M|B737|BOEING737|737)/.test(code)) return "737";
  return null;
}

export type HistoryFlight = {
  runway: string | null;
  origin: string | null;
  aircraft?: string | null;
  checkpoints: Record<string, number>;
  taxiS: number | null;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Drop odd balls (outside 1.5× the interquartile range) before averaging. */
export function withoutOutliers(values: number[]) {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
  const low = q(0.25);
  const high = q(0.75);
  const spread = (high - low) * 1.5;
  return sorted.filter((value) => value >= low - spread && value <= high + spread);
}

/** Time left to touchdown at a distance, from one history flight (interpolated between checkpoints). */
function timeAt(flight: HistoryFlight, distance: number) {
  const points = CHECKPOINTS_NM.filter((cp) => flight.checkpoints[String(cp)] !== undefined).map(
    (cp) => [cp, flight.checkpoints[String(cp)]] as const,
  );
  if (!points.length) return null;
  if (distance <= points[0][0]) return (points[0][1] * distance) / points[0][0];
  for (let index = 1; index < points.length; index += 1) {
    const [d1, t1] = points[index - 1];
    const [d2, t2] = points[index];
    if (distance <= d2) return t1 + ((distance - d1) / (d2 - d1)) * (t2 - t1);
  }
  return null; // Farther out than this flight was ever tracked.
}

export type Estimate = {
  landingTs: number;
  gateTs: number;
  method: "history" | "physics";
  samples: number;
};

/**
 * Shiftdeck's own arrival estimate for a plane being tracked right now.
 * Uses past flights on the same runway (then any runway) when there are
 * enough; otherwise distance ÷ speed plus a few minutes for the approach.
 */
export function estimateArrival(
  history: HistoryFlight[],
  now: number,
  distance: number,
  groundSpeed: number | null,
  runway: string | null,
  aircraft: string | null = null,
): Estimate {
  const pick = (flights: HistoryFlight[]) =>
    withoutOutliers(
      flights.map((flight) => timeAt(flight, distance)).filter((value): value is number => value !== null),
    );
  // Most specific first: same plane type and runway, then same type, then
  // same runway, then everything.
  const family = aircraftFamily(aircraft);
  const sameType = (flight: HistoryFlight) => family !== null && aircraftFamily(flight.aircraft) === family;
  const groups = [
    family && runway ? history.filter((flight) => sameType(flight) && flight.runway === runway) : [],
    family ? history.filter(sameType) : [],
    runway ? history.filter((flight) => flight.runway === runway) : [],
    history,
  ];
  let times: number[] = [];
  for (const group of groups) {
    times = pick(group);
    if (times.length >= MIN_HISTORY) break;
  }
  const taxi = withoutOutliers(
    history
      .filter((flight) => !runway || flight.runway === runway)
      .map((flight) => flight.taxiS)
      .filter((value): value is number => typeof value === "number" && value > 0),
  );
  const taxiS = taxi.length >= MIN_HISTORY ? median(taxi) : DEFAULT_TAXI_S;

  let seconds: number;
  let method: Estimate["method"];
  if (times.length >= MIN_HISTORY) {
    seconds = median(times);
    method = "history";
  } else {
    // Planes slow down on approach: assume ~75% of current ground speed on
    // average for the rest, plus 3 minutes for the approach and landing.
    const speed = Math.max(140, (groundSpeed ?? 250) * 0.75);
    seconds = (distance / speed) * 3600 + (distance > 5 ? 180 : 60);
    method = "physics";
  }
  const landingTs = Math.round(now + seconds * 1000);
  return { landingTs, gateTs: Math.round(landingTs + taxiS * 1000), method, samples: times.length };
}

export type FinishedFlight = {
  seen: boolean;
  aircraft?: string | null;
  firstSeenNm: number | null;
  runway: string | null;
  taxiS: number | null;
  /** Absolute error in minutes of each estimate made 30 and 15 minutes before touchdown. */
  faErr30: number | null;
  faErr15: number | null;
  ourErr30: number | null;
  ourErr15: number | null;
};

/** The numbers shown in Settings. */
export function summarize(flights: FinishedFlight[]) {
  const values = (pick: (flight: FinishedFlight) => number | null) =>
    withoutOutliers(flights.map(pick).filter((value): value is number => value !== null));
  const typical = (list: number[]) => (list.length ? Math.round(median(list) * 10) / 10 : null);
  const seen = flights.filter((flight) => flight.seen);
  const runways = new Map<string, FinishedFlight[]>();
  for (const flight of flights) {
    if (!flight.runway) continue;
    runways.set(flight.runway, [...(runways.get(flight.runway) ?? []), flight]);
  }
  return {
    flights: flights.length,
    seen: seen.length,
    firstSeenNm: typical(values((flight) => (flight.seen ? flight.firstSeenNm : null))),
    faErr30: typical(values((flight) => flight.faErr30)),
    faErr15: typical(values((flight) => flight.faErr15)),
    ourErr30: typical(values((flight) => flight.ourErr30)),
    ourErr15: typical(values((flight) => flight.ourErr15)),
    ourSamples: values((flight) => flight.ourErr15).length,
    runways: [...runways.entries()]
      .map(([runway, list]) => ({
        runway,
        flights: list.length,
        taxiMin: typical(values((flight) => (list.includes(flight) && flight.taxiS ? flight.taxiS / 60 : null))),
      }))
      .sort((a, b) => b.flights - a.flights),
    aircraft: (["A320", "737"] as const)
      .map((family) => {
        const list = flights.filter((flight) => aircraftFamily(flight.aircraft) === family);
        const errors = withoutOutliers(
          list.map((flight) => flight.ourErr15).filter((value): value is number => value !== null),
        );
        return { family, flights: list.length, ourErr15: typical(errors) };
      })
      .filter((group) => group.flights > 0),
  };
}
