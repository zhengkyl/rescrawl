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
  const scores = new Float64Array(n).fill(-1);
  const rows: CornerTrace[] = [];

  let prev = -1;
  let next = 0;
  for (let i = 1; i < n - 1; i++) {
    const s = arcLengths[i];
    while (prev + 1 < i && s - arcLengths[prev + 1] > arm) prev++;
    while (next < n && arcLengths[next] - s <= arm) next++;
    if (prev === -1) continue;
    if (next === n) break;

    const a = samples[prev];
    const p = samples[i];
    const b = samples[next];
    const chordIn = dist(a, p);
    const chordOut = dist(p, b);
    const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (chordIn * chordOut);
    const turn = Math.acos(clamp11(cos));

    // chord / arcLength measures how straight arm is
    const straight = (chordIn / (s - arcLengths[prev])) * (chordOut / (arcLengths[next] - s));

    turns[i] = turn;
    scores[i] = turn * straight;
    if (trace !== undefined) {
      rows.push({ at: i, prev, next, in: chordIn, out: chordOut, turn, corner: false });
    }
  }

  for (let i = 1; i < n - 1; i++) {
    if (turns[i] < o.cornerTurn) continue;
    if (!isPeak(scores, arcLengths, i, arm)) continue;
    samples[i].corner = true;
  }

  if (trace !== undefined) {
    for (const row of rows) row.corner = samples[row.at].corner;
    trace.push(...rows);
  }
}

function isPeak(scores: Float64Array, arcLengths: Float64Array, i: number, arm: number) {
  const score = scores[i];
  for (let j = i - 1; j >= 0 && arcLengths[i] - arcLengths[j] <= arm; j--) {
    if (scores[j] >= score) return false;
  }
  for (let j = i + 1; j < scores.length && arcLengths[j] - arcLengths[i] <= arm; j++) {
    if (scores[j] > score) return false;
  }
  return true;
}
