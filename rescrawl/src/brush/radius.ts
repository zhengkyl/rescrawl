import type { Sample } from "../centerline/smooth.ts";
import { lerp } from "../math.ts";
import { type InkOptions, withDefaults } from "../options.ts";

export type RadiiOptions = {
  minWidth?: number;
  maxWidth?: number;
  widthLag?: number; // ms for the width to catch up
};

function nextEma(current: number, target: number, nextDelta: number, tauConst: number) {
  const stepWeight = nextDelta / tauConst;
  const alpha = 1 - Math.exp(-stepWeight);
  return current + (target - current) * alpha;
}

export function pressureRadii(samples: Sample[], options: InkOptions = {}): Float64Array {
  const o = withDefaults(options);
  const lo = o.minWidth / 2 / o.zoom;
  const hi = o.maxWidth / 2 / o.zoom;

  const out = new Float64Array(samples.length);
  let r = lo;
  for (let i = 0; i < samples.length; i++) {
    const curr = samples[i];

    const pause = curr.tOut - curr.t;
    if (pause > 0) {
      r = nextEma(r, hi, pause, o.widthLag);
    }

    if (i + 1 < samples.length) {
      const next = samples[i + 1];
      r = nextEma(r, lerp(lo, hi, curr.p), next.t - curr.tOut, o.widthLag);
    }

    out[i] = r;
  }
  return out;
}
