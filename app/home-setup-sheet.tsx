"use client";

import { LayoutGrid, Menu, Plane, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DEFAULT_HOME_ORDER, HomeOrderList, type HomeTile } from "./home-order";
import type { QuickMenuStyle } from "./quick-menu";
import { backdropClose } from "./home-sections";
import { SheetClose } from "./sheet-tools";

export type HomeSetup = {
  flightApp: "flightaware" | "flightradar24";
  flightTime: "gate" | "landing";
  order: HomeTile[];
  menu: QuickMenuStyle;
};

/** Picks one of a few options, each with a line on what it means. */
function Options<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; title: string; detail: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setup-options" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          <i aria-hidden="true" />
          <b>{option.title}</b>
          <small>{option.detail}</small>
        </button>
      ))}
    </div>
  );
}

function Group({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="setup-group">
      <header>
        <span className="setup-group-icon" aria-hidden="true">{icon}</span>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * Home screen: what Flights opens in and shows, the order of the sections,
 * and where the menu button sits. Nothing changes until Save.
 */
export function HomeSetupSheet({ value, onSave, onClose }: {
  value: HomeSetup;
  onSave: (next: HomeSetup) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const edit = (patch: Partial<HomeSetup>) => setDraft((current) => ({ ...current, ...patch }));
  const isDefaultOrder = draft.order.every((tile, index) => tile === DEFAULT_HOME_ORDER[index]);
  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet home-setup-sheet" role="dialog" aria-modal="true" aria-label="Home screen">
        <header className="sheet-head">
          <div>
            <h2>Home screen</h2>
            <p>Flights, the order of your sections, and the menu.</p>
          </div>
          <SheetClose className="" watch={draft} label="Close home screen settings" onClose={onClose} onSave={() => onSave(draft)} />
        </header>
        <div className="sheet-scroll">
          <Group icon={<Plane />} title="Flights">
            <span className="setup-label">Arrival time</span>
            <Options
              label="Arrival time shown in Flights"
              value={draft.flightTime}
              onChange={(flightTime) => edit({ flightTime })}
              options={[
                { value: "gate", title: "At the gate", detail: "When it parks (taxi included)" },
                { value: "landing", title: "Landing", detail: "Wheels down on the runway" },
              ]}
            />
            <span className="setup-label">Open flights in</span>
            <Options
              label="Open flights in"
              value={draft.flightApp}
              onChange={(flightApp) => edit({ flightApp })}
              options={[
                { value: "flightaware", title: "FlightAware", detail: "Arrivals and en route at ABE" },
                { value: "flightradar24", title: "Flightradar24", detail: "Its ABE arrivals board" },
              ]}
            />
          </Group>

          <Group
            icon={<LayoutGrid />}
            title="Sections"
            action={!isDefaultOrder && (
              <button type="button" className="setup-reset" onClick={() => edit({ order: DEFAULT_HOME_ORDER })}>
                <RotateCcw aria-hidden="true" /> Reset
              </button>
            )}
          >
            <small className="setup-hint">Top to bottom, as on your Home Screen. Drag a handle to move one.</small>
            <HomeOrderList order={draft.order} onChange={(order) => edit({ order })} />
          </Group>

          <Group icon={<Menu />} title="Menu">
            <Options
              label="Menu layout"
              value={draft.menu.layout}
              onChange={(layout) => edit({ menu: { ...draft.menu, layout } })}
              options={[
                { value: "button", title: "One button", detail: "Opens a column of actions" },
                { value: "bottom", title: "Bottom bar", detail: "Every action, always there" },
                { value: "top", title: "Top bar", detail: "Every action, at the top" },
              ]}
            />
            <div className={`setup-menu${draft.menu.layout === "button" ? "" : " bar-only"}`}>
              <div className={`setup-phone layout-${draft.menu.layout} side-${draft.menu.side}${draft.menu.clear ? " clear" : ""}`} aria-hidden="true">
                <i /><i /><i />
                {draft.menu.layout === "button"
                  ? <b><Menu /></b>
                  : <em><u /><u /><u /><u /><u /><u /></em>}
              </div>
              {draft.menu.layout === "button" ? (
                <div className="setup-menu-choices">
                  <span className="setup-label">Corner</span>
                  <div className="settings-segment" role="radiogroup" aria-label="Menu button corner">
                    {(["left", "right"] as const).map((side) => (
                      <button key={side} type="button" role="radio" aria-checked={draft.menu.side === side}
                        className={draft.menu.side === side ? "active" : ""} onClick={() => edit({ menu: { ...draft.menu, side } })}>
                        {side === "left" ? "Left" : "Right"}
                      </button>
                    ))}
                  </div>
                  <span className="setup-label">Look</span>
                  <div className="settings-segment" role="radiogroup" aria-label="Menu button look">
                    {([false, true] as const).map((clear) => (
                      <button key={String(clear)} type="button" role="radio" aria-checked={draft.menu.clear === clear}
                        className={draft.menu.clear === clear ? "active" : ""} onClick={() => edit({ menu: { ...draft.menu, clear } })}>
                        {clear ? "Icon only" : "Solid"}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <small className="setup-hint">
                  Notifications, Import, Swap, Directory, Time clock and Settings sit in a bar at the {draft.menu.layout} of the screen,
                  one tap away.
                </small>
              )}
            </div>
          </Group>
        </div>
      </section>
    </div>
  );
}
