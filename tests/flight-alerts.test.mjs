import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FLIGHT_ALERTS, flightKey, flightNews, inShifts, normalizeFlightAlerts, normalizeWatch, shiftWindow } from "../worker/flight-alerts-data.ts";

const MIN = 60_000;
const now = Date.parse("2026-11-20T01:30:00Z"); // 8:30 PM at ABE
const clock = (time) => new Date(time).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const flight = (patch = {}) => ({
  id: "abe-arrival-G4854-2026-11-19", ident: "G4854", kind: "arrival", other: ["PIE", "KPIE"],
  scheduled: "2026-11-20T01:45:00Z", estimated: null, status: "On Time", cancelled: false, gate: "8", ...patch,
});
const kinds = (news) => news.filter((item) => !item.silent).map((item) => item.kind);

test("reminds before landing, from a real estimate", () => {
  const lands = new Date(now + 9 * MIN).toISOString();
  const news = flightNews(flight({ liveEta: { landing: lands, gate: lands, distanceNm: 30, seenAt: "", method: "history" } }), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8", "inair"]), now, null, clock);
  assert.deepEqual(kinds(news), ["landing"]);
  assert.equal(news[0].title, "G4 854 lands in ~9 min · Gate 8");
  assert.equal(news[0].body, "From PIE · about 8:39 PM");
  const noGate = flightNews(flight({ gate: null, liveEta: { landing: lands, gate: lands, distanceNm: 30, seenAt: "", method: "history" } }), DEFAULT_FLIGHT_ALERTS, new Set(["inair"]), now, null, clock);
  assert.equal(noGate.find((item) => item.kind === "landing").title, "G4 854 lands in ~9 min · gate not posted yet");
  // Only the timetable, nothing flying yet: no reminder.
  assert.deepEqual(kinds(flightNews(flight({ scheduled: new Date(now + 5 * MIN).toISOString() }), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8"]), now, null, clock)), []);
  // Too early for a 10-minute reminder.
  const later = new Date(now + 25 * MIN).toISOString();
  assert.deepEqual(kinds(flightNews(flight({ estimatedOn: later }), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8", "inair"]), now, now - 60 * MIN, clock)), []);
});

test("cancelled, in the air, gate changes and growing delays", () => {
  assert.deepEqual(kinds(flightNews(flight({ cancelled: true }), DEFAULT_FLIGHT_ALERTS, new Set(), now, null, clock)), ["cancelled"]);
  assert.deepEqual(kinds(flightNews(flight(), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8"]), now, now - 90 * MIN, clock)), ["inair"]);
  // First gate: quiet. A change: news.
  const first = flightNews(flight(), DEFAULT_FLIGHT_ALERTS, new Set(), now, null, clock);
  assert.deepEqual(first.map((item) => [item.kind, Boolean(item.silent)]), [["gate:8", true]]);
  const moved = flightNews(flight({ gate: "3" }), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8"]), now, null, clock);
  assert.equal(moved[0].title, "G4 854 gate change: now Gate 3");
  // Delayed 20: once; 35: again; 40 (same step): no.
  assert.deepEqual(kinds(flightNews(flight({ delayMinutes: 20 }), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8"]), now, null, clock)), ["delay:1"]);
  assert.deepEqual(kinds(flightNews(flight({ delayMinutes: 35 }), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8", "delay:1"]), now, null, clock)), ["delay:2"]);
  assert.deepEqual(kinds(flightNews(flight({ delayMinutes: 40 }), DEFAULT_FLIGHT_ALERTS, new Set(["gate:8", "delay:2"]), now, null, clock)), []);
});

test("turned-off alerts are recorded quietly", () => {
  const prefs = { ...DEFAULT_FLIGHT_ALERTS, inAir: false, landed: false };
  const news = flightNews(flight({ landedAt: new Date(now).toISOString() }), prefs, new Set(["gate:8"]), now, null, clock);
  assert.deepEqual(news.map((item) => [item.kind, Boolean(item.silent)]), [["landed", true]]);
});

test("reads choices and the watch list safely", () => {
  assert.deepEqual(normalizeFlightAlerts({ which: "all", landingLead: 400, landed: true }), { ...DEFAULT_FLIGHT_ALERTS, which: "all", landed: true });
  assert.equal(normalizeFlightAlerts({ landingLead: null }).landingLead, null);
  assert.deepEqual(normalizeWatch([{ ident: "aay 854", kind: "arrival", at: "2026-11-20T01:45:00Z" }, { ident: "DL5", at: "x" }]),
    [{ ident: "G4854", kind: "arrival", at: "2026-11-20T01:45:00.000Z" }]);
  assert.equal(flightKey(flight()), "G4854-arrival-2026-11-19");
});

test("flights in my shifts are matched by shift time (schedule flights have no flight number)", () => {
  // 5:00 AM – 1:30 PM Eastern on Nov 24 (10:00Z – 18:30Z).
  const shift = shiftWindow("2026-11-24T10:00:00.000Z", "05:00", "13:30");
  assert.equal(shift.end - shift.start, 8.5 * 3_600_000);
  const flight = (kind, scheduled, extra = {}) => ({ id: "x", ident: "G4854", kind, other: ["SFB"], scheduled, ...extra });
  assert.ok(inShifts(flight("arrival", "2026-11-24T14:00:00Z"), [shift]));
  // Arrivals landing up to 45 min before the start count; departures don't.
  assert.ok(inShifts(flight("arrival", "2026-11-24T09:20:00Z"), [shift]));
  assert.ok(!inShifts(flight("departure", "2026-11-24T09:20:00Z"), [shift]));
  // Scheduled in the shift, running late: still yours for 6 hours past the end.
  assert.ok(inShifts(flight("arrival", "2026-11-24T17:00:00Z", { estimated: "2026-11-24T22:00:00Z" }), [shift]));
  assert.ok(!inShifts(flight("arrival", "2026-11-24T17:00:00Z", { estimated: "2026-11-25T02:00:00Z" }), [shift]));
  assert.ok(!inShifts(flight("arrival", "2026-11-24T21:00:00Z"), [shift]));
  // Overnight shift ends the next day.
  const night = shiftWindow("2026-11-25T03:00:00.000Z", "22:00", "06:00");
  assert.equal(night.end - night.start, 8 * 3_600_000);
});
