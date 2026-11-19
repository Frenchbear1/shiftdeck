import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, federalWithholding, periodFor, periodTotals, punchHours, roundPunch } from "../app/time-clock.ts";

const at = (time) => new Date(`2026-11-19T${time}:00`);
const hhmm = (date) => date.toTimeString().slice(0, 5);

test("rounds punches to the nearest quarter hour", () => {
  assert.equal(hhmm(roundPunch(at("06:53"), 15)), "07:00");
  assert.equal(hhmm(roundPunch(at("06:52"), 15)), "06:45");
  assert.equal(hhmm(roundPunch(at("12:23"), 15)), "12:30");
  assert.equal(hhmm(roundPunch(at("12:22"), 15)), "12:15");
  assert.equal(hhmm(roundPunch(new Date("2026-11-19T23:53:41"), 15)), "00:00");
  assert.equal(hhmm(roundPunch(at("12:22"), 1)), "12:22");
});

test("counts hours across midnight from the rounded punches", () => {
  assert.equal(punchHours({ id: "a", in: "2026-11-19T20:53:00", out: "2026-11-20T00:37:00" }, 15), 3.5); // 9:00 PM – 12:30 AM
});

test("finds the pay period and payday", () => {
  assert.deepEqual(periodFor("2026-07-10", DEFAULT_SETTINGS), { start: "2026-07-05", end: "2026-07-18", payday: "2026-07-24" });
  assert.deepEqual(periodFor("2026-11-19", DEFAULT_SETTINGS), { start: "2026-11-08", end: "2026-11-21", payday: "2026-11-27" });
  assert.equal(periodFor("2026-11-07", DEFAULT_SETTINGS).payday, "2026-11-13");
});

test("withholds federal tax like the stubs", () => {
  assert.equal(federalWithholding(656.25, 16_100, 26), 3.7);
  assert.equal(federalWithholding(721.88, 16_100, 26), 10.27);
  assert.equal(federalWithholding(686.88, 16_100, 26), 6.77);
  assert.equal(federalWithholding(500, 16_100, 26), 0);
});

test("a period's pay matches a Paycom stub (within a cent a line)", () => {
  // 41.25 hours over two weeks: no overtime (under 40 in each week).
  // 5 × 4 h + 4 × 5 h + 1.25 h = 41.25 (the 11:57 / 11:58 punches round up to midnight).
  const punches = [
    ...["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((day, index) =>
      ({ id: `a${index}`, in: `${day}T20:00:00`, out: `${day}T23:57:00` })),
    ...["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"].map((day, index) =>
      ({ id: `b${index}`, in: `${day}T19:00:00`, out: `${day}T23:58:00` })),
    { id: "b4", in: "2026-11-19T20:00:00", out: "2026-11-19T21:15:00" },
  ];
  const totals = periodTotals(punches, periodFor("2026-11-10", DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(totals.hours, 41.25);
  assert.equal(totals.overtime, 0);
  assert.equal(totals.gross, 721.88);
  const stub = { federal: 10.27, medicare: 10.47, social: 44.76, state: 22.16, local: 11.55, lst: 2, ui: 0.51 };
  for (const tax of totals.taxes) assert.ok(Math.abs(tax.amount - stub[tax.id]) <= 0.011, `${tax.id} ${tax.amount}`);
  assert.ok(Math.abs(totals.taxTotal - 101.72) <= 0.02);
});

test("pays time and a half past 40 in a week", () => {
  const punches = ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((day, index) =>
    ({ id: `${index}`, in: `${day}T08:00:00`, out: `${day}T17:00:00` })); // 45 h in one week
  const totals = periodTotals(punches, periodFor("2026-11-10", DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(totals.regular, 40);
  assert.equal(totals.overtime, 5);
  assert.equal(totals.gross, 40 * 17.5 + 5 * 26.25);
});
