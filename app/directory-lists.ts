/**
 * Reads printed phone lists: "Ticket Counter ............ 4021" under
 * headings like "ALLEGIANT AIR", in one or two columns, plus grids like
 * "Airline | role | phone | ext | notes" and "Company | contact | phone".
 * Works on photos: tilted or keystoned pages, dot leaders OCR reads as
 * junk, numbers split into pieces.
 */

import type { DirectoryEntry, NumberBoxes, PlacedText } from "./directory-data.ts";

type Box = { x: number; y: number; width: number; height: number };
/** A word with its tilt-corrected center line. */
type Word = PlacedText & { cy: number; kind: "text" | "number" | "leader" | "rule" };
/** Words that sit together on one line. */
type Phrase = {
  words: Word[]; text: string; x: number; right: number; cy: number; height: number; kind: "text" | "number";
  /** A number written right after text with no dots or gap ("Gate 18"). */
  attached?: boolean;
};

export type ListEntry = DirectoryEntry & { boxes: NumberBoxes };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** OCR swaps inside numbers (O→0, l→1, S→5, B→8). */
const asDigits = (text: string) =>
  text.replace(/[Oo]/g, "0").replace(/[lI|!]/g, "1").replace(/S/g, "5").replace(/B/g, "8");

const digitsOf = (text: string) => asDigits(text).replace(/\D/g, "");

/** Dates and times ("8/29/2012", "9:00") aren't phone numbers. */
const DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}:\d{2}$/;

export function classify(text: string): Word["kind"] {
  const bare = text.trim();
  // Table borders.
  if (/^[|[\]{}]+$/.test(bare)) return "rule";
  // Dot leaders: dots, or the "iiininiin"-style junk OCR makes of them.
  if (/^[.,:;·…'`_~•*]$|^[.,:;·…'`_~\-–—=•*]{2,}$/.test(bare)) return "leader";
  const letters = bare.replace(/[^A-Za-z]/g, "");
  if (bare.length >= 7 && letters.length >= 5) {
    const thin = bare.replace(/[^iIlnruce.,:;'`|1]/g, "").length;
    const eyes = bare.replace(/[^iIl1|.]/g, "").length;
    if (thin / bare.length >= 0.75 && eyes / bare.length >= 0.3 && new Set(letters.toLowerCase()).size <= 6) return "leader";
  }
  const candidate = asDigits(bare.replace(/^[.…,:;]+|[.…,:;]+$/g, ""));
  if (DATE.test(candidate)) return "text";
  const numberLike = candidate.replace(/[\d()\-–—/.\s]/g, "") === "" && /\d/.test(candidate);
  if (numberLike && candidate.replace(/\D/g, "").length >= 2) return "number";
  return "text";
}

/** "Kitchen......": a real word with the leader stuck on (OCR is unsure of those, but they're real). */
const dotted = (word: PlacedText) => /^[A-Za-z(][A-Za-z'’)/&-]{2,}[.…·]{2,}/.test(word.text) && /[aeiouy]/i.test(word.text);

/** Trailing leader dots and stray marks off a label word. */
const tidyWord = (text: string) =>
  text.replace(/[.…·,:;_~]{2,}.*$/, "").replace(/^[.…·,:;_~]{2,}/, "").trim();

/**
 * The page's tilt, as a slope that can change down the page (a keystoned
 * photo): fitted from neighboring words on the same line.
 */
export function tiltOf(words: PlacedText[]) {
  const height = median(words.map((word) => word.height)) || 10;
  const samples: Array<{ y: number; slope: number }> = [];
  const sorted = [...words].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    if (Math.abs(a.height - height) > height * 0.6) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      const dx = b.x + b.width / 2 - (a.x + a.width / 2);
      if (dx > height * 12) break;
      if (dx < height * 1.5 || Math.abs(b.height - height) > height * 0.6) continue;
      const dy = b.y + b.height / 2 - (a.y + a.height / 2);
      // Up to ~6° of tilt.
      if (Math.abs(dy) > Math.max(height * 0.45, dx * 0.1)) continue;
      samples.push({ y: (a.y + b.y) / 2, slope: dy / dx });
    }
  }
  if (samples.length < 6) return () => 0;
  // A slope that changes linearly down the page; median-ish by trimming outliers.
  const center = median(samples.map((sample) => sample.slope));
  const kept = samples.filter((sample) => Math.abs(sample.slope - center) < 0.025);
  if (kept.length < 6) return () => center;
  const meanY = kept.reduce((sum, sample) => sum + sample.y, 0) / kept.length;
  const meanS = kept.reduce((sum, sample) => sum + sample.slope, 0) / kept.length;
  let top = 0;
  let bottom = 0;
  for (const sample of kept) {
    top += (sample.y - meanY) * (sample.slope - meanS);
    bottom += (sample.y - meanY) ** 2;
  }
  const change = bottom ? top / bottom : 0;
  return (y: number) => meanS + change * (y - meanY);
}

/** Words on one line, joined into phrases where they sit close together. */
export function phrasesOf(words: Word[], height: number): Phrase[] {
  const rows: Word[][] = [];
  for (const word of [...words].sort((a, b) => a.cy - b.cy)) {
    const row = rows.find((candidate) => Math.abs(median(candidate.map((item) => item.cy)) - word.cy) <= height * 0.55);
    if (row) row.push(word);
    else rows.push([word]);
  }
  const make = (all: Word[], kind: Phrase["kind"], attached = false): Phrase => {
    // Leader junk stuck to a label's end ("Valet Customer Service EET RET"): words OCR wasn't sure of.
    const sure = (word: Word) => word.kind === "number" || !Number.isFinite(word.conf) || word.conf! >= 50 || dotted(word);
    let from = 0;
    let to = all.length;
    if (kind === "text" && all.some(sure)) {
      while (from < to && !sure(all[from])) from += 1;
      while (to > from && !sure(all[to - 1])) to -= 1;
    }
    const kept = all.slice(from, to);
    return {
    words: kept,
    text: kept.map((word) => (word.kind === "number" ? word.text.replace(/^[.…,:;]+|[.…,:;]+$/g, "") : tidyWord(word.text)))
      .filter(Boolean).join(" "),
    x: kept[0].x,
    right: kept.at(-1)!.x + kept.at(-1)!.width,
    cy: median(kept.map((word) => word.cy)),
    height: median(kept.map((word) => word.height)),
    kind,
    attached,
    };
  };
  const phrases: Phrase[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const lineStart = phrases.length;
    let current: Word[] = [];
    const flush = () => {
      const kept = current.filter((word) => word.kind !== "leader" && word.kind !== "rule");
      current = [];
      if (!kept.length) return;
      // Numbers at the end of a phrase split off ("Delta 1-800…" with no dots between);
      // numbers inside it stay in the text ("Gate 18 Ramp", "(15 minutes)").
      let split = kept.length;
      while (split > 0 && kept[split - 1].kind === "number") split -= 1;
      if (split === 0) phrases.push(make(kept, "number"));
      else if (split === kept.length) phrases.push(make(kept, "text"));
      else {
        phrases.push(make(kept.slice(0, split), "text"));
        phrases.push(make(kept.slice(split), "number", true));
      }
    };
    for (const word of row) {
      const last = current.at(-1);
      const gap = last ? word.x - (last.x + last.width) : 0;
      // A leader or a big gap ends a phrase.
      const breaks = (item: Word) => item.kind === "leader" || item.kind === "rule";
      if (last && (breaks(word) || breaks(last) || gap > height * 1.1)) flush();
      current.push(word);
      // Dots stuck on a word's end ("Office.....") end it too.
      if (word.kind !== "leader" && /[.…·]{2,}$/.test(word.text)) flush();
    }
    flush();
    // "Crisis Room 12 ........ 4021": a short number stuck to the label, with the real number
    // further along the line, is part of the label.
    const line = phrases.slice(lineStart);
    for (let index = 0; index < line.length; index += 1) {
      const phrase = line[index];
      const before = line[index - 1];
      if (!phrase.attached || !before || before.kind !== "text") continue;
      if (digitsOf(phrase.text).length > 3) continue;
      if (!line.slice(index + 1).some((other) => other.kind === "number")) continue;
      const merged = make([...before.words, ...phrase.words], "text");
      const at = phrases.indexOf(before);
      phrases.splice(at, 2, merged);
      line.splice(index - 1, 2, merged);
      index -= 1;
    }
  }
  return phrases.filter((phrase) => phrase.text);
}

const isHeading = (text: string) => {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.8;
};

/** Page furniture: "Directory 12", "Last printed 8/29/2012 9:41 AM", "- 2 -". */
const isFurniture = (text: string) =>
  /^(?:directory|page)\b\s*[\d#]*$/i.test(text) || /last printed|revised|^as of\b|do not give/i.test(text) ||
  /^[-–\s\d#]+$/.test(text);

type Read = { phone?: string; ext?: string; cell?: string; note?: string };

/** What a run of numbers says: a phone, an extension, a cell, or hours. */
function readNumbers(texts: string[], cellish: boolean): Read {
  const read: Read = {};
  const joined = texts.join(" ").trim();
  const parts = asDigits(joined).split(/\s*(?:\/|,|\bor\b)\s*/).map((part) => part.trim()).filter(Boolean);
  const exts: string[] = [];
  for (const part of parts) {
    const number = part.replace(/\D/g, "");
    // "0500-2300": shuttle or office hours.
    if (/^\d{4}\s*[-–]\s*\d{4}$/.test(part)) {
      read.note = [read.note, part.replace(/\s*[-–]\s*/, "–")].filter(Boolean).join(", ");
      continue;
    }
    const local = number.length === 11 && number.startsWith("1") ? number.slice(1) : number;
    let phone = "";
    if (local.length === 10) phone = `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
    else if (local.length === 7) phone = `${local.slice(0, 3)}-${local.slice(3)}`;
    if (phone) {
      if (cellish && !read.cell) read.cell = phone;
      else if (!read.phone) read.phone = phone;
      else if (!read.cell) read.cell = phone;
      continue;
    }
    if (number.length >= 2 && number.length <= 6) exts.push(number);
    // "4021/4022" read without its slash (or the slash as a 1).
    else if (number.length === 8) exts.push(number.slice(0, 4), number.slice(4));
    else if (number.length === 9 && /^\d{4}[1l|/]\d{4}$/.test(part.replace(/\s/g, ""))) exts.push(number.slice(0, 4), number.slice(5));
  }
  if (exts.length) read.ext = exts.join(" / ");
  return read;
}

/** Numbers OCR split apart ("610" "266-6000", "4021" "/4022") go back together. */
function joinNumbers(phrases: Phrase[], height: number) {
  const numbers = phrases.filter((phrase) => phrase.kind === "number").sort((a, b) => a.x - b.x);
  const runs: Phrase[][] = [];
  for (const phrase of numbers) {
    const run = runs.find((candidate) => {
      const last = candidate.at(-1)!;
      return Math.abs(last.cy - phrase.cy) <= height * 0.6 && phrase.x - last.right <= height * 1.6 && phrase.x >= last.x;
    });
    if (run) run.push(phrase);
    else runs.push([phrase]);
  }
  return runs;
}

const boxOf = (words: PlacedText[], group: number): NonNullable<NumberBoxes["phone"]> => {
  const x = Math.min(...words.map((word) => word.x));
  const y = Math.min(...words.map((word) => word.y));
  return {
    x, y, group,
    width: Math.max(...words.map((word) => word.x + word.width)) - x,
    height: Math.max(...words.map((word) => word.y + word.height)) - y,
  };
};

/**
 * One page of a printed list. Returns nothing much if the page isn't one
 * (the caller then tries it as a table).
 */
export function parseListPage(items: PlacedText[], group = 0, recase: (text: string) => string = (text) => text): ListEntry[] {
  const height = median(items.map((item) => item.height)) || 10;
  const slope = tiltOf(items);
  const words: Word[] = items.flatMap((item) => {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2 - slope(item.y + item.height / 2) * cx;
    // A border stuck to a word ("Americar]", "|reservations") is still a border.
    const match = item.text.match(/^([|[\]]?)(.*?)([|[\]]?)$/)!;
    if ((match[1] || match[3]) && match[2] && !/^\(.*\)$/.test(item.text)) {
      const share = item.width / Math.max(1, item.text.length);
      const out: Word[] = [];
      if (match[1]) out.push({ ...item, text: "|", width: share, cy, kind: "rule" });
      out.push({ ...item, text: match[2], x: item.x + (match[1] ? share : 0), width: item.width - share * ((match[1] ? 1 : 0) + (match[3] ? 1 : 0)), cy, kind: classify(match[2]) });
      if (match[3]) out.push({ ...item, text: "|", x: item.x + item.width - share, width: share, cy, kind: "rule" });
      return out;
    }
    // Squat "words" (a few px tall) are leader dots read as letters ("wen", "wine.").
    const kind = classify(item.text);
    return [{ ...item, cy, kind: kind !== "number" && item.height < height * 0.45 ? "leader" : kind }];
  });
  const phrases = phrasesOf(words, height);
  const pageLeft = Math.min(...phrases.map((phrase) => phrase.x));
  const pageRight = Math.max(...phrases.map((phrase) => phrase.right));
  const width = Math.max(1, pageRight - pageLeft);
  // Text OCR wasn't sure of at all is the dot leaders read as letters ("srrensans sanen").
  const confident = (phrase: Phrase) => {
    const known = phrase.words.map((word) => word.conf).filter((conf): conf is number => Number.isFinite(conf));
    return !known.length || Math.max(...known) >= 30 || phrase.words.some(dotted);
  };
  const allTexts = phrases.filter((phrase) => phrase.kind === "text" && !isFurniture(phrase.text));
  const texts = allTexts.filter(confident);
  const runs = joinNumbers(phrases, height);

  type Draft = {
    labelParts: Phrase[]; run: Phrase[]; read: Read; x: number; cy: number;
    org?: Phrase; notes: string[];
  };
  const drafts: Draft[] = [];
  /** Where a company/airline column sits, once one is found. */
  let orgColumn: number | null = null;
  const used = new Set<Phrase>();
  const sameLine = (a: { cy: number }, b: { cy: number }) => Math.abs(a.cy - b.cy) <= height * 0.7;

  // A company/airline column: text a column left of the label, lined up the same way on 3+ rows
  // (no dots between: "Air Products & Chemicals   Dana Miller   610…"), not a one-off gap in a label.
  const endsDotted = (phrase: Phrase) => /[.…·]{2,}$/.test(phrase.words.at(-1)!.text);
  const pairs: Array<{ org: number; label: number }> = [];
  for (const run of runs) {
    const start = run[0];
    const near = texts.filter((phrase) => sameLine(phrase, start) && phrase.right <= start.x + height)
      .sort((a, b) => b.right - a.right);
    const [label, org] = near;
    if (!label || !org || endsDotted(org)) continue;
    const gap = label.x - org.right;
    const marks = (kind: Word["kind"]) => words.some((word) => word.kind === kind && sameLine(word, start) &&
      word.x > org.right - height * 0.5 && word.x < label.x + height * 0.5);
    if (!marks("leader") && ((gap > height * 2.5 && gap < height * 18) || (marks("rule") && gap < height * 18))) {
      pairs.push({ org: org.x, label: label.x });
    }
  }
  for (const pair of pairs) {
    const agree = pairs.filter((other) => Math.abs(other.org - pair.org) <= height * 3 && Math.abs(other.label - pair.label) <= height * 3);
    if (agree.length >= 3) {
      orgColumn = median(agree.map((other) => other.org));
      break;
    }
  }

  // Hours ("0500–2300") go last, once the entries they sit beside exist.
  const isHours = (run: Phrase[]) => /^\d{4}\s*[-–]\s*\d{4}$/.test(asDigits(run.map((phrase) => phrase.text).join(" ")).trim());
  for (const run of runs.sort((a, b) => Number(isHours(a)) - Number(isHours(b)) || a[0].cy - b[0].cy || a[0].x - b[0].x)) {
    const start = run[0];
    const text = run.map((phrase) => phrase.text).join(" ");
    const digitCount = digitsOf(text).length;
    // Directory numbers have 3+ digits; "(option 2)" or "Gate 4" don't count.
    if (digitCount < 3) continue;
    // Hours further along an entry's line ("0500–2300" shuttle hours) are a note on it.
    if (/^\d{4}\s*[-–]\s*\d{4}$/.test(asDigits(text).trim())) {
      const host = drafts.filter((draft) => sameLine(draft, start) && draft.x < start.x).sort((a, b) => b.x - a.x)[0];
      if (host) {
        host.read.note = [host.read.note, asDigits(text).trim().replace(/\s*[-–]\s*/, "–")].filter(Boolean).join(", ");
        continue;
      }
    }
    // Its label: text on the same line, to the left, with no other number between.
    const between = (phrase: Phrase) =>
      runs.some((other) => other !== run && sameLine(other[0], start) && other[0].x > phrase.right && other[0].x < start.x);
    let left = allTexts
      .filter((phrase) => !used.has(phrase) && sameLine(phrase, start) && phrase.right <= start.x + height && !between(phrase))
      .sort((a, b) => b.right - a.right);
    // Text OCR was unsure of is leader junk when a real label sits further left ("Office …… srrensans …… 4021"),
    // but a real short label when it's first on its line ("J&J Limo", "Tower").
    left = left.filter((phrase, index) => confident(phrase) ||
      !left.slice(index + 1).some(confident));
    if (!left.length) {
      // A number on its own line under an entry ("Cell: 610…" wrapped, a second line): it belongs to that entry.
      // (Only straight under that entry's number, with nothing at all to the left: a number whose
      // label OCR lost must not land on the wrong name.)
      const anythingLeft = phrases.some((phrase) => phrase !== start && !run.includes(phrase) && sameLine(phrase, start) && phrase.right < start.x);
      const above = anythingLeft ? undefined : drafts.filter((draft) => draft.cy < start.cy && start.cy - draft.cy <= height * 1.8 &&
        Math.abs((draft.run[0]?.x ?? 0) - start.x) <= height * 2 && !draft.read.cell).at(-1);
      if (above) {
        const extra = readNumbers([text], true);
        above.read.cell ??= extra.phone ?? extra.cell;
        if (!extra.phone && !extra.cell && extra.ext) above.read.ext = [above.read.ext, extra.ext].filter(Boolean).join(" / ");
        above.run.push(...run);
      }
      continue;
    }
    // Pieces of one label split by leaders ("Wiley Courtesy 1 …… @ Gate 4 ……"); a plain
    // gap instead is the next column over (a company next to its contact person).
    const marksBetween = (kind: Word["kind"], from: number, to: number) => words.some((word) => word.kind === kind &&
      sameLine(word, start) && word.x >= from - height * 0.5 && word.x + word.width <= to + height * 0.5);
    const parts = [left[0]];
    for (const phrase of left.slice(1)) {
      if (!confident(phrase)) break;
      const gap = parts[0].x - phrase.right;
      if (gap > height * 7 || marksBetween("rule", phrase.right, parts[0].x) ||
        (gap > height * 2.5 && !marksBetween("leader", phrase.right, parts[0].x) && !endsDotted(phrase) &&
          // "(New orange and white … radar site)": an open parenthesis continues.
          !(phrase.text.split("(").length > phrase.text.split(")").length))) break;
      // A known company/airline column is never part of the label.
      if (orgColumn !== null && Math.abs(phrase.x - orgColumn) <= height * 2 && parts[0].x - orgColumn > height * 3) break;
      parts.unshift(phrase);
    }
    // A "(cell)" or "Cell:" right before it makes it a cell number.
    const labelText = parts.map((phrase) => phrase.text).join(" ");
    const cellish = /\bcell\b|\bmobile\b/i.test(parts.at(-1)!.text.split(/[-–]/).at(-1) ?? "");
    // Text further left on the line, far from the label: a company or airline column.
    // (Close to the label like a table column, not a whole page column away, and no dots between.)
    const org = texts.filter((phrase) => {
      if (used.has(phrase) || parts.includes(phrase) || !sameLine(phrase, start) || between(phrase) || isFurniture(phrase.text)) return false;
      if (phrase.right > parts[0].x) return false;
      if (marksBetween("leader", phrase.right, parts[0].x)) return false;
      // Across a table border, or in the company column.
      return marksBetween("rule", phrase.right, parts[0].x) ||
        (orgColumn !== null && Math.abs(phrase.x - orgColumn) <= height * 3 && parts[0].x - phrase.x > height * 3);
    }).sort((a, b) => b.right - a.right)[0];
    // A labeled cell number goes with the entry already on this line ("…manager (cell) 610…").
    const onlyCell = /^\W*(?:cell|mobile)\W*$/i.test(labelText);
    const host = cellish
      ? drafts.find((draft) => sameLine(draft, start) && draft.x < parts[0].x) ??
        (onlyCell ? drafts.filter((draft) => draft.cy < start.cy && start.cy - draft.cy <= height * 2.4 &&
          Math.abs(draft.x - parts[0].x) <= height * 6 && !draft.read.cell).at(-1) : undefined)
      : undefined;
    const read = readNumbers([text], cellish);
    if (host && (read.cell || read.phone)) {
      host.read.cell ??= read.cell ?? read.phone;
      const said = labelText.replace(/[-–(]*\s*\bcell\b\s*\)?:?\s*$/i, "").trim();
      if (said) host.notes.push(said);
      host.run.push(...run);
      parts.forEach((phrase) => used.add(phrase));
      continue;
    }
    parts.forEach((phrase) => used.add(phrase));
    if (org) used.add(org);
    drafts.push({ labelParts: parts, run, read, x: parts[0].x, cy: start.cy, org, notes: [] });
  }

  // Text right of an entry's numbers on the same line: its notes ("only urgent calls").
  for (const phrase of texts) {
    if (used.has(phrase)) continue;
    const host = drafts.find((draft) => sameLine(draft, phrase) && draft.run.length &&
      phrase.x > Math.max(...draft.run.map((item) => item.right)) - height &&
      !drafts.some((other) => other !== draft && sameLine(other, phrase) && other.x > draft.x && other.x <= phrase.x));
    // ("X" in a yes/no column says nothing.)
    if (host && !isHeading(phrase.text) && phrase.text.replace(/[^A-Za-z0-9]/g, "").length >= 2) {
      host.notes.push(phrase.text);
      used.add(phrase);
    }
  }

  // Headings: leftover all-caps text (or text ending in ":"), each heading its column below it.
  const headings = texts.filter((phrase) => !used.has(phrase) && (isHeading(phrase.text) || /:$/.test(phrase.text)) &&
    phrase.text.replace(/[^A-Za-z]/g, "").length >= 3);
  const headingFor = (draft: Draft) => headings
    .filter((heading) => heading.cy < draft.cy - height * 0.3 && (
      (heading.x <= draft.x + height * 2 && heading.x >= draft.x - width * 0.3) ||
      // A wide title over the whole list ("HOTEL'S AND THEIR CONTACT/SHUTTLE SERVICE INFORMATION").
      (heading.right - heading.x >= width * 0.4 && heading.x < draft.x + width * 0.45 && heading.right > draft.x)))
    .sort((a, b) => b.cy - a.cy)[0];

  const entries: ListEntry[] = [];
  let lastOrg: { name: string; x: number; cy: number; labelX: number } | null = null;
  const ordered = drafts.sort((a, b) => (a.x < pageLeft + width * 0.45 ? 0 : 1) - (b.x < pageLeft + width * 0.45 ? 0 : 1) || a.cy - b.cy);
  let previous: (ListEntry & { x: number; cy: number; base: string }) | null = null;
  for (const draft of ordered) {
    let label = draft.labelParts.map((phrase) => phrase.text).join(" ")
      .replace(/\s*[.…·]+\s*$/, "").replace(/\s[.…·]+(?=\S)/g, " ").replace(/\s{2,}/g, " ")
      .replace(/^[^A-Za-z0-9(#&]+/, "").trim();
    const heading = headingFor(draft);
    let department = heading ? recase(heading.text.replace(/:$/, "").trim()) : "";
    // A company/airline column on the left names the rows until the next one.
    if (draft.org) lastOrg = { name: draft.org.text, x: draft.org.x, cy: draft.cy, labelX: draft.x };
    else if (lastOrg && (Math.abs(lastOrg.labelX - draft.x) > height * 3 || draft.cy - lastOrg.cy > height * 6 ||
      (heading && heading.cy > lastOrg.cy))) lastOrg = null;
    if (lastOrg) {
      department = recase(lastOrg.name);
      lastOrg.cy = draft.cy;
    }
    // A short indented line ("Baggage", "FAX#") belongs to the entry above it.
    const generic = /^\W*(?:baggage|bag room|fax|fax#|fax ?no\.?|cell|ops|operations|office|reservations|manager|counter|ticket counter|after hours|hangar)\W*$/i
      .test(label.replace(/#/g, ""));
    if (previous && generic && !lastOrg && draft.x > previous.x + height * 0.8 &&
      draft.cy - previous.cy <= height * 4 && (previous.department ?? "") === department) {
      label = `${previous.base} – ${label.replace(/#$/, "").trim()}`;
    }
    label = label.replace(/\s*#\s*$/, "").trim();
    if (!label) continue;
    const { phone, ext, cell, note } = draft.read;
    if (!phone && !ext && !cell) continue;
    const notes = [...draft.notes, note].filter(Boolean).join(" · ");
    const boxes: NumberBoxes = {};
    const runWords = draft.run.flatMap((phrase) => phrase.words);
    if (phone) boxes.phone = boxOf(runWords, group);
    else if (ext) boxes.ext = boxOf(runWords, group);
    else if (cell) boxes.cell = boxOf(runWords, group);
    const entry: ListEntry = {
      id: "",
      line: recase(label),
      ...(department ? { department } : {}),
      ...(notes ? { title: notes } : {}),
      ...(phone ? { phone } : {}),
      ...(ext ? { ext } : {}),
      ...(cell ? { cell } : {}),
      boxes,
    };
    entries.push(entry);
    if (!label.includes(" – ")) previous = { ...entry, x: draft.x, cy: draft.cy, base: recase(label) };
  }
  return entries;
}

export type { Box };
