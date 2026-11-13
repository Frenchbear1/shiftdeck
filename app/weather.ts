/**
 * Shift weather at ABE from Open-Meteo (free, no key, no account).
 * Each phone asks Open-Meteo directly; answers are reused for 30 minutes.
 * Data: Open-Meteo.com, CC BY 4.0 (the card shows the credit).
 */

export const ABE_LOCATION = { latitude: 40.6521, longitude: -75.4408 };
const TIME_ZONE = "America/New_York";
const CACHE_KEY = "shiftdeck.weather";
const CACHE_MS = 30 * 60_000;

export type Forecast = {
  fetchedAt: number;
  hourly: {
    time: string[];
    apparent_temperature: number[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
    precipitation_probability: number[];
    weather_code: number[];
    is_day: number[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
};

export type HourWeather = {
  time: string; // "2026-11-13T21:00" local
  feels: number;
  temp: number;
  wind: number;
  gust: number;
  direction: number;
  rain: number;
  code: number;
  day: boolean;
};

export type ShiftWeather = {
  hours: HourWeather[];
  feelsMin: number;
  feelsMax: number;
  tempMin: number;
  tempMax: number;
  windMax: number;
  gustMax: number;
  /** Direction of the strongest wind. */
  direction: number;
  rainMax: number;
  /** The most notable condition during the shift. */
  code: number;
  day: boolean;
  thunder: HourWeather | null;
  /** First hour with a 30%+ chance of rain/snow. */
  wetFrom: HourWeather | null;
  sun: { kind: "sunrise" | "sunset"; time: string } | null;
};

export async function loadForecast(): Promise<Forecast> {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Forecast | null;
    if (saved && Date.now() - saved.fetchedAt < CACHE_MS) return saved;
  } catch {
    // Ignore a bad or blocked cache.
  }
  const params = new URLSearchParams({
    latitude: String(ABE_LOCATION.latitude),
    longitude: String(ABE_LOCATION.longitude),
    hourly:
      "apparent_temperature,temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,weather_code,is_day",
    daily: "sunrise,sunset",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: TIME_ZONE,
    past_days: "1",
    forecast_days: "14",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
  const data = (await response.json()) as Omit<Forecast, "fetchedAt">;
  const forecast = { ...data, fetchedAt: Date.now() };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(forecast));
  } catch {
    // Storage full or blocked: still use it this time.
  }
  return forecast;
}

const pad = (value: number) => String(value).padStart(2, "0");
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

/** WMO weather codes, worst first, so the shift shows its most notable weather. */
const SEVERITY = (code: number) =>
  code >= 95 ? 9 : code >= 71 && code <= 86 ? 8 : code >= 61 ? 7 : code >= 51 ? 6 : code >= 45 ? 5 : code;

export const WEATHER_LABELS: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms with hail",
  99: "Thunderstorms with hail",
};

export const weatherLabel = (code: number) => WEATHER_LABELS[code] ?? "Mixed";

export const compass = (degrees: number) =>
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((degrees % 360) + 360) % 360 / 45) % 8];

/** Hours from the start of the shift's first hour to its end, crossing midnight if needed. */
export function shiftWeather(
  forecast: Forecast,
  date: string,
  start: string,
  end: string,
): ShiftWeather | null {
  const [startHour] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const overnight = end <= start;
  const first = `${date}T${pad(startHour)}:00`;
  const lastHour = endMinute > 0 ? endHour : endHour - 1;
  const lastDate = overnight ? addDays(date, 1) : date;
  const last =
    lastHour < 0
      ? `${addDays(lastDate, -1)}T23:00`
      : `${lastDate}T${pad(lastHour)}:00`;

  const { hourly } = forecast;
  const hours: HourWeather[] = [];
  hourly.time.forEach((time, index) => {
    if (time < first || time > last) return;
    hours.push({
      time,
      feels: Math.round(hourly.apparent_temperature[index]),
      temp: Math.round(hourly.temperature_2m[index]),
      wind: Math.round(hourly.wind_speed_10m[index]),
      gust: Math.round(hourly.wind_gusts_10m[index]),
      direction: hourly.wind_direction_10m[index],
      rain: hourly.precipitation_probability[index] ?? 0,
      code: hourly.weather_code[index],
      day: hourly.is_day[index] === 1,
    });
  });
  if (!hours.length) return null;

  const windiest = hours.reduce((best, hour) => (hour.wind > best.wind ? hour : best));
  const notable = hours.reduce((best, hour) =>
    SEVERITY(hour.code) > SEVERITY(best.code) ? hour : best,
  );
  let sun: ShiftWeather["sun"] = null;
  const startTime = `${date}T${start}`;
  const endTime = `${lastDate}T${end}`;
  forecast.daily.time.forEach((_, index) => {
    for (const kind of ["sunrise", "sunset"] as const) {
      const time = forecast.daily[kind][index];
      if (!sun && time >= startTime && time <= endTime) sun = { kind, time };
    }
  });

  return {
    hours,
    feelsMin: Math.min(...hours.map((hour) => hour.feels)),
    feelsMax: Math.max(...hours.map((hour) => hour.feels)),
    tempMin: Math.min(...hours.map((hour) => hour.temp)),
    tempMax: Math.max(...hours.map((hour) => hour.temp)),
    windMax: windiest.wind,
    gustMax: Math.max(...hours.map((hour) => hour.gust)),
    direction: windiest.direction,
    rainMax: Math.max(...hours.map((hour) => hour.rain)),
    code: notable.code,
    day: hours[Math.floor(hours.length / 2)].day,
    thunder: hours.find((hour) => hour.code >= 95) ?? null,
    wetFrom: hours.find((hour) => hour.rain >= 30) ?? null,
    sun,
  };
}
