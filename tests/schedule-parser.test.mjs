import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSchedulePersonName,
  canonicalizeScheduleShifts,
  mergeScheduleParses,
  parseScheduleTsv,
  resolveSchedulePersonName,
  scanConfidence,
  SCHEDULE_PARSER_VERSION,
} from "../app/schedule-parser.ts";
import {
  normalizeFlightAwareIdent,
  parseCharterTextItems,
} from "../app/charter-parser.ts";

import { scanSweepDelays } from "../app/scan-annotations.ts";

const word = (text, x, y, width = Math.max(8, text.length * 6), height = 10) =>
  [5, 1, 1, 1, 1, 1, x, y, width, height, 90, text].join("\t");

test("imports the employee grid when a document date precedes the seven-day header", () => {
  assert.equal(SCHEDULE_PARSER_VERSION, 6);
  const rows = [
    [1, 1, 0, 0, 0, 0, 0, 0, 1200, 650, -1, ""].join("\t"),
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
  const source = parsed.sourceLayout;
  assert.ok(source);
  assert.equal(source.width, 1200);
  assert.ok(source.header.top < 327 && source.header.bottom > 340);
  assert.ok(source.left <= 4 && source.right > 188 + 6 * 145 + 61);
  const davidRow = source.rows.find((row) => row.name === "David LaBarre");
  const nicoleRow = source.rows.find((row) => row.name === "Nicole Watson");
  assert.ok(davidRow.top < 500 && davidRow.bottom > 510);
  assert.ok(davidRow.bottom < nicoleRow.top);

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

test("publishes truthful scan geometry and leaves empty shift cells unmarked", () => {
  const rows = [
    [1, 1, 0, 0, 0, 0, 0, 0, 1200, 650, -1, ""].join("\t"),
    ...Array.from({ length: 7 }, (_, i) => word(`11/${15 + i}/2026`, 188 + i * 145, 327, 61, 13)),
    word("David", 4, 500, 33),
    word("LaBarre", 42, 500, 44),
    word("0800-1700", 188, 500, 65),
    word("0730-1630", 333, 500, 65).replace("\t90\t", "\t63\t"),
    word("08?0-?", 478, 500, 55),
    word("OFF", 623, 500, 25),
  ];
  let preview;
  const parsed = parseScheduleTsv(rows.join("\n"), 90, (geometry) => { preview = geometry; });
  assert.equal(parsed.shifts.filter((shift) => shift.status === "working").length, 2);
  const marks = new Map(preview.marks.map((mark) => [mark.id, mark]));
  assert.equal(preview.width, 1200);
  assert.equal(preview.workerRows[0].name, "David LaBarre");
  assert.ok(preview.dateHeader);
  assert.equal(scanConfidence(marks.get("shift:David LaBarre:2026-11-15")), "confident");
  assert.equal(scanConfidence(marks.get("shift:David LaBarre:2026-11-16")), "check");
  assert.equal(scanConfidence(marks.get("shift:David LaBarre:2026-11-17")), "unreadable");
  assert.equal(scanConfidence(marks.get("shift:David LaBarre:2026-11-18")), "confident");
  assert.equal(marks.has("shift:David LaBarre:2026-11-19"), false);
  assert.equal(marks.get("shift:David LaBarre:2026-11-16").x, 333);

  const noWeek = parseScheduleTsv([rows[0], rows[8]].join("\n"), 90,
    (geometry) => { preview = geometry; });
  assert.equal(noWeek, null);
  assert.equal(preview.marks[0].text, "David");
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

test("keeps readable charter legs when the aircraft header is not recognized", () => {
  const line = "Inbound 09-17-26 OMA ABE 0430 0800 Terminal N/A";
  const items = line.split(" ").map((text, index) => ({
    text,
    x: index * 45,
    y: 500,
  }));

  const parsed = parseCharterTextItems(items);

  assert.ok(parsed);
  assert.equal(parsed.flights.length, 1);
  assert.equal(parsed.flights[0].origin, "OMA");
  assert.equal(parsed.flights[0].arrival, "08:00");
  assert.equal(parsed.flights[0].trackingId, undefined);
  assert.match(parsed.warnings.join(" "), /readable flight times were imported/i);
});

test("accepts readable flights even when no work-hour cells are recognized", () => {
  const rows = [
    word("Morning", 4, 180, 50),
    word("ACY 0353/0600 SRQ", 160, 200, 120),
    ...[
      "8/30/2026",
      "8/31/2026",
      "9/1/2026",
      "9/2/2026",
      "9/3/2026",
      "9/4/2026",
      "9/5/2026",
    ].map((date, index) => word(date, 188 + index * 145, 327, 61, 13)),
  ];

  const parsed = parseScheduleTsv(rows.join("\n"), 90);

  assert.ok(parsed);
  assert.equal(parsed.shifts.length, 0);
  assert.equal(parsed.flights.length, 1);
  assert.match(parsed.warnings.join(" "), /only the readable flights were imported/i);
});

test("combines complementary details from multiple OCR passes", () => {
  const dates = [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
  ];
  const first = {
    dates,
    shifts: [{
      id: "first",
      date: dates[0],
      worker: "David LaBarre",
      start: "20:30",
      end: "00:30",
      status: "working",
    }],
    flights: [],
    confidence: 88,
    warnings: [],
  };
  const second = {
    dates,
    shifts: [{
      id: "second",
      date: dates[1],
      worker: "David LaBarre",
      start: "21:00",
      end: "01:00",
      status: "working",
    }],
    flights: [{
      id: "flight",
      date: dates[1],
      period: "Morning",
      kind: "turnaround",
      raw: "ACY 0353/0600 SRQ",
      origin: "ACY",
      destination: "SRQ",
      inboundAirport: "ACY",
      outboundAirport: "SRQ",
      arrival: "03:53",
      departure: "06:00",
      start: "03:53",
      end: "06:00",
    }],
    confidence: 74,
    warnings: [],
  };

  const parsed = mergeScheduleParses([first, second]);

  assert.ok(parsed);
  assert.equal(parsed.shifts.filter((shift) => shift.status === "working").length, 2);
  assert.equal(parsed.flights.length, 1);
  assert.match(parsed.warnings.join(" "), /several scans/i);
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

test("reveals OCR marks from the top left through the last row", () => {
  const marks = [
    { id: "bottom-right", x: 200, y: 30, height: 10 },
    { id: "top-right", x: 200, y: 5, height: 10 },
    { id: "top-left", x: 10, y: 6, height: 11 },
    { id: "bottom-left", x: 10, y: 30, height: 10 },
  ];
  const ordered = scanSweepDelays(marks);
  assert.deepEqual([...ordered.keys()], ["top-left", "top-right", "bottom-left", "bottom-right"]);
  assert.equal(ordered.get("top-left"), 0);
  assert.ok(ordered.get("bottom-right") > ordered.get("top-right"));
  const many = Array.from({ length: 700 }, (_, index) => ({ id: index, x: index, y: index, height: 10 }));
  assert.ok(Math.max(...scanSweepDelays(many).values()) <= 730);
});

/* ---------- names: misreads, clipped letters, glued rows ---------- */

const week = (rows) => [
  [1, 1, 0, 0, 0, 0, 0, 0, 1200, 650, -1, ""].join("\t"),
  ...["11/22/2026", "11/23/2026", "11/24/2026", "11/25/2026", "11/26/2026", "11/27/2026", "11/28/2026"]
    .map((date, index) => word(date, 188 + index * 145, 100, 61, 13)),
  ...rows,
].join("\n");

test("two rows read as one, with the words glued together, come apart", async () => {
  const { splitGluedWords } = await import("../app/schedule-parser.ts");
  assert.equal(splitGluedWords("kodyWermany"), "kody Wermany");
  assert.equal(splitGluedWords("DevinBaver"), "Devin Baver");
  assert.equal(splitGluedWords("LaBarre"), "LaBarre", "real name prefixes stay");
  assert.equal(splitGluedWords("LeCompte"), "LeCompte");
  assert.equal(splitGluedWords("McDonald"), "McDonald");
  assert.equal(splitGluedWords("MacDonald"), "MacDonald");

  // Kody's and Devin's rows sit so close the reader groups them; their words are stacked.
  const parsed = parseScheduleTsv(week([
    word("kodyHermany", 4, 300, 70, 10),
    word("1900-0000", 188, 300, 61),
    word("DevinBauer", 4, 307, 64, 10),
    word("1300-1300", 188, 307, 61),
  ]), 90);
  const names = [...new Set(parsed.shifts.map((shift) => shift.worker))];
  assert.deepEqual(names.sort(), ["Devin Bauer", "Kody Hermany"]);
});

test("the line under the dates and notes after names aren't people", () => {
  const parsed = parseScheduleTsv(week([
    word("*Subject", 4, 120, 50), word("to", 58, 120, 12), word("Change*", 74, 120, 48),
    ...["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => word(day, 200 + index * 145, 120, 22)),
    word("Dawn", 4, 200, 30), word("Smith", 38, 200, 32), word("Deice", 74, 200, 32), word("1130-1430", 478, 200, 61),
    word("Crystal", 4, 230, 42), word("Smith-S", 50, 230, 46), word("0800-1200", 188, 230, 61),
    word("Antonio", 4, 260, 44), word("lannelli", 52, 260, 46), word("0400-0900", 188, 260, 61),
  ]), 90);
  const names = [...new Set(parsed.shifts.map((shift) => shift.worker))].sort();
  assert.deepEqual(names, ["Antonio Iannelli", "Crystal Smith", "Dawn Smith"]);
});

test("readings of one person from different passes and weeks become one name", async () => {
  const { isLikelySamePerson, canonicalWorkerNames, tidyScheduleShifts } = await import("../app/schedule-parser.ts");
  for (const [a, b] of [
    ["Ody Hermany", "Kody Hermany"], ["Ohn Snyder", "John Snyder"], ["Ctoria Touma", "Victoria Touma"],
    ["Chael Smith", "Machael Smith"], ["Ed Plank", "Jared Plank"], ["Devin Baver", "Devin Bauer"],
    ["Benjamin Iller", "Benjamin Piller"], ["Christopher Will", "Christopher Williams"],
    ["Christopher Ris Williams", "Christopher Williams"], ["Letrane Steidle", "Coletrane Steidle"],
    ["Jaden Rush", "Jayden Rush"], ["Ua Delgado", "Juan Delgado"],
  ]) assert.ok(isLikelySamePerson(a, b), `${a} = ${b}`);
  for (const [a, b] of [
    ["Dawn Smith", "Crystal Smith"], ["Dawn Smith", "Machael Smith"], ["Jason Hudak", "Jacob Hoffert"],
    ["Jared Plank", "Landon Weber"], ["Jeffrey LeCompte", "Jeffrey Porter"], ["Jude Khouri", "Juan Delgado"],
    ["Kenneth Swain", "Kody Hermany"],
  ]) assert.ok(!isLikelySamePerson(a, b), `${a} ≠ ${b}`);

  const map = canonicalWorkerNames([
    { name: "Ody Hermany", weight: 5 }, { name: "Kody Hermany", weight: 2 },
    { name: "Devin Baver", weight: 1 }, { name: "Devin Bauer", weight: 9 },
  ]);
  assert.equal(map.get("Ody Hermany"), "Kody Hermany", "the most complete reading wins");
  assert.equal(map.get("Devin Baver"), "Devin Bauer", "then the most common");

  const shift = (date, worker, start = "") => ({ id: `${date}-${worker}`, date, worker, start, end: start ? "20:00" : "", status: start ? "working" : "off" });
  const tidy = tidyScheduleShifts([
    shift("2026-11-22", "Kody Hermany", "19:00"), shift("2026-11-23", "Ody Hermany", "14:00"),
    shift("2026-11-22", "Devin Bauer", "13:00"),
    shift("2026-11-22", "Kody Wermany Devin Baver", "19:00"),
    shift("2026-11-23", "kodyWermany DevinBaver", "14:00"),
    shift("2026-11-22", "David LaBarre", "20:00"),
  ], ["David LaBarre"]);
  assert.deepEqual([...new Set(tidy.map((item) => item.worker))].sort(), ["David LaBarre", "Devin Bauer", "Kody Hermany"]);
  assert.equal(tidy.filter((item) => item.worker === "Kody Hermany").length, 2);
});

test("goodbye and first-day notes in a row are kept", () => {
  const parsed = parseScheduleTsv(week([
    word("Matthew", 4, 300, 44), word("Finelli", 52, 300, 40),
    word("1300-1600", 188, 300, 61), word("0900-1200", 333, 300, 61), word("1430-1830", 478, 300, 61),
    word("GOOD", 623, 300, 30), word("BYE", 768, 300, 22), word("GOOD", 913, 300, 30), word("LUCK!", 1058, 300, 34),
    word("Juan", 4, 330, 28), word("Delgado", 36, 330, 46),
    word("1230-1630", 600, 330, 50), word("First", 655, 330, 24), word("Day", 683, 330, 18),
  ]), 90);
  const notes = parsed.shifts.filter((shift) => shift.note).map((shift) => `${shift.worker} ${shift.date} ${shift.note}`);
  assert.deepEqual(notes, [
    "Matthew Finelli 2026-11-25 GOOD", "Matthew Finelli 2026-11-26 BYE", "Matthew Finelli 2026-11-27 GOOD",
    "Matthew Finelli 2026-11-28 LUCK!", "Juan Delgado 2026-11-25 FIRST DAY",
  ]);
});
