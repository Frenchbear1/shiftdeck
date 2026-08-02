import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isPlausibleWorkerName,
  isScheduleRevision,
} from "../app/schedule-parser.ts";
import { renderAppleTimedAlarm } from "../worker/calendar-alarms.ts";
import {
  CALENDAR_FORMAT_VERSION,
  calendarSequenceFor,
} from "../worker/calendar-revisions.ts";
import { matchFlightAwareResult } from "../worker/flightaware.ts";
import { normalizeNotificationPayload } from "../worker/push-service.ts";

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
  assert.match(html, />References</);
  assert.match(html, /Nothing imported/);
  assert.match(html, /serviceWorker/);
  assert.match(html, /sw\.js/);
  assert.doesNotMatch(html, /Subscribed calendar/);
});

test("keeps Workers and Flights date navigation compact", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    page,
    /<h1>Workers<\/h1>[\s\S]{0,900}?selectedDate !== todayDate[\s\S]{0,500}?onClick=\{returnToToday\}[\s\S]{0,100}?>\s*Today/,
  );
  assert.match(
    page,
    /<h1>Flights<\/h1>[\s\S]{0,900}?selectedDate !== todayDate[\s\S]{0,500}?onClick=\{returnToToday\}[\s\S]{0,100}?>\s*Today/,
  );
  assert.match(css, /\.page-title-actions/);
  assert.match(page, /const workersDateRail = useRef<HTMLDivElement>\(null\)/);
  assert.match(page, /const flightsDateRail = useRef<HTMLDivElement>\(null\)/);
  assert.match(page, /activeTab === "workers"\s*\? workersDateRail\.current/);
  assert.match(page, /:\s*flightsDateRail\.current/);
  assert.match(page, /renderDateRail\(false, true, "workers"\)/);
  assert.match(page, /renderDateRail\(false, true, "flights"\)/);
  assert.match(page, /useLayoutEffect\(\(\) =>/);
  assert.match(page, /centerDateInRail\(rail, selectedDate, "auto"\)/);
  assert.match(page, /centerDateInRail\(rail, selectedDate, "smooth"\)/);
  assert.match(page, /pendingDateCenter\.current = \{ tab, date \}/);
  assert.match(
    page,
    /const selectDate = \(date: string\)[\s\S]{0,180}?tab === "home" \|\| tab === "workers" \|\| tab === "flights"[\s\S]{0,120}?pendingDateCenter\.current = \{ tab, date \}/,
  );
  assert.match(
    page,
    /const openTodayTab = \(\)[\s\S]{0,100}?pendingDateCenter\.current = null/,
  );
  assert.doesNotMatch(page, /hasCenteredHomeOnLaunch/);
  assert.doesNotMatch(
    page,
    /tab === "home" && selectedDate !== todayDate/,
  );
  assert.doesNotMatch(page, /<span>Showing<\/span>/);
  assert.doesNotMatch(page, /<span>During your shift<\/span>/);
  assert.doesNotMatch(css, /\.flight-summary/);
});

test("contains the desktop timeline grid inside the shift plot", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    page,
    /className="timeline-plot"[\s\S]{0,500}?className="timeline-grid"[\s\S]{0,500}?className="timeline-rows"/,
  );
  assert.match(css, /\.timeline-grid\s*\{[\s\S]{0,120}?inset:\s*0;/);
  assert.doesNotMatch(css, /inset:\s*98px 26px 26px 172px/);
});

test("protects work references behind owner-approved device access", async () => {
  const [page, css, references, service, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/reference-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/reference-service.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0002_reference_access.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /type Tab[\s\S]*?"references"/);
  assert.match(page, /label="References"/);
  assert.match(page, /renderReferences/);
  assert.match(page, /REFERENCE_ACCESS_KEY/);
  assert.match(
    page,
    /href=\{flightAwareRouteUrl\(flight, prefs\.homeAirport\)\}[^>]*target="_self"/,
  );
  assert.doesNotMatch(
    page,
    /href=\{flightAwareRouteUrl\(flight, prefs\.homeAirport\)\}[^>]*target="_blank"/,
  );
  assert.match(page, /referencePreloadReady/);
  assert.match(page, /bootstrapReferenceAccess\(false\)/);
  assert.match(page, /Approval requested/);
  assert.match(page, /reference-owner-status/);
  assert.match(page, /No requests/);
  assert.match(page, /reference-access-setting/);
  assert.match(page, /Manage reference access/);
  assert.match(page, /referenceSettingsOpen/);
  assert.match(page, /Disconnect all approved devices/);
  assert.match(page, /Disconnect owner controls on this device/);
  assert.match(page, /resolveReferenceRequest/);
  assert.match(css, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.reference-card-grid/);
  assert.match(css, /\.reference-access-gate/);
  assert.match(css, /\.reference-owner-status/);
  assert.match(css, /\.reference-management-sheet/);
  assert.match(css, /\.reference-device-list/);
  assert.match(service, /REFERENCE_OWNER_CODE/);
  assert.match(service, /reference_access_requests/);
  assert.match(service, /reference_sessions/);
  assert.match(service, /\/api\/references\/owner\/login/);
  assert.match(service, /\/api\/references\/owner\/logout/);
  assert.match(service, /\/api\/references\/owner\/devices\/revoke-all/);
  assert.match(service, /\/api\/references\/owner\/devices\//);
  assert.match(service, /approve\|deny/);
  assert.match(service, /reference\?\.id !== "manuals"/);
  assert.match(page, /reference\.id !== "manuals"/);
  assert.doesNotMatch(page, /contacts and work manuals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS reference_vault/);
  assert.doesNotMatch(references, /export const|tel:|mailto:|https?:\/\//);
  assert.doesNotMatch(page, /CONTACT_GROUPS|QUICK_REFERENCES/);
});

test("searches all references, condenses contacts, and marks GSC workers", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /referenceSearchQuery/);
  assert.match(page, /Search contacts and references/);
  assert.match(page, /referenceSearchResults/);
  assert.match(page, /contact\.methods && contact\.methods\.length > 0/);
  assert.match(page, /tab === "references"[\s\S]{0,450}?<Search \/>/);
  assert.match(page, /case "websites"/);
  assert.match(page, /GSC_NAME_KEYS/);
  assert.match(page, /Chris Williams/);
  assert.match(page, /<PersonName name=\{candidate\.worker\}/);
  assert.match(page, /<PersonName name=\{shift\.worker\}/);
  assert.match(css, /\.contact-methods\s*\{[\s\S]{0,120}?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.reference-search-highlight/);
  assert.match(css, /\.gsc-tag/);
});

test("caches the PWA shell and restores Today before background data", async () => {
  const [serviceWorker, page, layout, pagesShell] = await Promise.all([
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(serviceWorker, /shiftdeck-shell/);
  assert.match(serviceWorker, /shiftdeck-shell.*v4|CACHE_PREFIX.*v4/s);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /warmDocumentAssets/);
  assert.match(serviceWorker, /cache\.match\(scopeRoot\)/);
  assert.match(
    serviceWorker,
    /request\.mode === "navigate"[\s\S]*?await fetch\(request\)[\s\S]*?if \(cached\) return cached/,
  );
  assert.match(page, /backgroundHydrated/);
  assert.match(page, /setHydrated\(true\)[\s\S]*?window\.setTimeout/);
  assert.doesNotMatch(layout, /next\/font/);
  assert.match(layout, /launchPaintStyle/);
  assert.match(layout, /background: #17191d/);
  assert.match(layout, /backgroundColor: "#17191d"/);
  assert.match(layout, /navigator\.serviceWorker\.register/);
  assert.match(pagesShell, /navigator\.serviceWorker/);
  assert.match(pagesShell, /background: #17191d/);
});

test("rejects schedule headings and OCR fragments as worker names", () => {
  assert.equal(isPlausibleWorkerName("Pass Subject To Sore"), false);
  assert.equal(isPlausibleWorkerName("She An Ow"), false);
  assert.equal(isPlausibleWorkerName("Andrew Garcia"), true);
  assert.equal(isPlausibleWorkerName("David LaBarre"), true);
  assert.equal(isPlausibleWorkerName("Thales Ferraz Alves"), true);
});

test("only replaces an imported schedule when most of its week matches", () => {
  const firstWeek = [
    "2026-07-26",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
  ];
  const differentWeekWithOneMisreadOverlap = [
    "2026-07-30",
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
  ];
  const correctedVersion = [
    "2026-07-26",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-02",
  ];

  assert.equal(
    isScheduleRevision(firstWeek, differentWeekWithOneMisreadOverlap),
    false,
  );
  assert.equal(isScheduleRevision(firstWeek, correctedVersion), true);
});

test("renders stable Apple-compatible timed calendar alarms", () => {
  const calendar = [
    ...renderAppleTimedAlarm(
      "calendar-test-id",
      "david-2026-08-01",
      "PT1H",
    ),
    ...renderAppleTimedAlarm(
      "calendar-test-id",
      "david-2026-08-01",
      "PT2H",
    ),
  ].join("\r\n");

  assert.equal((calendar.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(calendar, /TRIGGER:-PT1H/);
  assert.match(calendar, /TRIGGER:-PT2H/);
  assert.doesNotMatch(calendar, /RELATED=START/);
  assert.equal((calendar.match(/ACTION:DISPLAY/g) ?? []).length, 2);
  assert.equal((calendar.match(/DESCRIPTION:Shiftdeck reminder/g) ?? []).length, 2);
  assert.equal((calendar.match(/X-WR-ALARMUID:/g) ?? []).length, 2);
  assert.equal((calendar.match(/^UID:[0-9A-F-]{36}$/gm) ?? []).length, 2);
  assert.equal(
    (calendar.match(/^X-WR-ALARMUID:[0-9A-F-]{36}$/gm) ?? []).length,
    2,
  );
  assert.equal((calendar.match(/ATTACH/g) ?? []).length, 0);
  assert.doesNotMatch(calendar, /@shiftdeck\.app/);
});

test("advances existing events when the calendar format changes", () => {
  assert.equal(calendarSequenceFor(0), CALENDAR_FORMAT_VERSION);
  assert.equal(
    calendarSequenceFor(1),
    1_000 + CALENDAR_FORMAT_VERSION,
  );
  assert.ok(calendarSequenceFor(12) > 12);
});

test("normalizes precise notification alerts without duplicates", () => {
  const result = normalizeNotificationPayload({
    title: "  Ramp shift  ",
    location: "  ABE terminal  ",
    timezone: "America/New_York",
    alerts: [120, 30, 120, -1, 10081],
    events: [
      {
        key: "shift-1",
        date: "2026-08-04",
        start: "09:00",
        end: "17:00",
        startAt: "2026-08-04T13:00:00.000Z",
        title: "",
      },
    ],
  });

  assert.deepEqual(result.alerts, [120, 30]);
  assert.equal(result.title, "Ramp shift");
  assert.equal(result.location, "ABE terminal");
  assert.equal(result.events[0].title, "Ramp shift");
  assert.equal(result.events[0].startAt, "2026-08-04T13:00:00.000Z");
});

test("uses durable, duplicate-safe PWA shift notifications", async () => {
  const [page, css, pushService, worker, migration, manifest, config, serviceWorker, parser] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
      readFile(new URL("../worker/push-service.ts", import.meta.url), "utf8"),
      readFile(new URL("../worker/calendar-only.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../drizzle/0003_pwa_notifications.sql", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
      readFile(new URL("../wrangler.calendar.jsonc", import.meta.url), "utf8"),
      readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
      readFile(new URL("../app/schedule-parser.ts", import.meta.url), "utf8"),
    ]);

  assert.match(page, /createNotificationProfile/);
  assert.match(page, /syncNotificationProfile/);
  assert.match(page, /registerPushSubscription/);
  assert.match(page, /requestTestNotification/);
  assert.match(page, /shiftdeck\.notificationProfile/);
  assert.match(page, /Notification\.requestPermission\(\)/);
  assert.match(page, /navigator\.serviceWorker\.ready/);
  assert.match(page, /registration\.pushManager\.subscribe/);
  assert.match(page, /display-mode: standalone/);
  assert.match(page, />Default job title</);
  assert.match(page, />Location</);
  assert.match(page, /Add alert/);
  assert.match(page, /updateNotificationAlert/);
  assert.match(page, /prefs\.alerts\.length >= 12/);
  assert.match(page, /DEFAULT_ALERT_MINUTES = 120/);
  assert.match(page, /Send test/);
  assert.doesNotMatch(page, /Subscribe in Apple Calendar|turn on Event Alerts/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS notification_profiles/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notification_events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS push_subscriptions/);
  assert.match(migration, /endpoint TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notification_deliveries/);
  assert.match(
    migration,
    /PRIMARY KEY \(profile_id, event_key, alert_minutes, subscription_id\)/,
  );
  assert.match(pushService, /ON CONFLICT\(profile_id, event_key, alert_minutes, subscription_id\)/);
  assert.match(pushService, /status = 'sending'/);
  assert.match(pushService, /RETURNING profile_id/);
  assert.match(pushService, /status === 404 \|\| status === 410/);
  assert.match(pushService, /web_push: 8030/);
  assert.match(pushService, /notificationPayload/);
  assert.match(pushService, /sendDueNotifications/);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /handlePushRequest/);
  assert.match(config, /"crons": \["\* \* \* \* \*"\]/);
  assert.match(config, /"nodejs_compat"/);
  assert.equal(JSON.parse(manifest).id, "./");
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /payload\.notification \|\| payload/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);

  assert.match(parser, /isPlausibleWorkerName/);
  assert.match(parser, /NON_NAME_WORDS/);
  assert.match(page, /aria-label="Add a shift"/);
  assert.match(page, /aria-label="Edit this shift"/);
  assert.match(page, /customTitle/);
  assert.match(page, />Shift title</);
  assert.match(page, /returnToToday/);
  assert.match(page, /centerDateInRail\(rail, selectedDate, "smooth"\)/);
  assert.match(css, /\.notification-alert-row/);
  assert.match(css, /grid-auto-columns: calc\(\(100% - 32px\) \/ 5\)/);
});

test("matches a FlightAware route result by weekday and arrival time", () => {
  const flightAwareResults = String.raw`
    {"flightArrivalDay":" <span title=\"EDT\">Thu</span>","flightArrivalTime":"12:27PM&nbsp;<span class=\"tz\">EDT</span>","flightDepartureDay":"<span title=\"EDT\">Thu</span>","flightDepartureTime":"09:54AM&nbsp;<span class=\"tz\">EDT</span>","flightIdent":" <a href=\"/live/flight/id/AAY1821-1785215549-airline-51p%3a0\">AAY1821</a>","flightStatus":"Taxiing"}
    {"flightArrivalDay":" <span title=\"EDT\">Wed</span>","flightArrivalTime":"07:27PM&nbsp;<span class=\"tz\">EDT</span>","flightDepartureDay":"<span title=\"EDT\">Wed</span>","flightDepartureTime":"04:54PM&nbsp;<span class=\"tz\">EDT</span>","flightIdent":" <a href=\"/live/flight/id/AAY178-1785130155-airline-982p%3a0\">AAY178</a>","flightStatus":"Arrived"}
  `;

  assert.equal(
    matchFlightAwareResult(
      flightAwareResults,
      "2026-07-29",
      "19:27",
      "arrival",
    ),
    "https://www.flightaware.com/live/flight/id/AAY178-1785130155-airline-982p%3a0",
  );
  assert.equal(
    matchFlightAwareResult(
      flightAwareResults,
      "2026-07-29",
      "16:54",
      "departure",
    ),
    "https://www.flightaware.com/live/flight/id/AAY178-1785130155-airline-982p%3a0",
  );
});
