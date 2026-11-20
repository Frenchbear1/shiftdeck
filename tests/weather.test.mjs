import assert from "node:assert/strict";
import test from "node:test";
import { compass, dayHours, outlook, rampWarnings, shiftHours, shiftWeather } from "../app/weather.ts";

// 24 hours from Nov 13 12:00 to Nov 14 11:00 (local time strings, like Open-Meteo).
const times = Array.from({ length: 24 }, (_, i) => {
  const hour = (12 + i) % 24;
  const day = 12 + i >= 24 ? "14" : "13";
  return `2026-11-${day}T${String(hour).padStart(2, "0")}:00`;
});
const forecast = {
  fetchedAt: 0,
  hourly: {
    time: times,
    apparent_temperature: times.map((_, i) => 40 - i),
    temperature_2m: times.map((_, i) => 45 - i),
    wind_speed_10m: times.map((_, i) => (i === 10 ? 22 : 8)),
    wind_direction_10m: times.map(() => 315),
    wind_gusts_10m: times.map((_, i) => (i === 10 ? 35 : 14)),
    precipitation_probability: times.map((_, i) => (i >= 9 ? 70 : 10)),
    weather_code: times.map((_, i) => (i === 11 ? 95 : 3)),
    is_day: times.map((_, i) => (i < 5 ? 1 : 0)),
  },
  daily: {
    time: ["2026-11-13", "2026-11-14"],
    sunrise: ["2026-11-13T06:50", "2026-11-14T06:51"],
    sunset: ["2026-11-13T16:46", "2026-11-14T16:45"],
  },
};

test("summarizes a night shift that crosses midnight", () => {
  const weather = shiftWeather(forecast, "2026-11-13", "21:00", "01:00");
  // 9 PM through the 12 AM hour = 4 hours.
  assert.deepEqual(
    weather.hours.map((hour) => hour.time),
    ["2026-11-13T21:00", "2026-11-13T22:00", "2026-11-13T23:00", "2026-11-14T00:00"],
  );
  assert.equal(weather.feelsMax, 31);
  assert.equal(weather.feelsMin, 28);
  assert.equal(weather.windMax, 22);
  assert.equal(weather.gustMax, 35);
  assert.equal(compass(weather.direction), "NW");
  assert.equal(weather.thunder?.time, "2026-11-13T23:00");
  assert.equal(weather.wetFrom?.time, "2026-11-13T21:00");
  assert.equal(weather.sun, null);
});

test("finds a sunset during an afternoon shift", () => {
  const weather = shiftWeather(forecast, "2026-11-13", "14:00", "18:30");
  assert.equal(weather.hours.length, 5); // 2, 3, 4, 5 and 6 PM
  assert.deepEqual(weather.sun, { kind: "sunset", time: "2026-11-13T16:46" });
});

const detailed = {
  ...forecast,
  hourly_units: { visibility: "ft" },
  hourly: {
    ...forecast.hourly,
    temperature_2m: times.map((_, i) => (i >= 14 ? 31 : 45 - i)),
    dew_point_2m: times.map((_, i) => (i >= 14 ? 30 : 20)),
    precipitation: times.map(() => 0),
    snowfall: times.map(() => 0),
    visibility: times.map((_, i) => (i === 15 ? 5280 : 52800)),
    pressure_msl: times.map(() => 1013.25),
    uv_index: times.map(() => 0),
    relative_humidity_2m: times.map(() => 80),
    cloud_cover: times.map(() => 50),
  },
  daily: {
    ...forecast.daily,
    temperature_2m_max: [52.4, 41],
    temperature_2m_min: [33.6, 28],
    precipitation_sum: [0.123, 0],
    precipitation_probability_max: [70, 5],
  },
};

test("reads a whole day and converts units", () => {
  const hours = dayHours(detailed, "2026-11-14");
  assert.equal(hours.length, 12);
  assert.equal(hours[0].time, "2026-11-14T00:00");
  assert.equal(hours[3].visibility, 1); // 5280 ft
  assert.equal(hours[0].visibility, 10);
  assert.equal(hours[0].pressure, 29.92);
});

test("keeps a missing field from reading as zero visibility", () => {
  const hours = dayHours(forecast, "2026-11-13");
  assert.ok(hours.every((hour) => hour.visibility === 10));
  assert.deepEqual(rampWarnings(hours).map((warning) => warning.kind).includes("visibility"), false);
});

test("lists the days ahead from a date", () => {
  const days = outlook(detailed, "2026-11-13");
  assert.deepEqual(days.map((day) => [day.date, day.high, day.low]), [["2026-11-13", 52, 34], ["2026-11-14", 41, 28]]);
  assert.equal(days[0].precip, 0.12);
  assert.equal(outlook(detailed, "2026-11-14").length, 1);
});

test("warns about storms, frost, fog and gusts on the ramp", () => {
  const hours = shiftHours(detailed, "2026-11-13", "20:00", "04:00");
  const kinds = rampWarnings(hours).map((warning) => warning.kind);
  assert.deepEqual(kinds, ["storm", "ice", "visibility", "wind"]);
  const ice = rampWarnings(hours).find((warning) => warning.kind === "ice");
  assert.equal(ice.at, "2026-11-14T02:00");
});

test("chart lines are smooth curves through every hour, never past the real high or low", async () => {
  const { smoothPath } = await import("../app/smooth-path.ts");
  const points = [[0, 50], [10, 50], [20, 20], [30, 80], [40, 80], [50, 60]];
  const d = smoothPath(points);
  assert.match(d, /^M0\.0,50\.0 C/);
  // Passes through each point.
  for (const [x, y] of points.slice(1)) assert.ok(d.includes(`${x.toFixed(1)},${y.toFixed(1)}`));
  // Control points stay inside each segment's own range (no bulge past a high or low).
  const curves = [...d.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)];
  curves.forEach((curve, index) => {
    const [y0, y1] = [points[index][1], points[index + 1][1]];
    for (const y of [Number(curve[2]), Number(curve[4])]) {
      assert.ok(y >= Math.min(y0, y1) - 0.05 && y <= Math.max(y0, y1) + 0.05, `segment ${index}: ${y} outside ${y0}..${y1}`);
    }
  });
  // A flat stretch stays flat.
  assert.equal(curves[0][2], "50.0");
  assert.equal(curves[0][4], "50.0");
});
