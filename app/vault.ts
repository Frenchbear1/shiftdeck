/**
 * Your vault on the server: encrypted on your device with a key made from
 * the team key and your own id (the server only stores it), and only your
 * devices can fetch it. Saved with the version it was based on, so two
 * devices saving at once never overwrite each other: the second one merges
 * and tries again.
 */
import { merge, stable, type Vault } from "./vault-data.ts";

const LOCAL_KEY = "shiftdeck.vault";

/** `dirty`: changed here since the server last had it. */
export type LocalVault = { vault: Vault; version: number; stamped: boolean; dirty: boolean };

export function loadLocalVault(): LocalVault {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null") as Partial<LocalVault> | null;
    if (saved && typeof saved.vault === "object" && saved.vault) {
      return { vault: saved.vault, version: Number(saved.version) || 0, stamped: Boolean(saved.stamped), dirty: saved.dirty !== false };
    }
  } catch {
    // Starts over: the server copy fills it back in.
  }
  return { vault: {}, version: 0, stamped: false, dirty: false };
}

export function saveLocalVault(local: LocalVault) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  } catch {
    // Kept for this visit; the server has it.
  }
}

const b64 = (bytes: Uint8Array) => {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (text: string) => {
  const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(plain, (char) => char.charCodeAt(0));
};

async function vaultKey(teamKey: string, personId: string) {
  const base = await crypto.subtle.importKey("raw", unb64(teamKey), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("shiftdeck-vault"), info: new TextEncoder().encode(personId) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealVault(vault: Vault, teamKey: string, personId: string) {
  const key = await vaultKey(teamKey, personId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(vault))));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return b64(out);
}

/** The vault, or null if it doesn't open with this key (left alone, never overwritten). */
export async function openVault(data: string, teamKey: string, personId: string): Promise<Vault | null> {
  try {
    const key = await vaultKey(teamKey, personId);
    const bytes = unb64(data);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    const vault = JSON.parse(new TextDecoder().decode(plain));
    return vault && typeof vault === "object" ? vault as Vault : null;
  } catch {
    return null;
  }
}

type Remote = { version: number; data: string | null };
export type VaultApi = {
  get: (have: number) => Promise<Remote>;
  /** Saves on top of `base`; null when another device saved first. */
  put: (data: string, base: number) => Promise<{ version: number } | null>;
};

/**
 * Gets the server copy, merges it with this device's, saves the result if
 * the server is missing anything, and returns what everything comes to.
 */
export async function syncVault(local: LocalVault, api: VaultApi, teamKey: string, personId: string): Promise<LocalVault> {
  let vault = local.vault;
  let have = local.version;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remote = await api.get(have);
    // undefined: the server still has what this device last merged.
    let theirs: Vault | undefined;
    if (remote.data) {
      const opened = await openVault(remote.data, teamKey, personId);
      if (!opened) throw new Error("Your saved data didn't open with this device's key.");
      theirs = opened;
      vault = merge(vault, opened);
    } else if (remote.version !== have) {
      theirs = {}; // Nothing saved on the server (yet, or anymore).
    }
    const needed = theirs === undefined ? local.dirty && have === local.version : stable(theirs) !== stable(vault);
    if (!needed) return { vault, version: remote.version, stamped: local.stamped, dirty: false };
    const saved = await api.put(await sealVault(vault, teamKey, personId), remote.version);
    if (saved) return { vault, version: saved.version, stamped: local.stamped, dirty: false };
    have = -1; // Another device saved in between: merge with theirs and try again.
  }
  throw new Error("Couldn't save: your devices kept saving at the same time.");
}
