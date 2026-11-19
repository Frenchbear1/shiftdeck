/**
 * This phone's identity in the app: a random id and secret made on the
 * phone (the server keeps only a hash of the secret), tied to the person
 * whose name it picked. Everyone who uses the app is one team. The name is
 * locked; the owner changes names, blocks people, and is the only one who
 * can hand ownership on. A person adds more phones with a one-time code.
 */
import type { TeamPerson, TeamPost } from "./team.ts";

export type PhoneSummary = {
  id: string;
  /** The owner's name for it, or what kind of phone it is. */
  label: string;
  model: string | null;
  /** The owner gave it a name. */
  named: boolean;
  /** The phone you're holding. */
  current: boolean;
  since: string;
  seen: string;
};

export type PersonSummary = {
  id: string;
  name: string;
  owner: boolean;
  blocked?: boolean;
  blockedAt?: string | null;
  /** Can send things to the team (the owner always can). */
  canShare?: boolean;
  devices: number;
  /** When they started using the app. */
  since: string;
  seen: string | null;
  phones?: PhoneSummary[];
};

export type AppNameRequest = { id: string; personId: string; from: string; name: string; createdAt: string };

/** New phones and names, for the owner. */
export type LogEntry = {
  id: string;
  /** new: a new person · phone: someone added a phone · owner-phone · recovered · blocked-try · owner (took over) */
  kind: string;
  personId: string | null;
  name: string;
  model: string | null;
  blocked: boolean;
  owner: boolean;
  at: string;
};

export type KeyState = {
  /** A hash to check a team key against (null until the owner's phone sets one). */
  check: string | null;
  /** The team key, wrapped for this phone. */
  wrapped?: string;
  /** Phones waiting for the key that this phone can pass it to. */
  wrapFor?: Array<{ deviceId: string; publicKey: string }>;
};

export type Me = {
  /** Who owns the app (to say who to ask). */
  ownerName: string | null;
  personId: string;
  name: string;
  owner: boolean;
  /** The owner lets you send things to the team. */
  canShare?: boolean;
  devices: number;
  /** Your own name change waiting on the owner. */
  request: { id: string; name: string; createdAt: string } | null;
  /** Everyone on the team (not blocked), to send things to. */
  crew?: TeamPerson[];
  /** Names on everyone's schedules. */
  roster?: string[];
  key?: KeyState;
  posts?: TeamPost[];
  /** The owner wants to hand the app to you. */
  handoverOffer?: { from: string; expiresAt: string } | null;
  /** Owner only: everyone (blocked too), oldest first; name changes; new phones; a handover in progress. */
  people?: PersonSummary[];
  requests?: AppNameRequest[];
  log?: LogEntry[];
  handover?: { personId: string; name: string; expiresAt: string } | null;
  recoveryKeyMadeAt?: string | null;
};

type Device = { deviceId: string; deviceToken: string };
type Profile = { id: string; writeToken: string } | null | undefined;

const DEVICE_KEY = "shiftdeck.device";

const random = (bytes: number) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...values)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** This phone's id and secret, made once. */
export function thisDevice(): Device {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null");
    if (saved?.deviceId && saved?.deviceToken) return saved as Device;
  } catch {
    // Made fresh below.
  }
  const device = { deviceId: random(16), deviceToken: random(32) };
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  } catch {
    // Without storage this phone gets a new identity next time.
  }
  return device;
}

/** The owner took this phone off the app: pick a name again. */
export class PhoneResetError extends Error {}

/** The owner blocked this person. */
export class BlockedError extends Error {}

/** A typed name is close to one the app knows: ask if that's them. */
export class SuggestNameError extends Error {
  suggest: string;
  constructor(suggest: string) {
    super(`Did you mean ${suggest}?`);
    this.suggest = suggest;
  }
}

/** A typed name isn't on any schedule or anyone's phone: check the spelling first. */
export class UnknownNameError extends Error {
  typed: string;
  constructor(typed: string) {
    super(`${typed} isn't on any schedule yet.`);
    this.typed = typed;
  }
}

/** What kind of phone this is ("iPhone · app", "Pixel 8 · Chrome"), so the owner can tell them apart. */
export async function deviceModel(): Promise<string> {
  if (typeof navigator === "undefined") return "";
  const agent = navigator.userAgent;
  let kind = /iPhone/.test(agent) ? "iPhone"
    : /iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1) ? "iPad"
    : /Android/.test(agent) ? "Android phone"
    : /Macintosh/.test(agent) ? "Mac"
    : /Windows/.test(agent) ? "Windows PC"
    : "Computer";
  if (kind === "Android phone") {
    // Chrome hides the model in the user agent but gives it when asked.
    const hints = (navigator as Navigator & { userAgentData?: { getHighEntropyValues: (keys: string[]) => Promise<{ model?: string }> } }).userAgentData;
    const model = await hints?.getHighEntropyValues(["model"]).then((value) => value.model ?? "").catch(() => "");
    const fromAgent = agent.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1] ?? "";
    const named = model || (fromAgent && fromAgent !== "K" ? fromAgent : "");
    if (named) kind = named;
  }
  const app = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const browser = /EdgA?\//.test(agent) ? "Edge" : /CriOS|Chrome\//.test(agent) ? "Chrome" : /FxiOS|Firefox\//.test(agent) ? "Firefox"
    : /SamsungBrowser/.test(agent) ? "Samsung Internet" : /Safari\//.test(agent) ? "Safari" : "";
  return `${kind}${app ? " · app" : browser ? ` · ${browser}` : ""}`.slice(0, 40);
}

export class NameTakenError extends Error {
  /** The name as it's registered. */
  takenName: string;
  /** It's the app owner's name. */
  ownerName: boolean;

  constructor(takenName: string, ownerName: boolean) {
    super(`${takenName} is already set up on another phone.`);
    this.takenName = takenName;
    this.ownerName = ownerName;
  }
}

async function call<T>(service: string, path: string, body: object): Promise<T> {
  // text/plain keeps these "simple" requests (no CORS preflight).
  const response = await fetch(`${service}/api/people/${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...thisDevice(), ...body }),
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string; taken?: boolean; name?: string; ownerName?: boolean };
  if (response.status === 410 && (result as { reset?: boolean }).reset) throw new PhoneResetError(result.error ?? "");
  if (response.status === 403 && (result as { blocked?: boolean }).blocked) throw new BlockedError(result.error ?? "");
  const extra = result as { suggest?: string; unknown?: boolean };
  if (response.status === 422 && extra.suggest) throw new SuggestNameError(extra.suggest);
  if (response.status === 404 && extra.unknown) throw new UnknownNameError(result.name ?? "");
  if (response.status === 409 && result.taken) throw new NameTakenError(result.name ?? "", Boolean(result.ownerName));
  if (!response.ok) throw Object.assign(new Error(result.error ?? "Couldn’t reach Shiftdeck. Check your connection."), { status: response.status });
  return result;
}

/** What every check-in also carries. */
export type CheckIn = {
  profile?: Profile;
  publicKey?: string;
  /** Names on this phone's schedules. */
  roster?: string[];
  /** Shows this phone has the team key. */
  keyProof?: string;
  /** The wrapped key sent to this phone didn't open. */
  badWrap?: boolean;
  /** A new phone's typed name (matched to a known one, allowing typos, unless `exact`). */
  first?: string;
  last?: string;
  exact?: boolean;
};

const extras = async ({ profile, ...rest }: CheckIn) => ({
  ...rest,
  model: await deviceModel(),
  ...(profile ? { profileId: profile.id, profileToken: profile.writeToken } : {}),
});

/** Checks in (registering the name the first time). Throws NameTakenError if it's someone else's. */
export const syncMe = async (service: string, name: string, checkIn: CheckIn) =>
  call<Me>(service, "sync", { name, ...await extras(checkIn) });

/** A 6-digit code (10 minutes, one use) to set up another phone as you. */
export const makeLinkCode = (service: string) => call<{ code: string; expiresAt: string }>(service, "link-code", {});

/** On the new phone: your name and the code from your other phone. */
export const linkThisPhone = async (service: string, name: string, code: string, checkIn: CheckIn) =>
  call<Me>(service, "link", { name, code, ...await extras(checkIn) });

/** On a new phone of the owner's, when all the others are gone: the 20-digit recovery key. */
export const recoverOwner = async (service: string, key: string, checkIn: CheckIn) =>
  call<Me>(service, "recover", { key, ...await extras(checkIn) });

/** Passes the team key on to phones waiting for it. */
export const sendWrappedKeys = (service: string, wraps: Array<{ deviceId: string; data: string }>) =>
  call<{ ok: boolean; saved: number }>(service, "keys", { wraps });

export const sendPost = (service: string, post: { shareId: string; what?: string; kind?: "swap"; to?: string[] }) =>
  call<{ id: string; notified: number }>(service, "post", post);

/** The person the owner picked: the key the owner gave you. */
export const acceptHandover = (service: string, key: string) => call<Me>(service, "accept-handover", { key });

export const askForName = (service: string, name: string) =>
  call<{ ok: boolean; pending?: boolean; name?: string }>(service, "name-request", { name });

export const withdrawNameRequest = (service: string, requestId: string) =>
  call<{ ok: boolean }>(service, "withdraw", { requestId });

/* ---------- the owner ---------- */

export const decideName = (service: string, requestId: string, approve: boolean) =>
  call<{ ok: boolean }>(service, "decide", { requestId, approve });

export const renamePerson = (service: string, personId: string, name: string) =>
  call<{ ok: boolean; name: string }>(service, "rename", { personId, name });

export const removePerson = (service: string, personId: string) =>
  call<{ ok: boolean }>(service, "remove", { personId });

export const blockPerson = (service: string, personId: string) => call<{ ok: boolean }>(service, "block", { personId });
/** Lets someone send things to the team, or stops them. */
export const setShareAccess = (service: string, personId: string, allow: boolean) =>
  call<{ ok: boolean }>(service, "share-access", { personId, allow });
export const unblockPerson = (service: string, personId: string) => call<{ ok: boolean }>(service, "unblock", { personId });

/** Starts a handover: the 16-digit key for the person you picked (good for a day). */
export const startHandover = (service: string, personId: string) =>
  call<{ key: string; expiresAt: string; name: string }>(service, "handover", { personId });
export const cancelHandover = (service: string) => call<{ ok: boolean }>(service, "handover-cancel", {});

/** A new 20-digit recovery key (the old one stops working). */
export const makeRecoveryKey = (service: string) => call<{ key: string }>(service, "recovery-key", {});

export const renamePhone = (service: string, targetDeviceId: string, label: string) =>
  call<{ ok: boolean }>(service, "device-rename", { targetDeviceId, label });

/** Puts one phone under another name (made if it's new). */
export const movePhone = (service: string, targetDeviceId: string, name: string) =>
  call<{ ok: boolean; name: string }>(service, "device-move", { targetDeviceId, name });

export const removePhone = (service: string, targetDeviceId: string) =>
  call<{ ok: boolean }>(service, "device-remove", { targetDeviceId });

/** Who's used the app longest (besides you), suggested for handing over. */
export const recommendedSuccessor = (people: PersonSummary[], myId: string) =>
  [...people].filter((person) => person.id !== myId && !person.blocked).sort((a, b) => a.since.localeCompare(b.since))[0] ?? null;
