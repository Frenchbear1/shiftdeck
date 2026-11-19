import {
  mergeScheduleParses,
  parseScheduleTsv,
  ParsedSchedule,
  isPlausibleWorkerName,
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
/** A second reader, so the page's two halves are read at the same time on phones with the cores for it. */
let helperPromise: Promise<TesseractWorker | null> | null = null;
let listener: ReaderListener | null = null;

const canReadInParallel = () =>
  typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 2) >= 4 &&
  ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) >= 3;

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
  if (!helperPromise && canReadInParallel()) {
    helperPromise = import("tesseract.js")
      .then(({ createWorker }) => createWorker("eng", 1))
      .catch(() => null);
  }
  return enginePromise;
}

export async function releaseScheduleReader() {
  const pending = enginePromise;
  const helper = helperPromise;
  enginePromise = null;
  helperPromise = null;
  const [worker, second] = await Promise.all([pending?.catch(() => null), helper?.catch(() => null)]);
  await Promise.all([worker?.terminate().catch(() => undefined), second?.terminate().catch(() => undefined)]);
}

/** Text that's white on a dark fill isn't on these schedules: skipping that check is ~7% faster. */
const PAGE_PARAMETERS = { preserve_interword_spaces: "1", tessedit_do_invert: "0" };

/**
 * Reads the top and bottom halves at the same time on two readers and
 * stitches the words back into one page. The halves overlap, and each word is
 * taken from the half its middle is in, so words on the cut are whole.
 */
async function readInHalves(first: TesseractWorker, second: TesseractWorker, image: Blob, mode: string) {
  const bitmap = await createImageBitmap(image);
  try {
    const { width, height } = bitmap;
    const cut = Math.round(height / 2);
    const overlap = Math.max(24, Math.round(height * 0.04));
    const half = async (top: number, bottom: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = bottom - top;
      canvas.getContext("2d")!.drawImage(bitmap, 0, top, width, bottom - top, 0, 0, width, bottom - top);
      return (await canvasBlob(canvas))!;
    };
    const [upper, lower] = await Promise.all([half(0, Math.min(height, cut + overlap)), half(Math.max(0, cut - overlap), height)]);
    const read = async (worker: TesseractWorker, part: Blob) => {
      await worker.setParameters({ tessedit_pageseg_mode: mode as never, tessedit_char_whitelist: "", ...PAGE_PARAMETERS });
      return (await worker.recognize(part, {}, { tsv: true })).data;
    };
    const [a, b] = await Promise.all([read(first, upper), read(second, lower)]);
    const words = (tsv: string | null | undefined, offset: number, keep: (middle: number) => boolean) =>
      (tsv ?? "").split(/\r?\n/).filter((line) => line.startsWith("5\t")).flatMap((line) => {
        const parts = line.split("\t");
        const top = Number(parts[7]) + offset;
        if (!keep(top + Number(parts[9]) / 2)) return [];
        parts[7] = String(top);
        return [parts.join("\t")];
      });
    const tsv = [
      ["1", "1", "0", "0", "0", "0", "0", "0", width, height, "-1", ""].join("\t"),
      ...words(a.tsv, 0, (middle) => middle < cut),
      ...words(b.tsv, cut - overlap, (middle) => middle >= cut),
    ].join("\n");
    return { tsv, confidence: ((a.confidence ?? 0) + (b.confidence ?? 0)) / 2 };
  } finally {
    bitmap.close();
  }
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
  /** Names already known from earlier imports: when every name read is one, one pass is enough. */
  knownNames?: string[];
  /**
   * Set when this device doesn't know whose schedule it is yet. Called with
   * the names read from the photo before your row is cropped and checked.
   */
  choosePerson?: (names: string[]) => Promise<void>;
};

export type ScheduleRead = ParsedSchedule & {
  reviewImage?: Blob;
  /** The pass shown as the highlighted scan, with the final verdicts. */
  scan?: ScanPreviewPass;
};

/**
 * Reads a schedule photo with as few OCR passes as possible. The photo as
 * taken is read first: for screenshots that's both the fastest and the most
 * accurate read. A sharpened, enlarged copy (better for blurry camera photos)
 * is only read when that first read is thin, misses your row, or has a name
 * not seen before; a last full-page pass only when it's still thin. Then
 * only the times that weren't read clearly are re-read with digits only.
 * Every readable detail is kept, even when parts of the image can't be read.
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

/** Unclear cells are re-read: all of your row's, and a few of everyone else's. */
const MAX_OTHER_REREADS = 8;
const DIGITS_ONLY = "0123456789-";

async function scanScheduleImage(
  file: Blob,
  { matchesSourceRow, onFraction, onReading, onDoubleCheck, onPass, history, choosePerson, knownNames }: ReadCallbacks,
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
  const [worker, original, helper] = await Promise.all([
    dedicatedReader ?? warmScheduleReader(),
    readableOriginal(file, android),
    dedicatedReader ? null : helperPromise?.catch(() => null) ?? null,
  ]).finally(() => {
    setListener(null);
  });
  report(0.06);
  onReading();
  // The sharpened copy is only made if it's needed.
  let enhancedCopy: Promise<Blob> | null = null;
  const enhanced = () => (enhancedCopy ??= enhanceScheduleImage(file, android));

  const passes: Array<{ image: Blob | (() => Promise<Blob>); mode: string }> = [
    { image: original, mode: PSM.SPARSE_TEXT },
  ];
  // The first read came out clean, so the page is flat: later reads can be split too.
  let flatPage = false;
  const known = new Set((knownNames ?? []).filter(Boolean).map((name) => resolveSchedulePersonName(name, knownNames ?? [])));
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
    const pass = passes[index];
    const image = typeof pass.image === "function" ? await pass.image() : pass.image;
    const isOriginal = image === original;
    if (index > 0) onDoubleCheck();
    const from = fraction;
    const to = from + (readingEnd - from) / (planned - index);
    setListener(({ status, progress }) => {
      if (status === "recognizing text") report(from + (to - from) * progress);
    });
    try {
      // The first read of a flat screenshot is split across two readers; a
      // tilted photo that reads poorly that way gets the straightened passes after.
      const halves = (index === 0 || (index === 1 && flatPage)) && helper && typeof createImageBitmap === "function"
        ? await readInHalves(worker, helper, image, pass.mode).catch(() => null)
        : null;
      if (!halves) {
        await worker.setParameters({
          tessedit_pageseg_mode: pass.mode as never,
          tessedit_char_whitelist: "",
          ...PAGE_PARAMETERS,
        });
      }
      const result = halves
        ? { data: { tsv: halves.tsv, confidence: halves.confidence, rotateRadians: 0, imageColor: undefined as string | undefined } }
        : await worker.recognize(
          image,
          { rotateAuto: true },
          { tsv: true, imageColor: isOriginal },
        );
      const deskewed = Boolean(result.data.rotateRadians);
      const alignedImage = result.data.imageColor;
      const alignedBlob = deskewed && alignedImage
        ? new Blob([Uint8Array.from(atob(alignedImage.split(",")[1]), (byte) => byte.charCodeAt(0))], {
            type: "image/png",
          })
        : undefined;
      // Overlay coordinates must correspond to the photo shown on screen.
      const canOverlay = !deskewed || Boolean(alignedBlob);
      const coordinates = deskewed ? alignedBlob : image;
      const parsed = result.data.tsv
        ? parseScheduleTsv(result.data.tsv, result.data.confidence, (geometry) => {
            const record = { ...geometry, image: alignedBlob };
            records.push({ geometry: record, coordinates, overlay: canOverlay, original: isOriginal });
            if (onPass && canOverlay) onPass(record);
          })
        : null;
      if (parsed) {
        readable.push(parsed);
        if (parsed.sourceLayout && canOverlay) {
          sources.push({ schedule: parsed, layout: parsed.sourceLayout, image: alignedBlob, original: isOriginal });
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
      // Without a chosen name there's no row to look for yet.
      const hasSelectedRow = Boolean(choosePerson) || sources.some((candidate) =>
        candidate.schedule.dates.join() === merged?.dates.join() &&
        candidate.layout.rows.some((row) => matchesSourceRow(row.name)),
      );
      const strong = isStrongScheduleRead(merged);
      if (index === 0) {
        flatPage = strong && hasSelectedRow;
        // Every name read is someone already known (clipped readings included)?
        // A couple of new coworkers is normal; a clipped-looking name ("Ed Plank") or a
        // mostly unknown sheet (the first import) gets the second, sharper read.
        const unknown = merged && known.size
          ? [...new Set(merged.shifts.map((shift) => shift.worker))]
            .filter((name) => !known.has(resolveSchedulePersonName(name, [...known])))
          : null;
        const looksWhole = (name: string) => {
          const parts = name.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
          return parts.length >= 2 && parts[0].length >= 4 && parts[parts.length - 1].length >= 4;
        };
        const namesKnown = Boolean(unknown) && unknown!.length <= 3 && unknown!.every(looksWhole);
        if (!strong || !hasSelectedRow || !namesKnown) {
          passes.push({ image: enhanced, mode: PSM.SPARSE_TEXT });
          planned += 1;
        }
      } else if (index === 1 && (!hasSelectedRow || !strong)) {
        passes.push({ image: hasSelectedRow ? enhanced : original, mode: PSM.AUTO });
        planned += 1;
      }
    }
  }

  let schedule = mergeScheduleParses(readable);
  if (!schedule) {
    report(1);
    return null;
  }
  if (choosePerson) {
    const names = [...new Set(schedule.shifts.map((shift) => shift.worker))]
      .filter(isPlausibleWorkerName)
      .sort((a, b) => a.localeCompare(b));
    if (names.length) await choosePerson(names);
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
  // A time read clearly (one pass of a sharp screenshot is enough) isn't read again.
  const needsCheck = (group: CellGroup) => {
    const readings = pageReadings(group);
    const verdict = decideShiftTime(readings, priorsFor(group));
    return !verdict || verdict.level !== "confident" ||
      new Set(readings.map((reading) => `${reading.start}-${reading.end}`)).size > 1;
  };
  const own = candidates.filter((group) => group.own && needsCheck(group));
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
