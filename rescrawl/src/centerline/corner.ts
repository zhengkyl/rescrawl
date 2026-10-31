import { clamp11, dist, type Point4 } from "../math.ts";

export type CornerPoint = Point4 & { corner?: boolean };

export type CornerOptions = {
  maxWidth?: number;
  cornerArm?: number; // × maxWidth of arc length either side of a sample its chords reach
  cornerRatio?: number; // out chord / in chord at or above this is a corner
  cornerTurn?: number; // deg; and the out chord turns at least this far from the in chord
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
  o: Required<CornerOptions>,
  trace?: CornerTrace[],
): CornerPoint[] {
  const out: CornerPoint[] = points.slice();
  if (points.length === 0) return out;

  const idx: number[] = [0];
  const s: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prevIdx = idx[idx.length - 1];
    const prev = points[prevIdx];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const ds = Math.sqrt(dx * dx + dy * dy);
    if (ds === 0) {
      idx[idx.length - 1] = i;
      continue;
    }
    idx.push(i);
    s.push(s[s.length - 1] + ds);
  }

  const arm = o.cornerArm * o.maxWidth;

  for (let i = 1; i < idx.length - 1; i++) {
    const currS = s[i];
    let pi = i - 1;
    for (; pi >= 0; pi--) {
      if (currS - s[pi] > arm) break;
    }
    if (pi === -1) continue;

    let ni = i + 1;
    for (; ni < idx.length; ni++) {
      if (s[ni] - currS > arm) break;
    }
    if (ni === idx.length) continue;

    const a = points[idx[pi]];
    const p = points[idx[i]];
    const b = points[idx[ni]];
    const cin = dist(a, p);
    const cout = dist(p, b);
    const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (cin * cout);
    const turn = Math.acos(clamp11(cos)) / DEG;
    const corner = turn >= o.cornerTurn;
    if (corner) out[idx[i]] = { ...p, corner: true };
    trace?.push({
      at: idx[i],
      prev: idx[pi],
      next: idx[ni],
      in: cin,
      out: cout,
      turn,
      corner,
    });
  }
  return out;
}
