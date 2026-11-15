export type PhotoPoint = { x: number; y: number };

export type PhotoFrame = {
  width: number;
  height: number;
  photoWidth: number;
  photoHeight: number;
};

export type PhotoTransform = PhotoPoint & { scale: number };

export function constrainPhoto(transform: PhotoTransform, frame: PhotoFrame): PhotoTransform {
  const maxX = Math.max(0, (frame.photoWidth * transform.scale - frame.width) / 2);
  const maxY = Math.max(0, (frame.photoHeight * transform.scale - frame.height) / 2);
  return {
    scale: transform.scale,
    x: Math.max(-maxX, Math.min(maxX, transform.x)),
    y: Math.max(-maxY, Math.min(maxY, transform.y)),
  };
}

// Points are measured from the center of the fullscreen photo stage.
export function zoomPhoto(
  start: PhotoTransform,
  startPoint: PhotoPoint,
  currentPoint: PhotoPoint,
  requestedScale: number,
  frame: PhotoFrame,
): PhotoTransform {
  const scale = Math.max(1, Math.min(5, requestedScale));
  const ratio = scale / start.scale;
  return constrainPhoto({
    scale,
    x: currentPoint.x - (startPoint.x - start.x) * ratio,
    y: currentPoint.y - (startPoint.y - start.y) * ratio,
  }, frame);
}
