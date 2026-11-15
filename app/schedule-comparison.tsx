"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatTime } from "./home-sections";
import type { Shift } from "./sample-data";
import {
  canonicalSchedulePersonName,
  type ScheduleSourceLayout,
} from "./schedule-parser";
import { applyNameMerges, nameKey, resolveMergedName, type NameMerges } from "./schedule-tools";

type Props = {
  image?: Blob;
  dates: string[];
  shifts: Shift[];
  sourceLayout?: ScheduleSourceLayout;
  sourceLoading?: boolean;
  uncertainShifts?: string[];
  person: string;
  nameMerges: NameMerges;
  onEdit: (shift: Shift) => void;
};

function getSourceView(layout: ScheduleSourceLayout, person: string, merges: NameMerges) {
  const rows = layout.rows.filter(
    (row) => nameKey(resolveMergedName(row.name, merges)) === person && row.bottom > row.top,
  );
  if (!rows.length) return null;

  const bands = [layout.header, ...rows];
  const gap = 3;
  const width = layout.right - layout.left;
  const height = bands.reduce((sum, band) => sum + band.bottom - band.top, 0)
    + gap * (bands.length - 1);
  const scale = Math.max(130 / layout.spacing, 25 / (layout.header.bottom - layout.header.top));

  return {
    bands, gap, width, height, scale, layout,
    columns: layout.centers.map((center) => (center - layout.left) * scale),
  };
}

type SourceView = NonNullable<ReturnType<typeof getSourceView>>;

function drawSourceRows(canvas: HTMLCanvasElement, image: HTMLImageElement, view: SourceView) {
  const { bands, gap, width, height, layout } = view;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  if (Math.abs(sourceRatio / (layout.width / layout.height) - 1) > 0.04) return false;

  const scale = Math.min(2, 3200 / width);
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let offset = 0;
  for (const band of bands) {
    const height = band.bottom - band.top;
    context.save();
    context.beginPath();
    context.rect(0, offset * scale, canvas.width, height * scale);
    context.clip();
    context.setTransform(scale, -layout.slope * scale, 0, scale,
      -layout.left * scale, (offset - band.top) * scale);
    context.drawImage(image, 0, 0, layout.width, layout.height);
    context.restore();
    offset += height + gap;
  }
  return true;
}

export function ScheduleComparison({
  image, dates, shifts, sourceLayout, sourceLoading, uncertainShifts, person, nameMerges, onEdit,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [displayedSource, setDisplayedSource] = useState<SourceView | null>(null);
  const [failedSource, setFailedSource] = useState<SourceView | null>(null);
  const selectedName = nameKey(canonicalSchedulePersonName(person));

  const source = useMemo(
    () => sourceLayout ? getSourceView(sourceLayout, selectedName, nameMerges) : null,
    [nameMerges, selectedName, sourceLayout],
  );
  const needsReview = new Set(applyNameMerges(
    shifts.filter((shift) => uncertainShifts?.includes(shift.id)), nameMerges,
  ).map((shift) => shift.id));
  const days = useMemo(() => {
    const byDate = new Map<string, Shift[]>();
    const working = applyNameMerges(shifts, nameMerges).filter(
      (shift) => shift.status === "working" && nameKey(shift.worker) === selectedName,
    );
    for (const shift of working) {
      byDate.set(shift.date, [...(byDate.get(shift.date) ?? []), shift]);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [nameMerges, selectedName, shifts]);

  useEffect(() => {
    if (!source || !image) return;
    let cancelled = false;
    let url: string | undefined;
    const load = async () => {
      const photo = new Image();
      url = URL.createObjectURL(image);
      photo.src = url;
      await photo.decode();
      if (cancelled) return;
      if (!canvas.current || !drawSourceRows(canvas.current, photo, source)) {
        throw new Error("Source layout does not match image");
      }
      setDisplayedSource(source);
    };
    void load().catch(() => {
      if (!cancelled) setFailedSource(source);
    }).finally(() => {
      if (url) URL.revokeObjectURL(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image, source]);

  const displayed = source && displayedSource === source && failedSource !== source ? source : null;
  const aligned = displayed && days.every(([date]) => dates.includes(date)) ? displayed : null;
  return (
    <div className="schedule-comparison">
      {source && image && !displayed && failedSource !== source && (
        <p className="schedule-source-note" role="status">Loading the source rows…</p>
      )}
      {source && (!image || failedSource === source) && (
        <p className="schedule-source-note">The source crop couldn’t be displayed.</p>
      )}
      {sourceLayout && !source && (
        <p className="schedule-source-note">The scanner couldn’t locate the source row for {person}.</p>
      )}
      {sourceLoading && (
        <p className="schedule-source-note" role="status">Finding source rows…</p>
      )}
      {!sourceLayout && !sourceLoading && (
        <p className="schedule-source-note">The source rows couldn’t be recovered.</p>
      )}
      <div
        className="schedule-comparison-scroll"
        role="region"
        aria-label={"Imported shifts for " + person}
        tabIndex={0}
      >
        <div
          className="schedule-comparison-track"
          style={displayed ? { width: displayed.width * displayed.scale } : undefined}
        >
          <canvas
            ref={canvas}
            className="schedule-source-crop"
            role="img"
            aria-label={"Date header and uploaded schedule row for " + person}
            hidden={!displayed}
          />
          {days.length > 0 && (
            <ul className={"schedule-shift-cards" + (aligned ? " aligned" : "")}>
              {days.map(([date, shiftsForDay]) => {
                const column = aligned?.columns[dates.indexOf(date)];
                const columnWidth = aligned ? aligned.layout.spacing * aligned.scale : 0;
                return (
                  <li
                    key={date}
                    style={column === undefined ? undefined : {
                      width: columnWidth - 8,
                      marginInlineStart: column - columnWidth / 2 + 4,
                    }}
                  >
                    {shiftsForDay.map((shift) => (
                      <button type="button" key={shift.id} onClick={() => onEdit(shift)}>
                        <time dateTime={date}>{formatDate(date)}</time>
                        <strong>{formatTime(shift.start)} – {formatTime(shift.end)}</strong>
                        {needsReview.has(shift.id) && <small className="scan-check-time">Check time</small>}
                      </button>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {!days.length && <p className="schedule-source-note">No work shifts were read for {person}.</p>}
    </div>
  );
}
