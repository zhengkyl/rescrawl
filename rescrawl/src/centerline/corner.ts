import { clamp11, dist } from "../math.ts";
import type { Sample } from "./smooth.ts";

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
  samples: Sample[],
  arcLengths: Float64Array,
  o: Required<CornerOptions>,
  trace?: CornerTrace[],
) {
  if (samples.length === 0) return;

  const arm = o.cornerArm;

  // Each chord reaches past `arm`, so neither has zero length.
  for (let i = 1; i < samples.length - 1; i++) {
    const currS = arcLengths[i];
    let pi = i - 1;
    for (; pi >= 0; pi--) {
      if (currS - arcLengths[pi] > arm) break;
    }
    if (pi === -1) continue;

    let ni = i + 1;
    for (; ni < samples.length; ni++) {
      if (arcLengths[ni] - currS > arm) break;
    }
    if (ni === samples.length) continue;

    const a = samples[pi];
    const p = samples[i];
    const b = samples[ni];
    const cin = dist(a, p);
    const cout = dist(p, b);
    const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (cin * cout);
    const turn = Math.acos(clamp11(cos)) / DEG;
    const corner = turn >= o.cornerTurn;
    if (corner) samples[i].corner = true;
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
}
