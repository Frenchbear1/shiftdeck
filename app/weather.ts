/**
 * Shift weather at ABE from Open-Meteo (free, no key, no account).
 * Each phone asks Open-Meteo directly; answers are reused for 30 minutes.
 * Data: Open-Meteo.com, CC BY 4.0 (the card shows the credit).
 */

/** FAA airport reference point for ABE (Lehigh Valley International), 120 m MSL. */
export const ABE_LOCATION = { latitude: 40.652363, longitude: -75.440406, elevation: 120 };
const TIME_ZONE = "America/New_York";
// v2: more of what Open-Meteo gives (humidity, clouds, visibility, UV, pressure, daily summaries).
const CACHE_KEY = "shiftdeck.weather.abe.v2";
const CACHE_MS = 30 * 60_000;

export type Forecast = {
  fetchedAt: number;
  /** Units Open-Meteo used (visibility comes back in feet with imperial units). */
  hourly_units?: Record<string, string>;
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
    precipitation: number[];
    snowfall: number[];
    relative_humidity_2m: number[];
    dew_point_2m: number[];
    cloud_cover: number[];
    visibility: number[];
    uv_index: number[];
    pressure_msl: number[];
  };
  daily: {
    time: string[];
    sunrise: string[];
    sunset: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    apparent_temperature_max: number[];
    apparent_temperature_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
    wind_gusts_10m_max: number[];
    wind_direction_10m_dominant: number[];
    uv_index_max: number[];
    daylight_duration: number[];
  };
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
    elevation: String(ABE_LOCATION.elevation),
    hourly: [
      "apparent_temperature", "temperature_2m", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
      "precipitation_probability", "weather_code", "is_day", "precipitation", "snowfall", "relative_humidity_2m",
      "dew_point_2m", "cloud_cover", "visibility", "uv_index", "pressure_msl",
    ].join(","),
    daily: [
      "sunrise", "sunset", "weather_code", "temperature_2m_max", "temperature_2m_min", "apparent_temperature_max",
      "apparent_temperature_min", "precipitation_sum", "precipitation_probability_max", "wind_speed_10m_max",
      "wind_gusts_10m_max", "wind_direction_10m_dominant", "uv_index_max", "daylight_duration",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
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

/* ---------- every hour of a day, and the days ahead ---------- */

export type HourDetail = HourWeather & {
  /** Rain (and melted snow) that hour, inches. */
  precip: number;
  /** Snow that hour, inches. */
  snow: number;
  humidity: number;
  dew: number;
  cloud: number;
  /** Miles (Open-Meteo gives meters, or feet with imperial units). */
  visibility: number;
  uv: number;
  /** Inches of mercury, like an altimeter setting (Open-Meteo gives hPa). */
  pressure: number;
};

const at = (list: number[] | undefined, index: number) => (list && Number.isFinite(list[index]) ? list[index] : 0);

function hourAt(forecast: Forecast, index: number): HourDetail {
  const { hourly } = forecast;
  const feet = forecast.hourly_units?.visibility === "ft";
  const seen = hourly.visibility && Number.isFinite(hourly.visibility[index]) ? hourly.visibility[index] : null;
  return {
    time: hourly.time[index],
    feels: Math.round(at(hourly.apparent_temperature, index)),
    temp: Math.round(at(hourly.temperature_2m, index)),
    wind: Math.round(at(hourly.wind_speed_10m, index)),
    gust: Math.round(at(hourly.wind_gusts_10m, index)),
    direction: at(hourly.wind_direction_10m, index),
    rain: at(hourly.precipitation_probability, index),
    code: at(hourly.weather_code, index),
    day: at(hourly.is_day, index) === 1,
    precip: at(hourly.precipitation, index),
    snow: at(hourly.snowfall, index),
    humidity: Math.round(at(hourly.relative_humidity_2m, index)),
    dew: Math.round(at(hourly.dew_point_2m, index)),
    cloud: Math.round(at(hourly.cloud_cover, index)),
    visibility: seen === null ? 10 : Math.round((seen / (feet ? 5280 : 1609.34)) * 10) / 10,
    uv: Math.round(at(hourly.uv_index, index) * 10) / 10,
    pressure: Math.round((at(hourly.pressure_msl, index) / 33.8639) * 100) / 100,
  };
}

/** The 24 hours of a day (fewer at the ends of the forecast). */
export function dayHours(forecast: Forecast, date: string): HourDetail[] {
  return forecast.hourly.time.flatMap((time, index) => (time.startsWith(date) ? [hourAt(forecast, index)] : []));
}

/** The hours of a shift, with every detail. */
export function shiftHours(forecast: Forecast, date: string, start: string, end: string): HourDetail[] {
  const times = new Set((shiftWeather(forecast, date, start, end)?.hours ?? []).map((hour) => hour.time));
  return forecast.hourly.time.flatMap((time, index) => (times.has(time) ? [hourAt(forecast, index)] : []));
}

export type DayOutlook = {
  date: string;
  code: number;
  high: number;
  low: number;
  feelsHigh: number;
  feelsLow: number;
  rainChance: number;
  precip: number;
  windMax: number;
  gustMax: number;
  direction: number;
  uvMax: number;
  sunrise: string;
  sunset: string;
  /** Hours of daylight. */
  daylight: number;
};

/** The days from `from` on (today and after). */
export function outlook(forecast: Forecast, from: string, days = 10): DayOutlook[] {
  const { daily } = forecast;
  return daily.time.flatMap((date, index) => date < from ? [] : [{
    date,
    code: at(daily.weather_code, index),
    high: Math.round(at(daily.temperature_2m_max, index)),
    low: Math.round(at(daily.temperature_2m_min, index)),
    feelsHigh: Math.round(at(daily.apparent_temperature_max, index)),
    feelsLow: Math.round(at(daily.apparent_temperature_min, index)),
    rainChance: Math.round(at(daily.precipitation_probability_max, index)),
    precip: Math.round(at(daily.precipitation_sum, index) * 100) / 100,
    windMax: Math.round(at(daily.wind_speed_10m_max, index)),
    gustMax: Math.round(at(daily.wind_gusts_10m_max, index)),
    direction: at(daily.wind_direction_10m_dominant, index),
    uvMax: Math.round(at(daily.uv_index_max, index) * 10) / 10,
    sunrise: daily.sunrise?.[index] ?? "",
    sunset: daily.sunset?.[index] ?? "",
    daylight: Math.round((at(daily.daylight_duration, index) / 3600) * 10) / 10,
  }]).slice(0, days);
}

/** Things worth a warning on the ramp, in the order they matter. */
export function rampWarnings(hours: HourDetail[]) {
  const warnings: Array<{ kind: "storm" | "ice" | "visibility" | "wind"; at: string; text: string }> = [];
  const storm = hours.find((hour) => hour.code >= 95);
  if (storm) warnings.push({ kind: "storm", at: storm.time, text: "Thunderstorms possible · the ramp may close for lightning" });
  // Wet, or air near saturation, at or below freezing: slick surfaces, frost on equipment.
  const ice = hours.find((hour) => hour.temp <= 34 && (hour.precip > 0 || hour.snow > 0 || hour.temp - hour.dew <= 3));
  if (ice) warnings.push({ kind: "ice", at: ice.time, text: ice.snow > 0 ? "Snow at or below freezing · icy surfaces" : "Freezing temps with moisture · frost or ice on surfaces" });
  const foggy = hours.find((hour) => hour.visibility > 0 && hour.visibility < 3);
  if (foggy) warnings.push({ kind: "visibility", at: foggy.time, text: `Visibility down to ${Math.min(...hours.map((hour) => hour.visibility || 99))} mi` });
  const gusty = hours.find((hour) => hour.gust >= 35);
  if (gusty) warnings.push({ kind: "wind", at: gusty.time, text: `Gusts to ${Math.max(...hours.map((hour) => hour.gust))} mph · secure loose equipment` });
  return warnings;
}
