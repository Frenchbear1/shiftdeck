import assert from "node:assert/strict";
import test from "node:test";
import { rosterStatuses, rosterLabel, weekOf } from "../app/roster-status.ts";

const day = (start, offset) => {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
/** One week's row: seven cells, each "HH:MM-HH:MM", "x" (off) or "x:NOTE" (off with a note). */
const row = (worker, sunday, cells) => cells.map((cell, index) => {
  const date = day(sunday, index);
  const [time, note] = cell.split(":").length === 2 && /^x/.test(cell) ? [null, cell.split(":")[1]] : [cell === "x" ? null : cell, undefined];
  return time
    ? { id: `${date}-${worker}`, date, worker, start: time.split("-")[0], end: time.split("-")[1], status: "working" }
    : { id: `${date}-${worker}`, date, worker, start: "", end: "", status: "off", ...(note ? { note } : {}) };
});
const steady = (worker, sunday) => row(worker, sunday, ["20:00-00:00", "20:00-00:30", "x", "x", "21:00-01:00", "x", "x"]);

test("weeks start on Sunday", () => {
  assert.equal(weekOf("2026-11-19"), "2026-11-15");
  assert.equal(weekOf("2026-11-15"), "2026-11-15");
});

test("a goodbye on the schedule means their last shift that week was their last day", () => {
  const shifts = [
    ...steady("David LaBarre", "2026-08-23"), ...steady("David LaBarre", "2026-08-30"), ...steady("David LaBarre", "2026-09-06"),
    ...steady("Matthew Finelli", "2026-08-23"),
    // "GOOD  BYE  GOOD  LUCK!" across his days off
    ...row("Matthew Finelli", "2026-08-30", ["13:00-16:00", "09:00-12:00", "14:30-18:30", "x:GOOD", "x:BYE", "x:GOOD", "x:LUCK!"]),
    ...steady("Raymond Cumberland", "2026-08-23"),
    ...row("Raymond Cumberland", "2026-08-30", ["x", "x", "x", "x", "x", "x", "11:30-16:00"]).map((shift, index) =>
      index === 6 ? { ...shift, note: "GOOD LUCK!" } : shift),
  ];
  const statuses = rosterStatuses(shifts, "2026-11-19");
  assert.deepEqual(statuses.get("Matthew Finelli"), { state: "left", lastDay: "2026-09-01", why: "note" });
  assert.deepEqual(statuses.get("Raymond Cumberland"), { state: "left", lastDay: "2026-09-05", why: "note" });
  assert.equal(statuses.get("David LaBarre").state, "current");
  // Leaving later this week, not gone yet.
  assert.deepEqual(rosterStatuses(shifts, "2026-08-31").get("Matthew Finelli"), { state: "leaving", lastDay: "2026-09-01", why: "note" });
  assert.equal(rosterLabel({ state: "leaving", lastDay: "2026-09-01", why: "note" }), "Last day Tue, Sep 1");
});

test("missing from the two schedules after their last week means they've left; one is just a gap", () => {
  const weeks = ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15"];
  const shifts = [
    ...weeks.flatMap((week) => steady("David LaBarre", week)),
    ...steady("Machael Smith", "2026-10-25"),
    ...steady("Landon Weber", "2026-10-25"), ...steady("Landon Weber", "2026-11-08"),
    ...steady("Jared Plank", "2026-10-25"), ...steady("Jared Plank", "2026-11-01"), ...steady("Jared Plank", "2026-11-08"),
  ];
  const statuses = rosterStatuses(shifts, "2026-11-19");
  assert.deepEqual(statuses.get("Machael Smith"), { state: "left", lastDay: "2026-10-29", why: "missing" });
  assert.equal(statuses.get("Jared Plank").state, "current", "missing from only the latest week");
  assert.equal(statuses.get("Landon Weber").state, "current", "came back after a week off the schedule");
});

test("new: on the latest schedule for the first time, or a 'First Day' note", () => {
  const shifts = [
    ...steady("David LaBarre", "2026-11-08"), ...steady("David LaBarre", "2026-11-15"),
    ...steady("Crystal Smith", "2026-11-15"),
    ...row("Juan Delgado", "2026-11-08", ["x", "x", "x", "12:30-16:30", "12:00-16:00", "x", "x"]).map((shift) =>
      shift.date === "2026-11-11" ? { ...shift, note: "FIRST DAY" } : shift),
    ...steady("Juan Delgado", "2026-11-15"),
  ];
  const statuses = rosterStatuses(shifts, "2026-11-19");
  assert.deepEqual(statuses.get("Crystal Smith"), { state: "new", firstDay: "2026-11-15" });
  assert.deepEqual(statuses.get("Juan Delgado"), { state: "new", firstDay: "2026-11-11" });
  assert.equal(rosterStatuses(steady("Crystal Smith", "2026-11-15"), "2026-11-19").get("Crystal Smith").state, "current",
    "everyone on your very first upload isn't 'new'");
});
