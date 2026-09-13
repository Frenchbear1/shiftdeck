import type { Shift } from "./sample-data";

function localShiftDateTime(date: string, time: string) {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const value = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  return Number.isNaN(value.getTime()) ? null : value;
}

export function activeWorkingShiftAt(
  shifts: Shift[],
  person: string,
  now: Date,
) {
  const currentTime = now.getTime();
  return (
    shifts.find((shift) => {
      if (shift.worker !== person || shift.status !== "working") return false;
      const start = localShiftDateTime(shift.date, shift.start);
      const end = localShiftDateTime(shift.date, shift.end);
      if (!start || !end) return false;
      if (end <= start) end.setDate(end.getDate() + 1);
      return currentTime >= start.getTime() && currentTime < end.getTime();
    }) ?? null
  );
}

export function activeShiftSessionKey(shift: Shift) {
  return [shift.worker, shift.date, shift.start, shift.end].join("|");
}
