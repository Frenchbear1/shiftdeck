/** Pure helpers for swap requests (no imports, so tests can load them). */

export type SwapShift = { date: string; start: string; end: string };

export type SwapRequestInput = {
  id: string;
  token: string;
  from: string;
  to: string;
  give: SwapShift;
  take?: SwapShift;
  /** Several of their shifts; they pick which one you'd take. */
  options?: SwapShift[];
};

export type SwapRow = {
  id: string;
  from_name: string;
  to_name: string;
  give_date: string;
  give_start: string;
  give_end: string;
  take_date: string | null;
  take_start: string | null;
  take_end: string | null;
  status: "waiting" | "yes" | "no" | "cancelled";
  answered_at: string | null;
  options_json?: string | null;
};

const MAX_OPTIONS = 12;

export const rowOptions = (row: Pick<SwapRow, "options_json">): SwapShift[] => {
  try {
    const parsed: unknown = JSON.parse(row.options_json ?? "[]");
    return Array.isArray(parsed) ? parsed.map(shift).filter((item): item is SwapShift => Boolean(item)) : [];
  } catch {
    return [];
  }
};

const ID = /^[A-Za-z0-9_-]{16,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const firstName = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f<>]/g, " ").trim().split(/\s+/)[0]?.slice(0, 40) ?? ""
    : "";

const shift = (value: unknown): SwapShift | null => {
  const raw = value as Partial<SwapShift> | undefined;
  return raw && typeof raw.date === "string" && DATE.test(raw.date) &&
    typeof raw.start === "string" && TIME.test(raw.start) &&
    typeof raw.end === "string" && TIME.test(raw.end)
    ? { date: raw.date, start: raw.start, end: raw.end }
    : null;
};

/** Checks a new request from the app; only first names are kept. */
export function readSwapRequest(body: unknown): SwapRequestInput | null {
  const raw = body as Record<string, unknown> | null;
  if (!raw || typeof raw.id !== "string" || !ID.test(raw.id) ||
    typeof raw.token !== "string" || !ID.test(raw.token)) return null;
  const give = shift(raw.give);
  let take = raw.take === undefined || raw.take === null ? undefined : shift(raw.take);
  const options = Array.isArray(raw.options)
    ? raw.options.slice(0, MAX_OPTIONS).map(shift).filter((item): item is SwapShift => Boolean(item))
    : [];
  const from = firstName(raw.from);
  const to = firstName(raw.to);
  if (!give || take === null || !to) return null;
  if (!take && options.length === 1) take = options[0];
  return {
    id: raw.id, token: raw.token, from: from || "Your coworker", to, give, take,
    ...(!take && options.length > 1 ? { options } : {}),
  };
}

const day = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));

const time = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours < 12 ? "AM" : "PM"}`;
};

export const shiftLabel = (date: string, start: string, end: string) =>
  `${day(date)} · ${time(start)}–${time(end)}`;

/** Requests stop working two days after the later of the two shifts. */
export function swapExpiry(input: Pick<SwapRequestInput, "give" | "take" | "options">) {
  const last = [input.give.date, input.take?.date, ...(input.options ?? []).map((option) => option.date)]
    .filter(Boolean).sort().at(-1)!;
  return new Date(Date.parse(`${last}T12:00:00Z`) + 2 * 86_400_000).toISOString();
}

export function answerNotification(row: SwapRow) {
  const yes = row.status === "yes";
  return {
    title: yes ? `${row.to_name} said yes to your swap` : `${row.to_name} can’t swap`,
    body: `Your ${shiftLabel(row.give_date, row.give_start, row.give_end)}` +
      (row.take_date && row.take_start && row.take_end
        ? ` for their ${shiftLabel(row.take_date, row.take_start, row.take_end)}`
        : ""),
    tag: `shiftdeck-swap-${row.id}`,
  };
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** The page a coworker sees from the link: the swap and the choices. */
export function answerPage(row: SwapRow | null, justAnswered = false) {
  const from = row ? escape(row.from_name) : "";
  const options = row ? rowOptions(row) : [];
  const chosen = row?.take_date && row.take_start && row.take_end
    ? shiftLabel(row.take_date, row.take_start, row.take_end)
    : null;
  let body: string;
  if (!row) {
    body = `<h1>This swap request isn’t available</h1><p>It may have expired, or the link isn’t complete.</p>`;
  } else if (row.status === "cancelled") {
    body = `<p class="eyebrow">Shift swap</p>
      <h1>${from} changed their mind</h1>
      <p>This swap request was cancelled, so there’s nothing to answer. Thanks anyway!</p>`;
  } else {
    const giveLabel = escape(shiftLabel(row.give_date, row.give_start, row.give_end));
    const choosing = options.length > 1;
    const pick = choosing
      ? `<p class="label">Pick the shift of yours ${from} would take:</p>
         <form method="post" class="options">
           ${options.map((option, index) => {
             const label = shiftLabel(option.date, option.start, option.end);
             const isChosen = row.status === "yes" && label === chosen;
             return `<button name="answer" value="yes:${index}" class="option${isChosen ? " chosen" : ""}"${isChosen ? " disabled" : ""}>${escape(label)}</button>`;
           }).join("")}
           <button name="answer" value="no" class="no"${row.status === "no" ? " disabled" : ""}>Can’t do any</button>
         </form>`
      : `<form method="post">
           <button name="answer" value="yes" class="yes"${row.status === "yes" ? " disabled" : ""}>Works for me</button>
           <button name="answer" value="no" class="no"${row.status === "no" ? " disabled" : ""}>Can’t</button>
         </form>`;
    const answered = row.status === "waiting" ? "" : `<p class="answer ${row.status}">${justAnswered ? "Thanks! " : ""}${
      row.status === "yes"
        ? `You said yes${choosing && chosen ? ` — ${from} takes your ${escape(chosen)}` : ""}.`
        : "You said you can’t."
    } ${from} ${justAnswered ? "has been" : "was"} notified.</p>`;
    body = `
      <p class="eyebrow">Shift swap</p>
      <h1>${from} would like to swap shifts with you</h1>
      <dl>
        <div><dt>You’d take ${from}’s</dt><dd>${giveLabel}</dd></div>
        ${!choosing && chosen ? `<div><dt>${from} would take your</dt><dd>${escape(chosen)}</dd></div>` : ""}
      </dl>
      ${answered}
      ${pick}
      ${row.status === "waiting" ? "" : `<p class="small">Changed your mind? Tap a different answer.</p>`}`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Shift swap</title>
<style>
  :root { color-scheme: light dark; --blue: #3767dc; }
  body { margin: 0; font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f4f5f7; color: #16191f; }
  main { max-width: 460px; margin: 0 auto; padding: 32px 20px; }
  .card { padding: 22px; background: #fff; border: 1px solid #e3e6eb; border-radius: 20px; }
  .eyebrow { margin: 0 0 4px; color: var(--blue); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  h1 { margin: 0 0 16px; font-size: 22px; line-height: 1.25; }
  dl { display: grid; gap: 10px; margin: 0 0 18px; }
  dl div { padding: 12px 14px; background: #f8f9fb; border-radius: 12px; }
  dt { color: #6f7682; font-size: 13px; font-weight: 600; }
  dd { margin: 2px 0 0; font-weight: 700; }
  form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  form.options { grid-template-columns: 1fr; }
  .label { margin: 0 0 10px; font-weight: 700; }
  button.option { color: #fff; background: var(--blue); }
  button.option.chosen { opacity: 1; box-shadow: inset 0 0 0 3px #0f6b56; }
  button { min-height: 50px; border: 0; border-radius: 14px; font: inherit; font-weight: 750; cursor: pointer; }
  button.yes { color: #fff; background: var(--blue); }
  button.no { color: #16191f; background: #eef1f5; }
  button:disabled { opacity: .45; cursor: default; }
  .answer { margin: 0 0 14px; padding: 12px 14px; border-radius: 12px; }
  .answer.yes { background: #e4f5ef; color: #0f6b56; }
  .answer.no { background: #fdeaea; color: #9b3434; }
  .small { margin: 12px 0 0; color: #6f7682; font-size: 13px; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #17191d; color: #f2f3f5; }
    .card { background: #202329; border-color: #353a43; }
    dl div { background: #272a31; }
    dt, .small { color: #a9afba; }
    button.no { color: #f2f3f5; background: #2d3139; }
    .answer.yes { background: #203d37; color: #8fdcc4; }
    .answer.no { background: #432a2a; color: #f3aaaa; }
  }
</style>
</head>
<body><main><div class="card">${body}</div></main></body>
</html>`;
}
