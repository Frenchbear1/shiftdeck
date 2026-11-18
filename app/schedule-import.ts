import {
  mergeScheduleParses,
  parseScheduleTsv,
  ParsedSchedule,
  resolveSchedulePersonName,
  type ScanMark,
  type ScheduleSourceLayout,
  type ScanGeometry,
} from "./schedule-parser";
import { isStrongScheduleRead } from "./schedule-tools";
import { decideShiftTime, readCellDigits, type TimePrior, type TimeReading } from "./scan-consensus";
import { isAndroid } from "./platform";

type TesseractWorker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

type ReaderListener = (status: { status: string; progress: number }) => void;

let enginePromise: Promise<TesseractWorker> | null = null;
let listener: ReaderListener | null = null;

/**
 * Starts loading the OCR engine and language data once. Opening the import
 * sheet warms it up, and every file in a batch reuses the same worker instead
 * of downloading and booting a new one per file.
 */
export function warmScheduleReader() {
  if (!enginePromise) {
    enginePromise = import("tesseract.js")
      .then(({ createWorker }) =>
        createWorker("eng", 1, {
          logger: (status) => listener?.(status),
        }),
      )
      .catch((error) => {
        enginePromise = null;
        throw error;
      });
  }
  return enginePromise;
}

export async function releaseScheduleReader() {
  const pending = enginePromise;
  enginePromise = null;
  if (!pending) return;
  const worker = await pending.catch(() => null);
  await worker?.terminate().catch(() => undefined);
}

const otsuThreshold = (data: Uint8ClampedArray) => {
  const histogram = new Array<number>(256).fill(0);
  for (let offset = 0; offset < data.length; offset += 4) histogram[data[offset]] += 1;
  const total = data.length / 4;
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level];
  let background = 0;
  let backgroundSum = 0;
  let best = 0;
  let threshold = 128;
  for (let level = 0; level < 256; level += 1) {
    background += histogram[level];
    if (!background) continue;
    const foreground = total - background;
    if (!foreground) break;
    backgroundSum += level * histogram[level];
    const meanBackground = backgroundSum / background;
    const meanForeground = (sum - backgroundSum) / foreground;
    const between = background * foreground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = level;
    }
  }
  return threshold;
};

const toGray = (data: Uint8ClampedArray, contrast = 1) => {
  for (let offset = 0; offset < data.length; offset += 4) {
    const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    const value = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  }
};

const canvasBlob = (canvas: HTMLCanvasElement, type = "image/png", quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

async function enhanceScheduleImage(file: Blob, android: boolean): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    // Android phones run out of memory on 12+ MP canvases, so their copy is
    // also scaled down when the photo is very large.
    const fit = Math.min(2.2, (android ? 2000 : 2200) / bitmap.width);
    const applied = android
      ? Math.min(fit, Math.sqrt(9_000_000 / (bitmap.width * bitmap.height)))
      : Math.max(1, fit);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * applied);
    canvas.height = Math.round(bitmap.height * applied);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      return file;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // Grayscale with extra contrast: the shaded flight rows and thin grid
    // lines are what trip OCR up most.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    toGray(pixels.data, 1.35);
    context.putImageData(pixels, 0, 0);
    return (await canvasBlob(canvas)) ?? file;
  } catch {
    return file;
  }
}

/**
 * The unenhanced pass reads the photo as taken. On Android a very large photo
 * is resized first (orientation baked in) so the tab isn't killed for memory.
 */
async function readableOriginal(file: Blob, android: boolean): Promise<Blob> {
  if (!android || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= 3000) {
      bitmap.close();
      return file;
    }
    const scale = 3000 / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return (await canvasBlob(canvas, "image/jpeg", 0.92)) ?? file;
  } catch {
    return file;
  }
}

type CellBox = NonNullable<ScanMark["cell"]>;

/** A clean black-on-white crop of one schedule cell, sized for OCR. */
async function cellCrop(bitmap: ImageBitmap, cell: CellBox, textHeight: number) {
  const insetX = cell.width * 0.05;
  const left = Math.max(0, cell.x + insetX);
  const top = Math.max(0, cell.y);
  const right = Math.min(bitmap.width, cell.x + cell.width - insetX);
  const bottom = Math.min(bitmap.height, cell.y + cell.height);
  if (right - left < 4 || bottom - top < 4) return null;
  const scale = Math.max(1, Math.min(4, 52 / Math.max(6, textHeight)));
  const pad = 14;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((right - left) * scale) + pad * 2;
  canvas.height = Math.round((bottom - top) * scale) + pad * 2;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, left, top, right - left, bottom - top,
    pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  toGray(pixels.data);
  const threshold = otsuThreshold(pixels.data);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const value = pixels.data[offset] > threshold ? 255 : 0;
    pixels.data[offset] = value;
    pixels.data[offset + 1] = value;
    pixels.data[offset + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvasBlob(canvas);
}

export type ScanPreviewPass = ScanGeometry & { image?: Blob };

export type ReadCallbacks = {
  onPass?: (pass: ScanPreviewPass) => void;
  matchesSourceRow: (name: string) => boolean;
  /** 0–1 for this file only; callers keep it monotonic. */
  onFraction: (fraction: number) => void;
  /** Called once the engine is ready and real reading starts. */
  onReading: () => void;
  /** Called when an extra pass is needed for hard-to-read parts. */
  onDoubleCheck: () => void;
  /** Times this worker had on the same weekday in other imported weeks. */
  history?: (worker: string, date: string) => Array<{ start: string; end: string }>;
};

export type ScheduleRead = ParsedSchedule & {
  reviewImage?: Blob;
  /** The pass shown as the highlighted scan, with the final verdicts. */
  scan?: ScanPreviewPass;
};

/**
 * Reads a schedule photo with as few OCR passes as possible. Two different
 * renderings are always read and merged; a third pass only runs when the
 * merged result still looks thin. Then every time in your row, and any time
 * the passes disagree on, is re-read on its own with digits only. Every
 * readable detail is kept, even when parts of the image can't be read.
 */
export function readScheduleImage(file: File, callbacks: ReadCallbacks) {
  return scanScheduleImage(file, callbacks);
}

export async function recoverScheduleSource(
  file: Blob,
  matchesSourceRow: ReadCallbacks["matchesSourceRow"],
  onPass?: ReadCallbacks["onPass"],
) {
  const { createWorker } = await import("tesseract.js");
  // A saved photo can be opened while a new import starts using the shared reader.
  const reader = createWorker("eng", 1);
  const ignoreProgress = () => {};
  try {
    return await scanScheduleImage(file, {
      matchesSourceRow,
      onPass,
      onFraction: ignoreProgress,
      onReading: ignoreProgress,
      onDoubleCheck: ignoreProgress,
    }, reader, false);
  } finally {
    const worker = await reader.catch(() => null);
    await worker?.terminate().catch(() => undefined);
  }
}

type PassRecord = {
  geometry: ScanPreviewPass;
  /** The image the geometry's pixel coordinates refer to, when known. */
  coordinates?: Blob;
  overlay: boolean;
  original: boolean;
};

/** Own-row cells are always re-read; other rows only when in doubt. */
const MAX_OTHER_REREADS = 18;
const DIGITS_ONLY = "0123456789-";

async function scanScheduleImage(
  file: Blob,
  { matchesSourceRow, onFraction, onReading, onDoubleCheck, onPass, history }: ReadCallbacks,
  dedicatedReader?: Promise<TesseractWorker>,
  verify = true,
): Promise<ScheduleRead | null> {
  const { PSM } = await import("tesseract.js");
  const android = isAndroid();
  let fraction = 0;
  const report = (value: number) => {
    if (value <= fraction) return;
    fraction = Math.min(1, value);
    onFraction(fraction);
  };

  const setListener = (next: ReaderListener | null) => {
    if (!dedicatedReader) listener = next;
  };
  setListener(({ status, progress }) => {
    if (/loading|initializ/i.test(status)) report(0.05 * progress);
  });
  const [worker, enhanced, original] = await Promise.all([
    dedicatedReader ?? warmScheduleReader(),
    enhanceScheduleImage(file, android),
    readableOriginal(file, android),
  ]).finally(() => {
    setListener(null);
  });
  report(0.06);
  onReading();

  const passes: Array<{ image: Blob; mode: string }> = [
    { image: enhanced, mode: PSM.SPARSE_TEXT },
    { image: original, mode: PSM.SPARSE_TEXT },
  ];
  let fallback = { image: enhanced, mode: PSM.AUTO };
  const readable: ParsedSchedule[] = [];
  const records: PassRecord[] = [];
  const sources: Array<{
    schedule: ParsedSchedule;
    layout: ScheduleSourceLayout;
    image?: Blob;
    original: boolean;
  }> = [];
  let planned = passes.length;
  const readingEnd = verify ? 0.88 : 0.98;

  for (let index = 0; index < planned; index += 1) {
    const pass = index < passes.length ? passes[index] : fallback;
    const isOriginal = pass.image === original;
    if (index === passes.length) onDoubleCheck();
    const from = fraction;
    const to = from + (readingEnd - from) / (planned - index);
    setListener(({ status, progress }) => {
      if (status === "recognizing text") report(from + (to - from) * progress);
    });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: pass.mode as never,
        tessedit_char_whitelist: "",
        preserve_interword_spaces: "1",
      });
      const result = await worker.recognize(
        pass.image,
        { rotateAuto: true },
        { tsv: true, imageColor: isOriginal },
      );
      const deskewed = Boolean(result.data.rotateRadians);
      const alignedImage = result.data.imageColor;
      const image = deskewed && alignedImage
        ? new Blob([Uint8Array.from(atob(alignedImage.split(",")[1]), (byte) => byte.charCodeAt(0))], {
            type: "image/png",
          })
        : undefined;
      // Overlay coordinates must correspond to the photo shown on screen.
      const canOverlay = !deskewed || Boolean(image);
      const coordinates = deskewed ? image : pass.image;
      const parsed = result.data.tsv
        ? parseScheduleTsv(result.data.tsv, result.data.confidence, (geometry) => {
            const record = { ...geometry, image };
            records.push({ geometry: record, coordinates, overlay: canOverlay, original: isOriginal });
            if (onPass && canOverlay) onPass(record);
          })
        : null;
      if (parsed) {
        readable.push(parsed);
        if (parsed.sourceLayout && canOverlay) {
          sources.push({ schedule: parsed, layout: parsed.sourceLayout, image, original: isOriginal });
        }
      }
    } catch {
      // Keep whatever the other passes could read.
    } finally {
      setListener(null);
    }
    report(to);

    if (index === passes.length - 1) {
      const merged = mergeScheduleParses(readable);
      const hasSelectedRow = sources.some((candidate) =>
        candidate.schedule.dates.join() === merged?.dates.join() &&
        candidate.layout.rows.some((row) => matchesSourceRow(row.name)),
      );
      if (!hasSelectedRow) fallback = { image: original, mode: PSM.AUTO };
      if (!hasSelectedRow || !isStrongScheduleRead(merged)) planned += 1;
    }
  }

  let schedule = mergeScheduleParses(readable);
  if (!schedule) {
    report(1);
    return null;
  }
  const workers = new Set(schedule.shifts.map((shift) => shift.worker));
  const source = sources
    .filter((candidate) => candidate.schedule.dates.join() === schedule!.dates.join())
    .map((candidate) => ({
      ...candidate,
      includesSelectedRow: candidate.layout.rows.some((row) => matchesSourceRow(row.name)),
      matched: new Set(candidate.layout.rows.filter((row) => workers.has(row.name)).map((row) => row.name)).size,
    }))
    .sort((a, b) => Number(b.includesSelectedRow) - Number(a.includesSelectedRow) ||
      b.matched - a.matched || Number(b.original) - Number(a.original))[0];

  // The highlighted scan shown later: the pass that produced the source layout,
  // otherwise the overlayable pass with the most of the grid.
  const display = records
    .filter((record) => record.overlay && record.geometry.dates?.join() === schedule!.dates.join())
    .sort((a, b) =>
      Number(Boolean(source) && b.geometry.image === source?.image && b.original === source?.original) -
      Number(Boolean(source) && a.geometry.image === source?.image && a.original === source?.original) ||
      Number(Boolean(b.geometry.grid)) - Number(Boolean(a.geometry.grid)) ||
      b.geometry.marks.length - a.geometry.marks.length)[0]?.geometry;

  let scan: ScanPreviewPass | undefined = display;
  if (verify) {
    onDoubleCheck();
    const checked = await confirmShiftTimes({
      schedule, records, display, matchesSourceRow, history,
      readCell: async (crop) => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE as never,
          tessedit_char_whitelist: DIGITS_ONLY,
        });
        const { data } = await worker.recognize(crop);
        return { text: data.text ?? "", confidence: data.confidence ?? 0 };
      },
      onProgress: (done) => report(readingEnd + (0.99 - readingEnd) * done),
    }).finally(() => worker.setParameters({ tessedit_char_whitelist: "" }).catch(() => undefined));
    schedule = checked.schedule;
    scan = checked.display;
    if (scan && onPass) onPass(scan);
  }

  report(1);
  return { ...schedule, sourceLayout: source?.layout, reviewImage: source?.image, scan };
}

type CellGroup = {
  date: string;
  worker: string;
  own: boolean;
  marks: Array<{ mark: ScanMark; record: PassRecord }>;
};

async function confirmShiftTimes({
  schedule, records, display, matchesSourceRow, history, readCell, onProgress,
}: {
  schedule: ParsedSchedule;
  records: PassRecord[];
  display?: ScanPreviewPass;
  matchesSourceRow: (name: string) => boolean;
  history?: ReadCallbacks["history"];
  readCell: (crop: Blob) => Promise<{ text: string; confidence: number }>;
  onProgress: (fraction: number) => void;
}): Promise<{ schedule: ParsedSchedule; display?: ScanPreviewPass }> {
  const names = [...new Set(schedule.shifts.map((shift) => shift.worker))];
  const resolve = (name: string) => resolveSchedulePersonName(name, names);
  const groups = new Map<string, CellGroup>();
  for (const record of records) {
    if (record.geometry.dates?.join() !== schedule.dates.join()) continue;
    for (const mark of record.geometry.marks) {
      if (mark.kind !== "shift" || !mark.worker || !mark.date) continue;
      const worker = resolve(mark.worker);
      const key = `${mark.date}|${worker}`;
      const group = groups.get(key) ?? { date: mark.date, worker, own: false, marks: [] };
      group.own ||= matchesSourceRow(mark.worker);
      group.marks.push({ mark, record });
      groups.set(key, group);
    }
  }

  const priorsFor = (group: CellGroup) => {
    const priors: TimePrior[] = [];
    const add = (field: "start" | "end", value: string, from: TimePrior["from"]) => {
      const existing = priors.find((prior) => prior.field === field && prior.value === value && prior.from === from);
      if (existing) existing.count += 1;
      else priors.push({ field, value, count: 1, from });
    };
    for (const past of history?.(group.worker, group.date) ?? []) {
      add("start", past.start, "history");
      add("end", past.end, "history");
    }
    for (const shift of schedule.shifts) {
      if (shift.date !== group.date || shift.status !== "working" || shift.worker === group.worker) continue;
      add("start", shift.start, "coworkers");
      add("end", shift.end, "coworkers");
    }
    return priors;
  };

  const pageReadings = (group: CellGroup): TimeReading[] => group.marks
    .filter(({ mark }) => mark.shift)
    .map(({ mark }) => ({
      start: mark.shift!.start,
      end: mark.shift!.end,
      weight: mark.unreadable ? 0 : Math.max(0, Math.min(1, mark.confidence / 100)),
      source: "page" as const,
    }));

  // Decide which cells deserve a digits-only re-read.
  const candidates = [...groups.values()].filter((group) =>
    group.marks.some(({ mark }) => mark.shift || (mark.text.match(/\d/g)?.length ?? 0) >= 6));
  const needsCheck = (group: CellGroup) => {
    const readings = pageReadings(group);
    const verdict = decideShiftTime(readings, priorsFor(group));
    return !verdict || verdict.level !== "confident" || verdict.support < 2 ||
      new Set(readings.map((reading) => `${reading.start}-${reading.end}`)).size > 1;
  };
  const own = candidates.filter((group) => group.own);
  const others = candidates.filter((group) => !group.own && needsCheck(group)).slice(0, MAX_OTHER_REREADS);
  const reread = [...own, ...others];

  const bitmaps = new Map<Blob, Promise<ImageBitmap | null>>();
  const bitmapFor = (image: Blob) => {
    if (!bitmaps.has(image)) {
      bitmaps.set(image, typeof createImageBitmap === "function"
        ? createImageBitmap(image).catch(() => null)
        : Promise.resolve(null));
    }
    return bitmaps.get(image)!;
  };
  const cellReads = new Map<CellGroup, TimeReading>();
  try {
    for (let index = 0; index < reread.length; index += 1) {
      const group = reread[index];
      const best = group.marks
        .filter(({ mark, record }) => mark.cell && record.coordinates)
        .sort((a, b) => b.mark.confidence - a.mark.confidence)[0];
      if (best) {
        try {
          const bitmap = await bitmapFor(best.record.coordinates!);
          const crop = bitmap && await cellCrop(bitmap, best.mark.cell!, best.mark.height);
          if (crop) {
            const { text, confidence } = await readCell(crop);
            const range = readCellDigits(text);
            if (range) {
              cellReads.set(group, {
                ...range, weight: Math.max(0, Math.min(1, confidence / 100)), source: "cell",
              });
            }
          }
        } catch {
          // The page reads still stand.
        }
      }
      onProgress((index + 1) / reread.length);
    }
  } finally {
    for (const pending of bitmaps.values()) void pending.then((bitmap) => bitmap?.close());
  }

  const shifts = [...schedule.shifts];
  const verdicts = new Map<string, ReturnType<typeof decideShiftTime>>();
  for (const [key, group] of groups) {
    const readings = pageReadings(group);
    const cell = cellReads.get(group);
    if (cell) readings.push(cell);
    // A lone digits-only read of an otherwise unreadable cell is kept, but checked.
    const verdict = decideShiftTime(readings, priorsFor(group));
    if (!verdict) continue;
    if (!readings.some((reading) => reading.source === "page")) {
      verdict.level = "check";
      verdict.note = "Only read on a second look";
    }
    verdicts.set(key, verdict);
    const index = shifts.findIndex((shift) => shift.date === group.date && shift.worker === group.worker);
    const existing = index >= 0 ? shifts[index] : undefined;
    if (existing?.status === "pto") continue;
    const next = {
      ...existing,
      date: group.date,
      worker: group.worker,
      status: "working" as const,
      start: verdict.start,
      end: verdict.end,
      id: `${group.date}-${group.worker}-${verdict.start}`,
    };
    if (index >= 0) shifts[index] = next;
    else shifts.push(next);
  }

  const updated = display && {
    ...display,
    marks: display.marks.map((mark) => {
      if (mark.kind !== "shift" || !mark.worker || !mark.date) return mark;
      const verdict = verdicts.get(`${mark.date}|${resolve(mark.worker)}`);
      if (!verdict) return mark;
      return {
        ...mark,
        unreadable: false,
        shift: { date: mark.date, start: verdict.start, end: verdict.end },
        // Re-score so the colors reflect the combined reads, not one pass.
        confidence: verdict.level === "confident" ? Math.max(mark.confidence, 90) : Math.min(mark.confidence, 70),
        note: verdict.note,
      };
    }),
  };
  return { schedule: { ...schedule, shifts }, display: updated };
}
