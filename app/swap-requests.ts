/**
 * Swap requests you've sent from Shift swap, kept on this device. Each has a
 * random id (the link) and a private token (only this phone can read the
 * answer). The server stores just first names and the two shifts.
 */

export type SwapShift = { date: string; start: string; end: string };

export type SentSwap = {
  id: string;
  token: string;
  worker: string;
  give: SwapShift;
  /** The shift of theirs you'd take (set once they pick, if you offered several). */
  take?: SwapShift;
  /** Several of their shifts offered; they choose one. */
  options?: SwapShift[];
  sentAt: string;
  status: "waiting" | "yes" | "no" | "cancelled";
  answeredAt?: string;
  /** False until you've seen the answer in Notifications. */
  seen: boolean;
};

export const SWAP_REQUESTS_KEY = "shiftdeck.swapRequests";

const randomId = (bytes = 15) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const newSwapKeys = () => ({ id: randomId(15), token: randomId(18) });

export const swapLink = (serviceUrl: string, id: string) => `${serviceUrl.replace(/\/$/, "")}/swap/${id}`;

export function loadSentSwaps(): SentSwap[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SWAP_REQUESTS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is SentSwap =>
      item && typeof item.id === "string" && typeof item.token === "string" && typeof item.worker === "string") : [];
  } catch {
    return [];
  }
}

export function saveSentSwaps(swaps: SentSwap[]) {
  try {
    localStorage.setItem(SWAP_REQUESTS_KEY, JSON.stringify(swaps));
  } catch {
    // Kept for this visit.
  }
}

/** Requests stop mattering two days after the later shift. */
export const isLiveSwap = (swap: SentSwap, today: string) =>
  [swap.give.date, swap.take?.date, ...(swap.options ?? []).map((option) => option.date)]
    .filter(Boolean).sort().at(-1)! >= today;

/**
 * Registers the request. Sent as plain text with keepalive so it needs no
 * preflight and still arrives after the phone switches to the mail app.
 */
export function registerSwap(serviceUrl: string, swap: SentSwap, from: string,
  profile?: { id: string; writeToken: string } | null) {
  return fetch(`${serviceUrl}/api/swaps`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      id: swap.id, token: swap.token, from, to: swap.worker, give: swap.give, take: swap.take,
      options: swap.options,
      ...(profile ? { profileId: profile.id, profileToken: profile.writeToken } : {}),
    }),
  }).catch(() => undefined);
}

/** Tells the server you changed your mind; their link then says so. */
export function cancelSwap(serviceUrl: string, swap: SentSwap) {
  return fetch(`${serviceUrl}/api/swaps/cancel`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ id: swap.id, token: swap.token }),
  }).catch(() => undefined);
}

type SwapStatus = { status: string; answeredAt?: string | null; take?: SwapShift };

/** Latest answers for these requests, by id. */
export async function fetchSwapStatuses(serviceUrl: string, swaps: SentSwap[]) {
  const asked = swaps.slice(-60);
  const byId = new Map<string, SwapStatus>();
  if (!asked.length) return byId;
  const response = await fetch(`${serviceUrl}/api/swaps/status`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ requests: asked.map(({ id, token }) => ({ id, token })) }),
  });
  if (!response.ok) return byId;
  const { statuses } = (await response.json()) as {
    statuses?: Array<SwapStatus & { id: string }>;
  };
  for (const item of statuses ?? []) byId.set(item.id, item);
  return byId;
}

/** Applies answers; a new or changed answer is marked unseen. */
export function mergeSwapStatuses(swaps: SentSwap[], byId: Map<string, SwapStatus>) {
  let changed = false;
  const next = swaps.map((swap) => {
    const latest = byId.get(swap.id);
    if (!latest || !["waiting", "yes", "no", "cancelled"].includes(latest.status)) return swap;
    // A cancel made on this phone stays, even before the server has it.
    if (swap.status === "cancelled") return swap;
    const take = latest.take ?? (swap.options?.length ? undefined : swap.take);
    if (latest.status === swap.status && take?.date === swap.take?.date) return swap;
    changed = true;
    return {
      ...swap,
      status: latest.status,
      take,
      answeredAt: latest.answeredAt ?? undefined,
      seen: latest.status === "waiting" || latest.status === "cancelled",
    } as SentSwap;
  });
  return changed ? next : swaps;
}

export type SwapView = {
  from: string;
  to: string;
  give: { date: string; start: string; end: string } | null;
  take: { date: string; start: string; end: string } | null;
  options: Array<{ date: string; start: string; end: string }>;
  status: "waiting" | "yes" | "no" | "cancelled";
};

/** A swap request a teammate sent inside the app. */
export async function viewSwap(service: string, id: string): Promise<SwapView> {
  const response = await fetch(`${service}/api/swaps/${id}`, { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as SwapView & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "This swap request couldn’t be opened.");
  return result;
}

/** Answers it: "yes", "yes:<option>" or "no". */
export async function answerSwap(service: string, id: string, answer: string) {
  const response = await fetch(`${service}/api/swaps/answer`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ id, answer }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Your answer couldn’t be sent. Try again.");
}
