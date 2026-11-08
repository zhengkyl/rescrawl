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
  if (n === 0) return;

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

export type TangentTrace = {
  at: number;
  turn: number; // rad
  corner: boolean;
};

export function detectCorners(
  samples: Sample[],
  arcLengths: Float64Array,
  o: Required<CornerOptions>,
  trace?: TangentTrace[],
) {
  const n = samples.length;

  const tan: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const curr = i;
    const prev = i > 0 ? i - 1 : 0;
    const next = i < n - 1 ? i + 1 : n - 1;

    const prevSample = samples[prev];
    const currSample = samples[curr];
    const nextSample = samples[next];

    const ax = currSample.x - prevSample.x;
    const ay = currSample.y - prevSample.y;
    const aMagn = arcLengths[curr] - arcLengths[prev];

    const bx = nextSample.x - currSample.x;
    const by = nextSample.y - currSample.y;
    const bMagn = arcLengths[next] - arcLengths[curr];

    if (i === 0) {
      tan.push({ x: bx / bMagn, y: by / bMagn });
      continue;
    }
    if (i === n - 1) {
      tan.push({ x: ax / aMagn, y: ay / aMagn });
      continue;
    }

    const tx = (bMagn / aMagn) * ax + (aMagn / bMagn) * bx;
    const ty = (bMagn / aMagn) * ay + (aMagn / bMagn) * by;
    const tMagn = Math.sqrt(tx * tx + ty * ty);

    if (tMagn === 0) {
      tan.push({ x: bx / bMagn, y: by / bMagn });
      continue;
    }

    tan.push({ x: tx / tMagn, y: ty / tMagn });
  }

  // -1 where the tangents either side aren't both there: never a corner, and
  // never beats one.
  const turns = new Float64Array(n).fill(-1);
  for (let i = 1; i < n - 1; i++) {
    const prev = tan[i - 1];
    const next = tan[i + 1];

    // turn angle, complement to interior angle
    const cos = prev.x * next.x + prev.y * next.y;
    turns[i] = Math.acos(clamp11(cos));
  }

  // with holdback, decision can wait until 2 points
  // thus we can use final tangents

  // A corner at c turns about its full angle at c and about half at c - 1 and
  // c + 1, so its neighbours pass the threshold too. Only the sample that turns
  // most is the corner: it must beat every turn within `arm` of arc length, and
  // always the samples either side. A plateau goes to its first sample.
  const arm = o.cornerArm;
  for (let i = 2; i < n - 2; i++) {
    const turn = turns[i];
    let peak = turn >= o.cornerTurn;
    for (let j = i - 1; j >= 0 && peak; j--) {
      if (j < i - 1 && arcLengths[i] - arcLengths[j] > arm) break;
      peak = turns[j] < turn;
    }
    for (let j = i + 1; j < n && peak; j++) {
      if (j > i + 1 && arcLengths[j] - arcLengths[i] > arm) break;
      peak = turns[j] <= turn;
    }
    if (peak) samples[i].corner = true;
    trace?.push({ at: i, turn, corner: peak });
  }
}
