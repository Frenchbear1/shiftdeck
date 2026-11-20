"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { backdropClose } from "./home-sections";

type RuleGroup = {
  label: string;
  total: number;
  kept: number;
  filtered: string[];
  used: boolean;
  typical: number | null;
  low: number | null;
  high: number | null;
};
type RuleLevel = { level: string; detail: string; groups: RuleGroup[] };
type LoggedFlight = {
  id: string;
  ident: string | null;
  origin: string | null;
  at: string | null;
  status: "tracked" | "tracking" | "not seen";
  aircraft: string | null;
  runway: string | null;
  windRunway: string | null;
  gate: string | null;
  taxiMin: number | null;
  firstSeenNm: number | null;
  at30: number | null;
  at15: number | null;
  faErr15: number | null;
  ourErr15: number | null;
};
type AllLearning = {
  rules: { taxi: RuleLevel[]; approach30: RuleLevel[]; approach15: RuleLevel[]; needs: number };
  flights: LoggedFlight[];
};

const RULES = [
  { id: "taxi", label: "Taxi to gate" },
  { id: "approach30", label: "From 30 nm" },
  { id: "approach15", label: "From 15 nm" },
] as const;
type RuleId = (typeof RULES)[number]["id"];

const FILTERS = ["All", "Used", "Filtered out", "Not seen", "Tracking"] as const;
type Filter = (typeof FILTERS)[number];

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  : "—";
const min = (value: number | null) => (value === null ? "—" : `${value} min`);

/**
 * Settings › Flight learning › Show all data: every rule the arrival estimate
 * can use, most precise first (the order it falls back in), with how many
 * flights each averages, which were filtered out as odd, and whether it has
 * enough to be used; and every flight logged.
 */
export function LearningDataSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const [data, setData] = useState<AllLearning | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"rules" | "flights">("rules");
  const [rule, setRule] = useState<RuleId>("taxi");
  const [showFiltered, setShowFiltered] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");
  useEffect(() => {
    let live = true;
    fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((result: AllLearning) => live && setData(result))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [url]);

  const byId = useMemo(() => new Map((data?.flights ?? []).map((flight) => [flight.id, flight])), [data]);
  // Which rules left each flight out, so the Flights list can say.
  const filteredIn = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!data) return out;
    for (const { id, label } of RULES) {
      for (const level of data.rules[id]) {
        for (const group of level.groups) {
          for (const flightId of group.filtered) {
            out.set(flightId, [...(out.get(flightId) ?? []), `${label}: ${group.label}`]);
          }
        }
      }
    }
    return out;
  }, [data]);
  const flights = (data?.flights ?? []).filter((flight) => {
    if (filter === "Used") return flight.status === "tracked" && !filteredIn.has(flight.id);
    if (filter === "Filtered out") return filteredIn.has(flight.id);
    if (filter === "Not seen") return flight.status === "not seen";
    if (filter === "Tracking") return flight.status === "tracking";
    return true;
  });
  const valueOf = (flight: LoggedFlight) => (rule === "taxi" ? flight.taxiMin : rule === "approach30" ? flight.at30 : flight.at15);
  const levels = data?.rules[rule] ?? [];

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet learning-sheet" role="dialog" aria-modal="true" aria-label="Flight learning data">
        <header className="sheet-head">
          <div>
            <h2>Flight learning</h2>
            <p>{data ? `${data.flights.length} flights logged · every rule, most precise first` : "Every rule and flight it learned from"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close flight learning data"><X /></button>
        </header>
        <div className="people-switch learning-switch" role="tablist" aria-label="What to show">
          {(["rules", "flights"] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {id === "rules" ? "Rules" : "Flights"}
              {data && <small>{id === "rules" ? RULES.reduce((count, item) => count + data.rules[item.id].reduce((sum, level) => sum + level.groups.length, 0), 0) : data.flights.length}</small>}
            </button>
          ))}
        </div>
        <div className="sheet-scroll">
          {!data && !failed && <p className="learning-loading"><LoaderCircle className="spin" /> Getting everything it learned…</p>}
          {failed && <p className="learning-loading">Couldn’t get the data. Check the connection and try again.</p>}
          {data && tab === "rules" && (
            <>
              <div className="settings-segment learning-rule" role="radiogroup" aria-label="Which rule">
                {RULES.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={rule === item.id}
                    className={rule === item.id ? "active" : ""} onClick={() => setRule(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="learning-legend">
                <small>
                  {rule === "taxi" ? "Touchdown to parked at the gate." : `Minutes to touchdown once ${rule === "approach30" ? 30 : 15} nm out.`}
                  {" "}The estimate uses the most precise rule with at least {data.rules.needs} flights, then falls back down the list.
                  Odd flights (way outside the usual range) are filtered out first.
                </small>
                <label className="learning-toggle">
                  <input type="checkbox" checked={showFiltered} onChange={(event) => setShowFiltered(event.target.checked)} />
                  Show filtered-out flights
                </label>
              </div>
              {levels.map((level, index) => (
                <section key={level.level} className="learning-level">
                  <header>
                    <b>{index + 1}. {level.level}</b>
                    <small>{index === 0 ? "most precise" : index === levels.length - 1 ? "least precise · always there" : ""}</small>
                  </header>
                  {level.groups.length ? (
                    <ul>
                      {level.groups.map((group) => (
                        <li key={group.label} className={group.used ? "used" : ""}>
                          <div className="learning-group-head">
                            <b>{group.label}</b>
                            <span className={`learning-badge ${group.used ? "on" : ""}`}>
                              {group.used ? "In use" : `Needs ${data.rules.needs - group.kept} more`}
                            </span>
                          </div>
                          <div className="learning-group-stats">
                            <span><b>{group.typical === null ? "—" : `${group.typical} min`}</b> typical</span>
                            {group.low !== null && group.high !== null && group.kept > 1 && <span>{group.low}–{group.high} min</span>}
                            <span>{group.kept} of {group.total} flights{group.filtered.length ? ` · ${group.filtered.length} filtered out` : ""}</span>
                          </div>
                          {showFiltered && group.filtered.length > 0 && (
                            <ul className="learning-filtered">
                              {group.filtered.map((id) => {
                                const flight = byId.get(id);
                                return (
                                  <li key={id}>
                                    {flight?.ident ?? "Flight"} · {when(flight?.at ?? null)} · {min(flight ? valueOf(flight) : null)}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <small className="learning-empty">No flights with this yet.</small>
                  )}
                </section>
              ))}
            </>
          )}
          {data && tab === "flights" && (
            <>
              <div className="learning-filters" role="radiogroup" aria-label="Which flights">
                {FILTERS.map((item) => (
                  <button key={item} type="button" role="radio" aria-checked={filter === item}
                    className={filter === item ? "on" : ""} onClick={() => setFilter(item)}>
                    {item}
                  </button>
                ))}
              </div>
              {flights.length ? (
                <ul className="learning-flights">
                  {flights.map((flight) => {
                    const left = filteredIn.get(flight.id);
                    return (
                      <li key={flight.id} className={left ? "filtered" : flight.status === "tracked" ? "" : "quiet"}>
                        <div className="learning-flight-head">
                          <b>{flight.ident ?? "Flight"}{flight.origin ? ` · from ${flight.origin}` : ""}</b>
                          <small>{when(flight.at)}</small>
                        </div>
                        <div className="learning-flight-facts">
                          {flight.status !== "tracked" && <span className="learning-badge">{flight.status === "tracking" ? "Tracking now" : "Not seen"}</span>}
                          {flight.aircraft && <span>{flight.aircraft}</span>}
                          {flight.runway && <span>Rwy {flight.runway}{flight.windRunway && flight.windRunway !== flight.runway ? ` (wind said ${flight.windRunway})` : ""}</span>}
                          {flight.gate && <span>Gate {flight.gate}</span>}
                          {flight.taxiMin !== null && <span>Taxi {flight.taxiMin} min</span>}
                          {flight.at30 !== null && <span>30 nm → {flight.at30} min</span>}
                          {flight.at15 !== null && <span>15 nm → {flight.at15} min</span>}
                          {flight.firstSeenNm !== null && <span>Seen {flight.firstSeenNm} nm out</span>}
                          {(flight.ourErr15 !== null || flight.faErr15 !== null) && (
                            <span>Off by: ours ±{flight.ourErr15 ?? "—"} · FA ±{flight.faErr15 ?? "—"} min</span>
                          )}
                        </div>
                        {left && <small className="learning-left">Filtered out of {left.join("; ")}</small>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="learning-loading">No flights here.</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
