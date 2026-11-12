import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSwap,
  buildCrewTimeline,
  compactTime,
  flightTag,
  offsetContaining,
  scheduleWindow,
} from "../app/schedule-tools.ts";

const shift = (worker, date, start, end, status = "working") => ({
  id: `${date}-${worker}-${start || status}`,
  worker,
  date,
  start,
  end,
  status,
});

test("formats compact schedule times", () => {
  assert.equal(compactTime("21:00"), "9p");
  assert.equal(compactTime("21:30"), "9:30p");
  assert.equal(compactTime("00:15"), "12:15a");
  assert.equal(compactTime("12:00"), "12p");
});

test("builds 3 day, week, 2 week, and month windows", () => {
  const three = scheduleWindow("3d", "2026-11-11", 0);
  assert.deepEqual(
    three.days.map((day) => day.date),
    ["2026-11-11", "2026-11-12", "2026-11-13"],
  );
  assert.equal(scheduleWindow("3d", "2026-11-11", 1).days[0].date, "2026-11-14");

  const week = scheduleWindow("week", "2026-11-11", 0);
  assert.equal(week.days[0].date, "2026-11-08");
  assert.equal(week.days.length, 7);
  assert.equal(week.title, "Nov 8 – 14");

  const twoWeeks = scheduleWindow("2week", "2026-11-11", 0);
  assert.equal(twoWeeks.days.length, 14);
  assert.equal(twoWeeks.days[13].date, "2026-11-21");

  const month = scheduleWindow("month", "2026-11-11", 0);
  assert.equal(month.title, "November 2026");
  assert.equal(month.days[0].date, "2026-11-01");
  assert.equal(month.days.length % 7, 0);
  assert.ok(month.days.every((day) => day.inMonth || !day.date.startsWith("2026-11")));
  assert.equal(scheduleWindow("month", "2026-11-11", 1).title, "December 2026");

  assert.equal(offsetContaining("week", "2026-11-11", "2026-11-16"), 1);
  assert.equal(offsetContaining("3d", "2026-11-11", "2026-11-10"), -1);
  assert.equal(offsetContaining("month", "2026-11-11", "2027-01-02"), 2);
});

test("labels flights as RON, Turn, or Out", () => {
  assert.equal(flightTag({ kind: "arrival" }), "RON");
  assert.equal(flightTag({ kind: "turnaround" }), "Turn");
  assert.equal(flightTag({ kind: "departure" }), "Out");
});

test("keeps only coworkers who overlap your shift on the crew timeline", () => {
  const timeline = buildCrewTimeline(
    [
      shift("Me", "2026-11-11", "21:00", "01:00"),
      shift("Ana", "2026-11-11", "21:00", "01:00"),
      shift("Ben", "2026-11-11", "22:00", "02:00"),
      shift("Cal", "2026-11-11", "05:00", "13:00"),
    ],
    "Me",
    shift("Me", "2026-11-11", "21:00", "01:00"),
  );
  assert.equal(timeline.rows[0].relation, "mine");
  assert.deepEqual(
    timeline.rows.map((row) => row.workers.join(",")),
    ["Me", "Ana", "Ben"],
  );
  assert.equal(timeline.rows[1].relation, "same");
  assert.ok(timeline.rows.every((row) => row.left >= 0 && row.left + row.width <= 100.001));
});

test("finds swap partners who are free when you work and work when you are free", () => {
  const shifts = [
    shift("Me", "2026-11-12", "21:00", "01:00"),
    shift("Me", "2026-11-13", "", "", "off"),
    shift("Me", "2026-11-14", "", "", "off"),
    // Perfect: off Thursday, works a similar shift Friday.
    shift("Ana", "2026-11-12", "", "", "off"),
    shift("Ana", "2026-11-13", "21:30", "01:30"),
    // Free Thursday but only works days when you also work.
    shift("Ben", "2026-11-12", "", "", "off"),
    shift("Ben", "2026-11-11", "21:00", "01:00"),
    // Working Thursday, never suggested.
    shift("Cal", "2026-11-12", "21:00", "01:00"),
    shift("Cal", "2026-11-13", "21:00", "01:00"),
    // PTO Thursday, never suggested.
    shift("Dee", "2026-11-12", "", "", "pto"),
    shift("Dee", "2026-11-14", "21:00", "01:00"),
    // Free Thursday, works a morning Saturday.
    shift("Eve", "2026-11-12", "", "", "off"),
    shift("Eve", "2026-11-14", "05:00", "13:00"),
  ];
  const result = analyzeSwap({
    shifts,
    person: "Me",
    offDate: "2026-11-12",
    candidateDates: ["2026-11-12", "2026-11-13", "2026-11-14"],
  });
  assert.equal(result.myShift.start, "21:00");
  assert.deepEqual(result.matches.map((match) => match.worker), ["Ana", "Eve"]);
  assert.equal(result.matches[0].swapDays[0].date, "2026-11-13");
  assert.ok(result.matches[0].score > result.matches[1].score);
  assert.deepEqual(result.coverOnly.map((match) => match.worker), ["Ben"]);

  const pinned = analyzeSwap({
    shifts,
    person: "Me",
    offDate: "2026-11-12",
    swapDate: "2026-11-14",
    candidateDates: ["2026-11-13", "2026-11-14"],
  });
  assert.deepEqual(pinned.matches.map((match) => match.worker), ["Eve"]);

  assert.equal(
    analyzeSwap({
      shifts,
      person: "Me",
      offDate: "2026-11-13",
      candidateDates: [],
    }).myShift,
    null,
  );
});

test("merges misspelled coworker names and suggests likely duplicates", async () => {
  const {
    applyNameMerges,
    likelyDuplicateNames,
    mergePairKey,
    resolveMergedName,
  } = await import("../app/schedule-tools.ts");
  const merges = { odyhermany: "Kody Hermany" };
  const merged = applyNameMerges(
    [
      shift("Ody Hermany", "2026-11-12", "14:00", "20:30"),
      shift("Kody Hermany", "2026-11-12", "", "", "off"),
      shift("Kody Hermany", "2026-11-13", "", "", "off"),
      shift("Ody Hermany", "2026-11-13", "", "", "pto"),
      shift("Ana Lee", "2026-11-12", "09:00", "17:00"),
    ],
    merges,
  );
  assert.equal(merged.length, 3);
  assert.ok(merged.every((item) => item.worker !== "Ody Hermany"));
  assert.equal(
    merged.find((item) => item.date === "2026-11-12" && item.worker === "Kody Hermany").status,
    "working",
  );
  assert.equal(
    merged.find((item) => item.date === "2026-11-13").status,
    "pto",
  );
  assert.equal(resolveMergedName("ody  hermany", merges), "Kody Hermany");
  assert.equal(resolveMergedName("A", { a: "B", b: "A" }), "A");

  const names = [
    { name: "Kody Hermany", count: 9 },
    { name: "Ody Hermany", count: 2 },
    { name: "Jason Hudak", count: 6 },
    { name: "Jason Hudek", count: 1 },
    { name: "Naira Ortiz", count: 5 },
    { name: "Nicole Watson", count: 5 },
  ];
  assert.deepEqual(likelyDuplicateNames(names), [
    { from: "Ody Hermany", to: "Kody Hermany" },
    { from: "Jason Hudek", to: "Jason Hudak" },
  ]);
  assert.deepEqual(
    likelyDuplicateNames(names, new Set([mergePairKey("Kody Hermany", "Ody Hermany")])),
    [{ from: "Jason Hudek", to: "Jason Hudak" }],
  );
});
