"use client";

import { useEffect, useRef, useState } from "react";
import { confidenceLabels, ScanOverlay } from "./schedule-import-preview";
import { FullscreenPhoto } from "./schedule-file-viewer";
import { recoverScheduleSource, type ScanPreviewPass } from "./schedule-import";
import { scanConfidence } from "./schedule-parser";
import { loadScheduleScan } from "./upload-store";

/**
 * The saved schedule photo with every read highlighted as clear, check, or
 * unreadable. Tapping a highlight shows what was read. This is the "Scanned"
 * tab of View schedule.
 */
export function ScanHighlights({
  id, name, matchesWorker,
}: {
  id: string;
  name: string;
  matchesWorker: (worker: string) => boolean;
}) {
  const [preview, setPreview] = useState<{ url: string; pass: ScanPreviewPass }>();
  const [unavailable, setUnavailable] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const matchWorkerAtOpen = useRef(matchesWorker);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    const load = async () => {
      const stored = await loadScheduleScan(id);
      if (cancelled) return;
      let pass = stored?.scan;
      const original = stored?.original;
      if (!pass && original) {
        await recoverScheduleSource(original, matchWorkerAtOpen.current, (next) => {
          if (next.marks.length) pass = next;
        });
        if (cancelled) return;
      }
      const photo = pass?.image ?? original;
      if (!pass || !photo) throw new Error("Scan unavailable");
      url = URL.createObjectURL(photo);
      setPreview({ url, pass });
    };
    void load().catch(() => {
      if (!cancelled) setUnavailable(true);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  const selected = selectedId ? preview?.pass.marks.find((mark) => mark.id === selectedId) : undefined;
  const confidence = selected && scanConfidence(selected);
  const counts = preview?.pass.marks.reduce((total, mark) => {
    if (mark.kind !== "shift" || !mark.worker || !matchesWorker(mark.worker)) return total;
    total[scanConfidence(mark)] += 1;
    return total;
  }, { confident: 0, check: 0, unreadable: 0 });

  if (unavailable) return <p role="status">The scan highlights are unavailable for this photo.</p>;
  if (!preview) return <p role="status">Preparing highlights…</p>;
  return (
    <div className="scan-highlights">
      <div className="scan-review-photo">
        <FullscreenPhoto
          url={preview.url}
          name={name}
          onError={() => setUnavailable(true)}
          renderOverlay={(ratio) => (
            <ScanOverlay
              pass={preview.pass}
              ratio={ratio}
              matchesWorker={matchesWorker}
              selected={selectedId}
              onSelect={(id) => setSelectedId((current) => current === id ? null : id)}
            />
          )}
        />
      </div>
      <div className="scan-review-details">
        <ul className="scan-legend" aria-label="Scan confidence colors">
          {Object.entries(confidenceLabels).map(([key, label]) => (
            <li key={key} className={`scan-mark-${key}`}><i />{label}</li>
          ))}
        </ul>
        {selected ? (
          <p className={`scan-review-read scan-mark-${confidence}`} aria-live="polite">
            <strong>{confidenceLabels[confidence!]}</strong>
            <span>{selected.shift
              ? `${selected.shift.start.replace(":", "")}–${selected.shift.end.replace(":", "")}`
              : selected.text}</span>
            {selected.note && <small>{selected.note}</small>}
          </p>
        ) : (
          <p aria-live="polite">
            {counts && counts.confident + counts.check + counts.unreadable > 0
              ? `Your row: ${counts.confident} clear` +
                (counts.check ? ` · ${counts.check} to check` : "") +
                (counts.unreadable ? ` · ${counts.unreadable} unreadable` : "") +
                ". Tap a highlight to see what was read."
              : "Pinch to zoom. Tap a highlight to see what was read."}
          </p>
        )}
      </div>
    </div>
  );
}
