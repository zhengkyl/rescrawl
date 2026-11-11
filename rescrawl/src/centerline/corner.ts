import { clamp11, dist } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type CornerOptions = {
  cornerArm?: number;
  cornerTurn?: number;
};

export type CornerTrace = {
  at: number;
  prev: number;
  next: number;
  in: number;
  out: number;
  turn: number; // rad
  corner: boolean;
};

export function markCorners(
  samples: Sample[],
  arcLengths: Float64Array,
  o: Required<CornerOptions>,
  trace?: CornerTrace[],
) {
  const n = samples.length;
  const arm = o.cornerArm;

  const turns = new Float64Array(n).fill(-1);
  const rows: CornerTrace[] = [];

  // Each chord reaches past `arm`, so neither has zero length.
  for (let i = 1; i < n - 1; i++) {
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
    const turn = Math.acos(clamp11(cos));
    turns[i] = turn;
    rows.push({
      at: i,
      prev: pi,
      next: ni,
      in: cin,
      out: cout,
      turn,
      corner: false,
    });
  }

  // Every sample near a corner turns past the threshold; only the one that
  // turns most is the corner. It must beat every turn within `arm` of arc
  // length, and always the samples either side. A plateau goes to its first
  // sample. Final once samples reach `2 * arm` past it.
  for (const row of rows) {
    const i = row.at;
    const turn = turns[i];
    if (turn < o.cornerTurn) continue;
    let peak = true;
    for (let j = i - 1; j >= 0 && peak; j--) {
      if (j < i - 1 && arcLengths[i] - arcLengths[j] > arm) break;
      peak = turns[j] < turn;
    }
    for (let j = i + 1; j < n && peak; j++) {
      if (j > i + 1 && arcLengths[j] - arcLengths[i] > arm) break;
      peak = turns[j] <= turn;
    }
    if (!peak) continue;
    row.corner = true;
    samples[i].corner = true;
  }

  trace?.push(...rows);
}
