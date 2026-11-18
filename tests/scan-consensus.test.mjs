import assert from "node:assert/strict";
import test from "node:test";

import { decideShiftTime, oneDigitApart, spokenTime } from "../app/scan-consensus.ts";
import { readCellDigits } from "../app/scan-consensus.ts";

const page = (start, end, weight = 0.9) => ({ start, end, weight, source: "page" });
const cell = (start, end, weight = 0.9) => ({ start, end, weight, source: "cell" });

test("trusts a time every read agrees on", () => {
  const verdict = decideShiftTime([page("17:00", "01:00"), page("17:00", "01:00", 0.7), cell("17:00", "01:00")]);
  assert.equal(verdict.level, "confident");
  assert.equal(verdict.end, "01:00");
  assert.equal(verdict.support, 3);
  assert.equal(verdict.note, "Read the same 3 ways");
});

test("a 1 misread as 2 is outvoted by the digits-only cell read and flagged when unclear", () => {
  const verdict = decideShiftTime([page("17:00", "02:00", 0.6), page("17:00", "01:00", 0.85), cell("17:00", "01:00", 0.9)]);
  assert.equal(verdict.end, "01:00");
  assert.equal(verdict.level, "confident");
  const split = decideShiftTime([page("17:00", "02:00", 0.7), cell("17:00", "01:00", 0.6)]);
  assert.equal(split.level, "check");
  assert.match(split.note, /Also read as/);
});

test("previous weeks break a tie but never overrule reads that agree", () => {
  const history = [
    { field: "start", value: "17:00", count: 3, from: "history" },
    { field: "end", value: "01:00", count: 3, from: "history" },
  ];
  const tie = decideShiftTime([page("17:00", "02:00", 0.7), page("17:00", "01:00", 0.7)], history);
  assert.equal(tie.end, "01:00");
  assert.equal(tie.level, "check");

  // Two reads say 2 AM, but this person always ends at 1 AM on this day.
  const slip = decideShiftTime([page("17:00", "02:00", 0.9), page("17:00", "02:00", 0.9)], history);
  assert.equal(slip.end, "02:00");
  assert.equal(slip.level, "check");
  assert.equal(slip.note, "Usually ends 1 AM on this day");

  // Three separate reads agreeing is taken as a real schedule change.
  const changed = decideShiftTime([page("17:00", "02:00"), page("17:00", "02:00"), cell("17:00", "02:00")], history);
  assert.equal(changed.level, "confident");
});

test("coworkers ending at the same time that day flag a one-digit slip", () => {
  const coworkers = [{ field: "end", value: "01:00", count: 4, from: "coworkers" }];
  const verdict = decideShiftTime([page("17:00", "02:00", 0.95)], coworkers);
  assert.equal(verdict.level, "check");
  assert.equal(verdict.note, "Coworkers end 1 AM that day");
  // A completely different shift isn't a misread.
  assert.equal(decideShiftTime([page("06:00", "14:30", 0.95)], coworkers).level, "confident");
});

test("flags impossible-looking times", () => {
  assert.equal(decideShiftTime([page("17:00", "01:07"), cell("17:00", "01:07")]).note, "Unusual minutes");
  assert.equal(decideShiftTime([page("17:00", "17:30"), cell("17:00", "17:30")]).note, "Unusual shift length");
  assert.equal(decideShiftTime([]), null);
});

test("reads digits-only cell text and ignores grid lines at the edges", () => {
  assert.deepEqual(readCellDigits("1700-0100"), { start: "17:00", end: "01:00" });
  assert.deepEqual(readCellDigits("11700-01001\n"), { start: "17:00", end: "01:00" });
  assert.deepEqual(readCellDigits("800 - 1630"), { start: "08:00", end: "16:30" });
  assert.equal(readCellDigits("1700"), null);
  assert.equal(readCellDigits("2500-0100"), null);
  assert.ok(oneDigitApart("01:00", "02:00"));
  assert.ok(!oneDigitApart("01:00", "02:30"));
  assert.equal(spokenTime("13:30"), "1:30 PM");
});
