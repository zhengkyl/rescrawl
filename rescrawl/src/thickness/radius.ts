import type { Sample } from "../centerline/smooth.ts";
import type { Point4 } from "../math.ts";
import { lerp } from "../math.ts";

// Stage 2: radius from pen speed.
export type RadiusOptions = {
  minWidth?: number; // width when moving at or above `thinSpeed`
  maxWidth?: number; // width at a standstill
  thinSpeed?: number; // px/ms at which the stroke reaches minWidth
  widthLag?: number; // ms for the width to catch up at a standstill
};

function nextEma(current: number, target: number, delta: number, tauConst: number) {
  const stepWeight = delta / tauConst;
  const alpha = 1 - Math.exp(-stepWeight);
  return current + (target - current) * alpha;
}

// Each point's radius is the EMA after what the pen did leaving it: sat still
// until `tEnd`, then moved to the next point. Every point gets one, the last
// from its `tEnd` alone -- the release, or now while the pen is down.
export function toRadius(points: Sample[], s: Float64Array, o: Required<RadiusOptions>): Point4[] {
  const lo = o.minWidth / 2;
  const hi = o.maxWidth / 2;

  let smoothR = lo;
  const radii: Point4[] = [];

  // Parked with the backflow experiment below, which is its only reader.
  // let prev: Point3 | null = null;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];

    // a pause spot is thinner leading in, and stays thick leading out
    // thick out b/c "dragging" ink
    // slightly thicker in b/c "backflow", but not implemeneted yet
    const still = curr.tEnd - curr.tStart;
    if (still > 0) {
      const pauseR = nextEma(smoothR, hi, still, o.widthLag);

      // add thinner backwards point
      // if (prev != null) {
      //   const prevDs = dist(prev, curr);

      //   const minBackflowRatio = 0.5; // how much needs to be covered to fully backflow
      //   const backflowRatio = pauseR / prevDs;
      //   if (backflowRatio < minBackflowRatio) {
      //     radii.push({
      //       x: lerp(curr.x, prev.x, backflowRatio),
      //       y: lerp(curr.y, prev.y, backflowRatio),
      //       t: lerp(curr.t, prev.t, backflowRatio),
      //       r: smoothR,
      //     });
      //   }
      // }

      smoothR = pauseR;
      // no thinner forwards points b/c "dragging" ink
    }

    // retime leaves time to move in before every point but the first
    const next = points[i + 1];
    if (next !== undefined) {
      const dt = next.tStart - curr.tEnd;
      const speed = (s[i + 1] - s[i]) / dt;
      const speedRatio = Math.min(speed / o.thinSpeed, 1);
      const widthRatio = 1 - speedRatio;

      const targetR = lerp(lo, hi, widthRatio);

      smoothR = nextEma(smoothR, targetR, dt, o.widthLag);
      // smoothR *= Math.pow(target / smoothR, alpha); // geometric
    }

    radii.push({ x: curr.x, y: curr.y, t: curr.tStart, r: smoothR });
    // prev = curr;
  }

  return radii;
}
