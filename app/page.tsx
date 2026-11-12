"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  Check,
  ChevronDown,
  FileImage,
  FileText,
  MapPin,
  Moon,
  Plus,
  Settings,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  useEffect,
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
  ParsedSchedule,
  resolveSchedulePersonName,
  SCHEDULE_PARSER_VERSION,
} from "./schedule-parser";
import {
  createImportProgress,
  IMPORT_STAGES,
  ImportSnapshot,
  applyNameMerges,
  isScheduleRange,
  likelyDuplicateNames,
  mergePairKey,
  NameMerges,
  nameKey,
  ScheduleRange,
  toMinutes,
} from "./schedule-tools";
import {
  readScheduleImage,
  releaseScheduleReader,
  warmScheduleReader,
} from "./schedule-import";
import {
  CrewPanel,
  DayStatus,
  EmptyState,
  FlightList,
  isGroundSecurityCoordinator,
  ScheduleViews,
  SwapSheet,
  NameMergeSheet,
  TodayHero,
  backdropClose,
} from "./home-sections";
import {
  clearScheduleImages,
  deleteScheduleImage,
  loadScheduleImage,
  saveScheduleImage,
} from "./upload-store";

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

const DEFAULT_SHIFT_TITLE = "Work";
const DEFAULT_ALERT_MINUTES = 120;
const DEFAULT_WORK_LOCATION = "3311 Airport Rd, Allentown, PA 18109";
const HOME_VIEW_KEY = "shiftdeck.homeView";
const NAME_MERGES_KEY = "shiftdeck.nameMerges";
const NAME_MERGE_DISMISSED_KEY = "shiftdeck.nameMergeDismissed";

type Sheet = "import" | "swap" | null;

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

const getWorkingShift = (shifts: Shift[], date: string, person: string) =>
  shifts.find(
    (shift) =>
      shift.date === date && shift.worker === person && shift.status === "working",
  );

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

const calendarKeyFor = (person: string, date: string) =>
  `shift:${person.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${date}`;

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
  const resolver = new URL(
    calendarServiceUrl("/api/flights/resolve"),
    typeof window === "undefined" ? CALENDAR_SERVICE_ORIGIN : window.location.href,
  );
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
  const [sheet, setSheet] = useState<Sheet>(null);
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange>("week");
  const [showRanges, setShowRanges] = useState(false);
  const [nameMerges, setNameMerges] = useState<NameMerges>({});
  const [dismissedMerges, setDismissedMerges] = useState<string[]>([]);
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
  const [nameMergeOpen, setNameMergeOpen] = useState(false);
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
  const [importState, setImportState] = useState<
    "idle" | "reading" | "review" | "error"
  >("idle");
  const [importSnapshot, setImportSnapshot] = useState<ImportSnapshot>({
    progress: 0,
    stage: 0,
    detail: "",
  });
  const [importMessage, setImportMessage] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
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
  const [clockNow, setClockNow] = useState(() => new Date());
  const fileInput = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<Sheet>(null);

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
      try {
        const savedMerges = JSON.parse(
          localStorage.getItem(NAME_MERGES_KEY) ?? "{}",
        ) as unknown;
        if (savedMerges && typeof savedMerges === "object" && !Array.isArray(savedMerges)) {
          setNameMerges(
            Object.fromEntries(
              Object.entries(savedMerges as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            ),
          );
        }
        const savedDismissed = JSON.parse(
          localStorage.getItem(NAME_MERGE_DISMISSED_KEY) ?? "[]",
        ) as unknown;
        if (Array.isArray(savedDismissed)) {
          setDismissedMerges(savedDismissed.filter((item) => typeof item === "string"));
        }
      } catch {
        localStorage.removeItem(NAME_MERGES_KEY);
        localStorage.removeItem(NAME_MERGE_DISMISSED_KEY);
      }
      try {
        const savedView = JSON.parse(
          localStorage.getItem(HOME_VIEW_KEY) ?? "{}",
        ) as { range?: unknown; showRanges?: unknown };
        if (isScheduleRange(savedView.range)) setScheduleRange(savedView.range);
        if (typeof savedView.showRanges === "boolean") {
          setShowRanges(savedView.showRanges);
        }
      } catch {
        localStorage.removeItem(HOME_VIEW_KEY);
      }
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
    const updateClock = () => setClockNow(new Date());
    updateClock();
    const interval = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(NAME_MERGES_KEY, JSON.stringify(nameMerges));
    localStorage.setItem(NAME_MERGE_DISMISSED_KEY, JSON.stringify(dismissedMerges));
  }, [dismissedMerges, hydrated, nameMerges]);

  const importedDateSet = useMemo(() => new Set(importedDates), [importedDates]);

  const scheduleDates = useMemo(
    () => Array.from(importedDateSet).sort(),
    [importedDateSet],
  );

  const baseImportedShifts = useMemo(
    () =>
      applyNameMerges(
        parsedShifts.filter((shift) => importedDateSet.has(shift.date)),
        nameMerges,
      ),
    [importedDateSet, nameMerges, parsedShifts],
  );

  const workerNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    baseImportedShifts.forEach((shift) => {
      if (shift.status === "working") {
        counts.set(shift.worker, (counts.get(shift.worker) ?? 0) + 1);
      } else if (!counts.has(shift.worker)) {
        counts.set(shift.worker, 0);
      }
    });
    if (!counts.has(prefs.person)) counts.set(prefs.person, events.length);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [baseImportedShifts, events.length, prefs.person]);

  const mergeSuggestions = useMemo(
    () => likelyDuplicateNames(workerNameCounts, new Set(dismissedMerges)),
    [dismissedMerges, workerNameCounts],
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

  // Follow "today" as it rolls over (after an overnight shift ends), and
  // land on it once saved data is restored.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedDate(todayDate);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, todayDate]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      HOME_VIEW_KEY,
      JSON.stringify({ range: scheduleRange, showRanges }),
    );
  }, [hydrated, scheduleRange, showRanges]);

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

  const myDayStatus = useMemo(() => {
    const statuses = new Map<string, DayStatus>();
    importedDates.forEach((date) => statuses.set(date, { status: "off" }));
    baseImportedShifts.forEach((shift) => {
      if (shift.status === "pto" && isSameSchedulePerson(shift.worker, prefs.person)) {
        statuses.set(shift.date, { status: "pto" });
      }
    });
    events.forEach((event) =>
      statuses.set(event.date, {
        status: "working",
        start: event.start,
        end: event.end,
      }),
    );
    return statuses;
  }, [baseImportedShifts, events, importedDates, prefs.person]);

  const swapShifts = useMemo(
    () => [
      ...importedShifts,
      ...baseImportedShifts
        .filter(
          (shift) =>
            shift.status === "pto" &&
            isSameSchedulePerson(shift.worker, prefs.person),
        )
        .map((shift) => ({ ...shift, worker: prefs.person })),
    ],
    [baseImportedShifts, importedShifts, prefs.person],
  );

  const dayFlights = useMemo(
    () =>
      importedFlights
        .filter((flight) => flight.date === selectedDate)
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    [importedFlights, selectedDate],
  );

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
    setSelectedDate(date);
  };

  const returnToToday = () => {
    selectDate(todayDate);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openSheet = (next: Exclude<Sheet, null>) => {
    if (next === "import") void warmScheduleReader().catch(() => undefined);
    setSheet(next);
  };

  const closeSheet = () => {
    if (sheet === "import" && importState !== "reading") {
      void releaseScheduleReader();
    }
    setSheet(null);
  };

  const mergeNames = (from: string, to: string) => {
    // Your own name is always the one that's kept.
    if (isSameSchedulePerson(from, prefs.person)) [from, to] = [to, from];
    if (!from || !to || nameKey(from) === nameKey(to)) return;
    const next: NameMerges = { ...nameMerges, [nameKey(from)]: to };
    // Anything already merged into the old name follows it.
    Object.entries(next).forEach(([key, target]) => {
      if (nameKey(target) === nameKey(from)) next[key] = to;
    });
    delete next[nameKey(to)];
    setNameMerges(next);
    if (isSameSchedulePerson(to, prefs.person)) {
      // Shifts read under the misspelling become your shifts too.
      const known = new Set(events.map((event) => event.date));
      const added = applyNameMerges(
        parsedShifts.filter((shift) => importedDateSet.has(shift.date)),
        next,
      )
        .filter(
          (shift) =>
            isSameSchedulePerson(shift.worker, prefs.person) &&
            shift.status === "working" &&
            !known.has(shift.date),
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
      if (added.length) {
        setEvents((current) =>
          [...current, ...added].sort((a, b) =>
            `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
          ),
        );
      }
    }
    setToast(`Merged ${from} into ${to}`);
  };

  const undoNameMerge = (from: string) => {
    setNameMerges((current) => {
      const next = { ...current };
      delete next[nameKey(from)];
      return next;
    });
    setToast(`${from} is separate again`);
  };

  const dismissMergeSuggestion = (a: string, b: string) => {
    setDismissedMerges((current) => [...new Set([...current, mergePairKey(a, b)])]);
  };

  const savePrefs = (next: Partial<Preferences>) => {
    const updated = { ...prefs, ...next };
    setPrefs(updated);
    if (next.person) {
      setEvents(eventsFor(importedShifts, next.person));
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
    if (detectedDates.length) {
      const upcoming = detectedDates.find((date) => date >= todayDate);
      selectDate(
        detectedDateSet.has(todayDate) ? todayDate : upcoming ?? detectedDates[0],
      );
    }
    setParsedShifts(nextParsedShifts);
    setParsedFlights(nextParsedFlights);
    setImportedDates(nextDates);
    localStorage.setItem("shiftdeck.activeDates", JSON.stringify(nextDates));
    return matching.length;
  };

  const processFiles = async (files: File[]) => {
    if (!files.length || importState === "reading") return;
    setImportState("reading");
    setImportMessage("");
    setImportWarnings([]);
    setDuplicateNotice("");
    setLoadedFiles(files.map((file) => file.name));
    const progress = createImportProgress(files.length, setImportSnapshot);
    setImportSnapshot(progress.snapshot());

    const parsedSchedules: ParsedSchedule[] = [];
    const skippedFiles: string[] = [];
    let nextDocuments = [...scheduleDocuments];
    let updatedDocuments = 0;
    const knownNames = [
      prefs.person,
      ...parsedShifts.map((shift) => shift.worker),
      ...scheduleDocuments.flatMap((document) =>
        document.shifts.map((shift) => shift.worker),
      ),
    ];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        progress.detail(
          files.length > 1 ? `${file.name} · ${index + 1} of ${files.length}` : file.name,
        );

        try {
          const isPdf =
            file.type === "application/pdf" || /\.pdf$/i.test(file.name);
          const [hash, read] = await Promise.all([
            hashFile(file),
            isPdf
              ? (progress.stage(1), parseCharterPdf(file))
              : readScheduleImage(file, {
                  onFraction: (fraction) => progress.file(index, fraction),
                  onReading: () => progress.stage(1),
                  onDoubleCheck: () => progress.stage(2),
                }),
          ]);
          progress.file(index, 1);
          let parsed: ParsedSchedule | null = read;

          if (!parsed) {
            skippedFiles.push(file.name);
            continue;
          }

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
          knownNames.push(...parsed.shifts.map((shift) => shift.worker));
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
        } catch {
          skippedFiles.push(file.name);
        }
      }

      progress.stage(3);
      if (!parsedSchedules.length) {
        progress.finish();
        setImportMessage(
          "No names, work hours, or flights could be read. Try a sharper, straight-on photo of the schedule.",
        );
        setImportState("error");
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
      localStorage.setItem(
        "shiftdeck.importHashes",
        JSON.stringify(nextDocuments.map((document) => document.hash)),
      );
      progress.finish();
      setImportMessage(
        parsedShiftCount
          ? `${count} of your shifts · ${Math.max(0, parsedShiftCount - count)} coworker shifts · ${parsedFlightCount} flights`
          : `${parsedFlightCount} charter flights`,
      );
      setImportWarnings(
        [
          ...(updatedDocuments
            ? [`Replaced ${updatedDocuments === 1 ? "an older copy" : `${updatedDocuments} older copies`} of the same week.`]
            : []),
          ...Array.from(
            new Set(parsedSchedules.flatMap((schedule) => schedule.warnings)),
          ).filter((warning) => !/several scans/i.test(warning)),
          ...(skippedFiles.length
            ? [
                `Couldn’t read ${skippedFiles.join(", ")} — everything else was kept.`,
              ]
            : []),
        ],
      );
      setImportState("review");
      setToast("Schedule imported");
    } catch {
      progress.finish();
      setImportState("error");
      setImportMessage(
        "The readable schedule details couldn’t be saved. Please try again.",
      );
    } finally {
      if (sheetRef.current !== "import") void releaseScheduleReader();
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
      NAME_MERGES_KEY,
      NAME_MERGE_DISMISSED_KEY,
      HOME_VIEW_KEY,
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
    setNameMerges({});
    setDismissedMerges([]);
    setImportState("idle");
    setImportSnapshot({ progress: 0, stage: 0, detail: "" });
    setImportMessage("");
    setImportWarnings([]);
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
    setNameMergeOpen(false);
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

  const renderImportSheet = () => (
    <div className="modal-layer" role="presentation" {...backdropClose(closeSheet)}>
    <section
      className="panel-sheet import-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Import schedule"
     
    >
      <header className="sheet-head">
        <div>
          <h2>Import</h2>
          <p>Schedule photos or charter PDFs. Anything readable is kept.</p>
        </div>
        <button type="button" onClick={closeSheet} aria-label="Close import">
          <X />
        </button>
      </header>
      <div className="sheet-scroll">
      <section
        className={`upload-card ${importState === "reading" ? "is-reading" : ""} ${dragActive ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (importState !== "reading") setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          void processFiles(Array.from(event.dataTransfer.files ?? []));
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf,.pdf"
          multiple
          onChange={onFiles}
          aria-label="Upload schedule files"
        />
        {importState === "reading" ? (
          <div className="reading-state" aria-live="polite">
            <span className="scanner-icon"><FileImage /><i /></span>
            <ol className="import-steps">
              {IMPORT_STAGES.map((label, index) => (
                <li
                  key={label}
                  className={
                    index < importSnapshot.stage
                      ? "done"
                      : index === importSnapshot.stage
                        ? "active"
                        : ""
                  }
                >
                  <i>{index < importSnapshot.stage ? <Check /> : null}</i>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
            <div className="progress-track">
              <i style={{ transform: `scaleX(${importSnapshot.progress / 100})` }} />
            </div>
            <p className="import-detail">
              <span>{importSnapshot.detail || "Preparing"}</span>
              <b>{importSnapshot.progress}%</b>
            </p>
          </div>
        ) : (
          <button className="upload-inner" onClick={() => fileInput.current?.click()}>
            <span className="upload-icon"><Upload /></span>
            <h2>{dragActive ? "Drop to import" : "Add schedule files"}</h2>
            <p>Tap to choose, or drop them here</p>
            <small>JPG, PNG, HEIC or PDF · several at once is fine</small>
          </button>
        )}
      </section>

      {(importState === "review" || importState === "error") && (
        <section className={`import-result ${importState === "error" ? "warning" : "success"}`}>
          <span className="import-result-icon">
            {importState === "error" ? <AlertTriangle /> : <Check />}
          </span>
          <div>
            <b>{importState === "error" ? "Nothing readable found" : "Schedule imported"}</b>
            <p>{importMessage}</p>
            {importWarnings.length > 0 && (
              <ul>
                {importWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {loadedFiles.length > 0 && <small>{loadedFiles.join(" · ")}</small>}
            {importState !== "error" && canEnableNotifications && !notificationProfile && (
              <button
                className="button soft calendar-export-button"
                onClick={() => {
                  setSheet(null);
                  setNotificationsOpen(true);
                }}
              >
                <Bell /> Turn on shift alerts
              </button>
            )}
          </div>
        </section>
      )}

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

      </div>
    </section>
    </div>
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <button className="brand" onClick={returnToToday} aria-label="Shiftdeck, back to today">
          <span><img src="./apple-touch-icon.png" alt="" /></span>
          <b>Shiftdeck</b>
        </button>
        <div className="top-actions">
          <button type="button" onClick={() => openSheet("import")} aria-label="Import schedule">
            <Upload />
            <span>Import</span>
          </button>
          <button type="button" onClick={() => openSheet("swap")} aria-label="Shift swap">
            <ArrowLeftRight />
            <span>Swap</span>
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
            <Settings />
          </button>
        </div>
      </header>

      <main className="home">
        <div className={`home-grid ${hydrated ? "is-ready" : ""}`}>
          <TodayHero
            date={selectedDate}
            isToday={selectedDate === todayDate}
            now={clockNow}
            title={
              myEvent?.customTitle
                ? myEvent.title.trim() || DEFAULT_SHIFT_TITLE
                : prefs.title.trim() || DEFAULT_SHIFT_TITLE
            }
            shift={myShift ? { start: myShift.start, end: myShift.end } : null}
            loaded={importedDateSet.has(selectedDate)}
            isPto={myDayStatus.get(selectedDate)?.status === "pto"}
            onEdit={openEditShift}
            onAdd={openAddShift}
            onToday={returnToToday}
          />
          <ScheduleViews
            range={scheduleRange}
            onRange={setScheduleRange}
            showRanges={showRanges}
            onShowRanges={setShowRanges}
            anchor={todayDate}
            selectedDate={selectedDate}
            onSelect={selectDate}
            dayStatus={(date) => myDayStatus.get(date) ?? { status: "none" }}
            hasSchedule={hasSchedule}
          />
          <FlightList
            flights={dayFlights}
            shift={myShift}
            date={selectedDate}
            isToday={selectedDate === todayDate}
            now={clockNow}
            linkFor={(flight) => flightAwareRouteUrl(flight, prefs.homeAirport)}
            airport={cleanAirportCode(prefs.homeAirport)}
          />
          <CrewPanel
            shifts={dayShifts}
            person={prefs.person}
            myShift={myShift}
            isToday={selectedDate === todayDate}
            now={clockNow}
          />
          {!hasSchedule && hydrated && (
            <section className="panel first-run">
              <EmptyState
                icon={<Upload />}
                title="Nothing imported yet"
                copy="Snap the weekly schedule and Shiftdeck fills in your shifts, crew, and flights."
              />
              <button className="button primary" onClick={() => openSheet("import")}>
                <Upload /> Import a schedule
              </button>
            </section>
          )}
        </div>
      </main>

      {sheet === "import" && renderImportSheet()}
      {sheet === "swap" && (
        <SwapSheet
          shifts={swapShifts}
          person={prefs.person}
          dates={scheduleDates.filter((date) => date >= todayDate)}
          initialOffDate={selectedDate}
          onClose={closeSheet}
        />
      )}

      {shiftEditor && (
        <div className="modal-layer" role="presentation" {...backdropClose(() => setShiftEditor(null))}>
          <section className="shift-sheet" role="dialog" aria-modal="true" aria-label={shiftEditor.mode === "edit" ? "Edit shift" : "Add shift"}>
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
        <div className="modal-layer" role="presentation" {...backdropClose(() => setNotificationsOpen(false))}>
          <section
            className="panel-sheet notify-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Notification settings"
          >
            <header className="sheet-head">
              <div>
                <h2>Shift alerts</h2>
                <p>Reminders before each shift you work.</p>
              </div>
              <button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X /></button>
            </header>
            <div className="sheet-scroll">
            <div
              className={`notify-status ${
                notificationPermission === "granted" && notificationProfile ? "on" : "off"
              }`}
            >
              <span className="notify-status-icon">
                <Bell />
              </span>
              <div>
                <b>
                  {notificationPermission === "granted" && notificationProfile
                    ? "Notifications are on"
                    : "Notifications are off"}
                </b>
                <small>
                  {notificationPermission === "granted" && notificationProfile
                    ? `${prefs.alerts.length} alert${prefs.alerts.length === 1 ? "" : "s"} per shift · updates automatically`
                    : "On iPhone, open Shiftdeck from its Home Screen icon, then turn them on below."}
                </small>
              </div>
              {notificationProfile && (
                <button
                  type="button"
                  className="notify-test"
                  onClick={() => void sendTestNotification()}
                  disabled={notificationSyncState === "syncing"}
                >
                  Test
                </button>
              )}
            </div>

            <span className="notify-section-label">Shift details</span>
            <div className="export-fields notify-card">
              <label>
                <span>Default job title</span>
                <input value={prefs.title} onChange={(event) => savePrefs({ title: event.target.value })} placeholder="Work" />
                <small>Used for imported shifts unless you rename one.</small>
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
            </div>

            <div className="notify-section-head">
              <span className="notify-section-label">Alerts</span>
              <small>{prefs.alerts.length} of 12</small>
            </div>
            <div className="notify-card notify-alerts">
              {prefs.alerts.map((minutes, index) => {
                const unit = alertUnitFor(minutes);
                return (
                  <div className="notify-alert" key={`alert-${index}`}>
                    <input
                      type="number"
                      min="0"
                      max={Math.floor(10080 / unit)}
                      step="1"
                      inputMode="numeric"
                      aria-label={`Alert ${index + 1} amount`}
                      value={alertAmountFor(minutes)}
                      onChange={(event) =>
                        updateNotificationAlert(index, Number(event.target.value), unit)
                      }
                    />
                    <div className="notify-units" role="radiogroup" aria-label={`Alert ${index + 1} unit`}>
                      {ALERT_UNIT_OPTIONS.map((option) => (
                        <button
                          type="button"
                          role="radio"
                          key={option.value}
                          aria-checked={unit === option.value}
                          className={unit === option.value ? "active" : ""}
                          onClick={() =>
                            updateNotificationAlert(index, alertAmountFor(minutes), option.value)
                          }
                        >
                          {option.value === 1 ? "min" : option.value === 60 ? "hr" : "day"}
                        </button>
                      ))}
                    </div>
                    <span className="notify-before">before</span>
                    <button
                      type="button"
                      className="notify-remove"
                      aria-label={`Remove alert ${index + 1}`}
                      disabled={prefs.alerts.length === 1}
                      onClick={() => removeNotificationAlert(index)}
                    >
                      <X />
                    </button>
                  </div>
                );
              })}
              <div className="notify-presets">
                {[
                  { minutes: 15, label: "15 min" },
                  { minutes: 30, label: "30 min" },
                  { minutes: 60, label: "1 hr" },
                  { minutes: 120, label: "2 hr" },
                  { minutes: 1440, label: "1 day" },
                ]
                  .filter((preset) => !prefs.alerts.includes(preset.minutes))
                  .map((preset) => (
                    <button
                      type="button"
                      key={preset.minutes}
                      disabled={prefs.alerts.length >= 12}
                      onClick={() => savePrefs({ alerts: [...prefs.alerts, preset.minutes] })}
                    >
                      <Plus /> {preset.label}
                    </button>
                  ))}
                <button
                  type="button"
                  className="custom"
                  disabled={prefs.alerts.length >= 12}
                  onClick={addNotificationAlert}
                >
                  <Plus /> Custom
                </button>
              </div>
            </div>

            {notificationProfile && (
              <button
                type="button"
                className="notify-off"
                onClick={() => void disconnectNotifications()}
              >
                Turn off notifications on this device
              </button>
            )}
            </div>

            <footer className="sheet-foot">
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
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-layer" role="presentation" {...backdropClose(() => setSettingsOpen(false))}>
          <section className="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings">
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
            <div className="calendar-subscription-setting">
              <div>
                <span>Coworker names</span>
                <b>
                  {mergeSuggestions.length
                    ? `${mergeSuggestions.length} possible duplicate${mergeSuggestions.length === 1 ? "" : "s"}`
                    : Object.keys(nameMerges).length
                      ? `${Object.keys(nameMerges).length} merged`
                      : "No duplicates found"}
                </b>
              </div>
              <button
                className="button soft"
                onClick={() => {
                  setSettingsOpen(false);
                  setNameMergeOpen(true);
                }}
              >
                Merge names
              </button>
            </div>
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

      {nameMergeOpen && (
        <NameMergeSheet
          suggestions={mergeSuggestions}
          merges={Object.entries(nameMerges).map(([key, to]) => ({
            from: parsedShifts.find((shift) => nameKey(shift.worker) === key)?.worker ?? key,
            to,
          }))}
          person={prefs.person}
          onMerge={mergeNames}
          onDismiss={dismissMergeSuggestion}
          onUndo={undoNameMerge}
          onClose={() => {
            setNameMergeOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}

      {clearConfirmOpen && (
        <div className="modal-layer" role="presentation" {...backdropClose(() => setClearConfirmOpen(false))}>
          <section className="confirm-card" role="alertdialog" aria-modal="true">
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
