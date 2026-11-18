import { parseListScreenshotText, type ContactEntry } from "./contacts-data";

/**
 * Reads names and emails from screenshots of a member list, entirely on this
 * phone (the same OCR engine as schedule imports). Dark-mode screenshots are
 * inverted first, since OCR reads dark text on light best.
 */
async function prepare(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(2, Math.max(1, 1600 / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      return file;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    let total = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      data[offset] = gray;
      total += gray;
    }
    const dark = total / (data.length / 4) < 120;
    for (let offset = 0; offset < data.length; offset += 4) {
      const value = dark ? 255 - data[offset] : data[offset];
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/png"));
  } catch {
    return file;
  }
}

export async function readContactScreenshots(
  files: File[],
  onProgress: (done: number, total: number) => void,
): Promise<ContactEntry[]> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO as never });
    const entries: ContactEntry[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < files.length; index += 1) {
      onProgress(index, files.length);
      try {
        const { data } = await worker.recognize(await prepare(files[index]));
        for (const entry of parseListScreenshotText(data.text ?? "")) {
          if (entry.email && seen.has(entry.email)) continue;
          if (entry.email) seen.add(entry.email);
          entries.push(entry);
        }
      } catch {
        // Keep what the other screenshots had.
      }
    }
    onProgress(files.length, files.length);
    return entries;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
