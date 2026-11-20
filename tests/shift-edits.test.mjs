import assert from "node:assert/strict";
import test from "node:test";
import { applyEventEdit, applyFix, fixesFor, newerEdits, pruneEdits } from "../app/shift-edits.ts";
import { merge, stamp, values } from "../app/vault-data.ts";

const event = (date, start, title = "Work") => ({ id: `${date}-x-${start}`, calendarKey: `k-${date}`, date, start, end: "15:30", title });
const shift = (date, worker, start, id = `${date}-${worker}-${start}`) => ({ id, date, worker, start, end: "15:30", status: "working" });
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

test("a day's record replaces that day's shift, or clears it", () => {
  const events = [event("2026-11-20", "07:00"), event("2026-11-21", "07:00")];
  const moved = applyEventEdit(events, "2026-11-21", { at: 5, event: event("2026-11-21", "13:30") });
  assert.deepEqual(moved.map((item) => `${item.date} ${item.start}`), ["2026-11-20 07:00", "2026-11-21 13:30"]);
  assert.deepEqual(applyEventEdit(moved, "2026-11-20", { at: 6, event: null }).map((item) => item.date), ["2026-11-21"]);
  // A shift added on a day off.
  assert.equal(applyEventEdit([], "2026-11-22", { at: 7, event: event("2026-11-22", "09:00") }).length, 1);
});

test("fixes to a photo apply once, whichever order", () => {
  const shifts = [shift("2026-11-20", "David LaBarre", "07:00"), shift("2026-11-20", "Other Guy", "06:00")];
  const changed = { hash: "h", fromId: shifts[0].id, shift: shift("2026-11-20", "David LaBarre", "08:00"), adding: false };
  const once = applyFix(shifts, changed, same);
  assert.equal(once.find((item) => item.worker === "David LaBarre").start, "08:00");
  assert.deepEqual(applyFix(once, changed, same), once);
  // Adding one the scan missed takes the place of that day's "off" for you.
  const added = { hash: "h", fromId: "x", shift: shift("2026-11-21", "David LaBarre", "09:00", "2026-11-21-David LaBarre-added"), adding: true };
  const off = [...shifts, { ...shift("2026-11-21", "david labarre", "00:00"), status: "off" }];
  const result = applyFix(off, added, same);
  assert.deepEqual(result.filter((item) => item.date === "2026-11-21").map((item) => item.start), ["09:00"]);
  assert.deepEqual(applyFix(result, added, same), result);
  assert.deepEqual(fixesFor({ a: { at: 2, event: null, fix: added }, b: { at: 1, event: null, fix: changed }, c: { at: 3, event: null } }, "h"), [changed, added]);
});

test("only newer, different records from another device are applied", () => {
  const local = { "2026-11-20": { at: 10, event: event("2026-11-20", "07:00") } };
  const incoming = {
    "2026-11-20": { at: 5, event: event("2026-11-20", "06:00") }, // older than this device's
    "2026-11-21": { at: 12, event: null },
  };
  assert.deepEqual(newerEdits(local, incoming), ["2026-11-21"]);
  assert.deepEqual(newerEdits(local, { "2026-11-20": local["2026-11-20"] }), []);
});

test("edits from two devices meet in the vault; the later one for a day wins", () => {
  const phone = stamp({}, { edit: { "2026-11-20": { at: 100, event: event("2026-11-20", "07:00") } } }, 100);
  const ipad = stamp({}, { edit: { "2026-11-20": { at: 200, event: null }, "2026-11-22": { at: 200, event: event("2026-11-22", "09:00") } } }, 200);
  const both = values(merge(phone, ipad), "edit");
  assert.equal(both["2026-11-20"].event, null);
  assert.ok(both["2026-11-22"].event);
});

test("old days are forgotten", () => {
  const kept = pruneEdits({ "2026-01-01": { at: 1, event: null }, "2026-11-01": { at: 2, event: null } }, "2026-11-20");
  assert.deepEqual(Object.keys(kept), ["2026-11-01"]);
});
