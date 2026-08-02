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
  assert.match(serviceWorker, /shiftdeck-shell.*v3|CACHE_PREFIX.*v3/s);
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
  assert.equal((calendar.match(/ACTION:AUDIO/g) ?? []).length, 2);
  assert.equal((calendar.match(/X-WR-ALARMUID:/g) ?? []).length, 2);
  assert.equal((calendar.match(/ATTACH;VALUE=URI:Chord/g) ?? []).length, 2);
});

test("advances existing events when the calendar format changes", () => {
  assert.equal(calendarSequenceFor(0), CALENDAR_FORMAT_VERSION);
  assert.equal(
    calendarSequenceFor(1),
    1_000 + CALENDAR_FORMAT_VERSION,
  );
  assert.ok(calendarSequenceFor(12) > 12);
});

test("uses a durable Apple Calendar subscription with revision-aware events", async () => {
  const [page, css, hosting, service, alarms, migration, structuredMigration, parser] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
      readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
      readFile(new URL("../worker/calendar-service.ts", import.meta.url), "utf8"),
      readFile(new URL("../worker/calendar-alarms.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../drizzle/0000_shiftdeck_calendar.sql", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../drizzle/0001_structured_calendar_location.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../app/schedule-parser.ts", import.meta.url), "utf8"),
    ]);

  assert.match(page, /createCalendarFeed/);
  assert.match(page, /syncCalendarFeed/);
  assert.match(page, /saveCalendarSettings/);
  assert.match(page, /shiftdeck\.calendarSubscription/);
  assert.match(page, /window\.location\.href = syncedSubscription\.feedUrl\.replace/);
  assert.equal((page.match(/window\.location\.href/g) ?? []).length, 1);
  assert.match(page, /"webcal:"/);
  assert.doesNotMatch(page, /anchor\.download|Shiftdeck_Schedule\.ics/);

  assert.match(service, /UID:\$\{uidFor\(feed\.id, event\.event_key\)\}/);
  assert.match(service, /SEQUENCE:\$\{calendarSequence\}/);
  assert.match(service, /"CANCELLED" : "CONFIRMED"/);
  assert.doesNotMatch(service, /Revised \$\{sequence\}|— Revised/);
  assert.match(service, /const title = event\.base_title/);
  assert.match(service, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  assert.match(service, /write_token_hash/);
  assert.match(page, /Subscribe in Apple Calendar/);
  assert.match(page, /turn on Event Alerts/);
  assert.match(page, /make sure Event Alerts is on/);
  assert.match(page, /You’re already subscribed/);
  assert.doesNotMatch(page, /Sync now|syncCalendarNow|calendar-sync-button/);
  assert.match(page, /pull down to refresh/);
  assert.doesNotMatch(page, /Open subscription in Apple Calendar|openAppleCalendarFeed/);
  assert.match(page, /Reset calendar connection/);
  assert.match(page, /calendarSubscription\s*\?\s*saveCalendarSettings/);
  assert.match(page, /aria-label=\{\s*calendarSubscription/);
  assert.match(page, />Title</);
  assert.match(page, />Place</);
  assert.match(page, />Reminder 1</);
  assert.match(page, />Reminder 2</);
  assert.match(page, /value: "P1W", label: "1 week before"/);
  assert.doesNotMatch(page, /value: "TIME_TO_LEAVE", label: "Time to Leave"/);
  assert.doesNotMatch(page, /visibleReminderOptions|validateTravelReminder/);
  assert.doesNotMatch(page, /One reminder is enough|calendar-alert-help/);
  assert.match(page, /calendarServiceUrl\(`\/api\/places/);
  assert.match(page, /Enter coordinates/);
  assert.match(page, /Preview in Apple Maps/);
  assert.match(page, /parseCoordinatePair/);
  assert.match(page, /longitudeDirection === "W" \? -1 : 1/);
  assert.match(page, /formatAppleCoordinates/);
  assert.match(page, /<small>Paste from Apple Maps<\/small>/);
  assert.match(page, /40\.65382° N, 75\.43225° W/);
  assert.match(service, /https:\/\/photon\.komoot\.io\/api/);
  assert.match(service, /countrycode=US/);
  assert.match(service, /limit=10/);
  assert.match(service, /new Set\(/);
  assert.match(service, /reminder !== "TIME_TO_LEAVE"/);
  assert.match(alarms, /TRIGGER:/);
  assert.doesNotMatch(alarms, /RELATED=START/);
  assert.match(alarms, /X-WR-ALARMUID/);
  assert.match(alarms, /ACTION:AUDIO/);
  assert.match(alarms, /ATTACH;VALUE=URI:Chord/);
  assert.match(service, /CALENDAR_FORMAT_VERSION/);
  assert.match(service, /calendarSequenceFor\(event\.sequence\)/);
  assert.match(service, /"Last-Modified": lastModified/);
  assert.doesNotMatch(service, /X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC/);
  assert.doesNotMatch(service, /X-APPLE-STRUCTURED-LOCATION|`GEO:/);
  assert.match(service, /LOCATION:\$\{safeIcsText\(feed\.location\)\}/);
  assert.match(service, /public, no-cache, must-revalidate/);
  assert.match(
    page,
    /const DEFAULT_PREFS:[\s\S]*?title: "",[\s\S]*?location: "",/,
  );
  assert.match(parser, /isPlausibleWorkerName/);
  assert.match(parser, /NON_NAME_WORDS/);
  assert.match(parser, /parts\.at\(-1\)!\.length < 4/);
  assert.match(page, /aria-label="Add a shift"/);
  assert.match(page, /aria-label="Edit this shift"/);
  assert.match(page, /shiftdeck\.events/);
  assert.match(page, />Appearance</);
  assert.match(page, /hourlyPay/);
  assert.match(page, />Hourly pay</);
  assert.doesNotMatch(page, /\(\$ per hour\)/);
  assert.match(page, /filingStatus/);
  assert.match(page, /PA_INCOME_TAX_RATE = 0\.0307/);
  assert.match(page, /SOCIAL_SECURITY_TAX_RATE = 0\.062/);
  assert.match(page, /MEDICARE_TAX_RATE = 0\.0145/);
  assert.match(page, /FEDERAL_WEEKLY_WITHHOLDING_2026/);
  assert.match(page, /weekly-pay-card/);
  assert.match(page, /weekly-pay-toggle/);
  assert.match(page, /returnToToday/);
  assert.match(page, /today-text-button/);
  assert.match(page, /centerDateInRail\(rail, selectedDate, "smooth"\)/);
  assert.match(page, /data-schedule-date/);
  assert.match(css, /\.today-text-button/);
  assert.match(page, /customTitle/);
  assert.match(page, />Shift title</);
  assert.doesNotMatch(page, /heroTimeFontSize/);
  assert.match(css, /\.hero-card h1\.hero-time-range[\s\S]*?font-size: 34px/);
  assert.doesNotMatch(css, /--hero-mobile-font-size/);
  assert.doesNotMatch(page, /compact-shift-list|Check before export|Your shifts|Toggle theme/);
  assert.match(css, /grid-auto-columns: calc\(\(100% - 32px\) \/ 5\)/);
  assert.match(page, /Automatic updates on/);

  assert.equal(JSON.parse(hosting).d1, null);
  assert.match(page, /https:\/\/shiftdeck-calendar\.frenchbear1\.workers\.dev/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS calendar_feeds/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS calendar_events/);
  assert.match(structuredMigration, /ADD COLUMN location_lat REAL/);
  assert.match(structuredMigration, /ADD COLUMN location_lon REAL/);
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
