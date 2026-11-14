import assert from "node:assert/strict";
import test from "node:test";
import { mergeLiveFlights, toLiveFlight } from "../worker/live-flight-data.ts";
import { addAbeBoardFlights, matchLiveFlight } from "../app/live-flights.ts";
import { mergeAbeBoard, parseAbeAlerts, parseAbeBoard } from "../worker/abe-flight-board.ts";

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
  gate_destination: "4",
  gate_origin: "B12",
  aircraft_type: "A320",
  registration: "N270NV",
  arrival_delay: 2700,
  actual_off: "2026-07-29T22:05:00Z",
  progress_percent: 62,
};

test("turns AeroAPI flights into gate times", () => {
  const live = toLiveFlight(aeroArrival, "arrival");
  assert.equal(live.ident, "G4178");
  assert.deepEqual(live.other, ["PIE", "KPIE"]);
  assert.equal(live.estimated, "2026-07-30T00:12:00Z");
  // Gate at ABE, not at the origin.
  assert.equal(live.gate, "4");
  assert.equal(live.delayMinutes, 45);
  assert.equal(live.aircraft, "A320");
  assert.equal(live.tookOffAt, "2026-07-29T22:05:00Z");
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

const abeRow = (number, time, city, status, displayedStatus = status, airline = "Allegiant Air") => `
  <li class="${airline} flight clearfix">
    <span class="airline flight-item" data-value="${airline}"></span>
    <span class="number flight-item" data-value="${number}"></span>
    <span class="gate flight-item" data-value="11"></span>
    <span class="time flight-item" data-value="${time}"></span>
    <span class="dl status flight-item" data-value="${status}"><span class="label">Status</span> ${displayedStatus}</span>
    <span class="city last flight-item" data-value="${city}"></span>
  </li>`;

test("reads ABE arrivals and departures across midnight in Eastern time", () => {
  const flights = parseAbeBoard({
    code: "ok",
    arrivals: abeRow("177", "11:33 PM", "Myrtle Beach", "12:15-am", "12:15 AM") +
      abeRow("178", "1:20 AM", "St. Petersburg", "cancelled", "Cancelled"),
    departures: abeRow("5553", "12:19 AM", "Charlotte", "departed", "Departed", "American") +
      abeRow("176", "8:30 AM", "Punta Gorda", "on-time", "On Time"),
  }, Date.parse("2026-11-14T06:05:00Z"));
  assert.deepEqual(flights.map((flight) => flight.id), [
    "abe-arrival-G4177-2026-11-13", "abe-arrival-G4178-2026-11-14", "abe-departure-G4176-2026-11-14",
  ]);
  assert.equal(flights[0].estimated, "2026-11-14T05:15:00.000Z");
  assert.equal(flights[0].delayMinutes, 42);
  assert.equal(flights[0].gate, "11");
  assert.equal(flights[1].cancelled, true);
  assert.equal(flights[1].done, false);
  assert.equal(flights[2].scheduled, "2026-11-14T13:30:00.000Z");
});

test("uses new ABE status with existing AeroAPI details and shows unmatched board flights", () => {
  const fetchedAt = Date.parse("2026-07-29T23:00:00Z");
  const board = parseAbeBoard({ code: "ok", arrivals: abeRow("178", "7:27 PM", "St Petersburg", "cancelled", "Cancelled"), departures: "" }, fetchedAt);
  const flights = mergeAbeBoard([toLiveFlight(aeroArrival, "arrival")], { fetchedAt, data: board }, fetchedAt - 60_000);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].cancelled, true);
  assert.equal(flights[0].gate, "11");
  assert.equal(flights[0].registration, "N270NV");
  const live = { flights, airportBoardUpdatedAt: new Date(fetchedAt).toISOString() };
  const [flight] = addAbeBoardFlights([], "2026-07-29", live);
  assert.equal(flight.trackingId, "G4178");
  assert.equal(matchLiveFlight(flight, flight.start, live)?.label, "Cancelled");
  assert.equal(addAbeBoardFlights([flight], "2026-07-29", live).length, 1);
  assert.equal(addAbeBoardFlights([], "2026-07-30", live).length, 0);
});

test("reads plain-text airport alerts and keeps only HTTPS source links", () => {
  const header = '<header id="main"></header>';
  assert.deepEqual(parseAbeAlerts(`<section id="announcement"><section class="wrap">
    <p>Alert: Flights &amp; parking.</p>
    <p><a href="/media-center/">Advisory: Parking notice.</a></p>
    <p><a href="javascript:alert(1)">Another notice.</a></p>
    </section></section>${header}`), [
    { text: "Alert: Flights & parking.", url: undefined },
    { text: "Advisory: Parking notice.", url: "https://www.flyabe.com/media-center/" },
    { text: "Another notice.", url: undefined },
  ]);
  assert.deepEqual(parseAbeAlerts(header), []);
  assert.throws(() => parseAbeAlerts("<html>Try again later</html>"));
});
