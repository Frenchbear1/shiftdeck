import assert from "node:assert/strict";
import test from "node:test";
import { parsePastedPlace, isShortMapLink } from "../app/place-input.ts";

const near = (place, lat, lon) => {
  assert.ok(place, "expected a spot");
  assert.ok(Math.abs(place.latitude - lat) < 1e-4, `lat ${place.latitude}`);
  assert.ok(Math.abs(place.longitude - lon) < 1e-4, `lon ${place.longitude}`);
};

test("plain coordinates in the usual forms", () => {
  near(parsePastedPlace("40.65382, -75.43225"), 40.65382, -75.43225);
  near(parsePastedPlace("40.65382 -75.43225"), 40.65382, -75.43225);
  near(parsePastedPlace("40.65382° N, 75.43225° W"), 40.65382, -75.43225);
  near(parsePastedPlace("75.43225° W, 40.65382° N"), 40.65382, -75.43225);
  near(parsePastedPlace("N 40.65382 W 75.43225"), 40.65382, -75.43225);
  near(parsePastedPlace("(40.65382, -75.43225)"), 40.65382, -75.43225);
});

test("degrees, minutes, seconds", () => {
  near(parsePastedPlace(`40°39'13.8"N 75°25'56.1"W`), 40.6538333, -75.4322500);
  near(parsePastedPlace("40° 39′ 13.8″ N, 75° 25′ 56.1″ W"), 40.6538333, -75.4322500);
  near(parsePastedPlace("40°39.23'N 75°25.935'W"), 40.6538333, -75.43225);
});

test("map links", () => {
  near(parsePastedPlace("https://www.google.com/maps/place/Lehigh+Valley+International+Airport/@40.6500,-75.4400,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d40.65382!4d-75.43225"), 40.65382, -75.43225);
  assert.equal(parsePastedPlace("https://www.google.com/maps/place/Lehigh+Valley+International+Airport/@40.65,-75.44,15z/data=!3d40.65382!4d-75.43225").name, "Lehigh Valley International Airport");
  near(parsePastedPlace("https://www.google.com/maps/search/?api=1&query=40.65382,-75.43225"), 40.65382, -75.43225);
  near(parsePastedPlace("https://maps.google.com/?q=40.65382,-75.43225"), 40.65382, -75.43225);
  near(parsePastedPlace("https://maps.apple.com/?ll=40.65382,-75.43225&q=ABE"), 40.65382, -75.43225);
  near(parsePastedPlace("https://maps.apple.com/place?coordinate=40.65382,-75.43225&name=Gate%203"), 40.65382, -75.43225);
  assert.equal(parsePastedPlace("https://maps.apple.com/place?coordinate=40.65382,-75.43225&name=Gate%203").name, "Gate 3");
  near(parsePastedPlace("geo:40.65382,-75.43225?q=40.65382,-75.43225(Ramp)"), 40.65382, -75.43225);
  assert.ok(isShortMapLink("https://maps.app.goo.gl/abc123"));
});

test("addresses and names are left for search", () => {
  assert.equal(parsePastedPlace("3311 Airport Rd, Allentown, PA 18109"), null);
  assert.equal(parsePastedPlace("ABE Airport"), null);
  assert.equal(parsePastedPlace("95, 200"), null);
  assert.equal(parsePastedPlace("https://example.com/?q=40.6,-75.4"), null);
});
