/**
 * Matching a typed "first last" to a name the app already knows (people on
 * Shiftdeck and names on everyone's schedules), allowing a typo or two:
 * "Nicol Watsen" → "Nicole Watson", "david labare" → "David LaBarre",
 * "Nicole Watson" → "Nicole W. Watson" (middle names and initials are
 * ignored). Two names matching equally well count as no match.
 */

const letters = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

/** First and last name, ignoring anything in between ("Nicole W. Watson" → nicole, watson). */
export function nameParts(name: string) {
  const words = name.split(/[\s,]+/).map(letters).filter(Boolean);
  if (!words.length) return null;
  return { first: words[0], last: words.length > 1 ? words[words.length - 1] : "" };
}

/** Edits to turn one word into the other (a swap of two neighbouring letters counts as one). */
export function distance(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** How many typos a word of this length can have and still match. */
const allowed = (word: string) => (word.length <= 3 ? 0 : word.length <= 6 ? 1 : 2);

/** The known name the typed one most likely means, or null (no match, or two equally good). */
export function matchName(typed: string, known: string[]): string | null {
  const want = nameParts(typed);
  if (!want || !want.first || !want.last) return null;
  let best: { name: string; score: number } | null = null;
  let tie = false;
  const seen = new Set<string>();
  for (const name of known) {
    const has = nameParts(name);
    if (!has || !has.last || seen.has(letters(name))) continue;
    seen.add(letters(name));
    const whole = letters(typed) === letters(name) ? 0 : null;
    const first = distance(want.first, has.first);
    const last = distance(want.last, has.last);
    const ok = whole === 0 || (first <= allowed(has.first) && last <= allowed(has.last));
    if (!ok) continue;
    const score = whole ?? first + last;
    if (!best || score < best.score) {
      best = { name, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.name : null;
}

/** "nicole" / "WATSON" → "Nicole" / "Watson"; mixed case ("LaBarre") is kept. */
export function tidyName(first: string, last: string) {
  const fix = (part: string) => {
    const trimmed = part.replace(/\s+/g, " ").trim();
    return trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase()
      ? trimmed.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, start: string, char: string) => start + char.toUpperCase())
      : trimmed;
  };
  return `${fix(first)} ${fix(last)}`.trim();
}
