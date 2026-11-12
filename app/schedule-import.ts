import {
  mergeScheduleParses,
  parseScheduleTsv,
  ParsedSchedule,
} from "./schedule-parser";
import { isStrongScheduleRead } from "./schedule-tools";

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

async function enhanceScheduleImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.max(1, Math.min(2.2, 2200 / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
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
    const data = pixels.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      const gray =
        data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
      data[offset] = contrasted;
      data[offset + 1] = contrasted;
      data[offset + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? file), "image/png"),
    );
  } catch {
    return file;
  }
}

export type ReadCallbacks = {
  /** 0–1 for this file only; callers keep it monotonic. */
  onFraction: (fraction: number) => void;
  /** Called once the engine is ready and real reading starts. */
  onReading: () => void;
  /** Called when an extra pass is needed for hard-to-read parts. */
  onDoubleCheck: () => void;
};

/**
 * Reads a schedule photo with as few OCR passes as possible. Two different
 * renderings are always read and merged; a third pass only runs when the
 * merged result still looks thin. Every readable detail is kept, even when
 * parts of the image can't be read.
 */
export async function readScheduleImage(
  file: File,
  { onFraction, onReading, onDoubleCheck }: ReadCallbacks,
): Promise<ParsedSchedule | null> {
  const { PSM } = await import("tesseract.js");
  let fraction = 0;
  const report = (value: number) => {
    if (value <= fraction) return;
    fraction = Math.min(1, value);
    onFraction(fraction);
  };

  listener = ({ status, progress }) => {
    if (/loading|initializ/i.test(status)) report(0.05 * progress);
  };
  const [worker, enhanced] = await Promise.all([
    warmScheduleReader(),
    enhanceScheduleImage(file),
  ]).finally(() => {
    listener = null;
  });
  report(0.06);
  onReading();

  const passes: Array<{ image: Blob; mode: string }> = [
    { image: enhanced, mode: PSM.SPARSE_TEXT },
    { image: file, mode: PSM.SPARSE_TEXT },
  ];
  const fallback = { image: enhanced, mode: PSM.AUTO };
  const readable: ParsedSchedule[] = [];
  let planned = passes.length;

  for (let index = 0; index < planned; index += 1) {
    const pass = index < passes.length ? passes[index] : fallback;
    if (index === passes.length) onDoubleCheck();
    const from = fraction;
    const to = from + (0.98 - from) / (planned - index);
    listener = ({ status, progress }) => {
      if (status === "recognizing text") report(from + (to - from) * progress);
    };
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: pass.mode as never,
        preserve_interword_spaces: "1",
      });
      const result = await worker.recognize(
        pass.image,
        { rotateAuto: true },
        { text: true, tsv: true },
      );
      const parsed = result.data.tsv
        ? parseScheduleTsv(result.data.tsv, result.data.confidence)
        : null;
      if (parsed) readable.push(parsed);
    } catch {
      // Keep whatever the other passes could read.
    } finally {
      listener = null;
    }
    report(to);

    if (
      index === passes.length - 1 &&
      planned === passes.length &&
      !isStrongScheduleRead(mergeScheduleParses(readable))
    ) {
      planned += 1;
    }
  }

  report(1);
  return mergeScheduleParses(readable);
}
