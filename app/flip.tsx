"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { FlipDigits } from "./flip-digits.js";

type Engine = {
  set: (el: HTMLElement, text: string, options?: { up?: boolean; all?: boolean }) => void;
};
const digits = FlipDigits as unknown as Engine;

/** <flip-n>: an inline element no page style targets (typed as a span for React). */
const FlipBox = "flip-n" as unknown as "span";

/** The last text shown under each memory key, so something that's rebuilt rolls from what was there. */
const memory = new Map<string, string>();

/** The numbers in a line: "7", "10:40", "0.25", "10:40 PM". */
const NUMBER = /(-?\d+(?:[:.,]\d+)*(?:\s?[AaPp][Mm]?\b)?)/;

/** One number whose digits roll when it changes (Calfie's digit flip). */
function Digits({ text, remember, up }: { text: string; remember?: string; up?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!shown.current) {
      shown.current = true;
      const before = remember ? memory.get(remember) : undefined;
      if (before !== undefined && before !== text) {
        digits.set(el, before);
        const frame = requestAnimationFrame(() => digits.set(el, text, up === undefined ? undefined : { up }));
        if (remember) memory.set(remember, text);
        return () => cancelAnimationFrame(frame);
      }
      digits.set(el, text);
    } else {
      digits.set(el, text, up === undefined ? undefined : { up });
    }
    if (remember) memory.set(remember, text);
  }, [text, remember, up]);
  // The engine owns what's inside; React only owns the box. Not a <span>: page styles
  // for spans in a card mustn't apply to it.
  return <FlipBox ref={ref} className="flip-num" />;
}

/**
 * Text whose numbers flip when they change, like Calfie's. Words stay put;
 * each number in the line rolls the digits that differ (up when it grows).
 * The first showing is plain.
 *
 * `memory`: for something that's rebuilt when it changes (a card that
 * remounts, a cell that now shows another day): the last text seen under
 * that key is what it rolls from.
 */
export function Flip({ value, memory: remember, className, style, up }: {
  value: string | number;
  memory?: string;
  className?: string;
  style?: CSSProperties;
  /** Roll up (true) or down (false); by default up when the number grows. */
  up?: boolean;
}) {
  const parts = String(value).split(NUMBER);
  return (
    <FlipBox className={className ? `flip ${className}` : "flip"} style={style}>
      {parts.map((part, index) =>
        index % 2 ? (
          <Digits key={index} text={part} remember={remember && `${remember}:${index}`} up={up} />
        ) : (
          part
        ),
      )}
    </FlipBox>
  );
}
