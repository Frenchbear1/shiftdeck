"use client";

import { Flip } from "./flip";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileUp, Loader2, Plus, RotateCcw, Timer, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { asPunch, compareSheet, isFlag, readPaycomSheet, type PaycomSheet, type SheetCheck } from "./paycom-sheet";
import { backdropClose } from "./home-sections";
import {
  addDays,
  clockText,
  DEFAULT_SETTINGS,
  dayText,
  hoursText,
  money,
  openPunch,
  periodFor,
  periodTotals,
  punchDay,
  punchHours,
  ROUND_CHOICES,
  roundPunch,
  type ClockData,
  type ClockSettings,
  type PayPeriod,
  type Punch,
} from "./time-clock";

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const newId = () => `punch-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const periodLabel = (period: PayPeriod) =>
  `${dayText(period.start, { month: "short", day: "numeric" })} – ${dayText(period.end, { month: "short", day: "numeric" })}`;
const elapsed = (from: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(from)) / 60_000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

/** Ticks every 20 seconds while something's running (for the clocked-in timer). */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/* ---------- the home card ---------- */

export function TimeClockCard({ data, onChange, onOpen, scheduled }: {
  data: ClockData;
  onChange: (data: ClockData) => void;
  onOpen: () => void;
  /** Today's shift, if any ("9 PM – 12:30 AM"). */
  scheduled?: string;
}) {
  const open = openPunch(data.punches);
  const now = useNow(Boolean(open));
  const [undo, setUndo] = useState<{ data: ClockData; text: string } | null>(null);
  // Undo takes two taps (a stray tap near Clock out shouldn't undo a punch).
  const [undoArmed, setUndoArmed] = useState(false);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => {
      setUndo(null);
      setUndoArmed(false);
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (!undoArmed) return;
    const timer = window.setTimeout(() => setUndoArmed(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [undoArmed]);

  const { settings } = data;
  const period = periodFor(todayIso(), settings);
  const totals = periodTotals(data.punches, period, settings, new Date(now));

  const punch = () => {
    const at = new Date().toISOString();
    setUndo({ data, text: open ? "Clocked out" : "Clocked in" });
    setUndoArmed(false);
    onChange({
      ...data,
      punches: open
        ? data.punches.map((item) => (item.id === open.id ? { ...item, out: at } : item))
        : [...data.punches, { id: newId(), in: at }],
    });
  };

  return (
    <section className={`panel clock-card${open ? " is-in" : ""}`} aria-label="Time clock">
      <div className="panel-head">
        <h2>
          <Timer aria-hidden="true" /> Time clock
        </h2>
        <button type="button" className="clock-card-more" onClick={onOpen}>
          <span><Flip value={hoursText(totals.hours)} /> h this period</span> <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="clock-card-body">
        <div className="clock-card-status">
          {open ? (
            <>
              <b className="clock-card-timer"><Flip value={elapsed(open.in, now)} /></b>
              <span>
                In since <Flip value={clockText(open.in)} />
                {settings.roundTo > 1 && <> · counts from <Flip value={clockText(roundPunch(new Date(open.in), settings.roundTo))} /></>}
              </span>
            </>
          ) : (
            <>
              <b>Not clocked in</b>
              <span><Flip value={scheduled ? `Scheduled ${scheduled}` : `Paid ${dayText(period.payday)}`} /></span>
            </>
          )}
        </div>
        <button type="button" className={`clock-punch ${open ? "out" : "in"}`} onClick={punch}>
          {open ? "Clock out" : "Clock in"}
        </button>
      </div>
      <p className="clock-card-foot">
        {undo ? (
          <>
            {undo.text} at {clockText(new Date())}
            <button
              type="button"
              className={undoArmed ? "armed" : undefined}
              onClick={() => {
                if (!undoArmed) {
                  setUndoArmed(true);
                  return;
                }
                onChange(undo.data);
                setUndo(null);
                setUndoArmed(false);
              }}
            >
              <Undo2 aria-hidden="true" /> {undoArmed ? "Tap again to undo" : "Undo"}
            </button>
          </>
        ) : (
          <>
            <span><Flip value={periodLabel(period)} /> · ≈ <Flip value={money(totals.net)} /> take-home · paid <Flip value={dayText(period.payday, { weekday: "short", month: "short", day: "numeric" })} /></span>
          </>
        )}
      </p>
    </section>
  );
}

/* ---------- the popup ---------- */

type Tab = "punches" | "pay" | "rules";

export function TimeClockSheet({ data, onChange, onClose }: {
  data: ClockData;
  onChange: (data: ClockData) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("punches");
  const [periodDay, setPeriodDay] = useState(todayIso);
  const period = periodFor(periodDay, data.settings);
  const picker = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [imported, setImported] = useState<{ before: ClockData; text: string; flags: number } | null>(null);

  // Paycom time sheets: keep each, add the punches missing here, then show the newest.
  const importSheets = async (files: File[]) => {
    if (!files.length) return;
    setReading(true);
    const sheets: PaycomSheet[] = [];
    let unreadable = 0;
    for (const file of files) {
      const sheet = await readPaycomSheet(file).catch(() => null);
      if (sheet) sheets.push(sheet);
      else unreadable += 1;
    }
    setReading(false);
    if (!sheets.length) {
      setImported({ before: data, text: "That isn’t a Paycom time sheet. In Paycom, open Time Sheet and share it as a PDF.", flags: 0 });
      return;
    }
    let punches = data.punches;
    let added = 0;
    for (const sheet of sheets) {
      const missing = compareSheet(sheet, punches, data.settings).flatMap((check) => (check.kind === "missing-here" ? [asPunch(check.paycom)] : []));
      punches = [...punches, ...missing];
      added += missing.length;
    }
    const next = {
      ...data,
      punches,
      sheets: { ...data.sheets, ...Object.fromEntries(sheets.map((sheet) => [sheet.start, sheet])) },
    };
    const flags = sheets.reduce((sum, sheet) => sum + compareSheet(sheet, punches, data.settings).filter(isFlag).length, 0);
    onChange(next);
    const newest = sheets.reduce((latest, sheet) => (sheet.start > latest.start ? sheet : latest));
    setPeriodDay(newest.start);
    setTab("pay");
    setImported({
      before: data,
      flags,
      text: [
        `Read ${sheets.length === 1 ? "the time sheet" : `${sheets.length} time sheets`}`,
        added ? `added ${added} punch${added === 1 ? "" : "es"}` : "nothing to add",
        flags ? `${flags} to check` : "everything matches",
        unreadable ? `${unreadable} couldn’t be read` : "",
      ].filter(Boolean).join(" · "),
    });
  };
  const choose = () => picker.current?.click();
  const now = useNow(Boolean(openPunch(data.punches)));
  const step = (direction: number) => setPeriodDay(addDays(period.start, direction * data.settings.period.days));
  const setSettings = (patch: Partial<ClockSettings>) => onChange({ ...data, settings: { ...data.settings, ...patch } });

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet clock-sheet" role="dialog" aria-modal="true" aria-label="Time clock">
        <header className="sheet-head sheet-head-tools">
          <h2>Time clock</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close time clock"><X /></button>
          </div>
        </header>
        <div className="clock-tabs" role="tablist" aria-label="Time clock">
          {([["punches", "Punches"], ["pay", "Pay"], ["rules", "Rules"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab !== "rules" && (
          <div className="clock-period">
            <button type="button" onClick={() => step(-1)} aria-label="Earlier pay period"><ChevronLeft /></button>
            <div>
              <b><Flip value={periodLabel(period)} /></b>
              <small>Paid <Flip value={dayText(period.payday, { weekday: "long", month: "short", day: "numeric" })} /></small>
            </div>
            <button type="button" onClick={() => step(1)} aria-label="Later pay period"><ChevronRight /></button>
          </div>
        )}
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void importSheets(files);
          }}
        />
        <div className="clock-sheet-body">
          {(reading || imported) && (
            <p className={`clock-import-note${imported?.flags ? " flagged" : ""}`} role="status">
              {reading ? <Loader2 className="spin" aria-hidden="true" /> : imported?.flags ? <AlertTriangle aria-hidden="true" /> : <Check aria-hidden="true" />}
              <span>{reading ? "Reading the time sheet…" : imported?.text}</span>
              {imported && !reading && imported.before !== data && (
                <button type="button" onClick={() => {
                  onChange(imported.before);
                  setImported(null);
                }}><Undo2 aria-hidden="true" /> Undo</button>
              )}
            </p>
          )}
          {tab === "punches" && <PunchesTab data={data} period={period} now={now} onChange={onChange} onPaycom={choose} />}
          {tab === "pay" && <PayTab data={data} period={period} now={now} onChange={onChange} onPaycom={choose} />}
          {tab === "rules" && <RulesTab settings={data.settings} onChange={setSettings} />}
        </div>
      </section>
    </div>
  );
}

/* ---------- punches ---------- */

const localInput = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const fromInput = (value: string) => (value ? new Date(value).toISOString() : undefined);

function PunchesTab({ data, period, now, onChange, onPaycom }: {
  data: ClockData;
  period: PayPeriod;
  now: number;
  onChange: (data: ClockData) => void;
  onPaycom: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string; in: string; out: string } | null>(null);
  const step = data.settings.roundTo;
  const punches = data.punches
    .filter((punch) => punchDay(punch) >= period.start && punchDay(punch) <= period.end)
    .sort((a, b) => b.in.localeCompare(a.in));

  const save = () => {
    if (!editing) return;
    const start = fromInput(editing.in);
    const end = fromInput(editing.out);
    if (!start || (end && end <= start)) return;
    // Saved by hand, so it's yours now (no longer marked as from Paycom).
    const next: Punch = { id: editing.id, in: start, ...(end ? { out: end } : {}) };
    const exists = data.punches.some((punch) => punch.id === editing.id);
    onChange({
      ...data,
      punches: exists ? data.punches.map((punch) => (punch.id === editing.id ? next : punch)) : [...data.punches, next],
    });
    setEditing(null);
  };
  const remove = (id: string) => {
    onChange({ ...data, punches: data.punches.filter((punch) => punch.id !== id) });
    setEditing(null);
  };
  const invalid = Boolean(editing && (!editing.in || (editing.out && editing.out <= editing.in)));

  const editor = editing && (
    <div className="clock-editor">
      <label>
        <span>Clock in</span>
        <input type="datetime-local" value={editing.in} onChange={(event) => setEditing({ ...editing, in: event.target.value })} />
      </label>
      <label>
        <span>Clock out</span>
        <input type="datetime-local" value={editing.out} onChange={(event) => setEditing({ ...editing, out: event.target.value })} />
      </label>
      {editing.in && (
        <p className="clock-editor-note">
          Counts as {clockText(roundPunch(new Date(editing.in), step))}
          {editing.out ? ` – ${clockText(roundPunch(new Date(editing.out), step))}` : " – still in"}
          {editing.out && editing.out > editing.in
            ? ` · ${hoursText(punchHours({ id: "", in: new Date(editing.in).toISOString(), out: new Date(editing.out).toISOString() }, step))} h`
            : ""}
        </p>
      )}
      <div className="clock-editor-actions">
        {data.punches.some((punch) => punch.id === editing.id) && (
          <button type="button" className="button danger subtle" onClick={() => remove(editing.id)}><Trash2 /> Delete</button>
        )}
        <button type="button" className="button soft" onClick={() => setEditing(null)}>Cancel</button>
        <button type="button" className="button primary" onClick={save} disabled={invalid}><Check /> Save</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="clock-add-row">
        <button
          type="button"
          className="clock-add"
          onClick={() => {
            const day = todayIso() >= period.start && todayIso() <= period.end ? todayIso() : period.start;
            setEditing({ id: newId(), in: `${day}T09:00`, out: `${day}T17:00` });
          }}
        >
          <Plus aria-hidden="true" /> Add a missed punch
        </button>
        <button type="button" className="clock-add" onClick={onPaycom}>
          <FileUp aria-hidden="true" /> Fill in from Paycom
        </button>
      </div>
      {editing && !data.punches.some((punch) => punch.id === editing.id) && editor}
      {punches.length ? (
        <ul className="clock-punches">
          {punches.map((punch) => {
            const roundedIn = roundPunch(new Date(punch.in), step);
            const roundedOut = punch.out ? roundPunch(new Date(punch.out), step) : null;
            return (
              <li key={punch.id}>
                {editing?.id === punch.id ? editor : (
                  <button type="button" onClick={() => setEditing({ id: punch.id, in: localInput(punch.in), out: localInput(punch.out) })}>
                    <span className="clock-punch-day">
                      {dayText(punchDay(punch))}
                      {punch.from === "paycom" && <small className="clock-from">Paycom</small>}
                    </span>
                    <span className="clock-punch-times">
                      <b>{clockText(roundedIn)} – {roundedOut ? clockText(roundedOut) : "now"}</b>
                      <small>Punched {clockText(punch.in)} – {punch.out ? clockText(punch.out) : "still in"}</small>
                    </span>
                    <span className="clock-punch-hours"><Flip value={hoursText(punchHours(punch, step, new Date(now)))} /> h</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="clock-empty">No punches this pay period.</p>
      )}
    </>
  );
}

/* ---------- pay ---------- */

function PayTab({ data, period, now, onChange, onPaycom }: {
  data: ClockData;
  period: PayPeriod;
  now: number;
  onChange: (data: ClockData) => void;
  onPaycom: () => void;
}) {
  const { settings } = data;
  const totals = periodTotals(data.punches, period, settings, new Date(now));
  const check = data.checks[period.start] ?? {};
  const sheet = data.sheets[period.start];
  const setCheck = (field: keyof typeof check, value: string) => {
    const number = value === "" ? undefined : Number(value);
    onChange({ ...data, checks: { ...data.checks, [period.start]: { ...check, [field]: Number.isFinite(number) ? number : undefined } } });
  };
  const compare = (mine: number, theirs: number | undefined, unit: "h" | "$") => {
    if (theirs === undefined) return null;
    const gap = Math.round((theirs - mine) * 100) / 100;
    if (Math.abs(gap) < (unit === "h" ? 0.005 : 0.015)) return <small className="clock-match ok">Matches</small>;
    const amount = unit === "h" ? `${hoursText(Math.abs(gap))} h` : money(Math.abs(gap));
    return <small className="clock-match off">Paycom {amount} {gap > 0 ? "more" : "less"}</small>;
  };

  return (
    <div className="clock-stub">
      <table>
        <thead>
          <tr><th>Earnings</th><th>Rate</th><th>Hours</th><th>Amount</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Regular</td><td><Flip value={money(settings.wage)} /></td><td><Flip value={hoursText(totals.regular)} /></td>
            <td><Flip value={money(Math.round(totals.regular * settings.wage * 100) / 100)} /></td>
          </tr>
          {totals.overtime > 0 && (
            <tr>
              <td>Overtime</td><td><Flip value={money(settings.wage * settings.overtime.times)} /></td><td><Flip value={hoursText(totals.overtime)} /></td>
              <td><Flip value={money(Math.round(totals.overtime * settings.wage * settings.overtime.times * 100) / 100)} /></td>
            </tr>
          )}
          <tr className="clock-stub-total"><td>Gross</td><td /><td><Flip value={hoursText(totals.hours)} /></td><td><Flip value={money(totals.gross)} /></td></tr>
        </tbody>
      </table>

      <table>
        <thead><tr><th>Employee taxes</th><th>Amount</th></tr></thead>
        <tbody>
          {totals.taxes.map((tax) => <tr key={tax.id}><td>{tax.label}</td><td><Flip value={money(tax.amount)} /></td></tr>)}
          {!totals.taxes.length && <tr><td colSpan={2} className="clock-empty">No pay yet this period.</td></tr>}
          <tr className="clock-stub-total"><td>Total</td><td><Flip value={money(totals.taxTotal)} /></td></tr>
        </tbody>
      </table>

      {totals.deductions.length > 0 && (
        <table>
          <thead><tr><th>Deductions</th><th>Amount</th></tr></thead>
          <tbody>
            {totals.deductions.map((item) => <tr key={item.id}><td>{item.label}</td><td><Flip value={money(item.amount)} /></td></tr>)}
          </tbody>
        </table>
      )}

      <div className="clock-net">
        <span>Take-home</span>
        <b><Flip value={money(totals.net)} /></b>
      </div>

      <section className="clock-check">
        <h3>Check against Paycom</h3>
        <button type="button" className="clock-add" onClick={onPaycom}>
          <FileUp aria-hidden="true" /> {sheet ? "Upload a newer time sheet" : "Upload Paycom time sheet (PDF)"}
        </button>
        {sheet && <SheetReview sheet={sheet} data={data} now={now} onChange={onChange} />}
        <p>{sheet ? "Hours come from the time sheet. Add gross and net from your pay stub:" : "Or type what Paycom shows for this period."}</p>
        <label>
          <span>Hours</span>
          <input type="number" inputMode="decimal" step="0.01" placeholder={sheet?.total !== null && sheet?.total !== undefined ? hoursText(sheet.total) : hoursText(totals.hours)} value={check.hours ?? ""} onChange={(event) => setCheck("hours", event.target.value)} />
          {compare(totals.hours, check.hours ?? (sheet?.total ?? undefined), "h")}
        </label>
        <label>
          <span>Gross</span>
          <input type="number" inputMode="decimal" step="0.01" placeholder={totals.gross.toFixed(2)} value={check.gross ?? ""} onChange={(event) => setCheck("gross", event.target.value)} />
          {compare(totals.gross, check.gross, "$")}
        </label>
        <label>
          <span>Net pay</span>
          <input type="number" inputMode="decimal" step="0.01" placeholder={totals.net.toFixed(2)} value={check.net ?? ""} onChange={(event) => setCheck("net", event.target.value)} />
          {compare(totals.net, check.net, "$")}
        </label>
      </section>
      <p className="clock-fineprint">Taxes can be a cent off on a line: Paycom rounds some on your year-to-date totals.</p>
    </div>
  );
}

/* ---------- a Paycom time sheet, against your punches ---------- */

const span = (punch: Punch) => `${clockText(punch.in)} – ${punch.out ? clockText(punch.out) : "still in"}`;

function SheetReview({ sheet, data, now, onChange }: {
  sheet: PaycomSheet;
  data: ClockData;
  now: number;
  onChange: (data: ClockData) => void;
}) {
  const step = data.settings.roundTo;
  const checks = compareSheet(sheet, data.punches, data.settings);
  const flags = checks.filter(isFlag);
  const fine = checks.filter((check) => !isFlag(check) && check.kind !== "missing-here");
  const missing = checks.filter((check) => check.kind === "missing-here");
  const mine = periodTotals(data.punches, { start: sheet.start, end: sheet.end, payday: sheet.end }, data.settings, new Date(now)).hours;
  const [showAll, setShowAll] = useState(false);
  const add = (punches: Punch[]) => onChange({ ...data, punches: [...data.punches, ...punches.map(asPunch)] });
  const replace = (mineId: string, paycom: Punch) =>
    onChange({ ...data, punches: data.punches.map((punch) => (punch.id === mineId ? { ...asPunch(paycom), id: mineId } : punch)) });

  const row = (check: SheetCheck, index: number) => {
    const day = "paycom" in check ? dayText(punchDay(check.paycom)) : "mine" in check ? dayText(punchDay(check.mine)) : "Period total";
    switch (check.kind) {
      case "differs":
        return (
          <li key={index} className="flag">
            <b>{day}</b>
            <span>Paycom {span(check.paycom)} ({hoursText(punchHours(check.paycom, step))} h)<br />You {span(check.mine)} ({hoursText(punchHours(check.mine, step, new Date(now)))} h)</span>
            <em>{check.gap > 0 ? "+" : "−"}{hoursText(Math.abs(check.gap))} h on Paycom</em>
            <button type="button" onClick={() => replace(check.mine.id, check.paycom)}>Use Paycom&rsquo;s</button>
          </li>
        );
      case "not-on-paycom":
        return (
          <li key={index} className="flag">
            <b>{day}</b>
            <span>You {span(check.mine)} ({hoursText(punchHours(check.mine, step))} h)</span>
            <em>Not on Paycom: a missed punch there? Ask to have it added.</em>
          </li>
        );
      case "paycom-math":
        return (
          <li key={index} className="flag">
            <b>{day}</b>
            <span>Paycom shows {hoursText(check.shown)} h, but its punches round to {hoursText(check.worked)} h</span>
            <em>Paycom&rsquo;s hours look off</em>
          </li>
        );
      case "paycom-total":
        return (
          <li key={index} className="flag">
            <b>{day}</b>
            <span>Paycom&rsquo;s total is {hoursText(check.shown)} h, but its days add up to {hoursText(check.worked)} h</span>
            <em>Paycom&rsquo;s total looks off</em>
          </li>
        );
      case "missing-here":
        return (
          <li key={index}>
            <b>{day}</b>
            <span>Paycom {span(check.paycom)} ({hoursText(punchHours(check.paycom, step))} h)</span>
            <button type="button" onClick={() => add([check.paycom])}>Add</button>
          </li>
        );
      default:
        return (
          <li key={index} className="ok">
            <b>{day}</b>
            <span>{span(check.paycom)} · {hoursText(punchHours(check.paycom, step))} h</span>
            <em>{check.kind === "match" ? "Matches" : `Same once rounded (you ${span(check.mine)})`}</em>
          </li>
        );
    }
  };

  return (
    <div className="clock-sheet-review">
      <div className="clock-sheet-summary">
        <span><small>Paycom</small><b><Flip value={sheet.total !== null ? hoursText(sheet.total) : "—"} /> h</b></span>
        <span><small>Your punches</small><b><Flip value={hoursText(mine)} /> h</b></span>
        <span className={flags.length ? "flagged" : "ok"}>
          {flags.length ? <AlertTriangle aria-hidden="true" /> : <Check aria-hidden="true" />}
          {flags.length ? `${flags.length} to check` : "All good"}
        </span>
      </div>
      {flags.length > 0 && <ul className="clock-sheet-rows">{flags.map(row)}</ul>}
      {missing.length > 0 && (
        <>
          <ul className="clock-sheet-rows">{missing.map(row)}</ul>
          {missing.length > 1 && (
            <button type="button" className="clock-add" onClick={() => add(missing.flatMap((check) => (check.kind === "missing-here" ? [check.paycom] : [])))}>
              <Plus aria-hidden="true" /> Add all {missing.length}
            </button>
          )}
        </>
      )}
      {fine.length > 0 && (
        <button type="button" className="clock-sheet-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          {showAll ? "Hide" : "Show"} {fine.length} matching
        </button>
      )}
      {showAll && <ul className="clock-sheet-rows">{fine.map(row)}</ul>}
      <p className="clock-fineprint">Time sheet read {new Date(sheet.readAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} at {clockText(sheet.readAt)}.</p>
    </div>
  );
}

/* ---------- rules ---------- */

const numberValue = (value: string, fallback: number) => {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : fallback;
};

function RulesTab({ settings, onChange }: {
  settings: ClockSettings;
  onChange: (patch: Partial<ClockSettings>) => void;
}) {
  const example = (time: string) => {
    const date = new Date(`2026-01-01T${time}:00`);
    return `${clockText(date)} → ${clockText(roundPunch(date, settings.roundTo))}`;
  };
  const period = periodFor(settings.period.anchor, settings);
  return (
    <div className="clock-rules">
      <section>
        <h3>Pay</h3>
        <label className="clock-field">
          <span>Hourly wage</span>
          <span className="clock-input-unit">
            $<input type="number" inputMode="decimal" step="0.01" min="0" value={settings.wage}
              onChange={(event) => onChange({ wage: numberValue(event.target.value, settings.wage) })} />
          </span>
        </label>
        <label className="clock-field">
          <span>Overtime</span>
          <span className="clock-inline">
            <input type="checkbox" checked={settings.overtime.on}
              onChange={(event) => onChange({ overtime: { ...settings.overtime, on: event.target.checked } })} />
            after
            <input type="number" inputMode="decimal" value={settings.overtime.afterHours} disabled={!settings.overtime.on}
              onChange={(event) => onChange({ overtime: { ...settings.overtime, afterHours: numberValue(event.target.value, 40) } })} />
            h a week ×
            <input type="number" inputMode="decimal" step="0.1" value={settings.overtime.times} disabled={!settings.overtime.on}
              onChange={(event) => onChange({ overtime: { ...settings.overtime, times: numberValue(event.target.value, 1.5) } })} />
          </span>
        </label>
      </section>

      <section>
        <h3>Rounding</h3>
        <label className="clock-field">
          <span>Round punches to the nearest</span>
          <select value={settings.roundTo} onChange={(event) => onChange({ roundTo: Number(event.target.value) })}>
            {ROUND_CHOICES.map((choice) => (
              <option key={choice} value={choice}>{choice === 1 ? "minute (no rounding)" : `${choice} minutes`}</option>
            ))}
          </select>
        </label>
        {settings.roundTo > 1 && (
          <p className="clock-examples chips">
            {["06:53", "12:22", "12:23"].map((time) => <span key={time}>{example(time)}</span>)}
          </p>
        )}
      </section>

      <section>
        <h3>Pay period</h3>
        <label className="clock-field">
          <span>Paid every</span>
          <select value={settings.period.days} onChange={(event) => onChange({ period: { ...settings.period, days: Number(event.target.value) as 7 | 14 } })}>
            <option value={14}>2 weeks</option>
            <option value={7}>week</option>
          </select>
        </label>
        <label className="clock-field">
          <span>A period started on</span>
          <input type="date" value={settings.period.anchor}
            onChange={(event) => event.target.value && onChange({ period: { ...settings.period, anchor: event.target.value } })} />
        </label>
        <label className="clock-field">
          <span>Payday, days after it ends</span>
          <input type="number" inputMode="numeric" min="0" max="30" value={settings.period.payAfter}
            onChange={(event) => onChange({ period: { ...settings.period, payAfter: Math.max(0, Math.round(numberValue(event.target.value, 6))) } })} />
        </label>
        <p className="clock-examples">
          {dayText(period.start, { weekday: "short", month: "short", day: "numeric" })} – {dayText(period.end, { weekday: "short", month: "short", day: "numeric" })}, paid {dayText(period.payday, { weekday: "long", month: "short", day: "numeric" })}
        </p>
      </section>

      <section>
        <h3>Taxes</h3>
        {settings.taxes.map((tax, index) => {
          const update = (patch: Partial<typeof tax>) =>
            onChange({ taxes: settings.taxes.map((item, at) => (at === index ? { ...item, ...patch } : item)) });
          return (
            <div key={tax.id} className={`clock-tax${tax.on ? "" : " off"}`}>
              <input type="checkbox" checked={tax.on} aria-label={`Take out ${tax.label}`} onChange={(event) => update({ on: event.target.checked })} />
              <span>{tax.label}</span>
              {tax.kind === "federal" ? (
                <span className="clock-input-unit" title="The yearly amount not taxed (the standard deduction)">
                  $<input type="number" inputMode="decimal" value={settings.federalAllowance} aria-label="Federal yearly untaxed amount"
                    onChange={(event) => onChange({ federalAllowance: numberValue(event.target.value, 16_100) })} />/yr free
                </span>
              ) : (
                <span className="clock-input-unit">
                  {tax.kind === "flat" && "$"}
                  <input type="number" inputMode="decimal" step="0.01" value={tax.rate} aria-label={`${tax.label} ${tax.kind === "flat" ? "dollars per paycheck" : "percent"}`}
                    onChange={(event) => update({ rate: numberValue(event.target.value, tax.rate) })} />
                  {tax.kind === "flat" ? "/check" : "%"}
                </span>
              )}
            </div>
          );
        })}
        <p className="clock-fineprint">Federal is single-filer withholding: 10% of what&rsquo;s over $16,100 a year, then the 2026 brackets.</p>
        <button type="button" className="clock-reset" onClick={() => onChange({ taxes: DEFAULT_SETTINGS.taxes, federalAllowance: DEFAULT_SETTINGS.federalAllowance })}>
          <RotateCcw aria-hidden="true" /> Back to my stub&rsquo;s rates
        </button>
      </section>

      <section>
        <h3>Other deductions</h3>
        <p className="clock-fineprint">Anything else Paycom takes out each paycheck (like benefits).</p>
        {settings.deductions.map((item, index) => {
          const update = (patch: Partial<typeof item>) =>
            onChange({ deductions: settings.deductions.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)) });
          return (
            <div key={item.id} className="clock-tax">
              <input type="text" value={item.label} aria-label="Deduction name" placeholder="Name" onChange={(event) => update({ label: event.target.value })} />
              <span className="clock-input-unit">
                $<input type="number" inputMode="decimal" step="0.01" value={item.amount} aria-label={`${item.label || "Deduction"} dollars per paycheck`}
                  onChange={(event) => update({ amount: numberValue(event.target.value, item.amount) })} />/check
              </span>
              <button type="button" className="clock-remove" aria-label={`Remove ${item.label || "deduction"}`}
                onClick={() => onChange({ deductions: settings.deductions.filter((_, at) => at !== index) })}><Trash2 /></button>
            </div>
          );
        })}
        <button type="button" className="clock-add" onClick={() => onChange({ deductions: [...settings.deductions, { id: newId(), label: "", amount: 0 }] })}>
          <Plus aria-hidden="true" /> Add a deduction
        </button>
      </section>
    </div>
  );
}
