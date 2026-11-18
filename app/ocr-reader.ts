/**
 * The OCR reader for contact and directory screenshots. It starts loading
 * when the + menu opens, so it's usually ready by the time screenshots have
 * been picked; each read takes it and shuts it down afterwards.
 */
import type { Worker } from "tesseract.js";

type Log = { status: string; progress: number };

let pending: Promise<Worker> | null = null;
let listener: ((log: Log) => void) | null = null;

export function warmReader() {
  if (!pending) {
    pending = import("tesseract.js")
      .then(({ createWorker }) => createWorker("eng", 1, { logger: (log: Log) => listener?.(log) }))
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

/** The reader for one read; release() shuts it down. */
export async function takeReader(onLog: (log: Log) => void) {
  const worker = await warmReader();
  pending = null;
  listener = onLog;
  return {
    worker,
    release: async () => {
      if (listener === onLog) listener = null;
      await worker.terminate().catch(() => undefined);
    },
  };
}

/** A warmed reader nobody used (the sheet closed): free its memory. */
export function coolReader() {
  const unused = pending;
  pending = null;
  void unused?.then((worker) => worker.terminate()).catch(() => undefined);
}
