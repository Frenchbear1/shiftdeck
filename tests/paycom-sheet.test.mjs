import assert from "node:assert/strict";
import test from "node:test";
import { compareSheet, isFlag, parsePaycomSheet } from "../app/paycom-sheet.ts";
import { DEFAULT_SETTINGS } from "../app/time-clock.ts";

// The text pdf.js pulls from a Paycom Web Time Sheet, laid out as on the page
// (punch lines sit just above their day's label). Made-up punches.
const line = (y, ...pieces) => pieces.map(([x, text]) => ({ text, x, y, page: 1 }));
const items = [
  ...line(800, [300, "Web Time Sheet"]),
  ...line(780, [60, "Name"], [100, "EXAMPLE, PERSON"], [400, "Selected Pay Period"], [520, "11/08/2026 - 11/21/2026 (Current Period)"]),
  ...line(700, [150, "07:26 PM"], [200, "407-Unassig…"], [260, "12:53 AM"], [450, "5.50"], [490, "5.50"]),
  ...line(688, [40, "Sun 11/08"]),
  ...line(660, [150, "08:56 PM"], [200, "407-Unassig…"], [260, "12:23 AM"], [450, "3.75"], [490, "3.75"]),
  ...line(648, [40, "Mon 11/09"]),
  ...line(620, [40, "Tue 11/10"]),
  ...line(580, [150, "12:23 AM"], [200, "407-Unassig…"], [260, "03:23 AM"], [300, "08:56 PM"], [340, "407-Unassig…"], [380, "12:53 AM"], [450, "7.00"], [490, "7.00"]),
  ...line(568, [40, "Sun 11/15"]),
  ...line(540, [350, "Weekly Totals"], [450, "16.25"]),
  ...line(400, [400, "Pay Period Totals"], [480, "16.25"]),
];

test("reads a Paycom time sheet", () => {
  const sheet = parsePaycomSheet(items, new Date("2026-11-19T23:00:00Z"));
  assert.equal(sheet.start, "2026-11-08");
  assert.equal(sheet.end, "2026-11-21");
  assert.equal(sheet.total, 16.25);
  assert.deepEqual(sheet.rows.map((row) => [row.date, row.pairs.map((pair) => `${pair.in}-${pair.out}`).join(","), row.hours]), [
    ["2026-11-08", "19:26-00:53", 5.5],
    ["2026-11-09", "20:56-00:23", 3.75],
    ["2026-11-15", "00:23-03:23,20:56-00:53", 7],
  ]);
  assert.equal(parsePaycomSheet(line(10, [0, "Some other PDF"])), null);
});

test("flags what doesn't line up", () => {
  const sheet = parsePaycomSheet(items, new Date("2026-11-20T23:00:00Z"));
  const at = (day, time) => new Date(`${day}T${time}:00`).toISOString();
  const mine = [
    { id: "a", in: at("2026-11-08", "19:27"), out: at("2026-11-09", "00:53") }, // same once rounded
    { id: "b", in: at("2026-11-18", "21:00"), out: at("2026-11-19", "00:30") }, // not on Paycom
  ];
  const kinds = compareSheet(sheet, mine, DEFAULT_SETTINGS).map((check) => check.kind);
  // Mon 11/09: Paycom says 3.75 h, but 9:00 PM – 12:30 AM is 3.50.
  assert.deepEqual(kinds, ["paycom-math", "not-on-paycom", "missing-here", "missing-here", "missing-here", "rounds-same"]);
  assert.equal(compareSheet(sheet, mine, DEFAULT_SETTINGS).filter(isFlag).length, 2);
});
