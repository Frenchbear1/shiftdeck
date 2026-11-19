/** What's the same on all your phones: notifications dealt with, and alerts closed. */

/** Notifications you dismissed or read, and airport alerts you closed (newest last). */
export type SyncedState = { dismissed: string[]; seen: string[]; alerts: string[] };
const STATE_LIMITS: Record<keyof SyncedState, [number, number]> = {
  dismissed: [400, 80], // [how many kept, longest item]
  seen: [400, 80],
  alerts: [100, 600],
};

export function readState(value: string | null | undefined): SyncedState {
  let raw: Partial<Record<keyof SyncedState, unknown>> = {};
  try {
    raw = value ? JSON.parse(value) : {};
  } catch {
    raw = {};
  }
  const list = (key: keyof SyncedState) => Array.isArray(raw[key])
    ? (raw[key] as unknown[]).filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= STATE_LIMITS[key][1])
    : [];
  return { dismissed: list("dismissed"), seen: list("seen"), alerts: list("alerts") };
}

/** What the server has plus what this phone sent (everything either side has). */
export function mergeState(saved: SyncedState, sent: unknown): SyncedState {
  const incoming = readState(JSON.stringify(sent && typeof sent === "object" ? sent : {}));
  const merged = {} as SyncedState;
  for (const key of Object.keys(STATE_LIMITS) as Array<keyof SyncedState>) {
    merged[key] = [...new Set([...saved[key], ...incoming[key]])].slice(-STATE_LIMITS[key][0]);
  }
  return merged;
}

