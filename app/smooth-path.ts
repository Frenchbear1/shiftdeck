/**
 * A smooth line through every point (monotone cubic: it never bulges past a
 * high or low that isn't in the data, so a flat stretch stays flat).
 */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>) {
  const n = points.length;
  if (!n) return "";
  const at = (index: number) => `${points[index][0].toFixed(1)},${points[index][1].toFixed(1)}`;
  if (n < 3) return points.map((_, index) => `${index ? "L" : "M"}${at(index)}`).join(" ");
  const slopes: number[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    slopes.push((points[index + 1][1] - points[index][1]) / (points[index + 1][0] - points[index][0]));
  }
  // Each point's tangent: the average of its neighbours' slopes, flat at a peak or dip (Fritsch–Carlson).
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === n - 1) return slopes[n - 2];
    const before = slopes[index - 1];
    const after = slopes[index];
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after);
  });
  let d = `M${at(0)}`;
  for (let index = 0; index < n - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    const third = (x1 - x0) / 3;
    d += ` C${(x0 + third).toFixed(1)},${(y0 + tangents[index] * third).toFixed(1)} ${(x1 - third).toFixed(1)},${(y1 - tangents[index + 1] * third).toFixed(1)} ${at(index + 1)}`;
  }
  return d;
}
