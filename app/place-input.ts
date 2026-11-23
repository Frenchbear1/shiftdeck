/**
 * Reads whatever gets pasted into the shift Location box: plain coordinates
 * (decimal, with or without N/S/E/W, or degrees-minutes-seconds), a geo: URI,
 * or a Google / Apple Maps link. Anything else is treated as a search.
 * Pure, so it's tested on its own (tests/place-input.test.mjs).
 */

export type PastedPlace = {
  latitude: number;
  longitude: number;
  /** A place name the link carried (Google /place/Name, Apple q=Name), if any. */
  name?: string;
};

/** ABE: what Shiftdeck uses until you pick somewhere else. */
export const ABE_PLACE = {
  label: "ABE Airport",
  /** What calendar apps get, so "ABE Airport" still finds the right spot. */
  address: "Lehigh Valley International Airport (ABE), 3311 Airport Rd, Allentown, PA 18109",
  latitude: 40.65382,
  longitude: -75.43225,
} as const;

/** The address Shiftdeck used to default to (moved over to ABE_PLACE). */
export const OLD_DEFAULT_LOCATION = "3311 Airport Rd, Allentown, PA 18109";

const valid = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180 &&
  // 0,0 is almost always a broken link, not a real place.
  !(latitude === 0 && longitude === 0);

const signed = (value: number, hemisphere: string | undefined, negative: string) =>
  hemisphere ? Math.abs(value) * (hemisphere === negative ? -1 : 1) : value;

/** One coordinate: 40.65, 40.65° N, 40°39'13.8"N, N 40 39 13.8, 40° 39.23' N … */
function readAngle(text: string): { value: number; hemisphere?: string } | null {
  const cleaned = text
    .trim()
    .toUpperCase()
    .replace(/[−–—]/g, "-")
    .replace(/[’′']/g, "'")
    .replace(/[”″"]|''/g, '"');
  const match = cleaned.match(
    /^([NSEW])?\s*([+-]?\d{1,3}(?:\.\d+)?)\s*(?:°|º|D|DEG|\s)?\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:'|M|MIN|\s)?\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|S|SEC)?\s*)?([NSEW])?$/,
  );
  if (!match) return null;
  const [, before, degreesText, minutesText, secondsText, after] = match;
  if (before && after) return null;
  const degrees = Number(degreesText);
  const minutes = minutesText ? Number(minutesText) : 0;
  const seconds = secondsText ? Number(secondsText) : 0;
  if (minutes >= 60 || seconds >= 60) return null;
  const magnitude = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  const value = degreesText.startsWith("-") ? -magnitude : magnitude;
  return { value, hemisphere: before ?? after };
}

/** "lat, lon" in any of the forms above (comma, semicolon or just a space between). */
export function parseCoordinates(text: string): PastedPlace | null {
  const value = text.trim().replace(/^\(|\)$/g, "").trim();
  if (!value || /[a-z]{4,}/i.test(value.replace(/\b(?:deg|min|sec)\b/gi, ""))) return null;
  const splits: Array<[string, string]> = [];
  const separator = value.match(/^(.+?)\s*[,;/]\s*(.+)$/);
  if (separator) splits.push([separator[1], separator[2]]);
  else {
    // No comma: split after the first hemisphere letter, or between two plain numbers.
    for (const byLetter of [value.match(/^([NS].+?)\s+([EW].+)$/i), value.match(/^(.*?\d.*?[NS])\s*(.+)$/i)]) {
      if (byLetter) splits.push([byLetter[1], byLetter[2]]);
    }
    const byNumber = value.match(/^([+-]?\d{1,2}(?:\.\d+)?)\s+([+-]?\d{1,3}(?:\.\d+)?)$/);
    if (byNumber) splits.push([byNumber[1], byNumber[2]]);
  }
  for (const [first, second] of splits) {
    const a = readAngle(first);
    const b = readAngle(second);
    if (!a || !b) continue;
    // Longitude written first (75.4° W, 40.6° N): swap.
    const flipped = (a.hemisphere === "E" || a.hemisphere === "W") && (!b.hemisphere || b.hemisphere === "N" || b.hemisphere === "S");
    const lat = flipped ? b : a;
    const lon = flipped ? a : b;
    if (lat.hemisphere && !/[NS]/.test(lat.hemisphere)) continue;
    if (lon.hemisphere && !/[EW]/.test(lon.hemisphere)) continue;
    const latitude = signed(lat.value, lat.hemisphere, "S");
    const longitude = signed(lon.value, lon.hemisphere, "W");
    if (valid(latitude, longitude)) return { latitude, longitude };
  }
  return null;
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).trim();
  } catch {
    return value.trim();
  }
};

/** A Google Maps / Apple Maps / geo: link with a spot in it. */
export function parseMapLink(text: string): PastedPlace | null {
  const value = text.trim();
  const geo = value.match(/^geo:([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/i);
  if (geo) {
    const latitude = Number(geo[1]);
    const longitude = Number(geo[2]);
    const label = value.match(/[?&]q=[^&(]*\(([^)]+)\)/i);
    return valid(latitude, longitude) ? { latitude, longitude, name: label ? decode(label[1]) : undefined } : null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  const google = /(^|\.)google\.[a-z.]+$/.test(host) || host === "maps.app.goo.gl" || host === "goo.gl";
  const apple = host === "maps.apple.com" || host === "maps.apple";
  if (!google && !apple) return null;
  const params = url.searchParams;
  const path = decode(url.pathname);
  const fromPair = (pair: string | null | undefined) => (pair ? parseCoordinates(decode(pair)) : null);

  let spot: PastedPlace | null = null;
  if (google) {
    // !3d…!4d… is the pin itself; @lat,lon is only the map's center, so it comes second.
    const pin = value.match(/!3d([+-]?\d+(?:\.\d+)?)!4d([+-]?\d+(?:\.\d+)?)/);
    if (pin) spot = { latitude: Number(pin[1]), longitude: Number(pin[2]) };
    spot ??= fromPair(params.get("q")) ?? fromPair(params.get("query")) ?? fromPair(params.get("ll")) ??
      fromPair(params.get("destination")) ?? fromPair(params.get("center"));
    if (!spot) {
      const inPath = path.match(/\/(?:place|search|dir)\/([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/);
      if (inPath) spot = { latitude: Number(inPath[1]), longitude: Number(inPath[2]) };
    }
    if (!spot) {
      const center = value.match(/@([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/);
      if (center) spot = { latitude: Number(center[1]), longitude: Number(center[2]) };
    }
    const place = path.match(/\/place\/([^/@]+)/);
    if (spot && place && !parseCoordinates(place[1])) spot.name = place[1].replace(/\s+/g, " ").trim();
  } else {
    spot = fromPair(params.get("coordinate")) ?? fromPair(params.get("ll")) ?? fromPair(params.get("sll")) ??
      fromPair(params.get("q")) ?? fromPair(params.get("daddr"));
    const name = params.get("name") ?? params.get("q") ?? params.get("address");
    if (spot && name && !parseCoordinates(name)) spot.name = decode(name);
  }
  return spot && valid(spot.latitude, spot.longitude) ? spot : null;
}

/** Short share links (maps.app.goo.gl/…) don't have the spot in them until they're opened. */
export const isShortMapLink = (text: string) =>
  /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text.trim());

/** Coordinates or a map link: the spot. Anything else: null (search it instead). */
export const parsePastedPlace = (text: string): PastedPlace | null =>
  parseMapLink(text) ?? parseCoordinates(text);

export const formatCoordinates = (latitude: number, longitude: number) =>
  `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? "S" : "N"}, ${Math.abs(longitude).toFixed(5)}° ${longitude < 0 ? "W" : "E"}`;

/** Is this the ABE default (by name, or a pin within ~150 m of it)? */
export const isAbePlace = (label: string, latitude: number | null, longitude: number | null) =>
  label.trim() === ABE_PLACE.label &&
  (latitude == null || longitude == null ||
    (Math.abs(latitude - ABE_PLACE.latitude) < 0.0015 && Math.abs(longitude - ABE_PLACE.longitude) < 0.002));

/** Opens the spot in the device's maps app. */
export function mapsLink(label: string, latitude: number, longitude: number, android: boolean) {
  const name = encodeURIComponent(label.trim() || "Work");
  return android
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : `https://maps.apple.com/?ll=${latitude},${longitude}&q=${name}`;
}
