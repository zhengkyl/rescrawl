import { dist } from "../math.ts";
import { type InkOptions, withDefaults } from "../options.ts";
import type { Sample } from "../centerline/smooth.ts";

export type PressureOptions = {
  thinSpeed?: number; // screen px/ms at which pressure halves
};

export function setSpeedPressure(samples: Sample[], options: InkOptions = {}) {
  const o = withDefaults(options);
  const thinSpeed = o.thinSpeed / o.zoom;

  const n = samples.length;
  for (let i = 0; i + 1 < n; i++) {
    const curr = samples[i];
    const next = samples[i + 1];
    const speed = dist(curr, next) / (next.t - curr.tOut);
    curr.p = 1 / (1 + speed / thinSpeed);
  }
  if (n === 1) samples[0].p = 1;
  if (n > 1) samples[n - 1].p = samples[n - 2].p;
}
