"use client";

import { CalendarDays, Clock3, CloudSun, GripVertical, MapPin, Plane, Timer, Users } from "lucide-react";
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
 * The Home Screen sections as a list, top to bottom as they appear. Drag one
 * by its handle to a new spot; arrow keys move the focused one.
 */
export function HomeOrderList({ order, onChange }: {
  order: HomeTile[];
  onChange: (order: HomeTile[]) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ tile: HomeTile; pointer: number; startY: number; dy: number; slot: number } | null>(null);
  const from = drag ? order.indexOf(drag.tile) : -1;
  const to = drag ? Math.max(0, Math.min(order.length - 1, from + Math.round(drag.dy / drag.slot))) : -1;
  const offsetFor = (index: number) => {
    if (!drag) return 0;
    if (index === from) return drag.dy;
    if (from < to && index > from && index <= to) return -drag.slot;
    if (to < from && index >= to && index < from) return drag.slot;
    return 0;
  };
  return (
    <ol className="home-order-list" ref={list} aria-label="Home Screen sections, top to bottom">
      {order.map((tile, index) => (
        <li
          key={tile}
          className={drag?.tile === tile ? "dragging" : ""}
          style={{ "--shift": `${offsetFor(index)}px` } as CSSProperties}
        >
          <span className="home-order-icon">{ICONS[tile]}</span>
          <span className="home-order-name">{HOME_TILES[tile]}</span>
          <small>{index + 1}</small>
          <button
            type="button"
            className="home-order-handle"
            aria-label={`Move ${HOME_TILES[tile]}, position ${index + 1} of ${order.length}. Drag, or use the arrow keys.`}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              const height = list.current?.getBoundingClientRect().height ?? 0;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({ tile, pointer: event.pointerId, startY: event.clientY, dy: 0, slot: Math.max(1, height / order.length) });
            }}
            onPointerMove={(event) => {
              if (drag?.pointer !== event.pointerId) return;
              const limit = drag.slot * order.length;
              setDrag({ ...drag, dy: Math.max(-limit, Math.min(limit, event.clientY - drag.startY)) });
            }}
            onPointerUp={(event) => {
              if (drag?.pointer !== event.pointerId) return;
              setDrag(null);
              if (to !== from) onChange(moveTile(order, drag.tile, to));
            }}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(event) => {
              const step = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1
                : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
              if (!step) return;
              event.preventDefault();
              onChange(moveTile(order, tile, index + step));
            }}
          >
            <GripVertical />
          </button>
        </li>
      ))}
    </ol>
  );
}
