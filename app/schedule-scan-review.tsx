"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confidenceLabels, ScanOverlay } from "./schedule-import-preview";
import { FullscreenPhoto } from "./schedule-file-viewer";
import { recoverScheduleSource, type ScanPreviewPass } from "./schedule-import";
import { scanConfidence, type ScanMark } from "./schedule-parser";
import { getScanDefinition, type ScanDefinitions } from "./scan-annotations";
import { loadScheduleScan } from "./upload-store";

export type ScanReviewTarget = {
  id?: string;
  hash: string;
  name: string;
  pass?: ScanPreviewPass;
  original?: Blob;
};

export function ScheduleScanReview({
  target, definitions, matchesWorker, onSaveDefinition, onClose,
}: {
  target: ScanReviewTarget;
  definitions: ScanDefinitions;
  matchesWorker: (worker: string) => boolean;
  onSaveDefinition: (mark: ScanMark, value: string, repeat: boolean) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ url: string; pass: ScanPreviewPass }>();
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState<{
    mark: ScanMark;
    value: string;
    repeat: boolean;
    saved?: boolean;
    error?: boolean;
  }>();
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

  const select = (id: string) => {
    const mark = preview?.pass.marks.find((item) => item.id === id);
    if (!mark) return;
    setSelected({ mark, ...getScanDefinition(definitions, target.hash, mark) });
  };
  const confidence = selected && scanConfidence(selected.mark);

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
                  selected={selected?.mark.id ?? null}
                  onSelect={select}
                  definitionFor={(mark) => getScanDefinition(definitions, target.hash, mark).value}
                />
              )}
            />
          ) : <p role="status">Preparing highlights…</p>}
      </div>
      {!unavailable && preview && (
        <div className="scan-review-details">
          {!selected ? (
            <p>Pinch to zoom. Tap a yellow or red highlight to define it.</p>
          ) : (
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!selected.value.trim()) return;
              const saved = onSaveDefinition(selected.mark, selected.value, selected.repeat);
              setSelected({ ...selected, saved, error: !saved });
            }}>
              <p className={`scan-review-read scan-mark-${confidence}`}>
                <strong>{confidenceLabels[confidence!]}</strong>
                <span>{selected.mark.text}</span>
              </p>
              {confidence !== "confident" && (
                <>
                  <label className="scan-definition-label">
                    <span>Definition</span>
                    <input
                      type="text"
                      maxLength={160}
                      value={selected.value}
                      onChange={(event) => setSelected({
                        ...selected, value: event.target.value, saved: false, error: false,
                      })}
                    />
                  </label>
                  <label className="scan-definition-remember">
                    <input type="checkbox" checked={selected.repeat} onChange={(event) =>
                      setSelected({ ...selected, repeat: event.target.checked, saved: false, error: false })} />
                    Remember matching text for future scans
                  </label>
                  <div className="scan-definition-actions">
                    <span role="status">{selected.saved ? "Definition saved" : selected.error ? "Couldn’t save the definition" : ""}</span>
                    <button type="submit" disabled={!selected.value.trim()} className="button soft">Save definition</button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      )}
    </dialog>
  );
}
