"use client";

import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Moon,
  Navigation,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Shift } from "./sample-data";
import {
  compass,
  Forecast,
  HourWeather,
  loadForecast,
  shiftWeather,
  weatherLabel,
} from "./weather";

const COMPACT_KEY = "shiftdeck.weatherCompact";

const clock = (time: string, short = false) => {
  const [hours, minutes] = time.slice(11, 16).split(":").map(Number);
  const suffix = hours >= 12 ? (short ? "p" : " PM") : short ? "a" : " AM";
  const hour = hours % 12 || 12;
  return short ? `${hour}${suffix}` : `${hour}:${String(minutes).padStart(2, "0")}${suffix}`;
};

function WeatherIcon({ code, day }: { code: number; day: boolean }) {
  if (code >= 95) return <CloudLightning />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow />;
  if (code >= 61) return <CloudRain />;
  if (code >= 51) return <CloudDrizzle />;
  if (code >= 45) return <CloudFog />;
  if (code === 3) return <Cloud />;
  if (code >= 1) return day ? <CloudSun /> : <CloudMoon />;
  return day ? <Sun /> : <Moon />;
}

const mood = (code: number, day: boolean) =>
  code >= 95
    ? "storm"
    : (code >= 71 && code <= 77) || code === 85 || code === 86
      ? "snow"
      : code >= 51
        ? "rain"
        : code >= 45 || code === 3
          ? "cloud"
          : day
            ? "clear-day"
            : "clear-night";

/** Points where the wind blows to (weather reports give where it comes from). */
function WindArrow({ direction, size = 14 }: { direction: number; size?: number }) {
  return (
    <Navigation
      className="wx-arrow"
      width={size}
      height={size}
      style={{ transform: `rotate(${direction + 180 - 45}deg)` }}
      aria-hidden="true"
    />
  );
}

export function WeatherPanel({ shift }: { shift: Shift | null | undefined }) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [failed, setFailed] = useState(false);
  // The panel only renders after shifts load (post-hydration), so reading
  // storage on first render is safe.
  const [compact, setCompact] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(COMPACT_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    loadForecast()
      .then((value) => {
        if (!cancelled) setForecast(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = (next: boolean) => {
    setCompact(next);
    try {
      localStorage.setItem(COMPACT_KEY, next ? "1" : "0");
    } catch {
      // Keep it for this visit only.
    }
  };

  if (!shift?.start || !shift.end) return null;
  const weather = forecast ? shiftWeather(forecast, shift.date, shift.start, shift.end) : null;
  if (!weather && !failed && forecast) return null; // Too far ahead for the forecast.

  return (
    <section className={`panel weather-panel ${compact ? "compact" : ""}`}>
      <div className="panel-head">
        <h2>
          Shift weather <span className="count">ABE</span>
        </h2>
        <div className="pill-toggle" role="group" aria-label="Weather card size">
          <button type="button" className={!compact ? "active" : ""} onClick={() => setMode(false)}>
            Full
          </button>
          <button type="button" className={compact ? "active" : ""} onClick={() => setMode(true)}>
            Compact
          </button>
        </div>
      </div>

      {!weather ? (
        <p className="quiet-line">
          <Cloud />
          {failed ? "Couldn’t load the weather. Check your connection." : "Loading weather…"}
        </p>
      ) : compact ? (
        <CompactWeather weather={weather} />
      ) : (
        <FullWeather weather={weather} />
      )}

      {weather && (
        <a className="wx-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather by Open-Meteo
        </a>
      )}
    </section>
  );
}

function CompactWeather({ weather }: { weather: NonNullable<ReturnType<typeof shiftWeather>> }) {
  return (
    <div className={`wx-compact wx-${mood(weather.code, weather.day)}`}>
      <span className="wx-compact-icon">
        <WeatherIcon code={weather.code} day={weather.day} />
      </span>
      <b>
        {weather.feelsMin === weather.feelsMax
          ? `${weather.feelsMin}°`
          : `${weather.feelsMin}–${weather.feelsMax}°`}
        <small> feels</small>
      </b>
      <span className="wx-compact-wind">
        <WindArrow direction={weather.direction} />
        {compass(weather.direction)} {weather.windMax}
        {weather.gustMax > weather.windMax + 4 && <small> G{weather.gustMax}</small>}
      </span>
      <span className="wx-compact-rain">
        <Droplets />
        {weather.rainMax}%
      </span>
      {weather.thunder && (
        <span className="wx-compact-storm" aria-label="Thunderstorms possible">
          <CloudLightning />
        </span>
      )}
    </div>
  );
}

function FullWeather({ weather }: { weather: NonNullable<ReturnType<typeof shiftWeather>> }) {
  const range =
    weather.feelsMin === weather.feelsMax
      ? `${weather.feelsMin}°`
      : `${weather.feelsMin}° – ${weather.feelsMax}°`;
  return (
    <>
      <div className={`wx-hero wx-${mood(weather.code, weather.day)}`}>
        <div className="wx-hero-main">
          <span className="wx-hero-icon">
            <WeatherIcon code={weather.code} day={weather.day} />
          </span>
          <div>
            <small>Feels like</small>
            <b>{range}</b>
            <span>{weatherLabel(weather.code)}</span>
          </div>
        </div>
        <div className="wx-compass" aria-label={`Wind ${compass(weather.direction)} ${weather.windMax} mph, gusts ${weather.gustMax} mph`}>
          <div className="wx-dial">
            <i>N</i>
            <WindArrow direction={weather.direction} size={26} />
          </div>
          <b>
            {compass(weather.direction)} {weather.windMax}
            <small> mph</small>
          </b>
          <span>Gusts {weather.gustMax}</span>
        </div>
      </div>

      {weather.thunder && (
        <p className="wx-alert">
          <TriangleAlert />
          Thunderstorms possible around {clock(weather.thunder.time)} · ramp may close for lightning
        </p>
      )}

      <div className="wx-chips">
        <span>
          <Droplets />
          {weather.wetFrom
            ? `${weather.rainMax}% chance · from ${clock(weather.wetFrom.time)}`
            : `${weather.rainMax}% chance of rain`}
        </span>
        <span>
          <Thermometer />
          Actual {weather.tempMin === weather.tempMax ? `${weather.tempMin}°` : `${weather.tempMin}–${weather.tempMax}°`}
        </span>
        {weather.sun && (
          <span>
            {weather.sun.kind === "sunset" ? <Sunset /> : <Sunrise />}
            {weather.sun.kind === "sunset" ? "Sunset" : "Sunrise"} {clock(weather.sun.time)}
          </span>
        )}
      </div>

      <div
        className={`wx-hours ${weather.hours.length > 6 ? "scrolls" : ""}`}
        role="list"
        aria-label="Hour by hour"
      >
        {weather.hours.map((hour: HourWeather) => (
          <div key={hour.time} className="wx-hour" role="listitem">
            <small>{clock(hour.time, true)}</small>
            <WeatherIcon code={hour.code} day={hour.day} />
            <b>{hour.feels}°</b>
            <span className="wx-hour-wind">
              <WindArrow direction={hour.direction} size={11} />
              {hour.wind}
            </span>
            <span className="wx-hour-rain" aria-label={`${hour.rain}% chance of rain`}>
              <i style={{ height: `${Math.max(hour.rain, 4)}%` }} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
