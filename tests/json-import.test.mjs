import assert from "node:assert/strict";
import test from "node:test";
import {
  COWORKERS_JSON_PROMPT,
  DIRECTORY_JSON_PROMPT,
  looksLikeJson,
  parseCoworkersJson,
  parseDirectoryJson,
} from "../app/json-import.ts";

const example = (prompt) => prompt.slice(prompt.indexOf("{"), prompt.indexOf("]}") + 2);

test("the examples in the AI formats read back", () => {
  const directory = parseDirectoryJson(example(DIRECTORY_JSON_PROMPT));
  assert.equal(directory.length, 2);
  assert.deepEqual(
    { first: directory[0].first, last: directory[0].last, phone: directory[0].phone, ext: directory[0].ext, cell: directory[0].cell },
    { first: "Dana", last: "Miller", phone: "610-555-1234", ext: "4021", cell: "484-555-9876" },
  );
  assert.equal(directory[1].line, "Ticket Counter");
  assert.equal(directory[1].ext, "4022 / 4023");
  assert.equal(directory[1].title, "only day-of-departure calls");
  const coworkers = parseCoworkersJson(example(COWORKERS_JSON_PROMPT));
  assert.deepEqual(coworkers[1], { name: "Nicole Watson", phone: "4845559876" });
});

test("an AI's answer with chat and a code fence around it", () => {
  const answer = 'Here you go!\n```json\n{"directory": [{"name": "Weber, Landon", "department": "Ramp", "cell": "(610) 555-1234"}]}\n```\nLet me know.';
  assert.ok(looksLikeJson("```json\n[]```"));
  const [entry] = parseDirectoryJson(answer);
  assert.equal(entry.first, "Landon");
  assert.equal(entry.last, "Weber");
  assert.equal(entry.cell, "610-555-1234");
  assert.ok(entry.id);
});

test("bare arrays, other key names, and entries with nothing to call are skipped", () => {
  const entries = parseDirectoryJson(JSON.stringify([
    { Label: "Fire Division Kitchen", Extension: "4021, 4022" },
    { line: "Board Room" },
    { First_Name: "Pat", "Last Name": "O'Brien", Mobile: "484 555 0000", Email: "PAT@EXAMPLE.COM" },
  ]));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].ext, "4021 / 4022");
  assert.equal(entries[1].email, "pat@example.com");
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 2);
  assert.deepEqual(parseCoworkersJson('{"people":[{"first":"Ann","last":"Lee","email":"ann@x.com"},{"name":"No Number"}]}'),
    [{ name: "Ann Lee", email: "ann@x.com" }]);
});

test("text that isn't JSON throws, so the app can say so", () => {
  assert.throws(() => parseDirectoryJson("{not json"));
  assert.throws(() => parseCoworkersJson("Landon Weber 610-555-1234"));
});
