"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confidenceLabels, ScanOverlay } from "./schedule-import-preview";
import { FullscreenPhoto } from "./schedule-file-viewer";
import { recoverScheduleSource, type ScanPreviewPass } from "./schedule-import";
import { scanConfidence } from "./schedule-parser";
import { loadScheduleScan } from "./upload-store";

export type ScanReviewTarget = {
  id?: string;
  hash: string;
  name: string;
  pass?: ScanPreviewPass;
  original?: Blob;
};

/**
 * Read-only view of the highlighted scan: the photo with every read marked as
 * clear, check, or unreadable. Tapping a highlight shows what was read.
 */
export function ScheduleScanReview({
  target, matchesWorker, onClose,
}: {
  target: ScanReviewTarget;
  matchesWorker: (worker: string) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ url: string; pass: ScanPreviewPass }>();
  const [unavailable, setUnavailable] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const matchWorkerAtOpen = useRef(matchesWorker);

  useEffect(() => {
    const viewer = dialog.current;
    viewer?.showModal();
    content.current?.focus({ preventScroll: true });
    let cancelled = false;
    let url: string | undefined;
    const load = async () => {
      const stored = target.pass || !target.id ? undefined : await loadScheduleScan(target.id);
      if (cancelled) return;
      let pass = target.pass ?? stored?.scan;
      const original = target.original ?? stored?.original;
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
      viewer?.close();
      if (url) URL.revokeObjectURL(url);
    };
  }, [target]);

  const selected = selectedId ? preview?.pass.marks.find((mark) => mark.id === selectedId) : undefined;
  const confidence = selected && scanConfidence(selected);
  const counts = preview?.pass.marks.reduce((total, mark) => {
    if (mark.kind !== "shift" || !mark.worker || !matchesWorker(mark.worker)) return total;
    total[scanConfidence(mark)] += 1;
    return total;
  }, { confident: 0, check: 0, unreadable: 0 });

  return (
    <dialog
      className="schedule-file-viewer schedule-scan-review"
      ref={dialog}
      aria-label="Highlighted scan"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="scan-dialog-heading">
        <h2>Highlighted scan</h2>
        <button type="button" onClick={onClose} aria-label="Close highlighted scan"><X /></button>
      </header>
      <div className="scan-review-photo" ref={content} tabIndex={-1}>
        {unavailable ? <p role="status">The source highlights are unavailable for this photo.</p>
          : preview ? (
            <FullscreenPhoto
              url={preview.url}
              name={target.name}
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
          ) : <p role="status">Preparing highlights…</p>}
      </div>
      {!unavailable && preview && (
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
      )}
    </dialog>
  );
}
