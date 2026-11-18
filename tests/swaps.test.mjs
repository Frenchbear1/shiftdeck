import assert from "node:assert/strict";
import test from "node:test";

import { answerNotification, answerPage, readSwapRequest, swapExpiry } from "../worker/swap-data.ts";
import { mergeSwapStatuses } from "../app/swap-requests.ts";
import { swapMessage } from "../app/contacts-data.ts";

const give = { date: "2026-11-25", start: "17:00", end: "01:00" };
const take = { date: "2026-11-21", start: "12:00", end: "20:00" };

test("keeps only first names and valid shifts from a new request", () => {
  const input = readSwapRequest({
    id: "abcdEFGH1234ijklMNOP", token: "tokTOK1234567890tokTOK",
    from: "David LaBarre", to: "Landon <b>Weber</b>", give, take,
  });
  assert.deepEqual(input, { id: "abcdEFGH1234ijklMNOP", token: "tokTOK1234567890tokTOK", from: "David", to: "Landon", give, take });
  assert.equal(readSwapRequest({ id: "short", token: "x", to: "A", give }), null);
  assert.equal(readSwapRequest({ id: "abcdEFGH1234ijklMNOP", token: "tokTOK1234567890tokTOK", to: "A", give: { ...give, start: "25:00" } }), null);
  assert.equal(swapExpiry({ give, take }), "2026-11-27T12:00:00.000Z");
});

test("the answer page escapes names and posts the choice", () => {
  const row = {
    id: "abcdEFGH1234ijklMNOP", from_name: "D<script>", to_name: "Landon",
    give_date: give.date, give_start: give.start, give_end: give.end,
    take_date: take.date, take_start: take.start, take_end: take.end, status: "waiting", answered_at: null,
  };
  const page = answerPage(row);
  assert.ok(!page.includes("<script>"));
  assert.match(page, /D&lt;script&gt; would like to swap shifts with you/);
  assert.match(page, /Wed, Nov 25 · 5 PM–1 AM/);
  assert.match(page, /<form method="post">/);
  assert.match(answerPage({ ...row, status: "yes" }, true), /Thanks! You answered <b>Works for me<\/b>/);
  assert.equal(answerNotification({ ...row, status: "yes" }).title, "Landon said yes to your swap");
});

test("new answers show as unseen, and the message carries the answer link", () => {
  const swaps = [{ id: "a", token: "t", worker: "Landon Weber", give, take, sentAt: "", status: "waiting", seen: true }];
  const next = mergeSwapStatuses(swaps, new Map([["a", { status: "yes", answeredAt: "x" }]]));
  assert.equal(next[0].status, "yes");
  assert.equal(next[0].seen, false);
  assert.equal(mergeSwapStatuses(next, new Map([["a", { status: "yes" }]])), next);
  const message = swapMessage({ to: "Landon Weber", from: "David LaBarre", give, take, link: "https://x/swap/abc" });
  assert.match(message.body, /Tap to answer: https:\/\/x\/swap\/abc\n– David$/);
});
