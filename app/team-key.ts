/**
 * The team key encrypts everything sent to the team. It lives only on
 * phones: a phone that has it wraps it for a new phone's public key (ECDH
 * P-256 → AES-GCM), and the server just carries the wrapped copy.
 *
 * Phones prove they have the key with `proof` (a hash of it); the server
 * keeps only a hash of the proof (`check`), so the check it shows everyone
 * says nothing about the key and can't be used to pretend to have it.
 */
import { randomKey } from "./share-link.ts";

const TEAM_KEY = "shiftdeck.teamKey";
const PAIR_KEY = "shiftdeck.deviceKeys";

type Pair = { publicJwk: JsonWebKey; privateJwk: JsonWebKey };

const read = <T,>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the phone asks again next time.
  }
};

export const loadTeamKey = () => {
  const key = read<string>(TEAM_KEY);
  return typeof key === "string" && key.length >= 16 ? key : null;
};
export const saveTeamKey = (key: string | null) => write(TEAM_KEY, key);
export const newTeamKey = () => randomKey();

async function hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What this phone sends to show it has the key. */
export const keyProof = (key: string) => hex(`shiftdeck-team-key:${key}`);
/** What the server shows (a hash of the proof), to check a key against. */
export const keyCheck = async (key: string) => hex(await keyProof(key));

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** This phone's key pair, made once. Only the public half leaves the phone. */
export async function devicePair(): Promise<Pair> {
  const saved = read<Pair>(PAIR_KEY);
  if (saved?.publicJwk && saved?.privateJwk) return saved;
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
  const made = {
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  write(PAIR_KEY, made);
  return made;
}

export const publicKeyText = (pair: Pair) => {
  const { kty, crv, x, y } = pair.publicJwk;
  return JSON.stringify({ kty, crv, x, y });
};

async function sharedKey(privateJwk: JsonWebKey, publicJwk: JsonWebKey) {
  const own = await crypto.subtle.importKey("jwk", privateJwk, ECDH, false, ["deriveKey"]);
  const their = await crypto.subtle.importKey("jwk", publicJwk, ECDH, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: their }, own, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The team key, wrapped so only the phone with `publicKey` can open it. */
export async function wrapTeamKey(teamKey: string, publicKey: string, pair: Pair) {
  const aes = await sharedKey(pair.privateJwk, JSON.parse(publicKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(teamKey));
  return JSON.stringify({ from: JSON.parse(publicKeyText(pair)), iv: b64(iv), data: b64(data) });
}

/** Opens a wrapped team key sent to this phone (null if it doesn't open). */
export async function unwrapTeamKey(wrapped: string, pair: Pair): Promise<string | null> {
  try {
    const { from, iv, data } = JSON.parse(wrapped);
    const aes = await sharedKey(pair.privateJwk, from);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, aes, unb64(data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
