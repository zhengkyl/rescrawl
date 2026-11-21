import { clamp11, dist } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type CornerOptions = {
  cornerArm?: number;
  cornerTurn?: number;
};

export function markCorners(samples: Sample[], o: Required<CornerOptions>) {
  const n = samples.length;
  const { cornerArm: arm, cornerTurn: minTurn } = o;

  const reversal = new Uint8Array(n);
  for (let j = 1; j < n - 1; j++) {
    if (turnAt(samples[j - 1], samples[j], samples[j + 1]) >= minTurn) reversal[j] = 1;
  }

  const scores = new Float64Array(n);

  for (let i = 1; i < n - 1; i++) {
    const s = samples[i].s;
    // both arms need a sample past arm
    if (s - samples[0].s <= arm) continue;
    if (samples[n - 1].s - s <= arm) break;

    // an arm ends at the first sample past arm, or at a reversal
    let lo = i - 1;
    while (s - samples[lo].s <= arm && !reversal[lo]) lo--;
    let hi = i + 1;
    while (samples[hi].s - s <= arm && !reversal[hi]) hi++;

    const a = samples[lo];
    const p = samples[i];
    const b = samples[hi];
    const turn = turnAt(a, p, b);

    if (turn >= minTurn) {
      const straightness = (dist(a, p) / (s - a.s)) * (dist(p, b) / (b.s - s));
      scores[i] = turn * straightness;
    }
  }

  for (let i = 1; i < n - 1; i++) {
    if (scores[i] === 0) continue;
    samples[i].corner = isBestLocalCorner(scores, samples, i, arm);
  }
}

function isBestLocalCorner(scores: Float64Array, samples: Sample[], i: number, arm: number) {
  const s = samples[i].s;
  const score = scores[i];
  for (let j = i - 1; j >= 0 && s - samples[j].s <= arm; j--) {
    if (scores[j] === 0) break;
    if (scores[j] >= score) return false;
  }
  for (let j = i + 1; j < scores.length && samples[j].s - s <= arm; j++) {
    if (scores[j] === 0) break;
    if (scores[j] > score) return false;
  }
  return true;
}

function turnAt(a: Sample, p: Sample, b: Sample) {
  const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (dist(a, p) * dist(p, b));
  return Math.acos(clamp11(cos));
}
