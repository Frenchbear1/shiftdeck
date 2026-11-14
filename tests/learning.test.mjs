import assert from "node:assert/strict";
import test from "node:test";
import {
  aircraftFamily,
  checkpointTimes,
  estimateArrival,
  landedObservation,
  runwayFromTrack,
  runwayFromWind,
  runwayUsed,
  summarize,
  withoutOutliers,
} from "../worker/learning-data.ts";

const MIN = 60_000;

// A flight descending into ABE on runway 24 (track ~231°), 1 obs per minute.
const t0 = Date.parse("2026-11-14T00:00:00Z");
const approach = [
  { dist: 62, alt: 22000, gs: 420, track: 230 },
  { dist: 54, alt: 19000, gs: 400, track: 231 },
  { dist: 46, alt: 16000, gs: 380, track: 232 },
  { dist: 39, alt: 13000, gs: 340, track: 231 },
  { dist: 33, alt: 11000, gs: 300, track: 230 },
  { dist: 28, alt: 9000, gs: 270, track: 231 },
  { dist: 23, alt: 7000, gs: 240, track: 232 },
  { dist: 19, alt: 5500, gs: 220, track: 231 },
  { dist: 15, alt: 4500, gs: 200, track: 231 },
  { dist: 12, alt: 3600, gs: 180, track: 231 },
  { dist: 9, alt: 2900, gs: 160, track: 231 },
  { dist: 6.5, alt: 2100, gs: 150, track: 231 },
  { dist: 4, alt: 1300, gs: 145, track: 231 },
  { dist: 1.6, alt: 600, gs: 140, track: 231 },
  { dist: 0.4, alt: null, gs: 60, track: 231, ground: true },
].map((point, index) => ({ ts: t0 + index * MIN, lat: 40.6, lon: -75.4, ground: false, ...point }));

test("detects landing, runway used and time from each distance", () => {
  const landed = landedObservation(approach);
  assert.equal(landed.ts, t0 + 14 * MIN);
  assert.equal(runwayUsed(approach, landed.ts), "24");
  const times = checkpointTimes(approach, landed.ts);
  // Crossed 10 nm two-thirds of the way from minute 9 (12 nm) to 10 (9 nm): 4.33 min out.
  assert.ok(Math.abs(times["10"] - 260) <= 2, `10 nm → ${times["10"]}s`);
  assert.ok(times["40"] > times["20"] && times["20"] > times["10"]);
});

test("runway from final track and from the wind", () => {
  assert.equal(runwayFromTrack(48), "06");
  assert.equal(runwayFromTrack(305), "31");
  assert.equal(runwayFromTrack(90), null);
  assert.equal(runwayFromWind(240, 12), "24"); // west-southwest wind → land 24
  assert.equal(runwayFromWind(40, 8), "06");
  assert.equal(runwayFromWind(140, 25), "13"); // strong crosswind on 06/24
  assert.equal(runwayFromWind(200, 2), null); // calm
});

test("estimates from history once there are enough flights, physics before", () => {
  const now = t0;
  const physics = estimateArrival([], now, 30, 300, "24");
  assert.equal(physics.method, "physics");
  // 30 nm at ~225 kt ≈ 8 min + 3 min approach ≈ 11 min.
  assert.ok(Math.abs((physics.landingTs - now) / MIN - 11) < 1.5);
  assert.equal((physics.gateTs - physics.landingTs) / MIN, 5); // default taxi

  const history = [600, 620, 640, 610, 3000].map((at20) => ({
    runway: "24",
    origin: "PIE",
    checkpoints: { 10: 300, 20: at20, 30: at20 + 200 },
    taxiS: 240,
  }));
  const learned = estimateArrival(history, now, 20, 240, "24");
  assert.equal(learned.method, "history");
  // The 3000 s odd ball is ignored → median of 600–640 ≈ 615 s.
  assert.ok(Math.abs((learned.landingTs - now) / 1000 - 615) <= 10, `${(learned.landingTs - now) / 1000}s`);
  assert.equal((learned.gateTs - learned.landingTs) / 1000, 240);
});

test("groups Allegiant planes into A320s and 737s, and learns each separately", () => {
  assert.equal(aircraftFamily("A320"), "A320");
  assert.equal(aircraftFamily("A319"), "A320");
  assert.equal(aircraftFamily("B38M"), "737");
  assert.equal(aircraftFamily("B738"), "737");
  assert.equal(aircraftFamily(null), null);
  const flight = (aircraft, at20) => ({ runway: "24", origin: "PIE", aircraft, checkpoints: { 20: at20 }, taxiS: 240 });
  const history = [
    ...[600, 610, 620].map((at20) => flight("A320", at20)),
    ...[540, 550, 560].map((at20) => flight("B38M", at20)),
  ];
  const now = t0;
  const boeing = estimateArrival(history, now, 20, 240, "24", "B38M");
  assert.equal((boeing.landingTs - now) / 1000, 550);
  const airbus = estimateArrival(history, now, 20, 240, "24", "A319");
  assert.equal((airbus.landingTs - now) / 1000, 610);
  // Unknown type: everything together.
  assert.equal((estimateArrival(history, now, 20, 240, "24").landingTs - now) / 1000, 580);
});

test("outlier filter and summary", () => {
  assert.deepEqual(withoutOutliers([5, 6, 6, 7, 40]), [5, 6, 6, 7]);
  const summary = summarize([
    { seen: true, firstSeenNm: 90, runway: "24", taxiS: 240, faErr30: 6, faErr15: 4, ourErr30: 3, ourErr15: 1.5 },
    { seen: true, firstSeenNm: 70, runway: "24", taxiS: 300, faErr30: 8, faErr15: 5, ourErr30: 4, ourErr15: 2 },
    { seen: false, firstSeenNm: null, runway: null, taxiS: null, faErr30: 7, faErr15: 3, ourErr30: null, ourErr15: null },
  ]);
  assert.equal(summary.flights, 3);
  assert.equal(summary.seen, 2);
  assert.equal(summary.firstSeenNm, 80);
  assert.equal(summary.faErr15, 4);
  assert.equal(summary.ourErr15, 1.8);
  assert.deepEqual(summary.runways, [{ runway: "24", flights: 2, taxiMin: 4.5 }]);
});
