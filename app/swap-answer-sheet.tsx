"use client";

import { ArrowLeftRight, Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { backdropClose } from "./home-sections";
import { compactTime } from "./schedule-tools";
import { answerSwap, viewSwap, type SwapView } from "./swap-requests";

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const shiftLabel = (shift: { date: string; start: string; end: string }) =>
  `${dayLabel(shift.date)} · ${compactTime(shift.start)}–${compactTime(shift.end)}`;

/** A teammate's swap request, answered right in the app. */
export function SwapAnswerSheet({ swapId, service, onAnswered, onClose }: {
  swapId: string;
  service: string;
  onAnswered: () => void;
  onClose: () => void;
}) {
  const [swap, setSwap] = useState<SwapView | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [done, setDone] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    let cancelled = false;
    viewSwap(service, swapId)
      .then((result) => !cancelled && setSwap(result))
      .catch((problem: unknown) => !cancelled && setError(problem instanceof Error ? problem.message : "This swap couldn’t be opened."));
    return () => {
      cancelled = true;
    };
  }, [service, swapId]);

  const answer = async (value: string) => {
    setSending(value);
    setError("");
    try {
      await answerSwap(service, swapId, value);
      setDone(value === "no" ? "no" : "yes");
      onAnswered();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Your answer couldn’t be sent.");
    } finally {
      setSending(null);
    }
  };

  const from = swap?.from || "A teammate";
  const choices = swap && swap.options.length > 1 ? swap.options : null;
  const answered = swap && swap.status !== "waiting" && !done;

  return (
    <div className="modal-layer" role="presentation" {...backdropClose(onClose)}>
      <section className="panel-sheet share-sheet swap-answer-sheet" role="dialog" aria-modal="true" aria-label="Shift swap request">
        <header className="sheet-head sheet-head-tools">
          <h2>{swap ? `${from} wants to swap` : "Shift swap"}</h2>
          <div className="sheet-tools">
            <button type="button" className="sheet-tool" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <div className="sheet-scroll">
          {!swap && !error && (
            <div className="sheet-empty">
              <LoaderCircle className="spin share-loading" />
              <p>Opening…</p>
            </div>
          )}
          {!swap && error && (
            <div className="sheet-empty">
              <p>Couldn’t open this swap</p>
              <small>{error}</small>
            </div>
          )}
          {swap && done && (
            <div className="share-done">
              <span className="share-done-icon">{done === "yes" ? <Check /> : <X />}</span>
              <p>{done === "yes" ? "You said yes" : "You said you can’t"}</p>
              <small>{from} just got your answer.</small>
            </div>
          )}
          {swap && !done && (
            <>
              {swap.status === "cancelled" ? (
                <div className="sheet-empty">
                  <p>{from} changed their mind</p>
                  <small>This swap isn’t needed anymore.</small>
                </div>
              ) : (
                <>
                  {swap.give && (
                    <div className="swap-answer-shift">
                      <span>You’d take {from}’s shift</span>
                      <b>{shiftLabel(swap.give)}</b>
                    </div>
                  )}
                  {!choices && swap.take && (
                    <div className="swap-answer-shift">
                      <span>{from} would take yours</span>
                      <b>{shiftLabel(swap.take)}</b>
                    </div>
                  )}
                  {answered && (
                    <p className="share-note">You already answered {swap.status === "yes" ? "yes" : "no"}. You can change it below.</p>
                  )}
                  {choices ? (
                    <>
                      <p className="share-section-title">{from} could take any one of yours. Pick one:</p>
                      <div className="share-choices">
                        {choices.map((option, index) => (
                          <button
                            key={`${option.date}-${index}`}
                            type="button"
                            className="share-choice"
                            disabled={sending !== null}
                            onClick={() => void answer(`yes:${index}`)}
                          >
                            <span className="share-choice-icon">
                              {sending === `yes:${index}` ? <LoaderCircle className="spin" /> : <ArrowLeftRight />}
                            </span>
                            <span className="share-choice-copy">
                              <b>{dayLabel(option.date)}</b>
                              <small>{compactTime(option.start)}–{compactTime(option.end)}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button primary share-make"
                      disabled={sending !== null}
                      onClick={() => void answer("yes")}
                    >
                      {sending === "yes" ? <LoaderCircle className="spin" /> : <Check />} Works for me
                    </button>
                  )}
                  <button
                    type="button"
                    className="button soft share-make swap-answer-no"
                    disabled={sending !== null}
                    onClick={() => void answer("no")}
                  >
                    {sending === "no" ? <LoaderCircle className="spin" /> : <X />} {choices ? "Can’t do any" : "Can’t"}
                  </button>
                  {error && <p className="contacts-notice share-error" role="alert">{error}</p>}
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
