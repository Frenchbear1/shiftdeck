/**
 * Clocking in and out, and what a pay period comes to: hours rounded the way
 * the employer rounds them, pay at your wage, and the taxes Paycom takes out,
 * so you can check each paycheck. Everything stays on this device.
 */

export type Punch = {
  id: string;
  /** When you clocked in / out (ISO, to the second). */
  in: string;
  out?: string;
};

export type TaxLine = {
  id: string;
  label: string;
  /** percent: a share of gross; flat: dollars per paycheck; federal: the IRS brackets. */
  kind: "percent" | "flat" | "federal";
  /** Percent (6.2 = 6.2%) or dollars, by kind. */
  rate: number;
  on: boolean;
};

export type Deduction = { id: string; label: string; amount: number };

export type ClockSettings = {
  wage: number;
  /** Punches round to the nearest this many minutes (15: :07 past rounds down, :08 up). */
  roundTo: number;
  period: {
    /** Any day a pay period started on. */
    anchor: string;
    days: 7 | 14;
    /** Payday, in days after the period's last day (6: the Friday after a Saturday). */
    payAfter: number;
  };
  overtime: { on: boolean; afterHours: number; times: number };
  /** Federal withholding (single): the yearly amount not taxed (the standard deduction). */
  federalAllowance: number;
  taxes: TaxLine[];
  deductions: Deduction[];
};

/** What Paycom showed for a period, to compare. */
export type PaycomCheck = { hours?: number; gross?: number; net?: number };

export type ClockData = {
  punches: Punch[];
  settings: ClockSettings;
  checks: Record<string, PaycomCheck>;
};

/** Read from three of David's 2026 stubs (Hanover Twp / Catasauqua, PA). */
export const DEFAULT_SETTINGS: ClockSettings = {
  wage: 17.5,
  roundTo: 15,
  period: { anchor: "2026-07-05", days: 14, payAfter: 6 },
  overtime: { on: true, afterHours: 40, times: 1.5 },
  federalAllowance: 16_100,
  taxes: [
    { id: "federal", label: "Federal W/H (S)", kind: "federal", rate: 0, on: true },
    { id: "medicare", label: "Medicare", kind: "percent", rate: 1.45, on: true },
    { id: "social", label: "Social Security", kind: "percent", rate: 6.2, on: true },
    { id: "state", label: "Penn. State W/H", kind: "percent", rate: 3.07, on: true },
    { id: "local", label: "Hanover Twp / Catasauqua (EIT)", kind: "percent", rate: 1.6, on: true },
    { id: "lst", label: "LST Hanover Twp / Catasauqua", kind: "flat", rate: 2, on: true },
    { id: "ui", label: "Pennsylvania UI/HC/WF", kind: "percent", rate: 0.07, on: true },
  ],
  deductions: [],
};

/** 2026 federal brackets for single filers (yearly taxable income → rate). */
const FEDERAL_SINGLE_2026: Array<[number, number]> = [
  [0, 0.1],
  [12_400, 0.12],
  [50_400, 0.22],
  [105_700, 0.24],
  [201_775, 0.32],
  [256_225, 0.35],
  [640_600, 0.37],
];

const KEY = "shiftdeck.timeClock";
export const ROUND_CHOICES = [1, 5, 6, 10, 15, 30] as const;

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const DAY = 86_400_000;
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const atNoon = (day: string) => new Date(`${day}T12:00:00`);
export const addDays = (day: string, days: number) => isoDay(new Date(atNoon(day).getTime() + days * DAY));

export function loadClock(): ClockData {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ClockData> | null;
    const settings = { ...DEFAULT_SETTINGS, ...(saved?.settings ?? {}) };
    return {
      punches: Array.isArray(saved?.punches)
        ? saved.punches.filter((punch): punch is Punch => typeof punch?.id === "string" && typeof punch.in === "string")
        : [],
      settings: {
        ...settings,
        period: { ...DEFAULT_SETTINGS.period, ...settings.period },
        overtime: { ...DEFAULT_SETTINGS.overtime, ...settings.overtime },
        taxes: Array.isArray(settings.taxes) ? settings.taxes : DEFAULT_SETTINGS.taxes,
        deductions: Array.isArray(settings.deductions) ? settings.deductions : [],
      },
      checks: saved?.checks && typeof saved.checks === "object" ? saved.checks : {},
    };
  } catch {
    return { punches: [], settings: DEFAULT_SETTINGS, checks: {} };
  }
}

export function saveClock(data: ClockData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Kept for this visit.
  }
}

/**
 * A punch on the clock's grid: to the nearest step, with the halfway minute
 * rounding up (15: 6:53 → 7:00, 12:22 → 12:15, 12:23 → 12:30).
 */
export function roundPunch(at: Date, step: number) {
  const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  if (step <= 1) return minute;
  const past = minute.getMinutes() % step;
  const up = past >= Math.ceil(step / 2);
  return new Date(minute.getTime() + ((up ? step - past : -past) * 60_000));
}

/** Hours a punch counts for, once both ends are rounded. */
export function punchHours(punch: Punch, step: number, now = new Date()) {
  const start = roundPunch(new Date(punch.in), step);
  const end = roundPunch(punch.out ? new Date(punch.out) : now, step);
  return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
}

export type PayPeriod = { start: string; end: string; payday: string };

/** The pay period a day falls in. */
export function periodFor(day: string, settings: ClockSettings): PayPeriod {
  const { anchor, days, payAfter } = settings.period;
  const offset = Math.round((atNoon(day).getTime() - atNoon(anchor).getTime()) / DAY);
  const start = addDays(anchor, Math.floor(offset / days) * days);
  const end = addDays(start, days - 1);
  return { start, end, payday: addDays(end, payAfter) };
}

/** The period a punch counts in: the day you clocked in. */
export const punchDay = (punch: Punch) => isoDay(new Date(punch.in));

export type PeriodTotals = {
  hours: number;
  regular: number;
  overtime: number;
  gross: number;
  taxes: Array<{ id: string; label: string; amount: number }>;
  taxTotal: number;
  deductions: Array<{ id: string; label: string; amount: number }>;
  net: number;
};

/** Federal withholding for one paycheck (the IRS percentage method, single). */
export function federalWithholding(gross: number, allowance: number, periodsPerYear: number) {
  // Per paycheck, the way Paycom figures it: what's over the allowance, through the
  // brackets, in whole cents (so 10.265 rounds up to 10.27 like theirs).
  let taxable = Math.round(gross * 100) - Math.round((allowance / periodsPerYear) * 100);
  if (taxable <= 0) return 0;
  let tax = 0;
  for (let index = FEDERAL_SINGLE_2026.length - 1; index >= 0; index -= 1) {
    const floor = Math.round((FEDERAL_SINGLE_2026[index][0] / periodsPerYear) * 100);
    if (taxable > floor) {
      tax += (taxable - floor) * FEDERAL_SINGLE_2026[index][1];
      taxable = floor;
    }
  }
  return Math.round(tax + 1e-9) / 100;
}

/** What a period's punches come to, as a pay stub would show it. */
export function periodTotals(punches: Punch[], period: PayPeriod, settings: ClockSettings, now = new Date()): PeriodTotals {
  const inPeriod = punches.filter((punch) => {
    const day = punchDay(punch);
    return day >= period.start && day <= period.end;
  });
  // Overtime is counted per week (from the period's first day), as the law has it.
  const weeks = new Map<number, number>();
  for (const punch of inPeriod) {
    const week = Math.floor(Math.round((atNoon(punchDay(punch)).getTime() - atNoon(period.start).getTime()) / DAY) / 7);
    weeks.set(week, (weeks.get(week) ?? 0) + punchHours(punch, settings.roundTo, now));
  }
  let regular = 0;
  let overtime = 0;
  for (const hours of weeks.values()) {
    const extra = settings.overtime.on ? Math.max(0, hours - settings.overtime.afterHours) : 0;
    regular += hours - extra;
    overtime += extra;
  }
  const gross = cents(regular * settings.wage + overtime * settings.wage * settings.overtime.times);
  const periodsPerYear = settings.period.days === 7 ? 52 : 26;
  const taxes = gross > 0
    ? settings.taxes.filter((tax) => tax.on).map((tax) => ({
        id: tax.id,
        label: tax.label,
        amount: tax.kind === "federal"
          ? federalWithholding(gross, settings.federalAllowance, periodsPerYear)
          : tax.kind === "flat" ? cents(tax.rate) : cents((gross * tax.rate) / 100),
      }))
    : [];
  const taxTotal = cents(taxes.reduce((sum, tax) => sum + tax.amount, 0));
  const deductions = gross > 0 ? settings.deductions.map((item) => ({ ...item, amount: cents(item.amount) })) : [];
  const net = cents(gross - taxTotal - deductions.reduce((sum, item) => sum + item.amount, 0));
  return { hours: regular + overtime, regular, overtime, gross, taxes, taxTotal, deductions, net };
}

export const openPunch = (punches: Punch[]) => punches.find((punch) => !punch.out);

export const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** 7.5 → "7.50", like Paycom's Hours/Units. */
export const hoursText = (hours: number) => hours.toFixed(2);

export const clockText = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export const dayText = (day: string, options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) =>
  atNoon(day).toLocaleDateString("en-US", options);
