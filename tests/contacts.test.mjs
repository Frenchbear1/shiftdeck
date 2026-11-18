import assert from "node:assert/strict";
import test from "node:test";

import {
  emailLink,
  formatPhone,
  matchWorker,
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
    "Hi Landon, would you want to swap shifts?",
    "You'd take my Wed, Nov 25 (5 PM–1 AM) and I'd take your Sat, Nov 21 (12 PM–8 PM).",
    "Let me know!",
    "– David",
  ].join("\n"));
  assert.match(emailLink("l@x.com", message), /^mailto:l@x\.com\?subject=Shift%20swap/);
  assert.match(textLink("6105551234", "Hi", true), /^sms:6105551234&body=Hi$/);
  assert.match(textLink("6105551234", "Hi", false), /^sms:6105551234\?body=Hi$/);
});
