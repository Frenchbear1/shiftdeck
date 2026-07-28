"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileImage,
  Home,
  Moon,
  Pencil,
  Plane,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Flight,
  sampleFlights,
  sampleShifts,
  Shift,
} from "./sample-data";
import { parseScheduleTsv, ParsedSchedule } from "./schedule-parser";
import {
  clearScheduleImages,
  deleteScheduleImage,
  loadScheduleImage,
  saveScheduleImage,
} from "./upload-store";

type Tab = "home" | "workers" | "flights" | "timeoff" | "import";

type CalendarEvent = {
  id: string;
  calendarKey: string;
  date: string;
  start: string;
  end: string;
  title: string;
};

type Preferences = {
  person: string;
  title: string;
  reminder1: string;
  reminder2: string;
  location: string;
  notes: string;
  homeAirport: string;
  airline: string;
};

type CalendarRecord = {
  calendarKey: string;
  person: string;
  date: string;
  start: string;
  end: string;
  title: string;
  signature: string;
  revision: number;
  status: "confirmed" | "cancelled";
};

type CalendarHistory = Record<string, CalendarRecord>;

type ShiftDraft = {
  date: string;
  start: string;
  end: string;
};

type TimeOffDraft = {
  date: string;
  start: string;
  end: string;
};

type ScheduleDocument = {
  id: string;
  hash: string;
  name: string;
  dates: string[];
  shifts: Shift[];
  flights: Flight[];
  uploadedAt: string;
  updatedAt: string;
  revision: number;
};

type AviationOption = {
  value: string;
  label: string;
  search: string;
};

type AirportData = {
  c: string;
  n: string;
  m: string;
  r: string;
};

type AirlineData = {
  n: string;
  i: string;
  c: string;
};

type SwapCandidate = {
  worker: string;
  averageStart: number;
  averageEnd: number;
  score: number;
  sampleCount: number;
  sameShiftBand: boolean;
  availability: "Off that day" | "Not scheduled";
};

type CalendarChange =
  | {
      kind: "upsert";
      calendarKey: string;
      event: CalendarEvent;
      revision: number;
      signature: string;
    }
  | {
      kind: "cancel";
      calendarKey: string;
      record: CalendarRecord;
      revision: number;
    };

const DEFAULT_PREFS: Preferences = {
  person: "David LaBarre",
  title: "PIE • Work",
  reminder1: "",
  reminder2: "",
  location: "St. Pete–Clearwater International Airport",
  notes: "Imported from Shiftdeck",
  homeAirport: "ABE",
  airline: "Allegiant",
};

const REMINDER_OPTIONS = [
  { value: "", label: "No reminder" },
  { value: "PT0M", label: "At event time" },
  { value: "PT15M", label: "15 minutes before" },
  { value: "PT30M", label: "30 minutes before" },
  { value: "PT1H", label: "1 hour before" },
  { value: "PT2H", label: "2 hours before" },
  { value: "P1D", label: "1 day before" },
  { value: "P2D", label: "2 days before" },
  { value: "P1W", label: "1 week before" },
] as const;

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

const formatDate = (date: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("en-US", {
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));

const formatDocumentRange = (dates: string[]) => {
  if (!dates.length) return "Dates unavailable";
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const first = formatter.format(new Date(`${dates[0]}T12:00:00`));
  const last = formatter.format(new Date(`${dates.at(-1)}T12:00:00`));
  return first === last ? first : `${first} – ${last}`;
};

const formatUpdatedAt = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const formatFieldDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));

const formatFieldTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, hours, minutes));
};

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

const shiftBand = (minutes: number) => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  if (normalized < 660) return "morning";
  if (normalized < 1080) return "afternoon";
  return "evening";
};

const formatMinutes = (minutes: number) => {
  const normalized = Math.round(minutes / 15) * 15 % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return formatTime(
    `${`${hours}`.padStart(2, "0")}:${`${mins}`.padStart(2, "0")}`,
  );
};

const cleanAirportCode = (value: string) =>
  (value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "ABE");

const flightTimes = (flight: Flight) =>
  [flight.arrival, flight.departure, flight.start, flight.end].filter(
    (time): time is string => Boolean(time),
  );

const flightDisplay = (flight: Flight, homeAirport: string) => {
  const home = cleanAirportCode(homeAirport);
  if (flight.kind === "turnaround") {
    return {
      time: `${formatTime(flight.arrival ?? flight.start)} - ${formatTime(flight.departure ?? flight.end ?? flight.start)}`,
      subtime: "arr / dep",
      left: flight.inboundAirport ?? flight.origin,
      leftLabel: "arrives from",
      center: home,
      centerLabel: "turn",
      right: flight.outboundAirport ?? flight.destination ?? "TBD",
      rightLabel: "departs to",
      chip: "Turnaround",
    };
  }
  if (flight.kind === "departure") {
    return {
      time: formatTime(flight.departure ?? flight.start),
      subtime: "departure",
      left: home,
      leftLabel: "home",
      center: "",
      centerLabel: "",
      right: flight.outboundAirport ?? flight.destination ?? "TBD",
      rightLabel: "to",
      chip: "Outbound",
    };
  }
  return {
    time: formatTime(flight.arrival ?? flight.start),
    subtime: "arrival",
    left: flight.inboundAirport ?? flight.origin,
    leftLabel: "from",
    center: "",
    centerLabel: "",
    right: home,
    rightLabel: "home",
    chip: "Inbound",
  };
};

const calendarKeyFor = (person: string, date: string) =>
  `shift:${person.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${date}`;

const personKey = (person: string) =>
  person.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const calendarUid = (key: string) =>
  `${key.toLowerCase().replace(/[^a-z0-9:-]+/g, "-")}@shiftdeck.app`;

const eventSignature = (event: CalendarEvent, prefs: Preferences) =>
  JSON.stringify([
    event.date,
    event.start,
    event.end,
    event.title,
    prefs.location,
    prefs.reminder1,
    prefs.reminder2,
  ]);

const revisedTitle = (title: string, revision: number) => {
  if (revision <= 0) return title;
  return revision === 1
    ? `${title} \u2014 Revised`
    : `${title} \u2014 Revised ${revision}`;
};

const eventsFor = (shifts: Shift[], person: string, title: string) =>
  shifts
    .filter(
      (shift) =>
        shift.worker === person && shift.status === "working",
    )
    .map((shift) => ({
      id: shift.id,
      calendarKey: calendarKeyFor(person, shift.date),
      date: shift.date,
      start: shift.start,
      end: shift.end,
      title,
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

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function workdayDateKey(now: Date, shifts: Shift[], person: string) {
  const previousDate = new Date(now);
  previousDate.setDate(previousDate.getDate() - 1);
  const previousDateKey = localDateKey(previousDate);
  const previousShift = getWorkingShift(shifts, previousDateKey, person);

  if (
    !previousShift ||
    toMinutes(previousShift.end) > toMinutes(previousShift.start)
  ) {
    return localDateKey(now);
  }

  const [endHour, endMinute] = previousShift.end.split(":").map(Number);
  const rolloverTime = new Date(now);
  rolloverTime.setHours(endHour + 2, endMinute, 0, 0);
  return now < rolloverTime ? previousDateKey : localDateKey(now);
}

function flightAwareRouteUrl(flight: Flight, homeAirport: string) {
  const home = cleanAirportCode(homeAirport);
  const origin =
    flight.kind === "departure"
      ? home
      : cleanAirportCode(flight.inboundAirport ?? flight.origin);
  const destination =
    flight.kind === "departure"
      ? cleanAirportCode(flight.outboundAirport ?? flight.destination ?? "")
      : home;

  return `https://www.flightaware.com/live/findflight?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
}

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("home");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [selectedDate, setSelectedDate] = useState(() => localDateKey());
  const [importedDates, setImportedDates] = useState<string[]>([]);
  const [parsedShifts, setParsedShifts] = useState<Shift[]>([]);
  const [parsedFlights, setParsedFlights] = useState<Flight[]>([]);
  const [scheduleDocuments, setScheduleDocuments] = useState<ScheduleDocument[]>([]);
  const [expandedDocument, setExpandedDocument] = useState<string | null>(null);
  const [documentPreviews, setDocumentPreviews] = useState<Record<string, string>>({});
  const [airportOptions, setAirportOptions] = useState<AviationOption[]>([]);
  const [airlineOptions, setAirlineOptions] = useState<AviationOption[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shiftEditor, setShiftEditor] = useState<{
    mode: "add" | "edit";
    eventId?: string;
  } | null>(null);
  const [shiftDraft, setShiftDraft] = useState<ShiftDraft>({
    date: "2026-07-26",
    start: "09:00",
    end: "17:00",
  });
  const [timeOffDraft, setTimeOffDraft] = useState<TimeOffDraft>({
    date: "2026-07-26",
    start: "09:00",
    end: "17:00",
  });
  const [showAllFlights, setShowAllFlights] = useState(false);
  const [importState, setImportState] = useState<
    "idle" | "reading" | "review" | "done" | "error"
  >("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState("");
  const [loadedFiles, setLoadedFiles] = useState<string[]>([]);
  const [duplicateNotice, setDuplicateNotice] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [calendarHistory, setCalendarHistory] = useState<CalendarHistory>({});
  const [pendingDates, setPendingDates] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const savedPrefs = localStorage.getItem("shiftdeck.preferences");
      const savedTheme = localStorage.getItem("shiftdeck.theme");
      const savedCalendarHistory = localStorage.getItem(
        "shiftdeck.calendarHistory",
      );
      const savedDates = localStorage.getItem("shiftdeck.activeDates");
      const savedParsedShifts = localStorage.getItem("shiftdeck.parsedShifts");
      const savedParsedFlights = localStorage.getItem("shiftdeck.parsedFlights");
      const savedDocuments = localStorage.getItem("shiftdeck.scheduleDocuments");
      const savedEvents = localStorage.getItem("shiftdeck.events");
      let parsedPrefs = DEFAULT_PREFS;
      let parsedDates: string[] = [];
      if (savedPrefs) {
        try {
          const saved = JSON.parse(savedPrefs) as Partial<Preferences>;
          parsedPrefs = {
            person: saved.person ?? DEFAULT_PREFS.person,
            title: saved.title ?? DEFAULT_PREFS.title,
            reminder1: saved.reminder1 ?? "",
            reminder2: saved.reminder2 ?? "",
            location: saved.location ?? DEFAULT_PREFS.location,
            notes: saved.notes ?? DEFAULT_PREFS.notes,
            homeAirport: saved.homeAirport ?? DEFAULT_PREFS.homeAirport,
            airline: saved.airline ?? DEFAULT_PREFS.airline,
          };
          setPrefs(parsedPrefs);
        } catch {
          // A malformed local preference should never block the schedule.
        }
      }
      if (savedDates) {
        try {
          parsedDates = JSON.parse(savedDates).filter(
            (date: unknown) =>
              typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
          );
          setImportedDates(parsedDates);
          setSelectedDate(localDateKey());
        } catch {
          localStorage.removeItem("shiftdeck.activeDates");
        }
      }
      let restoredShifts: Shift[] = [];
      let restoredFlights: Flight[] = [];
      if (savedDocuments) {
        try {
          const documents = (JSON.parse(savedDocuments) as ScheduleDocument[]).filter(
            (document) =>
              document &&
              typeof document.id === "string" &&
              typeof document.hash === "string" &&
              Array.isArray(document.dates) &&
              Array.isArray(document.shifts) &&
              Array.isArray(document.flights),
          );
          setScheduleDocuments(documents);
        } catch {
          localStorage.removeItem("shiftdeck.scheduleDocuments");
        }
      }
      if (savedParsedShifts) {
        try {
          restoredShifts = (JSON.parse(savedParsedShifts) as Shift[]).filter(
            (shift) =>
              shift &&
              typeof shift.id === "string" &&
              typeof shift.date === "string" &&
              typeof shift.worker === "string",
          );
        } catch {
          localStorage.removeItem("shiftdeck.parsedShifts");
        }
      }
      if (savedParsedFlights) {
        try {
          restoredFlights = (JSON.parse(savedParsedFlights) as Flight[]).filter(
            (flight) =>
              flight &&
              typeof flight.id === "string" &&
              typeof flight.date === "string",
          );
        } catch {
          localStorage.removeItem("shiftdeck.parsedFlights");
        }
      }
      if (!restoredShifts.length && parsedDates.length) {
        restoredShifts = sampleShifts.filter((shift) =>
          parsedDates.includes(shift.date),
        );
        restoredFlights = sampleFlights.filter((flight) =>
          parsedDates.includes(flight.date),
        );
      }
      setParsedShifts(restoredShifts);
      setParsedFlights(restoredFlights);
      const fallbackEvents = eventsFor(
        restoredShifts,
        parsedPrefs.person,
        parsedPrefs.title,
      );
      if (savedEvents) {
        try {
          const parsedEvents = (JSON.parse(savedEvents) as CalendarEvent[]).filter(
            (event) =>
              event &&
              typeof event.id === "string" &&
              typeof event.date === "string" &&
              typeof event.start === "string" &&
              typeof event.end === "string",
          );
          setEvents(parsedEvents);
        } catch {
          localStorage.removeItem("shiftdeck.events");
          setEvents(fallbackEvents);
        }
      } else {
        setEvents(fallbackEvents);
      }
      if (savedCalendarHistory) {
        try {
          setCalendarHistory(JSON.parse(savedCalendarHistory));
        } catch {
          localStorage.removeItem("shiftdeck.calendarHistory");
        }
      }
      if (savedTheme === "dark") setTheme("dark");
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeColor = theme === "dark" ? "#17191d" : "#f4f5f7";
    let metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement("meta");
      metaTheme.name = "theme-color";
      document.head.appendChild(metaTheme);
    }
    metaTheme.content = themeColor;
    let statusStyle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!statusStyle) {
      statusStyle = document.createElement("meta");
      statusStyle.name = "apple-mobile-web-app-status-bar-style";
      document.head.appendChild(statusStyle);
    }
    statusStyle.content = theme === "dark" ? "black-translucent" : "default";
    localStorage.setItem("shiftdeck.theme", theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("shiftdeck.preferences", JSON.stringify(prefs));
  }, [prefs, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("shiftdeck.events", JSON.stringify(events));
  }, [events, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("shiftdeck.activeDates", JSON.stringify(importedDates));
  }, [hydrated, importedDates]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("shiftdeck.parsedShifts", JSON.stringify(parsedShifts));
  }, [hydrated, parsedShifts]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("shiftdeck.parsedFlights", JSON.stringify(parsedFlights));
  }, [hydrated, parsedFlights]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      "shiftdeck.scheduleDocuments",
      JSON.stringify(scheduleDocuments),
    );
  }, [hydrated, scheduleDocuments]);

  useEffect(() => {
    if (!settingsOpen || (airportOptions.length && airlineOptions.length)) return;
    let cancelled = false;
    void Promise.all([
      fetch("./data/airports.json").then((response) => response.json() as Promise<AirportData[]>),
      fetch("./data/airlines.json").then((response) => response.json() as Promise<AirlineData[]>),
    ]).then(([airports, airlines]) => {
      if (cancelled) return;
      setAirportOptions(
        airports.map((airport) => ({
          value: airport.c,
          label: `${airport.c} — ${airport.n}${airport.m ? ` · ${airport.m}` : ""}`,
          search: `${airport.c} ${airport.n} ${airport.m} ${airport.r}`.toLowerCase(),
        })),
      );
      setAirlineOptions(
        airlines.map((airline) => ({
          value: airline.n,
          label: `${airline.n}${airline.i ? ` (${airline.i})` : airline.c ? ` (${airline.c})` : ""}`,
          search: `${airline.n} ${airline.i} ${airline.c}`.toLowerCase(),
        })),
      );
    }).catch(() => {
      if (!cancelled) setToast("Airport and airline lists couldn’t be loaded");
    });
    return () => {
      cancelled = true;
    };
  }, [airportOptions.length, airlineOptions.length, settingsOpen]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    const updateClock = () => setClockNow(new Date());
    updateClock();
    const interval = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const importedDateSet = useMemo(() => new Set(importedDates), [importedDates]);

  const scheduleDates = useMemo(
    () => Array.from(importedDateSet).sort(),
    [importedDateSet],
  );

  const baseImportedShifts = useMemo(
    () => parsedShifts.filter((shift) => importedDateSet.has(shift.date)),
    [importedDateSet, parsedShifts],
  );

  const importedShifts = useMemo(
    () => [
      ...baseImportedShifts.filter((shift) => shift.worker !== prefs.person),
      ...events.map<Shift>((event) => ({
        id: event.id,
        date: event.date,
        worker: prefs.person,
        start: event.start,
        end: event.end,
        status: "working",
      })),
    ],
    [baseImportedShifts, events, prefs.person],
  );

  const todayDate = useMemo(
    () => workdayDateKey(clockNow, importedShifts, prefs.person),
    [clockNow, importedShifts, prefs.person],
  );

  useEffect(() => {
    if (!hydrated || tab !== "home") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedDate(todayDate);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, tab, todayDate]);

  const importedFlights = useMemo(
    () => parsedFlights.filter((flight) => importedDateSet.has(flight.date)),
    [importedDateSet, parsedFlights],
  );

  const availableWorkers = useMemo(() => {
    const names = Array.from(new Set(importedShifts.map((shift) => shift.worker)));
    return names.length ? names : [prefs.person];
  }, [importedShifts, prefs.person]);

  const hasSchedule = scheduleDates.length > 0;

  const myEvent = useMemo(
    () => events.find((event) => event.date === selectedDate),
    [events, selectedDate],
  );

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

  const timeOffAnalysis = useMemo(() => {
    const isLoaded = importedDateSet.has(timeOffDraft.date);
    const shift = getWorkingShift(
      importedShifts,
      timeOffDraft.date,
      prefs.person,
    );
    const requestedWindow: Shift = {
      id: "requested-time-off",
      date: timeOffDraft.date,
      worker: prefs.person,
      start: timeOffDraft.start,
      end: timeOffDraft.end,
      status: "working",
    };
    const needsCoverage = Boolean(
      isLoaded &&
        shift &&
        timeOffDraft.start &&
        timeOffDraft.end &&
        shiftsOverlap(shift, requestedWindow),
    );

    if (!shift || !needsCoverage) {
      return {
        isLoaded,
        shift,
        needsCoverage,
        recommended: [] as SwapCandidate[],
        others: [] as SwapCandidate[],
      };
    }

    const [targetStart, targetEnd] = normalizedInterval(
      shift.start,
      shift.end,
    );
    const targetDuration = targetEnd - targetStart;
    const candidates = availableWorkers
      .filter((worker) => worker !== prefs.person)
      .flatMap<SwapCandidate>((worker) => {
        const targetDay = importedShifts.filter(
          (candidateShift) =>
            candidateShift.worker === worker &&
            candidateShift.date === timeOffDraft.date,
        );
        if (
          targetDay.some(
            (candidateShift) =>
              candidateShift.status === "working" ||
              candidateShift.status === "pto",
          )
        ) {
          return [];
        }

        const history = importedShifts.filter(
          (candidateShift) =>
            candidateShift.worker === worker &&
            candidateShift.date !== timeOffDraft.date &&
            candidateShift.status === "working",
        );
        if (!history.length) return [];

        const intervals = history.map((candidateShift) =>
          normalizedInterval(candidateShift.start, candidateShift.end),
        );
        const averageStart =
          intervals.reduce((total, interval) => total + interval[0], 0) /
          intervals.length;
        const averageEnd =
          intervals.reduce((total, interval) => total + interval[1], 0) /
          intervals.length;
        const averageDuration = averageEnd - averageStart;
        const distance =
          Math.abs(averageStart - targetStart) +
          Math.abs(averageEnd - targetEnd) +
          Math.abs(averageDuration - targetDuration) * 0.5;
        const score = Math.max(0, Math.round(100 - distance / 18));
        return [
          {
            worker,
            averageStart,
            averageEnd,
            score,
            sampleCount: history.length,
            sameShiftBand:
              shiftBand(averageStart) === shiftBand(targetStart),
            availability: targetDay.length
              ? "Off that day"
              : "Not scheduled",
          },
        ];
      })
      .sort((first, second) => second.score - first.score);

    const recommended = candidates
      .filter((candidate) => candidate.sameShiftBand && candidate.score >= 60)
      .slice(0, 3);
    const recommendedNames = new Set(
      recommended.map((candidate) => candidate.worker),
    );

    return {
      isLoaded,
      shift,
      needsCoverage,
      recommended,
      others: candidates.filter(
        (candidate) => !recommendedNames.has(candidate.worker),
      ),
    };
  }, [
    availableWorkers,
    importedDateSet,
    importedShifts,
    prefs.person,
    timeOffDraft,
  ]);

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

  const calendarChanges = useMemo<CalendarChange[]>(() => {
    if (!pendingDates.length) return [];

    const pendingDateSet = new Set(pendingDates);
    const currentKeys = new Set(
      events
        .filter((event) => pendingDateSet.has(event.date))
        .map((event) => event.calendarKey),
    );
    const changes: CalendarChange[] = events
      .filter((event) => pendingDateSet.has(event.date))
      .flatMap((event) => {
        const exportEvent = { ...event, title: prefs.title.trim() };
        const signature = eventSignature(exportEvent, prefs);
        const previous = calendarHistory[event.calendarKey];
        if (
          previous?.status === "confirmed" &&
          previous.signature === signature
        ) {
          return [];
        }
        return [
          {
            kind: "upsert" as const,
            calendarKey: event.calendarKey,
            event: exportEvent,
            revision: previous ? previous.revision + 1 : 0,
            signature,
          },
        ];
      });

    Object.values(calendarHistory).forEach((record) => {
      if (
        record.person === prefs.person &&
        pendingDateSet.has(record.date) &&
        record.status === "confirmed" &&
        !currentKeys.has(record.calendarKey)
      ) {
        changes.push({
          kind: "cancel",
          calendarKey: record.calendarKey,
          record,
          revision: record.revision + 1,
        });
      }
    });

    return changes.sort((first, second) => {
      const firstDate =
        first.kind === "upsert" ? first.event.date : first.record.date;
      const secondDate =
        second.kind === "upsert" ? second.event.date : second.record.date;
      return firstDate.localeCompare(secondDate);
    });
  }, [calendarHistory, events, pendingDates, prefs]);

  const calendarReplayChanges = useMemo<CalendarChange[]>(() => {
    const currentKeys = new Set(events.map((event) => event.calendarKey));
    const current = events.map((event) => {
      const exportEvent = { ...event, title: prefs.title.trim() };
      const previous = calendarHistory[event.calendarKey];
      return {
        kind: "upsert" as const,
        calendarKey: event.calendarKey,
        event: exportEvent,
        revision: previous?.revision ?? 0,
        signature: eventSignature(exportEvent, prefs),
      };
    });
    const cancelled = Object.values(calendarHistory)
      .filter(
        (record) =>
          record.person === prefs.person &&
          record.status === "cancelled" &&
          !currentKeys.has(record.calendarKey),
      )
      .map((record) => ({
        kind: "cancel" as const,
        calendarKey: record.calendarKey,
        record,
        revision: record.revision,
      }));
    return [...current, ...cancelled].sort((first, second) => {
      const firstDate =
        first.kind === "upsert" ? first.event.date : first.record.date;
      const secondDate =
        second.kind === "upsert" ? second.event.date : second.record.date;
      return firstDate.localeCompare(secondDate);
    });
  }, [calendarHistory, events, prefs]);

  const calendarExportChanges = calendarChanges.length
    ? calendarChanges
    : calendarReplayChanges;
  const canExportCalendar = calendarExportChanges.length > 0;

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setShowAllFlights(false);
  };

  const openTodayTab = () => {
    setSelectedDate(todayDate);
    setShowAllFlights(false);
    setTab("home");
  };

  const updateTimeOffDate = (date: string) => {
    const shift = getWorkingShift(importedShifts, date, prefs.person);
    setTimeOffDraft({
      date,
      start: shift?.start ?? "09:00",
      end: shift?.end ?? "17:00",
    });
  };

  const openTimeOffTab = () => {
    const date = importedDateSet.has(selectedDate)
      ? selectedDate
      : scheduleDates[0] ?? selectedDate;
    updateTimeOffDate(date);
    setTab("timeoff");
  };

  const jumpDate = (amount: number) => {
    if (!scheduleDates.length) return;
    const current = Math.max(0, scheduleDates.indexOf(selectedDate));
    const next = Math.min(
      scheduleDates.length - 1,
      Math.max(0, current + amount),
    );
    selectDate(scheduleDates[next]);
  };

  const savePrefs = (next: Partial<Preferences>) => {
    const updated = { ...prefs, ...next };
    setPrefs(updated);
    if (next.person) {
      setEvents(eventsFor(importedShifts, next.person, updated.title));
      setShowAllFlights(false);
    }
  };

  const changeTheme = (nextTheme: "light" | "dark") => {
    if (nextTheme === theme) return;
    localStorage.setItem("shiftdeck.theme", nextTheme);
    setTheme(nextTheme);
    window.setTimeout(() => window.location.reload(), 80);
  };

  const openAddShift = () => {
    setShiftDraft({
      date: selectedDate,
      start: "09:00",
      end: "17:00",
    });
    setShiftEditor({ mode: "add" });
  };

  const openEditShift = () => {
    if (!myEvent) return;
    setShiftDraft({
      date: myEvent.date,
      start: myEvent.start,
      end: myEvent.end,
    });
    setShiftEditor({ mode: "edit", eventId: myEvent.id });
  };

  const hashFile = async (file: File) => {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const loadParsedSchedules = (schedules: ParsedSchedule[]) => {
    const detectedDates = Array.from(
      new Set(schedules.flatMap((schedule) => schedule.dates)),
    ).sort();
    const detectedDateSet = new Set(detectedDates);
    const nextParsedShifts = Array.from(new Map([
      ...parsedShifts.filter((shift) => !detectedDateSet.has(shift.date)),
      ...schedules.flatMap((schedule) => schedule.shifts),
    ].map((shift) => [shift.id, shift] as const)).values());
    const nextParsedFlights = Array.from(new Map([
      ...parsedFlights.filter((flight) => !detectedDateSet.has(flight.date)),
      ...schedules.flatMap((schedule) => schedule.flights),
    ].map((flight) => [flight.id, flight] as const)).values());
    const nextDates = Array.from(
      new Set([...importedDates, ...detectedDates]),
    ).sort();
    const matching = nextParsedShifts
      .filter(
        (shift) =>
          personKey(shift.worker) === personKey(prefs.person) &&
          shift.status === "working" &&
          detectedDates.includes(shift.date),
      )
      .map((shift) => ({
        id: shift.id,
        calendarKey: calendarKeyFor(prefs.person, shift.date),
        date: shift.date,
        start: shift.start,
        end: shift.end,
        title: prefs.title,
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
      selectDate(detectedDates[0]);
    }
    setParsedShifts(nextParsedShifts);
    setParsedFlights(nextParsedFlights);
    setImportedDates(nextDates);
    setPendingDates(detectedDates);
    localStorage.setItem("shiftdeck.activeDates", JSON.stringify(nextDates));
    return matching.length;
  };

  const processFiles = async (files: File[]) => {
    if (!files.length) return;
    setImportState("reading");
    setImportProgress(4);
    setDuplicateNotice("");
    setLoadedFiles(files.map((file) => file.name));

    const parsedSchedules: ParsedSchedule[] = [];
    let nextDocuments = [...scheduleDocuments];
    let updatedDocuments = 0;
    let duplicateFiles = 0;

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setImportMessage(`Checking ${file.name}`);
        const hash = await hashFile(file);
        if (nextDocuments.some((document) => document.hash === hash)) {
          duplicateFiles += 1;
          continue;
        }

        setImportMessage(`Reading the schedule in ${file.name}`);
        const { createWorker, PSM } = await import("tesseract.js");
        const worker = await createWorker("eng", 1, {
          logger: (status) => {
            if (status.status === "recognizing text") {
              const fileBase = index / files.length;
              const fileShare = status.progress / files.length;
              setImportProgress(Math.round((fileBase + fileShare) * 88));
            }
          },
        });
        let parsed: ParsedSchedule | null = null;
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            preserve_interword_spaces: "1",
          });
          let result = await worker.recognize(
            file,
            { rotateAuto: true },
            { text: true, tsv: true },
          );
          parsed = result.data.tsv
            ? parseScheduleTsv(result.data.tsv, result.data.confidence)
            : null;
          if (!parsed) {
            await worker.setParameters({
              tessedit_pageseg_mode: PSM.AUTO,
              preserve_interword_spaces: "1",
            });
            result = await worker.recognize(
              file,
              { rotateAuto: true },
              { text: true, tsv: true },
            );
            parsed = result.data.tsv
              ? parseScheduleTsv(result.data.tsv, result.data.confidence)
              : null;
          }
        } finally {
          await worker.terminate();
        }
        if (!parsed) continue;
        parsedSchedules.push(parsed);

        const replacementIndex = nextDocuments.findIndex((document) =>
          document.dates.some((date) => parsed?.dates.includes(date)),
        );
        const replacement =
          replacementIndex >= 0 ? nextDocuments[replacementIndex] : null;
        const now = new Date().toISOString();
        const documentId = replacement?.id ?? `schedule-${hash.slice(0, 20)}`;
        const nextDocument: ScheduleDocument = {
          id: documentId,
          hash,
          name: file.name,
          dates: parsed.dates,
          shifts: parsed.shifts,
          flights: parsed.flights,
          uploadedAt: replacement?.uploadedAt ?? now,
          updatedAt: now,
          revision: (replacement?.revision ?? 0) + 1,
        };
        if (replacement) {
          nextDocuments[replacementIndex] = nextDocument;
          updatedDocuments += 1;
          const preview = documentPreviews[documentId];
          if (preview) URL.revokeObjectURL(preview);
          setDocumentPreviews((current) => {
            const next = { ...current };
            delete next[documentId];
            return next;
          });
          if (expandedDocument === documentId) setExpandedDocument(null);
        } else {
          nextDocuments.push(nextDocument);
        }
        await saveScheduleImage(documentId, file).catch(() => undefined);
      }

      if (!parsedSchedules.length) {
        if (duplicateFiles) {
          setDuplicateNotice(
            `${duplicateFiles === 1 ? "This photo has" : "These photos have"} already been imported on this device. Nothing was added twice.`,
          );
          setImportMessage("That schedule is already in your upload history.");
          setImportProgress(100);
          setImportState("review");
          return;
        }
        setPendingDates([selectedDate]);
        setImportMessage(
          "I could read text in the photo, but couldn’t map its dates and schedule grid. Make sure the full table and all seven date columns are visible.",
        );
        setImportProgress(100);
        setImportState("error");
        setToast("Schedule grid not recognized");
        return;
      }

      const count = loadParsedSchedules(parsedSchedules);
      nextDocuments = nextDocuments.sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      setScheduleDocuments(nextDocuments);
      const parsedShiftCount = parsedSchedules
        .flatMap((schedule) => schedule.shifts)
        .filter((shift) => shift.status === "working").length;
      const parsedFlightCount = parsedSchedules.flatMap(
        (schedule) => schedule.flights,
      ).length;
      const warnings = Array.from(
        new Set(parsedSchedules.flatMap((schedule) => schedule.warnings)),
      );
      localStorage.setItem(
        "shiftdeck.importHashes",
        JSON.stringify(nextDocuments.map((document) => document.hash)),
      );
      if (duplicateFiles) {
        setDuplicateNotice(
          `${duplicateFiles === 1 ? "This photo has" : "These photos have"} already been imported on this device. Nothing was added twice.`,
        );
      }
      setImportProgress(100);
      setImportMessage(
        `${updatedDocuments ? "Updated schedule replaced. " : ""}${count} of your shifts found, plus ${Math.max(0, parsedShiftCount - count)} coworker shifts and ${parsedFlightCount} flights.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      );
      setImportState("review");
      setToast("Schedule imported");
    } catch {
      setPendingDates([selectedDate]);
      setImportState("error");
      setImportProgress(100);
      setImportMessage(
        "I couldn’t confidently read that image. Try a clearer photo with the full schedule visible.",
      );
    }
  };

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    void processFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const toggleScheduleDocument = async (document: ScheduleDocument) => {
    if (expandedDocument === document.id) {
      setExpandedDocument(null);
      return;
    }
    setExpandedDocument(document.id);
    if (documentPreviews[document.id]) return;
    const image = await loadScheduleImage(document.id).catch(() => undefined);
    if (!image) {
      setToast("The saved preview isn’t available on this device");
      return;
    }
    setDocumentPreviews((current) => ({
      ...current,
      [document.id]: URL.createObjectURL(image),
    }));
  };

  const removeScheduleDocument = async (document: ScheduleDocument) => {
    const nextDocuments = scheduleDocuments.filter(
      (candidate) => candidate.id !== document.id,
    );
    const remainingDates = new Set(
      nextDocuments.flatMap((candidate) => candidate.dates),
    );
    const removedDates = new Set(
      document.dates.filter((date) => !remainingDates.has(date)),
    );
    const nextDates = importedDates.filter((date) => !removedDates.has(date));

    setScheduleDocuments(nextDocuments);
    setImportedDates(nextDates);
    setParsedShifts((current) =>
      current.filter((shift) => !removedDates.has(shift.date)),
    );
    setParsedFlights((current) =>
      current.filter((flight) => !removedDates.has(flight.date)),
    );
    setEvents((current) =>
      current.filter((event) => !removedDates.has(event.date)),
    );
    setPendingDates((current) =>
      current.filter((date) => !removedDates.has(date)),
    );
    if (removedDates.has(selectedDate)) {
      setSelectedDate(nextDates[0] ?? localDateKey());
    }
    const preview = documentPreviews[document.id];
    if (preview) URL.revokeObjectURL(preview);
    setDocumentPreviews((current) => {
      const next = { ...current };
      delete next[document.id];
      return next;
    });
    if (expandedDocument === document.id) setExpandedDocument(null);
    await deleteScheduleImage(document.id).catch(() => undefined);
    localStorage.setItem(
      "shiftdeck.importHashes",
      JSON.stringify(nextDocuments.map((candidate) => candidate.hash)),
    );
    setToast("Uploaded schedule deleted");
  };

  const saveShift = () => {
    if (!shiftDraft.date || !shiftDraft.start || !shiftDraft.end) {
      setToast("Add a date, start time, and stop time");
      return;
    }

    const editing = shiftEditor?.eventId
      ? events.find((event) => event.id === shiftEditor.eventId)
      : undefined;
    const existingOnDate = events.find(
      (event) =>
        event.date === shiftDraft.date && event.id !== shiftEditor?.eventId,
    );
    const nextEvent: CalendarEvent = {
      id: editing?.id ?? existingOnDate?.id ?? `manual-${Date.now()}`,
      calendarKey: calendarKeyFor(prefs.person, shiftDraft.date),
      date: shiftDraft.date,
      start: shiftDraft.start,
      end: shiftDraft.end,
      title: prefs.title,
    };

    setEvents((current) =>
      [
        ...current.filter(
          (event) =>
            event.id !== editing?.id && event.id !== existingOnDate?.id,
        ),
        nextEvent,
      ].sort((first, second) =>
        `${first.date}${first.start}`.localeCompare(
          `${second.date}${second.start}`,
        ),
      ),
    );
    setImportedDates((current) =>
      Array.from(new Set([...current, shiftDraft.date])).sort(),
    );
    setPendingDates((current) =>
      Array.from(
        new Set([
          ...current,
          shiftDraft.date,
          ...(editing ? [editing.date] : []),
        ]),
      ),
    );
    setSelectedDate(shiftDraft.date);
    setImportState("review");
    setImportMessage(
      editing || existingOnDate
        ? "Your shift was updated."
        : "Your manual shift was added.",
    );
    setShiftEditor(null);
    setToast(editing || existingOnDate ? "Shift updated" : "Shift added");
  };

  const deleteShift = () => {
    const editing = shiftEditor?.eventId
      ? events.find((event) => event.id === shiftEditor.eventId)
      : undefined;
    if (!editing) return;
    setEvents((current) =>
      current.filter((event) => event.id !== editing.id),
    );
    setPendingDates((current) =>
      current.includes(editing.date) ? current : [...current, editing.date],
    );
    setImportState("review");
    setImportMessage("Your shift was removed.");
    setShiftEditor(null);
    setToast("Shift deleted");
  };

  const clearAllData = () => {
    [
      "shiftdeck.preferences",
      "shiftdeck.theme",
      "shiftdeck.importHashes",
      "shiftdeck.exportedEvents",
      "shiftdeck.calendarFeed",
      "shiftdeck.calendarHistory",
      "shiftdeck.activeDates",
      "shiftdeck.parsedShifts",
      "shiftdeck.parsedFlights",
      "shiftdeck.scheduleDocuments",
      "shiftdeck.events",
    ].forEach((key) => localStorage.removeItem(key));
    setPrefs(DEFAULT_PREFS);
    setTheme("light");
    setSelectedDate(localDateKey());
    setImportedDates([]);
    setParsedShifts([]);
    setParsedFlights([]);
    setScheduleDocuments([]);
    setExpandedDocument(null);
    Object.values(documentPreviews).forEach((url) => URL.revokeObjectURL(url));
    setDocumentPreviews({});
    void clearScheduleImages().catch(() => undefined);
    setEvents([]);
    setImportState("idle");
    setImportProgress(0);
    setImportMessage("");
    setLoadedFiles([]);
    setDuplicateNotice("");
    setCalendarHistory({});
    setPendingDates([]);
    setClearConfirmOpen(false);
    setSettingsOpen(false);
    setExportOpen(false);
    setShiftEditor(null);
    setToast("All Shiftdeck data cleared from this device");
  };

  const buildCalendar = (changes: CalendarChange[]) => {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const reminders = Array.from(
      new Set([prefs.reminder1, prefs.reminder2].filter(Boolean)),
    );
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Shiftdeck//Schedule Export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Shiftdeck",
      ...changes.flatMap((change) => {
        const event =
          change.kind === "upsert" ? change.event : change.record;
        const overnight = toMinutes(event.end) <= toMinutes(event.start);
        const title = revisedTitle(event.title, change.revision);
        const eventLines = [
          "BEGIN:VEVENT",
          `UID:${calendarUid(change.calendarKey)}`,
          `DTSTAMP:${stamp}`,
          `LAST-MODIFIED:${stamp}`,
          `SEQUENCE:${change.revision}`,
          `DTSTART:${icsTime(event.date, event.start)}`,
          `DTEND:${icsTime(event.date, event.end, overnight)}`,
          `SUMMARY:${safeText(title)}`,
          `X-SHIFTDECK-REVISION:${change.revision}`,
        ];

        if (change.kind === "cancel") {
          eventLines.push("STATUS:CANCELLED");
        } else {
          eventLines.push(
            "STATUS:CONFIRMED",
            `LOCATION:${safeText(prefs.location)}`,
            `DESCRIPTION:${safeText(prefs.notes)}`,
          );
        }

        if (change.kind === "upsert") {
          reminders.forEach((reminder) => {
            eventLines.push(
              "BEGIN:VALARM",
              `TRIGGER:${reminder === "PT0M" ? "PT0M" : `-${reminder}`}`,
              "ACTION:DISPLAY",
              `DESCRIPTION:${safeText(title)}`,
              "END:VALARM",
            );
          });
        }
        eventLines.push("END:VEVENT");
        return eventLines;
      }),
      "END:VCALENDAR",
    ];
    return `${lines.join("\r\n")}\r\n`;
  };

  const exportCalendar = () => {
    if (!prefs.title.trim()) {
      setToast("Add an event title first");
      return;
    }
    if (!calendarExportChanges.length) {
      setToast("Add a shift before exporting");
      return;
    }

    const content = buildCalendar(calendarExportChanges);
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Shiftdeck_Schedule.ics";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 0);

    const nextHistory = { ...calendarHistory };
    calendarExportChanges.forEach((change) => {
      if (change.kind === "upsert") {
        nextHistory[change.calendarKey] = {
          calendarKey: change.calendarKey,
          person: prefs.person,
          date: change.event.date,
          start: change.event.start,
          end: change.event.end,
          title: change.event.title,
          signature: change.signature,
          revision: change.revision,
          status: "confirmed",
        };
      } else {
        nextHistory[change.calendarKey] = {
          ...change.record,
          revision: change.revision,
          status: "cancelled",
        };
      }
    });

    setCalendarHistory(nextHistory);
    localStorage.setItem(
      "shiftdeck.calendarHistory",
      JSON.stringify(nextHistory),
    );
    setImportState("done");
    setExportOpen(false);
    setToast(
      calendarExportChanges.some((change) => change.revision > 0)
        ? "Revised shifts are ready for Apple Calendar"
        : "Schedule is ready for Apple Calendar",
    );
  };

  const isFlightDuringShift = (flight: Flight) => {
    if (!myShift) return false;
    const [start, end] = normalizedInterval(myShift.start, myShift.end);
    return flightTimes(flight).some((flightTime) => {
      let time = toMinutes(flightTime);
      if (start > 720 && time < 360) time += 1440;
      return time >= start && time <= end;
    });
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
            onClick={() => selectDate(date)}
            aria-label={`Show ${formatDate(date, "long")}`}
          >
            <span>{day.weekday}</span>
            <strong>{day.day}</strong>
            {!compact && <small>{userShift ? formatTime(userShift.start) : "Off"}</small>}
          </button>
        );
      })}
    </div>
  );

  const renderHome = () => {
    const isToday = selectedDate === todayDate;
    const isLoadedDate = importedDateSet.has(selectedDate);
    const heroTitle = myShift
      ? `${formatTime(myShift.start)} – ${formatTime(myShift.end)}`
      : isLoadedDate
        ? isToday
          ? "You’re off today"
          : "You’re off"
        : isToday
          ? "No schedule for today"
          : "No schedule loaded";

    return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-glow" />
        <div className="hero-topline">
          <div className="eyebrow">
            <Sparkles size={14} />
            {isToday ? "Today" : "Selected day"}
          </div>
          {myEvent && (
            <button className="hero-edit" onClick={openEditShift} aria-label="Edit this shift">
              <Pencil />
            </button>
          )}
        </div>
        <h1>{heroTitle}</h1>
        <p>
          {formatDate(selectedDate, "long")}
          {myShift?.note ? ` · ${myShift.note}` : ""}
        </p>
        <div className="hero-facts">
          <div>
            <b>{overlapping.length}</b>
            <span>working with you</span>
          </div>
          <div>
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
            <h2>{myShift ? "Who overlaps your shift" : "No shift selected"}</h2>
          </div>
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
  };

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
                    className={`shift-bar relation-${group.relation}`}
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
              <article className={`mobile-shift-card relation-${group.relation}`} key={group.key}>
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
            <h2>{formatDate(selectedDate, "long")}</h2>
          </div>
          {hiddenFlightCount > 0 && (
            <div className="flight-heading-actions">
              <button className="button soft compact-toggle" onClick={() => setShowAllFlights((current) => !current)}>
                {showAllFlights ? "Show shift only" : `Show all ${dayFlights.length}`}
              </button>
            </div>
          )}
        </div>
        {(["Morning", "Afternoon", "Evening"] as const).map((period) => {
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
                  const display = flightDisplay(flight, prefs.homeAirport);
                  return (
                    <a
                      className={`flight-card ${during ? "during" : "outside-shift"}`}
                      href={flightAwareRouteUrl(flight, prefs.homeAirport)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Find this flight route in FlightAware"
                      key={flight.id}
                    >
                      <div className="flight-time">
                        <strong>{display.time}</strong>
                      </div>
                      <div className={`route ${display.center ? "turnaround-route" : ""}`}>
                        <span><b>{display.left}</b></span>
                        <div className="route-line">
                          <i />
                          {display.center ? <b>{display.center}</b> : <Plane size={16} />}
                          <i />
                        </div>
                        <span>
                          <b>{display.right}</b>
                        </span>
                      </div>
                      <div className="route legacy-route">
                        <span><b>{flight.origin}</b><small>{flight.destination ? "Origin" : "Station"}</small></span>
                        <div className="route-line"><i /><Plane size={16} /><i /></div>
                        <span className={!flight.destination ? "muted-destination" : ""}>
                          <b>{flight.destination ?? "—"}</b>
                          <small>{flight.destination ? "Destination" : "Single time"}</small>
                        </span>
                      </div>
                      <div className="flight-status">
                        <span className="during-chip">{display.chip}</span>
                        {during && <span className="during-chip"><Clock3 size={13} /> In shift</span>}
                      </div>
                    </a>
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
      </section>
    </div>
    );
  };

  const renderSwapCandidate = (
    candidate: SwapCandidate,
    index: number,
    featured = false,
  ) => (
    <article
      className={`swap-candidate ${featured ? "featured" : ""}`}
      key={candidate.worker}
    >
      <span className={`person-avatar tone-${index % 4}`}>
        {initials(candidate.worker)}
      </span>
      <div className="swap-candidate-copy">
        <div>
          <b>{candidate.worker}</b>
          <span>{candidate.availability}</span>
        </div>
        <small>
          Usually {formatMinutes(candidate.averageStart)} –{" "}
          {formatMinutes(candidate.averageEnd)}
        </small>
        <small>
          Average of {candidate.sampleCount} shift
          {candidate.sampleCount === 1 ? "" : "s"}
        </small>
      </div>
      <div className="swap-score">
        <strong>{candidate.score}%</strong>
        <small>shift match</small>
      </div>
    </article>
  );

  const renderTimeOff = () => {
    const requestedHours = `${formatTime(timeOffDraft.start)} – ${formatTime(timeOffDraft.end)}`;
    const candidateCount =
      timeOffAnalysis.recommended.length + timeOffAnalysis.others.length;

    return (
      <div className="page-stack">
        <header className="page-title">
          <div>
            <h1>Time off</h1>
          </div>
        </header>

        <section className="panel time-off-picker">
          <div className="time-off-heading">
            <span className="time-off-icon">
              <WandSparkles />
            </span>
            <div>
              <h2>When do you want off?</h2>
              <p>Choose the hours you need covered.</p>
            </div>
          </div>
          <div className="time-off-fields">
            <label className="time-off-date">
              <span>Date</span>
              <div className="time-off-input-shell">
                <input
                  type="date"
                  value={timeOffDraft.date}
                  min={scheduleDates[0]}
                  max={scheduleDates[scheduleDates.length - 1]}
                  onChange={(event) => updateTimeOffDate(event.target.value)}
                />
                <span className="time-off-input-value" aria-hidden="true">
                  {formatFieldDate(timeOffDraft.date)}
                </span>
              </div>
            </label>
            <div className="time-off-range">
              <label>
                <span>Start</span>
                <div className="time-off-input-shell">
                  <input
                    type="time"
                    value={timeOffDraft.start}
                    onChange={(event) =>
                      setTimeOffDraft((current) => ({
                        ...current,
                        start: event.target.value,
                      }))
                    }
                  />
                  <span className="time-off-input-value" aria-hidden="true">
                    {formatFieldTime(timeOffDraft.start)}
                  </span>
                </div>
              </label>
              <i aria-hidden="true">–</i>
              <label>
                <span>Stop</span>
                <div className="time-off-input-shell">
                  <input
                    type="time"
                    value={timeOffDraft.end}
                    onChange={(event) =>
                      setTimeOffDraft((current) => ({
                        ...current,
                        end: event.target.value,
                      }))
                    }
                  />
                  <span className="time-off-input-value" aria-hidden="true">
                    {formatFieldTime(timeOffDraft.end)}
                  </span>
                </div>
              </label>
            </div>
          </div>
        </section>

        {!hasSchedule ? (
          <section className="panel">
            <EmptyState
              icon={<Upload />}
              title="Import a schedule first"
              copy="Once your schedule is loaded, Shiftdeck can check your hours and rank possible swaps."
            />
          </section>
        ) : !timeOffAnalysis.isLoaded ? (
          <section className="time-off-status unavailable">
            <CalendarDays />
            <div>
              <b>No schedule is loaded for this date</b>
              <p>Choose one of the dates from your imported schedule.</p>
            </div>
          </section>
        ) : !timeOffAnalysis.needsCoverage ? (
          <section className="time-off-status clear">
            <CheckCircle2 />
            <div>
              <b>Sweet — you’re already free.</b>
              <p>
                You aren’t scheduled during {requestedHours} on{" "}
                {formatDate(timeOffDraft.date, "long")}.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="time-off-status working">
              <Clock3 />
              <div>
                <b>You’re scheduled that day</b>
                <p>
                  Your shift is {formatTime(timeOffAnalysis.shift!.start)} –{" "}
                  {formatTime(timeOffAnalysis.shift!.end)}.
                </p>
              </div>
            </section>

            <section className="panel swap-panel">
              <div className="section-heading">
                <div>
                  <h2>Recommended</h2>
                  <p>Closest usual hours among coworkers who are free.</p>
                </div>
                <span className="count-badge">
                  {candidateCount} free
                </span>
              </div>

              {timeOffAnalysis.recommended.length ? (
                <div className="swap-list">
                  {timeOffAnalysis.recommended.map((candidate, index) =>
                    renderSwapCandidate(candidate, index, true),
                  )}
                </div>
              ) : (
                <div className="no-close-match">
                  No close shift matches are free that day.
                </div>
              )}

              {timeOffAnalysis.others.length > 0 && (
                <details className="other-swaps">
                  <summary>
                    <span>
                      Other available coworkers
                      <small>
                        Different usual hours
                      </small>
                    </span>
                    <ChevronDown />
                  </summary>
                  <div className="swap-list">
                    {timeOffAnalysis.others.map((candidate, index) =>
                      renderSwapCandidate(
                        candidate,
                        index + timeOffAnalysis.recommended.length,
                      ),
                    )}
                  </div>
                </details>
              )}

              {!candidateCount && (
                <EmptyState
                  icon={<UsersRound />}
                  title="No one is free"
                  copy="Everyone is either working or marked PTO on this date."
                />
              )}
              <p className="swap-method">
                Matches use each person’s average start and stop time across
                the uploaded schedule. PTO is never suggested.
              </p>
            </section>
          </>
        )}
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

      {scheduleDocuments.length > 0 && (
        <section className="upload-history">
          <div className="upload-history-heading">
            <h2>Uploaded schedules</h2>
            <span>{scheduleDocuments.length}</span>
          </div>
          <div className="upload-document-list">
            {scheduleDocuments.map((document) => {
              const isExpanded = expandedDocument === document.id;
              return (
                <article
                  className={`upload-document ${isExpanded ? "expanded" : ""}`}
                  key={document.id}
                >
                  <div className="upload-document-row">
                    <button
                      className="upload-document-main"
                      onClick={() => void toggleScheduleDocument(document)}
                      aria-expanded={isExpanded}
                    >
                      <span className="upload-document-icon"><FileImage /></span>
                      <span className="upload-document-copy">
                        <strong>{document.name}</strong>
                        <span>{formatDocumentRange(document.dates)}</span>
                        <small>Updated {formatUpdatedAt(document.updatedAt)}</small>
                      </span>
                      <span className="upload-document-tags">
                        {document.revision > 1 && <i>Updated</i>}
                        <i className="active">Active</i>
                      </span>
                      <ChevronDown className="upload-document-chevron" />
                    </button>
                    <button
                      className="upload-document-delete"
                      onClick={() => void removeScheduleDocument(document)}
                      aria-label={`Delete ${document.name}`}
                    >
                      <X />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="upload-document-preview">
                      {documentPreviews[document.id] ? (
                        <img
                          src={documentPreviews[document.id]}
                          alt={`Uploaded schedule ${document.name}`}
                        />
                      ) : (
                        <span>Loading photo…</span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {duplicateNotice && (
        <div className="notice warning">
          <AlertTriangle />
          <div><b>Already seen</b><p>{duplicateNotice}</p></div>
          <button onClick={() => setDuplicateNotice("")} aria-label="Dismiss"><X /></button>
        </div>
      )}

      {(importState === "review" || importState === "done" || importState === "error") && (
        <>
          <section className={`notice ${importState === "error" ? "warning" : "success"}`}>
            {importState === "error" ? <AlertTriangle /> : <Check />}
            <div>
              <b>
                {importState === "done"
                  ? "Calendar ready"
                  : importState === "error"
                    ? "Schedule not recognized"
                    : "Schedule found"}
              </b>
              <p>{importMessage}</p>
              {loadedFiles.length > 0 && <small>{loadedFiles.join(" · ")}</small>}
              {importState !== "error" && canExportCalendar ? (
                <button
                  className="button primary calendar-export-button"
                  onClick={() => setExportOpen(true)}
                >
                  <CalendarDays />
                  Export to Apple Calendar
                </button>
              ) : importState !== "error" ? (
                <small>Add a shift to enable calendar export.</small>
              ) : null}
            </div>
          </section>
        </>
      )}

    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={openTodayTab} aria-label="Shiftdeck home">
          <span><img src="./apple-touch-icon.png" alt="" /></span>
          <b>Shiftdeck</b>
        </button>
        <nav aria-label="Main navigation">
          <NavButton icon={<Home />} label="Today" active={tab === "home"} onClick={openTodayTab} />
          <NavButton icon={<UsersRound />} label="Workers" active={tab === "workers"} onClick={() => setTab("workers")} />
          <NavButton icon={<Plane />} label="Flights" active={tab === "flights"} onClick={() => setTab("flights")} />
          <NavButton icon={<CalendarDays />} label="Time off" active={tab === "timeoff"} onClick={openTimeOffTab} />
          <NavButton icon={<Upload />} label="Import" active={tab === "import"} onClick={() => setTab("import")} />
        </nav>
        <div className="sidebar-bottom">
          <button onClick={openAddShift}><Plus /><span>Add shift</span></button>
          <button onClick={() => setSettingsOpen(true)}><Settings /><span>Settings</span></button>
          <div className="profile-mini">
            <span>{initials(prefs.person)}</span>
            <div><b>{prefs.person}</b><small>Schedule owner</small></div>
          </div>
        </div>
      </aside>

      <main>
        <header className="mobile-header">
          <button className="brand" onClick={openTodayTab}><span><img src="./apple-touch-icon.png" alt="" /></span><b>Shiftdeck</b></button>
          <div>
            <button onClick={openAddShift} aria-label="Add a shift"><Plus /></button>
            <button onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings /></button>
          </div>
        </header>
        <div className="content-wrap">
          {tab === "home" && renderHome()}
          {tab === "workers" && renderWorkers()}
          {tab === "flights" && renderFlights()}
          {tab === "timeoff" && renderTimeOff()}
          {tab === "import" && renderImport()}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        <NavButton icon={<Home />} label="Today" active={tab === "home"} onClick={openTodayTab} />
        <NavButton icon={<UsersRound />} label="Workers" active={tab === "workers"} onClick={() => setTab("workers")} />
        <NavButton icon={<Plane />} label="Flights" active={tab === "flights"} onClick={() => setTab("flights")} />
        <NavButton icon={<CalendarDays />} label="Time off" active={tab === "timeoff"} onClick={openTimeOffTab} />
        <NavButton icon={<Upload />} label="Import" active={tab === "import"} onClick={() => setTab("import")} />
      </nav>

      {shiftEditor && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setShiftEditor(null)}>
          <section className="shift-sheet" role="dialog" aria-modal="true" aria-label={shiftEditor.mode === "edit" ? "Edit shift" : "Add shift"} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><h2>{shiftEditor.mode === "edit" ? "Edit shift" : "Add a shift"}</h2></div>
              <button onClick={() => setShiftEditor(null)} aria-label="Close shift editor"><X /></button>
            </header>
            <div className="shift-fields">
              <label>
                <span>Date</span>
                <div className="time-off-input-shell">
                  <input type="date" value={shiftDraft.date} onChange={(event) => setShiftDraft((current) => ({ ...current, date: event.target.value }))} />
                  <span className="time-off-input-value" aria-hidden="true">
                    {formatFieldDate(shiftDraft.date)}
                  </span>
                </div>
              </label>
              <div className="time-range-fields">
                <label>
                  <span>Start</span>
                  <div className="time-off-input-shell">
                    <input type="time" value={shiftDraft.start} onChange={(event) => setShiftDraft((current) => ({ ...current, start: event.target.value }))} />
                    <span className="time-off-input-value" aria-hidden="true">
                      {formatFieldTime(shiftDraft.start)}
                    </span>
                  </div>
                </label>
                <span className="time-range-separator" aria-hidden="true">-</span>
                <label>
                  <span>Stop</span>
                  <div className="time-off-input-shell">
                    <input type="time" value={shiftDraft.end} onChange={(event) => setShiftDraft((current) => ({ ...current, end: event.target.value }))} />
                    <span className="time-off-input-value" aria-hidden="true">
                      {formatFieldTime(shiftDraft.end)}
                    </span>
                  </div>
                </label>
              </div>
            </div>
            <div className="shift-actions">
              {shiftEditor.mode === "edit" && <button className="button danger subtle" onClick={deleteShift}><Trash2 /> Delete</button>}
              <button className="button primary" onClick={saveShift}><Check /> {shiftEditor.mode === "edit" ? "Save changes" : "Add shift"}</button>
            </div>
          </section>
        </div>
      )}

      {exportOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setExportOpen(false)}>
          <section className="export-sheet" role="dialog" aria-modal="true" aria-label="Export to Apple Calendar" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow neutral">Apple Calendar</span><h2>Export shifts</h2></div>
              <button onClick={() => setExportOpen(false)} aria-label="Close calendar export"><X /></button>
            </header>
            <div className="export-fields">
              <label>
                <span>Title</span>
                <input value={prefs.title} onChange={(event) => savePrefs({ title: event.target.value })} placeholder="Work" />
              </label>
              <label>
                <span>Place</span>
                <input value={prefs.location} onChange={(event) => savePrefs({ location: event.target.value })} placeholder="Optional" />
              </label>
              <div className="reminder-grid">
                <label>
                  <span>Reminder 1</span>
                  <select value={prefs.reminder1} onChange={(event) => savePrefs({ reminder1: event.target.value })}>
                    {REMINDER_OPTIONS.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown />
                </label>
                <label>
                  <span>Reminder 2</span>
                  <select value={prefs.reminder2} onChange={(event) => savePrefs({ reminder2: event.target.value })}>
                    {REMINDER_OPTIONS.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown />
                </label>
              </div>
            </div>
            <button className="button primary" onClick={exportCalendar}><CalendarDays /> Export to Apple Calendar</button>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>Settings</h2></div><button onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X /></button></header>
            <label>
              <span>Your name on the schedule</span>
              <select value={prefs.person} onChange={(event) => savePrefs({ person: event.target.value })}>
                {availableWorkers.map((worker) => <option key={worker}>{worker}</option>)}
              </select>
              <ChevronDown />
            </label>
            <div className="settings-grid">
              <SearchableSelect
                label="Home airport"
                value={prefs.homeAirport}
                options={airportOptions}
                placeholder="Search code or city"
                onSelect={(value) => savePrefs({ homeAirport: cleanAirportCode(value) })}
              />
              <SearchableSelect
                label="Airline"
                value={prefs.airline}
                options={airlineOptions}
                placeholder="Search airline or code"
                onSelect={(value) => savePrefs({ airline: value })}
              />
            </div>
            <div className="theme-setting">
              <span>Appearance</span>
              <div>
                <button className={theme === "light" ? "active" : ""} onClick={() => changeTheme("light")}><Sun /> Light</button>
                <button className={theme === "dark" ? "active" : ""} onClick={() => changeTheme("dark")}><Moon /> Dark</button>
              </div>
            </div>
            <div className="danger-zone">
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
            <p>This resets saved settings, upload history, and calendar revision history on this device. It will not remove anything already added to Apple Calendar.</p>
            <div>
              <button className="button soft" onClick={() => setClearConfirmOpen(false)}>Cancel</button>
              <button className="button danger" onClick={clearAllData}>Clear everything</button>
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

function SearchableSelect({
  label,
  value,
  options,
  placeholder,
  onSelect,
}: {
  label: string;
  value: string;
  options: AviationOption[];
  placeholder: string;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = options
    .filter((option) =>
      !normalizedQuery ||
      option.search.includes(normalizedQuery) ||
      option.value.toLowerCase().startsWith(normalizedQuery),
    )
    .slice(0, 8);
  const listId = `search-${label.toLowerCase().replace(/\s+/g, "-")}`;

  const choose = (option: AviationOption) => {
    onSelect(option.value);
    setQuery(option.value);
    setOpen(false);
  };

  return (
    <label className="searchable-select">
      <span>{label}</span>
      <div>
        <input
          value={query}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              setQuery(value);
            }, 120);
          }}
          placeholder={options.length ? placeholder : "Loading…"}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
        />
        <ChevronDown />
        {open && (
          <div className="searchable-options" id={listId} role="listbox">
            {matches.length ? (
              matches.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  key={`${option.value}-${option.label}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span>{option.label}</span>
                  {option.value === value && <Check />}
                </button>
              ))
            ) : (
              <span className="searchable-empty">No matches</span>
            )}
          </div>
        )}
      </div>
    </label>
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
