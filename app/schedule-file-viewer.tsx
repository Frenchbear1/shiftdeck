"use client";

import { Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadScheduleImage } from "./upload-store";

export function ScheduleFileViewer({
  id, name, pdf, onClose,
}: {
  id: string;
  name: string;
  pdf: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [aspect, setAspect] = useState(0);
  const [zoom, setZoom] = useState(1);
  const setScale = (value: number) => setZoom(Math.max(1, Math.min(5, value)));

  useEffect(() => {
    const viewer = dialog.current;
    viewer?.showModal();
    let cancelled = false;
    let sourceUrl: string | undefined;
    const load = async () => {
      const file = await loadScheduleImage(id);
      if (cancelled) return;
      if (!file) throw new Error("Saved schedule unavailable");
      sourceUrl = URL.createObjectURL(file);
      setUrl(sourceUrl);
    };
    void load().catch(() => {
      if (!cancelled) setUnavailable(true);
    });
    return () => {
      cancelled = true;
      viewer?.close();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [id]);

  return (
    <dialog
      ref={dialog}
      className="schedule-file-viewer"
      aria-label="View schedule"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <strong>{name}</strong>
        {url && !pdf && !unavailable && (
          <div className="schedule-zoom-controls" role="group" aria-label="Schedule zoom">
            <button type="button" onClick={() => setScale(zoom - 0.5)} disabled={zoom <= 1} aria-label="Zoom out"><Minus /></button>
            <button type="button" onClick={() => setScale(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setScale(zoom + 0.5)} disabled={zoom >= 5} aria-label="Zoom in"><Plus /></button>
          </div>
        )}
        <button type="button" onClick={onClose} aria-label="Close schedule"><X /></button>
      </header>
      {unavailable ? (
        <p role="status">This schedule file is unavailable on this device.</p>
      ) : !url ? (
        <p role="status">Loading schedule…</p>
      ) : pdf ? (
        <iframe title={name} src={url} />
      ) : (
        <div
          className="schedule-file-scroll"
          onTouchStart={(event) => {
            if (event.touches.length !== 2) return;
            const [a, b] = Array.from(event.touches);
            pinch.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
          }}
          onTouchMove={(event) => {
            const start = pinch.current;
            if (!start?.distance || event.touches.length !== 2) return;
            const [a, b] = Array.from(event.touches);
            const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            setScale(start.zoom * distance / start.distance);
          }}
          onTouchEnd={() => { pinch.current = null; }}
          onTouchCancel={() => { pinch.current = null; }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- display the locally uploaded photo */}
          <img
            src={url}
            alt={name}
            draggable={false}
            onLoad={(event) => setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
            onError={() => setUnavailable(true)}
            style={aspect ? { width: `calc(min(100cqw, 100cqh * ${aspect}) * ${zoom})` } : undefined}
          />
        </div>
      )}
    </dialog>
  );
}
