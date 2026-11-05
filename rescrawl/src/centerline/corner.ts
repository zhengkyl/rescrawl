import { clamp11, dist, type Point4 } from "../math.ts";

export type CornerPoint = Point4 & { corner?: boolean };

export type CornerOptions = {
  cornerArm?: number; // px of arc length either side of a sample its chords reach
  cornerTurn?: number; // deg; a corner is where the out chord turns at least this far from the in chord
};

export type CornerTrace = {
  at: number;
  prev: number;
  next: number;
  in: number;
  out: number;
  turn: number; // deg
  corner: boolean;
};

const DEG = Math.PI / 180;

export function markCorners(
  points: Point4[],
  s: Float64Array,
  o: Required<CornerOptions>,
  trace?: CornerTrace[],
): CornerPoint[] {
  const out: CornerPoint[] = points.slice();
  if (points.length === 0) return out;

  const arm = o.cornerArm;

  // Each chord reaches past `arm`, so neither has zero length.
  for (let i = 1; i < points.length - 1; i++) {
    const currS = s[i];
    let pi = i - 1;
    for (; pi >= 0; pi--) {
      if (currS - s[pi] > arm) break;
    }
    if (pi === -1) continue;

    let ni = i + 1;
    for (; ni < points.length; ni++) {
      if (s[ni] - currS > arm) break;
    }
    if (ni === points.length) continue;

    const a = points[pi];
    const p = points[i];
    const b = points[ni];
    const cin = dist(a, p);
    const cout = dist(p, b);
    const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (cin * cout);
    const turn = Math.acos(clamp11(cos)) / DEG;
    const corner = turn >= o.cornerTurn;
    if (corner) out[i] = { ...p, corner: true };
    trace?.push({
      at: i,
      prev: pi,
      next: ni,
      in: cin,
      out: cout,
      turn,
      corner,
    });
  }
  return out;
}
