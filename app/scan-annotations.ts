import type { ScanMark } from "./schedule-parser";

export type ScanDefinitions = {
  spots: Record<string, string>;
  matching: Record<string, string>;
};

export const SCAN_DEFINITIONS_KEY = "shiftdeck.scanDefinitions";
export const emptyScanDefinitions: ScanDefinitions = { spots: {}, matching: {} };

const markText = (mark: ScanMark) => mark.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const spotKey = (hash: string, mark: ScanMark) => JSON.stringify([hash, mark.id, markText(mark)]);
const matchKey = (mark: ScanMark) => JSON.stringify([mark.kind, markText(mark)]);

export function getScanDefinition(definitions: ScanDefinitions, hash: string, mark: ScanMark) {
  const spot = definitions.spots[spotKey(hash, mark)];
  const repeat = definitions.matching[matchKey(mark)];
  return { value: spot ?? repeat ?? "", repeat: spot === undefined && repeat !== undefined };
}

export function saveScanDefinition(
  definitions: ScanDefinitions, hash: string, mark: ScanMark, value: string, repeat: boolean,
): ScanDefinitions {
  const text = value.trim().slice(0, 160);
  const key = spotKey(hash, mark);
  if (!text) return definitions;
  if (!repeat) return { ...definitions, spots: { ...definitions.spots, [key]: text } };
  const spots = { ...definitions.spots };
  delete spots[key];
  return { spots, matching: { ...definitions.matching, [matchKey(mark)]: text } };
}

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
