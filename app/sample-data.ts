export type ShiftStatus = "working" | "off" | "pto";

export type Shift = {
  id: string;
  date: string;
  worker: string;
  start: string;
  end: string;
  status: ShiftStatus;
  note?: string;
};

export type Flight = {
  id: string;
  date: string;
  period: "Morning" | "Afternoon" | "Evening";
  kind: "departure" | "arrival" | "turnaround";
  raw: string;
  origin: string;
  destination?: string;
  inboundAirport?: string;
  outboundAirport?: string;
  arrival?: string;
  departure?: string;
  start: string;
  end?: string;
};

const dates = [
  "2026-07-26",
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
];

export const sampleDates = dates;

type Cell = string | null;

const weekOne: Record<string, Cell[]> = {
  "Andrew Garcia": ["2100-0200", null, null, null, null, null, "1900-0100"],
  "Jayden Rush": ["2200-0200", null, null, "1830-2130", "1500-1900", "2100-0100", "PTO"],
  "Benjamin Piller": ["2200-0200", "1900-0100", null, null, "1100-1500", "1230-1630", "1230-1800"],
  "Naira Ortiz": ["2200-0200", "2130-0130", null, null, "2200-0200", "1900-0100", null],
  "Kenneth Swain": [null, "2130-0130", null, "1830-2130", "2200-0200", "2100-0100", null],
  "Xavier Rosario": [null, "2130-0130", null, null, "2200-0200", null, "1900-0100"],
  "David LaBarre": ["2100-0100", null, null, "1830-2130", "2200-0200", "1800-2200", "1900-2300"],
  "Allison Osborne": ["0500-1500|Build (5)", "0630-1630", null, null, "0500-1500", "0630-1630", null],
  "Colleen Schaffer": ["0800-1200|5 sets", "0800-1200|4 sets", "0800-1200", null, null, "0800-1200|4 sets", "0800-1200"],
  "John Snyder": ["1300-1700", "1400-1800", null, null, "1300-1700", "1300-1700", null],
  "Nicole Watson - S": [null, null, null, null, "0730-1130", null, null],
};

const weekTwo: Record<string, Cell[]> = {
  "Jayden Rush": ["PTO", null, "1500-1900", "1200-1600", "PTO", "2100-0100", "PTO"],
  "Benjamin Piller": ["2200-0200", "1900-0100", null, null, "1600-1930", "1230-1630", "1200-1900"],
  "Naira Ortiz": ["2200-0200", "2130-0130", null, null, null, "2100-0100", "1600-2000"],
  "Kenneth Swain": [null, "2130-0130", null, null, "2200-0200", "2100-0100", "2100-0100"],
  "Xavier Rosario": [null, "2130-0130", null, null, "2200-0200", null, "2000-0100"],
  "David LaBarre": ["2030-0100", "2130-0130", null, "1300-1600|NHO", "2200-0200", null, "2000-0100"],
  "Allison Osborne": ["0630-1430|5 sets", "0600-1500", null, null, "0630-1430|3 sets", "0700-1500", "0800-1500"],
  "Colleen Schaffer": ["PTO", "0800-1200", "0800-1200", null, null, "0800-1200", "0800-1200"],
  "John Snyder": ["1300-1700", "1300-1700", null, null, "1300-1700", "1300-1700", "1300-1700"],
  "Nicole Watson - S": ["0730-1130", null, null, null, null, null, null],
};

function makeShifts(week: Record<string, Cell[]>, weekDates: string[]) {
  const result: Shift[] = [];
  Object.entries(week).forEach(([worker, cells]) => {
    cells.forEach((cell, index) => {
      const date = weekDates[index];
      if (!cell) {
        result.push({
          id: `${date}-${worker}-off`,
          date,
          worker,
          start: "",
          end: "",
          status: "off",
        });
        return;
      }
      if (cell === "PTO") {
        result.push({
          id: `${date}-${worker}-pto`,
          date,
          worker,
          start: "",
          end: "",
          status: "pto",
        });
        return;
      }
      const [range, note] = cell.split("|");
      const [start, end] = range.split("-");
      result.push({
        id: `${date}-${worker}-${start}`,
        date,
        worker,
        start: `${start.slice(0, 2)}:${start.slice(2)}`,
        end: `${end.slice(0, 2)}:${end.slice(2)}`,
        status: "working",
        note,
      });
    });
  });
  return result;
}

export const sampleShifts: Shift[] = [
  ...makeShifts(weekOne, dates.slice(0, 7)),
  ...makeShifts(weekTwo, dates.slice(7)),
];

const flightRows: Record<string, { morning: string[]; afternoon: string[]; evening: string[] }> = {
  "2026-07-26": {
    morning: ["0600 SFB", "0630 PIE", "0800 MCO", "SRQ 0858/0948 SRQ"],
    afternoon: [
      "PGD 1111/1201 PGD",
      "SFB 1139/1229 BNA",
      "PIE 1227/1317 MYR",
      "MCO 1402/1452 RSW",
      "BNA 1710/1800 SFB",
    ],
    evening: ["SC ACY 1884/1924 GPT", "RSW 2123", "MYR 2306", "SFB 2339"],
  },
  "2026-07-27": {
    morning: ["0600 MLB", "0730 DEN", "0900 SFB", "PGD 0941/1031 PGD"],
    afternoon: ["MLB 1146/1236 MYR", "SFB 1441/1531 PIE", "DEN 1548/1638 FLL"],
    evening: ["SFB 1959/2049 SFB", "PIE 2128", "MYR 2225", "FLL 2310"],
  },
  "2026-07-28": { morning: ["SFB 0928/1018 SFB"], afternoon: [], evening: [] },
  "2026-07-29": {
    morning: ["0800 SFB", "0830 MYR"],
    afternoon: ["MYR 1240/1330 PIE", "SFB 1341"],
    evening: ["PIE 1927"],
  },
  "2026-07-30": {
    morning: ["0600 SFB", "0630 PIE", "0800 MCO", "SRQ 0938/1028 SRQ"],
    afternoon: [
      "PGD 1111/1201 PGD",
      "SFB 1139/1229 BNA",
      "PIE 1227/1317 MYR",
      "MCO 1402/1452 RSW",
      "SC GPT 1642/1732 AVL",
      "BNA 1710/1800 SFB",
    ],
    evening: ["RSW 2123", "MYR 2306", "SFB 2339"],
  },
  "2026-07-31": {
    morning: ["0600 MLB", "0735 FLL", "0900 SFB", "PGD 0941/1031 PGD"],
    afternoon: ["MLB 1146/1236 MYR", "FLL 1407/1457 DEN", "SFB 1441/1531 PIE"],
    evening: ["SFB 1959/2049 SFB", "PIE 2128", "MYR 2225", "DEN 2315"],
  },
  "2026-08-01": {
    morning: ["0630 MYR", "0825 PIE", "PGD 0851/0941 PGD", "1000 MYR"],
    afternoon: ["PIE 1422/1512 SFB", "MYR 1524/1755 SFB"],
    evening: ["MYR 1949", "SFB 2053", "SFB 2336"],
  },
  "2026-08-02": {
    morning: ["0600 SFB", "0630 PIE", "0800 MCO", "SRQ 0858/0948 SRQ"],
    afternoon: [
      "PGD 1111/1201 PGD",
      "SFB 1139/1229 BNA",
      "PIE 1227/1317 MYR",
      "MCO 1402/1452 RSW",
      "BNA 1710/1800 SFB",
    ],
    evening: ["RSW 2123", "MYR 2306", "SFB 2339"],
  },
  "2026-08-03": {
    morning: ["0600 MLB", "0735 FLL", "0900 SFB", "PGD 0941/1031 PGD"],
    afternoon: ["MLB 1146/1236 MYR", "FLL 1407/1457 DEN", "SFB 1441/1531 PIE"],
    evening: ["SFB 1959/2049 SFB", "PIE 2128", "MYR 2225", "DEN 2315"],
  },
  "2026-08-04": { morning: ["SFB 0928/1018 SFB"], afternoon: ["MYR 1200", "MYR 1610"], evening: [] },
  "2026-08-05": { morning: ["0800 SFB", "0830 MYR"], afternoon: ["MYR 1242", "SFB 1344"], evening: [] },
  "2026-08-06": {
    morning: ["0600 SFB", "0630 PIE", "0800 MCO", "PGD 0851/0941 PGD"],
    afternoon: [
      "SFB 1139/1229 BNA",
      "PIE 1233/1323 MYR",
      "MCO 1403/1453 RSW",
      "BNA 1710/1800 SFB",
      "SRQ 1732/1822 SRQ",
    ],
    evening: ["RSW 2124", "MYR 2316", "SFB 2339"],
  },
  "2026-08-07": {
    morning: ["0600 MLB", "0730 FLL", "0800 PGD"],
    afternoon: [
      "MLB 1155/1245 MYR",
      "FLL 1404/1454 DEN",
      "PGD 1415/1534 PIE",
      "SFB 1724/1814 SFB",
    ],
    evening: ["SFB 2000/2050 SFB", "PIE 2137", "MYR 2238", "DEN 2314"],
  },
  "2026-08-08": {
    morning: ["0700 SFB", "0810 MYR", "0820 PIE", "PGD 1021/1111 PGD"],
    afternoon: ["SFB 1244/1334 MYR", "PIE 1423/1513 SFB", "MYR 1716"],
    evening: ["SFB 2057", "MYR 2327"],
  },
};

function parseFlight(date: string, raw: string, period: Flight["period"], index: number): Flight {
  const cleaned = raw.replace(/^SC\s+/, "");
  const route = cleaned.match(/([A-Z]{3})\s+(\d{4})\/(\d{4})\s+([A-Z]{3})/);
  if (route) {
    return {
      id: `${date}-${period}-${index}`,
      date,
      period,
      kind: "turnaround",
      raw,
      origin: route[1],
      destination: route[4],
      inboundAirport: route[1],
      outboundAirport: route[4],
      arrival: `${route[2].slice(0, 2)}:${route[2].slice(2)}`,
      departure: `${route[3].slice(0, 2)}:${route[3].slice(2)}`,
      start: `${route[2].slice(0, 2)}:${route[2].slice(2)}`,
      end: `${route[3].slice(0, 2)}:${route[3].slice(2)}`,
    };
  }
  const departure = cleaned.match(/^(\d{4})\s+([A-Z]{3})$/);
  if (departure) {
    return {
      id: `${date}-${period}-${index}`,
      date,
      period,
      kind: "departure",
      raw,
      origin: "HOME",
      destination: departure[2],
      outboundAirport: departure[2],
      departure: `${departure[1].slice(0, 2)}:${departure[1].slice(2)}`,
      start: `${departure[1].slice(0, 2)}:${departure[1].slice(2)}`,
    };
  }
  const single = cleaned.match(/^([A-Z]{3})\s+(\d{4})$/);
  return {
    id: `${date}-${period}-${index}`,
    date,
    period,
    kind: "arrival",
    raw,
    origin: single?.[1] ?? "TBD",
    inboundAirport: single?.[1] ?? "TBD",
    arrival: single ? `${single[2].slice(0, 2)}:${single[2].slice(2)}` : "00:00",
    start: single ? `${single[2].slice(0, 2)}:${single[2].slice(2)}` : "00:00",
  };
}

export const sampleFlights: Flight[] = Object.entries(flightRows).flatMap(([date, rows]) => [
  ...rows.morning.map((raw, index) => parseFlight(date, raw, "Morning", index)),
  ...rows.afternoon.map((raw, index) => parseFlight(date, raw, "Afternoon", index)),
  ...rows.evening.map((raw, index) => parseFlight(date, raw, "Evening", index)),
]);

export const weekForFile = (filename: string) => {
  if (/8075/i.test(filename)) return dates.slice(0, 7);
  if (/8076/i.test(filename)) return dates.slice(7);
  return dates;
};
