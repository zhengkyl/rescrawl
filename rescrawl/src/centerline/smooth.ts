import { dist, type Point3 } from "../math.ts";

export type SmoothOptions = {
  smoothWindow?: number;
  minMove?: number;
};

export type Sample = { x: number; y: number; tStart: number; tEnd: number };

// an arc length window restricts smoothing to dense sections
//
// weighting by distance prevents neighbors collapsing to same point
// symmetric on both sides, TODO: test alternate shapes, eg, back only
//
// must filter on post smoothed distances to avoid missing collapses
export function toSmoothSamples(points: Point3[], o: Required<SmoothOptions>) {
  const n = points.length;
  const W = o.smoothWindow;

  if (n === 0) return { points: [] as Sample[], prefixSum: new Float64Array(0) };

  // there are 0 and negative timesteps
  // we assume timestamps are late, but sample order is correct
  const t = points.map((p) => p.t);
  for (let i = n - 2; i >= 0; i--) t[i] = Math.min(t[i], t[i + 1]);

  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + dist(points[i - 1], points[i]);

  const out: Sample[] = [{ x: points[0].x, y: points[0].y, tStart: t[0], tEnd: t[0] }];
  const outS = new Float64Array(n);

  for (let i = 1; i < n; i++) {
    const pi = points[i];
    let x = pi.x;
    let y = pi.y;
    let sum = 1;

    if (W > 0) {
      const reach = Math.min(W, s[i], s[n - 1] - s[i]);
      for (let j = i - 1; j >= 0 && s[i] - s[j] <= reach; j--) {
        const w = 1 - (s[i] - s[j]) / W;
        x += w * points[j].x;
        y += w * points[j].y;
        sum += w;
      }
      for (let j = i + 1; j < n && s[j] - s[i] <= reach; j++) {
        const w = 1 - (s[j] - s[i]) / W;
        x += w * points[j].x;
        y += w * points[j].y;
        sum += w;
      }
    }

    const next = { x: x / sum, y: y / sum, tStart: t[i], tEnd: t[i] };
    const d = dist(out[out.length - 1], next);
    if (d <= o.minMove) {
      out[out.length - 1].tEnd = t[i];
      continue;
    }
    outS[out.length] = outS[out.length - 1] + d;
    out.push(next);
  }

  return { points: out, prefixSum: outS.subarray(0, out.length) };
}
