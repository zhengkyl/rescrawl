import { clamp11, dist } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type CornerOptions = {
  cornerArm?: number;
};

// corner threshold angle between in chord and out chord
const CORNER_TURN = Math.PI / 2;

export function markCorners(samples: Sample[], o: Required<CornerOptions>) {
  const n = samples.length;
  const arm = o.cornerArm;
  const scores = new Float64Array(n);

  for (let i = 1; i < n - 1; i++) {
    const p = samples[i];
    // detect corners centered on a sample
    const local = turnAt(samples[i - 1], p, samples[i + 1]);
    if (local >= CORNER_TURN) {
      scores[i] = 4; // maximum score is PI, this always greater
      continue;
    }

    // detect corners from non-centered samples

    // both arms need a sample past arm
    const s = p.s;
    if (s - samples[0].s <= arm || samples[n - 1].s - s <= arm) continue;

    let lo = i - 1;
    while (s - samples[lo].s <= arm) lo--;
    let hi = i + 1;
    while (samples[hi].s - s <= arm) hi++;

    const a = samples[lo];
    const b = samples[hi];
    const turn = turnAt(a, p, b);
    if (turn >= CORNER_TURN) {
      const straightness = (dist(a, p) / (s - a.s)) * (dist(p, b) / (b.s - s));
      scores[i] = turn * straightness;
    }
  }

  for (let i = 1; i < n - 1; i++) {
    const score = scores[i];
    if (score === 0) continue;
    let isBest = true;
    // choose sharpest corner within arm
    if (score <= Math.PI) {
      const s = samples[i].s;
      for (let j = i - 1; isBest && j >= 0 && s - samples[j].s <= arm; j--) {
        isBest = scores[j] < score;
      }
      for (let j = i + 1; isBest && j < n && samples[j].s - s <= arm; j++) {
        isBest = scores[j] <= score;
      }
    }
    samples[i].corner = isBest;
  }
}

function turnAt(a: Sample, p: Sample, b: Sample) {
  const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (dist(a, p) * dist(p, b));
  return Math.acos(clamp11(cos));
}
