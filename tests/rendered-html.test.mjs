import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the blank Shiftdeck app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Shiftdeck/);
  assert.match(html, />Today</);
  assert.match(html, />Workers</);
  assert.match(html, />Flights</);
  assert.match(html, />Import</);
  assert.match(html, /Nothing imported/);
  assert.doesNotMatch(html, /Subscribed calendar/);
});

test("uses the Cycle Tracker download flow with revision-aware events", async () => {
  const [page, css, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /anchor\.download = "Shiftdeck_Schedule\.ics"/);
  assert.match(page, /document\.body\.appendChild\(anchor\)/);
  assert.match(page, /anchor\.click\(\)/);
  assert.doesNotMatch(page, /navigator\.share|syncCalendarFeed|CalendarFeed/);

  assert.match(page, /UID:\$\{calendarUid\(change\.calendarKey\)\}/);
  assert.match(page, /SEQUENCE:\$\{change\.revision\}/);
  assert.match(page, /STATUS:CANCELLED/);
  assert.match(page, /Revised \$\{revision\}/);
  assert.match(page, /shiftdeck\.calendarHistory/);
  assert.match(page, /Export to Apple Calendar/);
  assert.match(page, /aria-label="Export to Apple Calendar"/);
  assert.match(page, />Title</);
  assert.match(page, />Place</);
  assert.match(page, />Reminder 1</);
  assert.match(page, />Reminder 2</);
  assert.match(page, /value: "P1W", label: "1 week before"/);
  assert.match(page, /new Set\(\[prefs\.reminder1, prefs\.reminder2\]/);
  assert.match(page, /calendarReplayChanges/);
  assert.match(page, /aria-label="Add a shift"/);
  assert.match(page, /aria-label="Edit this shift"/);
  assert.match(page, /shiftdeck\.events/);
  assert.match(page, />Appearance</);
  assert.doesNotMatch(page, /compact-shift-list|Check before export|Your shifts|Toggle theme/);
  assert.match(css, /grid-auto-columns: calc\(\(100% - 32px\) \/ 5\)/);
  assert.doesNotMatch(page, /Subscribed calendar|Preferred calendar label/);

  assert.equal(JSON.parse(hosting).d1, null);
});
