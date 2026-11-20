"use client";

import { Flip } from "./flip";
import { AlertTriangle, Check, KeyRound, Loader2 } from "lucide-react";

export type SyncStatus =
  | { state: "idle" }
  | { state: "getting" | "sending"; what: string }
  | { state: "waiting" }
  | { state: "synced" | "error"; at: number };

const clock = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** A slim line at the top while your devices catch up with each other. */
export function SyncBar({ status, devices }: { status: SyncStatus; devices: number }) {
  const others = Math.max(1, devices - 1);
  const them = others === 1 ? "your other device" : `your ${others} other devices`;
  const busy = status.state === "getting" || status.state === "sending";
  const text =
    status.state === "getting" ? `Getting ${status.what} from ${others > 1 ? "another device" : "your other device"}…`
      : status.state === "sending" ? `Sending ${status.what} to ${them}…`
        : status.state === "waiting" ? `Waiting for ${them} to unlock sync`
          : status.state === "error" ? "Couldn’t sync · trying again in a minute"
            : status.state === "synced" ? `In sync with ${them} · ${clock(status.at)}`
              : `In sync with ${them}`;
  const Icon = busy ? Loader2 : status.state === "waiting" ? KeyRound : status.state === "error" ? AlertTriangle : Check;
  return (
    <p className={`sync-bar is-${status.state}`} role="status" aria-live="polite">
      <Icon className={busy ? "spin" : undefined} aria-hidden="true" />
      <span><Flip value={text} /></span>
    </p>
  );
}
