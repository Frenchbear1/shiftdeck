/**
 * Share links. Everything is encrypted on this phone (AES-GCM, a new random
 * key per link) before it's uploaded; the key goes in the link's #fragment,
 * which is never sent to any server. Opening the link downloads the
 * scrambled copy and unlocks it on the coworker's phone.
 */
import { packShare, unpackShare, type SharePackage } from "./share-data";

const b64url = (bytes: Uint8Array) => {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (text: string) => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

async function squeeze(bytes: Uint8Array, mode: "compress" | "decompress") {
  const Stream = mode === "compress" ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!Stream) return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Stream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Schedule photos go as JPEGs: Android can't open iPhone HEIC photos, and a
 * re-encoded photo is a fraction of the size. PDFs and anything that can't
 * be decoded are sent as they are.
 */
export async function shareableSchedule(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    canvas.width = 0;
    canvas.height = 0;
    return jpeg && (jpeg.size < file.size || file.type !== "image/jpeg") ? jpeg : file;
  } catch {
    return file;
  }
}

export type CreatedShare = { url: string; expiresAt: string };

export async function createShareLink(
  share: SharePackage,
  { service, appUrl, days }: { service: string; appUrl: string; days: 1 | 7 },
): Promise<CreatedShare> {
  const packed = await packShare(share);
  const compressed = await squeeze(packed, "compress");
  // First byte says whether the rest is gzipped.
  const plain = new Uint8Array(1 + (compressed ?? packed).length);
  plain[0] = compressed ? 1 : 0;
  plain.set(compressed ?? packed, 1);

  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const body = new Uint8Array(iv.length + sealed.length);
  body.set(iv, 0);
  body.set(sealed, iv.length);

  // text/plain keeps this a "simple" request (no CORS preflight).
  const response = await fetch(`${service}/api/shares?days=${days}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: new Blob([body as BlobPart], { type: "text/plain" }),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; expiresAt?: string; error?: string };
  if (!response.ok || !result.id) throw new Error(result.error ?? "The link couldn't be made. Check your connection.");
  const url = new URL(appUrl);
  url.search = "";
  url.searchParams.set("share", result.id);
  url.hash = `k=${b64url(keyBytes)}`;
  return { url: url.href, expiresAt: result.expiresAt ?? "" };
}

export type ShareKey = { id: string; key: string };

/** The share id and key in an address (this page's, or a pasted link). */
export function shareInLocation(location: { search: string; hash: string }): ShareKey | null {
  const id = new URLSearchParams(location.search).get("share");
  const key = new URLSearchParams(location.hash.slice(1)).get("k");
  return id && key && /^[A-Za-z0-9_-]{16,40}$/.test(id) ? { id, key } : null;
}

/** Finds a share link anywhere in pasted text (like a whole forwarded message). */
export function shareInText(text: string): ShareKey | null {
  for (const match of text.match(/https?:\/\/\S+/g) ?? []) {
    try {
      const found = shareInLocation(new URL(match.replace(/[).,]+$/, "")));
      if (found) return found;
    } catch {
      // Not a link.
    }
  }
  return null;
}

export async function openShareLink({ id, key }: ShareKey, service: string) {
  const response = await fetch(`${service}/api/shares/${id}`, { cache: "no-store" });
  if (response.status === 410 || response.status === 404) throw new Error("This share link has expired. Ask for a new one.");
  if (!response.ok) throw new Error("The share couldn't be opened. Check your connection and try again.");
  const body = new Uint8Array(await response.arrayBuffer());
  let plain: Uint8Array;
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, ["decrypt"]);
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: body.subarray(0, 12) }, cryptoKey, body.subarray(12)));
  } catch {
    throw new Error("This link is incomplete. Copy the whole link and try again.");
  }
  const packed = plain[0] === 1 ? await squeeze(plain.subarray(1), "decompress") : plain.subarray(1);
  if (!packed) throw new Error("This phone's browser can't open this share. Update it and try again.");
  return { ...unpackShare(packed), expiresAt: response.headers.get("X-Share-Expires") ?? "" };
}
