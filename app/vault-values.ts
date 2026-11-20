/**
 * What goes in your vault (vault-data.ts) and back out: the time clock
 * (punches, Paycom sheets, checks, pay settings), the settings that are
 * yours rather than this device's, and name merges.
 */
import { DEFAULT_SETTINGS, type ClockData, type ClockSettings, type PaycomCheck, type Punch } from "./time-clock.ts";
import type { PaycomSheet } from "./paycom-sheet.ts";
import { values, type Values, type Vault } from "./vault-data.ts";

/** Settings that follow you (not the theme, which is per device, or your name, which the server keeps). */
export const SYNCED_PREFS = [
  "title", "alerts", "location", "locationLat", "locationLon", "notes",
  "homeAirport", "airline", "flightApp", "flightTime", "flightAlerts",
] as const;

export function pickSyncedPrefs<T extends object>(prefs: T): Record<string, unknown> {
  const source = prefs as Record<string, unknown>;
  return Object.fromEntries(SYNCED_PREFS.filter((key) => key in source).map((key) => [key, source[key]]));
}

export function vaultValuesOf(clock: ClockData, prefs: object, nameMerges: Record<string, string>, dismissedMerges: string[]): Values {
  return {
    punch: Object.fromEntries(clock.punches.map((punch) => [punch.id, punch])),
    check: clock.checks,
    sheet: clock.sheets,
    clock: { settings: clock.settings },
    pref: pickSyncedPrefs(prefs),
    merge: nameMerges,
    mergeSkip: Object.fromEntries(dismissedMerges.map((key) => [key, true])),
  };
}

const byTime = (a: Punch, b: Punch) => a.in.localeCompare(b.in) || a.id.localeCompare(b.id);

/** The clock in the order the vault gives it back (punches by time). */
export const sortedClock = (clock: ClockData): ClockData => ({ ...clock, punches: [...clock.punches].sort(byTime) });

export function clockFromVault(vault: Vault): ClockData {
  const settings = values<ClockSettings>(vault, "clock").settings ?? DEFAULT_SETTINGS;
  return {
    punches: Object.values(values<Punch>(vault, "punch")).sort(byTime),
    settings,
    checks: values<PaycomCheck>(vault, "check"),
    sheets: values<PaycomSheet>(vault, "sheet"),
  };
}
