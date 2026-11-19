"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type QuickAction = {
  id: string;
  label: string;
  /** Spoken name (e.g. "Notifications (2 new)"). */
  ariaLabel?: string;
  icon: LucideIcon;
  badge?: number;
  onSelect: () => void;
};

type Insets = { top: number; right: number; bottom: number; left: number };

/** Which bottom corner the button sits in, and whether it's just the icon. */
export type QuickMenuStyle = { side: "left" | "right"; clear: boolean };
export const DEFAULT_QUICK_MENU: QuickMenuStyle = { side: "right", clear: false };
export const QUICK_MENU_KEY = "shiftdeck.quickMenu";

export function loadQuickMenuStyle(): QuickMenuStyle {
  try {
    const saved = JSON.parse(localStorage.getItem(QUICK_MENU_KEY) ?? "null");
    return {
      side: saved?.side === "left" ? "left" : "right",
      clear: saved?.clear === true,
    };
  } catch {
    return DEFAULT_QUICK_MENU;
  }
}

const SIZE = 58;
const MARGIN = 16;
const STEP = 62;
const MOVE_SLOP = 8;
const PICK_RADIUS = 40;

/** The phone's notch / home-bar insets, read from CSS env(). */
function readInsets(): Insets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

const buzz = (ms = 8) => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(ms);
};

/**
 * The floating button: tap to open the column of actions, or press and
 * swipe straight onto one and let go. It opens the moment it's touched, and
 * picks go by where each action ends up, so a quick swipe works even while
 * the column is still springing out.
 */
export function QuickMenu({ actions, badge, style }: { actions: QuickAction[]; badge: number; style: QuickMenuStyle }) {
  const [view, setView] = useState({ width: 0, height: 0 });
  const [insets, setInsets] = useState<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    wasOpen: boolean;
    leftButton: boolean;
  } | null>(null);
  const hotRef = useRef<number | null>(null);

  useEffect(() => {
    const measure = () => {
      setView({ width: window.innerWidth, height: window.innerHeight });
      setInsets(readInsets());
    };
    queueMicrotask(measure);
    window.addEventListener("resize", measure);
    // Turn transitions on only after the first placement (no fly-in on load).
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Escape closes; so does the page going to the background.
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const hide = () => {
      if (document.visibilityState !== "visible") setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [open]);

  const right = style.side === "right";
  const home = {
    x: right ? view.width - MARGIN - insets.right - SIZE : MARGIN + insets.left,
    y: view.height - MARGIN - Math.max(insets.bottom, 4) - SIZE,
  };
  // The column grows up from the bottom corner.
  const direction = -1;
  const centerOf = (index: number) => ({
    x: home.x + SIZE / 2,
    y: home.y + SIZE / 2 + direction * STEP * (index + 1),
  });

  const pick = (index: number) => {
    setOpen(false);
    setHeld(false);
    setHot(null);
    hotRef.current = null;
    // Let the close animation start before a sheet covers the screen.
    window.setTimeout(() => actions[index]?.onSelect(), 90);
  };

  const highlight = (index: number | null) => {
    if (index === hotRef.current) return;
    hotRef.current = index;
    setHot(index);
    if (index !== null) buzz(6);
  };

  const nearest = (x: number, y: number) => {
    let best: number | null = null;
    let bestDistance = PICK_RADIUS;
    actions.forEach((_, index) => {
      const center = centerOf(index);
      // Generous toward the label side, so sliding onto a label counts too.
      const towardLabel = right ? x < center.x : x > center.x;
      const dx = Math.abs(x - center.x) * (towardLabel ? 0.3 : 1);
      const distance = Math.hypot(dx, y - center.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  };

  return (
    <>
      <div
        className={`quick-backdrop${open ? " open" : ""}`}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
      <div
        className={`quick-menu${open ? " open" : ""}${held ? " held" : ""}${ready ? " ready" : ""}${right ? " right" : " left"}${style.clear ? " clear" : ""}`}
        style={{
          ["--x" as string]: `${home.x}px`,
          ["--y" as string]: `${home.y}px`,
          ["--dir" as string]: direction,
          visibility: view.width ? undefined : "hidden",
        }}
      >
        <div className="quick-items" role="menu" aria-label="Menu" aria-hidden={!open}>
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                tabIndex={open ? 0 : -1}
                className={`quick-item${hot === index ? " hot" : ""}`}
                style={{ ["--i" as string]: index, ["--n" as string]: actions.length }}
                aria-label={action.ariaLabel ?? action.label}
                onClick={() => pick(index)}
              >
                <span className="quick-label">{action.label}</span>
                <span className="quick-icon">
                  <Icon aria-hidden="true" />
                  {Boolean(action.badge) && <i className="quick-badge">{action.badge}</i>}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="quick-button"
          aria-label={`${open ? "Close menu" : "Menu"}${badge ? ` (${badge} new)` : ""}`}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={(event) => {
            // Taps are handled by the pointer events; this is for keyboards.
            if (event.detail === 0) setOpen((value) => !value);
          }}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current = {
              id: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              wasOpen: open,
              leftButton: false,
            };
            setHeld(true);
            // Opens right away, so a press can swipe straight onto an action.
            if (!open) {
              setOpen(true);
              buzz(8);
            }
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (!current || current.id !== event.pointerId) return;
            if (!current.leftButton && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > MOVE_SLOP) {
              current.leftButton = true;
            }
            if (current.leftButton) highlight(nearest(event.clientX, event.clientY));
          }}
          onPointerUp={(event) => {
            const current = gesture.current;
            if (!current || current.id !== event.pointerId) return;
            gesture.current = null;
            setHeld(false);
            const index = hotRef.current;
            if (index !== null) pick(index);
            // A tap opens it and leaves it open; tapping again (or swiping off) closes it.
            else if (current.wasOpen || current.leftButton) setOpen(false);
            highlight(null);
          }}
          onPointerCancel={() => {
            gesture.current = null;
            setHeld(false);
            highlight(null);
          }}
        >
          <span className="quick-bars" aria-hidden="true"><i /><i /><i /></span>
          {badge > 0 && <i className="quick-badge main" aria-hidden="true">{badge > 99 ? "99+" : badge}</i>}
        </button>
      </div>
    </>
  );
}
