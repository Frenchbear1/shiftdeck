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

test("hands each phone only the planes in its view", async () => {
  const { planesInView, toPlanes } = await import("../worker/planes-data.ts");
  const planes = toPlanes([
    { hex: "near", lat: 40.7, lon: -75.4, alt_baro: 3000 },
    { hex: "philly", lat: 39.87, lon: -75.24, alt_baro: 9000 },
    { hex: "boston", lat: 42.36, lon: -71.0, alt_baro: 30000 },
  ]);
  assert.deepEqual(planesInView(planes, 40.65, -75.44, 35).map((p) => p.hex), ["near"]);
  assert.deepEqual(planesInView(planes, 40.65, -75.44, 60).map((p) => p.hex), ["near", "philly"]);
  assert.equal(planesInView(planes, 40.65, -75.44, 250).length, 3);
});
