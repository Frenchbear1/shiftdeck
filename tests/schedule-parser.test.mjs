import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSchedulePersonName,
  canonicalizeScheduleShifts,
  parseScheduleTsv,
  resolveSchedulePersonName,
  SCHEDULE_PARSER_VERSION,
} from "../app/schedule-parser.ts";
import {
  normalizeFlightAwareIdent,
  parseCharterTextItems,
} from "../app/charter-parser.ts";

const word = (text, x, y, width = Math.max(8, text.length * 6), height = 10) =>
  [5, 1, 1, 1, 1, 1, x, y, width, height, 90, text].join("\t");

test("imports the employee grid when a document date precedes the seven-day header", () => {
  assert.equal(SCHEDULE_PARSER_VERSION, 4);
  const rows = [
    word("Morning", 4, 100, 50),
    word("ACY", 160, 200, 24),
    word("0353-F/0600", 190, 200, 72),
    word("SRQ", 266, 200, 24),
    word("1000", 480, 220, 28),
    word("SFB", 512, 220, 24),
    word("Airbus", 540, 220, 42),
    word("F", 596, 240, 8),
    word("In-", 608, 240, 18),
    word("SFB", 630, 240, 24),
    word("1045", 658, 240, 28),
    word("Boeing", 690, 240, 42),
    word("8/21/2026", 43, 327, 61, 13),
    ...[
      "8/30/2026",
      "8/31/2026",
      "9/1/2026",
      "9/2/2026",
      "9/3/2026",
      "9/4/2026",
      "9/5/2026",
    ].map((date, index) => word(date, 188 + index * 145, 327, 61, 13)),
    word("David", 4, 500, 33),
    word("LaBarre", 42, 500, 44),
    word("2030-0030", 188, 500, 61),
    word("X", 359, 500, 8),
    word("2200-0200", 913, 500, 61),
    word("Nicole", 4, 522, 39),
    word("Watson", 46, 522, 46),
    word("-", 96, 522, 4),
    word("S", 104, 522, 7),
    word("0800-1200", 333, 522, 61),
  ];

  const parsed = parseScheduleTsv(rows.join("\n"), 90);

  assert.ok(parsed);
  assert.deepEqual(parsed.dates, [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
  ]);
  assert.deepEqual(
    parsed.shifts
      .filter((shift) => shift.worker === "David LaBarre" && shift.status === "working")
      .map(({ date, start, end }) => ({ date, start, end })),
    [
      { date: "2026-08-30", start: "20:30", end: "00:30" },
      { date: "2026-09-04", start: "22:00", end: "02:00" },
    ],
  );
  assert.equal(
    parsed.shifts.find(
      (shift) => shift.worker === "Nicole Watson" && shift.status === "working",
    )?.start,
    "08:00",
  );
  assert.deepEqual(
    parsed.flights.map((flight) => flight.raw),
    ["ACY 0353-F/0600 SRQ", "1000 SFB Airbus", "F In- SFB 1045 Boeing"],
  );
});

test("imports charter PDF text as tracked private flights", () => {
  const lines = [
    "GLOBALX | A321-231 | N570TA OMA ABE 200",
    "Inbound 09-17-26 OMA ABE 0430 0800 Terminal N/A",
    "Return 09-17-26 ABE OMA 1700 1855 Orbit box meal Terminal N/A",
    "CHRONO | 737-800 | CGCUA YVR ABE 189",
    "Inbound 09-16-26 YVR ABE 1000 1800 Terminal YVR Preclear",
    "Return 09-17-26 ABE YVR 1700 2000 Orbit box meal Terminal YVR Postclear",
  ];
  const items = lines.flatMap((line, lineIndex) =>
    line.split(" ").map((text, wordIndex) => ({
      text,
      x: wordIndex * 45,
      y: 500 - lineIndex * 20,
    })),
  );
  const parsed = parseCharterTextItems(items);

  assert.ok(parsed);
  assert.deepEqual(parsed.dates, ["2026-09-16", "2026-09-17"]);
  assert.equal(parsed.shifts.length, 0);
  assert.equal(parsed.flights.length, 4);
  assert.deepEqual(
    parsed.flights.map((flight) => ({
      kind: flight.kind,
      origin: flight.origin,
      destination: flight.destination,
      trackingId: flight.trackingId,
      source: flight.source,
    })),
    [
      {
        kind: "arrival",
        origin: "OMA",
        destination: "ABE",
        trackingId: "N570TA",
        source: "charter",
      },
      {
        kind: "departure",
        origin: "ABE",
        destination: "OMA",
        trackingId: "N570TA",
        source: "charter",
      },
      {
        kind: "arrival",
        origin: "YVR",
        destination: "ABE",
        trackingId: "C-GCUA",
        source: "charter",
      },
      {
        kind: "departure",
        origin: "ABE",
        destination: "YVR",
        trackingId: "C-GCUA",
        source: "charter",
      },
    ],
  );
  assert.equal(normalizeFlightAwareIdent("CGCUA"), "C-GCUA");
});

test("merges the Labare misspelling into David LaBarre", () => {
  assert.equal(canonicalSchedulePersonName("David Labare"), "David LaBarre");
  assert.equal(
    resolveSchedulePersonName("David Labare", ["David Labare", "David LaBarre"]),
    "David LaBarre",
  );
  assert.deepEqual(
    canonicalizeScheduleShifts([
      {
        id: "old-misspelled-id",
        date: "2026-09-16",
        worker: "David Labare",
        start: "08:00",
        end: "16:00",
        status: "working",
      },
      {
        id: "old-correct-id",
        date: "2026-09-16",
        worker: "David LaBarre",
        start: "08:00",
        end: "16:00",
        status: "working",
      },
    ]),
    [
      {
        id: "2026-09-16-David LaBarre-08:00",
        date: "2026-09-16",
        worker: "David LaBarre",
        start: "08:00",
        end: "16:00",
        status: "working",
      },
    ],
  );
});
