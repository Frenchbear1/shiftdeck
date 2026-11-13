"use client";

import { Calendar, Check, Clock3, Moon, Trash2, X } from "lucide-react";
import {
  Dispatch,
  ReactNode,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { backdropClose } from "./home-sections";

export type ShiftEditorDraft = {
  title: string;
  date: string;
  start: string;
  end: string;
};

type Field = "date" | "start" | "end";

const ITEM_HEIGHT = 38;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const pad = (value: number) => String(value).padStart(2, "0");
const daysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

const parseDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const now = new Date();
  return {
    year: year || now.getFullYear(),
    month: (month || now.getMonth() + 1) - 1,
    day: day || now.getDate(),
  };
};

const parseTime = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return { hour12: hours % 12 || 12, minute: minutes, pm: hours >= 12 };
};

const toTime = (hour12: number, minute: number, pm: boolean) =>
  `${pad((hour12 % 12) + (pm ? 12 : 0))}:${pad(minute)}`;

const minutesOf = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const formatTime = (time: string) => {
  const { hour12, minute, pm } = parseTime(time);
  return `${hour12}:${pad(minute)} ${pm ? "PM" : "AM"}`;
};

const formatDate = (date: string, withYear = true) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(new Date(`${date}T12:00:00`));

const nextDay = (date: string) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + 1);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
};

/** One iOS-style scroll wheel column. */
function Wheel({
  items,
  index,
  onIndex,
  label,
  align = "center",
}: {
  items: string[];
  index: number;
  onIndex: (index: number) => void;
  label: string;
  align?: "start" | "center" | "end";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);
  const [live, setLive] = useState(index);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setLive(index);
    if (Math.abs(element.scrollTop - index * ITEM_HEIGHT) > 2) {
      element.scrollTop = index * ITEM_HEIGHT;
    }
  }, [index, items.length]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  const clampIndex = (value: number) =>
    Math.max(0, Math.min(items.length - 1, value));

  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    setLive(clampIndex(Math.round(element.scrollTop / ITEM_HEIGHT)));
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const next = clampIndex(Math.round(element.scrollTop / ITEM_HEIGHT));
      if (next !== index) onIndex(next);
    }, 110);
  };

  const step = (direction: number) => {
    const next = clampIndex(index + direction);
    if (next !== index) onIndex(next);
  };

  return (
    <div
      ref={ref}
      className={`wheel wheel-${align} ${label === "Month" ? "wheel-month" : ""}`}
      onScroll={onScroll}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuetext={items[index]}
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          step(1);
        }
      }}
    >
      {items.map((item, itemIndex) => {
        const distance = Math.min(Math.abs(itemIndex - live), 3);
        return (
          <button
            type="button"
            tabIndex={-1}
            key={`${item}-${itemIndex}`}
            className={itemIndex === live ? "selected" : ""}
            data-distance={distance}
            onClick={() =>
              ref.current?.scrollTo({
                top: itemIndex * ITEM_HEIGHT,
                behavior: "smooth",
              })
            }
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

function WheelGroup({ children }: { children: ReactNode }) {
  return (
    <div className="wheel-group">
      <div className="wheel-band" aria-hidden="true" />
      {children}
    </div>
  );
}

function DateWheels({
  value,
  onChange,
}: {
  value: string;
  onChange: (date: string) => void;
}) {
  const { year, month, day } = parseDate(value);
  const thisYear = new Date().getFullYear();
  const firstYear = Math.min(thisYear - 1, year);
  const years = Array.from(
    { length: Math.max(thisYear + 2, year) - firstYear + 1 },
    (_, offset) => firstYear + offset,
  );
  const dayCount = daysInMonth(year, month);
  const set = (nextYear: number, nextMonth: number, nextDay: number) =>
    onChange(
      `${nextYear}-${pad(nextMonth + 1)}-${pad(
        Math.min(nextDay, daysInMonth(nextYear, nextMonth)),
      )}`,
    );

  return (
    <WheelGroup>
      <Wheel
        label="Month"
        align="start"
        items={MONTHS}
        index={month}
        onIndex={(next) => set(year, next, day)}
      />
      <Wheel
        label="Day"
        items={Array.from({ length: dayCount }, (_, i) => String(i + 1))}
        index={Math.min(day, dayCount) - 1}
        onIndex={(next) => set(year, month, next + 1)}
      />
      <Wheel
        label="Year"
        align="end"
        items={years.map(String)}
        index={years.indexOf(year)}
        onIndex={(next) => set(years[next], month, day)}
      />
    </WheelGroup>
  );
}

function TimeWheels({
  value,
  onChange,
}: {
  value: string;
  onChange: (time: string) => void;
}) {
  const { hour12, minute, pm } = parseTime(value);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!minutes.includes(minute)) {
    minutes.push(minute);
    minutes.sort((a, b) => a - b);
  }
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <WheelGroup>
      <Wheel
        label="Hour"
        align="end"
        items={hours.map(String)}
        index={hour12 - 1}
        onIndex={(next) => onChange(toTime(hours[next], minute, pm))}
      />
      <Wheel
        label="Minute"
        items={minutes.map(pad)}
        index={minutes.indexOf(minute)}
        onIndex={(next) => onChange(toTime(hour12, minutes[next], pm))}
      />
      <Wheel
        label="AM or PM"
        align="start"
        items={["AM", "PM"]}
        index={pm ? 1 : 0}
        onIndex={(next) => onChange(toTime(hour12, minute, next === 1))}
      />
    </WheelGroup>
  );
}

export function ShiftEditorSheet({
  mode,
  draft,
  setDraft,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "add" | "edit";
  draft: ShiftEditorDraft;
  setDraft: Dispatch<SetStateAction<ShiftEditorDraft>>;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<Field | null>(mode === "add" ? "start" : null);
  const update = (patch: Partial<ShiftEditorDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const startMinutes = minutesOf(draft.start);
  const endMinutes = minutesOf(draft.end);
  const overnight = endMinutes <= startMinutes;
  const duration = (endMinutes - startMinutes + (overnight ? 1440 : 0)) % 1440 || 1440;

  const rows: { field: Field; label: string; icon: ReactNode; value: string; badge?: string }[] = [
    { field: "date", label: "Date", icon: <Calendar />, value: formatDate(draft.date) },
    { field: "start", label: "Starts", icon: <Clock3 />, value: formatTime(draft.start) },
    {
      field: "end",
      label: "Ends",
      icon: overnight ? <Moon /> : <Clock3 />,
      value: formatTime(draft.end),
      badge: overnight ? "+1 day" : undefined,
    },
  ];

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section
        className="shift-sheet shift-editor"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "Edit shift" : "Add shift"}
      >
        <header>
          <div>
            <small>{formatDate(draft.date, false)}</small>
            <h2>{mode === "edit" ? "Edit shift" : "Add a shift"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close shift editor"><X /></button>
        </header>

        <input
          className="shift-editor-title"
          type="text"
          value={draft.title}
          onChange={(event) => update({ title: event.target.value })}
          placeholder="Shift title"
          aria-label="Shift title"
        />

        <div className="shift-editor-card">
          {rows.map((row) => (
            <div key={row.field} className={`shift-editor-row ${open === row.field ? "open" : ""}`}>
              <button
                type="button"
                className="shift-editor-row-button"
                onClick={() => setOpen((current) => (current === row.field ? null : row.field))}
                aria-expanded={open === row.field}
              >
                <span className="shift-editor-row-icon">{row.icon}</span>
                <span className="shift-editor-row-label">{row.label}</span>
                {row.badge && <i>{row.badge}</i>}
                <b>{row.value}</b>
              </button>
              {open === row.field && (
                <div className="shift-editor-wheels">
                  {row.field === "date" ? (
                    <DateWheels value={draft.date} onChange={(date) => update({ date })} />
                  ) : (
                    <TimeWheels
                      value={row.field === "start" ? draft.start : draft.end}
                      onChange={(time) => update({ [row.field]: time })}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="shift-editor-summary">
          <b>{formatDuration(duration)}</b>
          {overnight
            ? ` · ends ${formatDate(nextDay(draft.date), false)}`
            : " shift"}
        </p>

        <div className="shift-actions">
          {mode === "edit" && (
            <button type="button" className="button danger subtle" onClick={onDelete}><Trash2 /> Delete</button>
          )}
          <button type="button" className="button primary" onClick={onSave}>
            <Check /> {mode === "edit" ? "Save changes" : "Add shift"}
          </button>
        </div>
      </section>
    </div>
  );
}
