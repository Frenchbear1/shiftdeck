/**
 * Shifts you add, change or delete by hand, so your other devices make the
 * same change. One record per day (your shift that day, or none), with when
 * it was made; a device applies a record it hasn't seen, and the newest one
 * for a day wins. A fix to an imported schedule also says which photo it
 * corrects, so it's applied to that photo's shifts too (and to the photo
 * when it arrives later from your other device).
 *
 * Pure: page.tsx keeps the records and applies them.
 */
import type { Shift } from "./sample-data.ts";
import { stable } from "./vault-data.ts";

/** A correction to an imported schedule: `fromId` became `shift` (or `shift` was added for a day it missed). */
export type EditFix = { hash: string; fromId: string; shift: Shift; adding: boolean };
export type ShiftEdit<E> = { at: number; event: E | null; fix?: EditFix };
export type ShiftEdits<E> = Record<string, ShiftEdit<E>>;

const KEY = "shiftdeck.shiftEdits";
/** Days this far back are forgotten. */
const KEEP_DAYS = 120;

export function loadShiftEdits<E>(today: string): ShiftEdits<E> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as ShiftEdits<E>;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return pruneEdits(saved, today);
  } catch {
    return {};
  }
}

export function saveShiftEdits<E>(edits: ShiftEdits<E>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(edits));
  } catch {
    // Kept for this visit (and in your vault).
  }
}

const daysBefore = (day: string, days: number) => {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
};

export function pruneEdits<E>(edits: ShiftEdits<E>, today: string): ShiftEdits<E> {
  const since = daysBefore(today, KEEP_DAYS);
  return Object.fromEntries(Object.entries(edits).filter(([date, edit]) =>
    date >= since && edit && typeof edit.at === "number"));
}

/** Days whose record from another device is newer than (and different from) this device's. */
export function newerEdits<E>(local: ShiftEdits<E>, incoming: ShiftEdits<E>): string[] {
  return Object.entries(incoming)
    .filter(([date, edit]) => edit && edit.at > (local[date]?.at ?? -1) && stable(edit) !== stable(local[date]))
    .map(([date]) => date)
    .sort();
}

/** Your events with that day's record applied (one shift a day, or none). */
export function applyEventEdit<E extends { date: string; start: string }>(events: E[], date: string, edit: ShiftEdit<E>): E[] {
  return [...events.filter((event) => event.date !== date), ...(edit.event ? [edit.event] : [])]
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
}

/** A photo's shifts with a fix applied (doing it twice changes nothing). */
export function applyFix(shifts: Shift[], fix: EditFix, sameWorker: (a: string, b: string) => boolean): Shift[] {
  if (fix.adding) {
    const sameDay = (shift: Shift) => shift.date === fix.shift.date && sameWorker(shift.worker, fix.shift.worker);
    return [...shifts.filter((shift) => !sameDay(shift) && shift.id !== fix.shift.id), fix.shift];
  }
  if (!shifts.some((shift) => shift.id === fix.fromId)) return shifts;
  return shifts.map((shift) => (shift.id === fix.fromId ? fix.shift : shift));
}

/** Every fix to one photo, oldest first. */
export function fixesFor<E>(edits: ShiftEdits<E>, hash: string): EditFix[] {
  return Object.values(edits)
    .filter((edit) => edit?.fix?.hash === hash)
    .sort((a, b) => a.at - b.at)
    .map((edit) => edit.fix!);
}
