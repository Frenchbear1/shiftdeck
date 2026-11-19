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
  RefreshCw,
  Moon,
  Navigation,
  Sun,
  Sunrise,
  Sunset,
  SunMedium,
  Thermometer,
  TriangleAlert,
  Eye,
  Waves,
  Wind,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Shift } from "./sample-data";
import {
  compass,
  dayHours,
  Forecast,
  HourWeather,
  CACHE_MS,
  loadForecast,
  savedForecast,
  STALE_MS,
  outlook,
  rampWarnings,
  shiftHours,
  shiftWeather,
  weatherLabel,
  type DayOutlook,
  type HourDetail,
} from "./weather";
import { DayGraph, METRICS, Outlook, type MetricKey } from "./weather-charts";

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

const METRIC_KEY = "shiftdeck.weatherMetric";

const sunClock = (time: string) => (time ? clock(time) : "—");

export function WeatherPanel({ shift, date, today }: {
  shift: Shift | null | undefined;
  /** The day being looked at (the shift's, or a day off). */
  date: string;
  today: string;
}) {
  // The panel only renders after shifts load (post-hydration), so reading
  // storage on first render is safe. Show the last forecast right away, even an old one.
  const [forecast, setForecast] = useState<Forecast | null>(() => (typeof window !== "undefined" ? savedForecast() : null));
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [compact, setCompact] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(COMPACT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [metric, setMetricState] = useState<MetricKey>(() => {
    try {
      return (typeof window !== "undefined" && localStorage.getItem(METRIC_KEY) as MetricKey) || "all";
    } catch {
      return "all";
    }
  });
  // The day the graph shows: the day you're looking at, until you tap another in the list.
  const [picked, setPicked] = useState<{ for: string; day: string } | null>(null);
  const graphDay = picked?.for === date ? picked.day : date;

  const refresh = useRef<(force?: boolean) => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const update = (force = false) => {
      if (busy) return;
      busy = true;
      if (force) setRefreshing(true);
      loadForecast(force)
        .then((value) => {
          if (cancelled) return;
          setForecast(value);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          busy = false;
          if (!cancelled) {
            setRefreshing(false);
            setClockTick(Date.now());
          }
        });
    };
    refresh.current = update;
    update();
    // While the app stays open: check each minute, and fetch once the forecast is 30 minutes old.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setClockTick(Date.now());
      const saved = savedForecast();
      if (!saved || Date.now() - saved.fetchedAt >= CACHE_MS) update();
    }, 60_000);
    // Coming back to the app: catch up right away if it's gone stale.
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      setClockTick(Date.now());
      update();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("online", onShow);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("online", onShow);
    };
  }, []);

  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Keep it for this visit only.
    }
  };
  const setMode = (next: boolean) => {
    setCompact(next);
    remember(COMPACT_KEY, next ? "1" : "0");
  };
  const setMetric = (next: MetricKey) => {
    setMetricState(next);
    remember(METRIC_KEY, next);
  };

  const working = Boolean(shift?.start && shift.end);
  const weather = forecast && working ? shiftWeather(forecast, shift!.date, shift!.start, shift!.end) : null;
  const shiftDetail = forecast && working ? shiftHours(forecast, shift!.date, shift!.start, shift!.end) : [];
  const days = forecast ? outlook(forecast, today, 10) : [];
  const day = forecast ? dayHours(forecast, graphDay) : [];
  const daySummary = days.find((item) => item.date === graphDay) ?? (forecast ? outlook(forecast, graphDay, 1)[0] : undefined);
  const viewed = forecast ? outlook(forecast, date, 1)[0] : undefined;
  if (forecast && !day.length && !weather) return null; // Past the forecast.
  const shiftSpan = weather ? { from: weather.hours[0].time, to: weather.hours.at(-1)!.time } : undefined;
  const nowHour = graphDay === today ? `${today}T${String(new Date().getHours()).padStart(2, "0")}:00` : undefined;

  return (
    <section className={`panel weather-panel ${compact ? "compact" : ""}`}>
      <div className="panel-head">
        <h2>
          {working ? "Shift weather" : "Weather"} <span className="count">ABE</span>
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

      {!forecast ? (
        <p className="quiet-line">
          <Cloud />
          {failed ? "Couldn’t load the weather. Check your connection." : "Loading weather…"}
        </p>
      ) : compact ? (
        <CompactWeather weather={weather} hours={shiftDetail.length ? shiftDetail : dayHours(forecast, date)} day={viewed} />
      ) : (
        <>
          {weather ? <FullWeather weather={weather} hours={shiftDetail} /> : viewed && <DayHero day={viewed} />}

          <div className="wx-day">
            <div className="wx-day-head">
              <b>{graphDay === today ? "Today" : new Date(`${graphDay}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</b>
              {graphDay !== date && (
                <button type="button" className="wx-day-back" onClick={() => setPicked(null)}>Back to {working ? "shift day" : "this day"}</button>
              )}
            </div>
            <DayGraph
              hours={day}
              shift={graphDay === date || (shiftSpan && shiftSpan.to.startsWith(graphDay)) ? shiftSpan : undefined}
              now={nowHour}
              metric={metric}
              onMetric={setMetric}
            />
            {daySummary && (
              <div className="wx-facts">
                <span><Thermometer /><small>High / low</small><b>{daySummary.high}° / {daySummary.low}°</b></span>
                <span><Droplets /><small>Rain</small><b>{daySummary.precip >= 0.01 ? `${daySummary.precip.toFixed(2)} in` : `${daySummary.rainChance}%`}</b></span>
                <span><Wind /><small>Gusts</small><b>{daySummary.gustMax} mph</b></span>
                <span><SunMedium /><small>UV max</small><b>{Math.round(daySummary.uvMax)}</b></span>
                <span><Sunrise /><small>Sunrise</small><b>{sunClock(daySummary.sunrise)}</b></span>
                <span><Sunset /><small>Sunset</small><b>{sunClock(daySummary.sunset)}</b></span>
              </div>
            )}
          </div>

          <Outlook
            days={days}
            today={today}
            selected={graphDay}
            onSelect={(next) => setPicked({ for: date, day: next })}
            icon={(code) => <WeatherIcon code={code} day />}
          />
        </>
      )}

      {forecast && (
        <div className="wx-foot">
          <UpdatedAt fetchedAt={forecast.fetchedAt} now={clockTick} failed={failed} refreshing={refreshing} onRefresh={() => refresh.current(true)} />
          <a className="wx-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Weather by Open-Meteo
          </a>
        </div>
      )}
    </section>
  );
}

/** When this forecast came in; amber once it's over an hour old. Tap to get a new one. */
function UpdatedAt({ fetchedAt, now, failed, refreshing, onRefresh }: {
  fetchedAt: number;
  now: number;
  failed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const at = new Date(fetchedAt);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const stale = now - fetchedAt > STALE_MS;
  const label = refreshing
    ? "Updating…"
    : `Updated ${sameDay ? time : `${at.toLocaleDateString("en-US", { weekday: "short" })} ${time}`}${failed && stale ? " · offline" : ""}`;
  return (
    <button
      type="button"
      className={`wx-updated${stale ? " stale" : ""}`}
      onClick={onRefresh}
      disabled={refreshing}
      aria-label={`${label}. Tap to update the weather`}
    >
      <RefreshCw className={refreshing ? "spin" : ""} aria-hidden="true" />
      {label}
    </button>
  );
}

/** A day off: the day's weather instead of a shift's. */
function DayHero({ day }: { day: DayOutlook }) {
  return (
    <div className={`wx-hero wx-${mood(day.code, true)}`}>
      <div className="wx-hero-main">
        <span className="wx-hero-icon"><WeatherIcon code={day.code} day /></span>
        <div>
          <small>High / low</small>
          <b>{day.high}° / {day.low}°</b>
          <span>{weatherLabel(day.code)} · feels {day.feelsLow}–{day.feelsHigh}°</span>
        </div>
      </div>
      <div className="wx-compass" aria-label={`Wind ${compass(day.direction)} up to ${day.windMax} mph, gusts ${day.gustMax} mph`}>
        <div className="wx-dial">
          <i>N</i>
          <WindArrow direction={day.direction} size={26} />
        </div>
        <b>{compass(day.direction)} {day.windMax}<small> mph</small></b>
        <span>Gusts {day.gustMax}</span>
      </div>
    </div>
  );
}

/** The short version: one line, and a strip of the hours colored by feel, rain and wind. */
function CompactWeather({ weather, hours, day }: {
  weather: NonNullable<ReturnType<typeof shiftWeather>> | null;
  hours: HourDetail[];
  day?: DayOutlook;
}) {
  if (!hours.length) return null;
  const code = weather?.code ?? day?.code ?? hours[0].code;
  const isDay = weather?.day ?? true;
  const feelsLow = Math.min(...hours.map((hour) => hour.feels));
  const feelsHigh = Math.max(...hours.map((hour) => hour.feels));
  const windiest = hours.reduce((best, hour) => (hour.gust > best.gust ? hour : best));
  const rain = Math.max(...hours.map((hour) => hour.rain));
  const warnings = rampWarnings(hours);
  const rows = METRICS.filter((metric) => ["temp", "rain", "wind"].includes(metric.key));
  return (
    <div className={`wx-compact wx-${mood(code, isDay)}`}>
      <div className="wx-compact-line">
        <span className="wx-compact-icon"><WeatherIcon code={code} day={isDay} /></span>
        <span className="wx-compact-main">
          <b>{feelsLow === feelsHigh ? `${feelsLow}°` : `${feelsLow}–${feelsHigh}°`}</b>
          <small>{weatherLabel(code)}</small>
        </span>
        <span className="wx-compact-stat">
          <WindArrow direction={windiest.direction} />
          <b>{windiest.wind}</b><small>{windiest.gust > windiest.wind + 4 ? `G${windiest.gust}` : "mph"}</small>
        </span>
        <span className="wx-compact-stat">
          <Droplets />
          <b>{rain}%</b>
        </span>
        {warnings.length > 0 && (
          <span className="wx-compact-storm" aria-label={warnings.map((warning) => warning.text).join(". ")}>
            {warnings[0].kind === "storm" ? <CloudLightning /> : <TriangleAlert />}
          </span>
        )}
      </div>
      <div className="wx-strip" aria-hidden="true">
        {rows.map((metric) => (
          <div key={metric.key} className="wx-strip-row" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
            {hours.map((hour) => <i key={hour.time} style={{ background: metric.color(hour) }} />)}
          </div>
        ))}
        <div className="wx-strip-ends">
          <small>{clock(hours[0].time, true)}</small>
          <small>Feels · rain · wind</small>
          <small>{clock(hours.at(-1)!.time, true)}</small>
        </div>
      </div>
    </div>
  );
}

function FullWeather({ weather, hours }: { weather: NonNullable<ReturnType<typeof shiftWeather>>; hours: HourDetail[] }) {
  const range =
    weather.feelsMin === weather.feelsMax
      ? `${weather.feelsMin}°`
      : `${weather.feelsMin}° – ${weather.feelsMax}°`;
  const warnings = rampWarnings(hours);
  const lowestVisibility = hours.length ? Math.min(...hours.map((hour) => hour.visibility)) : 10;
  const uv = hours.length ? Math.max(...hours.map((hour) => hour.uv)) : 0;
  const humidity = hours.length ? [Math.min(...hours.map((hour) => hour.humidity)), Math.max(...hours.map((hour) => hour.humidity))] : null;
  const precip = hours.reduce((sum, hour) => sum + hour.precip, 0);
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

      {warnings.map((warning) => (
        <p key={warning.kind} className={`wx-alert wx-alert-${warning.kind}`}>
          <TriangleAlert />
          {warning.text} · from {clock(warning.at)}
        </p>
      ))}

      <div className="wx-chips">
        <span>
          <Droplets />
          {weather.wetFrom
            ? `${weather.rainMax}% from ${clock(weather.wetFrom.time)}${precip >= 0.01 ? ` · ${precip.toFixed(2)} in` : ""}`
            : `${weather.rainMax}% chance of rain`}
        </span>
        <span>
          <Thermometer />
          Actual {weather.tempMin === weather.tempMax ? `${weather.tempMin}°` : `${weather.tempMin}–${weather.tempMax}°`}
        </span>
        {humidity && <span><Waves />Humidity {humidity[0] === humidity[1] ? `${humidity[0]}%` : `${humidity[0]}–${humidity[1]}%`}</span>}
        <span><Eye />Visibility {lowestVisibility >= 10 ? "10+" : lowestVisibility.toFixed(lowestVisibility < 3 ? 1 : 0)} mi</span>
        {uv >= 1 && <span><SunMedium />UV {Math.round(uv)}</span>}
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
