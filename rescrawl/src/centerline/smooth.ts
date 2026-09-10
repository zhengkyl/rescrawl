import type { Point4 } from "../math.ts";

export type SmoothOptions = {
  smoothWindow?: number; // points averaged per centerpoint, odd; 0 or 1 is no smoothing
};

// Stage 2: moving average over x/y only -- stage 1 already smoothed the radius.
//
// The window shrinks near either end to the largest symmetric one that fits, so
// every input point produces an output and the endpoints pass through
// untouched; a fixed window would drop points at each end and detach the stroke
// from where the pen actually started. 0 or 1 is off, and off is the default.
export function smoothPositions(points: Point4[], o: Required<SmoothOptions>): Point4[] {
  const n = points.length;
  // Off by default, and off is the hot path: hand the same points straight
  // back rather than copying every one of them to itself each frame.
  if (o.smoothWindow < 2 || n === 0) return points;
  const out: Point4[] = [];

  // TODO, derive stay/travel from lowest interval?
  // exclusive prefix sums: prefixX[i] is the sum of stroke[0..i-1]
  const prefixX: number[] = [0];
  const prefixY: number[] = [0];
  for (let i = 0; i < n; i++) {
    prefixX.push(prefixX[i] + points[i].x);
    prefixY.push(prefixY[i] + points[i].y);
  }

  const maxRadius = Math.floor(o.smoothWindow / 2);
  for (let i = 0; i < n; i++) {
    const w = Math.min(maxRadius, i, n - 1 - i);
    // At the ends the window is the point itself. Take it verbatim rather than
    // averaging it with nothing: differencing the prefix sums there subtracts
    // two large accumulated numbers and loses the low bits, so the endpoint
    // would drift by ~1e-12 instead of passing through exactly.
    if (w === 0) {
      out.push(points[i]);
      continue;
    }
    const start = i - w;
    const end = i + w;
    const span = end - start + 1;
    out.push({
      x: (prefixX[end + 1] - prefixX[start]) / span,
      y: (prefixY[end + 1] - prefixY[start]) / span,
      t: points[i].t,
      r: points[i].r,
    });
  }
  return out;
}
