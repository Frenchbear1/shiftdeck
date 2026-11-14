"use client";

import {
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  Plane,
  Plus,
  Lock,
  RefreshCw,
  Sun,
  Undo2,
  UsersRound,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Flight, Shift } from "./sample-data";
import { addAbeBoardFlights, LiveFlights, LiveMatch, matchLiveFlight, RefreshResult } from "./live-flights";
import {
  analyzeSwap,
  buildCrewTimeline,
  compactTime,
  durationLabel,
  flightBelongsToShift,
  flightMinutesOnShift,
  flightPlace,
  flightTag,
  flightTime,
  minutesToClock,
  offsetContaining,
  SCHEDULE_RANGES,
  ScheduleRange,
  scheduleWindow,
  toMinutes,
} from "./schedule-tools";

/* ---------- popups ---------- */

let backdropPressed = false;

/**
 * Closes a popup when you tap the dimmed area around it. The press has to
 * start and end on the backdrop, so dragging out of a text field or
 * scrolling a sheet never closes it by accident.
 */
export const backdropClose = (close: () => void) => ({
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
    backdropPressed = event.target === event.currentTarget;
  },
  onClick: (event: React.MouseEvent<HTMLElement>) => {
    if (backdropPressed && event.target === event.currentTarget) close();
    backdropPressed = false;
  },
});

/* ---------- shared formatting + people ---------- */

export const formatTime = (time: string) => {
  if (!time) return "—";
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minutes ? "2-digit" : undefined,
  }).format(new Date(2026, 0, 1, hours, minutes));
};

export const formatDate = (date: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("en-US", {
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));

const weekdayOf = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    new Date(`${date}T12:00:00`),
  );

const dayOfMonth = (date: string) => Number(date.slice(8, 10));

const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : name;
};

export const personKey = (person: string) =>
  person.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const GSC_NAME_KEYS = new Set(
  [
    "Allison Osborne",
    "Alyssa Dugan",
    "Chris Williams",
    "Christopher Williams",
    "Connie Phillip",
    "Devin Bauer",
    "Dwight Gardner",
    "Earl Peiffer",
    "Jacob Hoffert",
    "Jakisha Gonzalez",
    "Jason Hudak",
    "Joan Zandarski",
    "Josephine Dutsch",
    "Katrina Jackson",
    "Kim Rawhouser",
    "Kody Hermany",
    "Steven Keiser",
    "Suzete Campos",
    "Tasha Peterson",
    "Tyler Bastian",
  ].map(personKey),
);

export const isGroundSecurityCoordinator = (name: string) =>
  GSC_NAME_KEYS.has(personKey(name));

export function PersonName({ name, label }: { name: string; label?: string }) {
  return (
    <span className="person-name-with-tag">
      <span>{label ?? name}</span>
      {isGroundSecurityCoordinator(name) && <span className="gsc-tag">GSC</span>}
    </span>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function EmptyState({
  icon,
  title,
  copy,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

const localDateTime = (date: string, time: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

const shiftBounds = (date: string, start: string, end: string) => {
  const from = localDateTime(date, start);
  const to = localDateTime(date, end);
  if (to <= from) to.setDate(to.getDate() + 1);
  return [from, to] as const;
};

const spanLabel = (ms: number) => {
  const total = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

/* ---------- today hero ---------- */

export type DayStatus = {
  status: "working" | "off" | "pto" | "none";
  start?: string;
  end?: string;
};

export function TodayHero({
  date,
  isToday,
  now,
  title,
  shift,
  loaded,
  isPto,
  onEdit,
  onAdd,
  onToday,
}: {
  date: string;
  isToday: boolean;
  now: Date;
  title: string;
  shift: { start: string; end: string } | null;
  loaded: boolean;
  isPto: boolean;
  onEdit: () => void;
  onAdd: () => void;
  onToday: () => void;
}) {
  const label = isToday ? `Today · ${formatDate(date)}` : formatDate(date, "long");
  let status: { tone: string; text: string } | null = null;
  let progress = 0;
  if (shift) {
    const [from, to] = shiftBounds(date, shift.start, shift.end);
    if (now < from) {
      status = { tone: "upcoming", text: `Starts in ${spanLabel(from.getTime() - now.getTime())}` };
    } else if (now < to) {
      progress = (now.getTime() - from.getTime()) / (to.getTime() - from.getTime());
      status = { tone: "live", text: `On shift · ${spanLabel(to.getTime() - now.getTime())} left` };
    } else {
      progress = 1;
      status = { tone: "done", text: isToday ? "Done for today" : "Worked" };
    }
  }

  return (
    <section className={`hero-card ${shift ? "is-working" : "is-off"}`} aria-live="polite">
      <div className="hero-top">
        <span className="hero-label">{label}</span>
        <div className="hero-actions">
          {!isToday && (
            <button type="button" className="hero-chip" onClick={onToday}>
              <Undo2 /> Today
            </button>
          )}
          {shift ? (
            <button type="button" className="hero-icon" onClick={onEdit} aria-label="Edit this shift">
              <Pencil />
            </button>
          ) : (
            <button type="button" className="hero-icon" onClick={onAdd} aria-label="Add a shift">
              <Plus />
            </button>
          )}
        </div>
      </div>

      <div className="hero-body" key={`${date}-${shift?.start ?? "off"}-${shift?.end ?? ""}`}>
        <h1 className={shift ? "hero-time" : "hero-off"}>
          {shift ? (
            <>
              <span>{formatTime(shift.start)}</span>
              <i aria-hidden="true">–</i>
              <span>{formatTime(shift.end)}</span>
            </>
          ) : isPto ? (
            "PTO"
          ) : loaded ? (
            isToday ? "Off today" : "Off"
          ) : (
            "No schedule"
          )}
        </h1>
        <p className="hero-sub">
          {shift
            ? `${title} · ${durationLabel(shift.start, shift.end)}`
            : loaded
              ? "Nothing scheduled"
              : "Import a schedule photo to fill this in"}
        </p>

        {shift && (
          <div className="hero-progress" aria-hidden="true">
            <div className="hero-track">
              <i style={{ transform: `scaleX(${progress})` }} />
              {status?.tone === "live" && <b style={{ left: `${progress * 100}%` }} />}
            </div>
            <div className="hero-track-labels">
              <span>{compactTime(shift.start)}</span>
              {status && <em className={`hero-status ${status.tone}`}>{status.text}</em>}
              <span>{compactTime(shift.end)}</span>
            </div>
          </div>
        )}
      </div>

    </section>
  );
}

/* ---------- schedule views ---------- */

export function ScheduleViews({
  range,
  onRange,
  showRanges,
  onShowRanges,
  anchor,
  selectedDate,
  onSelect,
  dayStatus,
  hasSchedule,
}: {
  range: ScheduleRange;
  onRange: (range: ScheduleRange) => void;
  showRanges: boolean;
  onShowRanges: (value: boolean) => void;
  anchor: string;
  selectedDate: string;
  onSelect: (date: string) => void;
  dayStatus: (date: string) => DayStatus;
  hasSchedule: boolean;
}) {
  const [position, setPosition] = useState<{
    offset: number;
    direction: "next" | "prev" | "none";
  }>(() => ({
    offset: offsetContaining(range, anchor, selectedDate),
    direction: "none",
  }));
  const { offset, direction } = position;
  const lastRange = useRef(range);
  const lastAnchor = useRef(anchor);
  const lastSelected = useRef(selectedDate);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the view menu on any tap outside it, or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setMenuOpen(false);
        return;
      }
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  // Keep the selected day in view when the range, today, or the selection
  // changes from outside (e.g. "Today" in the hero or a new import).
  useEffect(() => {
    const rangeChanged = lastRange.current !== range;
    const anchorChanged = lastAnchor.current !== anchor;
    const selectionChanged = lastSelected.current !== selectedDate;
    lastRange.current = range;
    lastAnchor.current = anchor;
    lastSelected.current = selectedDate;
    if (!rangeChanged && !anchorChanged && !selectionChanged) return;
    const target = offsetContaining(range, anchor, selectedDate);
    queueMicrotask(() => {
      setPosition((current) => {
        if (current.offset === target) {
          return rangeChanged ? { offset: target, direction: "none" } : current;
        }
        if (!rangeChanged && !anchorChanged) {
          const visible = scheduleWindow(range, anchor, current.offset).days.some(
            (day) => day.date === selectedDate && day.inMonth,
          );
          if (visible) return current;
        }
        return {
          offset: target,
          direction: rangeChanged ? "none" : target > current.offset ? "next" : "prev",
        };
      });
    });
  }, [anchor, range, selectedDate]);

  const view = useMemo(() => scheduleWindow(range, anchor, offset), [anchor, offset, range]);
  const rangeLabel =
    SCHEDULE_RANGES.find((option) => option.value === range)?.label ?? "Week";
  const page = (amount: number) =>
    setPosition((current) => ({
      offset: current.offset + amount,
      direction: amount > 0 ? "next" : "prev",
    }));
  const showsWeekdays = range !== "3d";

  return (
    <section className="panel schedule-panel">
      <div className="panel-head">
        <h2>Schedule</h2>
        <div className="schedule-tools">
          <div className="range-menu" ref={menuRef}>
            <button
              type="button"
              className={`tool-button ${menuOpen ? "open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`View: ${rangeLabel}`}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <CalendarRange />
              <span>{rangeLabel}</span>
              <ChevronDown className="tool-chevron" />
            </button>
            {menuOpen && (
              <div className="range-popup" role="menu">
                {SCHEDULE_RANGES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={range === option.value}
                    className={range === option.value ? "active" : ""}
                    onClick={() => {
                      onRange(option.value);
                      setMenuOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    {range === option.value && <Check />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`tool-button icon-only ${showRanges ? "on" : ""}`}
            aria-pressed={showRanges}
            aria-label="Show end times"
            title="Show end times"
            onClick={() => onShowRanges(!showRanges)}
          >
            <Clock3 />
          </button>
        </div>
      </div>

      <div className="window-nav">
        <button type="button" onClick={() => page(-1)} aria-label="Previous">
          <ChevronLeft />
        </button>
        <strong>{view.title}</strong>
        <button type="button" onClick={() => page(1)} aria-label="Next">
          <ChevronRight />
        </button>
      </div>

      {!hasSchedule && (
        <p className="schedule-hint">
          <CalendarDays /> Import a schedule photo to fill in your days.
        </p>
      )}

      <div
        className={`schedule-grid range-${range} ${showRanges ? "with-ranges" : ""} slide-${direction}`}
        key={`${range}-${offset}`}
        style={{ ["--columns" as string]: view.columns }}
      >
        {showsWeekdays &&
          view.days.slice(0, 7).map((day) => (
            <span className="grid-weekday" key={`head-${day.date}`}>
              {weekdayOf(day.date).slice(0, range === "month" ? 1 : 3)}
            </span>
          ))}
        {view.days.map((day) => {
          const info = dayStatus(day.date);
          const isToday = day.date === anchor;
          const isPast = day.date < anchor;
          const classes = [
            "day-cell",
            `is-${info.status}`,
            day.date === selectedDate ? "selected" : "",
            isToday ? "today" : "",
            isPast ? "past" : "",
            day.inMonth ? "" : "outside",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={day.date}
              className={classes}
              onClick={() => onSelect(day.date)}
              aria-pressed={day.date === selectedDate}
              aria-label={`${formatDate(day.date, "long")}: ${
                info.status === "working"
                  ? `${formatTime(info.start!)} to ${formatTime(info.end!)}`
                  : info.status === "pto"
                    ? "PTO"
                    : info.status === "off"
                      ? "off"
                      : "no schedule"
              }`}
            >
              <span className="day-top">
                {range === "3d" && <small>{isToday ? "Today" : weekdayOf(day.date)}</small>}
                <b>{dayOfMonth(day.date)}</b>
              </span>
              <span className="day-time">
                {info.status === "working" ? (
                  showRanges ? (
                    <>
                      <span>{compactTime(info.start!)}</span>
                      <span className="day-end">{compactTime(info.end!)}</span>
                    </>
                  ) : (
                    <span>{compactTime(info.start!)}</span>
                  )
                ) : info.status === "pto" ? (
                  <span>PTO</span>
                ) : info.status === "off" ? (
                  <span>Off</span>
                ) : (
                  <span aria-hidden="true">·</span>
                )}
              </span>
              {range === "3d" && info.status === "working" && showRanges && (
                <small className="day-length">{durationLabel(info.start!, info.end!)}</small>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- flights ---------- */

/**
 * Opens the FlightAware app (its own link format, not the website) on the
 * home airport. Three-letter US codes become ICAO ("ABE" → "KABE").
 */
export const flightAwareAirportAppUrl = (
  airport: string,
  tab: "arrivals" | "enroute",
) => {
  const code = airport.trim().toUpperCase() || "ABE";
  const icao = /^[A-Z]{3}$/.test(code) ? `K${code}` : code;
  return `flightaware://airport/${encodeURIComponent(icao)}/${tab}`;
};

export type FlightApp = "flightaware" | "flightradar24";

export const FLIGHT_APP_NAMES: Record<FlightApp, string> = {
  flightaware: "FlightAware",
  flightradar24: "Flightradar24",
};

/**
 * Flightradar24 web links open its app when installed. It uses IATA codes
 * ("KABE" → "abe"), and its boards don't split arrived from en route.
 */
export const flightRadar24AirportUrl = (
  airport: string,
  board: "arrivals" | "departures",
) => {
  const code = airport.trim().toUpperCase() || "ABE";
  const iata = /^K[A-Z]{3}$/.test(code) ? code.slice(1) : code;
  return `https://www.flightradar24.com/data/airports/${encodeURIComponent(
    iata.toLowerCase(),
  )}/${board}`;
};

export function FlightList({
  flights,
  shift,
  date,
  isToday,
  now,
  linkFor,
  airport,
  app = "flightaware",
  live = null,
  onRefresh,
  refreshing = false,
}: {
  flights: Flight[];
  shift: Shift | null | undefined;
  date: string;
  isToday: boolean;
  now: Date;
  linkFor: (flight: Flight) => string;
  airport: string;
  app?: FlightApp;
  /** Shared live times from the worker. */
  live?: LiveFlights | null;
  onRefresh?: (emergency: boolean) => Promise<RefreshResult>;
  refreshing?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [shownFor, setShownFor] = useState(date);
  if (shownFor !== date) {
    setShownFor(date);
    setShowAll(false);
  }
  const boardFlights = useMemo(
    () => /^K?ABE$/i.test(airport) ? addAbeBoardFlights(flights, date, live) : flights,
    [airport, date, flights, live],
  );

  // Live times (when we have them) decide order and "My shift", so a delayed
  // flight moves into or out of your shift with its new time.
  const liveById = useMemo(() => {
    const result = new Map<string, { match: LiveMatch | null; departureMatch: LiveMatch | null; effective: Flight }>();
    for (const flight of boardFlights) {
      const match = matchLiveFlight(flight, flightTime(flight), live);
      const effective = { ...flight };
      let departureMatch: LiveMatch | null = null;
      if (match) {
        if (flight.kind === "departure") effective.departure = match.time;
        else effective.arrival = match.time;
        effective.start = match.time;
      }
      if (flight.kind === "turnaround" && flight.departure) {
        departureMatch = matchLiveFlight(
          { ...flight, kind: "departure" },
          flight.departure,
          live,
        );
        if (departureMatch) {
          effective.departure = departureMatch.time;
          effective.end = departureMatch.time;
        }
      }
      result.set(flight.id, { match, departureMatch, effective });
    }
    return result;
  }, [boardFlights, live]);
  const effectiveOf = (flight: Flight) => liveById.get(flight.id)?.effective ?? flight;
  const sorted = [...boardFlights].sort(
    (a, b) =>
      flightMinutesOnShift(effectiveOf(a), shift) - flightMinutesOnShift(effectiveOf(b), shift),
  );
  const belongsToShift = (flight: Flight) => {
    const live = liveById.get(flight.id)?.match?.live;
    return flightBelongsToShift(
      flight,
      effectiveOf(flight),
      shift,
      live?.estimated ?? live?.scheduled ?? null,
    );
  };
  const inShift = sorted.filter(belongsToShift);
  const canFilter = Boolean(shift) && inShift.length < sorted.length;
  const visible = shift && !showAll ? inShift : sorted;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const appName = FLIGHT_APP_NAMES[app];
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  // Safe to read on first render: the toggle and details only appear once
  // live data has loaded, after hydration.
  const [showDetails, setShowDetails] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(FLIGHT_DETAILS_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Tapping a row opens/closes just that row; the Details button sets all rows.
  const [rowOpen, setRowOpen] = useState<Record<string, boolean>>({});
  const toggleDetails = () => {
    setRowOpen({});
    setShowDetails((current) => {
      try {
        localStorage.setItem(FLIGHT_DETAILS_KEY, current ? "0" : "1");
      } catch {
        // Private mode: keep it for this visit only.
      }
      return !current;
    });
  };
  const [liveHint, setLiveHint] = useState<string | null>(null);
  useEffect(() => {
    if (!liveHint) return;
    const timer = window.setTimeout(() => setLiveHint(null), 3500);
    return () => window.clearTimeout(timer);
  }, [liveHint]);
  const boardUpdated = live?.airportBoardUpdatedAt;
  const updatedAt = boardUpdated ?? live?.updatedAt;
  const liveUpdated = updatedAt ? new Date(updatedAt) : null;
  const liveAge = liveUpdated
    ? Math.max(0, Math.round((now.getTime() - liveUpdated.getTime()) / 60_000))
    : null;
  const status = live?.status ?? null;
  // The saved status can be up to 2 minutes old, so end the cooldown on time here.
  const cooldownOver =
    status?.available === "cooldown" &&
    (!status.nextAt || Date.parse(status.nextAt) <= now.getTime());
  const available = !status
    ? "normal"
    : cooldownOver
      ? status.used < status.dailyLimit
        ? "normal"
        : status.emergencyUsed < status.emergencyLimit
          ? "emergency"
          : "none"
      : status.available;
  const locked = available === "cooldown" || available === "none" || available === "budget";
  const hintFor = (result: RefreshResult) =>
    result === "ok"
      ? null
      : result === "error"
        ? "Couldn’t refresh live flights"
        : "Refresh locked · details in Settings";
  const runRefresh = async (emergency: boolean) => {
    if (!onRefresh) return;
    const result = await onRefresh(emergency);
    if (result === "needs-emergency") setConfirmEmergency(true);
    else setLiveHint(hintFor(result));
  };
  const tapRefresh = () => {
    if (refreshing) return;
    if (locked) setLiveHint("Refresh locked · details in Settings");
    else if (available === "emergency") setConfirmEmergency(true);
    else void runRefresh(false);
  };

  return (
    <section className="panel flights-panel">
      <div className="panel-head">
        <h2>
          Flights <span className="count">{visible.length}</span>
        </h2>
        {canFilter && (
          <div className="pill-toggle" role="group" aria-label="Which flights">
            <button
              type="button"
              className={!showAll ? "active" : ""}
              onClick={() => setShowAll(false)}
            >
              My shift
            </button>
            <button
              type="button"
              className={showAll ? "active" : ""}
              onClick={() => setShowAll(true)}
            >
              All {sorted.length}
            </button>
          </div>
        )}
      </div>

      <div className="flightaware-links" role="group" aria-label={`${airport} in ${appName}`}>
        {app === "flightradar24" ? (
          <>
            <a
              href={flightRadar24AirportUrl(airport, "arrivals")}
              aria-label={`Open ${airport} arrivals in Flightradar24`}
            >
              <small>{airport}</small>
              <b>Arrivals</b>
            </a>
            <a
              href={flightRadar24AirportUrl(airport, "departures")}
              aria-label={`Open ${airport} departures in Flightradar24`}
            >
              <small>{airport}</small>
              <b>Departures</b>
            </a>
          </>
        ) : (
          <>
            <a
              href={flightAwareAirportAppUrl(airport, "arrivals")}
              aria-label={`Open ${airport} arrived flights in FlightAware`}
            >
              <small>{airport}</small>
              <b>Arrived</b>
            </a>
            <a
              href={flightAwareAirportAppUrl(airport, "enroute")}
              aria-label={`Open ${airport} scheduled to arrive flights in FlightAware`}
            >
              <small>{airport}</small>
              <b>Scheduled to arrive</b>
            </a>
          </>
        )}
      </div>

      {live && (
        <div className="flight-live-note">
          <span className="flight-live-dot" aria-hidden="true" />
          <p>
            {liveHint ??
              (liveUpdated
                ? `${boardUpdated ? "ABE board · " : ""}${liveAge! >= 15 ? "Last checked" : "Updated"} ${formatTime(
                    `${String(liveUpdated.getHours()).padStart(2, "0")}:${String(
                      liveUpdated.getMinutes(),
                    ).padStart(2, "0")}`,
                  )} · ${liveAge! < 1 ? "just now" : `${liveAge} min ago`}`
                : "No live times yet")}
          </p>
          <button
            type="button"
            className={`flight-details-toggle ${showDetails ? "active" : ""}`}
            onClick={toggleDetails}
            aria-pressed={showDetails}
          >
            Details
          </button>
          <button
            type="button"
            className={`flight-refresh ${locked ? "locked" : ""} ${refreshing ? "spinning" : ""}`}
            onClick={tapRefresh}
            aria-label={
              locked
                ? "Refresh locked, see Settings"
                : available === "emergency"
                  ? "Emergency FlightAware refresh"
                  : status
                    ? "Refresh from FlightAware"
                    : "Check for live flight updates"
            }
          >
            {locked ? <Lock /> : <RefreshCw />}
          </button>
        </div>
      )}

      {confirmEmergency && (
        <div className="modal-layer" role="presentation" {...backdropClose(() => setConfirmEmergency(false))}>
          <section className="confirm-card" role="alertdialog" aria-modal="true" aria-label="Use an emergency refresh?">
            <span className="confirm-icon"><RefreshCw /></span>
            <h2>Use an emergency refresh?</h2>
            <p>
              Today’s {live?.status?.dailyLimit ?? 10} refreshes are used up.{" "}
              {live?.status
                ? `${live.status.emergencyLimit - live.status.emergencyUsed} emergency refresh${
                    live.status.emergencyLimit - live.status.emergencyUsed === 1 ? "" : "es"
                  } left for everyone today.`
                : ""}
            </p>
            <div>
              <button className="button soft" onClick={() => setConfirmEmergency(false)}>Cancel</button>
              <button
                className="button primary"
                onClick={() => {
                  setConfirmEmergency(false);
                  void runRefresh(true);
                }}
              >
                Use emergency refresh
              </button>
            </div>
          </section>
        </div>
      )}

      {visible.length ? (
        <ul className="flight-rows">
          {visible.map((flight) => {
            const tag = flightTag(flight);
            const expanded = rowOpen[flight.id] ?? showDetails;
            const during = belongsToShift(flight);
            const scheduledTime = flightTime(flight);
            const match = liveById.get(flight.id)?.match ?? null;
            const out = liveById.get(flight.id)?.departureMatch ?? null;
            const time = match?.time ?? scheduledTime;
            let shift24 = toMinutes(time) - toMinutes(scheduledTime);
            if (shift24 > 720) shift24 -= 1440;
            if (shift24 < -720) shift24 += 1440;
            const changed = Boolean(match) && Math.abs(shift24) >= 3;
            const timeTone = match?.live.cancelled
              ? "cancelled"
              : !changed
                ? ""
                : shift24 > 30
                  ? "late"
                  : shift24 > 0
                    ? "behind"
                    : "early";
            let minutes = toMinutes(time);
            if (shift && toMinutes(shift.start) > 720 && minutes < 360) minutes += 1440;
            const past = isToday && minutes + 20 < nowMinutes;
            return (
              <li
                key={flight.id}
                className={`flight-card ${expanded ? "expanded" : ""} ${during ? "in-shift" : ""} ${past ? "past" : ""}`}
              >
                <button
                  type="button"
                  className="flight-row"
                  aria-expanded={expanded}
                  onClick={() =>
                    setRowOpen((current) => ({ ...current, [flight.id]: !expanded }))
                  }
                  aria-label={`${tag === "Turn" ? "Turn" : tag === "RON" ? "RON" : "Departure"} ${
                    tag === "Out" ? "to" : "from"
                  } ${flightPlace(flight)}${
                    tag === "Turn" && (flight.outboundAirport ?? flight.destination)
                      ? ` to ${flight.outboundAirport ?? flight.destination}`
                      : ""
                  } at ${formatTime(time)}${
                    changed ? `, scheduled ${formatTime(scheduledTime)}` : ""
                  }${match?.label ? `, ${match.label}` : ""}. ${expanded ? "Hide" : "Show"} details`}
                >
                  <span className={`flight-time ${timeTone}`}>
                    <time>{formatTime(time)}</time>
                    {changed && <s>{formatTime(scheduledTime)}</s>}
                  </span>
                  <span className="flight-place">
                    <small>{tag === "Out" ? "to" : "from"}</small>
                    {flightPlace(flight)}
                    {tag === "Turn" && (flight.outboundAirport ?? flight.destination) && (
                      <>
                        <small className="place-to">to</small>
                        {flight.outboundAirport ?? flight.destination}
                      </>
                    )}
                  </span>
                  {match?.label && (
                    <span className={`flight-live ${timeTone}`}>{match.label}</span>
                  )}
                  {match?.live.gate && (
                    <span className="flight-gate" aria-label={`Gate ${match.live.gate}`}>
                      <small>Gate</small>
                      {match.live.gate}
                    </span>
                  )}
                  <span className={`flight-tag tag-${tag.toLowerCase()}`}>{tag}</span>
                </button>
                {expanded && (
                  <div className="flight-expand">
                    {live ? (
                      <div className="flight-details">
                        <FlightDetails flight={flight} match={match} boardUpdatedAt={boardUpdated} />
                        {out && (
                          <span>
                            Out {formatTime(out.time)}
                            {out.live.gate && ` · Gate ${out.live.gate}`}
                            {out.label && ` · ${out.label}`}
                          </span>
                        )}
                      </div>
                    ) : <span />}
                    <a
                      className="flight-open"
                      href={linkFor(flight)}
                      target="_self"
                      aria-label={`Open in ${appName}`}
                    >
                      Open
                      <ArrowUpRight />
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="quiet-line">
          <Plane />
          {sorted.length
            ? "No flights during your shift."
            : "No flights listed for this day."}
        </p>
      )}
    </section>
  );
}

const FLIGHT_DETAILS_KEY = "shiftdeck.flightDetails";

const clockFromIso = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatTime(
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  );
};

const flightNumber = (ident: string) => {
  const match = ident.match(/^([A-Z0-9]{2})(\d+)$/);
  return match ? `${match[1]} ${match[2]}` : ident;
};

/** The extra lines a flight row shows when Details is on. */
function FlightDetails({
  flight,
  match,
  boardUpdatedAt,
}: {
  flight: Flight;
  match: ReturnType<typeof matchLiveFlight>;
  boardUpdatedAt?: string | null;
}) {
  if (!match) {
    return <span className="flight-details muted">No live info for this flight yet</span>;
  }
  const live = match.live;
  const place = flightPlace(flight);
  const facts = [
    live.ident ? flightNumber(live.ident) : null,
    [live.aircraft, live.registration].filter(Boolean).join(" · ") || null,
    live.baggage ? `Bags: claim ${live.baggage}` : null,
  ].filter(Boolean);
  const droppedOff = live.airportBoardSeenAt && boardUpdatedAt && live.airportBoardSeenAt < Date.parse(boardUpdatedAt);

  let progressLine: string | null = null;
  if (live.cancelled) {
    progressLine = "Cancelled";
  } else if (live.kind === "arrival") {
    const landed = clockFromIso(live.landedAt);
    const atGate = clockFromIso(live.atGateAt);
    const tookOff = clockFromIso(live.tookOffAt ?? live.leftGateAt);
    if (landed || atGate) {
      progressLine = [landed && `Landed ${landed}`, atGate && `at gate ${atGate}`]
        .filter(Boolean)
        .join(" · ");
    } else if (live.airportBoardId && live.status) {
      progressLine = live.status;
    } else if (live.done) {
      progressLine = "Landed";
    } else if (tookOff) {
      progressLine = `Left ${place} ${tookOff}`;
    } else {
      progressLine = `Not left ${place} yet`;
    }
  } else {
    const leftGate = clockFromIso(live.leftGateAt);
    const tookOff = clockFromIso(live.tookOffAt);
    progressLine = leftGate || tookOff
      ? [leftGate && `Left gate ${leftGate}`, tookOff && `took off ${tookOff}`]
          .filter(Boolean)
          .join(" · ")
      : live.airportBoardId && live.status
        ? live.status
        : live.done
        ? "Left"
        : null;
  }

  if (match.tracked) {
    const landing = clockFromIso(match.tracked.landing);
    const gate = clockFromIso(match.tracked.gate);
    progressLine = `Tracking ${Math.round(match.tracked.distanceNm)} nm out · lands ~${landing} · gate ~${gate}`;
  }
  const delay = match.tracked ? match.delay : live.delayMinutes ?? (live.airportBoardId ? null : match.delay);
  const delayText =
    live.cancelled || delay === null || Math.abs(delay) < 3
      ? delay !== null && Math.abs(delay) < 3 && !live.cancelled && !live.airportBoardId
        ? "On time"
        : null
      : delay > 0
        ? `${delay} min late`
        : `${-delay} min early`;
  const flying =
    live.kind === "arrival" &&
    !live.done &&
    !live.landedAt &&
    typeof live.progress === "number" &&
    live.progress > 0 &&
    live.progress < 100;

  return (
    <span className="flight-details">
      {facts.length > 0 && <span>{facts.join(" · ")}</span>}
      {(progressLine || delayText) && (
        <span>
          {[progressLine, delayText].filter(Boolean).join(" · ")}
        </span>
      )}
      {droppedOff && !live.done && !live.cancelled && (
        <span>Last shown on ABE board at {clockFromIso(new Date(live.airportBoardSeenAt!).toISOString())}</span>
      )}
      {flying && (
        <span className="flight-progress" aria-label={`${live.progress}% of the way`}>
          <i style={{ width: `${live.progress}%` }} />
        </span>
      )}
    </span>
  );
}

/* ---------- crew ---------- */

export function CrewPanel({
  shifts,
  person,
  myShift,
  isToday,
  now,
}: {
  shifts: Shift[];
  person: string;
  myShift: Shift | null | undefined;
  isToday: boolean;
  now: Date;
}) {
  const timeline = useMemo(
    () => buildCrewTimeline(shifts, person, myShift),
    [myShift, person, shifts],
  );
  const crewCount = timeline
    ? timeline.rows
        .filter((row) => row.relation !== "mine")
        .reduce((total, row) => total + row.workers.length, 0)
    : 0;

  let nowLeft: number | null = null;
  if (timeline && isToday) {
    let minutes = now.getHours() * 60 + now.getMinutes();
    if (timeline.axisStart > 720 && minutes < timeline.axisStart - 720) minutes += 1440;
    const span = timeline.axisEnd - timeline.axisStart;
    const left = ((minutes - timeline.axisStart) / span) * 100;
    if (left >= 0 && left <= 100) nowLeft = left;
  }

  return (
    <section className="panel crew-panel">
      <div className="panel-head">
        <h2>
          {myShift ? "Crew" : "Working"} <span className="count">{crewCount}</span>
        </h2>
        {!myShift && timeline && <span className="panel-note">You’re off</span>}
      </div>

      {timeline ? (
        <div
          className={`crew-chart ${nowLeft === null ? "" : "has-now"} ${timeline.band ? "has-band" : ""}`}
          style={{
            ["--now" as string]: `${nowLeft ?? 0}%`,
            ["--band-left" as string]: `${timeline.band?.left ?? 0}%`,
            ["--band-width" as string]: `${timeline.band?.width ?? 0}%`,
          }}
        >
          <div className="crew-axis" aria-hidden="true">
            {timeline.ticks.map((tick) => (
              <span key={tick.minutes} style={{ left: `${tick.left}%` }}>
                {compactTime(minutesToClock(tick.minutes))}
              </span>
            ))}
          </div>
          <div className="crew-rows">
            {timeline.rows.map((row) => (
              <div className={`crew-row relation-${row.relation}`} key={row.key}>
                <div className="crew-row-text">
                  <span className="crew-names">
                    {row.relation === "mine"
                      ? "You"
                      : row.workers.map((worker, index) => (
                          <span key={worker}>
                            {index > 0 && ", "}
                            <PersonName name={worker} label={shortName(worker)} />
                          </span>
                        ))}
                  </span>
                  <span className="crew-hours">
                    {compactTime(row.start)}–{compactTime(row.end)}
                  </span>
                </div>
                <div className="crew-track">
                  <i style={{ left: `${row.left}%`, width: `${Math.max(row.width, 2)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="quiet-line">
          {myShift ? <UsersRound /> : <Sun />}
          {myShift ? "Nobody else overlaps your shift." : "Nobody is scheduled this day."}
        </p>
      )}
    </section>
  );
}

/* ---------- swap sheet ---------- */

export function SwapSheet({
  shifts,
  person,
  dates,
  initialOffDate,
  onClose,
}: {
  shifts: Shift[];
  person: string;
  dates: string[];
  initialOffDate: string;
  onClose: () => void;
}) {
  const myDays = useMemo(() => {
    const map = new Map<string, Shift>();
    shifts.forEach((shift) => {
      if (shift.worker === person) map.set(shift.date, shift);
    });
    return map;
  }, [person, shifts]);
  const workDays = dates.filter((date) => myDays.get(date)?.status === "working");
  const freeDays = dates.filter((date) => {
    const mine = myDays.get(date);
    return !mine || mine.status === "off";
  });

  const [offDate, setOffDate] = useState(() =>
    workDays.includes(initialOffDate) ? initialOffDate : workDays[0] ?? "",
  );
  const [swapDate, setSwapDate] = useState<string | null>(null);

  const analysis = useMemo(
    () =>
      offDate
        ? analyzeSwap({ shifts, person, offDate, swapDate, candidateDates: freeDays })
        : null,
    // freeDays is derived from shifts + dates
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offDate, person, shifts, swapDate, dates],
  );

  const myOffShift = offDate ? myDays.get(offDate) : undefined;

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section
        className="panel-sheet swap-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Shift swap"
       
      >
        <header className="sheet-head">
          <div>
            <h2>Shift swap</h2>
            <p>Trade a day you work for a day you’re off.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close shift swap">
            <X />
          </button>
        </header>

        {!workDays.length ? (
          <EmptyState
            icon={<CalendarDays />}
            title="No upcoming shifts"
            copy="Import a schedule with days you’re working to find a swap."
          />
        ) : (
          <div className="sheet-scroll">
            <div className="swap-step">
              <span className="step-label">
                <b>1</b> Day you want off
              </span>
              <div className="chip-rail">
                {workDays.map((date) => {
                  const mine = myDays.get(date)!;
                  return (
                    <button
                      type="button"
                      key={date}
                      className={`date-chip ${offDate === date ? "active" : ""}`}
                      onClick={() => {
                        setOffDate(date);
                        if (swapDate === date) setSwapDate(null);
                      }}
                    >
                      <small>{weekdayOf(date)}</small>
                      <b>{dayOfMonth(date)}</b>
                      <span>{compactTime(mine.start)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="swap-step">
              <span className="step-label">
                <b>2</b> Day you’ll work instead
              </span>
              <div className="chip-rail">
                <button
                  type="button"
                  className={`date-chip any ${swapDate === null ? "active" : ""}`}
                  onClick={() => setSwapDate(null)}
                >
                  <b>Any</b>
                  <span>day off</span>
                </button>
                {freeDays.map((date) => (
                  <button
                    type="button"
                    key={date}
                    className={`date-chip ${swapDate === date ? "active" : ""}`}
                    onClick={() => setSwapDate(date)}
                  >
                    <small>{weekdayOf(date)}</small>
                    <b>{dayOfMonth(date)}</b>
                    <span>Off</span>
                  </button>
                ))}
              </div>
            </div>

            {analysis && myOffShift && (
              <div className="swap-results">
                <p className="swap-summary">
                  Giving up <b>{formatDate(offDate)}</b> ·{" "}
                  {formatTime(myOffShift.start)} – {formatTime(myOffShift.end)}
                  {swapDate && (
                    <>
                      {" "}for <b>{formatDate(swapDate)}</b>
                    </>
                  )}
                </p>

                {analysis.matches.length ? (
                  <ul className="match-list">
                    {analysis.matches.map((match, index) => (
                      <li className={`match-card ${index === 0 ? "best" : ""}`} key={match.worker}>
                        <div className="match-top">
                          <span className={`person-avatar tone-${index % 4}`}>
                            {initials(match.worker)}
                          </span>
                          <div className="match-name">
                            <b>
                              <PersonName name={match.worker} />
                            </b>
                            <small>
                              <Check /> {match.offDayStatus === "off" ? "Off" : "Not scheduled"}{" "}
                              {weekdayOf(offDate)}
                            </small>
                          </div>
                          <span className="match-score" style={{ ["--score" as string]: match.score }}>
                            <b>{match.score}</b>
                            <small>match</small>
                          </span>
                        </div>
                        <div className="match-days">
                          {match.swapDays.slice(0, swapDate ? 1 : 4).map((day) => (
                            <button
                              type="button"
                              key={day.date}
                              className={swapDate === day.date ? "active" : ""}
                              onClick={() => setSwapDate(day.date)}
                              title="Use this day"
                            >
                              <ArrowLeftRight />
                              <span>
                                You work {weekdayOf(day.date)} {dayOfMonth(day.date)}
                              </span>
                              <b>
                                {compactTime(day.start)}–{compactTime(day.end)}
                              </b>
                            </button>
                          ))}
                          {!swapDate && match.swapDays.length > 4 && (
                            <small>+{match.swapDays.length - 4} more days</small>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={<UsersRound />}
                    title="No even trade found"
                    copy={
                      swapDate
                        ? "Nobody who is free that day works on the day you picked. Try Any."
                        : "Nobody free that day works on one of your days off."
                    }
                  />
                )}

                {analysis.coverOnly.length > 0 && (
                  <details className="cover-only">
                    <summary>
                      <span>
                        Free to cover, no trade day
                        <small>{analysis.coverOnly.length} people</small>
                      </span>
                      <ChevronDown />
                    </summary>
                    <ul>
                      {analysis.coverOnly.map((match) => (
                        <li key={match.worker}>
                          <PersonName name={match.worker} />
                          <small>
                            Usually {compactTime(minutesToClock(match.usualStart))}–
                            {compactTime(minutesToClock(match.usualEnd))}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <p className="swap-method">
                  Matches are free on your day off and working on a day you’re
                  off. Scores favor a shift close to yours. PTO is never suggested.
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- name merging ---------- */

export function NameMergeSheet({
  suggestions,
  merges,
  person,
  onMerge,
  onDismiss,
  onUndo,
  onClose,
}: {
  suggestions: Array<{ from: string; to: string }>;
  merges: Array<{ from: string; to: string }>;
  person: string;
  onMerge: (from: string, to: string) => void;
  onDismiss: (from: string, to: string) => void;
  onUndo: (from: string) => void;
  onClose: () => void;
}) {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section
        className="panel-sheet name-merge-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Coworker names"
      >
        <header className="sheet-head">
          <div>
            <h2>Coworker names</h2>
            <p>Names that look like one person read two ways.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close coworker names">
            <X />
          </button>
        </header>
        <div className="sheet-scroll">
          {suggestions.length ? (
            <ul className="merge-suggestions">
              {suggestions.map((pair) => {
                const pairKey = `${pair.from}|${pair.to}`;
                // Your own name is always the one kept.
                const reverse =
                  flipped[pairKey] !== undefined ? flipped[pairKey] : pair.from === person;
                const drop = reverse ? pair.to : pair.from;
                const keep = reverse ? pair.from : pair.to;
                return (
                  <li key={pairKey}>
                    <div className="merge-pair">
                      <span className="merge-drop">{drop}</span>
                      <button
                        type="button"
                        className="merge-flip"
                        onClick={() =>
                          setFlipped((current) => ({ ...current, [pairKey]: !reverse }))
                        }
                        aria-label={`Keep ${drop} instead`}
                        title="Swap which name is kept"
                      >
                        <ArrowLeftRight />
                      </button>
                      <span className="merge-keep">
                        <PersonName name={keep} />
                      </span>
                    </div>
                    <div className="merge-actions">
                      <button
                        type="button"
                        className="button soft"
                        onClick={() => onMerge(drop, keep)}
                      >
                        <Check /> Merge
                      </button>
                      <button
                        type="button"
                        className="merge-dismiss"
                        onClick={() => onDismiss(pair.from, pair.to)}
                      >
                        Different people
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<UsersRound />}
              title="No look-alike names"
              copy="Every name on your schedule looks unique."
            />
          )}

          {merges.length > 0 && (
            <div className="merge-done-block">
              <span className="merge-done-title">Merged</span>
              <ul className="merge-done">
                {merges.map((merge) => (
                  <li key={merge.from}>
                    <span>
                      <s>{merge.from}</s> → {merge.to}
                    </span>
                    <button type="button" onClick={() => onUndo(merge.from)}>
                      <Undo2 /> Undo
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
