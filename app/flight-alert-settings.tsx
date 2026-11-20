"use client";

/** Flight alert choices (the worker's copy is worker/flight-alerts-data.ts). */
export type FlightAlertPrefs = {
  which: "shifts" | "all" | "off";
  landingLead: number | null;
  cancelled: boolean;
  delayed: boolean;
  inAir: boolean;
  landed: boolean;
  gate: boolean;
};

export const DEFAULT_FLIGHT_ALERTS: FlightAlertPrefs = {
  which: "shifts",
  landingLead: 10,
  cancelled: true,
  delayed: true,
  inAir: true,
  landed: false,
  gate: true,
};

export function readFlightAlerts(saved: unknown): FlightAlertPrefs {
  const value = (saved && typeof saved === "object" ? saved : {}) as Partial<FlightAlertPrefs>;
  const flag = (key: keyof FlightAlertPrefs) => (typeof value[key] === "boolean" ? (value[key] as boolean) : (DEFAULT_FLIGHT_ALERTS[key] as boolean));
  return {
    which: value.which === "all" || value.which === "off" ? value.which : "shifts",
    landingLead: value.landingLead === null ? null
      : typeof value.landingLead === "number" && value.landingLead >= 1 && value.landingLead <= 180 ? Math.round(value.landingLead) : 10,
    cancelled: flag("cancelled"),
    delayed: flag("delayed"),
    inAir: flag("inAir"),
    landed: flag("landed"),
    gate: flag("gate"),
  };
}

const TOGGLES: Array<{ key: "cancelled" | "delayed" | "inAir" | "landed" | "gate"; label: string; hint: string }> = [
  { key: "inAir", label: "Took off", hint: "When an arrival leaves for ABE" },
  { key: "delayed", label: "Delayed", hint: "15+ min late, and again every 15 min more" },
  { key: "cancelled", label: "Cancelled", hint: "As soon as it’s called off" },
  { key: "gate", label: "Gate changes", hint: "When the gate moves" },
  { key: "landed", label: "Landed", hint: "Once it’s down" },
];

/** The Flight alerts part of the alerts settings. */
export function FlightAlertSettings({ value, onChange }: { value: FlightAlertPrefs; onChange: (next: FlightAlertPrefs) => void }) {
  const off = value.which === "off";
  return (
    <>
      <div className="notify-section-head">
        <span className="notify-section-label">Flight alerts</span>
        <small>Allegiant at ABE</small>
      </div>
      <div className="notify-card flight-alerts">
        <div className="flight-alerts-which" role="radiogroup" aria-label="Which flights">
          {([["shifts", "My shifts"], ["all", "All flights"], ["off", "Off"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={value.which === id} className={value.which === id ? "active" : ""}
              onClick={() => onChange({ ...value, which: id })}>
              {label}
            </button>
          ))}
        </div>
        <small className="flight-alerts-note">
          {value.which === "shifts" ? "Flights during your shifts (arrivals up to 45 min before you start)."
            : value.which === "all" ? "Every Allegiant arrival and departure at ABE." : "No flight alerts."}
        </small>
        <fieldset disabled={off}>
          <label className="flight-alert-row">
            <input type="checkbox" checked={value.landingLead !== null}
              onChange={(event) => onChange({ ...value, landingLead: event.target.checked ? 10 : null })} />
            <span>
              <b>Before landing</b>
              <small>From Shiftdeck&rsquo;s live tracking</small>
            </span>
            <span className="flight-alert-lead">
              <input type="number" inputMode="numeric" min="1" max="180" aria-label="Minutes before landing"
                value={value.landingLead ?? 10} disabled={value.landingLead === null}
                onChange={(event) => {
                  const minutes = Math.round(Number(event.target.value));
                  if (minutes >= 1 && minutes <= 180) onChange({ ...value, landingLead: minutes });
                }} />
              min
            </span>
          </label>
          {TOGGLES.map((toggle) => (
            <label key={toggle.key} className="flight-alert-row">
              <input type="checkbox" checked={value[toggle.key]} onChange={(event) => onChange({ ...value, [toggle.key]: event.target.checked })} />
              <span>
                <b>{toggle.label}</b>
                <small>{toggle.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </>
  );
}
