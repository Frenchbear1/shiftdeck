"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confidenceLabels, ScanOverlay } from "./schedule-import-preview";
import { FullscreenPhoto } from "./schedule-file-viewer";
import { recoverScheduleSource, type ScanPreviewPass } from "./schedule-import";
import { scanConfidence, type ScanMark } from "./schedule-parser";
import {
  getScanDefinition,
  getScanConfirmation,
  formatScanMeaning,
  isCompleteScanMeaning,
  newScanMeaning,
  scanMeaningLabels,
  type ScanDefinitions,
  type ScanMeaning,
} from "./scan-annotations";
import { recognizedScanMeanings } from "./scan-corrections";
import { loadScheduleScan } from "./upload-store";

export type ScanReviewTarget = {
  id?: string;
  hash: string;
  name: string;
  pass?: ScanPreviewPass;
  original?: Blob;
};

function MeaningFields({ meaning, onChange }: {
  meaning: ScanMeaning;
  onChange: (meaning: ScanMeaning) => void;
}) {
  switch (meaning.kind) {
    case "time":
      return (
        <label className="scan-definition-label">
          <span>Time</span>
          <input type="time" required value={meaning.time} onChange={(event) =>
            onChange({ ...meaning, time: event.target.value })} />
        </label>
      );
    case "range":
      return (
        <div className="scan-definition-fields">
          <label className="scan-definition-label">
            <span>Start time</span>
            <input type="time" required value={meaning.start} onChange={(event) =>
              onChange({ ...meaning, start: event.target.value })} />
          </label>
          <label className="scan-definition-label">
            <span>End time</span>
            <input type="time" required value={meaning.end} onChange={(event) =>
              onChange({ ...meaning, end: event.target.value })} />
          </label>
        </div>
      );
    case "flight":
      return (
        <>
          <label className="scan-definition-label">
            <span>Flight number</span>
            <input type="text" maxLength={16} value={meaning.identifier} onChange={(event) =>
              onChange({ ...meaning, identifier: event.target.value })} />
          </label>
          <div className="scan-definition-fields">
            {([["origin", "Origin airport"], ["destination", "Destination airport"]] as const).map(([field, label]) => (
              <label className="scan-definition-label" key={field}>
                <span>{label}</span>
                <input type="text" maxLength={4} autoCapitalize="characters" value={meaning[field]} onChange={(event) =>
                  onChange({ ...meaning, [field]: event.target.value.toUpperCase() })} />
              </label>
            ))}
            {([["arrival", "Arrival time"], ["departure", "Departure time"]] as const).map(([field, label]) => (
              <label className="scan-definition-label" key={field}>
                <span>{label}</span>
                <input type="time" value={meaning[field]} onChange={(event) =>
                  onChange({ ...meaning, [field]: event.target.value })} />
              </label>
            ))}
          </div>
        </>
      );
    case "date":
      return (
        <label className="scan-definition-label">
          <span>Date</span>
          <input type="date" required value={meaning.date} onChange={(event) =>
            onChange({ ...meaning, date: event.target.value })} />
        </label>
      );
    case "person":
    case "note":
      return (
        <label className="scan-definition-label">
          <span>{meaning.kind === "person" ? "Worker name" : "Definition"}</span>
          <input type="text" required maxLength={160} value={meaning.text} onChange={(event) =>
            onChange({ ...meaning, text: event.target.value })} />
        </label>
      );
    case "off":
    case "pto": return null;
  }
}

export function ScheduleScanReview({
  target, definitions, matchesWorker, onReviewMark, onClose,
}: {
  target: ScanReviewTarget;
  definitions: ScanDefinitions;
  matchesWorker: (worker: string) => boolean;
  onReviewMark: (
    mark: ScanMark, meanings: ScanMeaning[], repeat: boolean, verify: boolean,
    pass?: ScanPreviewPass,
  ) => string | undefined;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ url: string; pass: ScanPreviewPass }>();
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState<{
    mark: ScanMark;
    meanings: ScanMeaning[];
    repeat: boolean;
    saved?: boolean;
    error?: string;
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
    const { meanings, repeat } = getScanDefinition(definitions, target.hash, mark);
    setSelected({ mark, meanings: meanings.length ? meanings : [newScanMeaning("note")], repeat });
  };
  const originalConfidence = selected && scanConfidence(selected.mark);
  const confirmation = selected && getScanConfirmation(definitions, target.hash, selected.mark);
  const confidence = confirmation ? "confident" : originalConfidence;
  const recognized = selected ? recognizedScanMeanings(selected.mark) : [];
  const canSave = Boolean(selected?.meanings.length && selected.meanings.every(isCompleteScanMeaning));

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
                  confirmationFor={(mark) => getScanConfirmation(definitions, target.hash, mark)}
                />
              )}
            />
          ) : <p role="status">Preparing highlights…</p>}
      </div>
      {!unavailable && preview && (
        <div className="scan-review-details">
          {!selected ? (
            <p>Pinch to zoom. Tap any highlight to define it.</p>
          ) : (
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!canSave) return;
              const error = onReviewMark(selected.mark, selected.meanings, selected.repeat, false, preview.pass);
              setSelected({ ...selected, saved: !error, error });
            }}>
              <p className={`scan-review-read scan-mark-${confidence}`}>
                <strong>{confirmation === "verified" ? "Verified" : confirmation === "corrected" ? "Corrected" : confidenceLabels[confidence!]}</strong>
                <span>{selected.mark.text}</span>
              </p>
              {originalConfidence === "check" && !confirmation && (
                <div className="scan-verify-action">
                  {recognized.length > 0 && <span>{recognized.map(formatScanMeaning).join(" · ")}</span>}
                  <button type="button" className="button primary" onClick={() => {
                    const error = onReviewMark(selected.mark, recognized, false, true, preview.pass);
                    setSelected({ ...selected, saved: false, error });
                  }}>
                    Verify as correct
                  </button>
                </div>
              )}
              {selected.meanings.map((meaning, index) => (
                <fieldset className="scan-meaning" key={index}>
                  <legend>{selected.meanings.length > 1 ? `Meaning ${index + 1}` : "Meaning"}</legend>
                  <div className="scan-meaning-type">
                    <label className="scan-definition-label">
                      <select
                        aria-label={`Meaning ${index + 1} type`}
                        value={meaning.kind}
                        onChange={(event) => {
                          const next = newScanMeaning(event.target.value as ScanMeaning["kind"]);
                          setSelected({
                            ...selected, saved: false, error: undefined,
                            meanings: selected.meanings.map((item, i) => i === index ? next : item),
                          });
                        }}
                      >
                        {Object.entries(scanMeaningLabels).map(([kind, label]) =>
                          <option value={kind} key={kind}>{label}</option>)}
                      </select>
                    </label>
                    {selected.meanings.length > 1 && (
                      <button
                        type="button"
                        className="scan-meaning-remove"
                        aria-label={`Remove meaning ${index + 1}`}
                        onClick={() => setSelected({
                          ...selected, saved: false, error: undefined,
                          meanings: selected.meanings.filter((_, i) => i !== index),
                        })}
                      ><X size={16} /></button>
                    )}
                  </div>
                  <MeaningFields meaning={meaning} onChange={(next) => setSelected({
                    ...selected, saved: false, error: undefined,
                    meanings: selected.meanings.map((item, i) => i === index ? next : item),
                  })} />
                </fieldset>
              ))}
              <button
                type="button"
                className="button soft scan-meaning-add"
                onClick={() => setSelected({
                  ...selected, saved: false, error: undefined,
                  meanings: [...selected.meanings, newScanMeaning("note")],
                })}
              ><Plus size={15} />Add another meaning</button>
              <label className="scan-definition-remember">
                <input type="checkbox" checked={selected.repeat} onChange={(event) =>
                  setSelected({ ...selected, repeat: event.target.checked, saved: false, error: undefined })} />
                Remember matching text for future scans
              </label>
              <div className="scan-definition-actions">
                <span role="status">{selected.error || (selected.saved ? "Definition saved" : confirmation === "verified" ? "Verified" : "")}</span>
                <button type="submit" disabled={!canSave} className="button soft">Save definition</button>
              </div>
            </form>
          )}
        </div>
      )}
    </dialog>
  );
}
