/**
 * Who's new, who's leaving, and who's gone, from the schedules you've
 * imported. Someone has left when their last week on the schedule says so
 * ("GOOD LUCK!", "BYE", "Last day") or when the two schedules uploaded after
 * their last week don't have them. Someone is new when the latest schedule is
 * their first one (and it's not your first upload), or it says "First Day".
 * Showing up again on a later schedule makes them current again.
 */
import { FAREWELL_NOTE, FIRST_DAY_NOTE } from "./schedule-parser.ts";
import type { Shift } from "./sample-data.ts";

export type RosterStatus =
  | { state: "current" }
  | { state: "new"; firstDay?: string }
  | { state: "leaving"; lastDay: string; why: "note" }
  | { state: "left"; lastDay?: string; why: "note" | "missing" };

const DAY = 86_400_000;
/** The Sunday that starts the week `date` is in (schedules run Sunday–Saturday). */
export const weekOf = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`);
  return new Date(day.getTime() - day.getUTCDay() * DAY).toISOString().slice(0, 10);
};

/** Missing from this many uploaded weeks in a row after their last one means they've left. */
const MISSING_WEEKS = 2;

export function rosterStatuses(shifts: Shift[], today: string): Map<string, RosterStatus> {
  const uploaded = [...new Set(shifts.map((shift) => weekOf(shift.date)))].sort();
  const latest = uploaded.at(-1);
  const byWorker = new Map<string, Shift[]>();
  for (const shift of shifts) byWorker.set(shift.worker, [...(byWorker.get(shift.worker) ?? []), shift]);

  const result = new Map<string, RosterStatus>();
  for (const [worker, theirs] of byWorker) {
    const weeks = [...new Set(theirs.map((shift) => weekOf(shift.date)))].sort();
    const lastWeek = weeks.at(-1)!;
    const firstWeek = weeks[0];
    const inLastWeek = theirs.filter((shift) => weekOf(shift.date) === lastWeek).sort((a, b) => a.date.localeCompare(b.date));
    const working = (list: Shift[]) => list.filter((shift) => shift.status === "working").map((shift) => shift.date).sort();

    // Their last week on the schedule says goodbye: the last day is their last shift before the note.
    const farewell = inLastWeek.find((shift) => shift.note && FAREWELL_NOTE.test(shift.note));
    if (farewell) {
      const before = working(inLastWeek).filter((date) =>
        date < farewell.date || (date === farewell.date && FAREWELL_NOTE.test(farewell.note ?? "") && farewell.status === "working"));
      const lastDay = before.at(-1) ?? working(theirs).at(-1) ?? farewell.date;
      result.set(worker, lastDay >= today ? { state: "leaving", lastDay, why: "note" } : { state: "left", lastDay, why: "note" });
      continue;
    }

    const weeksSince = uploaded.filter((week) => week > lastWeek).length;
    if (weeksSince >= MISSING_WEEKS) {
      result.set(worker, { state: "left", lastDay: working(theirs).at(-1), why: "missing" });
      continue;
    }

    const started = theirs.filter((shift) => weekOf(shift.date) === firstWeek)
      .find((shift) => shift.note && FIRST_DAY_NOTE.test(shift.note));
    const recentStart = Boolean(started) && uploaded.filter((week) => week > firstWeek).length < MISSING_WEEKS;
    if (recentStart || (firstWeek === latest && uploaded.length > 1)) {
      result.set(worker, { state: "new", firstDay: started?.date ?? working(theirs)[0] });
      continue;
    }
    result.set(worker, { state: "current" });
  }
  return result;
}

/** People no longer on the schedule (yours never counts). */
export const hasLeft = (status: RosterStatus | undefined) => status?.state === "left";

const short = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** "New", "Last day Fri, Nov 14", "Left · last day Nov 7", or nothing. */
export function rosterLabel(status: RosterStatus | undefined) {
  if (!status) return "";
  if (status.state === "new") return status.firstDay ? `New · started ${short(status.firstDay)}` : "New";
  if (status.state === "leaving") return `Last day ${short(status.lastDay)}`;
  if (status.state === "left") return status.lastDay ? `Left · last day ${short(status.lastDay)}` : "Left";
  return "";
}
