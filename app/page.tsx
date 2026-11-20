"use client";

import { HomeSetupSheet } from "./home-setup-sheet";
import { Disclosure, SheetClose } from "./sheet-tools";
import { Flip } from "./flip";
import {
  AlarmClock,
  LayoutGrid,
  AlertTriangle,
  BriefcaseBusiness,
  Plane,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  BookUser,
  CalendarDays,
  Check,
  ChevronDown,
  FileImage,
  FileText,
  Info,
  MapPin,
  Moon,
  Plus,
  Settings,
  Lock,
  Crown,
  Sun,
  Trash2,
  Timer,
  Upload,
  Undo2,
  Users,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  type CSSProperties,
  Fragment,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
  tidyScheduleShifts,
  tidyScheduleWorkers,
  SCHEDULE_PARSER_VERSION,
  scanConfidence,
  type ScanMark,
  type ScheduleSourceLayout,
} from "./schedule-parser";
import {
  compactTime,
  createImportProgress,
  daysBetween,
  ImportSnapshot,
  applyNameMerges,
  isScheduleRange,
  likelyDuplicateNames,
  mergePairKey,
  NameMerges,
  nameKey,
  resolveMergedName,
  ScheduleRange,
  flightTime,
  flightWorkday,
  importedFlightOnCalendar,
  isFlightInShift,
  shiftBounds,
  shiftCalendarDate,
  workdayAt,
  workdayFor,
} from "./schedule-tools";
import {
  readScheduleImage,
  type ScanPreviewPass,
  type ScheduleRead,
  recoverScheduleSource,
  releaseScheduleReader,
  warmScheduleReader,
} from "./schedule-import";
import {
  CrewPanel,
  DayStatus,
  EmptyState,
  type FlightApp,
  FlightList,
  isGroundSecurityCoordinator,
  ScheduleViews,
  SwapSheet,
  NameMergeSheet,
  TodayHero,
  backdropClose,
} from "./home-sections";
import { ShiftEditorSheet } from "./shift-editor";
import { ScheduleComparison } from "./schedule-comparison";
import { ScheduleFileViewer } from "./schedule-file-viewer";
import { ScheduleImportPreview, type ImportPreviewFile } from "./schedule-import-preview";
import { SwapAnswerSheet } from "./swap-answer-sheet";
import { NameChangeSheet } from "./name-change-sheet";
import { AcceptHandoverSheet, BlockedScreen, LinkCodeSheet, LinkPhoneSheet, NamePickScreen, OwnerSheet, type NameAttempt } from "./owner-sheets";
import {
  acceptHandover,
  askForName,
  BlockedError,
  blockPerson,
  cancelHandover,
  decideName,
  linkThisPhone,
  makeRecoveryKey,
  recoverOwner,
  sendWrappedKeys,
  startHandover,
  setShareAccess,
  SuggestNameError,
  UnknownNameError,
  unblockPerson,
  clearLog,
  makeLinkCode,
  NameTakenError,
  movePhone,
  PhoneResetError,
  removePerson,
  removePhone,
  renamePerson,
  renamePhone,
  syncMe,
  withdrawNameRequest,
  type Me,
  type SyncedState,
  getVault,
  putVault,
} from "./people";
import { hasLeft, rosterStatuses } from "./roster-status";
import { DEFAULT_QUICK_MENU, loadQuickMenuStyle, QUICK_MENU_KEY, QuickMenu, type QuickMenuStyle } from "./quick-menu";
import { ShareSheet, SharedImportSheet, TeamSendPrompt, type OpenedShare, type SharedImport } from "./share-sheet";
import { openShareLink, type ShareKey } from "./share-link";
import { buildShare, describeShare } from "./share-build";
import { weekLabel, type SharePackage, type SharedRead } from "./share-data";
import {
  failedTries, loadApplied, loadSent, loadUnsendable, noteFailure, POST_TRIES, rememberUnsendable, saveApplied, sendToMyPhones, toSend, wanted,
} from "./self-sync";
import { SyncBar, type SyncStatus } from "./sync-bar";
import { DEFAULT_SETTINGS, loadClock, saveClock, type ClockData } from "./time-clock";
import { clockFromVault, pickSyncedPrefs, sortedClock, vaultValuesOf } from "./vault-values";
import { dedupePunches, merge, stable, stamp, values, type Values, type Vault } from "./vault-data";
import { loadLocalVault, saveLocalVault, syncVault, type LocalVault } from "./vault";
import { DEFAULT_FLIGHT_ALERTS, FlightAlertSettings, flightAlertSummary, readFlightAlerts, type FlightAlertPrefs } from "./flight-alert-settings";
import { TimeClockCard, TimeClockSheet } from "./time-clock-ui";
import {
  forgetLegacyTeam,
  legacyTeamKey,
  loadSeenPosts,
  postSwapToTeam,
  postToTeam,
  saveSeenPosts,
  teammates,
  type Team,
} from "./team";
import { devicePair, keyCheck, keyProof, loadTeamKey, newTeamKey, publicKeyText, saveTeamKey, unwrapTeamKey, wrapTeamKey } from "./team-key";
import { useLiveFlights } from "./live-flights";
import { DirectorySheet } from "./directory";
import { DIRECTORY_KEY, contactsWithDirectory, entryKey, findPerson, type DirectoryEntry } from "./directory-data";
import { contactKey, CONTACTS_KEY, type Contacts } from "./contacts-data";
import {
  applyEventEdit, applyFix, fixesFor, loadShiftEdits, newerEdits, saveShiftEdits, type ShiftEdits,
} from "./shift-edits";
import {
  cancelSwap,
  fetchSwapStatuses,
  isLiveSwap,
  loadSentSwaps,
  mergeSwapStatuses,
  registerSwap,
  saveSentSwaps,
  type SentSwap,
} from "./swap-requests";
import { DEFAULT_HOME_ORDER, HOME_TILES, type HomeTile } from "./home-order";
import { isAndroid, isHeic } from "./platform";
import { LearningSetting, LiveStatusSetting, prefetchLearning, SettingPlaceholder } from "./live-status-setting";
import { WeatherPanel } from "./weather-panel";
import { LiveMapPanel } from "./live-map";
import {
  clearScheduleImages,
  deleteScheduleImage,
  loadScheduleImage,
  saveScheduleImage,
} from "./upload-store";

const HOME_ORDER_KEY = "shiftdeck.homeOrder";

type CalendarEvent = {
  id: string;
  calendarKey: string;
  date: string;
  start: string;
  end: string;
  title: string;
  customTitle?: boolean;
  fromSchedule?: boolean;
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
  flightApp: FlightApp;
  /** Arrival times in Flights: at the gate, or landing (touchdown). */
  flightTime: "gate" | "landing";
  flightAlerts: FlightAlertPrefs;
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
  flightAlerts: FlightAlertPrefs;
  /** Flights in your upcoming shifts (what "My shifts" alerts follow). */
  flights: Array<{ ident: string; kind: "arrival" | "departure"; at: string }>;
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
  review?: { sourceLayout?: ScheduleSourceLayout; deskewed: boolean; uncertainShifts?: string[] };
};

type ImportComparison = Pick<ScheduleDocument, "hash" | "name" | "dates" | "shifts"> & {
  image?: Blob;
  sourceLayout?: ScheduleSourceLayout;
  sourceLoading?: boolean;
  uncertainShifts?: string[];
};

const isSchedulePdf = ({ mimeType, name }: ScheduleDocument) =>
  mimeType === "application/pdf" || /\.pdf$/i.test(name);

const DEFAULT_SHIFT_TITLE = "Work";
const DEFAULT_ALERT_MINUTES = 120;
const DEFAULT_WORK_LOCATION = "3311 Airport Rd, Allentown, PA 18109";
const HOME_VIEW_KEY = "shiftdeck.homeView";
const BLOCKED_KEY = "shiftdeck.blocked";
const DISMISSED_POSTS_KEY = "shiftdeck.teamDismissed";
/** For pacing the scan preview (outside the component: only called while importing). */
const frameClock = () => performance.now();
// The owner reset this phone: it can't be used until a name is picked.
const PICK_NAME_KEY = "shiftdeck.pickName";
const NAME_MERGES_KEY = "shiftdeck.nameMerges";
const NAME_MERGE_DISMISSED_KEY = "shiftdeck.nameMergeDismissed";

type Sheet = "import" | "swap" | null;

const DEFAULT_PREFS: Preferences = {
  // A new device asks whose schedule it is during the first import.
  person: "",
  title: DEFAULT_SHIFT_TITLE,
  alerts: [DEFAULT_ALERT_MINUTES],
  location: DEFAULT_WORK_LOCATION,
  locationLat: null,
  locationLon: null,
  notes: "",
  homeAirport: "ABE",
  airline: "Allegiant",
  flightApp: "flightaware",
  flightTime: "gate",
  flightAlerts: DEFAULT_FLIGHT_ALERTS,
};

/** "30 min, 1 hr before" (the soonest first). */
const reminderSummary = (alerts: number[]) => {
  const label = (minutes: number) => minutes === 0 ? "at start"
    : minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`
      : minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
  const sorted = [...alerts].sort((a, b) => a - b);
  const shown = sorted.slice(0, 3).map(label).join(", ");
  return `${shown}${sorted.length > 3 ? ` +${sorted.length - 3}` : ""}${sorted.some((minutes) => minutes > 0) ? " before" : ""}`;
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

const importedEventFor = (shift: Shift, person: string): CalendarEvent => ({
  id: shift.id,
  calendarKey: calendarKeyFor(person, shift.date),
  date: shift.date,
  start: shift.start,
  end: shift.end,
  title: DEFAULT_SHIFT_TITLE,
  customTitle: false,
  fromSchedule: true,
});

const eventCalendarDate = (event: CalendarEvent) => shiftCalendarDate(event, event.fromSchedule);

const eventsFor = (shifts: Shift[], person: string) =>
  shifts
    .filter(
      (shift) =>
        (nameKey(shift.worker) === nameKey(person) || isSameSchedulePerson(shift.worker, person)) &&
        shift.status === "working",
    )
    .map((shift) => importedEventFor(shift, person));

const CALENDAR_SERVICE_ORIGIN =
  "https://shiftdeck-calendar.frenchbear1.workers.dev";
const FLIGHTAWARE_ORIGIN = "https://www.flightaware.com";
const FLIGHTRADAR24_ORIGIN = "https://www.flightradar24.com";

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

function flightAwareRouteUrl(
  flight: Flight,
  homeAirport: string,
  app: FlightApp = "flightaware",
) {
  if (flight.source === "airport-board" && flight.trackingId) {
    const callsign = flight.trackingId.replace(/^G4/, "AAY");
    return app === "flightradar24"
      ? new URL(`/data/flights/${flight.trackingId.toLowerCase()}`, FLIGHTRADAR24_ORIGIN).toString()
      : new URL(`/live/flight/${callsign}`, FLIGHTAWARE_ORIGIN).toString();
  }
  if (app === "flightradar24" && flight.source === "charter" && flight.trackingId) {
    return new URL(
      `/data/aircraft/${encodeURIComponent(flight.trackingId.toLowerCase())}`,
      FLIGHTRADAR24_ORIGIN,
    ).toString();
  }
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
  if (app === "flightradar24") resolver.searchParams.set("app", app);
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

const subscribeToNothing = () => () => {};

const formatShortDay = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${date}T12:00:00`));

const formatTimeRange = ({ start, end }: { start: string; end: string }) =>
  `${compactTime(start)}–${compactTime(end)}`;

export default function HomePage() {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange>("week");
  const [showRanges, setShowRanges] = useState(false);
  const [nameMerges, setNameMerges] = useState<NameMerges>({});
  const [dismissedMerges, setDismissedMerges] = useState<string[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [selectedDate, setSelectedDate] = useState(() => workdayAt());
  const [importedDates, setImportedDates] = useState<string[]>([]);
  const [parsedShifts, setParsedShifts] = useState<Shift[]>([]);
  const [parsedFlights, setParsedFlights] = useState<Flight[]>([]);
  const [scheduleDocuments, setScheduleDocuments] = useState<ScheduleDocument[]>([]);
  const [importComparisons, setImportComparisons] = useState<ImportComparison[]>([]);
  const [expandedDocument, setExpandedDocument] = useState<string | null>(null);
  const [openReviewHash, setOpenReviewHash] = useState<string | null>(null);
  const [preparedReviews, setPreparedReviews] = useState<Record<string, {
    image?: Blob;
    sourceLayout?: ScheduleSourceLayout;
  }>>({});
  const preparingReview = useRef(false);
  const [viewedDocument, setViewedDocument] = useState<ScheduleDocument | null>(null);
  /** The live flight of the plane tapped on the map (highlighted in Flights). */
  const [mapPicked, setMapPicked] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [homeOrder, setHomeOrder] = useState<HomeTile[]>(DEFAULT_HOME_ORDER);
  useEffect(() => {
    try {
      // Scan definitions were removed; drop what older versions stored.
      localStorage.removeItem("shiftdeck.scanDefinitions");
      const saved: unknown = JSON.parse(localStorage.getItem(HOME_ORDER_KEY) ?? "null");
      if (!Array.isArray(saved)) return;
      const known = saved.filter((tile): tile is HomeTile =>
        typeof tile === "string" && Object.hasOwn(HOME_TILES, tile),
      );
      // A tile added since you arranged yours (the time clock) goes under Today.
      if (!known.includes("clock")) known.splice(known.indexOf("today") + 1, 0, "clock");
      queueMicrotask(() => setHomeOrder([...new Set([...known, ...DEFAULT_HOME_ORDER])]));
    } catch {
      // Use the default layout if storage is unavailable.
    }
  }, []);
  // The floating menu button: which bottom corner, and solid or just the icon.
  const [quickMenu, setQuickMenu] = useState<QuickMenuStyle>(DEFAULT_QUICK_MENU);
  useEffect(() => {
    const saved = loadQuickMenuStyle();
    queueMicrotask(() => setQuickMenu(saved));
  }, []);
  const saveQuickMenu = (next: QuickMenuStyle) => {
    setQuickMenu(next);
    try {
      localStorage.setItem(QUICK_MENU_KEY, JSON.stringify(next));
    } catch {
      // Applies for this visit.
    }
  };
  const saveHomeOrder = (order: HomeTile[]) => {
    setHomeOrder(order);
    try {
      localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(order));
    } catch {
      // Apply the order for the current visit.
    }
  };
  // Punches and pay: on this device only.
  const [clockData, setClockData] = useState<ClockData | null>(null);
  const [clockOpen, setClockOpen] = useState(false);
  useEffect(() => {
    const saved = loadClock();
    queueMicrotask(() => setClockData(saved));
  }, []);
  const changeClock = (next: ClockData) => {
    setClockData(next);
    saveClock(next);
  };
  const [settingsOpen, setSettingsOpenState] = useState(false);
  const [homeSetupOpen, setHomeSetupOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpenState] = useState(false);
  // What's changed in Settings or Alerts but not saved yet: nothing applies until Save
  // (closing without it drops them). Opening or closing either one starts clean.
  const [prefsDraft, setPrefsDraft] = useState<{ sheet: "settings" | "alerts"; patch: Partial<Preferences> } | null>(null);
  const setSettingsOpen = (open: boolean) => {
    setSettingsOpenState(open);
    setPrefsDraft(null);
  };
  const setNotificationsOpen = (open: boolean) => {
    setNotificationsOpenState(open);
    setPrefsDraft(null);
  };
  const editDraft = (sheet: "settings" | "alerts") => (patch: Partial<Preferences>) =>
    setPrefsDraft((current) => ({ sheet, patch: { ...(current?.sheet === sheet ? current.patch : {}), ...patch } }));
  const alertPrefs: Preferences = prefsDraft?.sheet === "alerts" ? { ...prefs, ...prefsDraft.patch } : prefs;
  const settingsPrefs: Preferences = prefsDraft?.sheet === "settings" ? { ...prefs, ...prefsDraft.patch } : prefs;
  const editAlerts = editDraft("alerts");
  /** Saves what was changed in that sheet. */
  const commitDraft = (sheet: "settings" | "alerts") => {
    if (prefsDraft?.sheet === sheet) savePrefs(prefsDraft.patch);
  };
  const [nameMergeOpen, setNameMergeOpen] = useState(false);
  // Coworker emails/numbers: on this device, and (encrypted) on your other devices through your vault.
  const [contacts, setContacts] = useState<Contacts>({});
  const [contactsOpen, setContactsOpen] = useState<{ focus?: string } | null>(null);
  // Shifts you added, changed or deleted by hand, for your other devices (shift-edits.ts).
  const [shiftEdits, setShiftEdits] = useState<ShiftEdits<CalendarEvent>>({});
  // Contacts and shift edits are read: only then can the vault tell a deletion from not-loaded-yet.
  const [personalLoaded, setPersonalLoaded] = useState(false);
  useEffect(() => {
    let saved: unknown = {};
    try {
      saved = JSON.parse(localStorage.getItem(CONTACTS_KEY) ?? "{}");
    } catch {
      // Start with no contacts.
    }
    const edits = loadShiftEdits<CalendarEvent>(workdayAt());
    queueMicrotask(() => {
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setContacts(saved as Contacts);
      setShiftEdits(edits);
      setPersonalLoaded(true);
    });
  }, []);
  /** Notes hand-made shift changes (date → your shift that day, or none) for your other devices. */
  const recordShiftEdits = (entries: ShiftEdits<CalendarEvent>) => {
    setShiftEdits((current) => {
      const next = { ...current, ...entries };
      saveShiftEdits(next);
      return next;
    });
  };
  // The work phone directory, kept only on this device.
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Schedules imported just now (by this phone, not from a share), for "Send to the team?".
  const [justImported, setJustImported] = useState<string[]>([]);
  // A share link being opened: loading, then what it holds (or why it couldn't).
  /** The share being opened, and the team notification it came from. */
  const [incoming, setIncoming] = useState<{ share: OpenedShare | null; error: string; postId?: string } | null>(null);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(DIRECTORY_KEY) ?? "[]");
      if (Array.isArray(saved)) queueMicrotask(() => setDirectory(saved as DirectoryEntry[]));
    } catch {
      // Start empty.
    }
  }, []);
  const saveDirectory = (next: DirectoryEntry[]) => {
    setDirectory(next);
    try {
      localStorage.setItem(DIRECTORY_KEY, JSON.stringify(next));
    } catch {
      // Kept for this visit.
    }
  };
  // Everyone who uses the app is the team: the key that encrypts what's sent to it lives on this phone.
  const [teamKey, setTeamKey] = useState<string | null>(null);
  // The owner blocked this person: the app stays covered until they're unblocked.
  const [blockedHere, setBlockedHere] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [mustPickName, setMustPickNameState] = useState(false);
  const setMustPickName = (value: boolean) => {
    setMustPickNameState(value);
    try {
      if (value) localStorage.setItem(PICK_NAME_KEY, "1");
      else localStorage.removeItem(PICK_NAME_KEY);
    } catch {
      // Asked again if the server resets it again.
    }
  };
  const [swapAnswerId, setSwapAnswerId] = useState<string | null>(null);
  const [nameChangeOpen, setNameChangeOpen] = useState(false);
  // Who this phone is in the app (its locked name, and owner access).
  const [me, setMe] = useState<Me | null>(null);
  const [nameTaken, setNameTaken] = useState<{ name: string; ownerName: boolean } | null>(null);
  const [linkCodeOpen, setLinkCodeOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  /** What the owner screen opens to (from a notification). */
  const [ownerFocus, setOwnerFocus] = useState<{ section: "requests" | "log" | "people"; personId?: string } | null>(null);
  const [seenPosts, setSeenPosts] = useState<string[]>([]);
  useEffect(() => {
    const seen = loadSeenPosts();
    const key = loadTeamKey();
    let wasBlocked = false;
    let pickName = false;
    try {
      wasBlocked = localStorage.getItem(BLOCKED_KEY) === "1";
      pickName = localStorage.getItem(PICK_NAME_KEY) === "1";
    } catch {
      // Checked again with the server below.
    }
    queueMicrotask(() => {
      setSeenPosts(seen);
      setTeamKey(key);
      setBlockedHere(wasBlocked);
      setMustPickNameState(pickName);
    });
  }, []);
  const setBlocked = (value: boolean) => {
    setBlockedHere(value);
    try {
      if (value) localStorage.setItem(BLOCKED_KEY, "1");
      else localStorage.removeItem(BLOCKED_KEY);
    } catch {
      // The server says so again next check.
    }
  };
  const teamPosts = me?.posts ?? [];
  const team = useMemo<Team | null>(() => me && teamKey
    ? { name: "everyone", key: teamKey, memberId: me.personId, people: me.crew ?? [], ownerId: me.owner ? me.personId : undefined, roster: me.roster }
    : null, [me, teamKey]);
  // Sending to the team is up to the owner: everyone else only receives.
  const sendTeam = me?.canShare ? team : null;
  // Team notifications you've dealt with (imported, already had, or answered) leave the bell.
  const [dismissedPosts, setDismissedPosts] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(DISMISSED_POSTS_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        const ids = saved.filter((id): id is string => typeof id === "string");
        queueMicrotask(() => setDismissedPosts(ids));
      }
    } catch {
      // Shown again; nothing lost.
    }
  }, []);
  const dismissPosts = (ids: string[]) => {
    if (ids.every((id) => dismissedPosts.includes(id))) return;
    setDismissedPosts((current) => {
      const next = [...new Set([...current, ...ids])].slice(-300);
      try {
        localStorage.setItem(DISMISSED_POSTS_KEY, JSON.stringify(next));
      } catch {
        // Kept for this visit.
      }
      return next;
    });
    pushStateSoon();
  };
  const markPostsSeen = (ids: string[]) => {
    if (ids.every((id) => seenPosts.includes(id))) return;
    setSeenPosts((current) => {
      const next = [...new Set([...current, ...ids])];
      saveSeenPosts(next);
      return next;
    });
    pushStateSoon();
  };
  // Swap requests sent by email or text, and their answers.
  const [sentSwaps, setSentSwaps] = useState<SentSwap[]>([]);
  useEffect(() => {
    const saved = loadSentSwaps();
    queueMicrotask(() => setSentSwaps(saved));
  }, []);
  const updateSentSwaps = (update: (current: SentSwap[]) => SentSwap[]) => {
    setSentSwaps((current) => {
      const next = update(current);
      if (next !== current) saveSentSwaps(next);
      return next;
    });
  };
  const saveContacts = (next: Contacts) => {
    setContacts(next);
    try {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
    } catch {
      // Keep them for this visit.
    }
  };
  const [shiftEditor, setShiftEditor] = useState<{
    mode: "add" | "edit";
    eventId?: string;
    /** A shift on an uploaded schedule: fixing one it read, or adding one it missed. */
    imported?: { hash: string; shift: Shift; adding?: boolean };
  } | null>(null);
  const [shiftDraft, setShiftDraft] = useState<ShiftDraft>({
    date: "2026-07-26",
    start: "09:00",
    end: "17:00",
    title: "Work",
  });
  const [personPrompt, setPersonPrompt] = useState<{
    names: string[];
    resolve: (name: string | null) => void;
  } | null>(null);
  const [importState, setImportState] = useState<
    "idle" | "reading" | "review" | "error"
  >("idle");
  const [importSnapshot, setImportSnapshot] = useState<ImportSnapshot>({
    progress: 0,
    stage: 0,
    detail: "",
  });
  const [scanFile, setScanFile] = useState<ImportPreviewFile | null>(null);
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
  const liveFlights = useLiveFlights(
    calendarServiceUrl(`/api/flights/live?airport=${DEFAULT_PREFS.homeAirport}`),
  );
  const airportAlerts = liveFlights.live?.airportAlerts;
  // Flight learning (the owner's screen) loads in the background so it opens complete.
  const hasLive = Boolean(liveFlights.live);
  const isAppOwner = Boolean(me?.owner);
  useEffect(() => {
    if (hasLive && isAppOwner) void prefetchLearning(calendarServiceUrl("/api/flights/learning"));
  }, [hasLive, isAppOwner]);
  const [dismissedAirportAlerts, setDismissedAirportAlerts] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("shiftdeck.dismissedAirportAlerts") ?? "[]");
      if (Array.isArray(saved)) {
        const dismissed = saved.filter((item): item is string => typeof item === "string");
        queueMicrotask(() => setDismissedAirportAlerts(dismissed));
      }
    } catch {
      // Dismissal still works for the current visit.
    }
  }, []);
  const visibleAirportAlerts = (airportAlerts?.notices ?? []).filter(
    ({ text }) => !dismissedAirportAlerts.includes(text),
  );
  const unseenSwapAnswers = sentSwaps.filter((swap) => swap.status !== "waiting" && !swap.seen).length;
  const airportNoticeCount = visibleAirportAlerts.length;
  const teamInbox = teamPosts.filter((post) => !post.mine && !dismissedPosts.includes(post.id));
  const unseenTeamPosts = teamInbox.filter((post) => !seenPosts.includes(post.id)).length;
  const allOwnerRequests = me?.owner ? (me.requests ?? []).filter((request) => request.personId !== me.personId) : [];
  // Cleared from notifications (still waiting in the owner popup).
  const ownerRequests = allOwnerRequests.filter((request) => !dismissedPosts.includes(`request:${request.id}`));
  const notificationCount = airportNoticeCount + unseenSwapAnswers + unseenTeamPosts + ownerRequests.length;
  // A chosen name is locked; only the app's owner changes names (their own included).
  const nameLocked = Boolean(prefs.person) && !me?.owner;
  const openNotifications = () => airportAlertsDialog.current?.showModal();
  const [notificationsInfo, setNotificationsInfo] = useState(false);
  const dismissAirportAlert = (text: string) => {
    const next = [...dismissedAirportAlerts, text];
    setDismissedAirportAlerts(next);
    try {
      localStorage.setItem("shiftdeck.dismissedAirportAlerts", JSON.stringify(next));
    } catch {
      // Keep the in-memory dismissal when storage is unavailable.
    }
    pushStateSoon();
  };
  // What you dealt with (dismissed, read, closed) goes along with each check-in,
  // and comes back merged with your other phones'.
  // Clear all, with 10 seconds to undo (kept while the popup is closed and opened again).
  // What it cleared isn't sent to your other devices until the 10 seconds are up.
  const [cleared, setCleared] = useState<{ until: number; count: number; dismissed: string[]; alerts: string[]; swaps: SentSwap[] } | null>(null);
  const [clearTick, setClearTick] = useState(0);
  const syncedStateRef = useRef<SyncedState>({ dismissed: [], seen: [], alerts: [] });
  useEffect(() => {
    syncedStateRef.current = {
      dismissed: cleared ? cleared.dismissed : dismissedPosts,
      seen: seenPosts,
      alerts: cleared ? cleared.alerts : dismissedAirportAlerts,
    };
  }, [dismissedPosts, seenPosts, dismissedAirportAlerts, cleared]);

  const adoptSyncedState = (state?: SyncedState) => {
    if (!state) return;
    const add = (current: string[], incoming: string[], limit: number, save: (next: string[]) => void) => {
      const missing = incoming.filter((item) => !current.includes(item));
      if (!missing.length) return current;
      const next = [...current, ...missing].slice(-limit);
      save(next);
      return next;
    };
    const store = (key: string) => (next: string[]) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Comes again with the next check-in.
      }
    };
    setDismissedPosts((current) => add(current, state.dismissed, 300, store(DISMISSED_POSTS_KEY)));
    setSeenPosts((current) => add(current, state.seen, 200, saveSeenPosts));
    setDismissedAirportAlerts((current) => add(current, state.alerts, 100, store("shiftdeck.dismissedAirportAlerts")));
  };
  // Dealt with something: tell your other phones soon, not at the next minute's check-in.
  const [stateChanged, setStateChanged] = useState(0);
  const pushStateSoon = () => setStateChanged((count) => count + 1);
  useEffect(() => {
    if (!cleared) return;
    const timer = window.setInterval(() => {
      if (Date.now() < cleared.until) {
        setClearTick(Date.now());
        return;
      }
      setCleared(null);
      pushStateSoon();
    }, 250);
    return () => window.clearInterval(timer);
  }, [cleared]);
  const airportAlertsDialog = useRef<HTMLDialogElement>(null);
  const notificationsBackdrop = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Android's picker hides the gallery and camera when PDFs are also allowed,
  // so it only offers photos there.
  const android = useSyncExternalStore(subscribeToNothing, isAndroid, () => false);
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
            homeAirport: DEFAULT_PREFS.homeAirport,
            airline: DEFAULT_PREFS.airline,
            flightApp:
              saved.flightApp === "flightradar24" ? "flightradar24" : "flightaware",
            flightTime: saved.flightTime === "landing" ? "landing" : "gate",
            flightAlerts: readFlightAlerts(saved.flightAlerts),
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
          setSelectedDate(workdayAt());
        } catch {
          localStorage.removeItem("shiftdeck.activeDates");
        }
      }
      let restoredShifts: Shift[] = [];
      if (savedParsedShifts) {
        try {
          // Misread and clipped names from older scans ("Ody Hermany") become one person.
          const keepName = (() => {
            try {
              return String(JSON.parse(savedPrefs ?? "{}").person ?? "");
            } catch {
              return "";
            }
          })();
          restoredShifts = tidyScheduleShifts(canonicalizeScheduleShifts(
            (JSON.parse(savedParsedShifts) as Shift[]).filter(
              (shift) =>
                shift &&
                typeof shift.id === "string" &&
                typeof shift.date === "string" &&
                typeof shift.worker === "string" &&
                (shift.workerConfirmed === true || isPlausibleWorkerName(shift.worker)),
            ),
          ), [keepName]);
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
          const sourceDates = new Map(restoredShifts.map((shift) => [shift.id, shift.date]));
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
              fromSchedule: event.fromSchedule ?? sourceDates.get(event.id) === event.date,
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
                // Shared schedules used to be named after the sender ("David’s schedule Nov 8 – 14").
                name: document.name.replace(/^[^’']{1,40}[’']s schedule (?=[A-Z][a-z]{2} \d)/, "Schedule "),
                shifts: canonicalizeScheduleShifts(document.shifts),
              }));
            const keepName = (() => {
              try {
                return String(JSON.parse(localStorage.getItem("shiftdeck.preferences") ?? "{}").person ?? "");
              } catch {
                return "";
              }
            })();
            setScheduleDocuments(tidyScheduleWorkers(documents, [keepName]));
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
    const query = alertPrefs.location.trim();
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
  }, [notificationsOpen, placeMenuOpen, alertPrefs.location]);

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

  const prepareSavedReview = useEffectEvent(async (document: ScheduleDocument) => {
    let sourceLayout = document.review?.sourceLayout;
    let image = await loadScheduleImage(document.id, document.review?.deskewed).catch(() => undefined);
    let recovered: { original: Blob; straightened?: Blob } | undefined;
    if (!sourceLayout && image) {
      const knownNames = [prefs.person, ...document.shifts.map((shift) => shift.worker)];
      const resolveRowName = (name: string) => resolveSchedulePersonName(name, knownNames);
      const parsed = await recoverScheduleSource(image, (name) =>
        nameKey(resolveMergedName(resolveRowName(name), nameMerges)) === nameKey(prefs.person),
      ).catch(() => null);

      if (parsed?.sourceLayout && parsed.dates.join() === document.dates.join()) {
        const layout = parsed.sourceLayout;
        sourceLayout = {
          ...layout,
          rows: layout.rows.map((row) => ({ ...row, name: resolveRowName(row.name) })),
        };
        recovered = { original: image, straightened: parsed.reviewImage };
        image = parsed.reviewImage ?? image;
      }
    }
    return { image, sourceLayout, recovered };
  });

  const finishPreparingReview = useEffectEvent((
    hash: string,
    { recovered, ...prepared }: { image?: Blob; sourceLayout?: ScheduleSourceLayout; recovered?: { original: Blob; straightened?: Blob } },
  ) => {
    const activeHashes = new Set(scheduleDocuments.map((document) => document.hash));
    setPreparedReviews((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key]) => activeHashes.has(key)));
      if (activeHashes.has(hash)) next[hash] = prepared;
      return next;
    });
    // Rows found again are kept (with the straightened copy they match), so they're not
    // looked for every time, and go along when this schedule is sent.
    const document = scheduleDocuments.find((item) => item.hash === hash);
    if (!recovered || !prepared.sourceLayout || !document || isSchedulePdf(document)) return;
    const keep = () => setScheduleDocuments((current) => current.map((item) => item.hash === hash
      ? { ...item, review: { ...item.review, sourceLayout: prepared.sourceLayout, deskewed: Boolean(recovered.straightened) || Boolean(item.review?.deskewed) } }
      : item));
    if (recovered.straightened) {
      void saveScheduleImage(document.id, recovered.original, recovered.straightened).then(keep, () => undefined);
    } else {
      keep();
    }
  });

  useEffect(() => {
    if (!backgroundHydrated || importState === "reading" || preparingReview.current) return;
    const remaining = scheduleDocuments.filter(
      (document) => !isSchedulePdf(document) && !preparedReviews[document.hash],
    );
    const next = remaining.find((document) => document.hash === openReviewHash) ??
      remaining.find((document) => document.review?.sourceLayout) ?? remaining[0];
    if (!next) return;

    preparingReview.current = true;
    void prepareSavedReview(next).catch(() => ({})).then((prepared) => {
      preparingReview.current = false;
      finishPreparingReview(next.hash, prepared);
    });
  }, [backgroundHydrated, importState, openReviewHash, preparedReviews, scheduleDocuments]);

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
      ...baseImportedShifts
        .filter((shift) => shift.worker !== prefs.person)
        .map((shift) => ({ ...shift, date: shiftCalendarDate(shift, true) })),
      ...events.map<Shift>((event) => ({
        id: event.id,
        date: eventCalendarDate(event),
        worker: prefs.person,
        start: event.start,
        end: event.end,
        status: "working",
      })),
    ],
    [baseImportedShifts, events, prefs.person],
  );

  const todayDate = workdayAt(clockNow);
  const liveSwapReplies = [...sentSwaps]
    .filter((swap) => swap.status !== "cancelled" && isLiveSwap(swap, todayDate))
    .reverse();

  const storeList = (key: string, next: string[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Kept for this visit.
    }
  };
  const notificationsShown = teamInbox.length + ownerRequests.length + liveSwapReplies.length + airportNoticeCount;
  /** Everything in Notifications: coworkers' shares and swap invites, name changes, swap replies, airport alerts. */
  const clearAllNotifications = () => {
    if (!notificationsShown) return;
    const ids = [...teamInbox.map((post) => post.id), ...ownerRequests.map((request) => `request:${request.id}`)];
    const swapIds = new Set(liveSwapReplies.map((swap) => swap.id));
    setCleared({
      until: Date.now() + 10_000,
      count: notificationsShown,
      dismissed: cleared?.dismissed ?? dismissedPosts,
      alerts: cleared?.alerts ?? dismissedAirportAlerts,
      swaps: cleared?.swaps ?? sentSwaps,
    });
    setClearTick(Date.now());
    const dismissed = [...new Set([...dismissedPosts, ...ids])].slice(-300);
    setDismissedPosts(dismissed);
    storeList(DISMISSED_POSTS_KEY, dismissed);
    const alerts = [...new Set([...dismissedAirportAlerts, ...visibleAirportAlerts.map((alert) => alert.text)])].slice(-100);
    setDismissedAirportAlerts(alerts);
    storeList("shiftdeck.dismissedAirportAlerts", alerts);
    updateSentSwaps((current) => current.filter((swap) => !swapIds.has(swap.id)));
  };
  const undoClearNotifications = () => {
    if (!cleared) return;
    setDismissedPosts(cleared.dismissed);
    storeList(DISMISSED_POSTS_KEY, cleared.dismissed);
    setDismissedAirportAlerts(cleared.alerts);
    storeList("shiftdeck.dismissedAirportAlerts", cleared.alerts);
    updateSentSwaps(() => cleared.swaps);
    setCleared(null);
  };
  const clearSecondsLeft = cleared ? Math.max(0, Math.ceil((cleared.until - clearTick) / 1000)) : 0;

  // Check for swap answers while any request is still live: on open, when the
  // app comes back to the foreground, and once a minute.
  const hasLiveSwaps = sentSwaps.some((swap) => isLiveSwap(swap, todayDate));
  const sentSwapsRef = useRef(sentSwaps);
  useEffect(() => {
    sentSwapsRef.current = sentSwaps;
  }, [sentSwaps]);
  useEffect(() => {
    if (!hasLiveSwaps) return;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const live = sentSwapsRef.current.filter((swap) => isLiveSwap(swap, todayDate));
      try {
        const statuses = await fetchSwapStatuses(calendarServiceUrl(""), live);
        if (!cancelled && statuses.size) updateSentSwaps((current) => mergeSwapStatuses(current, statuses));
      } catch {
        // Try again next time.
      }
    };
    void check();
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
    // updateSentSwaps only uses state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveSwaps, todayDate]);

  const openIncomingShare = (key: ShareKey, postId?: string) => {
    setIncoming({ share: null, error: "", postId });
    openShareLink(key, CALENDAR_SERVICE_ORIGIN)
      .then((share) => setIncoming((current) => current && { ...current, share }))
      .catch((problem: unknown) => setIncoming((current) => current && {
        ...current,
        error: problem instanceof Error ? problem.message : "The share couldn’t be opened.",
      }));
  };

  // Old team invite links (?team=…#t=…) just open the app now: everyone's on one team.
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("team")) return;
    url.searchParams.delete("team");
    url.hash = "";
    window.history.replaceState(null, "", url.href);
  }, [hydrated]);

  // Checks the team for new posts every minute while the app is open (and links notifications).
  const profileRef = useRef(notificationProfile);
  useEffect(() => {
    profileRef.current = notificationProfile;
  }, [notificationProfile]);
  // The names on this phone's schedules, for the team's "pick your name" list.
  const rosterRef = useRef<string[]>([]);
  // For the team check: the name in use, and a way to update it.
  const personRef = useRef(prefs.person);
  const savePrefsRef = useRef<(next: Partial<Preferences>) => void>(() => undefined);
  // Who this phone is: registers its name the first time, then keeps its locked
  // name (set by the app's owner) and owner access up to date.
  const meProfile = () => (notificationPermission === "granted" ? notificationProfile : null);
  /** What every check-in carries: notifications, this phone's public key, schedule names, proof of the team key. */
  const checkIn = async (extra?: { keyProof?: string; badWrap?: boolean }) => {
    const pair = await devicePair();
    const key = loadTeamKey();
    return {
      profile: meProfile(),
      publicKey: publicKeyText(pair),
      roster: rosterRef.current,
      state: syncedStateRef.current,
      ...(key ? { keyProof: await keyProof(key) } : {}),
      ...extra,
    };
  };
  /** Gets the team key if this phone doesn't have it, and passes it on to phones waiting for it. */
  const settleTeamKey = async (result: Me) => {
    const check = result.key?.check ?? null;
    let key = loadTeamKey();
    if (key && check && await keyCheck(key) !== check) key = null;
    let fresh = false;
    let badWrap = false;
    if (!key) {
      const legacy = legacyTeamKey();
      if (!check && result.owner) {
        // The owner's phone sets the key once (keeping the old team's, so what was sent still opens).
        key = legacy ?? newTeamKey();
        fresh = true;
      } else if (check && legacy && await keyCheck(legacy) === check) {
        key = legacy;
        fresh = true;
      } else if (check && result.key?.wrapped) {
        const opened = await unwrapTeamKey(result.key.wrapped, await devicePair());
        if (opened && await keyCheck(opened) === check) {
          key = opened;
          fresh = true;
        } else {
          badWrap = true;
        }
      }
    }
    saveTeamKey(key);
    setTeamKey(key);
    if (key) forgetLegacyTeam();
    if (key && result.key?.wrapFor?.length) {
      const pair = await devicePair();
      const wraps = await Promise.all(result.key.wrapFor.map(async (phone) => ({
        deviceId: phone.deviceId,
        data: await wrapTeamKey(key!, phone.publicKey, pair).catch(() => ""),
      })));
      await sendWrappedKeys(CALENDAR_SERVICE_ORIGIN, wraps.filter((wrap) => wrap.data)).catch(() => undefined);
    }
    return { fresh, badWrap };
  };
  /** Checks in. Says how it went: "ok", "taken" (someone else's name), or "failed". */
  /**
   * Checks in (registering this phone the first time). A new phone sends its
   * typed name (`typed`), which the server matches to a known name.
   */
  const refreshMe = async (known?: string, typed?: { first: string; last: string; exact: boolean }): Promise<NameAttempt> => {
    const name = known ?? personRef.current;
    if (!name && !typed) {
      setMe(null);
      return "failed";
    }
    try {
      let result = await syncMe(CALENDAR_SERVICE_ORIGIN, name, { ...await checkIn(), ...typed });
      const { fresh, badWrap } = await settleTeamKey(result);
      // Tell the server right away that this phone has the key now (or that what it got didn't open).
      if (fresh || badWrap) result = await syncMe(CALENDAR_SERVICE_ORIGIN, name, await checkIn(badWrap ? { badWrap: true } : undefined));
      setMe(result);
      adoptSyncedState(result.state);
      setBlocked(false);
      setMustPickName(false);
      setNameTaken(null);
      // The name the server has. Only a real change is saved: the same name spelled the way this
      // device tidies it ("David LaBarre" vs "David Labarre") isn't, or it'd flip back and forth on every open.
      if (result.name && canonicalSchedulePersonName(result.name) !== canonicalSchedulePersonName(personRef.current)) {
        savePrefsRef.current({ person: result.name });
      }
      return "ok";
    } catch (problem) {
      if (problem instanceof NameTakenError) {
        setNameTaken({ name: problem.takenName, ownerName: problem.ownerName });
        return "taken";
      }
      if (problem instanceof SuggestNameError) return { suggest: problem.suggest };
      if (problem instanceof UnknownNameError) return { unknown: problem.typed };
      if (problem instanceof BlockedError) {
        setMe(null);
        setBlocked(true);
        saveTeamKey(null);
        setTeamKey(null);
      }
      if (problem instanceof PhoneResetError) {
        // The owner took this phone off the app: nothing until a name is picked.
        setMe(null);
        savePrefsRef.current({ person: "" });
        setMustPickName(true);
      }
      return "failed";
    }
  };
  const refreshMeRef = useRef(refreshMe);
  useEffect(() => {
    refreshMeRef.current = refreshMe;
  });
  useEffect(() => {
    if (!stateChanged) return;
    const timer = window.setTimeout(() => void refreshMeRef.current(), 1500);
    return () => window.clearTimeout(timer);
  }, [stateChanged]);
  const syncedName = hydrated ? prefs.person : "";
  useEffect(() => {
    if (!syncedName) return;
    const check = () => {
      if (document.visibilityState === "visible") void refreshMeRef.current(syncedName);
    };
    check();
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [syncedName, notificationProfile?.id]);

  const sendToTeam = async (share: SharePackage, what: string, to?: string[]) => {
    if (!team) throw new Error("This device is still getting the team key. Try again in a minute.");
    const result = await postToTeam(CALENDAR_SERVICE_ORIGIN, team, share, what, to);
    markPostsSeen([result.id]);
    return result.notified;
  };
  /** After an import: sends just that (schedule weeks, the directory, or contacts) to the team. */
  const sendImportToTeam = async (part: { documentIds?: string[]; directory?: boolean; contacts?: boolean }, to?: string[]) => {
    const { share, what } = await buildShare({
      documents: scheduleDocuments.filter((document) => part.documentIds?.includes(document.id)),
      directory: part.directory ? directory : undefined,
      contacts: part.contacts ? contacts : undefined,
      person: prefs.person,
      loadFile: (id, straightened) => loadScheduleImage(id, straightened),
    });
    return sendToTeam(share, what, to);
  };

  // Focus rings are for keyboards: a tap that opens a popup (which moves focus
  // to its first button) shouldn't draw one. Tab brings them back.
  useEffect(() => {
    const root = document.documentElement;
    const pointer = (event: PointerEvent) => {
      root.dataset.input = event.pointerType === "mouse" ? "mouse" : "touch";
    };
    const key = (event: KeyboardEvent) => {
      if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key) &&
        !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        root.dataset.input = "keyboard";
      }
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);

  // Tapping a notification opens the app at ?open=<where> (older ones: ?notifications=1):
  //   notifications · home · day:<date> · settings · handover · post:<id>
  //   owner:requests · owner:log · owner:person:<id>
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    const open = url.searchParams.get("open") ?? (url.searchParams.has("notifications") ? "notifications" : null);
    if (!open) return;
    url.searchParams.delete("open");
    url.searchParams.delete("notifications");
    window.history.replaceState(null, "", url.href);
    queueMicrotask(() => setLinkTarget(open));
  }, [hydrated]);
  // Some places need this phone's check-in (owner screen, a team post) first;
  // if that never comes (offline), the notifications list opens instead.
  useEffect(() => {
    if (!linkTarget) return;
    const timer = window.setTimeout(() => {
      setLinkTarget(null);
      airportAlertsDialog.current?.showModal();
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [linkTarget]);
  useEffect(() => {
    if (!linkTarget) return;
    const [kind, ...rest] = linkTarget.split(":");
    const value = rest.join(":");
    const finish = (then?: () => void) => queueMicrotask(() => {
      setLinkTarget(null);
      then?.();
    });
    if (kind === "home") return finish();
    if (kind === "notifications") return finish(() => airportAlertsDialog.current?.showModal());
    if (kind === "day") return finish(() => /^\d{4}-\d\d-\d\d$/.test(value) && setSelectedDate(value));
    if (kind === "flight") {
      // A flight alert: today's Flights, that flight highlighted and scrolled to.
      return finish(() => {
        setSelectedDate(workdayAt(new Date()));
        setMapPicked(value);
        window.setTimeout(() => {
          document.querySelector(`[data-live-flight~="${CSS.escape(value)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 700);
        window.setTimeout(() => setMapPicked((current) => (current === value ? null : current)), 15_000);
      });
    }
    if (kind === "settings") {
      return finish(() => {
        setSettingsOpen(true);
      });
    }
    if (!me) return; // Wait for the check-in.
    if (kind === "owner") {
      return finish(() => {
        if (!me.owner) return;
        const [section, id] = value.split(":");
        setOwnerFocus(section === "person" ? { section: "people", personId: id } : { section: section === "log" ? "log" : "requests" });
        setOwnerOpen(true);
      });
    }
    if (kind === "handover") return finish(() => me.handoverOffer && setHandoverOpen(true));
    if (kind === "post") {
      const post = me.posts?.find((item) => item.id === value);
      if (!post) return finish(() => airportAlertsDialog.current?.showModal());
      if (post.kind === "swap") return finish(() => setSwapAnswerId(post.shareId));
      if (!team) return; // The team key arrives with the check-in too.
      return finish(() => {
        markPostsSeen([post.id]);
        openIncomingShare({ id: post.shareId, key: team.key }, post.id);
      });
    }
    finish(() => airportAlertsDialog.current?.showModal());
    // Runs again as the check-in and the team key arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTarget, me, team]);

  // Follow the 5 AM rollover and land on today once saved data is restored.
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
    () => parsedFlights.filter((flight) => importedDateSet.has(flight.date)).map(importedFlightOnCalendar),
    [importedDateSet, parsedFlights],
  );

  // Everyone on the imported schedules except you, for contacts.
  const contactWorkers = useMemo(() => [...new Set(baseImportedShifts
    .map((shift) => resolveMergedName(shift.worker, nameMerges))
    .filter((worker) => nameKey(worker) !== nameKey(prefs.person) && !isSameSchedulePerson(worker, prefs.person)))],
  [baseImportedShifts, nameMerges, prefs.person]);
  useEffect(() => {
    rosterRef.current = [...new Set([prefs.person, ...contactWorkers].filter(Boolean))];
  }, [contactWorkers, prefs.person]);

  // Swap emails and texts fall back to the Directory for anyone not in contacts.
  const swapContacts = useMemo(() => contactsWithDirectory(contacts, contactWorkers, directory),
    [contactWorkers, contacts, directory]);

  // Who's new, leaving or gone, from the weeks imported (never you).
  // (The React compiler memoizes this.)
  const rosterStatus = new Map([...rosterStatuses(baseImportedShifts, todayDate)]
    .filter(([name]) => nameKey(name) !== nameKey(prefs.person) && !isSameSchedulePerson(name, prefs.person)));

  const statusOf = (name: string) => {
    const exact = [...rosterStatus].find(([worker]) => nameKey(worker) === nameKey(name));
    return (exact ?? [...rosterStatus].find(([worker]) => isSameSchedulePerson(worker, name)))?.[1];
  };
  // People who've left (a goodbye note, or missing from 2 schedules in a row) drop out of
  // Coworkers and the Directory. Their details stay on the phone: back on a schedule, back in the lists.
  const currentCoworkers = contactWorkers.filter((worker) => !hasLeft(statusOf(worker)));
  const leftCoworkers = contactWorkers.filter((worker) => hasLeft(statusOf(worker)));
  const keptIds = new Set(currentCoworkers.map((worker) => findPerson(directory, worker, contacts[contactKey(worker)]?.email)?.id));
  const hiddenIds = new Set(leftCoworkers
    .map((worker) => findPerson(directory, worker, contacts[contactKey(worker)]?.email)?.id)
    .filter((id): id is string => Boolean(id) && !keptIds.has(id)));
  const shownDirectory = hiddenIds.size ? directory.filter((entry) => !hiddenIds.has(entry.id)) : directory;
  const saveShownDirectory = (next: DirectoryEntry[]) => {
    // Keep the hidden people, unless the edit brought them back in (a re-import).
    const keys = new Set(next.map(entryKey));
    saveDirectory([...next, ...directory.filter((entry) => hiddenIds.has(entry.id) && !keys.has(entryKey(entry)))]);
  };

  // People who've left the schedule aren't offered as names anymore.
  const activeWorkers = Array.from(new Set(importedShifts.map((shift) => shift.worker)))
    .filter((name) => !hasLeft(rosterStatus.get(name)));
  const availableWorkers = activeWorkers.length ? activeWorkers : prefs.person ? [prefs.person] : [];

  const scheduleDates = useMemo(() => [...new Set([
    ...importedDates,
    ...importedShifts.map((shift) => workdayFor(shift.date, shift.start)),
    ...importedFlights.map(flightWorkday),
  ])].sort(), [importedDates, importedShifts, importedFlights]);

  const hasSchedule = scheduleDates.length > 0;
  const dayShifts = useMemo(
    () => importedShifts.filter((shift) =>
      shift.status === "working" && workdayFor(shift.date, shift.start) === selectedDate,
    ),
    [importedShifts, selectedDate],
  );
  const myDayShifts = useMemo(
    () => dayShifts.filter((shift) => shift.worker === prefs.person).sort((a, b) =>
      `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
    ),
    [dayShifts, prefs.person],
  );
  const myShift = selectedDate === todayDate
    ? myDayShifts.find((shift) => clockNow < shiftBounds(shift)[1]) ?? myDayShifts.at(-1)
    : myDayShifts[0];
  const myEvent = events.find((event) => event.id === myShift?.id);

  const myDayStatus = useMemo(() => {
    const statuses = new Map<string, DayStatus>();
    scheduleDates.forEach((date) => statuses.set(date, { status: "off" }));
    baseImportedShifts.forEach((shift) => {
      if (shift.status === "pto" && isSameSchedulePerson(shift.worker, prefs.person)) {
        statuses.set(shift.date, { status: "pto" });
      }
    });
    events.forEach((event) => {
      const date = workdayFor(eventCalendarDate(event), event.start);
      if (statuses.get(date)?.status !== "working") {
        statuses.set(date, { status: "working", start: event.start, end: event.end });
      }
    });
    return statuses;
  }, [baseImportedShifts, events, prefs.person, scheduleDates]);

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
    () => importedFlights.filter((flight) => flightWorkday(flight) === selectedDate),
    [importedFlights, selectedDate],
  );

  const notificationSyncPayload = useMemo<NotificationSyncPayload>(
    () => ({
      title: prefs.title.trim() || DEFAULT_SHIFT_TITLE,
      location: prefs.location.trim(),
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      alerts: prefs.alerts,
      flightAlerts: prefs.flightAlerts,
      flights: (() => {
        // Each Allegiant flight in one of your shifts from today on (a week).
        const today = todayDate;
        const until = new Date(Date.parse(`${today}T12:00:00`) + 8 * 86_400_000).toISOString().slice(0, 10);
        const upcoming = events.filter((event) => event.date >= today && event.date <= until);
        return importedFlights.flatMap((flight) => {
          const ident = flight.trackingId?.toUpperCase().replace(/\s+/g, "").replace(/^AAY/, "G4");
          if (!ident || !/^G4\d+$/.test(ident)) return [];
          const shift = upcoming.find((event) => isFlightInShift(flight, { ...event, worker: prefs.person, status: "working" } as Shift, 45));
          if (!shift) return [];
          const kind = flight.kind === "departure" ? "departure" as const : "arrival" as const;
          const time = flightTime(flight);
          return [{ ident, kind, at: new Date(`${flight.date}T${time}:00`).toISOString() }];
        }).slice(0, 120);
      })(),
      events: events
        .map((event) => {
          const date = eventCalendarDate(event);
          return {
            key: event.calendarKey,
            date,
            start: event.start,
            end: event.end,
            startAt: eventStartAt(date, event.start),
            title: event.customTitle
              ? event.title.trim() || DEFAULT_SHIFT_TITLE
              : prefs.title.trim() || DEFAULT_SHIFT_TITLE,
          };
        })
        .sort((first, second) =>
          `${first.date}-${first.start}-${first.key}`.localeCompare(
            `${second.date}-${second.start}-${second.key}`,
          ),
        ),
    }),
    [
      events,
      importedFlights,
      prefs.alerts,
      prefs.flightAlerts,
      prefs.location,
      prefs.person,
      prefs.title,
      todayDate,
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
          date: eventCalendarDate(event),
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

  const openSheet = (next: Exclude<Sheet, null>, options?: { scan?: boolean }) => {
    if (next === "import") {
      setImportComparisons([]);
      // Starts the reader early, unless nothing needs scanning (a shared schedule that was already read).
      if (options?.scan !== false) void warmScheduleReader().catch(() => undefined);
    }
    setSheet(next);
  };

  const closeSheet = () => {
    if (sheet === "import") {
      setImportComparisons([]);
      setExpandedDocument(null);
      setOpenReviewHash(null);
      if (importState !== "reading") void releaseScheduleReader();
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
        .map((shift) => importedEventFor(shift, prefs.person));
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
    if (next.person && next.person !== prefs.person) {
      setEvents(eventsFor(baseImportedShifts, next.person));
    }
  };
  useEffect(() => {
    personRef.current = prefs.person;
    savePrefsRef.current = savePrefs;
  });

  const updateNotificationAlert = (
    index: number,
    amount: number,
    unit: number,
  ) => {
    const minutes = Math.max(0, Math.min(10080, Math.round(amount * unit)));
    editAlerts({
      alerts: alertPrefs.alerts.map((current, alertIndex) =>
        alertIndex === index ? minutes : current,
      ),
    });
  };

  const addNotificationAlert = () => {
    if (alertPrefs.alerts.length >= 12) {
      setToast("You can add up to 12 alerts per shift");
      return;
    }
    const next = [30, 60, 120, 1440, 15, 0].find(
      (minutes) => !alertPrefs.alerts.includes(minutes),
    );
    editAlerts({ alerts: [...alertPrefs.alerts, next ?? 30] });
  };

  const removeNotificationAlert = (index: number) => {
    if (alertPrefs.alerts.length === 1) return;
    editAlerts({
      alerts: alertPrefs.alerts.filter((_, alertIndex) => alertIndex !== index),
    });
  };

  const updateCoordinateDraft = (value: string) => {
    setCoordinateDraft(value);
    const coordinate = parseCoordinatePair(value);
    editAlerts({
      location:
        coordinate && !alertPrefs.location.trim() ? "Pinned location" : alertPrefs.location,
      locationLat: coordinate?.latitude ?? null,
      locationLon: coordinate?.longitude ?? null,
    });
  };

  const changeTheme = (nextTheme: "light" | "dark") => {
    if (nextTheme === theme) return;
    localStorage.setItem("shiftdeck.theme", nextTheme);
    setTheme(nextTheme);
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

  const openEditShift = (id: string) => {
    const event = events.find((event) => event.id === id);
    if (!event) return;
    setShiftDraft({
      date: event.date,
      start: event.start,
      end: event.end,
      title: event.customTitle
        ? event.title
        : DEFAULT_SHIFT_TITLE,
    });
    setShiftEditor({ mode: "edit", eventId: event.id });
  };

  const openImportedShift = (photo: ImportComparison, shift: Shift) => {
    const original = photo.shifts.find((candidate) => candidate.id === shift.id) ??
      photo.shifts.find((candidate) =>
        candidate.status === "working" && candidate.date === shift.date &&
        candidate.start === shift.start && candidate.end === shift.end &&
        nameKey(resolveMergedName(candidate.worker, nameMerges)) === nameKey(shift.worker),
      );
    if (!original) return;

    const event = events.find((candidate) => candidate.id === original.id) ??
      events.find((candidate) => candidate.date === shift.date &&
        candidate.start === shift.start && candidate.end === shift.end);
    setShiftDraft({
      date: shift.date,
      start: shift.start,
      end: shift.end,
      title: event?.customTitle ? event.title : DEFAULT_SHIFT_TITLE,
    });
    setShiftEditor({ mode: "edit", eventId: event?.id, imported: { hash: photo.hash, shift: original } });
  };

  /** A shift the scanner missed: added to that schedule, at your usual hours on it. */
  const addImportedShift = (photo: ImportComparison, date: string) => {
    const mine = photo.shifts.filter((shift) =>
      nameKey(resolveMergedName(shift.worker, nameMerges)) === nameKey(prefs.person));
    const usual = [...mine.filter((shift) => shift.status === "working").reduce((counts, shift) => {
      const key = `${shift.start}|${shift.end}`;
      return counts.set(key, (counts.get(key) ?? 0) + 1);
    }, new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0].split("|");
    const [start, end] = usual ?? ["09:00", "17:00"];
    const worker = mine[0]?.worker ?? prefs.person;
    setShiftDraft({ date, start, end, title: DEFAULT_SHIFT_TITLE });
    setShiftEditor({
      mode: "add",
      imported: {
        hash: photo.hash,
        adding: true,
        shift: { id: `${date}-${worker}-added`, date, worker, start, end, status: "working", workerConfirmed: true },
      },
    });
  };

  const hashFile = async (file: File) => {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const loadParsedSchedules = (
    schedules: ParsedSchedule[], confirmedDaysOff: Set<string>, person = prefs.person,
  ) => {
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
          person &&
          (nameKey(resolveMergedName(shift.worker, nameMerges)) === nameKey(person) ||
            isSameSchedulePerson(shift.worker, person)) &&
          shift.status === "working" &&
          detectedDates.includes(shift.date),
      )
      .map((shift) => importedEventFor(shift, person));
    if (matching.length || confirmedDaysOff.size) {
      setEvents((current) => {
        const untouched = current.filter((event) => matching.length
          ? !detectedDateSet.has(event.date)
          : !confirmedDaysOff.has(event.date) || event.id.startsWith("manual-"));
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
    setParsedShifts(tidyScheduleShifts(nextParsedShifts, [person]));
    setParsedFlights(nextParsedFlights);
    setImportedDates(nextDates);
    localStorage.setItem("shiftdeck.activeDates", JSON.stringify(nextDates));
    return matching.length;
  };

  const processFiles = async (
    files: File[],
    options?: {
      person?: string;
      fromShare?: boolean;
      reads?: Array<SharedRead | undefined>;
      /** From your other phone: keep its photo fingerprints (the copy sent was re-encoded). */
      hashes?: Array<string | undefined>;
      /** No "Schedule imported" screen or toast (your other phone's schedules, picked up quietly). */
      quiet?: boolean;
    },
  ): Promise<boolean> => {
    if (!files.length || importState === "reading") return false;
    setJustImported([]);
    const importedIds: string[] = [];
    setImportState("reading");
    setImportMessage("");
    setImportWarnings([]);
    setDuplicateNotice("");
    setLoadedFiles(files.map((file) => file.name));
    setImportComparisons([]);
    setOpenReviewHash(null);
    const progress = createImportProgress(files.length, setImportSnapshot);
    setImportSnapshot(progress.snapshot());

    const parsedSchedules: ParsedSchedule[] = [];
    const confirmedDaysOff = new Set<string>();
    const skippedFiles: string[] = [];
    const comparisons: ImportComparison[] = [];
    let nextDocuments = [...scheduleDocuments];
    let updatedDocuments = 0;
    // Whose schedule this is. A new device asks once, during the first photo.
    let person = options?.person ?? prefs.person;
    let personSkipped = false;
    const knownNames = [
      prefs.person,
      ...parsedShifts.map((shift) => shift.worker),
      ...scheduleDocuments.flatMap((document) =>
        document.shifts.map((shift) => shift.worker),
      ),
    ];
    // What each person worked on the same weekday in the other imported
    // weeks (newest first), used to double-check freshly read times.
    const pastShifts = canonicalizeScheduleShifts([
      ...scheduleDocuments.filter((document) => !isSchedulePdf(document)).flatMap((document) => document.shifts),
      ...parsedShifts,
    ]).filter((shift) => shift.status === "working");
    const shiftHistory = (name: string, date: string) => {
      const person = nameKey(resolveMergedName(resolveSchedulePersonName(name, knownNames), nameMerges));
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const seen = new Set<string>();
      return pastShifts
        .filter((shift) => shift.date !== date &&
          Math.abs(daysBetween(shift.date, date)) <= 8 * 7 &&
          new Date(`${shift.date}T12:00:00`).getDay() === weekday &&
          nameKey(resolveMergedName(shift.worker, nameMerges)) === person)
        .sort((a, b) => b.date.localeCompare(a.date))
        .filter((shift) => !seen.has(shift.date) && Boolean(seen.add(shift.date)))
        .map(({ start, end }) => ({ start, end }));
    };

    const allowScanMotion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finishScanPreview = async () => {
      progress.finish();
      if (allowScanMotion && sheetRef.current === "import") {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 260));
      }
    };

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        progress.detail(
          files.length > 1 ? `${file.name} · ${index + 1} of ${files.length}` : file.name,
        );

        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (android && !isPdf && isHeic(file)) {
          skippedFiles.push(`${file.name} (HEIC photos can’t be read in Android browsers — send it as a JPG or screenshot it)`);
          continue;
        }
        setScanFile({ index, name: file.name, pdf: isPdf, stage: isPdf ? 1 : 0, image: isPdf ? undefined : file });
        let lastPreviewFrame = frameClock();
        const updateScanFile = (patch: Partial<ImportPreviewFile>) => {
          if (patch.image || patch.pass) lastPreviewFrame = frameClock();
          setScanFile((current) => current?.index === index ? { ...current, ...patch } : current);
        };
        const shiftReads: ScanMark[] = [];
        let scan: ScanPreviewPass | undefined;
        try {
          // A schedule a coworker sent comes with what their phone read: use it, no scan.
          const shared = options?.reads?.[index];
          const sourceRowMatcher = (name: string) => Boolean(person) && nameKey(resolveMergedName(
            resolveSchedulePersonName(name, knownNames),
            nameMerges,
          )) === nameKey(person);
          const sharedRead: ScheduleRead | null = shared?.dates?.length === 7 && !isPdf &&
            shared.parserVersion <= SCHEDULE_PARSER_VERSION && (shared.shifts.length || shared.flights.length)
            ? {
                dates: shared.dates,
                shifts: shared.shifts,
                flights: shared.flights,
                confidence: 90,
                warnings: [],
                sourceLayout: shared.sourceLayout,
              }
            : null;
          if (sharedRead && !sharedRead.sourceLayout) {
            // Sent without its rows (an older import on their phone): find them here,
            // keeping what their phone read, so "Your shifts vs. the photo" has rows to show.
            progress.stage(1);
            updateScanFile({ stage: 1 });
            const found = await recoverScheduleSource(file, sourceRowMatcher, (pass) => updateScanFile({ pass })).catch(() => null);
            if (found?.sourceLayout && found.dates.join() === sharedRead.dates.join()) {
              sharedRead.sourceLayout = found.sourceLayout;
              if (found.reviewImage) sharedRead.reviewImage = found.reviewImage;
              if (found.scan) sharedRead.scan = found.scan;
            }
          }
          if (sharedRead) {
            progress.stage(2);
            updateScanFile({ stage: 2 });
          }
          const [hash, read] = await Promise.all([
            options?.hashes?.[index] ?? hashFile(file),
            sharedRead ? Promise.resolve(sharedRead) : isPdf
              ? (progress.stage(1), parseCharterPdf(file, (image) => updateScanFile({ image })))
              : readScheduleImage(file, {
                  knownNames,
                  matchesSourceRow: sourceRowMatcher,
                  choosePerson: person || personSkipped ? undefined : async (names) => {
                    const chosen = await new Promise<string | null>((resolve) =>
                      setPersonPrompt({ names, resolve }));
                    setPersonPrompt(null);
                    if (!chosen) {
                      personSkipped = true;
                      return;
                    }
                    person = canonicalSchedulePersonName(chosen);
                    knownNames.push(person);
                    setPrefs((current) => ({ ...current, person }));
                  },
                  onFraction: (fraction) => progress.file(index, fraction),
                  onReading: () => {
                    progress.stage(1);
                    updateScanFile({ stage: 1 });
                  },
                  onDoubleCheck: () => {
                    progress.stage(2);
                    updateScanFile({ stage: 2 });
                  },
                  onPass: (pass) => {
                    shiftReads.push(...pass.marks.filter((mark) => mark.shift));
                    if (pass.marks.length && (pass.grid || !scan?.grid)) scan = pass;
                    updateScanFile({ pass });
                  },
                  history: shiftHistory,
                }),
          ]);
          progress.file(index, 1);
          const finalScan = isPdf ? undefined : (read as ScheduleRead | null)?.scan;
          if (finalScan) scan = finalScan;
          const scanDates = scan?.dates;
          let parsed: ParsedSchedule | null = read ?? (scanDates?.length ? {
            dates: scanDates, shifts: [], flights: [], confidence: 0, warnings: [],
          } : null);

          if (!parsed) {
            skippedFiles.push(file.name);
            continue;
          }

          const sourceLayout = parsed.sourceLayout && {
            ...parsed.sourceLayout,
            rows: parsed.sourceLayout.rows.map((row) => ({
              ...row,
              name: resolveSchedulePersonName(row.name, knownNames),
            })),
          };
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
          const resolvedWorker = (name: string) => resolveSchedulePersonName(name, knownNames);
          if (!read && !parsed.flights.length) {
            skippedFiles.push(file.name);
            continue;
          }
          const hasWorkHours = parsed.shifts.some((shift) => shift.status === "working");
          const hasFlights = parsed.flights.length > 0;
          parsed = {
            ...parsed,
            warnings: parsed.warnings.filter((warning) =>
              !(hasWorkHours && warning.startsWith("No work hours")) &&
              !(hasFlights && warning.startsWith("No flight rows"))),
          };
          parsedSchedules.push(parsed);

          const replacementIndex = nextDocuments.findIndex((document) =>
            isScheduleRevision(document.dates, parsed.dates),
          );
          const replacement =
            replacementIndex >= 0 ? nextDocuments[replacementIndex] : null;
          const now = new Date().toISOString();
          const documentId = replacement?.id ?? `schedule-${hash.slice(0, 20)}`;
          const reviewImage = read && "reviewImage" in read && read.reviewImage instanceof Blob
            ? read.reviewImage
            : undefined;
          // The final scan carries one combined verdict per cell; without it,
          // a time counts as clear when any pass read it clearly.
          const verdictMarks = finalScan?.marks ?? shiftReads;
          const shiftConfidence = new Map<string, boolean>();
          for (const mark of verdictMarks) {
            if (!mark.shift || !mark.worker) continue;
            const key = `${mark.shift.date}|${resolvedWorker(mark.worker)}|${mark.shift.start}|${mark.shift.end}`;
            shiftConfidence.set(key, Boolean(shiftConfidence.get(key)) || scanConfidence(mark) === "confident");
          }
          // A shared read says which times its phone wasn't sure of (by the names it used).
          const sharedUnsure = new Set((shared?.uncertain ?? []).map((key) => {
            const [date, worker, start] = key.split("|");
            return `${date}|${resolvedWorker(worker)}|${start}`;
          }));
          const uncertainShifts = parsed.shifts.filter((shift) =>
            shiftConfidence.get(`${shift.date}|${shift.worker}|${shift.start}|${shift.end}`) === false ||
            sharedUnsure.has(`${shift.date}|${shift.worker}|${shift.start}`),
          ).map((shift) => shift.id);
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
            review: isPdf ? undefined : { sourceLayout, deskewed: Boolean(reviewImage), uncertainShifts },
          };
          importedIds.push(documentId);
          if (replacement) {
            nextDocuments[replacementIndex] = nextDocument;
            updatedDocuments += 1;
            if (expandedDocument === documentId) setExpandedDocument(null);
          } else {
            nextDocuments.push(nextDocument);
          }
          if (!isPdf) {
            comparisons.push({
              hash,
              name: file.name,
              dates: parsed.dates,
              shifts: parsed.shifts,
              image: reviewImage ?? file,
              sourceLayout,
              uncertainShifts,
            });
          }
          await saveScheduleImage(documentId, file, reviewImage, scan).catch(() => undefined);
        } catch {
          skippedFiles.push(file.name);
        } finally {
          const remaining = 230 - (frameClock() - lastPreviewFrame);
          if (remaining > 0 && index < files.length - 1 && allowScanMotion && sheetRef.current === "import") {
            await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
          }
        }
      }

      progress.stage(3);
      if (!parsedSchedules.length) {
        await finishScanPreview();
        setImportMessage(
          "No names, work hours, or flights could be read. Try a sharper, straight-on photo of the schedule.",
        );
        setImportState(options?.quiet ? "idle" : "error");
        return false;
      }

      const count = loadParsedSchedules(parsedSchedules, confirmedDaysOff, person);
      nextDocuments = tidyScheduleWorkers(nextDocuments, [person]).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      setScheduleDocuments(nextDocuments);
      setPreparedReviews((current) => {
        const activeHashes = new Set(nextDocuments.map((document) => document.hash));
        const next = Object.fromEntries(Object.entries(current).filter(([key]) => activeHashes.has(key)));
        for (const { hash, image, sourceLayout } of comparisons) {
          if (activeHashes.has(hash)) next[hash] = { image, sourceLayout };
        }
        return next;
      });
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
      await finishScanPreview();
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
      if (sheetRef.current === "import") setImportComparisons(comparisons);
      // Offer to send what was just imported to the team (not what came from it).
      if (!options?.fromShare) setJustImported([...new Set(importedIds)]);
      if (options?.quiet) {
        setImportState("idle");
        return true;
      }
      setImportState("review");
      setToast("Schedule imported");
      return true;
    } catch {
      await finishScanPreview();
      setImportState(options?.quiet ? "idle" : "error");
      setImportMessage(
        "The readable schedule details couldn’t be saved. Please try again.",
      );
      return false;
    } finally {
      setScanFile(null);
      if (sheetRef.current !== "import") void releaseScheduleReader();
    }
  };


  const importShared = ({ directory: nextDirectory, contacts: nextContacts, files, reads, summary, person }: SharedImport) => {
    // Imported: its team notification is done.
    if (incoming?.postId) dismissPosts([incoming.postId]);
    if (nextDirectory) saveDirectory(nextDirectory);
    if (nextContacts) saveContacts(nextContacts);
    if (person) savePrefs({ person });
    setIncoming(null);
    if (summary.length) setToast(summary.join(" · "));
    if (files.length) {
      // No scan screen when the sender's read (with its rows) comes along.
      const needsScan = files.some((file, index) => !reads?.[index]?.sourceLayout || /pdf$/i.test(file.type));
      openSheet("import", { scan: needsScan });
      // The normal import, ending on "Your shifts vs. the photo".
      // What the sender's phone read comes along, so the scan is skipped.
      void processFiles(files, { person: person || undefined, fromShare: true, reads });
    }
  };

  /** The same worker, after name merges. */
  const sameWorker = (a: string, b: string) =>
    nameKey(resolveMergedName(a, nameMerges)) === nameKey(resolveMergedName(b, nameMerges));
  /** Makes a shift change from your other device here: your shift that day, and the photo it corrects. */
  const applyShiftEdit = (date: string, edit: ShiftEdits<CalendarEvent>[string]) => {
    setEvents((current) => applyEventEdit(current, date, edit));
    if (edit.event) setImportedDates((current) => (current.includes(date) ? current : [...current, date].sort()));
    const fix = edit.fix;
    if (!fix || !scheduleDocuments.some((document) => document.hash === fix.hash)) return;
    setScheduleDocuments((current) => current.map((document) =>
      document.hash === fix.hash ? { ...document, shifts: applyFix(document.shifts, fix, sameWorker) } : document));
    setParsedShifts((current) => applyFix(current, fix, sameWorker));
  };
  /** A photo from your other device, with the fixes you made to it there. */
  const withFixes = <R extends { shifts: Shift[] } | undefined>(read: R, hash: string): R => {
    const fixes = fixesFor(shiftEdits, hash);
    if (!read || !fixes.length) return read;
    return { ...read, shifts: fixes.reduce((shifts, fix) => applyFix(shifts, fix, sameWorker), read.shifts) };
  };
  const processFilesRef = useRef<typeof processFiles | null>(null);
  useEffect(() => {
    processFilesRef.current = processFiles;
  });
  // Your schedules on all your phones (see self-sync.ts): pick up what your other phones
  // imported, then send what they don't have. One post per pass, so each import sees the last.
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle" });
  const [syncPass, setSyncPass] = useState(0);
  const syncBusy = useRef(false);
  const syncApplied = useRef<string[] | null>(null);
  const syncUnsendable = useRef(new Set<string>());
  const myPhones = me?.devices ?? 1;
  // Only while something's happening: "In sync" shows for a moment, then the line goes away.
  const syncWaiting = Boolean(me) && !teamKey && myPhones > 1 && syncStatus.state === "idle" && (me?.selfPosts?.length ?? 0) > 0;
  useEffect(() => {
    if (syncStatus.state !== "synced") return;
    const timer = window.setTimeout(() => setSyncStatus({ state: "idle" }), 3500);
    return () => window.clearTimeout(timer);
  }, [syncStatus]);
  useEffect(() => {
    if (!hydrated || !backgroundHydrated || !me || !prefs.person || importState === "reading" || syncBusy.current) return;
    if (!teamKey) return;
    syncApplied.current ??= loadApplied();
    const applied = new Set(syncApplied.current);
    const posts = me.selfPosts ?? [];
    const have = new Set(scheduleDocuments.map((document) => document.hash));
    const remember = (ids: string[]) => {
      syncApplied.current = [...(syncApplied.current ?? []), ...ids];
      saveApplied(syncApplied.current);
    };
    // Posts with nothing this device doesn't already have are done without a word.
    const nothingNew = posts.filter((post) => !applied.has(post.id) && post.hashes.length > 0 && post.hashes.every((hash) => have.has(hash)));
    // A post that failed a few times (its photos expired, or they don't read) is left alone.
    const givenUp = posts.filter((post) => !applied.has(post.id) && failedTries(post.id) >= POST_TRIES);
    if (nothingNew.length || givenUp.length) {
      remember([...nothingNew, ...givenUp].map((post) => post.id));
      setSyncPass((pass) => pass + 1);
      return;
    }
    const incoming = posts.find((post) => !applied.has(post.id));
    const skip = new Set([...loadSent(), ...loadUnsendable(), ...syncUnsendable.current]);
    const outgoing = myPhones > 1
      ? toSend(scheduleDocuments, posts, todayDate, [...(me.selfHashes ?? []), ...skip])
      : [];
    if (!incoming && !outgoing.length) return;
    syncBusy.current = true;
    void (async () => {
      // The line at the top only shows when something actually moves.
      let shown = false;
      try {
        if (incoming) {
          try {
            setSyncStatus({ state: "getting", what: incoming.what });
            shown = true;
            const share = await openShareLink({ id: incoming.shareId, key: teamKey }, CALENDAR_SERVICE_ORIGIN);
            const schedules = share.manifest.schedules ?? [];
            const take = wanted(schedules.map((schedule) => schedule.hash), schedules.map((schedule) => schedule.dates),
              incoming.createdAt, scheduleDocuments, isScheduleRevision);
            const picked = schedules.flatMap((schedule, index) => take[index] && share.files[index] ? [{ schedule, file: share.files[index] }] : []);
            if (picked.length) {
              const files = picked.map(({ schedule, file }) => new File([file],
                `Schedule ${weekLabel(schedule.dates)}.${schedule.type === "application/pdf" ? "pdf" : schedule.type === "image/png" ? "png" : "jpg"}`,
                { type: schedule.type }));
              const ok = await processFilesRef.current?.(files, {
                person: prefs.person,
                fromShare: true,
                quiet: true,
                reads: picked.map(({ schedule }) => withFixes(schedule.read, schedule.hash)),
                hashes: picked.map(({ schedule }) => schedule.hash),
              });
              if (!ok) throw new Error("Not imported");
              // Shifts changed by hand after that schedule came in on the other device: changed here too
              // (the import just put that week back the way the schedule has it).
              const importedAt = Date.parse(incoming.createdAt);
              for (const { schedule } of picked) {
                for (const date of schedule.dates) {
                  const edit = shiftEdits[date];
                  if (edit && edit.at > importedAt) applyShiftEdit(date, edit);
                }
              }
              setToast(`Got ${incoming.what} from your other device`);
            }
            remember([incoming.id]);
          } catch (problem) {
            noteFailure(incoming.id);
            throw problem;
          }
        } else {
          // Only schedules whose photo is still on this device can go.
          const sendable: typeof outgoing = [];
          for (const document of outgoing) {
            if (await loadScheduleImage(document.id).catch(() => undefined)) sendable.push(document);
            else syncUnsendable.current.add(document.hash);
          }
          rememberUnsendable(outgoing.filter((document) => !sendable.includes(document)).map((document) => document.hash));
          if (sendable.length) {
            setSyncStatus({ state: "sending", what: sendable.length === 1 ? `the ${weekLabel(sendable[0].dates)} schedule` : `${sendable.length} schedules` });
            shown = true;
            const { made, sent } = await sendToMyPhones({
              service: CALENDAR_SERVICE_ORIGIN,
              key: teamKey,
              documents: sendable,
              person: prefs.person,
              loadFile: (id, straightened) => loadScheduleImage(id, straightened),
            });
            // What didn't make it into a post (photo unreadable) isn't tried again.
            const left = sendable.filter((document) => !sent.includes(document.hash)).map((document) => document.hash);
            left.forEach((hash) => syncUnsendable.current.add(hash));
            rememberUnsendable(left);
            remember(made);
            await refreshMeRef.current();
          }
        }
        setSyncStatus(shown ? { state: "synced", at: Date.now() } : { state: "idle" });
        // On to the next post (after a failure, the next check-in, a minute on, tries again).
        setSyncPass((pass) => pass + 1);
      } catch {
        setSyncStatus({ state: "error", at: Date.now() });
      } finally {
        syncBusy.current = false;
      }
    })();
    // processFiles and the loaders read this render's state; these are what start a pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, backgroundHydrated, me, teamKey, scheduleDocuments, importState, syncPass, prefs.person]);

  // Your own things on all your devices (vault.ts): time clock (punches, Paycom sheets, checks,
  // pay settings), your settings, and name merges. Each change is stamped here, then merged with
  // what your other devices saved, item by item.
  const vaultRef = useRef<LocalVault | null>(null);
  const vaultBusy = useRef(false);
  const [vaultTick, setVaultTick] = useState(0);
  useEffect(() => {
    if (!hydrated || !clockData || !personalLoaded) return;
    const local = (vaultRef.current ??= loadLocalVault());
    const defaults: Values = { pref: pickSyncedPrefs(DEFAULT_PREFS), clock: { settings: DEFAULT_SETTINGS } };
    const mine = { ...vaultValuesOf(clockData, prefs, nameMerges, dismissedMerges), contact: contacts, edit: shiftEdits };
    const next = stamp(local.vault, mine, Date.now(), defaults, !local.stamped);
    const changed = stable(next) !== stable(local.vault);
    if (!changed && local.stamped) return;
    vaultRef.current = { ...local, vault: next, stamped: true, dirty: local.dirty || changed };
    saveLocalVault(vaultRef.current);
  }, [hydrated, clockData, prefs, nameMerges, dismissedMerges, contacts, shiftEdits, personalLoaded]);
  const applyVault = (vault: Vault) => {
    const contactsIn = values<Contacts[string]>(vault, "contact");
    setContacts((current) => {
      if (stable(current) === stable(contactsIn)) return current;
      try {
        localStorage.setItem(CONTACTS_KEY, JSON.stringify(contactsIn));
      } catch {
        // In the vault; saved here next time.
      }
      return contactsIn;
    });
    // Shifts changed by hand on your other devices: the same change here.
    const editsIn = values<ShiftEdits<CalendarEvent>[string]>(vault, "edit");
    const newer = newerEdits(shiftEdits, editsIn);
    if (newer.length) {
      for (const date of newer) applyShiftEdit(date, editsIn[date]);
      setShiftEdits((current) => {
        const next = { ...current, ...Object.fromEntries(newer.map((date) => [date, editsIn[date]])) };
        saveShiftEdits(next);
        return next;
      });
    }
    const synced = clockFromVault(vault);
    setClockData((current) => {
      if (!current || stable(sortedClock(current)) === stable(synced)) return current;
      saveClock(synced);
      return synced;
    });
    const prefsIn = values(vault, "pref") as Partial<Preferences>;
    setPrefs((current) => {
      const picked = pickSyncedPrefs(current);
      const next = { ...picked, ...prefsIn };
      return stable(next) === stable(picked) ? current : { ...current, ...prefsIn };
    });
    const merges = values<string>(vault, "merge");
    setNameMerges((current) => (stable(current) === stable(merges) ? current : merges));
    const skipped = Object.keys(values(vault, "mergeSkip")).sort();
    setDismissedMerges((current) => (stable([...current].sort()) === stable(skipped) ? current : skipped));
  };
  const vaultPersonId = me?.personId;
  const serverVault = me?.vaultVersion ?? 0;
  useEffect(() => {
    const local = vaultRef.current;
    if (!local || !vaultPersonId || !teamKey || vaultBusy.current) return;
    if (!local.dirty && serverVault === local.version) return;
    // A moment's wait, so a burst of changes goes up as one save.
    const timer = window.setTimeout(() => {
      vaultBusy.current = true;
      const started = vaultRef.current!;
      void syncVault(started, {
        get: (have) => getVault(CALENDAR_SERVICE_ORIGIN, have),
        put: (data, base) => putVault(CALENDAR_SERVICE_ORIGIN, data, base),
      }, teamKey, vaultPersonId)
        .then((result) => {
          // Changed here while it was saving: keep those too (they go up next).
          const latest = vaultRef.current ?? started;
          let vault = latest === started ? result.vault : merge(result.vault, latest.vault);
          const deduped = dedupePunches(vault);
          const dirty = latest !== started || deduped !== vault;
          vault = deduped;
          vaultRef.current = { vault, version: result.version, stamped: true, dirty };
          saveLocalVault(vaultRef.current);
          applyVault(vault);
          if (dirty) setVaultTick((tick) => tick + 1);
        })
        .catch(() => undefined) // Tried again at the next check-in or change.
        .finally(() => {
          vaultBusy.current = false;
        });
    }, 1200);
    return () => window.clearTimeout(timer);
    // The clock, settings, merges, contacts and shift edits are listed because a change to them is what gets sent.
    // applyVault reads this render's edits and documents; it isn't what starts a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultTick, vaultPersonId, serverVault, teamKey, clockData, prefs, nameMerges, dismissedMerges, contacts, shiftEdits]);

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    void processFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
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
    setPreparedReviews((current) => {
      const next = { ...current };
      delete next[document.hash];
      return next;
    });
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
      setSelectedDate(nextDates[0] ?? workdayAt());
    }
    if (expandedDocument === document.id) {
      setExpandedDocument(null);
      setOpenReviewHash(null);
    }
    setImportComparisons((current) => current.filter((photo) => photo.hash !== document.hash));
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
    const imported = shiftEditor?.imported;
    const existingOnDate = events.find(
      (event) =>
        event.date === shiftDraft.date && event.id !== shiftEditor?.eventId,
    );
    if (imported && existingOnDate && (!editing || imported.shift.date !== shiftDraft.date)) {
      setToast("You already have a shift on that date");
      return;
    }
    const correctedShift = imported ? {
      ...imported.shift,
      date: shiftDraft.date,
      start: shiftDraft.start,
      end: shiftDraft.end,
      id: `${shiftDraft.date}-${imported.shift.worker}-${shiftDraft.start}`,
    } : undefined;
    const nextEvent: CalendarEvent = {
      id: correctedShift?.id ?? editing?.id ?? existingOnDate?.id ?? `manual-${Date.now()}`,
      calendarKey: calendarKeyFor(prefs.person, shiftDraft.date),
      date: shiftDraft.date,
      start: shiftDraft.start,
      end: shiftDraft.end,
      title: shiftDraft.title.trim(),
      customTitle: !imported || Boolean(editing?.customTitle) || shiftDraft.title.trim() !== DEFAULT_SHIFT_TITLE,
      fromSchedule: Boolean(imported || (editing?.fromSchedule && editing.date === shiftDraft.date)),
    };

    if (imported && correctedShift) {
      // Adding one it missed takes the place of that day's "off" for you, if it read one.
      const sameDay = (shift: Shift) => imported.adding && shift.date === correctedShift.date &&
        nameKey(resolveMergedName(shift.worker, nameMerges)) === nameKey(resolveMergedName(correctedShift.worker, nameMerges));
      const replaceShift = (shifts: Shift[]) => imported.adding
        ? [...shifts.filter((shift) => !sameDay(shift)), correctedShift]
        : shifts.map((shift) => shift.id === imported.shift.id ? correctedShift : shift);
      setImportComparisons((current) => current.map((photo) =>
        photo.hash === imported.hash ? {
          ...photo, shifts: replaceShift(photo.shifts),
          uncertainShifts: photo.uncertainShifts?.filter((id) => id !== imported.shift.id),
        } : photo,
      ));
      setScheduleDocuments((current) => current.map((document) =>
        document.hash === imported.hash ? {
          ...document, shifts: replaceShift(document.shifts),
          review: document.review && {
            ...document.review,
            uncertainShifts: document.review.uncertainShifts?.filter((id) => id !== imported.shift.id),
          },
        } : document,
      ));
      setParsedShifts((current) => [
        ...current.filter((shift) => shift.id !== imported.shift.id && shift.id !== editing?.id && !sameDay(shift)),
        correctedShift,
      ]);
    }

    setEvents((current) =>
      [
        ...current.filter(
          (event) =>
            event.id !== editing?.id && (imported || event.id !== existingOnDate?.id),
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
    // The same change on your other devices.
    const editedAt = Date.now();
    recordShiftEdits({
      ...(editing && editing.date !== shiftDraft.date ? { [editing.date]: { at: editedAt, event: null } } : {}),
      [shiftDraft.date]: {
        at: editedAt,
        event: nextEvent,
        ...(imported && correctedShift
          ? { fix: { hash: imported.hash, fromId: imported.shift.id, shift: correctedShift, adding: Boolean(imported.adding) } }
          : {}),
      },
    });
    setSelectedDate(workdayFor(eventCalendarDate(nextEvent), nextEvent.start));
    setShiftEditor(null);
    setToast(imported?.adding ? "Shift added" : imported || editing || existingOnDate ? "Shift updated" : "Shift added");
  };

  const deleteShift = () => {
    const editing = shiftEditor?.eventId
      ? events.find((event) => event.id === shiftEditor.eventId)
      : undefined;
    if (!editing) return;
    setEvents((current) =>
      current.filter((event) => event.id !== editing.id),
    );
    recordShiftEdits({ [editing.date]: { at: Date.now(), event: null } });
    setShiftEditor(null);
    setToast("Shift deleted");
  };

  const clearAllImports = () => {
    const removedDates = new Set(importedDates);
    scheduleDocuments.forEach((document) =>
      document.dates.forEach((date) => removedDates.add(date)),
    );
    setScheduleDocuments([]);
    setPreparedReviews({});
    setImportedDates([]);
    setParsedShifts([]);
    setParsedFlights([]);
    setEvents((current) =>
      current.filter((event) => !removedDates.has(event.date)),
    );
    if (removedDates.has(selectedDate)) setSelectedDate(workdayAt());
    setImportComparisons([]);
    setOpenReviewHash(null);
    setExpandedDocument(null);
    void clearScheduleImages().catch(() => undefined);
    localStorage.setItem("shiftdeck.importHashes", "[]");
    setClearConfirmOpen(false);
    setToast("All imported schedules cleared");
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
      setToast(`Add a shift before connecting ${android ? "Google" : "Apple"} Calendar`);
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
      const webcal = syncedSubscription.feedUrl.replace(/^https:/i, "webcal:");
      if (android) {
        // Android has no webcal: handler; Google Calendar subscribes by URL.
        await navigator.clipboard?.writeText(syncedSubscription.feedUrl).catch(() => undefined);
        setToast("Opening Google Calendar · feed link copied");
        // A plain navigation isn't caught by the popup blocker after the network wait.
        window.location.href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
        return;
      }
      setToast("Opening Shiftdeck in Apple Calendar");
      window.location.href = webcal;
    } catch {
      setCalendarSyncState("error");
      setToast(`${android ? "Google" : "Apple"} Calendar couldn’t connect. Try again.`);
    }
  };

  const matchesScanWorker = (name: string) => nameKey(resolveMergedName(
    resolveSchedulePersonName(name, [prefs.person]), nameMerges,
  )) === nameKey(prefs.person);

  const renderComparison = (photo: ImportComparison) => (
    <ScheduleComparison
      image={photo.image}
      dates={photo.dates}
      shifts={photo.shifts}
      sourceLayout={photo.sourceLayout}
      sourceLoading={photo.sourceLoading}
      uncertainShifts={photo.uncertainShifts}
      person={prefs.person}
      nameMerges={nameMerges}
      onEdit={(shift) => openImportedShift(photo, shift)}
      onAdd={(date) => addImportedShift(photo, date)}
    />
  );

  const renderImportSheet = () => (
    <div
      className="modal-layer"
      role="presentation"
      inert={Boolean(shiftEditor?.imported)}
      {...backdropClose(closeSheet)}
    >
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
        className={`upload-card ${dragActive ? "is-dragging" : ""}`}
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
          accept={android ? "image/*" : "image/*,application/pdf,.pdf"}
          multiple
          onChange={onFiles}
          aria-label={android ? "Upload schedule photos" : "Upload schedule files"}
        />
        <button className="upload-inner" onClick={() => fileInput.current?.click()}>
          <span className="upload-icon"><Upload /></span>
          <h2>{dragActive ? "Drop to import" : android ? "Add schedule photos" : "Add schedule files"}</h2>
          <p>{android ? "Tap to choose from your gallery or camera" : "Tap to choose, or drop them here"}</p>
          <small>{android ? "JPG or PNG · several at once is fine" : "JPG, PNG, HEIC or PDF · several at once is fine"}</small>
        </button>
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
                  closeSheet();
                  setNotificationsOpen(true);
                }}
              >
                <Bell /> Turn on shift alerts
              </button>
            )}
          </div>
        </section>
      )}

      {importState === "review" && sendTeam && justImported.length > 0 && (
        <TeamSendPrompt
          key={justImported.join("|")}
          team={sendTeam}
          what={describeShare({
            weeks: scheduleDocuments.filter((document) => justImported.includes(document.id)).map((document) => document.dates),
          }) || "this schedule"}
          onSend={(to) => sendImportToTeam({ documentIds: justImported }, to)}
        />
      )}

      {importState === "review" && importComparisons.length > 0 && (
        <section className="schedule-comparisons">
          <h3>Your shifts vs. the photo</h3>
          {importComparisons.map((photo, index) => (
            <article key={`${photo.hash}-${index}`} className="schedule-comparison-file">
              <div className="schedule-comparison-heading">
                <strong>{formatDocumentRange(photo.dates)}</strong>
                <span>{photo.name}</span>
              </div>
              {renderComparison(photo)}
            </article>
          ))}
        </section>
      )}

      {scheduleDocuments.length > 0 && (
        <section className="upload-history">
          <div className="upload-history-heading">
            <h2>Uploaded schedules</h2>
            <span>{scheduleDocuments.length}</span>
          </div>
          <div className="upload-document-list">
            {/* Newest week first; the week you're in is marked. */}
            {[...scheduleDocuments]
              .sort((a, b) => ([...b.dates].sort()[0] ?? "").localeCompare([...a.dates].sort()[0] ?? ""))
              .map((document) => {
              const isExpanded = expandedDocument === document.id;
              const prepared = preparedReviews[document.hash];
              const sorted = [...document.dates].sort();
              const isThisWeek = sorted.length > 0 && sorted[0] <= todayDate && todayDate <= sorted[sorted.length - 1];
              return (
                <article
                  className={`upload-document ${isExpanded ? "expanded" : ""}${isThisWeek ? " this-week" : ""}`}
                  key={document.id}
                >
                  <div className="upload-document-row">
                    <button
                      className="upload-document-main"
                      onClick={() => {
                        setExpandedDocument(isExpanded ? null : document.id);
                        setOpenReviewHash(null);
                      }}
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
                        {isThisWeek && <i className="this-week">This week</i>}
                        {document.revision > 1 && <i>Updated</i>}
                        {!isThisWeek && <i className="active">Active</i>}
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
                    <div className="upload-document-options">
                      <button
                        type="button"
                        className="button soft"
                        disabled={isSchedulePdf(document) || importState === "reading"}
                        title={isSchedulePdf(document) ? "Charter PDFs import flights" : undefined}
                        onClick={() => setOpenReviewHash(document.hash)}
                      >
                        Verify to photo
                      </button>
                      <button
                        type="button"
                        className="button soft"
                        disabled={importState === "reading"}
                        onClick={() => setViewedDocument(document)}
                      >
                        View schedule
                      </button>
                    </div>
                  )}
                  {isExpanded && openReviewHash === document.hash && (
                    renderComparison({
                      ...document,
                      sourceLayout: prepared?.sourceLayout,
                      sourceLoading: !prepared,
                      uncertainShifts: document.review?.uncertainShifts,
                      image: prepared?.image,
                    })
                  )}
                </article>
              );
            })}
          </div>
          <button
            type="button"
            className="button danger subtle upload-clear-all"
            onClick={() => {
              if (!clearConfirmOpen) {
                setClearConfirmOpen(true);
                return;
              }
              clearAllImports();
            }}
            onBlur={() => setClearConfirmOpen(false)}
          >
            <Trash2 /> {clearConfirmOpen ? "Tap again to clear all imports" : "Clear all imports"}
          </button>
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

  const homeTiles = {
    clock: clockData ? (
      <TimeClockCard
        data={clockData}
        onChange={changeClock}
        onOpen={() => setClockOpen(true)}
        scheduled={(() => {
          const shift = events.find((event) => event.date === todayDate);
          return shift ? formatTimeRange(shift) : undefined;
        })()}
      />
    ) : null,
    today: (
      <TodayHero
        date={selectedDate}
        isToday={selectedDate === todayDate}
        now={clockNow}
        title={
          myEvent?.customTitle
            ? myEvent.title.trim() || DEFAULT_SHIFT_TITLE
            : prefs.title.trim() || DEFAULT_SHIFT_TITLE
        }
        shift={myShift ?? null}
        otherShifts={myDayShifts.filter((shift) => shift.id !== myShift?.id)}
        loaded={myDayStatus.has(selectedDate)}
        isPto={myDayStatus.get(selectedDate)?.status === "pto"}
        onEdit={openEditShift}
        onAdd={openAddShift}
        onToday={returnToToday}
      />
    ),
    schedule: (
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
    ),
    flights: (
      <FlightList
        flights={dayFlights}
        shifts={myDayShifts}
        date={selectedDate}
        isToday={selectedDate === todayDate}
        now={clockNow}
        linkFor={(flight) =>
          flightAwareRouteUrl(flight, prefs.homeAirport, prefs.flightApp)
        }
        airport={cleanAirportCode(prefs.homeAirport)}
        app={prefs.flightApp}
        live={liveFlights.live}
        onRefresh={liveFlights.refresh}
        refreshing={liveFlights.refreshing}
        pickedLive={mapPicked}
        timeMode={prefs.flightTime}
      />
    ),
    map: (
      <LiveMapPanel
        url={calendarServiceUrl("/api/planes")}
        liveFlights={liveFlights.live?.flights ?? []}
        onPickFlight={setMapPicked}
      />
    ),
    weather: (
      <WeatherPanel shift={myShift} date={selectedDate} today={todayDate} />
    ),
    crew: (
      <CrewPanel
        shifts={dayShifts}
        date={selectedDate}
        person={prefs.person}
        myShift={myShift}
        isToday={selectedDate === todayDate}
        now={clockNow}
      />
    ),
  };

  return (
    <div className="app-shell">

      <dialog
        ref={airportAlertsDialog}
        className="panel-sheet airport-alerts-sheet"
        aria-labelledby="airport-alerts-title"
        // Like every other popup, a tap outside it closes it (taps on the dim
        // backdrop land on the dialog itself, outside its box).
        onPointerDown={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          notificationsBackdrop.current = event.target === event.currentTarget && (
            event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
        }}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
          if (notificationsBackdrop.current && event.target === event.currentTarget && outside) event.currentTarget.close();
          notificationsBackdrop.current = false;
        }}
        onClose={() => {
          // Answers shown while the popup was open count as seen.
          updateSentSwaps((current) => current.some((swap) => swap.status !== "waiting" && !swap.seen)
            ? current.map((swap) => swap.status !== "waiting" ? { ...swap, seen: true } : swap)
            : current);
          setNotificationsInfo(false);
          markPostsSeen(teamInbox.map((post) => post.id));
        }}
      >
        <header className="sheet-head notifications-head">
          <h2 id="airport-alerts-title">Notifications</h2>
          {notificationsShown > 0 && (
            <button type="button" className="notifications-clear" onClick={clearAllNotifications}>
              Clear all
            </button>
          )}
          <button
            type="button"
            className={`notifications-info${notificationsInfo ? " on" : ""}`}
            aria-expanded={notificationsInfo}
            aria-label="About notifications"
            onClick={() => setNotificationsInfo((open) => !open)}
          >
            <Info />
          </button>
          <form method="dialog"><button type="submit" aria-label="Close notifications"><X /></button></form>
        </header>
        <div className="sheet-scroll notifications-body">
          {cleared && (
            <div className="notifications-undo" role="status">
              <span>Cleared <Flip value={cleared.count} /> {cleared.count === 1 ? "notification" : "notifications"}</span>
              <button type="button" onClick={undoClearNotifications}>
                <Undo2 aria-hidden="true" /> Undo
                <span className="notifications-undo-count" style={{ "--left": `${(clearSecondsLeft / 10) * 100}%` } as CSSProperties}>
                  <Flip value={clearSecondsLeft} />
                </span>
              </button>
            </div>
          )}
          {notificationsInfo && (
            <div className="notifications-about">
              <p>
                <b>Swap replies</b> show up here when a coworker answers a swap you sent by email or text.
              </p>
              <p>
                <b>Team</b>: schedules and info coworkers send you on Shiftdeck. Send yours from Settings → Team.
              </p>
              <p>
                <b>ABE airport alerts</b> come from the airport’s website
                {airportAlerts ? `, last checked ${formatUpdatedAt(airportAlerts.updatedAt)}` : ""}.
              </p>
              <a href="https://www.flyabe.com/flights/" target="_blank" rel="noreferrer">
                Official ABE flight board <ArrowUpRight />
              </a>
            </div>
          )}
          {teamInbox.length > 0 && (
            <section className="notice-group" aria-label="Team">
              <h3>Team</h3>
              <ul className="swap-reply-list team-post-list">
                {teamInbox.map((post) => (
                  <li key={post.id} className={seenPosts.includes(post.id) ? "" : "is-new"}>
                    <span className="swap-reply-icon"><Users /></span>
                    <div>
                      <b>
                        {post.kind === "swap"
                          ? `${post.from.split(" ")[0]} wants to swap shifts`
                          : `${post.from.split(" ")[0]} ${post.direct ? "sent you" : "shared"} ${post.what}`}
                      </b>
                      <small>{formatUpdatedAt(post.createdAt)}</small>
                    </div>
                    <button
                      type="button"
                      className="airport-alert-dismiss team-post-open"
                      onClick={() => {
                        markPostsSeen([post.id]);
                        airportAlertsDialog.current?.close();
                        if (post.kind === "swap") setSwapAnswerId(post.shareId);
                        else if (team) openIncomingShare({ id: post.shareId, key: team.key }, post.id);
                      }}
                    >
                      {post.kind === "swap" ? "View" : "Open"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {ownerRequests.length > 0 && (
            <section className="notice-group" aria-label="Name changes">
              <h3>Name changes</h3>
              <ul className="swap-reply-list team-post-list">
                {ownerRequests.map((request) => (
                  <li key={request.id} className="is-new">
                    <span className="swap-reply-icon"><Users /></span>
                    <div>
                      <b>{request.from} asks to be {request.name}</b>
                      <small>{formatUpdatedAt(request.createdAt)}</small>
                    </div>
                    <span className="name-request-actions">
                      <button
                        type="button"
                        className="airport-alert-dismiss"
                        onClick={() => {
                          setMe((current) => current && { ...current, requests: current.requests?.filter((item) => item.id !== request.id) });
                          void decideName(CALENDAR_SERVICE_ORIGIN, request.id, false).catch(() => undefined);
                        }}
                      >
                        Deny
                      </button>
                      <button
                        type="button"
                        className="airport-alert-dismiss team-post-open"
                        onClick={() => {
                          setMe((current) => current && { ...current, requests: current.requests?.filter((item) => item.id !== request.id) });
                          decideName(CALENDAR_SERVICE_ORIGIN, request.id, true)
                            .then(() => setToast(`${request.from.split(" ")[0]} is now ${request.name}`))
                            .catch((problem: unknown) => setToast(problem instanceof Error ? problem.message : "Couldn’t approve that."));
                        }}
                      >
                        Approve
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!liveSwapReplies.length && !airportNoticeCount && !teamInbox.length && !ownerRequests.length && (
            <div className="notifications-empty">
              <Bell aria-hidden="true" />
              <p>You’re all caught up</p>
              <small>{airportAlerts ? "No swap replies or airport notices." : "Airport notices are still loading."}</small>
            </div>
          )}
          {liveSwapReplies.length > 0 && (
            <section className="notice-group" aria-label="Swap replies">
              <h3>Swap replies</h3>
              <ul className="swap-reply-list">
                {liveSwapReplies.map((swap) => (
                  <li key={swap.id} className={`is-${swap.status}${swap.status !== "waiting" && !swap.seen ? " is-new" : ""}`}>
                    <span className="swap-reply-icon">
                      {swap.status === "yes" ? <Check /> : swap.status === "no" ? <X /> : <ArrowLeftRight />}
                    </span>
                    <div>
                      <b>
                        {swap.status === "yes"
                          ? `${swap.worker} said yes`
                          : swap.status === "no"
                            ? `${swap.worker} can’t swap`
                            : `Waiting on ${swap.worker}`}
                      </b>
                      <small>
                        Your {formatShortDay(swap.give.date)} {formatTimeRange(swap.give)}
                        {swap.take
                          ? <> for their {formatShortDay(swap.take.date)} {formatTimeRange(swap.take)}</>
                          : swap.options?.length ? <> · {swap.options.length} of their days offered</> : null}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="airport-alert-dismiss"
                      onClick={() => updateSentSwaps((current) => current.filter((item) => item.id !== swap.id))}
                    >
                      Clear
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {airportNoticeCount > 0 && (
            <section className="notice-group" aria-label="ABE airport alerts">
            <h3>ABE airport alerts</h3>
            <ul className="airport-alert-list">
              {visibleAirportAlerts.map(({ text, url }, index) => (
                <li key={`${index}-${text}`}>
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <p>{text}</p>
                    {url && <a href={url} target="_blank" rel="noreferrer">Read more on the airport site</a>}
                  </div>
                  <button type="button" className="airport-alert-dismiss" onClick={() => dismissAirportAlert(text)}>
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
            </section>
          )}
        </div>
      </dialog>

      <main className="home">
        {me && (syncStatus.state !== "idle" || syncWaiting) && (
          <SyncBar status={syncWaiting ? { state: "waiting" } : syncStatus} devices={myPhones} />
        )}
        <div className={`home-grid ${hydrated ? "is-ready" : ""}${homeOrder.some((tile, index) => tile !== DEFAULT_HOME_ORDER[index]) ? " custom-order" : ""}`}>
          {homeOrder.map((tile) => (
            <Fragment key={tile}>{homeTiles[tile]}</Fragment>
          ))}
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

      <QuickMenu
        style={quickMenu}
        badge={notificationCount}
        actions={[
          {
            id: "notifications",
            label: "Notifications",
            short: "Inbox",
            ariaLabel: `Notifications${notificationCount ? ` (${notificationCount} new)` : ""}`,
            icon: Bell,
            badge: notificationCount,
            onSelect: openNotifications,
          },
          { id: "import", label: "Import", ariaLabel: "Import schedule", icon: Upload, onSelect: () => openSheet("import") },
          { id: "swap", label: "Swap", ariaLabel: "Shift swap", icon: ArrowLeftRight, onSelect: () => openSheet("swap") },
          { id: "directory", label: "Directory", icon: BookUser, onSelect: () => setDirectoryOpen(true) },
          { id: "clock", label: "Time clock", icon: Timer, onSelect: () => setClockOpen(true) },
          {
            id: "settings",
            label: "Settings",
            ariaLabel: "Open settings",
            icon: Settings,
            onSelect: () => {
              setSettingsOpen(true);
            },
          },
        ]}
      />

      {sheet === "import" && (importState === "reading" ? (
        <ScheduleImportPreview
          file={scanFile}
          count={loadedFiles.length}
          snapshot={importSnapshot}
          onClose={() => {
            personPrompt?.resolve(null);
            closeSheet();
          }}
          matchesWorker={matchesScanWorker}
          personChoices={personPrompt?.names ?? null}
          onChoosePerson={(name) => personPrompt?.resolve(name)}
        />
      ) : renderImportSheet())}
      {viewedDocument && (
        <ScheduleFileViewer
          id={viewedDocument.id}
          name={viewedDocument.name}
          pdf={isSchedulePdf(viewedDocument)}
          showScanned={isAppOwner}
          matchesWorker={matchesScanWorker}
          onClose={() => setViewedDocument(null)}
        />
      )}
      {sheet === "swap" && (
        <SwapSheet
          shifts={swapShifts}
          person={prefs.person}
          dates={scheduleDates.filter((date) => date >= todayDate)}
          initialOffDate={selectedDate}
          contacts={swapContacts}
          onEditContact={(worker) => setContactsOpen({ focus: worker })}
          sentSwaps={sentSwaps}
          swapServiceUrl={CALENDAR_SERVICE_ORIGIN}
          onSwapSent={(swap) => {
            void registerSwap(
              calendarServiceUrl(""),
              swap,
              prefs.person,
              notificationPermission === "granted" ? notificationProfile : null,
            );
            updateSentSwaps((current) => [...current.filter((item) => isLiveSwap(item, todayDate)), swap].slice(-60));
          }}
          teammateFor={(worker) => {
            const key = worker.toLowerCase().replace(/[^a-z]/g, "");
            return teammates(team).find((person) => person.name.toLowerCase().replace(/[^a-z]/g, "") === key)?.id;
          }}
          onSendInApp={async (swap, memberId) => {
            if (!me) throw new Error("Pick your name in Settings first.");
            // Registered first (the request has to exist before the teammate can open it).
            const registered = await fetch(`${calendarServiceUrl("")}/api/swaps`, {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify({
                id: swap.id, token: swap.token, from: prefs.person, to: swap.worker, give: swap.give, take: swap.take,
                options: swap.options,
                ...(notificationPermission === "granted" && notificationProfile
                  ? { profileId: notificationProfile.id, profileToken: notificationProfile.writeToken }
                  : {}),
              }),
            });
            if (!registered.ok) throw new Error("Couldn’t send");
            await postSwapToTeam(CALENDAR_SERVICE_ORIGIN, swap.id, memberId);
            updateSentSwaps((current) => [...current.filter((item) => isLiveSwap(item, todayDate)), swap].slice(-60));
          }}
          onCancelSwap={(swap) => {
            void cancelSwap(calendarServiceUrl(""), swap);
            updateSentSwaps((current) => current.map((item) =>
              item.id === swap.id ? { ...item, status: "cancelled", seen: true } : item));
          }}
          onClose={() => {
            // Cancelled requests clear once you leave Shift swap.
            updateSentSwaps((current) => current.some((item) => item.status === "cancelled")
              ? current.filter((item) => item.status !== "cancelled")
              : current);
            closeSheet();
          }}
        />
      )}

      {clockOpen && clockData && (
        <TimeClockSheet data={clockData} onChange={changeClock} onClose={() => setClockOpen(false)} />
      )}

      {shiftEditor && (
        <ShiftEditorSheet
          key={shiftEditor.eventId ?? "new"}
          mode={shiftEditor.mode}
          draft={shiftDraft}
          setDraft={setShiftDraft}
          onClose={() => setShiftEditor(null)}
          onSave={saveShift}
          onDelete={shiftEditor.imported ? undefined : deleteShift}
        />
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
                <h2>Alerts</h2>
                <p>Reminders before your shifts, and flight alerts.</p>
              </div>
              <SheetClose
                className=""
                watch={[alertPrefs.title, alertPrefs.location, alertPrefs.locationLat, alertPrefs.locationLon, alertPrefs.alerts, alertPrefs.flightAlerts]}
                label="Close alerts"
                onClose={() => setNotificationsOpen(false)}
                onSave={() => {
                  commitDraft("alerts");
                  setNotificationsOpen(false);
                  setToast(notificationProfile ? "Alerts saved" : "Saved");
                }}
              />
            </header>
            <div className="sheet-scroll">
            <div
              className={`notify-status compact ${
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
                    ? "On this device · updates automatically"
                    : android
                      ? "Turn them on below. Chrome will ask to allow notifications."
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

            <Disclosure
              icon={BriefcaseBusiness}
              title="Shift details"
              className="notify-group"
              summary={[alertPrefs.title.trim() || "Work", alertPrefs.location.trim().split(",")[0]].filter(Boolean).join(" · ")}
            >
            <div className="export-fields notify-card">
              <label>
                <span>Default job title</span>
                <input value={alertPrefs.title} onChange={(event) => editAlerts({ title: event.target.value })} placeholder="Work" />
                <small>Used for imported shifts unless you rename one.</small>
              </label>
              <label className="place-field">
                <span>Location</span>
                <input
                  value={alertPrefs.location}
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
                      editAlerts({
                        location: "Pinned location",
                        locationLat: coordinate.latitude,
                        locationLon: coordinate.longitude,
                      });
                      setPlaceSuggestions([]);
                      setPlaceMenuOpen(false);
                      return;
                    }
                    editAlerts({
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
                {placeMenuOpen && alertPrefs.location.trim().length >= 3 && (
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
                            editAlerts({
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
                {alertPrefs.location &&
                  Number.isFinite(alertPrefs.locationLat) &&
                  Number.isFinite(alertPrefs.locationLon) && (
                    <small className="place-selected">
                      <MapPin />
                      Map pin attached ·{" "}
                      {formatAppleCoordinates(
                        alertPrefs.locationLat!,
                        alertPrefs.locationLon!,
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
                          typeof alertPrefs.locationLat === "number" &&
                            typeof alertPrefs.locationLon === "number"
                            ? formatAppleCoordinates(
                                alertPrefs.locationLat,
                                alertPrefs.locationLon,
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
                    href={`https://maps.apple.com/?ll=${alertPrefs.locationLat},${alertPrefs.locationLon}&q=${encodeURIComponent(alertPrefs.location.trim())}`}
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
                          editAlerts({
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
            </Disclosure>

            <Disclosure
              icon={AlarmClock}
              title="Shift reminders"
              className="notify-group"
              defaultOpen={!notificationProfile}
              summary={reminderSummary(alertPrefs.alerts)}
            >
            <div className="notify-card notify-alerts">
              {alertPrefs.alerts.map((minutes, index) => {
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
                      disabled={alertPrefs.alerts.length === 1}
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
                  .filter((preset) => !alertPrefs.alerts.includes(preset.minutes))
                  .map((preset) => (
                    <button
                      type="button"
                      key={preset.minutes}
                      disabled={alertPrefs.alerts.length >= 12}
                      onClick={() => editAlerts({ alerts: [...alertPrefs.alerts, preset.minutes] })}
                    >
                      <Plus /> {preset.label}
                    </button>
                  ))}
                <button
                  type="button"
                  className="custom"
                  disabled={alertPrefs.alerts.length >= 12}
                  onClick={addNotificationAlert}
                >
                  <Plus /> Custom
                </button>
              </div>
              <small className="notify-count">{alertPrefs.alerts.length} of 12 alerts</small>
            </div>
            </Disclosure>

            <Disclosure icon={Plane} title="Flight alerts" className="notify-group" summary={flightAlertSummary(alertPrefs.flightAlerts)}>
              <FlightAlertSettings bare value={alertPrefs.flightAlerts} onChange={(flightAlerts) => editAlerts({ flightAlerts })} />
            </Disclosure>

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

            {!notificationProfile && (
            <footer className="sheet-foot">
            <button
              className="button primary"
              onClick={() => {
                commitDraft("alerts");
                void saveNotificationSettings();
              }}
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
            )}
          </section>
        </div>
      )}

      {homeSetupOpen && (
        <HomeSetupSheet
          value={{ flightApp: prefs.flightApp, flightTime: prefs.flightTime, order: homeOrder, menu: quickMenu }}
          onClose={() => {
            setHomeSetupOpen(false);
            setSettingsOpen(true);
          }}
          onSave={(next) => {
            savePrefs({ flightApp: next.flightApp, flightTime: next.flightTime });
            saveHomeOrder(next.order);
            saveQuickMenu(next.menu);
            setHomeSetupOpen(false);
            setSettingsOpen(true);
            setToast("Home screen saved");
          }}
        />
      )}

      {settingsOpen && (
        <div className="modal-layer" role="presentation" {...backdropClose(() => setSettingsOpen(false))}>
          <section className="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings">
            <header>
              <div><h2>Settings</h2></div>
              <div className="settings-head-actions">
                <button
                  type="button"
                  className="settings-theme"
                  onClick={() => changeTheme(theme === "dark" ? "light" : "dark")}
                  aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {theme === "dark" ? <Moon /> : <Sun />}
                </button>
                <SheetClose
                  className=""
                  watch={settingsPrefs}
                  label="Close settings"
                  onClose={() => setSettingsOpen(false)}
                  onSave={() => {
                    commitDraft("settings");
                    setSettingsOpen(false);
                    setToast(me ? "Saved · on your other devices too" : "Preferences saved on this device");
                  }}
                />
              </div>
            </header>
            <div className="settings-name-row">
              {nameLocked ? (
                <div className="settings-name-locked">
                  <span>Your name on the schedule</span>
                  <b><Lock aria-hidden="true" /> {prefs.person}</b>
                  <button type="button" onClick={() => {
                    setSettingsOpen(false);
                    setNameChangeOpen(true);
                  }}>
                    {me?.request ? "Change requested" : "Request a change or add a device"}
                  </button>
                </div>
              ) : (
              <label>
                <span>Your name on the schedule</span>
                <select
                  value={prefs.person}
                  onChange={(event) => {
                    const person = event.target.value;
                    if (me?.owner && prefs.person) {
                      // The owner's own name changes everywhere (teams included).
                      askForName(CALENDAR_SERVICE_ORIGIN, person)
                        .then(() => savePrefs({ person }))
                        .catch((problem: unknown) => setToast(problem instanceof Error ? problem.message : "Your name didn’t change."));
                    } else {
                      savePrefs({ person });
                    }
                  }}
                >
                  {!prefs.person && <option value="" disabled>Choose your name</option>}
                  {availableWorkers.map((worker) => (
                    <option value={worker} key={worker}>
                      {isGroundSecurityCoordinator(worker) ? `${worker} · GSC` : worker}
                    </option>
                  ))}
                </select>
                <ChevronDown />
              </label>
              )}
              <button
                type="button"
                className="button soft settings-merge"
                onClick={() => {
                  setSettingsOpen(false);
                  setNameMergeOpen(true);
                }}
                aria-label={
                  mergeSuggestions.length
                    ? `Merge names, ${mergeSuggestions.length} possible duplicates`
                    : `Merge names, ${Object.keys(nameMerges).length} merged`
                }
              >
                Merge
                {mergeSuggestions.length > 0 && <i>{mergeSuggestions.length}</i>}
              </button>
            </div>
            <div className="settings-tiles">
              <button
                type="button"
                className="settings-tile"
                onClick={() => {
                  setSettingsOpen(false);
                  setHomeSetupOpen(true);
                }}
              >
                <span><LayoutGrid /> Home screen</span>
                <b>
                  {[
                    prefs.flightTime === "landing" ? "Landing times" : "Gate times",
                    homeOrder.some((tile, index) => tile !== DEFAULT_HOME_ORDER[index]) ? "custom order" : null,
                    quickMenu.layout === "button" ? `menu ${quickMenu.side}` : `${quickMenu.layout} bar`,
                  ].filter(Boolean).join(" · ")}
                </b>
              </button>
              <button
                type="button"
                className="settings-tile"
                onClick={() => {
                  setSettingsOpen(false);
                  setNotificationsOpen(true);
                }}
              >
                <span><Bell /> Notifications</span>
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
              </button>
              <button
                type="button"
                className="settings-tile"
                onClick={() => void subscribeToCalendar()}
                disabled={calendarSyncState === "syncing"}
              >
                <span><CalendarDays /> {android ? "Google Calendar" : "Apple Calendar"}</span>
                <b>
                  {calendarSyncState === "syncing"
                    ? "Updating…"
                    : calendarSyncState === "error"
                      ? "Needs attention"
                      : calendarSubscription
                        ? `Automatic · ${DEFAULT_WORK_LOCATION}`
                        : "Add shifts for Waze"}
                </b>
              </button>
              {/* Sending to the team is only for people the owner allows. */}
              {me?.canShare && (
                <button
                  type="button"
                  className="settings-tile"
                  onClick={() => {
                    setSettingsOpen(false);
                    setShareOpen(true);
                  }}
                >
                  <span><Users /> Team</span>
                  <b>{`Send to ${Math.max(0, (me.crew?.length ?? 1) - 1)} ${(me.crew?.length ?? 1) === 2 ? "person" : "people"}`}</b>
                </button>
              )}
              {me?.handoverOffer && (
                <button
                  type="button"
                  className="settings-tile wide owner-tile"
                  onClick={() => {
                    setSettingsOpen(false);
                    setHandoverOpen(true);
                  }}
                >
                  <span><Crown /> Become the owner</span>
                  <b>{me.handoverOffer.from.split(" ")[0]} is handing Shiftdeck to you</b>
                </button>
              )}
              {me?.owner && (
                <button
                  type="button"
                  className="settings-tile wide owner-tile"
                  onClick={() => {
                    setSettingsOpen(false);
                    setOwnerOpen(true);
                  }}
                >
                  <span><Crown /> Owner</span>
                  <b>
                    {(me.people?.length ?? 1)} {(me.people?.length ?? 1) === 1 ? "person" : "people"}
                    {allOwnerRequests.length ? ` · ${allOwnerRequests.length} name ${allOwnerRequests.length === 1 ? "change" : "changes"} waiting` : " · people, devices, access"}
                  </b>
                </button>
              )}
            </div>
            {liveFlights.live?.status ? (
              <LiveStatusSetting
                status={liveFlights.live.status}
                updatedAt={liveFlights.live.airportBoardUpdatedAt ? null : liveFlights.live.updatedAt}
              />
            ) : !liveFlights.checked ? (
              // Still loading: hold the row's space so the sheet doesn't jump.
              <SettingPlaceholder title="Live times" />
            ) : null}

          </section>
        </div>
      )}

      {shareOpen && (
        <ShareSheet
          schedules={scheduleDocuments}
          today={todayDate}
          directory={directory}
          contacts={contacts}
          person={prefs.person}
          loadFile={(id, straightened) => loadScheduleImage(id, straightened)}
          team={sendTeam}
          signedIn={Boolean(me)}
          inviteUrl={`${window.location.origin}${window.location.pathname}`}
          onSendToTeam={sendToTeam}
          onClose={() => setShareOpen(false)}
        />
      )}

      {swapAnswerId && (
        <SwapAnswerSheet
          swapId={swapAnswerId}
          service={calendarServiceUrl("")}
          onAnswered={() => dismissPosts(teamPosts.filter((post) => post.kind === "swap" && post.shareId === swapAnswerId).map((post) => post.id))}
          onClose={() => setSwapAnswerId(null)}
        />
      )}

      {nameChangeOpen && (
        <NameChangeSheet
          current={prefs.person}
          ownerName={me?.ownerName ?? null}
          pending={me?.request ?? null}
          names={[...new Set([...(team?.roster ?? []), ...availableWorkers])].sort((a, b) => a.localeCompare(b))}
          onRequest={async (name) => {
            await askForName(CALENDAR_SERVICE_ORIGIN, name);
            await refreshMe();
          }}
          onWithdraw={async (requestId) => {
            await withdrawNameRequest(CALENDAR_SERVICE_ORIGIN, requestId);
            setMe((current) => current && { ...current, request: null });
          }}
          onAddPhone={() => {
            setNameChangeOpen(false);
            setLinkCodeOpen(true);
          }}
          onClose={() => setNameChangeOpen(false)}
        />
      )}

      {nameTaken && (
        <LinkPhoneSheet
          name={nameTaken.name}
          ownerName={nameTaken.ownerName}
          onLink={async (code) => {
            const linked = await linkThisPhone(CALENDAR_SERVICE_ORIGIN, nameTaken.name, code, await checkIn());
            setMe(linked);
            setNameTaken(null);
            setToast(linked.owner ? "This device is set up as you, with owner access" : "This device is set up as you");
            void refreshMe(linked.name);
          }}
          onRecover={async (key) => {
            const recovered = await recoverOwner(CALENDAR_SERVICE_ORIGIN, key, await checkIn());
            setMe(recovered);
            setNameTaken(null);
            savePrefs({ person: recovered.name });
            setToast("You’re back in, with owner access. Make a new recovery key in Owner.");
            void refreshMe(recovered.name);
          }}
          onNotMe={() => {
            setNameTaken(null);
            savePrefs({ person: "" });
            // A phone that isn't set up yet goes back to the name screen; otherwise pick in Settings.
            if (mustPickName || !me) return;
            setSettingsOpen(true);
          }}
          onClose={() => setNameTaken(null)}
        />
      )}

      {ownerOpen && me?.owner && (
        <OwnerSheet
          me={me}
          names={[...new Set([...(team?.roster ?? []), ...availableWorkers])].sort((a, b) => a.localeCompare(b))}
          onRename={async (personId, name) => {
            await renamePerson(CALENDAR_SERVICE_ORIGIN, personId, name);
            if (personId === me.personId) savePrefs({ person: name });
            await refreshMe();
          }}
          onRemove={async (personId) => {
            await removePerson(CALENDAR_SERVICE_ORIGIN, personId);
            await refreshMe();
          }}
          onDecide={async (requestId, approve) => {
            await decideName(CALENDAR_SERVICE_ORIGIN, requestId, approve);
            await refreshMe();
          }}
          onBlock={async (personId) => {
            await blockPerson(CALENDAR_SERVICE_ORIGIN, personId);
            await refreshMe();
          }}
          onUnblock={async (personId) => {
            await unblockPerson(CALENDAR_SERVICE_ORIGIN, personId);
            await refreshMe();
          }}
          onClearLog={async () => {
            setMe((current) => current && { ...current, log: [] });
            await clearLog(CALENDAR_SERVICE_ORIGIN);
            await refreshMe();
          }}
          onShareAccess={async (personId, allow) => {
            // Flips right away; the check-in confirms it.
            setMe((current) => current && {
              ...current,
              people: current.people?.map((person) => person.id === personId ? { ...person, canShare: allow } : person),
            });
            await setShareAccess(CALENDAR_SERVICE_ORIGIN, personId, allow);
            await refreshMe();
          }}
          onStartHandover={async (personId) => {
            const started = await startHandover(CALENDAR_SERVICE_ORIGIN, personId);
            await refreshMe();
            return started;
          }}
          onCancelHandover={async () => {
            await cancelHandover(CALENDAR_SERVICE_ORIGIN);
            await refreshMe();
          }}
          onMakeRecoveryKey={async () => {
            const { key } = await makeRecoveryKey(CALENDAR_SERVICE_ORIGIN);
            await refreshMe();
            return key;
          }}
          rosterFor={(name) => {
            const exact = [...rosterStatus].find(([worker]) => nameKey(worker) === nameKey(name));
            return (exact ?? [...rosterStatus].find(([worker]) => isSameSchedulePerson(worker, name)))?.[1];
          }}
          learning={liveFlights.live || !liveFlights.checked ? <LearningSetting url={calendarServiceUrl("/api/flights/learning")} /> : undefined}
          onRenamePhone={async (deviceId, label) => {
            await renamePhone(CALENDAR_SERVICE_ORIGIN, deviceId, label);
            await refreshMe();
          }}
          onMovePhone={async (deviceId, name) => {
            await movePhone(CALENDAR_SERVICE_ORIGIN, deviceId, name);
            await refreshMe();
            setToast(`That device is now ${name}`);
          }}
          onRemovePhone={async (deviceId) => {
            await removePhone(CALENDAR_SERVICE_ORIGIN, deviceId);
            await refreshMe();
          }}
          onAddPhone={() => setLinkCodeOpen(true)}
          focus={ownerFocus ?? undefined}
          onClose={() => {
            setOwnerOpen(false);
            setOwnerFocus(null);
          }}
        />
      )}

      {/* After the owner screen, so the code shows on top of it. */}
      {linkCodeOpen && (
        <LinkCodeSheet
          owner={Boolean(me?.owner)}
          onMakeCode={() => makeLinkCode(CALENDAR_SERVICE_ORIGIN)}
          onClose={() => setLinkCodeOpen(false)}
        />
      )}

      {handoverOpen && me?.handoverOffer && (
        <AcceptHandoverSheet
          from={me.handoverOffer.from}
          onAccept={async (key) => {
            setMe(await acceptHandover(CALENDAR_SERVICE_ORIGIN, key));
            setHandoverOpen(false);
            setToast("You’re the owner now. Settings → Owner");
          }}
          onClose={() => setHandoverOpen(false)}
        />
      )}

      {/* No name on this phone yet (new, or reset by the owner): nothing until one is typed. */}
      {hydrated && !me && !blockedHere && (mustPickName || !prefs.person) && (
        <NamePickScreen
          reset={mustPickName}
          onTyped={(first, last, exact) => refreshMe("", { first, last, exact })}
          onUseName={(name) => refreshMe(name)}
        />
      )}

      {blockedHere && (
        <BlockedScreen name={prefs.person} onRetry={() => void refreshMe()} />
      )}

      {incoming && (
        <SharedImportSheet
          share={incoming.share}
          error={incoming.error}
          loading={!incoming.share && !incoming.error}
          person={prefs.person}
          haveWeek={(schedule) => scheduleDocuments.some((document) =>
            document.hash === schedule.hash || isScheduleRevision(document.dates, schedule.dates))}
          directory={directory}
          contacts={contacts}
          onImport={importShared}
          onAlreadyHave={() => incoming.postId && dismissPosts([incoming.postId])}
          onClose={() => setIncoming(null)}
        />
      )}

      {(directoryOpen || contactsOpen) && (
        <DirectorySheet
          tab={contactsOpen ? "coworkers" : undefined}
          focus={contactsOpen?.focus}
          entries={shownDirectory}
          workers={[prefs.person, ...contactWorkers].filter(Boolean)}
          coworkers={currentCoworkers}
          hiddenCount={hiddenIds.size + leftCoworkers.filter((worker) => !findPerson(directory, worker)).length}
          contacts={contacts}
          statuses={rosterStatus}
          team={sendTeam}
          onSendDirectory={(to) => sendImportToTeam({ directory: true }, to)}
          onSendContacts={(to) => sendImportToTeam({ contacts: true }, to)}
          onChange={saveShownDirectory}
          onContactsChange={saveContacts}
          onClear={() => saveDirectory([])}
          onClose={() => {
            setDirectoryOpen(false);
            setContactsOpen(null);
          }}
        />
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
          different={dismissedMerges.map((key) => {
            const shown = (part: string) =>
              parsedShifts.find((shift) => nameKey(shift.worker) === part)?.worker ?? part;
            const [a = "", b = ""] = key.split("|");
            return { key, a: shown(a), b: shown(b) };
          })}
          onUndoDifferent={(key) => setDismissedMerges((current) => current.filter((item) => item !== key))}
          onClose={() => {
            setNameMergeOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}

      {toast && <div className="toast"><Check /> {toast}</div>}
    </div>
  );
}
