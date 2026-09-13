export const FLIGHTAWARE_ORIGIN = "https://www.flightaware.com";

const FLIGHTAWARE_RESULT_PATTERN =
  /"flightArrivalDay":"([\s\S]*?)","flightArrivalTime":"([\s\S]*?)","flightDepartureDay":"([\s\S]*?)","flightDepartureTime":"([\s\S]*?)","flightIdent":"([\s\S]*?)","flightStatus"/g;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function flightAwareClock(value: string) {
  const match = value.match(/(\d{1,2}):(\d{2})(AM|PM)/i);
  if (!match) return null;
  const minute = Number(match[2]);
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function flightAwareWeekday(value: string) {
  return value.match(/>(Sun|Mon|Tue|Wed|Thu|Fri|Sat)</)?.[1] ?? null;
}

function flightAwareFlightUrl(value: string) {
  const path = value.match(
    /href=\\"(\/live\/flight\/id\/[A-Za-z0-9%:._-]+)\\"/,
  )?.[1];
  return path ? new URL(path, FLIGHTAWARE_ORIGIN).toString() : null;
}

export function matchFlightAwareResult(
  html: string,
  date: string,
  time: string,
  matchField: "arrival" | "departure",
) {
  const dateValue = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(dateValue.getTime())) return null;
  const expectedDay = WEEKDAYS[dateValue.getUTCDay()];
  FLIGHTAWARE_RESULT_PATTERN.lastIndex = 0;
  for (const result of html.matchAll(FLIGHTAWARE_RESULT_PATTERN)) {
    const dayValue = matchField === "arrival" ? result[1] : result[3];
    const timeValue = matchField === "arrival" ? result[2] : result[4];
    if (
      flightAwareWeekday(dayValue) === expectedDay &&
      flightAwareClock(timeValue) === time
    ) {
      return flightAwareFlightUrl(result[5]);
    }
  }
  return null;
}
