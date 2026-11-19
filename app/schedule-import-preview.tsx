"use client";

import { Check, FileImage, FileText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { scanConfidence } from "./schedule-parser";
import type { ScanPreviewPass } from "./schedule-import";
import { scanSweepDelays } from "./scan-annotations";
import { IMPORT_STAGES, type ImportSnapshot } from "./schedule-tools";

export type ImportPreviewFile = {
  index: number;
  name: string;
  pdf: boolean;
  stage: number;
  image?: Blob;
  pass?: ScanPreviewPass;
};

type PhotoFrame = {
  index: number;
  source: Blob;
  url: string;
  ratio: number;
  width: number;
  height: number;
};

export const confidenceLabels = {
  confident: "Clear",
  check: "Check",
  unreadable: "Unreadable",
};

export function ScanOverlay({
  pass, ratio, matchesWorker, selected = null, onSelect, sweep = false,
}: {
  pass: ScanPreviewPass;
  ratio: number;
  matchesWorker: (name: string) => boolean;
  selected?: string | null;
  /** Without it the boxes are just drawn (while scanning): nothing to tap, no confidence colors. */
  onSelect?: (id: string) => void;
  sweep?: boolean;
}) {
  const interactive = Boolean(onSelect);
  const delays = useMemo(() => sweep ? scanSweepDelays(pass.marks) : null, [pass.marks, sweep]);
  if (Math.abs((pass.width / pass.height) / ratio - 1) > 0.04) return null;
  const chosenRow = pass.workerRows.find((row) => matchesWorker(row.name));
  const row = chosenRow && pass.grid && { ...chosenRow, ...pass.grid };
  const header = pass.dateHeader && pass.grid && { ...pass.dateHeader, ...pass.grid };
  return (
    <svg
      className={`scan-overlay${sweep ? " is-sweeping" : ""}${interactive ? "" : " is-plain"}`}
      viewBox={`0 0 ${pass.width} ${pass.height}`}
      preserveAspectRatio="none"
      aria-label="Recognized schedule text"
    >
      {[header, row].map((band, index) => band && (
        <polygon
          key={index}
          className={index === 0 ? "scan-date-band" : "scan-person-band"}
          points={`${band.left},${band.top + band.slope * band.left} ${band.right},${band.top + band.slope * band.right} ${band.right},${band.bottom + band.slope * band.right} ${band.left},${band.bottom + band.slope * band.left}`}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {pass.marks.map((mark) => {
        const score = scanConfidence(mark);
        const label = confidenceLabels[score];
        const padX = Math.max(3, mark.height * 0.36);
        const padY = Math.max(1.5, mark.height * 0.24);
        const delay = delays?.get(mark.id) ?? 0;
        return (
          <g
            key={mark.id}
            tabIndex={interactive && !(sweep && score === "confident") ? 0 : undefined}
            role={interactive ? "button" : undefined}
            aria-label={interactive ? `${label}: ${mark.text}${mark.note ? " · " + mark.note : ""}` : undefined}
            aria-pressed={interactive ? selected === mark.id : undefined}
            className={`scan-mark scan-mark-${mark.kind}${interactive ? ` scan-mark-${score}` : ""}`}
            style={{ "--scan-delay": `${delay}ms` } as CSSProperties}
            onClick={interactive ? () => onSelect!(mark.id) : undefined}
            onKeyDown={interactive ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect!(mark.id);
              }
            } : undefined}
          >
            <rect
              x={mark.x - padX}
              y={mark.y - padY}
              width={mark.width + 2 * padX}
              height={mark.height + 2 * padY}
              rx={padY}
              vectorEffect="non-scaling-stroke"
            />
            {mark.worker && matchesWorker(mark.worker) && mark.kind === "shift" && (
              <line
                x1={mark.x}
                x2={mark.x + mark.width}
                y1={mark.y + mark.height + padY}
                y2={mark.y + mark.height + padY}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ScheduleImportPreview({
  file, count, snapshot, matchesWorker, onClose, personChoices, onChoosePerson,
}: {
  file: ImportPreviewFile | null;
  count: number;
  snapshot: ImportSnapshot;
  matchesWorker: (name: string) => boolean;
  onClose: () => void;
  /** Names read from the photo when this device doesn't know yours yet. */
  personChoices?: string[] | null;
  onChoosePerson?: (name: string | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stageElement = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  // Picking your name is two taps (pick, then confirm), since it gets locked.
  const [pickedPerson, setPickedPerson] = useState<string | null>(null);
  const [frames, setFrames] = useState<{ current: PhotoFrame; previous?: PhotoFrame }>();
  const [failedSource, setFailedSource] = useState<Blob>();
  const urls = useRef(new Set<string>());
  const fileIndex = file?.index;
  const source = file?.pass?.image ?? file?.image;

  useEffect(() => {
    const viewer = dialog.current;
    const element = stageElement.current;
    viewer?.showModal();
    if (!element) return () => viewer?.close();
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      viewer?.close();
    };
  }, []);

  useEffect(() => {
    if (!source || fileIndex === undefined) return;
    const url = URL.createObjectURL(source);
    const activeUrls = urls.current;
    const image = new Image();
    image.src = url;
    let cancelled = false;
    void image.decode().then(() => {
      if (cancelled) return;
      activeUrls.add(url);
      const frame = {
        index: fileIndex, source, url, ratio: image.naturalWidth / image.naturalHeight,
        width: image.naturalWidth, height: image.naturalHeight,
      };
      setFrames((previous) => ({ current: frame, previous: previous?.current }));
    }).catch(() => {
      if (!cancelled) setFailedSource(source);
    });
    return () => {
      cancelled = true;
      if (!activeUrls.has(url)) URL.revokeObjectURL(url);
    };
  }, [fileIndex, source]);

  useEffect(() => {
    const activeUrls = urls.current;
    return () => {
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, []);

  useEffect(() => {
    for (const url of urls.current) {
      if (url === frames?.current.url || url === frames?.previous?.url) continue;
      URL.revokeObjectURL(url);
      urls.current.delete(url);
    }
  }, [frames]);

  const pass = source && frames?.current.source === source && frames.current.index === fileIndex ? file?.pass : undefined;
  const stage = snapshot.stage === 3 ? 3 : file?.stage ?? snapshot.stage;
  return (
    <dialog className="schedule-scan-dialog" ref={dialog} aria-label="Scanning schedules" onCancel={(event) => {
      event.preventDefault();
      onClose();
    }}>
      <header className="scan-dialog-heading">
        <h2>Import schedule</h2>
        <button type="button" aria-label="Close scan preview" onClick={onClose}><X /></button>
      </header>
      <div className="scan-photo-stage" ref={stageElement} aria-label="Schedule scan preview">
        {(!frames || (source && failedSource === source)) && (
          <div className="scan-photo-placeholder" role="status">
            {file?.pdf ? <FileText /> : <FileImage />}
            <span>{failedSource === source && source ? "Preview unavailable" : "Opening preview…"}</span>
          </div>
        )}
        {[frames?.previous, frames?.current].map((frame) => frame && (
          <div
            key={frame.url}
            className={`scan-photo-layer${frame === frames?.current ? " is-current" : ""}`}
            aria-hidden={frame !== frames?.current || (source !== undefined && failedSource === source)}
            style={source && failedSource === source ? { visibility: "hidden" } : undefined}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget || frame !== frames?.current) return;
              setFrames((current) => current?.current.url === frame.url && current.previous
                ? { current: frame }
                : current);
            }}
          >
            <figure style={{
              width: Math.min(stageSize.width, stageSize.height * frame.ratio),
              height: Math.min(stageSize.height, stageSize.width / frame.ratio),
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the preview uses a local object URL */}
              <img src={frame.url} alt="Uploaded schedule" width={frame.width} height={frame.height} />
              {pass && frame === frames?.current && (
                <ScanOverlay pass={pass} ratio={frame.ratio} matchesWorker={matchesWorker} sweep />
              )}
            </figure>
          </div>
        ))}
      </div>
      {personChoices && (
        <section className="scan-person-picker" aria-labelledby="scan-person-title">
          <h3 id="scan-person-title">Which name is yours?</h3>
          <p>This locks your name on this device. Only your team’s owner can change it later, so pick carefully.</p>
          <div className="scan-person-names">
            {personChoices.map((name) => (
              <button
                type="button"
                key={name}
                className={pickedPerson === name ? "on" : ""}
                aria-pressed={pickedPerson === name}
                onClick={() => setPickedPerson(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {pickedPerson && (
            <button type="button" className="button primary scan-person-confirm" onClick={() => onChoosePerson?.(pickedPerson)}>
              I’m {pickedPerson}
            </button>
          )}
          <button type="button" className="scan-person-skip" onClick={() => onChoosePerson?.(null)}>
            I’m not on this schedule
          </button>
        </section>
      )}
      <div className="scan-footer">
        <ol className="import-steps" aria-label="Import stages">
          {IMPORT_STAGES.map((label, index) => (
            <li
              key={label}
              className={index < stage ? "done" : index === stage ? "active" : ""}
              aria-current={index === stage ? "step" : undefined}
            >
              <i>{index < stage ? <Check /> : null}</i>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div className="progress-track" role="progressbar" aria-label="Import progress" aria-valuenow={snapshot.progress}>
          <i style={{ transform: `scaleX(${snapshot.progress / 100})` }} />
        </div>
        <p className="import-detail">
          <span>{file ? `Schedule ${file.index + 1} of ${count} · ${file.name}` : snapshot.detail || "Preparing"}</span>
          <b>{snapshot.progress}%</b>
        </p>
      </div>
    </dialog>
  );
}
