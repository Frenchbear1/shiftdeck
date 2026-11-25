import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseDirectory, smartCase } from "../app/directory-data.ts";
import { parseListPage } from "../app/directory-lists.ts";

/*
 * OCR output (Tesseract, sparse mode, as the app runs it) of printed phone
 * lists photographed at an angle: dot-leader lists under headings, a
 * two-column page, a bordered airline grid, a hotel table and a
 * company/contact table. Numbers are made up; "truth" is what was printed.
 * "heldOut" is a second set rendered with different numbers, tilt and type
 * size that the parser wasn't tuned on.
 */
const pages = JSON.parse(fs.readFileSync(new URL("./fixtures/directory-pages.json", import.meta.url), "utf8"));
const wordsOf = (page) => page.words.map(([text, x, y, width, height, conf]) => ({ text, x, y, width, height, conf }));
const digits = (value) => {
  const number = (value ?? "").replace(/\D/g, "");
  return number.length === 11 && number.startsWith("1") ? number.slice(1) : number;
};
const norm = (value) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function score(set) {
  let total = 0, numbers = 0, labels = 0;
  for (const page of Object.values(set)) {
    const entries = parseListPage(wordsOf(page), 0, (text) => smartCase(text));
    for (const [, label, number] of page.truth) {
      total += 1;
      const want = digits(number);
      const found = entries.find((entry) => [entry.phone, entry.ext, entry.cell].some((value) => value && digits(value).includes(want)) ||
        digits([entry.phone, entry.ext, entry.cell].join("")) === want);
      if (!found) continue;
      numbers += 1;
      if (norm(found.line).includes(norm(label)) || (norm(label).includes(norm(found.line)) && norm(found.line).length > 3)) labels += 1;
    }
  }
  return { numbers: numbers / total, labels: labels / total };
}

test("printed lists: the numbers and their labels are read", () => {
  const tuned = score(pages.synthetic);
  assert.ok(tuned.numbers >= 0.97, `numbers ${tuned.numbers}`);
  assert.ok(tuned.labels >= 0.95, `labels ${tuned.labels}`);
  const held = score(pages.heldOut);
  assert.ok(held.numbers >= 0.95, `held-out numbers ${held.numbers}`);
  assert.ok(held.labels >= 0.93, `held-out labels ${held.labels}`);
});

const read = (name) => parseListPage(wordsOf(pages.synthetic[name]), 0, (text) => smartCase(text));
const find = (entries, label) => entries.find((entry) => norm(entry.line) === norm(label));

test("headings file the lines under them, per column", () => {
  const list = read("list2");
  assert.equal(find(list, "Kitchen")?.department, "Fire Division");
  assert.equal(find(list, "QC Back Office")?.department, "Queen City Airport");
  // Two columns: the right column's heading doesn't leak left.
  const two = read("two");
  assert.equal(find(two, "Customs")?.department, "Tenants");
  assert.equal(find(two, "National/Alamo")?.department, "Car Rentals");
  // An indented "Baggage" belongs to the airline above it.
  assert.ok(two.some((entry) => entry.line === "Delta – Baggage"));
});

test("two extensions, a label with a number in it, long distance", () => {
  const list = read("list1");
  const truth = Object.fromEntries(pages.synthetic.list1.truth.map(([, label, number]) => [label, number]));
  const gate = find(list, "Gate 3 Ramp");
  assert.equal(digits([gate?.phone, gate?.ext].join("")), digits(truth["Gate 3 Ramp"]));
  const twoExt = pages.synthetic.list1.truth.find(([, , number]) => number.includes("/"));
  assert.equal(find(list, twoExt[1])?.ext, twoExt[2].replace("/", " / "));
});

test("tables: airline grid, company/contact list and hotels", () => {
  const grid = read("grid");
  assert.equal(find(grid, "Ticket Counter")?.department, "Allegiant");
  assert.ok(grid.find((entry) => entry.line === "Reservations" && entry.title?.includes("all calls regarding")));
  const contacts = read("contacts");
  assert.equal(find(contacts, "Susan Grant")?.department, "FAA/ATCT");
  // A row with the company left blank is the company above.
  assert.equal(find(contacts, "Jim Kane, Location Mgr")?.department, "Dollar/Thrifty");
  const hotels = read("hotels");
  assert.match(hotels[0].department ?? "", /Shuttle Service Information/);
  assert.ok(hotels.every((entry) => /^\d{3}-\d{3}-\d{4}$/.test(entry.phone ?? "")));
  // Shuttle hours ("0500–2300") are a note, not a number.
  assert.ok(hotels.some((entry) => /^\d{4}–\d{4}$/.test(entry.title ?? "")));
});

test("parseDirectory reads a printed list when there's no table header", () => {
  const entries = parseDirectory(wordsOf(pages.synthetic.list2).map((word) => ({ ...word, group: 0 })));
  assert.ok(entries.length >= 22);
  assert.ok(entries.every((entry) => entry.id && entry.line));
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
});
