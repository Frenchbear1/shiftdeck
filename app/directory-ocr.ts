import {
  applyNumberReread,
  numberBoxes,
  parseDirectory,
  wordsFromTsv,
  type DirectoryEntry,
  type PlacedText,
} from "./directory-data";
import { takeReader } from "./ocr-reader";
import { expectedChecksPerShot, progressClock, type ReadProgress } from "./read-progress";

/**
 * Reads a phone directory on this phone: screenshots with the same OCR
 * engine as schedule imports, or a PDF's own text (exact, no OCR).
 */

/** Photos past this many pixels on the long side are scaled down (reading stays quick, text stays sharp). */
const LONG_SIDE = 3000;

/** Grayscale, and dark-mode screenshots turned dark-on-light. */
async function prepare(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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

/**
 * The page with its lighting evened out: each pixel against the blurred page
 * around it. Rescues photos with shadows, glare or colored table cells.
 */
function evenOut(source: HTMLCanvasElement) {
  const { width, height } = source;
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(width / 24));
  small.height = Math.max(1, Math.round(height / 24));
  const smallContext = small.getContext("2d")!;
  smallContext.imageSmoothingQuality = "high";
  smallContext.drawImage(source, 0, 0, small.width, small.height);
  const blurred = document.createElement("canvas");
  blurred.width = width;
  blurred.height = height;
  const blurredContext = blurred.getContext("2d", { willReadFrequently: true })!;
  blurredContext.imageSmoothingQuality = "high";
  blurredContext.drawImage(small, 0, 0, width, height);
  const background = blurredContext.getImageData(0, 0, width, height).data;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const pixels = source.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = Math.min(255, (data[offset] / Math.max(1, background[offset])) * 235);
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/** How many real words OCR was sure of, and what share of them. */
function sureness(words: PlacedText[]) {
  const real = words.filter((word) => word.text.replace(/[^A-Za-z0-9]/g, "").length >= 3);
  const sure = real.filter((word) => (word.conf ?? 100) >= 80).length;
  return { sure, share: real.length ? sure / real.length : 0 };
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
  clock.plan([
    { step: "directory-shot", count: shots },
    { step: "number-check", count: shots * expectedChecksPerShot() },
  ]);
  clock.start("Starting the reader…", "load");
  try {
    const { PSM } = await import("tesseract.js");
    const reader = await takeReader(({ status, progress }) => {
      if (status === "recognizing text") clock.recognizing(progress);
    });
    clock.end();
    const { worker } = reader;
    const canvases: HTMLCanvasElement[] = [];
    try {
      const words: PlacedText[] = [];
      for (let index = 0; index < shots; index += 1) {
        clock.start(shots > 1 ? `Reading page ${index + 1} of ${shots}` : "Reading the page", "directory-shot");
        try {
          const { image, canvas, bitmap } = await prepare(files[index]);
          bitmap.close();
          canvases[index] = canvas;
          clock.size((canvas.width * canvas.height) / 1e6);
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT as never,
            tessedit_char_whitelist: "",
            preserve_interword_spaces: "1",
          });
          const { data } = await worker.recognize(image, {}, { tsv: true });
          let read = wordsFromTsv(data.tsv ?? "", index);
          // OCR mostly unsure (shadows, glare, colored cells): read it again with the lighting evened out.
          const first = sureness(read);
          if (first.share < 0.6) {
            clock.end();
            clock.start(shots > 1 ? `Reading page ${index + 1} again, clearer` : "Reading it again, clearer", "directory-shot");
            const evened = evenOut(canvas);
            const blob = await new Promise<Blob | null>((resolve) => evened.toBlob(resolve, "image/png"));
            if (blob) {
              const again = wordsFromTsv((await worker.recognize(blob, {}, { tsv: true })).data.tsv ?? "", index);
              if (sureness(again).sure > first.sure) {
                read = again;
                canvases[index] = evened;
              }
            }
          }
          words.push(...read);
        } catch {
          // Keep what the other screenshots had.
        }
        clock.end();
      }
      let entries = parseDirectory(words);

      // Double-check every number digits-only; a wrong digit means a wrong call.
      const jobs = entries.flatMap((entry, index) =>
        (Object.entries(numberBoxes(entry)) as Array<["phone" | "ext" | "cell", NonNullable<ReturnType<typeof numberBoxes>["phone"]>]>)
          .map(([field, box]) => ({ index, field, box })));
      if (entries.length) clock.noteChecks(jobs.length / shots);
      clock.plan([{ step: "number-check", count: jobs.length }]);
      if (jobs.length) {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE as never,
          tessedit_char_whitelist: "0123456789-",
        });
        for (let job = 0; job < jobs.length; job += 1) {
          clock.start(`Double-checking numbers ${job + 1} of ${jobs.length}`, "number-check");
          const { index, field, box } = jobs[job];
          const source = canvases[box.group];
          try {
            const crop = source ? await numberCrop(source, box) : null;
            if (crop) {
              const { data } = await worker.recognize(crop);
              entries[index] = applyNumberReread(entries[index], field, data.text ?? "");
            }
          } catch {
            // The first read stands.
          }
          clock.end();
        }
      }
      clock.finish();
      entries = entries.map((entry) => ({ ...entry }));
      return entries;
    } finally {
      await reader.release();
    }
  } finally {
    clock.stop();
  }
}

export async function readDirectoryPdf(file: File, onProgress: (progress: ReadProgress) => void): Promise<DirectoryEntry[]> {
  const clock = progressClock(onProgress);
  clock.start("Opening the PDF…", "pdf-page");
  const words: PlacedText[] = [];
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    clock.end();
    clock.plan([{ step: "pdf-page", count: pdf.numPages }]);
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        clock.start(`Reading page ${pageNumber} of ${pdf.numPages}`, "pdf-page");
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
        clock.end();
      }
      clock.finish();
    } finally {
      await pdf.destroy().catch(() => undefined);
    }
  } finally {
    clock.stop();
  }
  return parseDirectory(words).map((entry) => ({ ...entry }));
}
