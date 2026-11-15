"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  constrainPhoto,
  zoomPhoto,
  type PhotoPoint,
  type PhotoTransform,
} from "./schedule-photo-zoom";
import { loadScheduleImage } from "./upload-store";

const centerBetween = (a: PhotoPoint, b: PhotoPoint): PhotoPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const distanceBetween = (a: PhotoPoint, b: PhotoPoint) => Math.hypot(a.x - b.x, a.y - b.y);

function pointInStage(element: HTMLElement, event: { clientX: number; clientY: number }): PhotoPoint {
  const bounds = element.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left - bounds.width / 2,
    y: event.clientY - bounds.top - bounds.height / 2,
  };
}

function FullscreenPhoto({
  url, name, onError,
}: {
  url: string;
  name: string;
  onError: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const transform = useRef<PhotoTransform>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, PhotoPoint>());
  const pinch = useRef<{ center: PhotoPoint; distance: number; transform: PhotoTransform } | null>(null);
  const [aspect, setAspect] = useState(0);

  const frame = () => ({
    width: stage.current?.clientWidth ?? 0,
    height: stage.current?.clientHeight ?? 0,
    photoWidth: photo.current?.offsetWidth ?? 0,
    photoHeight: photo.current?.offsetHeight ?? 0,
  });

  const apply = (next: PhotoTransform) => {
    transform.current = next;
    if (photo.current) {
      photo.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
    }
  };

  useEffect(() => {
    const element = stage.current;
    if (!element) return;

    const resize = new ResizeObserver(() => {
      pinch.current = null;
      pointers.current.clear();
      apply(constrainPhoto(transform.current, frame()));
    });
    resize.observe(element);

    const onWheel = (event: WheelEvent) => {
      if (!photo.current?.naturalWidth) return;
      event.preventDefault();
      const point = pointInStage(element, event);
      const scale = transform.current.scale * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.04 : 0.002));
      apply(zoomPhoto(transform.current, point, point, scale, frame()));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      resize.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  const endGesture = (pointerId: number) => {
    if (pointers.current.delete(pointerId)) pinch.current = null;
  };

  return (
    <div
      ref={stage}
      className="schedule-photo-stage"
      onPointerDown={(event) => {
        if (event.button !== 0 || pointers.current.size >= 2 || !photo.current?.naturalWidth) return;
        const point = pointInStage(event.currentTarget, event);
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, point);
        if (pointers.current.size === 2) {
          const [a, b] = Array.from(pointers.current.values());
          pinch.current = {
            center: centerBetween(a, b),
            distance: distanceBetween(a, b),
            transform: transform.current,
          };
        }
      }}
      onPointerMove={(event) => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) return;
        const point = pointInStage(event.currentTarget, event);
        pointers.current.set(event.pointerId, point);
        const start = pinch.current;
        if (start?.distance) {
          const [a, b] = Array.from(pointers.current.values());
          const scale = start.transform.scale * distanceBetween(a, b) / start.distance;
          apply(zoomPhoto(start.transform, start.center, centerBetween(a, b), scale, frame()));
        } else if (pointers.current.size === 1) {
          apply(constrainPhoto({
            ...transform.current,
            x: transform.current.x + point.x - previous.x,
            y: transform.current.y + point.y - previous.y,
          }, frame()));
        }
      }}
      onPointerUp={(event) => endGesture(event.pointerId)}
      onPointerCancel={(event) => endGesture(event.pointerId)}
      onLostPointerCapture={(event) => endGesture(event.pointerId)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- display the locally uploaded photo */}
      <img
        ref={photo}
        src={url}
        alt={name}
        draggable={false}
        onLoad={(event) => setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
        onError={onError}
        style={aspect ? { width: `min(100cqw, 100cqh * ${aspect})` } : undefined}
      />
    </div>
  );
}

export function ScheduleFileViewer({
  id, name, pdf, onClose,
}: {
  id: string;
  name: string;
  pdf: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const viewer = dialog.current;
    viewer?.showModal();
    let cancelled = false;
    let sourceUrl: string | undefined;
    const load = async () => {
      const file = await loadScheduleImage(id);
      if (cancelled) return;
      if (!file) throw new Error("Saved schedule unavailable");
      sourceUrl = URL.createObjectURL(file);
      setUrl(sourceUrl);
    };
    void load().catch(() => {
      if (!cancelled) setUnavailable(true);
    });
    return () => {
      cancelled = true;
      viewer?.close();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [id]);

  return (
    <dialog
      ref={dialog}
      className={`schedule-file-viewer${pdf ? " schedule-file-viewer-pdf" : ""}`}
      aria-label="View schedule"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button className="schedule-file-close" type="button" onClick={onClose} aria-label="Close schedule"><X /></button>
      {unavailable ? (
        <p role="status">This schedule file is unavailable on this device.</p>
      ) : !url ? (
        <p role="status">Loading schedule…</p>
      ) : pdf ? (
        <iframe title={name} src={url} />
      ) : (
        <FullscreenPhoto url={url} name={name} onError={() => setUnavailable(true)} />
      )}
    </dialog>
  );
}
