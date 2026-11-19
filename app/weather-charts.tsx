"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DayOutlook, HourDetail } from "./weather";

const hourLabel = (time: string) => {
  const hour = Number(time.slice(11, 13));
  return `${hour % 12 || 12}${hour >= 12 ? "p" : "a"}`;
};
const longHour = (time: string) => {
  const hour = Number(time.slice(11, 13));
  return `${hour % 12 || 12} ${hour >= 12 ? "PM" : "AM"}`;
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/* ---------- the metrics, and how each is colored ---------- */

export type MetricKey = "all" | "temp" | "rain" | "wind" | "clouds" | "humidity" | "visibility" | "uv" | "pressure";

type Metric = {
  key: Exclude<MetricKey, "all">;
  label: string;
  /** The main value for the hour. */
  value: (hour: HourDetail) => number;
  /** A second line (feels like, gusts, dew point, amount). */
  second?: { label: string; value: (hour: HourDetail) => number };
  format: (value: number) => string;
  /** A color for one hour, for the All grid and the bars. */
  color: (hour: HourDetail) => string;
  bars?: boolean;
  /** Fixed axis range (otherwise it fits the day). */
  range?: [number, number];
  /** What the day comes to ("High 48° · Low 35°"). */
  summary: (hours: HourDetail[]) => string;
};

/** Cold purples and blues through greens to hot reds, in real degrees (so 35° always looks cold). */
const TEMPERATURE_STOPS: Array<[number, [number, number, number]]> = [
  [10, [118, 70, 190]], [25, [70, 110, 225]], [35, [40, 160, 230]], [45, [40, 190, 185]],
  [55, [80, 190, 90]], [65, [225, 200, 50]], [75, [240, 140, 40]], [88, [220, 60, 45]],
];
export const temperatureColor = (degrees: number) => {
  const value = clamp(degrees, TEMPERATURE_STOPS[0][0], TEMPERATURE_STOPS.at(-1)![0]);
  const upper = TEMPERATURE_STOPS.findIndex(([stop]) => stop >= value);
  const [highStop, high] = TEMPERATURE_STOPS[Math.max(upper, 0)];
  const [lowStop, low] = TEMPERATURE_STOPS[Math.max(upper - 1, 0)];
  const mix = highStop === lowStop ? 0 : (value - lowStop) / (highStop - lowStop);
  const channel = (index: number) => Math.round(low[index] + (high[index] - low[index]) * mix);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
};
/** Violet, deeper the windier (gusts count). */
const windColor = (mph: number) => `rgb(124 77 220 / ${clamp(mph / 40, 0.08, 1).toFixed(2)})`;
const uvColor = (uv: number) => uv < 0.5 ? "rgb(140 150 170 / 18%)" : uv < 3 ? "#3aa655" : uv < 6 ? "#e2b521" : uv < 8 ? "#ee7d1e" : uv < 11 ? "#d8342a" : "#8d3fc7";
const max = (values: number[]) => Math.max(...values);
const min = (values: number[]) => Math.min(...values);

export const METRICS: Metric[] = [
  {
    key: "temp", label: "Temp", value: (hour) => hour.temp,
    second: { label: "Feels like", value: (hour) => hour.feels },
    format: (value) => `${Math.round(value)}°`, color: (hour) => temperatureColor(hour.feels),
    summary: (hours) => `High ${max(hours.map((hour) => hour.temp))}° · Low ${min(hours.map((hour) => hour.temp))}° · feels ${min(hours.map((hour) => hour.feels))}–${max(hours.map((hour) => hour.feels))}°`,
  },
  {
    key: "rain", label: "Rain", value: (hour) => hour.rain, bars: true, range: [0, 100],
    format: (value) => `${Math.round(value)}%`,
    color: (hour) => `hsl(212 85% ${hour.snow > 0 ? 75 : 50}% / ${clamp(hour.rain, 6, 100) / 100})`,
    summary: (hours) => {
      const total = hours.reduce((sum, hour) => sum + hour.precip, 0);
      const snow = hours.reduce((sum, hour) => sum + hour.snow, 0);
      return `Up to ${max(hours.map((hour) => hour.rain))}% chance · ${total < 0.01 ? "none expected" : `${total.toFixed(2)} in`}${snow >= 0.1 ? ` · ${snow.toFixed(1)} in snow` : ""}`;
    },
  },
  {
    key: "wind", label: "Wind", value: (hour) => hour.wind,
    second: { label: "Gusts", value: (hour) => hour.gust },
    format: (value) => `${Math.round(value)} mph`, color: (hour) => windColor(hour.gust),
    summary: (hours) => `Up to ${max(hours.map((hour) => hour.wind))} mph · gusts ${max(hours.map((hour) => hour.gust))}`,
  },
  {
    key: "clouds", label: "Clouds", value: (hour) => hour.cloud, range: [0, 100],
    format: (value) => `${Math.round(value)}%`, color: (hour) => `rgb(128 140 160 / ${clamp(hour.cloud, 5, 100) / 100})`,
    summary: (hours) => {
      const average = Math.round(hours.reduce((sum, hour) => sum + hour.cloud, 0) / hours.length);
      return `${average < 20 ? "Mostly clear" : average < 60 ? "Partly cloudy" : average < 90 ? "Mostly cloudy" : "Overcast"} · ${average}% on average`;
    },
  },
  {
    key: "humidity", label: "Humidity", value: (hour) => hour.humidity, range: [0, 100],
    second: { label: "Dew point", value: (hour) => hour.dew },
    format: (value) => `${Math.round(value)}%`, color: (hour) => `hsl(180 60% 42% / ${clamp(hour.humidity, 8, 100) / 100})`,
    summary: (hours) => `${min(hours.map((hour) => hour.humidity))}–${max(hours.map((hour) => hour.humidity))}% · dew point ${min(hours.map((hour) => hour.dew))}–${max(hours.map((hour) => hour.dew))}°`,
  },
  {
    key: "visibility", label: "Visibility", value: (hour) => Math.min(hour.visibility, 10), range: [0, 10],
    format: (value) => `${value >= 10 ? "10+" : value.toFixed(value < 3 ? 1 : 0)} mi`,
    color: (hour) => `rgb(214 120 20 / ${clamp(1 - hour.visibility / 10, 0.06, 1).toFixed(2)})`,
    summary: (hours) => {
      const lowest = min(hours.map((hour) => hour.visibility));
      return lowest >= 8 ? "Clear all day" : `Lowest ${lowest.toFixed(1)} mi`;
    },
  },
  {
    key: "uv", label: "UV", value: (hour) => hour.uv, bars: true,
    format: (value) => value.toFixed(value < 10 ? 0 : 0), color: (hour) => uvColor(hour.uv),
    summary: (hours) => {
      const top = max(hours.map((hour) => hour.uv));
      return `Peak ${Math.round(top)} · ${top < 3 ? "low" : top < 6 ? "moderate" : top < 8 ? "high" : top < 11 ? "very high" : "extreme"}`;
    },
  },
  {
    key: "pressure", label: "Pressure", value: (hour) => hour.pressure,
    format: (value) => `${value.toFixed(2)} inHg`, color: (hour) => `hsl(${clamp((hour.pressure - 29.4) * 160, 0, 220)} 55% 50% / 0.7)`,
    summary: (hours) => {
      const change = hours.at(-1)!.pressure - hours[0].pressure;
      return `${hours[0].pressure.toFixed(2)} → ${hours.at(-1)!.pressure.toFixed(2)} inHg · ${Math.abs(change) < 0.03 ? "steady" : change > 0 ? "rising" : "falling"}`;
    },
  },
];

/* ---------- one day's graph ---------- */

const WIDTH = 320;
const HEIGHT = 132;
const PAD = { top: 10, right: 6, bottom: 18, left: 30 };

export function DayGraph({ hours, shift, now, metric, onMetric }: {
  hours: HourDetail[];
  /** The shift's hours on this day, shaded. */
  shift?: { from: string; to: string };
  /** The current hour, when the day is today. */
  now?: string;
  metric: MetricKey;
  onMetric: (metric: MetricKey) => void;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  if (!hours.length) return null;
  const chosen = METRICS.find((item) => item.key === metric);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (hours.length === 1 ? plotWidth / 2 : (index / (hours.length - 1)) * plotWidth);
  const indexAt = (event: ReactPointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const position = ((event.clientX - box.left) / box.width) * WIDTH;
    return clamp(Math.round(((position - PAD.left) / plotWidth) * (hours.length - 1)), 0, hours.length - 1);
  };
  const shiftBand = shift && (() => {
    const from = hours.findIndex((hour) => hour.time >= shift.from);
    const toIndex = hours.findLastIndex((hour) => hour.time <= shift.to);
    return from >= 0 && toIndex >= from ? { from: x(from) - plotWidth / (hours.length * 2), to: x(toIndex) + plotWidth / (hours.length * 2) } : null;
  })();
  const nowIndex = now ? hours.findIndex((hour) => hour.time.slice(0, 13) === now.slice(0, 13)) : -1;
  const picked = scrub ?? (nowIndex >= 0 ? null : null);
  const readout = picked !== null ? hours[picked] : null;

  return (
    <div className="wx-graph">
      <div className="wx-metrics" role="tablist" aria-label="What to graph">
        {[{ key: "all" as const, label: "All" }, ...METRICS].map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={metric === item.key}
            className={metric === item.key ? "on" : ""}
            onClick={() => {
              setScrub(null);
              onMetric(item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="wx-readout" aria-live="polite">
        {readout ? (
          <>
            <b>{longHour(readout.time)}</b>
            {chosen
              ? <> · {chosen.format(chosen.value(readout))}{chosen.second ? ` · ${chosen.second.label.toLowerCase()} ${chosen.key === "wind" ? `${chosen.second.value(readout)} mph` : `${chosen.second.value(readout)}°`}` : ""}{chosen.key === "rain" && readout.precip > 0 ? ` · ${readout.precip.toFixed(2)} in` : ""}</>
              : <> · {readout.temp}° (feels {readout.feels}°) · {readout.rain}% rain · {readout.wind}–{readout.gust} mph · {readout.cloud}% clouds</>}
          </>
        ) : chosen ? chosen.summary(hours) : "Every hour at a glance · drag to read an hour"}
      </p>

      {chosen ? (
        <LineOrBars hours={hours} metric={chosen} x={x} plotHeight={plotHeight} svg={svg}
          shiftBand={shiftBand} nowIndex={nowIndex} scrub={scrub} setScrub={setScrub} indexAt={indexAt} />
      ) : (
        <AllGrid hours={hours} shift={shift} nowIndex={nowIndex} scrub={scrub} setScrub={setScrub} />
      )}
    </div>
  );
}

function LineOrBars({ hours, metric, x, plotHeight, svg, shiftBand, nowIndex, scrub, setScrub, indexAt }: {
  hours: HourDetail[];
  metric: Metric;
  x: (index: number) => number;
  plotHeight: number;
  svg: React.RefObject<SVGSVGElement | null>;
  shiftBand: { from: number; to: number } | null | undefined;
  nowIndex: number;
  scrub: number | null;
  setScrub: (index: number | null) => void;
  indexAt: (event: ReactPointerEvent) => number | null;
}) {
  const values = hours.map(metric.value);
  const seconds = metric.second ? hours.map(metric.second.value) : [];
  let [low, high] = metric.range ?? [min([...values, ...seconds]), max([...values, ...seconds])];
  if (!metric.range) {
    const room = Math.max(2, (high - low) * 0.15);
    low = metric.key === "wind" || metric.key === "uv" ? 0 : Math.floor(low - room);
    high = Math.ceil(high + room);
  }
  if (high - low < 1e-6) high = low + 1;
  const y = (value: number) => PAD.top + plotHeight - ((clamp(value, low, high) - low) / (high - low)) * plotHeight;
  const line = (list: number[]) => list.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const barWidth = Math.max(2, ((WIDTH - PAD.left - PAD.right) / hours.length) * 0.66);
  const ticks = hours.flatMap((hour, index) => (Number(hour.time.slice(11, 13)) % 3 === 0 ? [{ index, label: hourLabel(hour.time) }] : []));

  return (
    <svg
      ref={svg}
      className="wx-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${metric.label} by hour: ${metric.summary(hours)}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setScrub(indexAt(event));
      }}
      onPointerMove={(event) => {
        if (event.buttons || event.pointerType === "mouse") setScrub(indexAt(event));
      }}
      onPointerLeave={() => setScrub(null)}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse") setScrub(null);
      }}
    >
      {shiftBand && (
        <g className="wx-shift-band">
          <rect x={shiftBand.from} y={PAD.top} width={shiftBand.to - shiftBand.from} height={plotHeight} rx="4" />
          <text x={(shiftBand.from + shiftBand.to) / 2} y={PAD.top + 9}>Shift</text>
        </g>
      )}
      {[low, (low + high) / 2, high].map((value) => (
        <g key={value} className="wx-grid">
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} />
          <text x={PAD.left - 4} y={y(value) + 3}>{metric.format(value).replace(" mph", "").replace(" inHg", "").replace(" mi", "")}</text>
        </g>
      ))}
      {metric.bars ? (
        hours.map((hour, index) => (
          <rect
            key={hour.time}
            className="wx-bar"
            x={x(index) - barWidth / 2}
            y={y(values[index])}
            width={barWidth}
            height={Math.max(0, PAD.top + plotHeight - y(values[index]))}
            rx="1.5"
            style={{ fill: metric.color(hour) }}
          />
        ))
      ) : (
        <>
          <path className={`wx-area wx-area-${metric.key}`} d={`${line(values)} L${x(hours.length - 1)},${PAD.top + plotHeight} L${x(0)},${PAD.top + plotHeight} Z`} />
          {metric.second && <path className="wx-line second" d={line(seconds)} />}
          <path className={`wx-line wx-line-${metric.key}`} d={line(values)} />
        </>
      )}
      {metric.key === "wind" && hours.map((hour, index) => index % 2 === 0 && (
        <path
          key={hour.time}
          className="wx-wind-tick"
          d="M0,-4 L3,3 L0,1.5 L-3,3 Z"
          transform={`translate(${x(index)},${PAD.top + plotHeight - 5}) rotate(${hour.direction + 180})`}
        />
      ))}
      {nowIndex >= 0 && <line className="wx-now" x1={x(nowIndex)} x2={x(nowIndex)} y1={PAD.top} y2={PAD.top + plotHeight} />}
      {scrub !== null && (
        <g className="wx-scrub">
          <line x1={x(scrub)} x2={x(scrub)} y1={PAD.top} y2={PAD.top + plotHeight} />
          {!metric.bars && <circle cx={x(scrub)} cy={y(values[scrub])} r="3.4" />}
        </g>
      )}
      {ticks.map(({ index, label }) => (
        <text key={index} className="wx-tick" x={x(index)} y={HEIGHT - 5}>{label}</text>
      ))}
    </svg>
  );
}

/** Every metric as a row of colored hours: a quick look at the whole day. */
function AllGrid({ hours, shift, nowIndex, scrub, setScrub }: {
  hours: HourDetail[];
  shift?: { from: string; to: string };
  nowIndex: number;
  scrub: number | null;
  setScrub: (index: number | null) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const indexAt = (event: ReactPointerEvent) => {
    const cells = grid.current?.querySelector(".wx-all-cells")?.getBoundingClientRect();
    if (!cells) return null;
    return clamp(Math.floor(((event.clientX - cells.left) / cells.width) * hours.length), 0, hours.length - 1);
  };
  const inShift = (hour: HourDetail) => Boolean(shift && hour.time >= shift.from && hour.time <= shift.to);
  return (
    <div
      className="wx-all"
      ref={grid}
      role="img"
      aria-label="Temperature, rain, wind, clouds, humidity, visibility and UV for every hour"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setScrub(indexAt(event));
      }}
      onPointerMove={(event) => {
        if (event.buttons || event.pointerType === "mouse") setScrub(indexAt(event));
      }}
      onPointerLeave={() => setScrub(null)}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse") setScrub(null);
      }}
    >
      {METRICS.filter((metric) => metric.key !== "pressure").map((metric) => (
        <div key={metric.key} className="wx-all-row">
          <span>{metric.label}</span>
          <div className="wx-all-cells" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
            {hours.map((hour, index) => (
              <i
                key={hour.time}
                className={`${inShift(hour) ? "shift" : ""}${index === nowIndex ? " now" : ""}${index === scrub ? " scrub" : ""}`}
                style={{ background: metric.color(hour) }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="wx-all-row wx-all-axis">
        <span />
        <div className="wx-all-cells" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
          {hours.map((hour) => <small key={hour.time}>{Number(hour.time.slice(11, 13)) % 6 === 0 ? hourLabel(hour.time) : ""}</small>)}
        </div>
      </div>
      <div className="wx-all-legend">
        <span><i className="temps" />Cold → hot</span>
        <span>Darker = more rain, wind, clouds, humidity · lower visibility</span>
        {shift && <span><i className="in-shift" />Your shift</span>}
      </div>
    </div>
  );
}

/* ---------- the days ahead ---------- */

const dayName = (date: string, today: string) =>
  date === today ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });

export function Outlook({ days, today, selected, onSelect, icon }: {
  days: DayOutlook[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
  icon: (code: number) => React.ReactNode;
}) {
  if (!days.length) return null;
  const low = min(days.map((day) => day.low));
  const high = max(days.map((day) => day.high));
  const span = Math.max(1, high - low);
  return (
    <ol className="wx-outlook" aria-label="The days ahead">
      {days.map((day) => (
        <li key={day.date}>
          <button type="button" className={day.date === selected ? "on" : ""} aria-pressed={day.date === selected} onClick={() => onSelect(day.date)}>
            <b>{dayName(day.date, today)}</b>
            <span className="wx-outlook-icon">
              {icon(day.code)}
              {day.rainChance >= 20 && <small>{day.rainChance}%</small>}
            </span>
            <span className="wx-outlook-low">{day.low}°</span>
            <span className="wx-outlook-bar">
              <i style={{
                left: `${((day.low - low) / span) * 100}%`,
                right: `${100 - ((day.high - low) / span) * 100}%`,
                background: `linear-gradient(90deg, ${temperatureColor(day.low)}, ${temperatureColor(day.high)})`,
              }} />
            </span>
            <span className="wx-outlook-high">{day.high}°</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
