import assert from "node:assert/strict";
import test from "node:test";
import { compass, shiftWeather } from "../app/weather.ts";

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
