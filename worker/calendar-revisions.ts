export const CALENDAR_FORMAT_VERSION = 7;

const CALENDAR_SEQUENCE_MULTIPLIER = 1_000;

export function calendarSequenceFor(eventSequence: number) {
  return eventSequence * CALENDAR_SEQUENCE_MULTIPLIER + CALENDAR_FORMAT_VERSION;
}
