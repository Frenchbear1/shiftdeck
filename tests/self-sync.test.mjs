import assert from "node:assert/strict";
import test from "node:test";
import { toSend, wanted } from "../app/self-sync.ts";
import { mergeState } from "../worker/synced-state.ts";

const week = (start) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${start}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const sameWeek = (a, b) => a[0] === b[0];

test("sends recent schedules your other phones don't have", () => {
  const documents = [
    { id: "a", hash: "aaaa", name: "a", dates: week("2026-11-15") },
    { id: "b", hash: "bbbb", name: "b", dates: week("2026-11-22") },
    { id: "c", hash: "cccc", name: "c", dates: week("2026-09-06") }, // too old
  ];
  const posts = [{ id: "p", shareId: "s", what: "", hashes: ["aaaa"], createdAt: "", expiresAt: "" }];
  assert.deepEqual(toSend(documents, posts, "2026-11-19").map((document) => document.id), ["b"]);
});

test("takes what's new, not a photo it has or a week it has newer", () => {
  const local = [
    { hash: "aaaa", dates: week("2026-11-15"), updatedAt: "2026-11-19T10:00:00Z" },
    { hash: "zzzz", dates: week("2026-11-22"), updatedAt: "2026-11-19T12:00:00Z" },
  ];
  const take = wanted(["aaaa", "bbbb", "cccc"], [week("2026-11-15"), week("2026-11-22"), week("2026-11-29")],
    "2026-11-19T11:00:00Z", local, sameWeek);
  assert.deepEqual(take, [false, false, true]);
  // A newer copy from the other phone replaces an older one here.
  assert.deepEqual(wanted(["bbbb"], [week("2026-11-22")], "2026-11-19T13:00:00Z", local, sameWeek), [true]);
});

test("merges what each phone dealt with", () => {
  const merged = mergeState({ dismissed: ["a", "b"], seen: ["a"], alerts: [] }, { dismissed: ["b", "c"], seen: [42, "x"], alerts: ["Runway closed"], extra: [1] });
  assert.deepEqual(merged, { dismissed: ["a", "b", "c"], seen: ["a", "x"], alerts: ["Runway closed"] });
  const many = mergeState({ dismissed: [], seen: [], alerts: [] }, { dismissed: Array.from({ length: 500 }, (_, i) => `p${i}`) });
  assert.equal(many.dismissed.length, 400);
  assert.equal(many.dismissed.at(-1), "p499");
});
