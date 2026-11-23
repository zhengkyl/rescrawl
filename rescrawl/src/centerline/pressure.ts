import { dist } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type PressureOptions = {
  thinSpeed?: number; // screen px/ms at which pressure halves
  zoom?: number;
};

export const PRESSURE_DEFAULTS: Required<PressureOptions> = {
  thinSpeed: 0.5,
  zoom: 1,
};

export function setSpeedPressure(samples: Sample[], options: PressureOptions) {
  const o = { ...PRESSURE_DEFAULTS, ...options };
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
