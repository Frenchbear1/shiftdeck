import type { ScanMark } from "./schedule-parser";

/** Ordering is visual only. The OCR worker can start its next pass immediately. */
export function scanSweepDelays(marks: ScanMark[]) {
  const heights = marks.map(({ height }) => height).sort((a, b) => a - b);
  const halfHeight = (heights[Math.floor(heights.length / 2)] ?? 1) * 0.55;
  const center = (mark: ScanMark) => mark.y + mark.height / 2;
  const rows: ScanMark[][] = [];
  for (const mark of [...marks].sort((a, b) => center(a) - center(b) || a.x - b.x)) {
    const last = rows.at(-1);
    if (last && center(mark) - center(last[0]) <= halfHeight) last.push(mark);
    else rows.push([mark]);
  }
  const ordered = rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
  const step = Math.min(34, 730 / Math.max(1, ordered.length - 1));
  return new Map(ordered.map((mark, index) => [mark.id, Math.round(index * step)]));
}
