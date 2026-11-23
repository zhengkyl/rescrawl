import { dist, type Point3 } from "../math.ts";

export type SmoothOptions = {
  smoothWindow?: number; // use an arc length window to only smooth dense sections
  minMove?: number;
};

export type Sample = {
  x: number;
  y: number;
  p: number;
  t: number;
  tOut: number;
  corner: boolean;
  s: number; // running length along the samples
  at: number; // place on the fitted curve: node index + u, a whole number at a node
};

export function toSmoothSamples(
  points: Point3[],
  o: Required<SmoothOptions>,
): { samples: Sample[]; fixedIndex: number } {
  const n = points.length;
  const W = o.smoothWindow;

  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + dist(points[i - 1], points[i]);

  // optional fields
  const pressure = points.map((p) => p.p ?? 0);

  // there are 0 and negative timesteps, but sample order is correct
  // drag error forward instead of back so old points don't change
  const p0 = points[0];
  let maxT = p0.t;
  const samples: Sample[] = [
    {
      x: p0.x,
      y: p0.y,
      p: pressure[0],
      t: maxT,
      tOut: maxT,
      s: 0,
      corner: false,
      at: 0,
    },
  ];
  let stableIndex = 0;

  for (let i = 1; i < n; i++) {
    const pp = points[i];
    let x = pp.x;
    let y = pp.y;
    let p = pressure[i];
    maxT = Math.max(maxT, pp.t);

    let sum = 1;
    if (W > 0) {
      // weighting by distance prevents window w/ same points
      const reach = Math.min(W, s[i], s[n - 1] - s[i]);
      for (let j = i - 1; j >= 0 && s[i] - s[j] <= reach; j--) {
        const w = 1 - (s[i] - s[j]) / W;
        x += w * points[j].x;
        y += w * points[j].y;
        p += w * pressure[j];
        sum += w;
      }
      // symmetric window, TODO: test alternate shapes, eg, back only
      for (let j = i + 1; j < n && s[j] - s[i] <= reach; j++) {
        const w = 1 - (s[j] - s[i]) / W;
        x += w * points[j].x;
        y += w * points[j].y;
        p += w * pressure[j];
        sum += w;
      }
    }

    const next = {
      x: x / sum,
      y: y / sum,
      p: p / sum,
      t: maxT,
      tOut: maxT,
      corner: false,
      s: 0,
      at: 0,
    };
    const last = samples[samples.length - 1];
    const d = dist(last, next);
    if (d <= o.minMove) {
      last.tOut = maxT;
      continue;
    }
    next.s = last.s + d;
    if (W === 0 || s[n - 1] - s[i] > W) stableIndex = samples.length;
    samples.push(next);
  }

  return { samples, fixedIndex: stableIndex };
}
