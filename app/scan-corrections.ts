import type { Flight, Shift } from "./sample-data";
import type { ScanMeaning } from "./scan-annotations";
import type { ScanGeometry, ScanMark, ScheduleSourceLayout } from "./schedule-parser";

export type ScanEdits = {
  sourceDates: string[];
  dates: Record<string, string>;
  workers: Record<string, string>;
};

type CorrectionInput = {
  dates: string[];
  shifts: Shift[];
  flights: Flight[];
  scanEdits?: ScanEdits;
};

type Change<T> = { before?: T; after: T };
type Correction = {
  ok: true;
  schedule: CorrectionInput;
  shifts: Change<Shift>[];
  flights: Change<Flight>[];
  movedDate?: { from: string; to: string };
  renamedWorker?: { from: string; to: string };
};
type Result = Correction | { ok: false; message: string };

const workerKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const shiftId = (shift: Shift) =>
  `${shift.date}-${shift.worker}-${shift.status === "working" ? shift.start : shift.status}`;

export function meaningsAffectSchedule(mark: ScanMark, meanings: ScanMeaning[]) {
  return meanings.some((meaning) => meaning.kind !== "note" || Boolean(mark.shift));
}

export function recognizedScanMeanings(mark: ScanMark): ScanMeaning[] {
  if (mark.shift) return [{ kind: "range", start: mark.shift.start, end: mark.shift.end }];
  if (mark.flight) {
    const { arrival, departure, trackingId, origin, destination } = mark.flight;
    return [{
      kind: "flight", identifier: trackingId ?? "", origin: origin === "HOME" ? "" : origin,
      destination: destination ?? "", arrival: arrival ?? "", departure: departure ?? "",
    }];
  }
  return [];
}

export function applyScanCorrection(
  schedule: CorrectionInput,
  mark: ScanMark,
  meanings: ScanMeaning[],
  resolveWorker: (name: string) => string,
  geometry?: Pick<ScanGeometry, "dates">,
  layout?: ScheduleSourceLayout,
): Result {
  const fail = (message: string) => ({ ok: false as const, message });
  const scanEdits: ScanEdits = {
    sourceDates: schedule.scanEdits?.sourceDates ?? geometry?.dates ?? schedule.dates,
    dates: { ...schedule.scanEdits?.dates },
    workers: { ...schedule.scanEdits?.workers },
  };
  const flightSlot = mark.id.match(/^flight:(\d+):(\d+)$/);
  const rawDate = mark.date ?? mark.shift?.date ??
    (mark.kind === "shift" || mark.kind === "date" ? mark.id.match(/\d{4}-\d{2}-\d{2}$/)?.[0] : undefined) ??
    (flightSlot ? scanEdits.sourceDates[Number(flightSlot[2])] : undefined);
  // Older scans stored unreadable flight text without a slot. Locate it only
  // when it lies above the roster header and inside a known schedule column.
  const flightColumn = mark.kind === "text" && layout &&
    mark.x >= layout.left && mark.x < layout.right &&
    mark.y + mark.height / 2 - layout.slope * mark.x < layout.header.top
    ? layout.centers.findIndex((center) => Math.abs(mark.x + mark.width / 2 - center) < layout.spacing / 2)
    : -1;
  const sourceDate = rawDate ?? scanEdits.sourceDates[flightColumn];
  const date = sourceDate && (scanEdits.dates[sourceDate] ?? sourceDate);
  const worker = mark.worker && (scanEdits.workers[workerKey(mark.worker)] ?? resolveWorker(mark.worker));
  const dateChange = meanings.find((item) => item.kind === "date");
  const personChange = meanings.find((item) => item.kind === "person");
  const shiftMeaning = meanings.find((item) =>
    item.kind === "range" || item.kind === "off" || item.kind === "pto");
  const timeMeaning = meanings.find((item) => item.kind === "time");
  const note = meanings.filter((item) => item.kind === "note").map((item) => item.text.trim()).filter(Boolean).join(" · ");
  const flightMeaning = meanings.find((item) => item.kind === "flight");

  const count = (kinds: ScanMeaning["kind"][]) => meanings.filter((meaning) => kinds.includes(meaning.kind)).length;
  if (count(["range", "off", "pto"]) > 1 || count(["flight"]) > 1 || count(["time"]) > 1 ||
    count(["date"]) > 1 || count(["person"]) > 1 || (timeMeaning && shiftMeaning)) {
    return fail("Choose one time, shift status, date, worker, or flight for this spot.");
  }

  let movedDate: Correction["movedDate"];
  if (dateChange) {
    if (!sourceDate || !date || !schedule.dates.includes(date)) return fail("This highlight has no schedule date to correct.");
    if (date !== dateChange.date) {
      if (mark.kind !== "date") return fail("Select the date at the top of the column to change its date.");
      if (schedule.dates.includes(dateChange.date)) return fail("This schedule already has a column for that date.");
      movedDate = { from: date, to: dateChange.date };
      scanEdits.dates[sourceDate] = dateChange.date;
    }
  }

  let renamedWorker: Correction["renamedWorker"];
  if (personChange) {
    if (mark.kind !== "name" || !mark.worker || !worker) return fail("Select the worker’s name to change their row.");
    const name = personChange.text.trim().replace(/\s+/g, " ");
    if (name !== worker) {
      if (workerKey(name) !== workerKey(worker) &&
        schedule.shifts.some((shift) => workerKey(shift.worker) === workerKey(name))) {
        return fail("That worker already has a row in this schedule.");
      }
      renamedWorker = { from: worker, to: name };
      scanEdits.workers[workerKey(mark.worker)] = name;
    }
  }

  const shiftChanges: Change<Shift>[] = [];
  const flightChanges: Change<Flight>[] = [];
  const useShiftTime = mark.kind === "shift" ? timeMeaning : undefined;
  if (shiftMeaning || useShiftTime || (note && mark.kind === "shift")) {
    if (mark.kind !== "shift" || !date || !worker || !schedule.dates.includes(date)) {
      return fail("Select a cell in a worker’s row to change their shift.");
    }
    const candidates = schedule.shifts.filter((shift) =>
      shift.date === date && workerKey(shift.worker) === workerKey(worker));
    const exact = mark.shift && candidates.find((shift) =>
      shift.start === mark.shift?.start && shift.end === mark.shift?.end);
    const before = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!before && candidates.length > 1) return fail("More than one shift matches this cell. Edit the shift in Imported results.");
    if (useShiftTime && before?.status !== "working") {
      return fail("Use Time range to add a shift with a start and an end.");
    }
    if (shiftMeaning || useShiftTime || before) {
      const status: Shift["status"] = shiftMeaning?.kind === "off" ? "off"
        : shiftMeaning?.kind === "pto" ? "pto" : shiftMeaning || useShiftTime ? "working" : before?.status ?? "off";
      const after: Shift = {
        id: "", date, worker: before?.worker ?? worker, status,
        start: status !== "working" ? "" : shiftMeaning?.kind === "range" ? shiftMeaning.start
          : useShiftTime ? useShiftTime.time : before?.start ?? "",
        end: status !== "working" ? "" : shiftMeaning?.kind === "range" ? shiftMeaning.end : before?.end ?? "",
        note: note || before?.note,
        ...(before?.workerConfirmed || scanEdits.workers[workerKey(mark.worker ?? "")] ? { workerConfirmed: true } : {}),
      };
      after.id = shiftId(after);
      shiftChanges.push({ before, after });
    }
  }

  const useFlightTime = mark.kind === "flight" && !flightMeaning ? timeMeaning : undefined;
  if (timeMeaning && !useShiftTime && !useFlightTime && !flightMeaning) {
    return fail("Select a shift or flight cell to change its scheduled time.");
  }

  if (flightMeaning || useFlightTime) {
    if (!date || !schedule.dates.includes(date)) return fail("This flight highlight has no identifiable schedule date.");
    const slotIndex = flightSlot && Number(flightSlot[1]) * 7 + Number(flightSlot[2]);
    const before = schedule.flights.find((flight) => flight.id === mark.flight?.id) ??
      (flightSlot ? schedule.flights.find((flight) => flight.date === date &&
        flight.id.split("-").at(-2) === String(slotIndex)) : undefined) ??
      schedule.flights.find((flight) => flight.id === `scan:${date}:${mark.id}`) ??
      (mark.kind === "flight" || flightColumn >= 0 ? schedule.flights.find((flight) =>
        flight.date === date && flight.raw === mark.text) : undefined);
    if (useFlightTime && (!before || before.kind === "turnaround")) {
      return fail("Use Flight to specify an arrival or departure time.");
    }
    const arrival = flightMeaning?.arrival || (useFlightTime && before?.kind === "arrival" ? useFlightTime.time : before?.arrival);
    const departure = flightMeaning?.departure || (useFlightTime && before?.kind === "departure" ? useFlightTime.time : before?.departure);
    const start = arrival || departure;
    if (!start) return fail("Add an arrival or departure time to put this flight on the schedule.");
    const kind: Flight["kind"] = arrival && departure ? "turnaround" : arrival ? "arrival" : "departure";
    const origin = flightMeaning?.origin || before?.origin || (kind === "departure" ? "HOME" : "");
    const destination = flightMeaning?.destination || before?.destination || undefined;
    const hour = Number(start.slice(0, 2));
    const period = mark.period ?? before?.period ?? (hour < 11 ? "Morning" : hour < 19 ? "Afternoon" : "Evening");
    flightChanges.push({
      before,
      after: {
        ...before, id: before?.id ?? `scan:${date}:${mark.id}`,
        date, origin, destination, period, kind, start,
        raw: mark.text, trackingId: flightMeaning?.identifier || before?.trackingId,
        inboundAirport: arrival ? origin : undefined,
        outboundAirport: departure ? destination : undefined,
        arrival, departure, end: kind === "turnaround" ? departure : undefined,
      },
    });
  }

  if (movedDate || renamedWorker) {
    for (const shift of schedule.shifts) {
      const nextDate = movedDate?.from === shift.date ? movedDate.to : shift.date;
      const nextWorker = renamedWorker && workerKey(renamedWorker.from) === workerKey(shift.worker)
        ? renamedWorker.to : shift.worker;
      if (nextDate === shift.date && nextWorker === shift.worker) continue;
      const after = {
        ...shift, date: nextDate, worker: nextWorker,
        ...(nextWorker !== shift.worker ? { workerConfirmed: true } : {}),
      };
      after.id = shiftId(after);
      shiftChanges.push({ before: shift, after });
    }
    if (movedDate) {
      for (const flight of schedule.flights) {
        if (flight.date === movedDate.from) flightChanges.push({ before: flight, after: { ...flight, date: movedDate.to } });
      }
    }
  }

  return {
    ok: true, shifts: shiftChanges, flights: flightChanges, movedDate, renamedWorker,
    schedule: {
      dates: schedule.dates.map((day) => day === movedDate?.from ? movedDate.to : day),
      shifts: applyScanChanges(schedule.shifts, shiftChanges),
      flights: applyScanChanges(schedule.flights, flightChanges),
      scanEdits,
    },
  };
}

export function applyScanChanges<T extends { id: string }>(current: T[], changes: Change<T>[]): T[] {
  if (!changes.length) return current;
  const replaced = new Set(changes.flatMap(({ before, after }) => before ? [before.id, after.id] : [after.id]));
  return [...current.filter((item) => !replaced.has(item.id)), ...changes.map(({ after }) => after)];
}
