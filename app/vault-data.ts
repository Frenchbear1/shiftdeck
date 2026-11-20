/**
 * What's yours on every device you use (time clock, pay checks, settings):
 * kept as many small cells, each stamped with when it last changed, so two
 * devices that changed different things both keep their change, and the
 * same thing changed on both keeps the later one. A deleted thing stays as an
 * empty cell (so it doesn't come back from a device that still has it).
 *
 * Pure: page.tsx stamps and merges, vault.ts encrypts and stores.
 */

export type Cell = { at: number; v: unknown };
/** section → key → cell. A null value is a deletion. */
export type Vault = Record<string, Record<string, Cell>>;
/** What a device has now, by section (a section left out isn't touched). */
export type Values = Record<string, Record<string, unknown>>;

/** Deletions are forgotten after this long (every device has heard by then). */
const FORGET_AFTER = 180 * 86_400_000;

/** JSON with keys in order, so the same thing always compares the same. */
export function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/**
 * Brings the stamps up to date with what this device has now. What changed
 * gets `now`; what's gone becomes a deletion. A value still at its default
 * (and never set here) is stamped 0, so it never outranks a real choice made
 * on another device. `first`: this device's very first stamp, whose values go
 * in as old (1), so a device joining late doesn't overwrite what the others
 * already agreed on, but still adds what only it has.
 */
export function stamp(previous: Vault, current: Values, now: number, defaults: Values = {}, first = false): Vault {
  const next: Vault = { ...previous };
  for (const [section, values] of Object.entries(current)) {
    const before = previous[section] ?? {};
    const cells: Record<string, Cell> = { ...before };
    for (const [key, value] of Object.entries(values)) {
      const cell = before[key];
      if (cell && same(cell.v, value)) continue;
      const isDefault = !cell && key in (defaults[section] ?? {}) && same(defaults[section][key], value);
      cells[key] = { at: isDefault ? 0 : first ? 1 : now, v: value };
    }
    for (const [key, cell] of Object.entries(before)) {
      if (key in values) continue;
      if (cell.v !== null) cells[key] = { at: first ? 1 : now, v: null };
      else if (now - cell.at > FORGET_AFTER) delete cells[key];
    }
    next[section] = cells;
  }
  return next;
}

/** Everything both sides have; where both have a key, the later change (ties settle the same way everywhere). */
export function merge(a: Vault, b: Vault): Vault {
  const next: Vault = {};
  for (const section of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[section] ?? {};
    const right = b[section] ?? {};
    const cells: Record<string, Cell> = {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const x = left[key];
      const y = right[key];
      cells[key] = !x ? y : !y ? x : x.at !== y.at ? (x.at > y.at ? x : y) : stable(x.v) >= stable(y.v) ? x : y;
    }
    next[section] = cells;
  }
  return next;
}

/** A section's current values (deletions left out). */
export function values<T = unknown>(vault: Vault, section: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, cell] of Object.entries(vault[section] ?? {})) {
    if (cell.v !== null && cell.v !== undefined) out[key] = cell.v as T;
  }
  return out;
}

/**
 * The same punch added on two devices (the same Paycom sheet read on both):
 * one is kept (the same one everywhere) and the others become deletions.
 */
export function dedupePunches(vault: Vault, section = "punch"): Vault {
  const cells = vault[section];
  if (!cells) return vault;
  const groups = new Map<string, string[]>();
  for (const [id, cell] of Object.entries(cells)) {
    const punch = cell.v as { in?: string; out?: string } | null;
    if (!punch?.in) continue;
    const key = `${punch.in.slice(0, 16)}|${punch.out?.slice(0, 16) ?? "open"}`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  let changed = false;
  const next = { ...cells };
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    const at = Math.max(...ids.map((id) => cells[id].at));
    for (const id of ids.slice(1)) {
      next[id] = { at, v: null };
      changed = true;
    }
  }
  return changed ? { ...vault, [section]: next } : vault;
}
