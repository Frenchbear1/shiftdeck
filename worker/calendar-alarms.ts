function alarmUidFor(
  calendarId: string,
  eventKey: string,
  reminder: string,
) {
  const cleanKey = `${eventKey}-${reminder}`
    .toLowerCase()
    .replace(/[^a-z0-9:-]+/g, "-");
  return `alarm-${cleanKey}.${calendarId.slice(0, 12)}@shiftdeck.app`;
}

export function renderAppleTimedAlarm(
  calendarId: string,
  eventKey: string,
  reminder: string,
) {
  const alarmUid = alarmUidFor(calendarId, eventKey, reminder);
  return [
    "BEGIN:VALARM",
    `UID:${alarmUid}`,
    `X-WR-ALARMUID:${alarmUid}`,
    `TRIGGER;RELATED=START:${reminder === "PT0M" ? "PT0M" : `-${reminder}`}`,
    "ACTION:AUDIO",
    "ATTACH;VALUE=URI:Chord",
    "END:VALARM",
  ];
}
