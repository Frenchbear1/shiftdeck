"use client";

import { LoaderCircle, Plus, Search, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
        <div className="sheet-menu" role="menu" aria-label={label}>
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
