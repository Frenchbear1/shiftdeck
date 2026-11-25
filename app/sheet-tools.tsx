"use client";

import { Check, ChevronDown, Copy, LoaderCircle, Plus, Search, X, type LucideIcon } from "lucide-react";
import { stable } from "./vault-data";
import { Flip } from "./flip";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type AddMenuItem = { icon: LucideIcon; label: string; onSelect: () => void };

/** One + button in a sheet's header that opens the ways to add people. */
export function AddMenu({ label, items, note, busy, onOpen }: {
  label: string;
  items: AddMenuItem[];
  /** A short line under the choices (what works, where it's kept). */
  note?: string;
  /** Something is being read: the button spins and the menu stays shut. */
  busy?: boolean;
  /** Called as the menu opens (to get the reader warmed up). */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // A short sheet (nothing in it yet) would leave the menu hanging off the
  // bottom of the screen: the sheet grows (upward) until the menu fits.
  useLayoutEffect(() => {
    const sheet = wrap.current?.closest<HTMLElement>(".panel-sheet");
    if (!open || !sheet || !menu.current) return;
    const overflow = menu.current.getBoundingClientRect().bottom - (window.innerHeight - 16);
    if (overflow <= 0) return;
    const before = sheet.style.minHeight;
    sheet.style.minHeight = `${Math.min(window.innerHeight - 24, sheet.offsetHeight + overflow)}px`;
    return () => {
      sheet.style.minHeight = before;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div className="sheet-add" ref={wrap}>
      <button
        type="button"
        className={`sheet-tool${open ? " on" : ""}${busy ? " busy" : ""}`}
        aria-label={busy ? "Reading…" : label}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {busy ? <LoaderCircle /> : <Plus />}
      </button>
      {open && (
        <div className="sheet-menu" role="menu" aria-label={label} ref={menu}>
          {items.map(({ icon: Icon, label: text, onSelect }) => (
            <button
              key={text}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
            >
              <Icon aria-hidden="true" /> {text}
            </button>
          ))}
          {note && <p>{note}</p>}
        </div>
      )}
    </div>
  );
}

/** The magnifier in a sheet's header; it opens the search field. */
export function SearchToggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`sheet-tool${open ? " on" : ""}`}
      aria-label={open ? "Close search" : label}
      aria-expanded={open}
      onClick={onToggle}
    >
      <Search />
    </button>
  );
}

/**
 * A section that opens and closes (the owner screen, Send to the team,
 * Notifications): a row with an icon, a title and a short summary.
 */
export function Disclosure({ icon: Icon, title, summary, alert, defaultOpen = false, className, children }: {
  icon: LucideIcon;
  title: string;
  summary?: React.ReactNode;
  /** Something's waiting in it. */
  alert?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`owner-section${open ? " open" : ""}${alert ? " alert" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="owner-section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon className="owner-section-icon" aria-hidden="true" />
        <span>{title}</span>
        {summary !== undefined && <b>{typeof summary === "string" || typeof summary === "number" ? <Flip value={summary} /> : summary}</b>}
        <ChevronDown className="owner-section-chevron" aria-hidden="true" />
      </button>
      {open && <div className="owner-section-body">{children}</div>}
    </section>
  );
}

/**
 * A popup's close button that turns into Save once something in it changed
 * (like Settings). It mounts with the popup, so what `watch` was then is what
 * "changed" is measured against. `onSave` defaults to closing (for popups
 * whose changes are kept as they're made).
 */
export function SheetClose({ watch, label, onClose, onSave, saving, className = "sheet-tool" }: {
  watch: unknown;
  /** What's being closed, for screen readers ("Close time clock"). */
  label: string;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  className?: string;
}) {
  const [initial] = useState(() => stable(watch));
  const changed = stable(watch) !== initial;
  if (!changed) {
    return <button type="button" className={className} onClick={onClose} aria-label={label}><X /></button>;
  }
  return (
    <button type="button" className={`${className} sheet-save`} onClick={onSave ?? onClose} disabled={saving} aria-label="Save changes">
      {saving ? <LoaderCircle className="spin" /> : <Check />} {saving ? "Saving…" : "Save"}
    </button>
  );
}

/**
 * Copies instructions for an AI model, so its answer comes back as JSON this
 * app reads (Coworkers and Directory "Paste" boxes).
 */
export function CopyFormat({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="button soft copy-format"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // No clipboard (old browser, no permission): show it to copy by hand.
          window.prompt("Copy this and give it to the AI with your list:", text);
        }
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : "Copy format for AI"}
    </button>
  );
}
