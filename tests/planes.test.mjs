import assert from "node:assert/strict";
import test from "node:test";
import { toPlanes } from "../worker/planes-data.ts";

test("keeps planes with a fresh position and tidies their fields", () => {
  const planes = toPlanes([
    { hex: "a1b2c3", flight: "AAY854  ", r: "N288NV", t: "A320", lat: 40.7, lon: -75.3, alt_baro: 4200, gs: 182.4, track: 240 },
    { hex: "d4e5f6", flight: "N123AB ", lat: 40.65, lon: -75.44, alt_baro: "ground", gs: 3 },
    { hex: "old", lat: 40.6, lon: -75.4, seen_pos: 120 },
    { hex: "nopos", flight: "UAL1" },
  ]);
  assert.equal(planes.length, 2);
  assert.equal(planes[0].callsign, "AAY854");
  assert.equal(planes[0].altitude, 4200);
  assert.equal(planes[0].speed, 182);
  assert.equal(planes[1].ground, true);
  assert.equal(planes[1].altitude, null);
});

test("snaps map views so nearby phones share one request", async () => {
  const { snapView } = await import("../worker/planes-data.ts");
  // 35 nm view + up to ~10.6 nm of snapping → the 50 nm step.
  assert.deepEqual(snapView(40.652, -75.44, 35), { lat: 40.75, lon: -75.5, r: 50 });
  assert.deepEqual(snapView(40.6, -75.4, 33), { lat: 40.5, lon: -75.5, r: 50 });
  assert.equal(snapView(38, -77, 900).r, 250);
  assert.equal(snapView(38, -77, 180).lat, 38);
});
