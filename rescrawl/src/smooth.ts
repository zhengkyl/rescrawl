import type { Point4, RenderOptions } from "./types.ts";

// --- stage 2 of 4: moving average over position ---
//
// Radii are already smoothed by stage 1, so only x/y are filtered here; the
// radius just rides along and this is where Point3 becomes Point4.
//
// The window is odd and centred, and near either end it shrinks to the largest
// symmetric window that still fits — so every input point produces an output
// point, and the two endpoints pass through untouched. A fixed window would
// instead have to drop the `windowRadius` points at each end, which detaches the
// stroke from where the pen actually started and stopped.
//
// `smoothWindow` 0 or 1 is no smoothing, which is the default: stage 1 already
// smooths the radius, and the fit's own tolerance absorbs most position noise,
// so this is a knob to reach for rather than a pass to run by default.
export function smoothPositions(points: Point4[], o: Required<RenderOptions>): Point4[] {
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
