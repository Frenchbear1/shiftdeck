import assert from "node:assert/strict";
import test from "node:test";
import { mergeLiveFlights, toLiveFlight } from "../worker/live-flight-data.ts";
import { matchLiveFlight } from "../app/live-flights.ts";

// Times below are written for the home airport (Allentown).
process.env.TZ = "America/New_York";

const aeroArrival = {
  fa_flight_id: "AAY178-1",
  ident: "AAY178",
  ident_iata: "G4178",
  origin: { code: "KPIE", code_iata: "PIE", code_icao: "KPIE" },
  destination: { code: "KABE", code_iata: "ABE", code_icao: "KABE" },
  scheduled_in: "2026-07-29T23:27:00Z",
  estimated_in: "2026-07-30T00:12:00Z",
  status: "En Route / Delayed",
  cancelled: false,
};

test("turns AeroAPI flights into gate times", () => {
  const live = toLiveFlight(aeroArrival, "arrival");
  assert.equal(live.ident, "G4178");
  assert.deepEqual(live.other, ["PIE", "KPIE"]);
  assert.equal(live.estimated, "2026-07-30T00:12:00Z");
});

test("keeps flights that left the scheduled list as landed", () => {
  const seen = toLiveFlight(aeroArrival, "arrival");
  const now = Date.parse("2026-07-30T00:20:00Z");
  const [kept] = mergeLiveFlights([seen], [], now);
  assert.equal(kept.done, true);
  assert.equal(kept.status, "Arrived");
  // A flight still hours away that dropped off is not marked done.
  const later = { ...seen, id: "x", estimated: "2026-07-30T05:00:00Z" };
  assert.equal(mergeLiveFlights([later], [], now)[0].done, undefined);
});

test("matches a schedule row to its live flight by airport and time", () => {
  const live = {
    updatedAt: "2026-07-29T23:00:00Z",
    flights: [toLiveFlight(aeroArrival, "arrival")],
  };
  const flight = {
    id: "f1",
    date: "2026-07-29",
    period: "Evening",
    kind: "arrival",
    raw: "",
    origin: "PIE",
    inboundAirport: "PIE",
    arrival: "19:27",
    start: "19:27",
  };
  const match = matchLiveFlight(flight, "19:27", live);
  assert.equal(match?.time, "20:12");
  assert.equal(match?.delay, 45);
  assert.equal(match?.label, "En Route");
  const other = { ...flight, inboundAirport: "SFB", origin: "SFB" };
  assert.equal(matchLiveFlight(other, "19:27", live), null);
});
