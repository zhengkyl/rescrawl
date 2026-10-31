import { dist } from "../math.ts";
import type { CornerPoint } from "./corner.ts";

export type SmoothOptions = {
  maxWidth?: number;
  smoothWindow?: number; // × maxWidth of arc length either side of a point averaged into it; 0 is no smoothing
};

export function smoothPositions(points: CornerPoint[], o: Required<SmoothOptions>): CornerPoint[] {
  const n = points.length;
  const W = o.smoothWindow * o.maxWidth;
  if (W <= 0 || n === 0) return points;
  const out: CornerPoint[] = [];

  // next[i]: the first corner at or after i, or the last point
  const next = new Int32Array(n);
  for (let i = n - 1, c = n - 1; i >= 0; i--) {
    if (points[i].corner) c = i;
    next[i] = c;
  }

  // TODO, derive stay/travel from lowest interval?
  // exclusive prefix sums: prefixX[i] is the sum of stroke[0..i-1]
  const prefixX: number[] = [0];
  const prefixY: number[] = [0];
  for (let i = 0; i < n; i++) {
    prefixX.push(prefixX[i] + points[i].x);
    prefixY.push(prefixY[i] + points[i].y);
  }

  // S[i]: arc length from the first point to point i
  const S = new Float64Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + dist(points[i - 1], points[i]);

  let prev = 0; // the last corner at or before i, or the first point
  for (let i = 0; i < n; i++) {
    if (points[i].corner) prev = i;
    // The same reach both ways, cut to what fits before `prev` and after
    // `next[i]`, so the window is centred on the point in arc length.
    const reach = Math.min(W, S[i] - S[prev], S[next[i]] - S[i]);
    let start = i;
    while (start > prev && S[i] - S[start - 1] <= reach) start--;
    let end = i;
    while (end < next[i] && S[end + 1] - S[i] <= reach) end++;
    // At the ends and corners the window is the point itself. Take it verbatim
    // rather than averaging it with nothing: differencing the prefix sums there subtracts
    // two large accumulated numbers and loses the low bits, so the endpoint
    // would drift by ~1e-12 instead of passing through exactly.
    if (start === end) {
      out.push(points[i]);
      continue;
    }
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

// A corner is never dropped: the fit has to find it to end a segment there.
// Where a corner and a neighbour contain one another, both are kept.
export function dropContained(pts: CornerPoint[]) {
  const out: CornerPoint[] = [];
  for (const p of pts) {
    let keep = true;
    while (out.length) {
      const q = out[out.length - 1];

      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dr = p.r - q.r;
      if (dx * dx + dy * dy > dr * dr) {
        break; // dist > delta r, nodes do not contain each other
      }

      if (dr < 0) {
        // q contains p
        keep = p.corner === true;
        break;
      }

      // p contains q
      if (q.corner) break;
      out.pop();
    }
    if (keep) out.push(p);
  }
  return out;
}
