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

test("uses a durable Apple Calendar subscription with revision-aware events", async () => {
  const [page, css, hosting, service, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../worker/calendar-service.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0000_shiftdeck_calendar.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /createCalendarFeed/);
  assert.match(page, /syncCalendarFeed/);
  assert.match(page, /shiftdeck\.calendarSubscription/);
  assert.match(page, /window\.location\.href = syncedSubscription\.feedUrl/);
  assert.match(page, /"webcal:"/);
  assert.doesNotMatch(page, /anchor\.download|Shiftdeck_Schedule\.ics/);

  assert.match(service, /UID:\$\{uidFor\(feed\.id, event\.event_key\)\}/);
  assert.match(service, /SEQUENCE:\$\{event\.sequence\}/);
  assert.match(service, /"CANCELLED" : "CONFIRMED"/);
  assert.match(service, /Revised \$\{sequence\}/);
  assert.match(service, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  assert.match(service, /write_token_hash/);
  assert.match(page, /Subscribe in Apple Calendar/);
  assert.match(page, /aria-label="Subscribe in Apple Calendar"/);
  assert.match(page, />Title</);
  assert.match(page, />Place</);
  assert.match(page, />Reminder 1</);
  assert.match(page, />Reminder 2</);
  assert.match(page, /value: "P1W", label: "1 week before"/);
  assert.match(service, /new Set\(\[feed\.reminder1, feed\.reminder2\]/);
  assert.match(page, /aria-label="Add a shift"/);
  assert.match(page, /aria-label="Edit this shift"/);
  assert.match(page, /shiftdeck\.events/);
  assert.match(page, />Appearance</);
  assert.doesNotMatch(page, /compact-shift-list|Check before export|Your shifts|Toggle theme/);
  assert.match(css, /grid-auto-columns: calc\(\(100% - 32px\) \/ 5\)/);
  assert.match(page, /Automatic updates on/);

  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS calendar_feeds/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS calendar_events/);
});
