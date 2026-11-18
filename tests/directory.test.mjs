import assert from "node:assert/strict";
import test from "node:test";

import {
  applyKnownNames,
  applyNumberReread,
  callLink,
  mergeDirectory,
  parseDirectory,
  searchDirectory,
  smartCase,
} from "../app/directory-data.ts";

const word = (text, x, y, width = text.length * 7, height = 10, group = 0) => ({ text, x, y, width, height, group });
// Cell text, split into words that sit close together like OCR output.
const cell = (text, x, y) => {
  let at = x;
  return text.split(" ").map((part) => {
    const item = word(part, at, y);
    at += item.width + 4;
    return item;
  });
};

const COLUMNS = { last: 40, first: 165, department: 252, title: 515, phone: 797, ext: 905, cell: 947 };
const header = Object.entries({ LAST: 40, FIRST: 165, DEPARTMENT: 252, "[Time": 515, PHONE: 797, EXT: 905, CELL: 947 })
  .map(([text, x]) => word(text, x, 170));
const row = (y, values) => Object.entries(values).flatMap(([column, text]) => cell(text, COLUMNS[column], y));

test("reads the directory table, shared lines, headings and all-caps names", () => {
  const items = [
    word("PHONE", 530, 98), word("DIRECTORY", 580, 98), word("-", 650, 98), word("ADMINISTRATION", 660, 98),
    ...header,
    ...cell("AIRLINE SERVICES (SUPV OR LEAD ON DUTY)", 40, 189), word("484-426-8119", 797, 189),
    ...row(208, { last: "WEBER", first: "LANDON", department: "AIRLINE SERVICES", title: "RAMP SUPERVISOR", phone: "484-426-8120", ext: "2210", cell: "610-555-1234" }),
    ...row(227, { last: "MCDONALD", first: "SEAN", department: "TSA LIAISON", title: "TSA COORDINATOR", phone: "484.426.8310" }),
    ...cell("MAINTENANCE", 40, 246),
    ...row(265, { last: "O'BRIEN", first: "PAT", title: "MECHANIC", cell: "(610) 555-4444" }),
  ];
  const entries = parseDirectory(items).map(({ id, ...rest }) => (void id, rest));
  assert.deepEqual(entries, [
    { line: "Airline Services (Supv or Lead on Duty)", phone: "484-426-8119", department: "Airline Services" },
    { first: "Landon", last: "Weber", department: "Airline Services", title: "Ramp Supervisor", phone: "484-426-8120", ext: "2210", cell: "610-555-1234" },
    { first: "Sean", last: "McDonald", department: "TSA Liaison", title: "TSA Coordinator", phone: "484-426-8310" },
    { first: "Pat", last: "O'Brien", department: "Maintenance", title: "Mechanic", cell: "610-555-4444" },
  ]);
});

test("capitalizes properly and keeps the schedule's spelling", () => {
  assert.equal(smartCase("SMITH-JONES"), "Smith-Jones");
  assert.equal(smartCase("VP OF OPERATIONS AND ARFF"), "VP of Operations and ARFF");
  assert.equal(smartCase("Crystal"), "Crystal");
  assert.equal(smartCase("koDY", true), "Kody");
  const [fixed] = applyKnownNames([{ id: "x", first: "Aluison", last: "Osborne" }], ["Allison Osborne", "David LaBarre"]);
  assert.equal(fixed.first, "Allison");
  const [kept] = applyKnownNames([{ id: "y", first: "David", last: "Labarre" }], ["David LaBarre"]);
  assert.equal(kept.last, "LaBarre");
});

test("a digits-only re-read fixes a number and marks it to check", () => {
  const entry = { id: "a", line: "Airline Services", phone: "484-426-8110" };
  const fixed = applyNumberReread(entry, "phone", "484-426-81 19\n");
  assert.equal(fixed.phone, "484-426-8119");
  assert.deepEqual(fixed.check, ["phone"]);
  assert.equal(applyNumberReread(entry, "phone", "4"), entry);
  assert.equal(callLink("484-426-8120", "2210"), "tel:4844268120,2210");
});

test("merges imports, searches and filters by department", () => {
  const a = { id: "1", first: "Landon", last: "Weber", department: "Airline Services", phone: "484-426-8120" };
  const b = { id: "2", first: "Sean", last: "McDonald", department: "TSA Liaison", title: "TSA Coordinator" };
  const { entries, added, updated } = mergeDirectory([a], [{ ...a, id: "9", ext: "2210" }, b]);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.equal(entries[0].ext, "2210");
  assert.equal(entries[0].id, "1");
  assert.deepEqual(searchDirectory(entries, "coord", null).map((entry) => entry.id), ["2"]);
  assert.deepEqual(searchDirectory(entries, "8120", null).map((entry) => entry.id), ["1"]);
  assert.deepEqual(searchDirectory(entries, "", "Airline Services").map((entry) => entry.id), ["1"]);
});
