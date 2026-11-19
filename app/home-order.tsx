"use client";

import { CalendarDays, Clock3, CloudSun, MapPin, Plane, Timer, Users } from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

export const HOME_TILES = {
  today: "Today",
  clock: "Time clock",
  schedule: "Schedule",
  flights: "Flights",
  map: "Live map",
  weather: "Weather",
  crew: "Crew",
} as const;
export type HomeTile = keyof typeof HOME_TILES;
export const DEFAULT_HOME_ORDER = Object.keys(HOME_TILES) as HomeTile[];

const ICONS: Record<HomeTile, ReactNode> = {
  today: <Clock3 />,
  clock: <Timer />,
  schedule: <CalendarDays />,
  flights: <Plane />,
  map: <MapPin />,
  weather: <CloudSun />,
  crew: <Users />,
};

const SHORT: Record<HomeTile, string> = {
  today: "Today",
  clock: "Clock",
  schedule: "Schedule",
  flights: "Flights",
  map: "Map",
  weather: "Weather",
  crew: "Crew",
};

export const moveTile = (order: HomeTile[], tile: HomeTile, to: number) => {
  const from = order.indexOf(tile);
  const target = Math.max(0, Math.min(order.length - 1, to));
  if (from < 0 || from === target) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(target, 0, tile);
  return next;
};

/**
 * Home sections as a row of icons, in Home Screen order. Drag one sideways to
 * a new spot; it saves when you let go. Arrow keys move the focused one.
 */
export function HomeOrderRow({ order, onChange }: {
  order: HomeTile[];
  onChange: (order: HomeTile[]) => void;
}) {
  const row = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{
    tile: HomeTile; pointer: number; startX: number; dx: number; slot: number;
  } | null>(null);

  const from = drag ? order.indexOf(drag.tile) : -1;
  const to = drag ? Math.max(0, Math.min(order.length - 1, from + Math.round(drag.dx / drag.slot))) : -1;
  const offsetFor = (index: number) => {
    if (!drag) return 0;
    if (index === from) return drag.dx;
    if (from < to && index > from && index <= to) return -drag.slot;
    if (to < from && index >= to && index < from) return drag.slot;
    return 0;
  };
  const isDefault = order.every((tile, index) => tile === DEFAULT_HOME_ORDER[index]);

  return (
    <div className="home-order">
      <div className="home-order-head">
        <span>Home layout</span>
        {isDefault ? <small>Drag to reorder</small> : (
          <button type="button" onClick={() => onChange(DEFAULT_HOME_ORDER)}>Reset</button>
        )}
      </div>
      <ol className="home-order-row" ref={row} aria-label="Home Screen sections, in order">
        {order.map((tile, index) => (
          <li
            key={tile}
            className={drag?.tile === tile ? "dragging" : ""}
            style={{ "--shift": `${offsetFor(index)}px` } as CSSProperties}
          >
            <button
              type="button"
              aria-label={`${HOME_TILES[tile]}, position ${index + 1} of ${order.length}. Use arrow keys to move.`}
              onPointerDown={(event) => {
                if (event.pointerType === "mouse" && event.button !== 0) return;
                const width = row.current?.getBoundingClientRect().width ?? 0;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({
                  tile, pointer: event.pointerId, startX: event.clientX, dx: 0,
                  slot: Math.max(1, width / order.length),
                });
              }}
              onPointerMove={(event) => {
                if (drag?.pointer !== event.pointerId) return;
                const dx = event.clientX - drag.startX;
                const limit = drag.slot * order.length;
                setDrag({ ...drag, dx: Math.max(-limit, Math.min(limit, dx)) });
              }}
              onPointerUp={(event) => {
                if (drag?.pointer !== event.pointerId) return;
                setDrag(null);
                if (to !== from) onChange(moveTile(order, drag.tile, to));
              }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(event) => {
                const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
                  : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
                if (!step) return;
                event.preventDefault();
                onChange(moveTile(order, tile, index + step));
              }}
            >
              {ICONS[tile]}
              <span>{SHORT[tile]}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
