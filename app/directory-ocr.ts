import {
  applyNumberReread,
  numberBoxes,
  parseDirectory,
  wordsFromTsv,
  type DirectoryEntry,
  type PlacedText,
} from "./directory-data";
import { progressClock, type ReadProgress } from "./read-progress";

/** A guess until it's measured: one number check vs. one whole screenshot. */
const CHECK_COST = 0.05;
const CHECKS_PER_SCREENSHOT = 20;

/**
 * Reads a phone directory on this phone: screenshots with the same OCR
 * engine as schedule imports, or a PDF's own text (exact, no OCR).
 */

/** Grayscale, and dark-mode screenshots turned dark-on-light. */
async function prepare(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  let total = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    data[offset] = gray;
    total += gray;
  }
  const dark = total / (data.length / 4) < 110;
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = dark ? 255 - data[offset] : data[offset];
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  const image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/png"));
  return { image, canvas, bitmap };
}

/** One number cut out, enlarged and made black-on-white for a digits-only read. */
function numberCrop(source: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }) {
  const pad = Math.round(box.height * 0.5);
  const left = Math.max(0, box.x - pad);
  const top = Math.max(0, box.y - pad);
  const width = Math.min(source.width - left, box.width + pad * 2);
  const height = Math.min(source.height - top, box.height + pad * 2);
  const scale = Math.max(2, Math.min(5, 48 / Math.max(6, box.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale) + 40;
  canvas.height = Math.round(height * scale) + 40;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, left, top, width, height, 20, 20, canvas.width - 40, canvas.height - 40);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const value = pixels.data[offset] > 150 ? 255 : 0;
    pixels.data[offset] = value;
    pixels.data[offset + 1] = value;
    pixels.data[offset + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function readDirectoryImages(
  files: File[],
  onProgress: (progress: ReadProgress) => void,
): Promise<DirectoryEntry[]> {
  const clock = progressClock(onProgress);
  const shots = files.length;
  clock.setTotal(shots * (1 + CHECKS_PER_SCREENSHOT * CHECK_COST));
  clock.step("Starting the reader…");
  // Where the current read sits: progress maps to [from, from + size].
  let from = 0;
  let size = 1;
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: ({ status, progress }) => {
      if (status === "recognizing text") clock.at(from + size * progress * 0.95);
    },
  });
  clock.startTiming();
  const canvases: HTMLCanvasElement[] = [];
  try {
    const words: PlacedText[] = [];
    for (let index = 0; index < files.length; index += 1) {
      from = index;
      size = 1;
      clock.step(files.length > 1 ? `Reading screenshot ${index + 1} of ${files.length}` : "Reading the screenshot");
      try {
        const { image, canvas, bitmap } = await prepare(files[index]);
        bitmap.close();
        canvases[index] = canvas;
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT as never,
          tessedit_char_whitelist: "",
          preserve_interword_spaces: "1",
        });
        const { data } = await worker.recognize(image, {}, { tsv: true });
        words.push(...wordsFromTsv(data.tsv ?? "", index));
      } catch {
        // Keep what the other screenshots had.
      }
      clock.at(index + 1);
    }
    let entries = parseDirectory(words);

    // Double-check every number digits-only; a wrong digit means a wrong call.
    const jobs = entries.flatMap((entry, index) =>
      (Object.entries(numberBoxes(entry)) as Array<["phone" | "ext" | "cell", NonNullable<ReturnType<typeof numberBoxes>["phone"]>]>)
        .map(([field, box]) => ({ index, field, box })));
    clock.setTotal(shots + jobs.length * CHECK_COST);
    if (jobs.length) {
      // Number checks run at their own pace; time them on their own.
      clock.startTiming();
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE as never,
        tessedit_char_whitelist: "0123456789-",
      });
      for (let job = 0; job < jobs.length; job += 1) {
        clock.step(`Double-checking numbers ${job + 1} of ${jobs.length}`);
        from = shots + job * CHECK_COST;
        size = CHECK_COST;
        clock.at(from);
        const { index, field, box } = jobs[job];
        const source = canvases[box.group];
        if (!source) continue;
        try {
          const crop = await numberCrop(source, box);
          if (!crop) continue;
          const { data } = await worker.recognize(crop);
          entries[index] = applyNumberReread(entries[index], field, data.text ?? "");
        } catch {
          // The first read stands.
        }
      }
    }
    clock.finish();
    entries = entries.map((entry) => ({ ...entry }));
    return entries;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export async function readDirectoryPdf(file: File, onProgress: (progress: ReadProgress) => void): Promise<DirectoryEntry[]> {
  const clock = progressClock(onProgress);
  clock.step("Opening the PDF…");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const words: PlacedText[] = [];
  clock.setTotal(pdf.numPages);
  clock.startTiming();
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      clock.step(`Reading page ${pageNumber} of ${pdf.numPages}`);
      const page = await pdf.getPage(pageNumber);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 10;
        // PDF y runs bottom-up; flip it so rows read top to bottom.
        words.push({
          text: item.str.trim(),
          x: item.transform[4],
          y: height - item.transform[5] - size,
          width: item.width,
          height: size,
          group: pageNumber,
        });
      }
      clock.at(pageNumber);
    }
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
  clock.finish();
  return parseDirectory(words).map((entry) => ({ ...entry }));
}
