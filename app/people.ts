/**
 * This phone's identity in the app: a random id and secret made on the
 * phone (the server keeps only a hash of the secret), tied to the person
 * whose name it picked. The name is locked; the app's owner changes names,
 * and a person adds more phones with a one-time code from one they have.
 */

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
  devices: number;
  /** When they started using the app. */
  since: string;
  seen: string | null;
  phones?: PhoneSummary[];
};

export type AppNameRequest = { id: string; personId: string; from: string; name: string; createdAt: string };

export type Me = {
  /** Who owns the app (to say who to ask). */
  ownerName: string | null;
  personId: string;
  name: string;
  owner: boolean;
  devices: number;
  /** Your own name change waiting on the owner. */
  request: { id: string; name: string; createdAt: string } | null;
  /** Owner only: everyone, oldest first, and the name changes waiting. */
  people?: PersonSummary[];
  requests?: AppNameRequest[];
};

type Device = { deviceId: string; deviceToken: string };
type Profile = { id: string; writeToken: string } | null | undefined;
export type TeamCredentials = { teamId: string; memberId: string; memberToken: string };

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
  if (response.status === 409 && result.taken) throw new NameTakenError(result.name ?? "", Boolean(result.ownerName));
  if (!response.ok) throw Object.assign(new Error(result.error ?? "Couldn’t reach Shiftdeck. Check your connection."), { status: response.status });
  return result;
}

const extras = async (teams: TeamCredentials[], profile: Profile) => ({
  teams,
  model: await deviceModel(),
  ...(profile ? { profileId: profile.id, profileToken: profile.writeToken } : {}),
});

/** Checks in (registering the name the first time). Throws NameTakenError if it's someone else's. */
export const syncMe = async (service: string, name: string, teams: TeamCredentials[], profile: Profile) =>
  call<Me>(service, "sync", { name, ...await extras(teams, profile) });

/** A 6-digit code (10 minutes, one use) to set up another phone as you. */
export const makeLinkCode = (service: string) => call<{ code: string; expiresAt: string }>(service, "link-code", {});

/** On the new phone: your name and the code from your other phone. */
export const linkThisPhone = async (service: string, name: string, code: string, teams: TeamCredentials[], profile: Profile) =>
  call<Me>(service, "link", { name, code, ...await extras(teams, profile) });

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

export const handOver = (service: string, personId: string) =>
  call<{ ok: boolean }>(service, "transfer", { personId });

export const renamePhone = (service: string, targetDeviceId: string, label: string) =>
  call<{ ok: boolean }>(service, "device-rename", { targetDeviceId, label });

/** Puts one phone under another name (made if it's new). */
export const movePhone = (service: string, targetDeviceId: string, name: string) =>
  call<{ ok: boolean; name: string }>(service, "device-move", { targetDeviceId, name });

export const removePhone = (service: string, targetDeviceId: string) =>
  call<{ ok: boolean }>(service, "device-remove", { targetDeviceId });

/** Who's used the app longest (besides you), suggested for handing over. */
export const recommendedSuccessor = (people: PersonSummary[], myId: string) =>
  [...people].filter((person) => person.id !== myId).sort((a, b) => a.since.localeCompare(b.since))[0] ?? null;
