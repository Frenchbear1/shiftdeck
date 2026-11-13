"use client";

import { useEffect, useState } from "react";
import type { LiveStatus } from "./live-flights";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const clock = (date: Date) =>
  date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Shared refresh usage for live flight times, shown in Settings. */
export function LiveStatusSetting({
  status,
  updatedAt,
}: {
  status: LiveStatus;
  updatedAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const nextAt = status.nextAt ? Date.parse(status.nextAt) : 0;
  const waiting = nextAt > now;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const left = Math.max(0, Math.ceil((nextAt - now) / 1000));
  const emergencyLeft = Math.max(0, status.emergencyLimit - status.emergencyUsed);
  const next =
    status.available === "budget"
      ? "Paused until next month (free amount used)"
      : waiting
        ? `Next refresh in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
        : status.available === "none"
          ? "All refreshes used · resets at midnight"
          : status.available === "emergency"
            ? "Next refresh: emergency only"
            : "Next refresh: available now";

  return (
    <div className="live-status-setting">
      <span>Live flight times · shared by everyone</span>
      <b>
        {status.used} of {status.dailyLimit} refreshes used today · {emergencyLeft} emergency left
      </b>
      <div className="live-status-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (status.used / status.dailyLimit) * 100)}%` }} />
      </div>
      <small className={waiting ? "waiting" : ""}>{next}</small>
      <small>
        This month: {money(status.monthSpentCents)} of {money(status.monthFreeCents)} free used
        {updatedAt ? ` · last updated ${clock(new Date(updatedAt))}` : ""}
      </small>
    </div>
  );
}
