function alarmUidFor(
  calendarId: string,
  eventKey: string,
  reminder: string,
) {
  const input = `${calendarId}|${eventKey}|${reminder}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let third = 0x85ebca6b;
  let fourth = 0xc2b2ae35;
  Array.from(input).forEach((char, index) => {
    const code = char.charCodeAt(0);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second + code + index, 0x85ebca6b) >>> 0;
    third = Math.imul(third ^ (code << index % 8), 0xc2b2ae35) >>> 0;
    fourth = Math.imul(fourth + (code ^ index), 0x27d4eb2d) >>> 0;
  });
  const hex = [first, second, third, fourth]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}${(
    (Number.parseInt(hex[16], 16) & 0x3) |
    0x8
  ).toString(16)}${hex.slice(17)}`;
  return [
    versioned.slice(0, 8),
    versioned.slice(8, 12),
    versioned.slice(12, 16),
    versioned.slice(16, 20),
    versioned.slice(20, 32),
  ]
    .join("-")
    .toUpperCase();
}

export function renderAppleTimedAlarm(
  calendarId: string,
  eventKey: string,
  reminder: string,
) {
  const alarmUid = alarmUidFor(calendarId, eventKey, reminder);
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Shiftdeck reminder",
    `TRIGGER:${reminder === "PT0M" ? "PT0M" : `-${reminder}`}`,
    `UID:${alarmUid}`,
    `X-WR-ALARMUID:${alarmUid}`,
    "END:VALARM",
  ];
}
