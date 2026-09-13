"use client";

import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileImage,
  FileText,
  Home,
  MapPin,
  Moon,
  Pencil,
  Plane,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Flight,
  Shift,
} from "./sample-data";
import { parseCharterPdf } from "./charter-parser";
import {
  canonicalSchedulePersonName,
  canonicalizeScheduleShifts,
  isPlausibleWorkerName,
  isSameSchedulePerson,
  isScheduleRevision,
  parseScheduleTsv,
  ParsedSchedule,
  resolveSchedulePersonName,
  SCHEDULE_PARSER_VERSION,
} from "./schedule-parser";
import {
  activeShiftSessionKey,
  activeWorkingShiftAt,
} from "./schedule-time";
import {
  clearScheduleImages,
  deleteScheduleImage,
  loadScheduleImage,
  saveScheduleImage,
} from "./upload-store";

type Tab =
  | "home"
  | "workers"
  | "flights"
  | "timeoff"
  | "import";

type ScheduleTab = Extract<Tab, "home" | "workers" | "flights">;

type CalendarEvent = {
  id: string;
  calendarKey: string;
  date: string;
  start: string;
  end: string;
  title: string;
  customTitle?: boolean;
};

type Preferences = {
  person: string;
  title: string;
  alerts: number[];
  location: string;
  locationLat: number | null;
  locationLon: number | null;
  notes: string;
  homeAirport: string;
  airline: string;
};

type NotificationProfile = {
  id: string;
  writeToken: string;
  createdAt: string;
  subscriptionId?: string;
  lastSyncedAt?: string;
};

type CalendarSubscription = {
  id: string;
  writeToken: string;
  feedUrl: string;
  createdAt: string;
  lastSyncedAt?: string;
};

type NotificationSyncPayload = {
  title: string;
  location: string;
  timezone: string;
  alerts: number[];
  events: Array<{
    key: string;
    date: string;
    start: string;
    end: string;
    startAt: string;
    title: string;
  }>;
};

type CalendarSyncPayload = {
  name: string;
  location: string;
  reminder1: string;
  events: Array<{
    key: string;
    date: string;
    start: string;
    end: string;
    title: string;
  }>;
};

type ShiftDraft = {
  date: string;
  start: string;
  end: string;
  title: string;
};

type TimeOffDraft = {
  date: string;
  start: string;
  end: string;
};

type PlaceSuggestion = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  latitude: number;
  longitude: number;
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
  parserVersion?: number;
  mimeType?: string;
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

const DEFAULT_SHIFT_TITLE = "Work";
const DEFAULT_ALERT_MINUTES = 120;
const DEFAULT_WORK_LOCATION = "3311 Airport Rd, Allentown, PA 18109";
const ACTIVE_SHIFT_PAGE_KEY = "shiftdeck.activeShiftPage";

type StoredActiveShiftPage = {
  shiftKey: string;
  tab: Tab;
};

const isTab = (value: unknown): value is Tab =>
  value === "home" ||
  value === "workers" ||
  value === "flights" ||
  value === "timeoff" ||
  value === "import";

const DEFAULT_PREFS: Preferences = {
  person: "David LaBarre",
  title: DEFAULT_SHIFT_TITLE,
  alerts: [DEFAULT_ALERT_MINUTES],
  location: DEFAULT_WORK_LOCATION,
  locationLat: null,
  locationLon: null,
  notes: "",
  homeAirport: "ABE",
  airline: "Allegiant",
};

const ALERT_UNIT_OPTIONS = [
  { value: 1, label: "minutes" },
  { value: 60, label: "hours" },
  { value: 1440, label: "days" },
] as const;

const alertUnitFor = (minutes: number) =>
  minutes > 0 && minutes % 1440 === 0
    ? 1440
    : minutes > 0 && minutes % 60 === 0
      ? 60
      : 1;

const alertAmountFor = (minutes: number) => minutes / alertUnitFor(minutes);

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

function parseCoordinatePair(value: string) {
  const match = value
    .trim()
    .toUpperCase()
    .replace(/[−–—]/g, "-")
    .match(
      /^([+-]?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/,
    );
  if (!match) return null;
  const latitudeDirection = match[2];
  const longitudeDirection = match[4];
  let latitude = Number(match[1]);
  let longitude = Number(match[3]);
  if (latitudeDirection) {
    latitude = Math.abs(latitude) * (latitudeDirection === "S" ? -1 : 1);
  }
  if (longitudeDirection) {
    longitude = Math.abs(longitude) * (longitudeDirection === "W" ? -1 : 1);
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

const formatAppleCoordinates = (latitude: number, longitude: number) =>
  `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? "S" : "N"}, ${Math.abs(longitude).toFixed(5)}° ${longitude < 0 ? "W" : "E"}`;

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

const isGroundSecurityCoordinator = (name: string) =>
  GSC_NAME_KEYS.has(personKey(name));

function PersonName({ name, label }: { name: string; label?: string }) {
  return (
    <span className="person-name-with-tag">
      <span>{label ?? name}</span>
      {isGroundSecurityCoordinator(name) && <span className="gsc-tag">GSC</span>}
    </span>
  );
}

const eventsFor = (shifts: Shift[], person: string) =>
  shifts
    .filter(
      (shift) =>
        isSameSchedulePerson(shift.worker, person) &&
        shift.status === "working",
    )
    .map((shift) => ({
      id: shift.id,
      calendarKey: calendarKeyFor(person, shift.date),
      date: shift.date,
      start: shift.start,
      end: shift.end,
      title: DEFAULT_SHIFT_TITLE,
      customTitle: false,
    }));

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const CALENDAR_SERVICE_ORIGIN =
  "https://shiftdeck-calendar.frenchbear1.workers.dev";
const FLIGHTAWARE_ORIGIN = "https://www.flightaware.com";

function isCurrentCalendarSubscription(
  subscription: CalendarSubscription | null,
) {
  if (!subscription) return false;
  try {
    return new URL(subscription.feedUrl).origin === CALENDAR_SERVICE_ORIGIN;
  } catch {
    return false;
  }
}

function calendarServiceUrl(path: string) {
  if (typeof window === "undefined") return `${CALENDAR_SERVICE_ORIGIN}${path}`;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return path;
  }
  return `${CALENDAR_SERVICE_ORIGIN}${path}`;
}

async function createCalendarFeed() {
  const response = await fetch(calendarServiceUrl("/api/calendar-feeds"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Calendar setup failed");
  return (await response.json()) as CalendarSubscription;
}

async function syncCalendarFeed(
  subscription: Pick<CalendarSubscription, "id" | "writeToken">,
  payload: CalendarSyncPayload,
) {
  const response = await fetch(
    calendarServiceUrl(`/api/calendar-feeds/${subscription.id}`),
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${subscription.writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const error = new Error("Calendar sync failed") as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as { syncedAt: string };
}

async function revokeCalendarFeed(subscription: CalendarSubscription) {
  await fetch(
    calendarServiceUrl(`/api/calendar-feeds/${subscription.id}`),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${subscription.writeToken}` },
    },
  );
}

function deviceName() {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/Android/i.test(agent)) return "Android phone";
  if (/Macintosh/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows PC";
  return "Shiftdeck device";
}

async function createNotificationProfile() {
  const response = await fetch(calendarServiceUrl("/api/notifications/profiles"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Notification setup failed");
  return (await response.json()) as NotificationProfile;
}

async function syncNotificationProfile(
  profile: Pick<NotificationProfile, "id" | "writeToken">,
  payload: NotificationSyncPayload,
) {
  const response = await fetch(
    calendarServiceUrl(`/api/notifications/profiles/${profile.id}`),
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${profile.writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const error = new Error("Notification sync failed") as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as { syncedAt: string };
}

async function registerPushSubscription(
  profile: Pick<NotificationProfile, "id" | "writeToken">,
  subscription: PushSubscription,
) {
  const response = await fetch(
    calendarServiceUrl(`/api/notifications/profiles/${profile.id}/subscriptions`),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...subscription.toJSON(),
        deviceName: deviceName(),
      }),
    },
  );
  if (!response.ok) throw new Error("Push registration failed");
  return (await response.json()) as { id: string; subscribedAt: string };
}

async function removePushSubscription(profile: NotificationProfile) {
  if (!profile.subscriptionId) return;
  await fetch(
    calendarServiceUrl(
      `/api/notifications/profiles/${profile.id}/subscriptions/${profile.subscriptionId}`,
    ),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${profile.writeToken}` },
    },
  );
}

async function revokeNotificationProfile(profile: NotificationProfile) {
  await fetch(calendarServiceUrl(`/api/notifications/profiles/${profile.id}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${profile.writeToken}` },
  });
}

async function requestTestNotification(profile: NotificationProfile) {
  const response = await fetch(
    calendarServiceUrl(`/api/notifications/profiles/${profile.id}/test`),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${profile.writeToken}` },
    },
  );
  if (!response.ok) throw new Error("Test notification failed");
}

function base64UrlToUint8Array(value: string) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function eventStartAt(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
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
  if (flight.source === "charter" && flight.trackingId) {
    return new URL(
      `/live/flight/${encodeURIComponent(flight.trackingId)}`,
      FLIGHTAWARE_ORIGIN,
    ).toString();
  }
  const home = cleanAirportCode(homeAirport);
  const origin =
    flight.kind === "departure"
      ? home
      : cleanAirportCode(flight.inboundAirport ?? flight.origin);
  const destination =
    flight.kind === "departure"
      ? cleanAirportCode(flight.outboundAirport ?? flight.destination ?? "")
      : home;
  const matchField = flight.kind === "departure" ? "departure" : "arrival";
  const expectedTime =
    matchField === "departure"
      ? flight.departure ?? flight.start
      : flight.arrival ?? flight.start;
  const resolver = new URL(calendarServiceUrl("/api/flights/resolve"));
  resolver.searchParams.set("origin", origin);
  resolver.searchParams.set("destination", destination);
  resolver.searchParams.set("date", flight.date);
  resolver.searchParams.set("time", expectedTime);
  resolver.searchParams.set("match", matchField);
  return resolver.toString();
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
};

function photonSuggestion(feature: PhotonFeature, index: number): PlaceSuggestion | null {
  const coordinates = feature.geometry?.coordinates;
  if (
    !coordinates ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) {
    return null;
  }
  const properties = feature.properties ?? {};
  const name = String(properties.name ?? "").trim();
  const street = String(properties.street ?? "").trim();
  const houseNumber = String(properties.housenumber ?? "").trim();
  const city = String(
    properties.city ?? properties.town ?? properties.village ?? "",
  ).trim();
  const state = String(properties.state ?? "").trim();
  const postcode = String(properties.postcode ?? "").trim();
  const country = String(properties.country ?? "").trim();
  const streetLine = [houseNumber, street].filter(Boolean).join(" ");
  const regionLine = [city, [state, postcode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const parts = [
    name && name !== street ? name : "",
    streetLine,
    regionLine,
    country,
  ].filter((part, partIndex, all) => part && all.indexOf(part) === partIndex);
  const label = parts.join(", ");
  if (!label) return null;
  const primary = name || streetLine || city || label;
  const secondary = parts
    .filter((part) => part !== primary)
    .join(", ");
  return {
    id: `${String(properties.osm_type ?? "place")}-${String(properties.osm_id ?? index)}`,
    label,
    primary,
    secondary,
    latitude: coordinates[1],
    longitude: coordinates[0],
  };
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [shiftEditor, setShiftEditor] = useState<{
    mode: "add" | "edit";
    eventId?: string;
  } | null>(null);
  const [shiftDraft, setShiftDraft] = useState<ShiftDraft>({
    date: "2026-07-26",
    start: "09:00",
    end: "17:00",
    title: "Work",
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
  const [notificationProfile, setNotificationProfile] =
    useState<NotificationProfile | null>(null);
  const [notificationSyncState, setNotificationSyncState] = useState<
    "idle" | "syncing" | "synced" | "error"
  >("idle");
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [calendarSubscription, setCalendarSubscription] =
    useState<CalendarSubscription | null>(null);
  const [calendarSyncState, setCalendarSyncState] = useState<
    "idle" | "syncing" | "synced" | "error"
  >("idle");
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placeLookupState, setPlaceLookupState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [placeMenuOpen, setPlaceMenuOpen] = useState(false);
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const [coordinateDraft, setCoordinateDraft] = useState("");
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [backgroundHydrated, setBackgroundHydrated] = useState(false);
  const [startupTabReady, setStartupTabReady] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const fileInput = useRef<HTMLInputElement>(null);
  const homeDateRail = useRef<HTMLDivElement>(null);
  const workersDateRail = useRef<HTMLDivElement>(null);
  const flightsDateRail = useRef<HTMLDivElement>(null);
  const pendingDateCenter = useRef<{ tab: ScheduleTab; date: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let backgroundTimer: number | undefined;
    queueMicrotask(() => {
      if (cancelled) return;
      const savedPrefs = localStorage.getItem("shiftdeck.preferences");
      const savedTheme = localStorage.getItem("shiftdeck.theme");
      const savedDates = localStorage.getItem("shiftdeck.activeDates");
      const savedParsedShifts = localStorage.getItem("shiftdeck.parsedShifts");
      const savedEvents = localStorage.getItem("shiftdeck.events");
      let parsedPrefs = DEFAULT_PREFS;
      let parsedDates: string[] = [];
      if (savedPrefs) {
        try {
          const saved = JSON.parse(savedPrefs) as Partial<Preferences>;
          parsedPrefs = {
            person: canonicalSchedulePersonName(
              saved.person ?? DEFAULT_PREFS.person,
            ),
            title:
              typeof saved.title === "string" && saved.title.trim()
                ? saved.title.trim()
                : DEFAULT_SHIFT_TITLE,
            alerts:
              Array.isArray(saved.alerts) &&
              saved.alerts.some(
                (minutes) =>
                  Number.isInteger(minutes) && minutes >= 0 && minutes <= 10080,
              )
                ? [
                    ...new Set(
                      saved.alerts.filter(
                        (minutes) =>
                          Number.isInteger(minutes) &&
                          minutes >= 0 &&
                          minutes <= 10080,
                      ),
                    ),
                  ].slice(0, 12)
                : DEFAULT_PREFS.alerts,
            location:
              typeof saved.location === "string" && saved.location.trim()
                ? saved.location
                : DEFAULT_WORK_LOCATION,
            locationLat:
              typeof saved.locationLat === "number" ? saved.locationLat : null,
            locationLon:
              typeof saved.locationLon === "number" ? saved.locationLon : null,
            notes: "",
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
      if (savedParsedShifts) {
        try {
          restoredShifts = canonicalizeScheduleShifts(
            (JSON.parse(savedParsedShifts) as Shift[]).filter(
              (shift) =>
                shift &&
                typeof shift.id === "string" &&
                typeof shift.date === "string" &&
                typeof shift.worker === "string" &&
                isPlausibleWorkerName(shift.worker),
            ),
          );
        } catch {
          localStorage.removeItem("shiftdeck.parsedShifts");
        }
      }
      setParsedShifts(restoredShifts);
      const fallbackEvents = eventsFor(
        restoredShifts,
        parsedPrefs.person,
      );
      if (savedEvents) {
        try {
          const parsedEvents = (JSON.parse(savedEvents) as CalendarEvent[])
            .filter(
              (event) =>
                event &&
                typeof event.id === "string" &&
                typeof event.date === "string" &&
                typeof event.start === "string" &&
                typeof event.end === "string",
            )
            .map((event) => ({
              ...event,
              calendarKey: calendarKeyFor(parsedPrefs.person, event.date),
              title: event.customTitle
                ? event.title.trim() || DEFAULT_SHIFT_TITLE
                : DEFAULT_SHIFT_TITLE,
              customTitle: Boolean(event.customTitle),
            }));
          setEvents(parsedEvents);
        } catch {
          localStorage.removeItem("shiftdeck.events");
          setEvents(fallbackEvents);
        }
      } else {
        setEvents(fallbackEvents);
      }
      if (savedTheme === "dark") setTheme("dark");
      setHydrated(true);
      backgroundTimer = window.setTimeout(() => {
        if (cancelled) return;
        const savedParsedFlights = localStorage.getItem(
          "shiftdeck.parsedFlights",
        );
        const savedDocuments = localStorage.getItem(
          "shiftdeck.scheduleDocuments",
        );
        const savedNotificationProfile = localStorage.getItem(
          "shiftdeck.notificationProfile",
        );
        const savedCalendarSubscription = localStorage.getItem(
          "shiftdeck.calendarSubscription",
        );

        if (savedParsedFlights) {
          try {
            const restoredFlights = (
              JSON.parse(savedParsedFlights) as Flight[]
            ).filter(
              (flight) =>
                flight &&
                typeof flight.id === "string" &&
                typeof flight.date === "string",
            );
            setParsedFlights(restoredFlights);
          } catch {
            localStorage.removeItem("shiftdeck.parsedFlights");
          }
        }

        if (savedDocuments) {
          try {
            const documents = (
              JSON.parse(savedDocuments) as ScheduleDocument[]
            )
              .filter(
                (document) =>
                  document &&
                  typeof document.id === "string" &&
                  typeof document.hash === "string" &&
                  Array.isArray(document.dates) &&
                  Array.isArray(document.shifts) &&
                  Array.isArray(document.flights),
              )
              .map((document) => ({
                ...document,
                shifts: canonicalizeScheduleShifts(document.shifts),
              }));
            setScheduleDocuments(documents);
          } catch {
            localStorage.removeItem("shiftdeck.scheduleDocuments");
          }
        }

        if (savedNotificationProfile) {
          try {
            const profile = JSON.parse(
              savedNotificationProfile,
            ) as NotificationProfile;
            if (
              profile &&
              typeof profile.id === "string" &&
              typeof profile.writeToken === "string"
            ) {
              setNotificationProfile(profile);
            }
          } catch {
            localStorage.removeItem("shiftdeck.notificationProfile");
          }
        }
        if (savedCalendarSubscription) {
          try {
            const subscription = JSON.parse(
              savedCalendarSubscription,
            ) as CalendarSubscription;
            if (
              subscription &&
              typeof subscription.id === "string" &&
              typeof subscription.writeToken === "string" &&
              typeof subscription.feedUrl === "string" &&
              isCurrentCalendarSubscription(subscription)
            ) {
              setCalendarSubscription(subscription);
            } else {
              localStorage.removeItem("shiftdeck.calendarSubscription");
            }
          } catch {
            localStorage.removeItem("shiftdeck.calendarSubscription");
          }
        }
        if (!("Notification" in window) || !("serviceWorker" in navigator)) {
          setNotificationPermission("unsupported");
        } else {
          setNotificationPermission(Notification.permission);
        }
        setBackgroundHydrated(true);
      }, 0);
    });
    return () => {
      cancelled = true;
      if (backgroundTimer !== undefined) {
        window.clearTimeout(backgroundTimer);
      }
    };
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
    const query = prefs.location.trim();
    if (!notificationsOpen || !placeMenuOpen || query.length < 3) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setPlaceLookupState("loading");
      void fetch(
        calendarServiceUrl(`/api/places?q=${encodeURIComponent(query)}`),
        { signal: controller.signal },
      )
        .then((response) => {
          if (!response.ok) throw new Error("Place lookup failed");
          return response.json() as Promise<{ features?: PhotonFeature[] }>;
        })
        .then((result) => {
          const seen = new Set<string>();
          const suggestions = (result.features ?? [])
            .map(photonSuggestion)
            .filter(
              (suggestion): suggestion is PlaceSuggestion => Boolean(suggestion),
            )
            .filter((suggestion) => {
              const key = `${suggestion.label.toLowerCase()}-${suggestion.latitude.toFixed(5)}-${suggestion.longitude.toFixed(5)}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          setPlaceSuggestions(suggestions);
          setPlaceLookupState("idle");
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === "AbortError") return;
          setPlaceSuggestions([]);
          setPlaceLookupState("error");
        });
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [notificationsOpen, placeMenuOpen, prefs.location]);

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
    if (!backgroundHydrated) return;
    localStorage.setItem("shiftdeck.parsedFlights", JSON.stringify(parsedFlights));
  }, [backgroundHydrated, parsedFlights]);

  useEffect(() => {
    if (!backgroundHydrated) return;
    localStorage.setItem(
      "shiftdeck.scheduleDocuments",
      JSON.stringify(scheduleDocuments),
    );
  }, [backgroundHydrated, scheduleDocuments]);

  useEffect(() => {
    if (!backgroundHydrated) return;
    if (notificationProfile) {
      localStorage.setItem(
        "shiftdeck.notificationProfile",
        JSON.stringify(notificationProfile),
      );
    } else {
      localStorage.removeItem("shiftdeck.notificationProfile");
    }
  }, [backgroundHydrated, notificationProfile]);

  useEffect(() => {
    if (!backgroundHydrated) return;
    if (calendarSubscription) {
      localStorage.setItem(
        "shiftdeck.calendarSubscription",
        JSON.stringify(calendarSubscription),
      );
    } else {
      localStorage.removeItem("shiftdeck.calendarSubscription");
    }
  }, [backgroundHydrated, calendarSubscription]);

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

  const activeShift = useMemo(
    () => activeWorkingShiftAt(importedShifts, prefs.person, clockNow),
    [clockNow, importedShifts, prefs.person],
  );

  useEffect(() => {
    if (!hydrated || startupTabReady) return;
    let cancelled = false;
    let restoredTab: Tab = "home";
    if (!activeShift) {
      localStorage.removeItem(ACTIVE_SHIFT_PAGE_KEY);
    } else {
      const shiftKey = activeShiftSessionKey(activeShift);
      const savedPage = localStorage.getItem(ACTIVE_SHIFT_PAGE_KEY);
      if (savedPage) {
        try {
          const saved = JSON.parse(savedPage) as Partial<StoredActiveShiftPage>;
          if (saved.shiftKey === shiftKey && isTab(saved.tab)) {
            restoredTab = saved.tab;
          } else {
            localStorage.removeItem(ACTIVE_SHIFT_PAGE_KEY);
          }
        } catch {
          localStorage.removeItem(ACTIVE_SHIFT_PAGE_KEY);
        }
      }
    }
    queueMicrotask(() => {
      if (cancelled) return;
      setTab(restoredTab);
      setStartupTabReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [activeShift, hydrated, startupTabReady]);

  useEffect(() => {
    if (!hydrated || !startupTabReady || !activeShift) return;
    localStorage.setItem(
      ACTIVE_SHIFT_PAGE_KEY,
      JSON.stringify({
        shiftKey: activeShiftSessionKey(activeShift),
        tab,
      } satisfies StoredActiveShiftPage),
    );
  }, [activeShift, hydrated, startupTabReady, tab]);

  const todayDate = useMemo(
    () => workdayDateKey(clockNow, importedShifts, prefs.person),
    [clockNow, importedShifts, prefs.person],
  );

  const centerDateInRail = useCallback(
    (rail: HTMLDivElement | null, date: string, behavior: ScrollBehavior) => {
      const dateCard = rail?.querySelector<HTMLElement>(
        `[data-schedule-date="${date}"]`,
      );

      if (!rail || !dateCard) return;

      const centeredLeft =
        dateCard.offsetLeft - (rail.clientWidth - dateCard.offsetWidth) / 2;
      rail.scrollTo({
        left: Math.max(0, centeredLeft),
        behavior,
      });
    },
    [],
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

  useLayoutEffect(() => {
    if (
      !hydrated ||
      !scheduleDates.includes(selectedDate)
    ) {
      return;
    }

    const activeTab: ScheduleTab | null =
      tab === "home" || tab === "workers" || tab === "flights" ? tab : null;
    if (!activeTab) return;

    const rail =
      activeTab === "home"
        ? homeDateRail.current
        : activeTab === "workers"
          ? workersDateRail.current
          : flightsDateRail.current;
    if (!rail) return;

    const centerRequest = pendingDateCenter.current;
    const shouldAnimate =
      centerRequest?.tab === activeTab && centerRequest.date === selectedDate;

    if (!shouldAnimate) {
      if (centerRequest?.tab !== activeTab) pendingDateCenter.current = null;
      centerDateInRail(rail, selectedDate, "auto");
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      centerDateInRail(rail, selectedDate, "smooth");
      if (pendingDateCenter.current === centerRequest) {
        pendingDateCenter.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [centerDateInRail, hydrated, scheduleDates, selectedDate, tab]);

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

  const notificationSyncPayload = useMemo<NotificationSyncPayload>(
    () => ({
      title: prefs.title.trim() || DEFAULT_SHIFT_TITLE,
      location: prefs.location.trim(),
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      alerts: prefs.alerts,
      events: events
        .map((event) => ({
          key: event.calendarKey,
          date: event.date,
          start: event.start,
          end: event.end,
          startAt: eventStartAt(event.date, event.start),
          title: event.customTitle
            ? event.title.trim() || DEFAULT_SHIFT_TITLE
            : prefs.title.trim() || DEFAULT_SHIFT_TITLE,
        }))
        .sort((first, second) =>
          `${first.date}-${first.start}-${first.key}`.localeCompare(
            `${second.date}-${second.start}-${second.key}`,
          ),
        ),
    }),
    [
      events,
      prefs.alerts,
      prefs.location,
      prefs.title,
    ],
  );
  const canEnableNotifications = events.length > 0;
  const notificationProfileId = notificationProfile?.id;
  const notificationProfileWriteToken = notificationProfile?.writeToken;

  useEffect(() => {
    if (
      !hydrated ||
      !notificationProfileId ||
      !notificationProfileWriteToken
    ) {
      return;
    }
    const profile = {
      id: notificationProfileId,
      writeToken: notificationProfileWriteToken,
    };
    const timeout = window.setTimeout(() => {
      setNotificationSyncState("syncing");
      void syncNotificationProfile(profile, notificationSyncPayload)
        .then(({ syncedAt }) => {
          setNotificationProfile((current) =>
            current?.id === profile.id
              ? { ...current, lastSyncedAt: syncedAt }
              : current,
          );
          setNotificationSyncState("synced");
        })
        .catch(() => setNotificationSyncState("error"));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [
    notificationProfileId,
    notificationProfileWriteToken,
    notificationSyncPayload,
    hydrated,
  ]);

  const calendarSyncPayload = useMemo<CalendarSyncPayload>(
    () => ({
      name: "Shiftdeck",
      location: prefs.location.trim() || DEFAULT_WORK_LOCATION,
      reminder1: "",
      events: events
        .map((event) => ({
          key: event.calendarKey,
          date: event.date,
          start: event.start,
          end: event.end,
          title: event.customTitle
            ? event.title.trim() || DEFAULT_SHIFT_TITLE
            : prefs.title.trim() || DEFAULT_SHIFT_TITLE,
        }))
        .sort((first, second) =>
          `${first.date}-${first.start}-${first.key}`.localeCompare(
            `${second.date}-${second.start}-${second.key}`,
          ),
        ),
    }),
    [events, prefs.location, prefs.title],
  );
  const calendarSubscriptionId = calendarSubscription?.id;
  const calendarSubscriptionWriteToken = calendarSubscription?.writeToken;

  useEffect(() => {
    if (
      !hydrated ||
      !calendarSubscriptionId ||
      !calendarSubscriptionWriteToken
    ) {
      return;
    }
    const subscription = {
      id: calendarSubscriptionId,
      writeToken: calendarSubscriptionWriteToken,
    };
    const timeout = window.setTimeout(() => {
      setCalendarSyncState("syncing");
      void syncCalendarFeed(subscription, calendarSyncPayload)
        .then(({ syncedAt }) => {
          setCalendarSubscription((current) =>
            current?.id === subscription.id
              ? { ...current, lastSyncedAt: syncedAt }
              : current,
          );
          setCalendarSyncState("synced");
        })
        .catch(() => setCalendarSyncState("error"));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [
    calendarSubscriptionId,
    calendarSubscriptionWriteToken,
    calendarSyncPayload,
    hydrated,
  ]);

  const selectDate = (date: string) => {
    if (tab === "home" || tab === "workers" || tab === "flights") {
      pendingDateCenter.current = { tab, date };
    }
    setSelectedDate(date);
    setShowAllFlights(false);
  };

  const openTodayTab = () => {
    pendingDateCenter.current = null;
    setSelectedDate(todayDate);
    setShowAllFlights(false);
    setTab("home");
  };

  const returnToToday = () => {
    selectDate(todayDate);
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
      setEvents(eventsFor(importedShifts, next.person));
      setShowAllFlights(false);
    }
  };

  const updateNotificationAlert = (
    index: number,
    amount: number,
    unit: number,
  ) => {
    const minutes = Math.max(0, Math.min(10080, Math.round(amount * unit)));
    savePrefs({
      alerts: prefs.alerts.map((current, alertIndex) =>
        alertIndex === index ? minutes : current,
      ),
    });
  };

  const addNotificationAlert = () => {
    if (prefs.alerts.length >= 12) {
      setToast("You can add up to 12 alerts per shift");
      return;
    }
    const next = [30, 60, 120, 1440, 15, 0].find(
      (minutes) => !prefs.alerts.includes(minutes),
    );
    savePrefs({ alerts: [...prefs.alerts, next ?? 30] });
  };

  const removeNotificationAlert = (index: number) => {
    if (prefs.alerts.length === 1) return;
    savePrefs({
      alerts: prefs.alerts.filter((_, alertIndex) => alertIndex !== index),
    });
  };

  const updateCoordinateDraft = (value: string) => {
    setCoordinateDraft(value);
    const coordinate = parseCoordinatePair(value);
    savePrefs({
      location:
        coordinate && !prefs.location.trim() ? "Pinned location" : prefs.location,
      locationLat: coordinate?.latitude ?? null,
      locationLon: coordinate?.longitude ?? null,
    });
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
      title: DEFAULT_SHIFT_TITLE,
    });
    setShiftEditor({ mode: "add" });
  };

  const openEditShift = () => {
    if (!myEvent) return;
    setShiftDraft({
      date: myEvent.date,
      start: myEvent.start,
      end: myEvent.end,
      title: myEvent.customTitle
        ? myEvent.title
        : DEFAULT_SHIFT_TITLE,
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

  const enhanceScheduleImage = async (file: File) => {
    if (!("createImageBitmap" in window)) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.max(1, Math.min(2.2, 2200 / bitmap.width));
      if (scale < 1.15) {
        bitmap.close();
        return file;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close();
        return file;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const gray = Math.round(
          pixels.data[offset] * 0.299 +
            pixels.data[offset + 1] * 0.587 +
            pixels.data[offset + 2] * 0.114,
        );
        const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.3 + 128));
        pixels.data[offset] = contrasted;
        pixels.data[offset + 1] = contrasted;
        pixels.data[offset + 2] = contrasted;
      }
      context.putImageData(pixels, 0, 0);
      return await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob ?? file), "image/png"),
      );
    } catch {
      return file;
    }
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
          isSameSchedulePerson(shift.worker, prefs.person) &&
          shift.status === "working" &&
          detectedDates.includes(shift.date),
      )
      .map((shift) => ({
        id: shift.id,
        calendarKey: calendarKeyFor(prefs.person, shift.date),
        date: shift.date,
        start: shift.start,
        end: shift.end,
        title: DEFAULT_SHIFT_TITLE,
        customTitle: false,
      }));
    if (matching.length) {
      setEvents((current) => {
        const untouched = current.filter(
          (event) => !detectedDates.includes(event.date),
        );
        const refreshed = matching.map((event) => {
          const previous = current.find(
            (candidate) => candidate.calendarKey === event.calendarKey,
          );
          return previous?.customTitle
            ? {
                ...event,
                title: previous.title,
                customTitle: true,
              }
            : event;
        });
        return [...untouched, ...refreshed].sort((a, b) =>
          `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
        );
      });
    }
    if (detectedDates.length) selectDate(detectedDates[0]);
    setParsedShifts(nextParsedShifts);
    setParsedFlights(nextParsedFlights);
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

    const parsedSchedules: ParsedSchedule[] = [];
    let nextDocuments = [...scheduleDocuments];
    let updatedDocuments = 0;

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setImportMessage(`Checking ${file.name}`);
        const hash = await hashFile(file);

        let parsed: ParsedSchedule | null = null;
        const isPdf =
          file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (isPdf) {
          setImportMessage(`Reading charter flights in ${file.name}`);
          const fileBase = index / files.length;
          setImportProgress(Math.round((fileBase + 0.75 / files.length) * 88));
          parsed = await parseCharterPdf(file);
        } else {
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
          try {
            const enhanced = await enhanceScheduleImage(file);
            const attempts = [
              { image: file as Blob, mode: PSM.SPARSE_TEXT },
              { image: enhanced, mode: PSM.SPARSE_TEXT },
              { image: enhanced, mode: PSM.AUTO },
              { image: enhanced, mode: PSM.SINGLE_BLOCK },
            ];
            for (
              let attempt = 0;
              attempt < attempts.length && !parsed;
              attempt += 1
            ) {
              if (attempt > 0) {
                setImportMessage(`Trying a clearer read of ${file.name}`);
              }
              await worker.setParameters({
                tessedit_pageseg_mode: attempts[attempt].mode,
                preserve_interword_spaces: "1",
              });
              const result = await worker.recognize(
                attempts[attempt].image,
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
        }
        if (!parsed) continue;
        const knownNames = [
          prefs.person,
          ...parsedShifts.map((shift) => shift.worker),
          ...scheduleDocuments.flatMap((document) =>
            document.shifts.map((shift) => shift.worker),
          ),
        ];
        parsed = {
          ...parsed,
          shifts: canonicalizeScheduleShifts(
            parsed.shifts.map((shift) => {
              const worker = resolveSchedulePersonName(shift.worker, knownNames);
              return {
                ...shift,
                id: `${shift.date}-${worker}-${
                  shift.status === "working" ? shift.start : shift.status
                }`,
                worker,
              };
            }),
          ),
        };
        parsedSchedules.push(parsed);

        const replacementIndex = nextDocuments.findIndex((document) =>
          isScheduleRevision(document.dates, parsed.dates),
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
          parserVersion: SCHEDULE_PARSER_VERSION,
          mimeType: isPdf ? "application/pdf" : file.type,
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
        setImportMessage(
          "I couldn’t find a supported employee schedule or charter flight table. Make sure the complete schedule is visible.",
        );
        setImportProgress(100);
        setImportState("error");
        setToast("Schedule format not recognized");
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
      const charterFlightCount = parsedSchedules
        .flatMap((schedule) => schedule.flights)
        .filter((flight) => flight.source === "charter").length;
      const warnings = Array.from(
        new Set(parsedSchedules.flatMap((schedule) => schedule.warnings)),
      );
      localStorage.setItem(
        "shiftdeck.importHashes",
        JSON.stringify(nextDocuments.map((document) => document.hash)),
      );
      setImportProgress(100);
      setImportMessage(
        `${updatedDocuments ? "Updated schedule replaced. " : ""}${
          parsedShiftCount
            ? `${count} of your shifts found, plus ${Math.max(0, parsedShiftCount - count)} coworker shifts and ${parsedFlightCount} flights.`
            : `${charterFlightCount || parsedFlightCount} charter flights found.`
        }${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      );
      setImportState("review");
      setToast("Schedule imported");
    } catch {
      setImportState("error");
      setImportProgress(100);
      setImportMessage(
        "I couldn’t confidently read that file. Try a clearer image or the original charter PDF.",
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
    if (
      !shiftDraft.date ||
      !shiftDraft.start ||
      !shiftDraft.end ||
      !shiftDraft.title.trim()
    ) {
      setToast("Add a title, date, start time, and stop time");
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
      title: shiftDraft.title.trim(),
      customTitle: true,
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
    setImportState("review");
    setImportMessage("Your shift was removed.");
    setShiftEditor(null);
    setToast("Shift deleted");
  };

  const clearAllData = () => {
    const profileToRevoke = notificationProfile;
    const calendarToRevoke = calendarSubscription;
    [
      "shiftdeck.preferences",
      "shiftdeck.theme",
      "shiftdeck.importHashes",
      "shiftdeck.exportedEvents",
      "shiftdeck.calendarFeed",
      "shiftdeck.calendarHistory",
      "shiftdeck.calendarSubscription",
      "shiftdeck.notificationProfile",
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
    setNotificationProfile(null);
    setNotificationSyncState("idle");
    setCalendarSubscription(null);
    setCalendarSyncState("idle");
    setCoordinatesOpen(false);
    setCoordinateDraft("");
    setClearConfirmOpen(false);
    setSettingsOpen(false);
    setNotificationsOpen(false);
    setShiftEditor(null);
    if (profileToRevoke) {
      void (async () => {
        await removePushSubscription(profileToRevoke).catch(() => undefined);
        const registration = await navigator.serviceWorker?.ready.catch(
          () => undefined,
        );
        const subscription = await registration?.pushManager
          .getSubscription()
          .catch(() => null);
        await subscription?.unsubscribe().catch(() => undefined);
        await revokeNotificationProfile(profileToRevoke).catch(() => undefined);
      })();
    }
    if (calendarToRevoke) {
      void revokeCalendarFeed(calendarToRevoke).catch(() => undefined);
    }
    setToast("All Shiftdeck data cleared from this device");
  };

  const hasStructuredCalendarPlace =
    Boolean(prefs.location.trim()) &&
    Number.isFinite(prefs.locationLat) &&
    Number.isFinite(prefs.locationLon);

  const enableNotifications = async () => {
    if (!events.length) {
      setToast("Add a shift before turning on notifications");
      return;
    }
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setNotificationPermission("unsupported");
      setToast("Push notifications aren’t supported on this device");
      return;
    }
    const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    if (isAppleMobile && !isStandalone) {
      setToast("Add Shiftdeck to your Home Screen, then open it from the icon");
      return;
    }
    setNotificationSyncState("syncing");
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setNotificationSyncState("idle");
        setToast("Notifications weren’t allowed. You can enable them in Settings.");
        return;
      }
      const keyResponse = await fetch(
        calendarServiceUrl("/api/notifications/vapid-key"),
      );
      if (!keyResponse.ok) throw new Error("Notification key unavailable");
      const { publicKey } = (await keyResponse.json()) as { publicKey: string };
      const registration = await navigator.serviceWorker.ready;
      let pushSubscription = await registration.pushManager.getSubscription();
      if (!pushSubscription) {
        pushSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        });
      }
      let profile = notificationProfile ?? (await createNotificationProfile());
      let syncedAt: string;
      try {
        ({ syncedAt } = await syncNotificationProfile(
          profile,
          notificationSyncPayload,
        ));
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status !== 404 && status !== 410) throw error;
        profile = await createNotificationProfile();
        ({ syncedAt } = await syncNotificationProfile(
          profile,
          notificationSyncPayload,
        ));
      }
      const registered = await registerPushSubscription(
        profile,
        pushSubscription,
      );
      const syncedProfile = {
        ...profile,
        subscriptionId: registered.id,
        lastSyncedAt: syncedAt,
      };
      setNotificationProfile(syncedProfile);
      localStorage.setItem(
        "shiftdeck.notificationProfile",
        JSON.stringify(syncedProfile),
      );
      setNotificationSyncState("synced");
      setImportState("done");
      setToast("Notifications are on — sending a test now");
      void requestTestNotification(syncedProfile).catch(() =>
        setToast("Notifications are on. Use Send test to check this device."),
      );
    } catch {
      setNotificationSyncState("error");
      setToast("Notifications couldn’t connect. Try again.");
    }
  };

  const saveNotificationSettings = async () => {
    if (!notificationProfile || notificationPermission !== "granted") {
      await enableNotifications();
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const activeSubscription = await registration.pushManager.getSubscription();
    if (!activeSubscription || !notificationProfile.subscriptionId) {
      await enableNotifications();
      return;
    }
    if (!events.length) {
      setToast("Add a shift before saving notification settings");
      return;
    }
    setNotificationSyncState("syncing");
    try {
      const { syncedAt } = await syncNotificationProfile(
        notificationProfile,
        notificationSyncPayload,
      );
      setNotificationProfile((current) =>
        current ? { ...current, lastSyncedAt: syncedAt } : current,
      );
      setNotificationSyncState("synced");
      setNotificationsOpen(false);
      setToast("Notification settings saved");
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 404 || status === 410) {
        setNotificationProfile(null);
        setNotificationSyncState("idle");
        setToast("Notification connection expired — turn it on again");
        return;
      }
      setNotificationSyncState("error");
      setToast("Notification settings couldn’t be saved. Try again.");
    }
  };

  const disconnectNotifications = async () => {
    if (!notificationProfile) return;
    const confirmed = window.confirm(
      "Turn off Shiftdeck notifications on this device?",
    );
    if (!confirmed) return;
    const profile = notificationProfile;
    setNotificationSyncState("syncing");
    try {
      await removePushSubscription(profile);
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await subscription?.unsubscribe();
      await revokeNotificationProfile(profile);
      setNotificationProfile(null);
      setNotificationSyncState("idle");
      setToast("Notifications turned off on this device");
    } catch {
      setNotificationSyncState("error");
      setToast("Notifications couldn’t be turned off. Try again.");
    }
  };

  const sendTestNotification = async () => {
    if (!notificationProfile) {
      await enableNotifications();
      return;
    }
    setNotificationSyncState("syncing");
    try {
      await requestTestNotification(notificationProfile);
      setNotificationSyncState("synced");
      setToast("Test notification sent");
    } catch {
      setNotificationSyncState("error");
      setToast("The test couldn’t be delivered. Reconnect notifications.");
    }
  };

  const subscribeToCalendar = async () => {
    if (!events.length) {
      setToast("Add a shift before connecting Apple Calendar");
      return;
    }
    setCalendarSyncState("syncing");
    try {
      let subscription = isCurrentCalendarSubscription(calendarSubscription)
        ? calendarSubscription!
        : await createCalendarFeed();
      let syncedAt: string;
      try {
        ({ syncedAt } = await syncCalendarFeed(
          subscription,
          calendarSyncPayload,
        ));
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status !== 404 && status !== 410) throw error;
        subscription = await createCalendarFeed();
        ({ syncedAt } = await syncCalendarFeed(
          subscription,
          calendarSyncPayload,
        ));
      }
      const syncedSubscription = {
        ...subscription,
        lastSyncedAt: syncedAt,
      };
      setCalendarSubscription(syncedSubscription);
      localStorage.setItem(
        "shiftdeck.calendarSubscription",
        JSON.stringify(syncedSubscription),
      );
      setCalendarSyncState("synced");
      setSettingsOpen(false);
      setToast("Opening Shiftdeck in Apple Calendar");
      window.location.href = syncedSubscription.feedUrl.replace(
        /^https:/i,
        "webcal:",
      );
    } catch {
      setCalendarSyncState("error");
      setToast("Apple Calendar couldn’t connect. Try again.");
    }
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
      .filter(
        (shift) =>
          shift.worker === prefs.person || shiftsOverlap(myShift, shift),
      )
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

  const renderDateRail = (
    compact = false,
    mobileTape = false,
    rail: "home" | "workers" | "flights" = "home",
  ) => (
    <div
      className={`date-rail ${compact ? "compact" : ""} ${mobileTape ? "mobile-tape" : ""}`}
      ref={
        rail === "home"
          ? homeDateRail
          : rail === "workers"
            ? workersDateRail
            : flightsDateRail
      }
    >
      {scheduleDates.map((date) => {
        const day = compactDay(date);
        const userShift = getWorkingShift(importedShifts, date, prefs.person);
        return (
          <button
            className={`date-pill ${selectedDate === date ? "active" : ""}`}
            key={date}
            onClick={() => selectDate(date)}
            aria-label={`Show ${formatDate(date, "long")}`}
            data-schedule-date={date}
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
    const shiftTitle = myEvent
      ? myEvent.customTitle
        ? myEvent.title.trim() || DEFAULT_SHIFT_TITLE
        : DEFAULT_SHIFT_TITLE
      : DEFAULT_SHIFT_TITLE;
    const heroTitle = myEvent
      ? `${formatTime(myEvent.start)} – ${formatTime(myEvent.end)}`
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
          <div className="hero-shift-label">
            {myEvent ? shiftTitle : formatDate(selectedDate, "long")}
          </div>
        </div>
        {myEvent && (
          <button className="hero-edit" onClick={openEditShift} aria-label="Edit this shift">
            <Pencil />
          </button>
        )}
        <h1
          className={myEvent ? "hero-time-range" : undefined}
        >
          {heroTitle}
        </h1>
        <p>
          {myEvent
            ? formatDate(selectedDate, "long")
            : isLoadedDate
              ? "No shift scheduled"
              : "Import a schedule to get started"}
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
          <div className="schedule-heading-actions">
            {selectedDate !== todayDate && scheduleDates.includes(todayDate) && (
              <button
                type="button"
                className="today-text-button"
                onClick={returnToToday}
              >
                Today
              </button>
            )}
            <span className="count-badge">
              {scheduleDates.length} day{scheduleDates.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {hasSchedule ? (
          <>
            {renderDateRail(false, true, "home")}
          </>
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
                  <b><PersonName name={shift.worker} /></b>
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
        <div className="page-title-actions">
          {selectedDate !== todayDate && (
            <button
              type="button"
              className="today-text-button"
              onClick={returnToToday}
            >
              Today
            </button>
          )}
          <div className="date-stepper desktop-date-stepper">
            <button onClick={() => jumpDate(-1)} aria-label="Previous day"><ChevronLeft /></button>
            <span>{formatDate(selectedDate)}</span>
            <button onClick={() => jumpDate(1)} aria-label="Next day"><ChevronRight /></button>
          </div>
        </div>
      </header>
      {renderDateRail(false, true, "workers")}
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
            <div className="timeline-plot">
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
                          <PersonName
                            name={shift.worker}
                            label={shift.worker === prefs.person ? "You" : shift.worker}
                          />
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
          </div>
          <div className="mobile-crew-list">
            {timeline.groups.map((group) => (
              <article className={`mobile-shift-card relation-${group.relation}`} key={group.key}>
                <div className="mobile-shift-top">
                  <span className="mobile-group-avatar">
                    {group.shifts.length > 1 ? group.shifts.length : initials(group.shifts[0].worker)}
                  </span>
                  <div>
                    <b className="mobile-worker-names">
                      {group.shifts.map((shift, index) => (
                        <span key={shift.id}>
                          {index > 0 && ", "}
                          <PersonName
                            name={shift.worker}
                            label={
                              shift.worker === prefs.person
                                ? "You"
                                : shift.worker.split(" ")[0]
                            }
                          />
                        </span>
                      ))}
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
                  <b>
                    <PersonName
                      name={shift.worker}
                      label={
                        shift.worker === prefs.person
                          ? `${shift.worker} · You`
                          : shift.worker
                      }
                    />
                  </b>
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
          <div className="page-title-actions">
            {selectedDate !== todayDate && (
              <button
                type="button"
                className="today-text-button"
                onClick={returnToToday}
              >
                Today
              </button>
            )}
            <div className="date-stepper desktop-date-stepper">
              <button onClick={() => jumpDate(-1)} aria-label="Previous day"><ChevronLeft /></button>
              <span>{formatDate(selectedDate)}</span>
              <button onClick={() => jumpDate(1)} aria-label="Next day"><ChevronRight /></button>
            </div>
          </div>
        </header>
        {renderDateRail(false, true, "flights")}
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
                      target="_self"
                      aria-label="Open this exact flight in FlightAware"
                      key={flight.id}
                    >
                      <div className="flight-time">
                        <strong>{display.time}</strong>
                        {flight.trackingId && (
                          <span>
                            {[flight.operator, flight.trackingId]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
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
                        {flight.source === "charter" && (
                          <span className="source-chip">Charter</span>
                        )}
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
          <b><PersonName name={candidate.worker} /></b>
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
          accept="image/*,application/pdf,.pdf"
          multiple
          onChange={onFiles}
          aria-label="Upload schedule files"
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
            <h2>Drop schedule files here</h2>
            <p>or choose files from your device</p>
            <span className="button primary">Choose files</span>
            <small>PDF, JPG, PNG or HEIC · Multiple files are okay</small>
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
                      <span className="upload-document-icon">
                        {document.mimeType === "application/pdf" ? (
                          <FileText />
                        ) : (
                          <FileImage />
                        )}
                      </span>
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
                        document.mimeType === "application/pdf" ? (
                          <iframe
                            src={documentPreviews[document.id]}
                            title={`Uploaded schedule ${document.name}`}
                          />
                        ) : (
                          <img
                            src={documentPreviews[document.id]}
                            alt={`Uploaded schedule ${document.name}`}
                          />
                        )
                      ) : (
                        <span>Loading file…</span>
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
                  ? "Notifications connected"
                  : importState === "error"
                    ? "Schedule not recognized"
                    : "Schedule found"}
              </b>
              <p>{importMessage}</p>
              {loadedFiles.length > 0 && <small>{loadedFiles.join(" · ")}</small>}
              {importState !== "error" && canEnableNotifications ? (
                <button
                  className="button primary calendar-export-button"
                  onClick={() => setNotificationsOpen(true)}
                >
                  <Bell />
                  {notificationProfile ? "Notification settings" : "Turn on notifications"}
                </button>
              ) : importState !== "error" ? (
                <small>Add a shift to turn on notifications.</small>
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
            <div><b><PersonName name={prefs.person} /></b><small>Schedule owner</small></div>
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
              <label className="shift-title-field">
                <span>Shift title</span>
                <input
                  type="text"
                  value={shiftDraft.title}
                  onChange={(event) =>
                    setShiftDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Work"
                />
              </label>
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

      {notificationsOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setNotificationsOpen(false)}>
          <section
            className="export-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Notification settings"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow neutral">Notifications</span>
                <h2>Shift alerts</h2>
              </div>
              <button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X /></button>
            </header>
            <p className="subscription-copy">
              {notificationPermission === "granted" && notificationProfile
                ? "Notifications are on. Shift changes and alert times update automatically."
                : "On iPhone, add Shiftdeck to your Home Screen and open it from the icon. Then tap Turn on notifications below."}
            </p>
            <div className="export-fields">
              <label>
                <span>Default job title</span>
                <input value={prefs.title} onChange={(event) => savePrefs({ title: event.target.value })} placeholder="Work" />
                <small>Imported shifts use this unless you edit the shift on Today.</small>
              </label>
              <label className="place-field">
                <span>Location</span>
                <input
                  value={prefs.location}
                  onChange={(event) => {
                    const coordinate = parseCoordinatePair(event.target.value);
                    if (coordinate) {
                      setCoordinateDraft(
                        formatAppleCoordinates(
                          coordinate.latitude,
                          coordinate.longitude,
                        ),
                      );
                      setCoordinatesOpen(true);
                      savePrefs({
                        location: "Pinned location",
                        locationLat: coordinate.latitude,
                        locationLon: coordinate.longitude,
                      });
                      setPlaceSuggestions([]);
                      setPlaceMenuOpen(false);
                      return;
                    }
                    savePrefs({
                      location: event.target.value,
                      locationLat: null,
                      locationLon: null,
                    });
                    setPlaceSuggestions([]);
                    setPlaceLookupState("idle");
                    setPlaceMenuOpen(true);
                  }}
                  onFocus={() => setPlaceMenuOpen(true)}
                  onBlur={() =>
                    window.setTimeout(() => setPlaceMenuOpen(false), 120)
                  }
                  placeholder="Search a U.S. place or address"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={placeMenuOpen && placeSuggestions.length > 0}
                  aria-controls="calendar-place-suggestions"
                />
                {placeMenuOpen && prefs.location.trim().length >= 3 && (
                  <div
                    className="place-suggestions"
                    id="calendar-place-suggestions"
                    role="listbox"
                  >
                    {placeLookupState === "loading" ? (
                      <span className="place-lookup-message">Finding places…</span>
                    ) : placeSuggestions.length ? (
                      placeSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          role="option"
                          aria-selected="false"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            savePrefs({
                              location: suggestion.label,
                              locationLat: suggestion.latitude,
                              locationLon: suggestion.longitude,
                            });
                            setCoordinateDraft(
                              formatAppleCoordinates(
                                suggestion.latitude,
                                suggestion.longitude,
                              ),
                            );
                            setPlaceSuggestions([]);
                            setPlaceMenuOpen(false);
                          }}
                        >
                          <b>{suggestion.primary}</b>
                          {suggestion.secondary && (
                            <span>{suggestion.secondary}</span>
                          )}
                        </button>
                      ))
                    ) : (
                      <span className="place-lookup-message">
                        {placeLookupState === "error"
                          ? "Place search is unavailable right now."
                          : "No matching places found."}
                      </span>
                    )}
                    <small>
                      Places from OpenStreetMap via Photon
                    </small>
                  </div>
                )}
                {prefs.location &&
                  Number.isFinite(prefs.locationLat) &&
                  Number.isFinite(prefs.locationLon) && (
                    <small className="place-selected">
                      <MapPin />
                      Map pin attached ·{" "}
                      {formatAppleCoordinates(
                        prefs.locationLat!,
                        prefs.locationLon!,
                      )}
                    </small>
                  )}
              </label>
              <div className="coordinate-tools" hidden>
                <button
                  type="button"
                  className="coordinate-toggle"
                  onClick={() => {
                    setCoordinatesOpen((current) => {
                      const next = !current;
                      if (next) {
                        setCoordinateDraft(
                          typeof prefs.locationLat === "number" &&
                            typeof prefs.locationLon === "number"
                            ? formatAppleCoordinates(
                                prefs.locationLat,
                                prefs.locationLon,
                              )
                            : "",
                        );
                      }
                      return next;
                    });
                  }}
                >
                  <MapPin />
                  {coordinatesOpen ? "Hide coordinates" : "Enter coordinates"}
                </button>
                {hasStructuredCalendarPlace && (
                  <a
                    href={`https://maps.apple.com/?ll=${prefs.locationLat},${prefs.locationLon}&q=${encodeURIComponent(prefs.location.trim())}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Preview in Apple Maps
                  </a>
                )}
              </div>
              {false && coordinatesOpen && (
                <div className="coordinate-fields">
                  <label>
                    <span className="coordinate-field-heading">
                      <span>Coordinates</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCoordinateDraft("");
                          savePrefs({
                            locationLat: null,
                            locationLon: null,
                          });
                        }}
                      >
                        Clear pin
                      </button>
                    </span>
                    <input
                      type="text"
                      inputMode="text"
                      value={coordinateDraft}
                      onChange={(event) => updateCoordinateDraft(event.target.value)}
                      placeholder="40.65382° N, 75.43225° W"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck="false"
                    />
                  </label>
                  <small>Paste from Apple Maps</small>
                </div>
              )}
              <div className="notification-alerts">
                <div className="notification-alerts-heading">
                  <div>
                    <span>Alerts</span>
                    <small>Choose exactly when each alert arrives.</small>
                  </div>
                  <button
                    type="button"
                    className="button soft"
                    onClick={addNotificationAlert}
                  >
                    <Plus /> Add alert
                  </button>
                </div>
                <div className="notification-alert-list">
                  {prefs.alerts.map((minutes, index) => {
                    const unit = alertUnitFor(minutes);
                    return (
                      <div className="notification-alert-row" key={`alert-${index}`}>
                        <input
                          type="number"
                          min="0"
                          max={Math.floor(10080 / unit)}
                          step="1"
                          inputMode="numeric"
                          aria-label={`Alert ${index + 1} amount`}
                          value={alertAmountFor(minutes)}
                          onChange={(event) =>
                            updateNotificationAlert(
                              index,
                              Number(event.target.value),
                              unit,
                            )
                          }
                        />
                        <label>
                          <span className="sr-only">Alert {index + 1} unit</span>
                          <select
                            value={unit}
                            onChange={(event) =>
                              updateNotificationAlert(
                                index,
                                alertAmountFor(minutes),
                                Number(event.target.value),
                              )
                            }
                          >
                            {ALERT_UNIT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown />
                        </label>
                        <span>before</span>
                        <button
                          type="button"
                          aria-label={`Remove alert ${index + 1}`}
                          disabled={prefs.alerts.length === 1}
                          onClick={() => removeNotificationAlert(index)}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <button
              className="button primary"
              onClick={() => void saveNotificationSettings()}
              disabled={notificationSyncState === "syncing"}
            >
              {notificationProfile ? <Check /> : <Bell />}
              {notificationSyncState === "syncing"
                ? notificationProfile
                  ? "Saving…"
                  : "Connecting…"
                : notificationProfile
                  ? "Save changes"
                  : "Turn on notifications"}
            </button>
            {notificationProfile && (
              <div className="notification-actions">
                <button
                  className="button soft"
                  onClick={() => void sendTestNotification()}
                  disabled={notificationSyncState === "syncing"}
                >
                  <Bell /> Send test
                </button>
                <button
                  className="button danger subtle"
                  onClick={() => void disconnectNotifications()}
                >
                  Turn off
                </button>
              </div>
            )}
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
                {availableWorkers.map((worker) => (
                  <option value={worker} key={worker}>
                    {isGroundSecurityCoordinator(worker) ? `${worker} · GSC` : worker}
                  </option>
                ))}
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
            <div className="calendar-subscription-setting">
              <div>
                <span>Notifications</span>
                <b>
                  {notificationPermission === "unsupported"
                    ? "Not supported on this device"
                    : notificationPermission === "denied"
                      ? "Blocked in device settings"
                      : notificationProfile
                        ? notificationSyncState === "syncing"
                      ? "Updating…"
                      : notificationSyncState === "error"
                        ? "Needs attention"
                        : `${prefs.alerts.length} alert${prefs.alerts.length === 1 ? "" : "s"} per shift`
                        : "Off"}
                </b>
              </div>
              <button
                className="button soft"
                onClick={() => {
                  setSettingsOpen(false);
                  setNotificationsOpen(true);
                }}
              >
                {notificationProfile ? "Manage" : "Set up"}
              </button>
            </div>
            <div className="calendar-subscription-setting">
              <div>
                <span>Apple Calendar</span>
                <b>
                  {calendarSyncState === "syncing"
                    ? "Updating…"
                    : calendarSyncState === "error"
                      ? "Needs attention"
                      : calendarSubscription
                        ? `Automatic · ${DEFAULT_WORK_LOCATION}`
                        : "Add shifts for Waze"}
                </b>
              </div>
              <button
                className="button soft"
                onClick={() => void subscribeToCalendar()}
                disabled={calendarSyncState === "syncing"}
              >
                {calendarSubscription ? "Open" : "Add"}
              </button>
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
            <p>This resets saved settings and uploads on this device. It also turns off this device’s Shiftdeck notifications.</p>
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
