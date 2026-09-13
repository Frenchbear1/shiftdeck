import { stableCalendarUuid } from "./calendar-ids.ts";

function alarmUidFor(
  calendarId: string,
  eventKey: string,
  reminder: string,
) {
  return stableCalendarUuid(`alarm|${calendarId}|${eventKey}|${reminder}`);
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
