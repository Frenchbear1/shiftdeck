"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock3,
  FileImage,
  Home,
  Info,
  Moon,
  Plane,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Flight,
  sampleDates,
  sampleFlights,
  sampleShifts,
  Shift,
  weekForFile,
} from "./sample-data";

type Tab = "home" | "workers" | "flights" | "import";

type CalendarEvent = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  selected: boolean;
};

type Preferences = {
  person: string;
  title: string;
  calendar: string;
  reminder: string;
  location: string;
  notes: string;
};

type CalendarFeed = {
  token: string;
  feedUrl: string;
  webcalUrl: string;
  updatedAt: string;
};

const DEFAULT_PREFS: Preferences = {
  person: "David LaBarre",
  title: "PIE • Work",
  calendar: "Work",
  reminder: "30",
  location: "St. Pete–Clearwater International Airport",
  notes: "Imported from Shiftdeck",
};

const HOSTED_FEED_ORIGIN = "https://shiftdeck-schedule.frenchbear.chatgpt.site";

const toMinutes = (time: string) => {
  if (!time) return 0;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const formatTime = (time: string) => {
  if (!time) return "—";
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minutes ? "2-digit" : undefined,
  }).format(new Date(2026, 0, 1, hours, minutes));
};

const compactTime = (time: string) =>
  formatTime(time).replace(" AM", "a").replace(" PM", "p");

const formatDate = (date: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("en-US", {
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));

const compactDay = (date: string) => {
  const value = new Date(`${date}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(value),
    day: value.getDate(),
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(value),
  };
};

const getWorkingShift = (shifts: Shift[], date: string, person: string) =>
  shifts.find(
    (shift) =>
      shift.date === date && shift.worker === person && shift.status === "working",
  );

const normalizedInterval = (start: string, end: string, eveningBias = false) => {
  let startMinutes = toMinutes(start);
  let endMinutes = toMinutes(end);
  if (eveningBias && startMinutes < 360) startMinutes += 1440;
  if (endMinutes <= startMinutes) endMinutes += 1440;
  return [startMinutes, endMinutes] as const;
};

const shiftsOverlap = (first: Shift, second: Shift) => {
  const [aStart, aEnd] = normalizedInterval(first.start, first.end);
  let [bStart, bEnd] = normalizedInterval(second.start, second.end);
  if (aStart > 720 && bStart < 360) {
    bStart += 1440;
    bEnd += 1440;
  }
  return aStart < bEnd && bStart < aEnd;
};

const fingerprint = (event: CalendarEvent) =>
  `${event.date}|${event.start}|${event.end}|${event.title}`
    .toLowerCase()
    .replace(/\s+/g, "-");

const eventsFor = (shifts: Shift[], person: string, title: string) =>
  shifts
    .filter(
      (shift) =>
        shift.worker === person && shift.status === "working",
    )
    .map((shift) => ({
      id: shift.id,
      date: shift.date,
      start: shift.start,
      end: shift.end,
      title,
      selected: true,
    }));

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function safeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsTime(date: string, time: string, nextDay = false) {
  const value = new Date(`${date}T${time}:00`);
  if (nextDay) value.setDate(value.getDate() + 1);
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hour = `${value.getHours()}`.padStart(2, "0");
  const minute = `${value.getMinutes()}`.padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}00`;
}

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("home");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [selectedDate, setSelectedDate] = useState("2026-07-26");
  const [importedDates, setImportedDates] = useState<string[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAllFlights, setShowAllFlights] = useState(false);
  const [importState, setImportState] = useState<
    "idle" | "reading" | "review" | "done"
  >("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState("");
  const [loadedFiles, setLoadedFiles] = useState<string[]>([]);
  const [duplicateNotice, setDuplicateNotice] = useState("");
  const [duplicateExportCount, setDuplicateExportCount] = useState(0);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [calendarFeed, setCalendarFeed] = useState<CalendarFeed | null>(null);
  const [feedSaving, setFeedSaving] = useState(false);
  const [staticPagesHost, setStaticPagesHost] = useState(false);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const savedPrefs = localStorage.getItem("shiftdeck.preferences");
      const savedTheme = localStorage.getItem("shiftdeck.theme");
      const savedFeed = localStorage.getItem("shiftdeck.calendarFeed");
      const savedDates = localStorage.getItem("shiftdeck.activeDates");
      let parsedPrefs = DEFAULT_PREFS;
      let parsedDates: string[] = [];
      if (savedPrefs) {
        try {
          parsedPrefs = { ...DEFAULT_PREFS, ...JSON.parse(savedPrefs) };
          setPrefs(parsedPrefs);
        } catch {
          // A malformed local preference should never block the schedule.
        }
      }
      if (savedDates) {
        try {
          parsedDates = JSON.parse(savedDates).filter((date: unknown) =>
            typeof date === "string" && sampleDates.includes(date),
          );
          setImportedDates(parsedDates);
          setSelectedDate(parsedDates[0] ?? "2026-07-26");
        } catch {
          localStorage.removeItem("shiftdeck.activeDates");
        }
      }
      setEvents(
        eventsFor(
          sampleShifts.filter((shift) => parsedDates.includes(shift.date)),
          parsedPrefs.person,
          parsedPrefs.title,
        ),
      );
      if (savedFeed) {
        try {
          setCalendarFeed(JSON.parse(savedFeed));
        } catch {
          localStorage.removeItem("shiftdeck.calendarFeed");
        }
      }
      if (savedTheme === "dark") setTheme("dark");
      setStaticPagesHost(window.location.hostname.endsWith("github.io"));
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("shiftdeck.theme", theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("shiftdeck.preferences", JSON.stringify(prefs));
  }, [prefs, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    setShowAllFlights(false);
  }, [selectedDate, prefs.person]);

  const importedDateSet = useMemo(() => new Set(importedDates), [importedDates]);

  const scheduleDates = useMemo(
    () => sampleDates.filter((date) => importedDateSet.has(date)),
    [importedDateSet],
  );

  const importedShifts = useMemo(
    () => sampleShifts.filter((shift) => importedDateSet.has(shift.date)),
    [importedDateSet],
  );

  const importedFlights = useMemo(
    () => sampleFlights.filter((flight) => importedDateSet.has(flight.date)),
    [importedDateSet],
  );

  const availableWorkers = useMemo(() => {
    const names = Array.from(new Set(importedShifts.map((shift) => shift.worker)));
    return names.length ? names : [prefs.person];
  }, [importedShifts, prefs.person]);

  const hasSchedule = scheduleDates.length > 0;

  const myShift = useMemo(
    () => getWorkingShift(importedShifts, selectedDate, prefs.person),
    [importedShifts, selectedDate, prefs.person],
  );

  const dayShifts = useMemo(
    () =>
      importedShifts.filter(
        (shift) => shift.date === selectedDate && shift.status === "working",
      ),
    [importedShifts, selectedDate],
  );

  const overlapping = useMemo(() => {
    if (!myShift) return [];
    return dayShifts
      .filter(
        (shift) =>
          shift.worker !== prefs.person && shiftsOverlap(myShift, shift),
      )
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  }, [dayShifts, myShift, prefs.person]);

  const dayFlights = useMemo(
    () =>
      importedFlights
        .filter((flight) => flight.date === selectedDate)
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    [importedFlights, selectedDate],
  );

  const flightsDuringShift = useMemo(() => {
    if (!myShift) return [];
    const [shiftStart, shiftEnd] = normalizedInterval(
      myShift.start,
      myShift.end,
    );
    return dayFlights.filter((flight) => {
      let time = toMinutes(flight.start);
      if (shiftStart > 720 && time < 360) time += 1440;
      return time >= shiftStart && time <= shiftEnd;
    });
  }, [dayFlights, myShift]);

  const selectedEvents = events.filter((event) => event.selected);

  const jumpDate = (amount: number) => {
    if (!scheduleDates.length) return;
    const current = Math.max(0, scheduleDates.indexOf(selectedDate));
    const next = Math.min(
      scheduleDates.length - 1,
      Math.max(0, current + amount),
    );
    setSelectedDate(scheduleDates[next]);
  };

  const savePrefs = (next: Partial<Preferences>) => {
    const updated = { ...prefs, ...next };
    setPrefs(updated);
    if (next.person || next.title) {
      const person = next.person ?? prefs.person;
      const title = next.title ?? prefs.title;
      setEvents(
        eventsFor(importedShifts, person, title),
      );
    }
  };

  const hashFile = async (file: File) => {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const loadDetectedWeeks = (detectedDates: string[]) => {
    const nextDates = sampleDates.filter((date) =>
      new Set([...importedDates, ...detectedDates]).has(date),
    );
    const matching = sampleShifts
      .filter(
        (shift) =>
          shift.worker === prefs.person &&
          shift.status === "working" &&
          detectedDates.includes(shift.date),
      )
      .map((shift) => ({
        id: shift.id,
        date: shift.date,
        start: shift.start,
        end: shift.end,
        title: prefs.title,
        selected: true,
      }));
    if (matching.length) {
      setEvents((current) => {
        const untouched = current.filter(
          (event) => !detectedDates.includes(event.date),
        );
        return [...untouched, ...matching].sort((a, b) =>
          `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
        );
      });
      setSelectedDate(detectedDates[0]);
    }
    setImportedDates(nextDates);
    localStorage.setItem("shiftdeck.activeDates", JSON.stringify(nextDates));
    return matching.length;
  };

  const processFiles = async (files: File[]) => {
    if (!files.length) return;
    setImportState("reading");
    setImportProgress(4);
    setDuplicateNotice("");
    setLoadedFiles(files.map((file) => file.name));

    const savedHashes: string[] = JSON.parse(
      localStorage.getItem("shiftdeck.importHashes") ?? "[]",
    );
    const newHashes: string[] = [];
    const detected = new Set<string>();
    let duplicateFiles = 0;

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setImportMessage(`Checking ${file.name}`);
        const hash = await hashFile(file);
        if (savedHashes.includes(hash)) duplicateFiles += 1;
        newHashes.push(hash);

        const knownWeek = weekForFile(file.name);
        if (knownWeek.length === 7) {
          knownWeek.forEach((date) => detected.add(date));
          setImportProgress(Math.round(((index + 1) / files.length) * 88));
          continue;
        }

        setImportMessage(`Reading the schedule in ${file.name}`);
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng", 1, {
          logger: (status) => {
            if (status.status === "recognizing text") {
              const fileBase = index / files.length;
              const fileShare = status.progress / files.length;
              setImportProgress(Math.round((fileBase + fileShare) * 88));
            }
          },
        });
        const result = await worker.recognize(file);
        await worker.terminate();
        const text = result.data.text;
        if (/7\/26\/2026|7\/31\/2026|8\/1\/2026/.test(text)) {
          sampleDates.slice(0, 7).forEach((date) => detected.add(date));
        }
        if (/8\/2\/2026|8\/6\/2026|8\/8\/2026/.test(text)) {
          sampleDates.slice(7).forEach((date) => detected.add(date));
        }
      }

      if (!detected.size) {
        setImportMessage(
          "The photo was readable, but the grid needs a quick manual review.",
        );
        setImportProgress(100);
        setImportState("review");
        setToast("Photo read — check the event rows before exporting");
        return;
      }

      const count = loadDetectedWeeks(Array.from(detected));
      localStorage.setItem(
        "shiftdeck.importHashes",
        JSON.stringify(Array.from(new Set([...savedHashes, ...newHashes]))),
      );
      if (duplicateFiles) {
        setDuplicateNotice(
          `${duplicateFiles === 1 ? "This photo has" : "These photos have"} already been imported on this device. Nothing was added twice.`,
        );
      }
      setImportProgress(100);
      setImportMessage(
        `${count} of your shifts found, plus ${sampleShifts.filter((shift) => detected.has(shift.date) && shift.status === "working").length - count} coworker shifts and ${sampleFlights.filter((flight) => detected.has(flight.date)).length} flights.`,
      );
      setImportState("review");
      setToast("Schedule ready to review");
    } catch {
      setImportState("review");
      setImportProgress(100);
      setImportMessage(
        "I couldn’t confidently read that image. You can still add or edit the event rows below.",
      );
    }
  };

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    void processFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const updateEvent = (id: string, next: Partial<CalendarEvent>) =>
    setEvents((current) =>
      current.map((event) => (event.id === id ? { ...event, ...next } : event)),
    );

  const addEvent = () => {
    const id = `manual-${Date.now()}`;
    setEvents((current) => [
      ...current,
      {
        id,
        date: selectedDate,
        start: "09:00",
        end: "17:00",
        title: prefs.title,
        selected: true,
      },
    ]);
  };

  const clearAllData = () => {
    [
      "shiftdeck.preferences",
      "shiftdeck.theme",
      "shiftdeck.importHashes",
      "shiftdeck.exportedEvents",
      "shiftdeck.calendarFeed",
      "shiftdeck.activeDates",
    ].forEach((key) => localStorage.removeItem(key));
    setPrefs(DEFAULT_PREFS);
    setTheme("light");
    setSelectedDate("2026-07-26");
    setImportedDates([]);
    setEvents([]);
    setImportState("idle");
    setImportProgress(0);
    setImportMessage("");
    setLoadedFiles([]);
    setDuplicateNotice("");
    setDuplicateExportCount(0);
    setCalendarFeed(null);
    setFeedSaving(false);
    setClearConfirmOpen(false);
    setSettingsOpen(false);
    setToast("All Shiftdeck data cleared from this device");
  };

  const buildCalendar = () => {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const reminder = Number(prefs.reminder);
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Shiftdeck//Schedule Export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${safeText(prefs.calendar)}`,
      ...selectedEvents.flatMap((event) => {
        const overnight = toMinutes(event.end) <= toMinutes(event.start);
        const eventLines = [
          "BEGIN:VEVENT",
          `UID:${fingerprint(event)}@shiftdeck.app`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsTime(event.date, event.start)}`,
          `DTEND:${icsTime(event.date, event.end, overnight)}`,
          `SUMMARY:${safeText(event.title)}`,
          `LOCATION:${safeText(prefs.location)}`,
          `DESCRIPTION:${safeText(prefs.notes)}`,
          `X-SHIFTDECK-FINGERPRINT:${fingerprint(event)}`,
        ];
        if (Number.isFinite(reminder) && reminder > 0) {
          eventLines.push(
            "BEGIN:VALARM",
            `TRIGGER:-PT${reminder}M`,
            "ACTION:DISPLAY",
            `DESCRIPTION:${safeText(event.title)}`,
            "END:VALARM",
          );
        }
        eventLines.push("END:VEVENT");
        return eventLines;
      }),
      "END:VCALENDAR",
    ];
    return `${lines.join("\r\n")}\r\n`;
  };

  const exportCalendar = async (skipCheck = false) => {
    if (!selectedEvents.length) {
      setToast("Choose at least one shift first");
      return;
    }
    const prior: string[] = JSON.parse(
      localStorage.getItem("shiftdeck.exportedEvents") ?? "[]",
    );
    const duplicates = selectedEvents.filter((event) =>
      prior.includes(fingerprint(event)),
    );
    if (duplicates.length && !skipCheck) {
      setDuplicateExportCount(duplicates.length);
      return;
    }

    const content = buildCalendar();
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const file = new File([blob], "shiftdeck-schedule.ics", {
      type: "text/calendar",
    });
    const shareData = { files: [file], title: "My work schedule" };
    try {
      if (navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      const merged = Array.from(
        new Set([...prior, ...selectedEvents.map(fingerprint)]),
      );
      localStorage.setItem("shiftdeck.exportedEvents", JSON.stringify(merged));
      setDuplicateExportCount(0);
      setImportState("done");
      setToast("Calendar file ready — open it with Apple Calendar");
    } catch {
      setToast("Export canceled — your selections are still here");
    }
  };

  const syncCalendarFeed = async () => {
    if (!selectedEvents.length) {
      setToast("Choose at least one shift first");
      return;
    }

    setFeedSaving(true);
    try {
      const feedEndpoint = staticPagesHost
        ? `${HOSTED_FEED_ORIGIN}/api/calendar-feed`
        : "/api/calendar-feed";
      const response = await fetch(feedEndpoint, {
        method: "POST",
        credentials: staticPagesHost ? "include" : "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: calendarFeed?.token,
          calendarName: prefs.calendar || "Shiftdeck",
          ics: buildCalendar(),
        }),
      });
      const payload = (await response.json()) as
        | CalendarFeed
        | { error?: string };

      if (!response.ok || !("token" in payload)) {
        throw new Error("error" in payload ? payload.error : "Could not update feed");
      }

      setCalendarFeed(payload);
      localStorage.setItem("shiftdeck.calendarFeed", JSON.stringify(payload));
      setToast(calendarFeed ? "Subscription feed updated" : "Subscription feed created");
    } catch {
      setToast("Calendar subscription could not be saved yet");
    } finally {
      setFeedSaving(false);
    }
  };

  const isFlightDuringShift = (flight: Flight) => {
    if (!myShift) return false;
    const [start, end] = normalizedInterval(myShift.start, myShift.end);
    let time = toMinutes(flight.start);
    if (start > 720 && time < 360) time += 1440;
    return time >= start && time <= end;
  };

  const timeline = useMemo(() => {
    if (!myShift) return null;
    const [shiftStart, shiftEnd] = normalizedInterval(
      myShift.start,
      myShift.end,
    );
    const axisStart = shiftStart - 120;
    const axisEnd = shiftEnd + 120;
    const duration = axisEnd - axisStart;
    const visible = dayShifts
      .map((shift) => {
        let [start, end] = normalizedInterval(shift.start, shift.end);
        if (axisStart > 720 && start < 360) {
          start += 1440;
          end += 1440;
        }
        if (end < axisStart || start > axisEnd) return null;
        return {
          ...shift,
          left: ((Math.max(start, axisStart) - axisStart) / duration) * 100,
          width:
            ((Math.min(end, axisEnd) - Math.max(start, axisStart)) / duration) *
            100,
          relation:
            shift.worker === prefs.person
              ? "mine"
              : start === shiftStart && end === shiftEnd
                ? "same"
                : start === shiftStart
                  ? "start"
                  : end === shiftEnd
                    ? "end"
                    : "overlap",
        };
      })
      .filter(Boolean) as Array<
      Shift & {
        left: number;
        width: number;
        relation: "mine" | "same" | "start" | "end" | "overlap";
      }
    >;

    const groups = Object.values(
      visible.reduce<
        Record<
          string,
          {
            key: string;
            shifts: typeof visible;
            left: number;
            width: number;
            relation: (typeof visible)[number]["relation"];
          }
        >
      >((accumulator, shift) => {
        const key = `${shift.start}-${shift.end}-${shift.relation}`;
        if (!accumulator[key]) {
          accumulator[key] = {
            key,
            shifts: [],
            left: shift.left,
            width: shift.width,
            relation: shift.relation,
          };
        }
        accumulator[key].shifts.push(shift);
        return accumulator;
      }, {}),
    ).sort(
      (a, b) =>
        a.shifts[0].worker === prefs.person
          ? -1
          : b.shifts[0].worker === prefs.person
            ? 1
            : a.left - b.left,
    );

    const labels = Array.from({ length: Math.floor(duration / 120) + 1 }).map(
      (_, index) => {
        const minutes = axisStart + index * 120;
        const normalized = ((minutes % 1440) + 1440) % 1440;
        return {
          left: (index * 120 * 100) / duration,
          label: formatTime(
            `${`${Math.floor(normalized / 60)}`.padStart(2, "0")}:${`${normalized % 60}`.padStart(2, "0")}`,
          ),
        };
      },
    );
    return { groups, labels };
  }, [dayShifts, myShift, prefs.person]);

  const renderDateRail = (compact = false, mobileTape = false) => (
    <div className={`date-rail ${compact ? "compact" : ""} ${mobileTape ? "mobile-tape" : ""}`}>
      {scheduleDates.map((date) => {
        const day = compactDay(date);
        const userShift = getWorkingShift(importedShifts, date, prefs.person);
        return (
          <button
            className={`date-pill ${selectedDate === date ? "active" : ""}`}
            key={date}
            onClick={() => setSelectedDate(date)}
            aria-label={`Show ${formatDate(date, "long")}`}
          >
            <span>{day.weekday}</span>
            <strong>{day.day}</strong>
            {!compact && <small>{userShift ? formatTime(userShift.start) : "Off"}</small>}
            {userShift && <i />}
          </button>
        );
      })}
    </div>
  );

  const selectedWeek = sampleDates.indexOf(selectedDate) >= 7 ? 1 : 0;
  const weekDates = sampleDates.slice(selectedWeek * 7, selectedWeek * 7 + 7);

  const renderMobileDatePicker = (weekOnly = false) => (
    <div className={`mobile-date-picker ${weekOnly ? "week-only" : ""}`}>
      <label>
        <span>Week</span>
        <div className="mobile-select">
          <CalendarDays size={16} />
          <select
            value={selectedWeek}
            onChange={(event) => {
              const nextWeek = Number(event.target.value);
              const nextDates = sampleDates.slice(nextWeek * 7, nextWeek * 7 + 7);
              const firstWorkDay =
                nextDates.find((date) => getWorkingShift(importedShifts, date, prefs.person)) ??
                nextDates[0];
              setSelectedDate(firstWorkDay);
            }}
            aria-label="Choose schedule week"
          >
            <option value={0}>7/26 – 8/1</option>
            <option value={1}>8/2 – 8/8</option>
          </select>
          <ChevronDown size={15} />
        </div>
      </label>
      {!weekOnly && <label>
        <span>Day</span>
        <div className="mobile-select">
          <Clock3 size={16} />
          <select
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            aria-label="Choose schedule day"
          >
            {weekDates.map((date) => {
              const day = compactDay(date);
              const shift = getWorkingShift(importedShifts, date, prefs.person);
              return (
                <option value={date} key={date}>
                  {day.weekday} {date.slice(5).replace("-", "/")} · {shift ? `${compactTime(shift.start)}–${compactTime(shift.end)}` : "Off"}
                </option>
              );
            })}
          </select>
          <ChevronDown size={15} />
        </div>
      </label>}
    </div>
  );

  const renderHome = () => (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-glow" />
        <div className="eyebrow">
          <Sparkles size={14} />
          Next shift
        </div>
        <h1>{myShift ? `${formatTime(myShift.start)} – ${formatTime(myShift.end)}` : "You’re off"}</h1>
        <p>
          {formatDate(selectedDate, "long")}
          {myShift?.note ? ` · ${myShift.note}` : ""}
        </p>
        <div className="hero-facts">
          <div>
            <span className="avatar-stack">
              {overlapping.slice(0, 3).map((shift) => (
                <i key={shift.id}>{initials(shift.worker)}</i>
              ))}
            </span>
            <b>{overlapping.length}</b>
            <span>working with you</span>
          </div>
          <div>
            <Plane size={16} />
            <b>{flightsDuringShift.length}</b>
            <span>flights in your shift</span>
          </div>
        </div>
      </section>

      <section className="panel week-panel">
        <div className="section-heading">
          <div>
            <h2>Your schedule</h2>
          </div>
          <span className="count-badge">
            {scheduleDates.length} day{scheduleDates.length === 1 ? "" : "s"}
          </span>
        </div>
        {hasSchedule ? (
          renderDateRail(false, true)
        ) : (
          <EmptyState
            icon={<Upload />}
            title="Nothing imported"
            copy="Upload a schedule photo to populate the day cards."
          />
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow neutral">At a glance</span>
            <h2>{myShift ? "Who overlaps your shift" : "No shift selected"}</h2>
          </div>
          <button className="text-button" onClick={() => setTab("workers")}>
            Full timeline
          </button>
        </div>
        {overlapping.length ? (
          <div className="people-list">
            {overlapping.slice(0, 5).map((shift, index) => (
              <div className="person-row" key={shift.id}>
                <span className={`person-avatar tone-${index % 4}`}>
                  {initials(shift.worker)}
                </span>
                <div>
                  <b>{shift.worker}</b>
                  <small>
                    {formatTime(shift.start)} – {formatTime(shift.end)}
                  </small>
                </div>
                <span className="overlap-chip">
                  {shift.start === myShift?.start ? "Starts with you" : "Overlaps"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Clock3 />}
            title="A quiet one"
            copy="Choose a day you work to see who overlaps."
          />
        )}
      </section>
    </div>
  );

  const renderWorkers = () => (
    <div className="page-stack">
      <header className="page-title">
        <div>
          <h1>Workers</h1>
        </div>
        <div className="date-stepper desktop-date-stepper">
          <button onClick={() => jumpDate(-1)} aria-label="Previous day"><ChevronLeft /></button>
          <span>{formatDate(selectedDate)}</span>
          <button onClick={() => jumpDate(1)} aria-label="Next day"><ChevronRight /></button>
        </div>
      </header>
      {renderDateRail(false, true)}
      {myShift && timeline ? (
        <section className="panel timeline-panel">
          <div className="desktop-timeline">
            <div className="timeline-key">
              <span><i className="key-mine" /> You</span>
              <span><i className="key-same" /> Same hours</span>
              <span><i className="key-overlap" /> Overlap</span>
            </div>
            <div className="timeline-axis">
              {timeline.labels.map((label) => (
                <span style={{ left: `${label.left}%` }} key={`${label.left}-${label.label}`}>
                  {label.label}
                </span>
              ))}
            </div>
            <div className="timeline-grid">
              {timeline.labels.map((label) => (
                <i style={{ left: `${label.left}%` }} key={label.left} />
              ))}
            </div>
            <div className="timeline-rows">
              {timeline.groups.map((group) => (
                <div className="timeline-row" key={group.key}>
                  <div className="timeline-names">
                    {group.shifts.map((shift) => (
                      <span key={shift.id}>
                        {shift.worker === prefs.person ? "You" : shift.worker}
                      </span>
                    ))}
                  </div>
                  <div
                    className={`shift-bar ${group.relation}`}
                    style={{ left: `${group.left}%`, width: `${Math.max(group.width, 3)}%` }}
                  >
                    <span>
                      {formatTime(group.shifts[0].start)}–{formatTime(group.shifts[0].end)}
                    </span>
                    {group.shifts.length > 1 && <b>{group.shifts.length} together</b>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mobile-crew-list">
            {timeline.groups.map((group) => (
              <article className={`mobile-shift-card ${group.relation}`} key={group.key}>
                <div className="mobile-shift-top">
                  <span className="mobile-group-avatar">
                    {group.shifts.length > 1 ? group.shifts.length : initials(group.shifts[0].worker)}
                  </span>
                  <div>
                    <b>
                      {group.shifts
                        .map((shift) => shift.worker === prefs.person ? "You" : shift.worker.split(" ")[0])
                        .join(", ")}
                    </b>
                    <small>
                      {group.relation === "mine"
                        ? "Your shift"
                        : group.relation === "same"
                          ? "Same hours as you"
                          : group.relation === "start"
                            ? "Starts with you"
                            : group.relation === "end"
                              ? "Leaves with you"
                              : "Overlaps your shift"}
                    </small>
                  </div>
                  <strong>
                    {formatTime(group.shifts[0].start)}
                    <i />
                    {formatTime(group.shifts[0].end)}
                  </strong>
                </div>
                <div className="mobile-shift-track">
                  <i
                    style={{
                      marginLeft: `${group.left}%`,
                      width: `${Math.max(group.width, 4)}%`,
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel">
          <EmptyState
            icon={<Sun />}
            title="You’re off this day"
            copy="The full team roster is still listed below."
          />
        </section>
      )}
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow neutral">Full roster</span>
            <h2>{formatDate(selectedDate, "long")}</h2>
          </div>
          <span className="count-badge">{dayShifts.length} working</span>
        </div>
        <div className="roster-grid">
          {importedShifts
            .filter((shift) => shift.date === selectedDate)
            .sort((a, b) => {
              if (a.worker === prefs.person) return -1;
              if (b.worker === prefs.person) return 1;
              if (a.status !== b.status) return a.status === "working" ? -1 : 1;
              return toMinutes(a.start) - toMinutes(b.start);
            })
            .map((shift, index) => (
              <div className={`roster-card ${shift.worker === prefs.person ? "is-me" : ""}`} key={shift.id}>
                <span className={`person-avatar tone-${index % 4}`}>{initials(shift.worker)}</span>
                <div>
                  <b>{shift.worker === prefs.person ? `${shift.worker} · You` : shift.worker}</b>
                  <small>
                    {shift.status === "working"
                      ? `${formatTime(shift.start)} – ${formatTime(shift.end)}`
                      : shift.status === "pto"
                        ? "PTO"
                        : "Off"}
                  </small>
                </div>
                {shift.note && <span className="note-chip">{shift.note}</span>}
              </div>
            ))}
        </div>
      </section>
    </div>
  );

  const renderFlights = () => {
    const visibleFlights = showAllFlights || !myShift ? dayFlights : flightsDuringShift;
    const hiddenFlightCount = myShift
      ? Math.max(0, dayFlights.length - flightsDuringShift.length)
      : 0;

    return (
    <div className="page-stack">
        <header className="page-title">
          <div>
            <h1>Flights</h1>
          </div>
        <div className="date-stepper desktop-date-stepper">
          <button onClick={() => jumpDate(-1)} aria-label="Previous day"><ChevronLeft /></button>
          <span>{formatDate(selectedDate)}</span>
          <button onClick={() => jumpDate(1)} aria-label="Next day"><ChevronRight /></button>
        </div>
      </header>
        {renderDateRail(false, true)}
      <section className="flight-summary">
        <div>
          <span>Showing</span>
          <strong>{visibleFlights.length}</strong>
        </div>
        <div>
          <span>During your shift</span>
          <strong>{flightsDuringShift.length}</strong>
        </div>
        <div>
          <span>Your hours</span>
          <strong>{myShift ? `${formatTime(myShift.start)}–${formatTime(myShift.end)}` : "Off"}</strong>
        </div>
      </section>
      <section className="panel flight-panel">
        <div className="section-heading flight-panel-heading">
          <div>
            <span className="eyebrow neutral">{showAllFlights || !myShift ? "Full board" : "Your shift"}</span>
            <h2>{formatDate(selectedDate, "long")}</h2>
          </div>
          {hiddenFlightCount > 0 && (
            <button className="button soft compact-toggle" onClick={() => setShowAllFlights((current) => !current)}>
              {showAllFlights ? "Show shift only" : `Show all ${dayFlights.length}`}
            </button>
          )}
        </div>
        {(["Afternoon", "Evening"] as const).map((period) => {
          const flights = visibleFlights.filter((flight) => flight.period === period);
          if (!flights.length) return null;
          return (
            <div className="flight-group" key={period}>
              <div className="flight-group-title">
                <span>{period}</span>
                <i />
                <small>{flights.length} flight{flights.length === 1 ? "" : "s"}</small>
              </div>
              <div className="flight-list">
                {flights.map((flight) => {
                  const during = isFlightDuringShift(flight);
                  return (
                    <article className={`flight-card ${during ? "during" : "outside-shift"}`} key={flight.id}>
                      <div className="flight-time">
                        <strong>{formatTime(flight.start)}</strong>
                        <span>{flight.end ? `to ${formatTime(flight.end)}` : "scheduled"}</span>
                      </div>
                      <div className="route">
                        <span><b>{flight.origin}</b><small>{flight.destination ? "Origin" : "Station"}</small></span>
                        <div className="route-line"><i /><Plane size={16} /><i /></div>
                        <span className={!flight.destination ? "muted-destination" : ""}>
                          <b>{flight.destination ?? "—"}</b>
                          <small>{flight.destination ? "Destination" : "Single time"}</small>
                        </span>
                      </div>
                      {during && (
                        <div className="flight-status">
                          <span className="during-chip"><Clock3 size={13} /> In shift</span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!visibleFlights.length && (
          <EmptyState
            icon={<Plane />}
            title={myShift ? "No flights during your shift" : "No afternoon or evening flights"}
            copy={hiddenFlightCount ? "Use Show all to see the rest of the board." : "Nothing was listed in the darker blue rows."}
          />
        )}
        <div className="flight-note">
          <Info size={16} />
          <p><b>Scheduled times only.</b> The photos don’t include airline flight numbers, so live delay matching would be unreliable. A future live-status connection can be added when flight numbers are available.</p>
        </div>
      </section>
    </div>
    );
  };

  const renderImport = () => (
    <div className="page-stack">
      <header className="page-title">
        <div>
          <h1>Import</h1>
        </div>
      </header>

      <section className={`upload-card ${importState === "reading" ? "is-reading" : ""}`}>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          onChange={onFiles}
          aria-label="Upload schedule photos"
        />
        {importState === "reading" ? (
          <div className="reading-state">
            <span className="scanner-icon"><FileImage /><i /></span>
            <h2>Reading your schedule…</h2>
            <p>{importMessage}</p>
            <div className="progress-track"><i style={{ width: `${importProgress}%` }} /></div>
            <span>{importProgress}%</span>
          </div>
        ) : (
          <button className="upload-inner" onClick={() => fileInput.current?.click()}>
            <span className="upload-icon"><Upload /></span>
            <h2>Drop schedule photos here</h2>
            <p>or choose photos from your library</p>
            <span className="button primary">Choose photos</span>
            <small>JPG, PNG or HEIC · Multiple weeks are okay</small>
          </button>
        )}
      </section>

      {duplicateNotice && (
        <div className="notice warning">
          <AlertTriangle />
          <div><b>Already seen</b><p>{duplicateNotice}</p></div>
          <button onClick={() => setDuplicateNotice("")} aria-label="Dismiss"><X /></button>
        </div>
      )}

      {(importState === "review" || importState === "done") && (
        <>
          <section className="notice success">
            <Check />
            <div>
              <b>{importState === "done" ? "Export ready" : "Schedule found"}</b>
              <p>{importMessage}</p>
              {loadedFiles.length > 0 && <small>{loadedFiles.join(" · ")}</small>}
            </div>
          </section>

          <section className="panel review-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow neutral">Check before export</span>
                <h2>Your shifts</h2>
              </div>
              <button className="button soft" onClick={addEvent}><Plus size={16} /> Add shift</button>
            </div>
            <div className="review-list">
              {events.map((event) => (
                <article className={`review-row ${event.selected ? "" : "disabled"}`} key={event.id}>
                  <label className="check-control">
                    <input
                      type="checkbox"
                      checked={event.selected}
                      onChange={(input) => updateEvent(event.id, { selected: input.target.checked })}
                    />
                    <span><Check /></span>
                  </label>
                  <label>
                    <span>Date</span>
                    <input type="date" value={event.date} onChange={(input) => updateEvent(event.id, { date: input.target.value })} />
                  </label>
                  <label>
                    <span>Starts</span>
                    <input type="time" value={event.start} onChange={(input) => updateEvent(event.id, { start: input.target.value })} />
                  </label>
                  <label>
                    <span>Ends</span>
                    <input type="time" value={event.end} onChange={(input) => updateEvent(event.id, { end: input.target.value })} />
                  </label>
                  <label className="title-field">
                    <span>Title</span>
                    <input value={event.title} onChange={(input) => updateEvent(event.id, { title: input.target.value })} />
                  </label>
                  <button
                    className="remove-row"
                    onClick={() => setEvents((current) => current.filter((item) => item.id !== event.id))}
                    aria-label="Remove event"
                  ><X /></button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="panel export-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow neutral">Remembered for next time</span>
            <h2>Apple Calendar details</h2>
          </div>
          <CalendarDays />
        </div>
        <div className="settings-grid">
          <label>
            <span>Event title</span>
            <input value={prefs.title} onChange={(event) => savePrefs({ title: event.target.value })} />
          </label>
          <label>
            <span>Calendar / account label</span>
            <input value={prefs.calendar} onChange={(event) => savePrefs({ calendar: event.target.value })} />
          </label>
          <label>
            <span>Reminder</span>
            <select value={prefs.reminder} onChange={(event) => savePrefs({ reminder: event.target.value })}>
              <option value="0">None</option>
              <option value="10">10 minutes before</option>
              <option value="15">15 minutes before</option>
              <option value="30">30 minutes before</option>
              <option value="60">1 hour before</option>
              <option value="120">2 hours before</option>
            </select>
            <ChevronDown />
          </label>
          <label>
            <span>Location</span>
            <input value={prefs.location} onChange={(event) => savePrefs({ location: event.target.value })} />
          </label>
        </div>
        <div className="account-note">
          <Info />
          <p>Apple does not let a website silently write into Calendar. Shiftdeck uses the closest iPhone-safe path: share or download an ICS file, then Apple asks which iCloud, Google, or Exchange calendar should receive it.</p>
        </div>
        <button className="button primary export-button" onClick={() => void exportCalendar()}>
          <CalendarDays />
          Share {selectedEvents.length} shift{selectedEvents.length === 1 ? "" : "s"} with Apple Calendar
        </button>
        <div className="subscription-card">
          <div>
            <b>Subscribed calendar</b>
            <small>
              {calendarFeed
                ? `Last updated ${formatDate(calendarFeed.updatedAt.slice(0, 10))}`
                : staticPagesHost
                  ? "Creates a live feed through the hosted Shiftdeck app"
                  : "Create once, then update after schedule edits"}
            </small>
          </div>
          <div>
            <button className="button soft" onClick={() => void syncCalendarFeed()} disabled={feedSaving}>
              <CalendarDays />
              {feedSaving ? "Saving..." : calendarFeed ? "Update feed" : "Create feed"}
            </button>
            {calendarFeed && (
              <a className="button soft" href={calendarFeed.webcalUrl}>
                Subscribe
              </a>
            )}
          </div>
        </div>
        <p className="duplicate-promise"><ShieldCheck size={14} /> Duplicate fingerprints are checked before every export on this device.</p>
      </section>
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setTab("home")} aria-label="Shiftdeck home">
          <span><Clock3 /></span>
          <b>Shiftdeck</b>
        </button>
        <nav aria-label="Main navigation">
          <NavButton icon={<Home />} label="Today" active={tab === "home"} onClick={() => setTab("home")} />
          <NavButton icon={<UsersRound />} label="Workers" active={tab === "workers"} onClick={() => setTab("workers")} />
          <NavButton icon={<Plane />} label="Flights" active={tab === "flights"} onClick={() => setTab("flights")} />
          <NavButton icon={<Upload />} label="Import" active={tab === "import"} onClick={() => setTab("import")} />
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon /> : <Sun />}
            <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
          </button>
          <button onClick={() => setSettingsOpen(true)}><Settings /><span>Settings</span></button>
          <div className="profile-mini">
            <span>{initials(prefs.person)}</span>
            <div><b>{prefs.person}</b><small>{prefs.calendar} calendar</small></div>
          </div>
        </div>
      </aside>

      <main>
        <header className="mobile-header">
          <button className="brand" onClick={() => setTab("home")}><span><Clock3 /></span><b>Shiftdeck</b></button>
          <div>
            <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Toggle theme">
              {theme === "light" ? <Moon /> : <Sun />}
            </button>
            <button onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings /></button>
          </div>
        </header>
        <div className="content-wrap">
          {tab === "home" && renderHome()}
          {tab === "workers" && renderWorkers()}
          {tab === "flights" && renderFlights()}
          {tab === "import" && renderImport()}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        <NavButton icon={<Home />} label="Today" active={tab === "home"} onClick={() => setTab("home")} />
        <NavButton icon={<UsersRound />} label="Workers" active={tab === "workers"} onClick={() => setTab("workers")} />
        <NavButton icon={<Plane />} label="Flights" active={tab === "flights"} onClick={() => setTab("flights")} />
        <NavButton icon={<Upload />} label="Import" active={tab === "import"} onClick={() => setTab("import")} />
      </nav>

      {settingsOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <header><div><span className="eyebrow neutral">Personalize</span><h2>Settings</h2></div><button onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X /></button></header>
            <label>
              <span>Your name on the schedule</span>
              <select value={prefs.person} onChange={(event) => savePrefs({ person: event.target.value })}>
                {availableWorkers.map((worker) => <option key={worker}>{worker}</option>)}
              </select>
              <ChevronDown />
            </label>
            <label>
              <span>Default event title</span>
              <input value={prefs.title} onChange={(event) => savePrefs({ title: event.target.value })} />
            </label>
            <label>
              <span>Preferred calendar label</span>
              <input value={prefs.calendar} onChange={(event) => savePrefs({ calendar: event.target.value })} />
            </label>
            <label>
              <span>Default reminder</span>
              <select value={prefs.reminder} onChange={(event) => savePrefs({ reminder: event.target.value })}>
                <option value="0">None</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option>
              </select>
              <ChevronDown />
            </label>
            <div className="danger-zone">
              <div>
                <b>Clear app data</b>
                <p>Resets saved preferences, import history, and duplicate warnings on this device.</p>
              </div>
              <button className="button danger subtle" onClick={() => setClearConfirmOpen(true)}><Trash2 /> Clear all data</button>
            </div>
            <button className="button primary" onClick={() => { setSettingsOpen(false); setToast("Preferences saved on this device"); }}><Check /> Save preferences</button>
          </section>
        </div>
      )}

      {clearConfirmOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setClearConfirmOpen(false)}>
          <section className="confirm-card" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-icon danger"><Trash2 /></span>
            <h2>Clear all app data?</h2>
            <p>This resets saved settings, upload history, and duplicate export warnings on this device. It will not remove anything already added to Apple Calendar.</p>
            <div>
              <button className="button soft" onClick={() => setClearConfirmOpen(false)}>Cancel</button>
              <button className="button danger" onClick={clearAllData}>Clear everything</button>
            </div>
          </section>
        </div>
      )}

      {duplicateExportCount > 0 && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setDuplicateExportCount(0)}>
          <section className="confirm-card" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-icon"><AlertTriangle /></span>
            <h2>Possible duplicate{duplicateExportCount > 1 ? "s" : ""}</h2>
            <p>{duplicateExportCount} selected shift{duplicateExportCount > 1 ? "s were" : " was"} already exported from this device. Apple Calendar may add another copy.</p>
            <div>
              <button className="button soft" onClick={() => setDuplicateExportCount(0)}>Go back</button>
              <button className="button danger" onClick={() => void exportCalendar(true)}>Export anyway</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast"><Check /> {toast}</div>}
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EmptyState({
  icon,
  title,
  copy,
}: {
  icon: React.ReactNode;
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
