"use client";

import {
  AlertTriangle,
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
  Sun,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  ChangeEvent,
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
  flightWorkday,
  importedFlightOnCalendar,
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
import { ShareSheet, SharedImportSheet, TeamJoinSheet, TeamSendPrompt, type OpenedShare, type SharedImport } from "./share-sheet";
import { openShareLink, type ShareKey } from "./share-link";
import { buildShare, describeShare } from "./share-build";
import type { SharePackage } from "./share-data";
import {
  createTeam,
  inviteLink,
  joinTeam,
  leaveTeam,
  loadSeenPosts,
  loadTeam,
  postToTeam,
  previewTeam,
  saveSeenPosts,
  saveTeam,
  teamInLocation,
  teamState,
  type Team,
  type TeamInvite,
  type TeamPost,
} from "./team";
import { useLiveFlights } from "./live-flights";
import { ContactsSheet } from "./contacts";
import { DirectorySheet } from "./directory";
import { DIRECTORY_KEY, contactsWithDirectory, type DirectoryEntry } from "./directory-data";
import { contactKey, CONTACTS_KEY, type Contacts } from "./contacts-data";
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
import { DEFAULT_HOME_ORDER, HOME_TILES, HomeOrderRow, type HomeTile } from "./home-order";
import { isAndroid, isHeic } from "./platform";
import { LearningSetting, LiveStatusSetting } from "./live-status-setting";
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
      queueMicrotask(() => setHomeOrder([...new Set([...known, ...DEFAULT_HOME_ORDER])]));
    } catch {
      // Use the default layout if storage is unavailable.
    }
  }, []);
  const saveHomeOrder = (order: HomeTile[]) => {
    setHomeOrder(order);
    try {
      localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(order));
    } catch {
      // Apply the order for the current visit.
    }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  // What Settings looked like when it opened, so the X can turn into Save after a change.
  const [settingsSnapshot, setSettingsSnapshot] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [nameMergeOpen, setNameMergeOpen] = useState(false);
  // Coworker emails/numbers live only in this device's storage.
  const [contacts, setContacts] = useState<Contacts>({});
  const [contactsOpen, setContactsOpen] = useState<{ focus?: string } | null>(null);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(CONTACTS_KEY) ?? "{}");
      if (saved && typeof saved === "object") queueMicrotask(() => setContacts(saved as Contacts));
    } catch {
      // Start with no contacts.
    }
  }, []);
  // The work phone directory, kept only on this device.
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Schedules imported just now (by this phone, not from a share), for "Send to the team?".
  const [justImported, setJustImported] = useState<string[]>([]);
  // A share link being opened: loading, then what it holds (or why it couldn't).
  const [incoming, setIncoming] = useState<{ share: OpenedShare | null; error: string } | null>(null);
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
  // The team this phone is on, what's been sent to it, and which posts were opened.
  const [team, setTeam] = useState<Team | null>(null);
  const [teamPosts, setTeamPosts] = useState<TeamPost[]>([]);
  const [seenPosts, setSeenPosts] = useState<string[]>([]);
  const [invite, setInvite] = useState<{
    invite: TeamInvite;
    preview: { name: string; members: string[] } | null;
    error: string;
    /** Opened in iPhone Safari: the invite to paste into the Home Screen app. */
    link?: string;
  } | null>(null);
  useEffect(() => {
    const saved = loadTeam();
    const seen = loadSeenPosts();
    queueMicrotask(() => {
      setTeam(saved);
      setSeenPosts(seen);
    });
  }, []);
  const updateTeam = (next: Team | null) => {
    setTeam(next);
    saveTeam(next);
    if (!next) setTeamPosts([]);
  };
  const markPostsSeen = (ids: string[]) => {
    setSeenPosts((current) => {
      const next = [...new Set([...current, ...ids])];
      saveSeenPosts(next);
      return next;
    });
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
    imported?: { hash: string; shift: Shift };
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
  const teamInbox = teamPosts.filter((post) => !post.mine);
  const unseenTeamPosts = teamInbox.filter((post) => !seenPosts.includes(post.id)).length;
  const notificationCount = airportNoticeCount + unseenSwapAnswers + unseenTeamPosts;
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
  };
  const airportAlertsDialog = useRef<HTMLDialogElement>(null);
  const airportAlertsButton = useRef<HTMLButtonElement>(null);
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
          restoredShifts = canonicalizeScheduleShifts(
            (JSON.parse(savedParsedShifts) as Shift[]).filter(
              (shift) =>
                shift &&
                typeof shift.id === "string" &&
                typeof shift.date === "string" &&
                typeof shift.worker === "string" &&
                (shift.workerConfirmed === true || isPlausibleWorkerName(shift.worker)),
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

  const prepareSavedReview = useEffectEvent(async (document: ScheduleDocument) => {
    let sourceLayout = document.review?.sourceLayout;
    let image = await loadScheduleImage(document.id, document.review?.deskewed).catch(() => undefined);
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
        image = parsed.reviewImage ?? image;
      }
    }
    return { image, sourceLayout };
  });

  const finishPreparingReview = useEffectEvent((
    hash: string,
    prepared: { image?: Blob; sourceLayout?: ScheduleSourceLayout },
  ) => {
    const activeHashes = new Set(scheduleDocuments.map((document) => document.hash));
    setPreparedReviews((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key]) => activeHashes.has(key)));
      if (activeHashes.has(hash)) next[hash] = prepared;
      return next;
    });
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

  const openIncomingShare = (key: ShareKey) => {
    setIncoming({ share: null, error: "" });
    openShareLink(key, CALENDAR_SERVICE_ORIGIN)
      .then((share) => setIncoming((current) => current && { ...current, share }))
      .catch((problem: unknown) => setIncoming((current) => current && {
        ...current,
        error: problem instanceof Error ? problem.message : "The share couldn’t be opened.",
      }));
  };

  // Team invites open the app with ?team=<id>#t=<key>&j=<join secret>.
  const openInvite = (key: TeamInvite, link?: string) => {
    setInvite({ invite: key, preview: null, error: "", link });
    previewTeam(CALENDAR_SERVICE_ORIGIN, key)
      .then((preview) => setInvite((current) => current && { ...current, preview }))
      .catch((problem: unknown) => setInvite((current) => current && {
        ...current,
        error: problem instanceof Error ? problem.message : "This invite couldn’t be opened.",
      }));
  };
  useEffect(() => {
    if (!hydrated) return;
    const key = teamInLocation(window.location);
    if (!key) return;
    const link = window.location.href;
    const url = new URL(link);
    url.searchParams.delete("team");
    url.hash = "";
    window.history.replaceState(null, "", url.href);
    if (loadTeam()?.id === key.id) {
      queueMicrotask(() => setToast("You’re already on this team"));
      return;
    }
    const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    queueMicrotask(() => openInvite(key, isAppleMobile && !isStandalone ? link : undefined));
    // Runs once, when saved data is back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Checks the team for new posts every minute while the app is open (and links notifications).
  const profileRef = useRef(notificationProfile);
  useEffect(() => {
    profileRef.current = notificationProfile;
  }, [notificationProfile]);
  const teamId = team?.id;
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    const check = async () => {
      const current = loadTeam();
      if (!current || document.visibilityState !== "visible") return;
      try {
        const state = await teamState(CALENDAR_SERVICE_ORIGIN, current, profileRef.current);
        if (cancelled) return;
        setTeamPosts(state.posts);
        if (state.name !== current.name || state.members.join("|") !== (current.members ?? []).join("|")) {
          updateTeam({ ...current, name: state.name, members: state.members });
        }
      } catch (problem) {
        // Removed from the team (or it's gone): forget it here too.
        if (!cancelled && (problem as { status?: number }).status === 403) updateTeam(null);
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
    // updateTeam only uses state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, notificationProfile?.id]);

  const sendToTeam = async (share: SharePackage, what: string) => {
    if (!team) throw new Error("Join or start a team first.");
    const result = await postToTeam(CALENDAR_SERVICE_ORIGIN, team, share, what);
    markPostsSeen([result.id]);
    return result.notified;
  };
  /** After an import: sends just that (schedule weeks, the directory, or contacts) to the team. */
  const sendImportToTeam = async (part: { documentIds?: string[]; directory?: boolean; contacts?: boolean }) => {
    const { share, what } = await buildShare({
      documents: scheduleDocuments.filter((document) => part.documentIds?.includes(document.id)),
      directory: part.directory ? directory : undefined,
      contacts: part.contacts ? contacts : undefined,
      person: prefs.person,
      loadFile: (id) => loadScheduleImage(id),
    });
    return sendToTeam(share, what);
  };

  // A swap-answer notification opens the app with ?notifications=1.
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("notifications")) return;
    url.searchParams.delete("notifications");
    window.history.replaceState(null, "", url.href);
    airportAlertsDialog.current?.showModal();
  }, [hydrated]);

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

  // Swap emails and texts fall back to the Directory for anyone not in contacts.
  const swapContacts = useMemo(() => contactsWithDirectory(contacts, contactWorkers, directory),
    [contactWorkers, contacts, directory]);

  const availableWorkers = useMemo(() => {
    const names = Array.from(new Set(importedShifts.map((shift) => shift.worker)));
    return names.length ? names : prefs.person ? [prefs.person] : [];
  }, [importedShifts, prefs.person]);

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

  const openSheet = (next: Exclude<Sheet, null>) => {
    if (next === "import") {
      setImportComparisons([]);
      void warmScheduleReader().catch(() => undefined);
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
    setParsedShifts(nextParsedShifts);
    setParsedFlights(nextParsedFlights);
    setImportedDates(nextDates);
    localStorage.setItem("shiftdeck.activeDates", JSON.stringify(nextDates));
    return matching.length;
  };

  const processFiles = async (files: File[], options?: { person?: string; fromShare?: boolean }) => {
    if (!files.length || importState === "reading") return;
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
        let lastPreviewFrame = performance.now();
        const updateScanFile = (patch: Partial<ImportPreviewFile>) => {
          if (patch.image || patch.pass) lastPreviewFrame = performance.now();
          setScanFile((current) => current?.index === index ? { ...current, ...patch } : current);
        };
        const shiftReads: ScanMark[] = [];
        let scan: ScanPreviewPass | undefined;
        try {
          const [hash, read] = await Promise.all([
            hashFile(file),
            isPdf
              ? (progress.stage(1), parseCharterPdf(file, (image) => updateScanFile({ image })))
              : readScheduleImage(file, {
                  matchesSourceRow: (name) => Boolean(person) && nameKey(resolveMergedName(
                    resolveSchedulePersonName(name, knownNames),
                    nameMerges,
                  )) === nameKey(person),
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
          const uncertainShifts = parsed.shifts.filter((shift) =>
            shiftConfidence.get(`${shift.date}|${shift.worker}|${shift.start}|${shift.end}`) === false,
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
          const remaining = 230 - (performance.now() - lastPreviewFrame);
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
        setImportState("error");
        return;
      }

      const count = loadParsedSchedules(parsedSchedules, confirmedDaysOff, person);
      nextDocuments = nextDocuments.sort((a, b) =>
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
      setImportState("review");
      setToast("Schedule imported");
    } catch {
      await finishScanPreview();
      setImportState("error");
      setImportMessage(
        "The readable schedule details couldn’t be saved. Please try again.",
      );
    } finally {
      setScanFile(null);
      if (sheetRef.current !== "import") void releaseScheduleReader();
    }
  };


  const importShared = ({ directory: nextDirectory, contacts: nextContacts, files, summary, person }: SharedImport) => {
    if (nextDirectory) saveDirectory(nextDirectory);
    if (nextContacts) saveContacts(nextContacts);
    if (person) savePrefs({ person });
    setIncoming(null);
    if (summary.length) setToast(summary.join(" · "));
    if (files.length) {
      openSheet("import");
      // The normal import, ending on "Your shifts vs. the photo".
      void processFiles(files, { person: person || undefined, fromShare: true });
    }
  };

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
      const replaceShift = (shifts: Shift[]) =>
        shifts.map((shift) => shift.id === imported.shift.id ? correctedShift : shift);
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
        ...current.filter((shift) => shift.id !== imported.shift.id && shift.id !== editing?.id),
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
    setSelectedDate(workdayFor(eventCalendarDate(nextEvent), nextEvent.start));
    setShiftEditor(null);
    setToast(imported || editing || existingOnDate ? "Shift updated" : "Shift added");
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

      {importState === "review" && team && justImported.length > 0 && (
        <TeamSendPrompt
          key={justImported.join("|")}
          team={team}
          what={describeShare({
            weeks: scheduleDocuments.filter((document) => justImported.includes(document.id)).map((document) => document.dates),
          }) || "this schedule"}
          onSend={() => sendImportToTeam({ documentIds: justImported })}
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
            {scheduleDocuments.map((document) => {
              const isExpanded = expandedDocument === document.id;
              const prepared = preparedReviews[document.hash];
              return (
                <article
                  className={`upload-document ${isExpanded ? "expanded" : ""}`}
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
            onClick={() => setClearConfirmOpen(true)}
          >
            <Trash2 /> Clear all imports
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
      />
    ),
    map: (
      <LiveMapPanel
        url={calendarServiceUrl("/api/planes")}
        liveFlights={liveFlights.live?.flights ?? []}
      />
    ),
    weather: (
      <WeatherPanel shift={myShift} />
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
      <header className="top-bar">
        <button className="brand" onClick={returnToToday} aria-label="Shiftdeck, back to today">
          <span><img src="./apple-touch-icon.png" alt="" /></span>
          <b>Shiftdeck</b>
        </button>
        <div className="top-actions">
          <button
            ref={airportAlertsButton}
            type="button"
            className={`airport-alert-button${notificationCount ? " has-alerts" : ""}`}
            aria-label={`Notifications${notificationCount ? ` (${notificationCount} new)` : ""}`}
            aria-haspopup="dialog"
            onClick={openNotifications}
          >
            <Bell aria-hidden="true" />
            {notificationCount > 0 && <i aria-hidden="true">{notificationCount}</i>}
          </button>
          <button type="button" onClick={() => openSheet("import")} aria-label="Import schedule">
            <Upload />
            <span>Import</span>
          </button>
          <button type="button" onClick={() => openSheet("swap")} aria-label="Shift swap">
            <ArrowLeftRight />
            <span>Swap</span>
          </button>
          <button type="button" onClick={() => { setSettingsSnapshot(JSON.stringify(prefs)); setSettingsOpen(true); }} aria-label="Open settings">
            <Settings />
          </button>
        </div>
      </header>

      <dialog
        ref={airportAlertsDialog}
        className="panel-sheet airport-alerts-sheet"
        aria-labelledby="airport-alerts-title"
        onClose={() => {
          // Answers shown while the popup was open count as seen.
          updateSentSwaps((current) => current.some((swap) => swap.status !== "waiting" && !swap.seen)
            ? current.map((swap) => swap.status !== "waiting" ? { ...swap, seen: true } : swap)
            : current);
          setNotificationsInfo(false);
          markPostsSeen(teamInbox.map((post) => post.id));
          airportAlertsButton.current?.focus();
        }}
      >
        <header className="sheet-head notifications-head">
          <h2 id="airport-alerts-title">Notifications</h2>
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
          {notificationsInfo && (
            <div className="notifications-about">
              <p>
                <b>Swap replies</b> show up here when a coworker answers a swap you sent by email or text.
              </p>
              <p>
                <b>{team ? team.name : "Your team"}</b>: schedules and info your teammates send. Start or join a
                team in Settings → Team.
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
            <section className="notice-group" aria-label={team?.name ?? "Team"}>
              <h3>{team?.name ?? "Team"}</h3>
              <ul className="swap-reply-list team-post-list">
                {teamInbox.map((post) => (
                  <li key={post.id} className={seenPosts.includes(post.id) ? "" : "is-new"}>
                    <span className="swap-reply-icon"><Users /></span>
                    <div>
                      <b>{post.from.split(" ")[0]} shared {post.what}</b>
                      <small>{formatUpdatedAt(post.createdAt)}</small>
                    </div>
                    <button
                      type="button"
                      className="airport-alert-dismiss team-post-open"
                      onClick={() => {
                        markPostsSeen([post.id]);
                        airportAlertsDialog.current?.close();
                        if (team) openIncomingShare({ id: post.shareId, key: team.key });
                      }}
                    >
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!liveSwapReplies.length && !airportNoticeCount && !teamInbox.length && (
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
              {settingsSnapshot !== null && settingsSnapshot !== JSON.stringify(prefs) ? (
                  <button
                  className="settings-save"
                  onClick={() => {
                    setSettingsOpen(false);
                    setToast("Preferences saved on this device");
                  }}
                  aria-label="Save preferences"
                >
                  <Check /> Save
                </button>
                ) : (
                  <button onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X /></button>
                )}
              </div>
            </header>
            <div className="settings-name-row">
              <label>
                <span>Your name on the schedule</span>
                <select value={prefs.person} onChange={(event) => savePrefs({ person: event.target.value })}>
                  {!prefs.person && <option value="" disabled>Choose your name</option>}
                  {availableWorkers.map((worker) => (
                    <option value={worker} key={worker}>
                      {isGroundSecurityCoordinator(worker) ? `${worker} · GSC` : worker}
                    </option>
                  ))}
                </select>
                <ChevronDown />
              </label>
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
            <div className="theme-setting compact">
              <span>Flight app</span>
              <div role="group" aria-label="Open flights in">
                <button className={prefs.flightApp === "flightaware" ? "active" : ""} onClick={() => savePrefs({ flightApp: "flightaware" })}>FlightAware</button>
                <button className={prefs.flightApp === "flightradar24" ? "active" : ""} onClick={() => savePrefs({ flightApp: "flightradar24" })}>Flightradar24</button>
              </div>
            </div>
            <HomeOrderRow order={homeOrder} onChange={saveHomeOrder} />
            <div className="settings-tiles">
              <button
                type="button"
                className="settings-tile"
                onClick={() => {
                  setSettingsOpen(false);
                  setContactsOpen({});
                }}
              >
                <span><Users /> Coworker contacts</span>
                <b>
                  {(() => {
                    const count = contactWorkers.filter((worker) => {
                      const contact = contacts[contactKey(worker)];
                      return Boolean(contact?.email || contact?.phone);
                    }).length;
                    return count ? `${count} saved for swaps` : "For swap emails";
                  })()}
                </b>
              </button>
              <button
                type="button"
                className="settings-tile"
                onClick={() => {
                  setSettingsOpen(false);
                  setDirectoryOpen(true);
                }}
              >
                <span><BookUser /> Directory</span>
                <b>{directory.length ? `${directory.length} people & lines` : "Import the phone list"}</b>
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
              <button
                type="button"
                className="settings-tile wide"
                onClick={() => {
                  setSettingsOpen(false);
                  setShareOpen(true);
                }}
              >
                <span><Users /> Team</span>
                <b>{team ? `${team.name} · ${team.members?.length ?? 1} ${(team.members?.length ?? 1) === 1 ? "member" : "members"}` : "Start or join a team"}</b>
              </button>
            </div>
            {liveFlights.live?.status && (
              <LiveStatusSetting
                status={liveFlights.live.status}
                updatedAt={liveFlights.live.airportBoardUpdatedAt ? null : liveFlights.live.updatedAt}
              />
            )}
            {liveFlights.live && (
              <LearningSetting url={calendarServiceUrl("/api/flights/learning")} />
            )}
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
          loadFile={(id) => loadScheduleImage(id)}
          team={team}
          inviteUrl={team ? inviteLink(team, `${window.location.origin}${window.location.pathname}`) : ""}
          onCreateTeam={async (teamName) => {
            updateTeam(await createTeam(CALENDAR_SERVICE_ORIGIN, {
              teamName,
              name: prefs.person || "Me",
              profile: notificationProfile,
            }));
          }}
          onLeaveTeam={() => {
            const leaving = team;
            updateTeam(null);
            if (leaving) void leaveTeam(CALENDAR_SERVICE_ORIGIN, leaving).catch(() => undefined);
          }}
          onSendToTeam={sendToTeam}
          onOpenInvite={(key) => {
            setShareOpen(false);
            openInvite(key);
          }}
          onClose={() => setShareOpen(false)}
        />
      )}

      {invite && (
        <TeamJoinSheet
          preview={invite.preview}
          error={invite.error}
          leaving={team && team.id !== invite.invite.id ? team.name : undefined}
          link={invite.link}
          defaultName={prefs.person}
          onJoin={async (name) => {
            const previous = team;
            const joined = await joinTeam(CALENDAR_SERVICE_ORIGIN, invite.invite, { name, profile: notificationProfile });
            if (previous && previous.id !== joined.id) void leaveTeam(CALENDAR_SERVICE_ORIGIN, previous).catch(() => undefined);
            updateTeam({ ...joined, members: [...(invite.preview?.members ?? []), name] });
            if (!prefs.person) savePrefs({ person: name });
            setInvite(null);
            setToast(notificationProfile
              ? `You joined ${joined.name}`
              : `You joined ${joined.name}. Turn on notifications in Settings to get pinged.`);
          }}
          onClose={() => setInvite(null)}
        />
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
          onClose={() => setIncoming(null)}
        />
      )}

      {directoryOpen && (
        <DirectorySheet
          entries={directory}
          workers={[prefs.person, ...contactWorkers].filter(Boolean)}
          coworkers={contactWorkers}
          contacts={contacts}
          team={team}
          onSendToTeam={() => sendImportToTeam({ directory: true })}
          onChange={saveDirectory}
          onClose={() => setDirectoryOpen(false)}
        />
      )}

      {contactsOpen && (
        <ContactsSheet
          workers={contactWorkers}
          contacts={contacts}
          focus={contactsOpen.focus}
          onChange={saveContacts}
          directory={directory}
          onDirectoryChange={saveDirectory}
          team={team}
          onSendToTeam={() => sendImportToTeam({ contacts: true })}
          onClose={() => setContactsOpen(null)}
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
            setSettingsSnapshot(JSON.stringify(prefs));
            setSettingsOpen(true);
          }}
        />
      )}

      {clearConfirmOpen && (
        <div className="modal-layer" role="presentation" {...backdropClose(() => setClearConfirmOpen(false))}>
          <section className="confirm-card" role="alertdialog" aria-modal="true">
            <span className="confirm-icon danger"><Trash2 /></span>
            <h2>Clear all imports?</h2>
            <p>This deletes every uploaded schedule and the shifts and flights imported from them on this device. Your settings stay.</p>
            <div>
              <button className="button soft" onClick={() => setClearConfirmOpen(false)}>Cancel</button>
              <button className="button danger" onClick={clearAllImports}>Clear imports</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast"><Check /> {toast}</div>}
    </div>
  );
}
