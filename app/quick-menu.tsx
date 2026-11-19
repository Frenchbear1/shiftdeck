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

type Corner = "tl" | "tr" | "bl" | "br";
type Insets = { top: number; right: number; bottom: number; left: number };

const CORNER_KEY = "shiftdeck.quickMenuCorner";
const SIZE = 58;
const MARGIN = 16;
const STEP = 62;
const HOLD_MS = 230;
const MOVE_SLOP = 8;
const PICK_RADIUS = 40;

const loadCorner = (): Corner => {
  try {
    const saved = localStorage.getItem(CORNER_KEY);
    return saved === "tl" || saved === "tr" || saved === "bl" || saved === "br" ? saved : "br";
  } catch {
    return "br";
  }
};

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
 * The floating button: tap to open the column of actions, or press-and-hold,
 * slide onto one and let go. Drag it to move it; it snaps to the nearest
 * corner and stays there.
 */
export function QuickMenu({ actions, badge }: { actions: QuickAction[]; badge: number }) {
  const [corner, setCorner] = useState<Corner>("br");
  const [view, setView] = useState({ width: 0, height: 0 });
  const [insets, setInsets] = useState<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    grabX: number;
    grabY: number;
    mode: "press" | "move" | "slide";
    wasOpen: boolean;
    leftButton: boolean;
    timer?: number;
  } | null>(null);
  const hotRef = useRef<number | null>(null);

  useEffect(() => {
    const measure = () => {
      setView({ width: window.innerWidth, height: window.innerHeight });
      setInsets(readInsets());
    };
    const corner = loadCorner();
    queueMicrotask(() => {
      measure();
      setCorner(corner);
    });
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

  const right = corner === "tr" || corner === "br";
  const bottom = corner === "bl" || corner === "br";
  const home = {
    x: right ? view.width - MARGIN - insets.right - SIZE : MARGIN + insets.left,
    y: bottom ? view.height - MARGIN - Math.max(insets.bottom, 4) - SIZE : MARGIN + insets.top,
  };
  const at = drag ?? home;
  // The column grows away from the edge it sits on.
  const direction = bottom ? -1 : 1;
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
        className={`quick-menu${open ? " open" : ""}${held ? " held" : ""}${drag ? " dragging" : ""}${ready ? " ready" : ""}${right ? " right" : " left"}${bottom ? " bottom" : " top"}`}
        style={{
          ["--x" as string]: `${at.x}px`,
          ["--y" as string]: `${at.y}px`,
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
            const current = {
              id: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              grabX: event.clientX - home.x,
              grabY: event.clientY - home.y,
              mode: open ? "slide" as const : "press" as const,
              wasOpen: open,
              leftButton: false,
              timer: undefined as number | undefined,
            };
            gesture.current = current;
            setHeld(true);
            if (!open) {
              // Held still: open, and whatever it's let go on is picked.
              current.timer = window.setTimeout(() => {
                if (gesture.current !== current || current.mode !== "press") return;
                current.mode = "slide";
                setOpen(true);
                buzz(10);
              }, HOLD_MS);
            }
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (!current || current.id !== event.pointerId) return;
            const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
            if (current.mode === "press" && moved > MOVE_SLOP) {
              // A quick drag moves the button itself.
              window.clearTimeout(current.timer);
              current.mode = "move";
              setHeld(false);
            }
            if (current.mode === "move") {
              setDrag({
                x: Math.min(Math.max(event.clientX - current.grabX, 4), view.width - SIZE - 4),
                y: Math.min(Math.max(event.clientY - current.grabY, 4), view.height - SIZE - 4),
              });
            } else if (current.mode === "slide") {
              if (moved > MOVE_SLOP) current.leftButton = true;
              highlight(nearest(event.clientX, event.clientY));
            }
          }}
          onPointerUp={(event) => {
            const current = gesture.current;
            if (!current || current.id !== event.pointerId) return;
            window.clearTimeout(current.timer);
            gesture.current = null;
            setHeld(false);
            if (current.mode === "press") {
              setOpen((value) => !value);
              return;
            }
            if (current.mode === "move") {
              const centerX = event.clientX - current.grabX + SIZE / 2;
              const centerY = event.clientY - current.grabY + SIZE / 2;
              const next: Corner = `${centerY < view.height / 2 ? "t" : "b"}${centerX < view.width / 2 ? "l" : "r"}` as Corner;
              setCorner(next);
              setDrag(null);
              buzz(8);
              try {
                localStorage.setItem(CORNER_KEY, next);
              } catch {
                // Stays put until the app reloads.
              }
              return;
            }
            // Sliding: let go on an action to pick it.
            const index = hotRef.current;
            if (index !== null) pick(index);
            // Tapped while open, or slid off without picking: close. Held in place: stay open.
            else if (current.wasOpen || current.leftButton) setOpen(false);
            highlight(null);
          }}
          onPointerCancel={() => {
            const current = gesture.current;
            if (current) window.clearTimeout(current.timer);
            gesture.current = null;
            setHeld(false);
            setDrag(null);
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
