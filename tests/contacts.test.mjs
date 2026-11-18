import assert from "node:assert/strict";
import test from "node:test";

import {
  emailLink,
  formatPhone,
  matchContact,
  matchWorker,
  matchWorkerByEmail,
  parseListScreenshotText,
  mergeContacts,
  parseContactLines,
  swapMessage,
  textLink,
} from "../app/contacts-data.ts";

test("reads a pasted list in any order and skips header lines", () => {
  const entries = parseContactLines([
    "Name, Email, Phone",
    "Landon Weber, Landon@Example.com, (610) 555-1234",
    "nicole watson\t484.555.9876",
    "jared@example.com Jared Plank",
    "",
  ].join("\n"));
  assert.deepEqual(entries, [
    { name: "Landon Weber", email: "landon@example.com", phone: "6105551234" },
    { name: "nicole watson", phone: "4845559876" },
    { name: "Jared Plank", email: "jared@example.com" },
  ]);
});

test("matches contact names to the schedule, or asks when unclear", () => {
  const workers = ["Landon Weber", "Nicole Watson", "Kody Hermany", "Chris Williams", "Chris Wilson"];
  assert.equal(matchWorker("landon weber", workers), "Landon Weber");
  assert.equal(matchWorker("Weber, Landon", workers), "Landon Weber");
  assert.equal(matchWorker("Landon V Weber", workers), "Landon Weber");
  assert.equal(matchWorker("Watson Nicole", workers), "Nicole Watson");
  assert.equal(matchWorker("Cody Hermany", workers), "Kody Hermany");
  assert.equal(matchWorker("Nicole", workers), null);
  assert.equal(matchWorker("Jared Plank", workers), null);
});

test("saves new details without losing the other one", () => {
  const first = mergeContacts({}, [{ worker: "Landon Weber", email: "l@x.com" }]);
  const both = mergeContacts(first, [{ worker: "Landon Weber", phone: "6105551234" }]);
  assert.deepEqual(both, { landonweber: { email: "l@x.com", phone: "6105551234" } });
  assert.equal(formatPhone("6105551234"), "(610) 555-1234");
  assert.equal(formatPhone("+16105551234"), "(610) 555-1234");
});

test("writes a short prefilled swap request", () => {
  const message = swapMessage({
    to: "Landon Weber",
    from: "David LaBarre",
    give: { date: "2026-11-25", start: "17:00", end: "01:00" },
    take: { date: "2026-11-21", start: "12:00", end: "20:00" },
  });
  assert.equal(message.subject, "Shift swap? Wed, Nov 25");
  assert.equal(message.body, [
    "Hi Landon,",
    "Would you want to swap shifts?",
    "My shift you'd take:\nWed, Nov 25 · 5 PM–1 AM",
    "Your shift I'd take:\nSat, Nov 21 · 12 PM–8 PM",
    "Let me know!",
    "Thanks,\nDavid",
  ].join("\n\n"));
  assert.match(emailLink("l@x.com", message), /^mailto:l@x\.com\?subject=Shift%20swap/);
  assert.match(textLink("6105551234", "Hi", true), /^sms:6105551234&body=Hi$/);
  assert.match(textLink("6105551234", "Hi", false), /^sms:6105551234\?body=Hi$/);
});

test("reads a member-list screenshot where each email sits under the name", () => {
  const text = [
    "Members (4)",
    "Landon Weber",
    "lweber©abeairport.com",
    "Weber, Landon",
    "Nicole Watson Owner",
    "nwatson@abeairport.com",
    "Krystal Smith",
    "csmith-ramp ® abeairport.com",
    "Unrelated header",
  ].join("\n");
  const entries = parseListScreenshotText(text);
  assert.deepEqual(entries, [
    { name: "Landon Weber", email: "lweber@abeairport.com" },
    { name: "Nicole Watson", email: "nwatson@abeairport.com" },
    { name: "Krystal Smith", email: "csmith-ramp@abeairport.com" },
  ]);
});

test("uses the last name in the email when the name is misread", () => {
  const workers = ["Landon Weber", "Nicole Watson", "Crystal Smith", "Jacob Smith"];
  assert.equal(matchWorkerByEmail("lweber@abe.com", workers), "Landon Weber");
  assert.equal(matchWorkerByEmail("landon.weber@abe.com", workers), "Landon Weber");
  assert.equal(matchWorkerByEmail("csmith@abe.com", workers), "Crystal Smith");
  assert.equal(matchWorkerByEmail("smithj@abe.com", workers), "Jacob Smith");
  assert.equal(matchWorkerByEmail("smith@abe.com", workers), null);
  assert.equal(matchContact({ name: "Nlcole Wats0n", email: "nwatson@abe.com" }, workers), "Nicole Watson");
  assert.equal(matchContact({ name: "Krystal Smith", email: "csmith-ramp@abe.com" }, workers), "Crystal Smith");
});
