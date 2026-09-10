import { dist, lerp } from "./math.ts";
import type { Point3, Point4, RenderOptions } from "./types.ts";

function nextEma(current: number, target: number, delta: number, tauConst: number) {
  const stepWeight = delta / tauConst;
  const alpha = 1 - Math.exp(-stepWeight);
  return current + (target - current) * alpha;
}

export function toRadiiPointsFromRawSamples(
  points: Point3[],
  o: Required<RenderOptions>,
): Point4[] {
  if (points.length === 0) return [];

  const lo = o.minWidth / 2;
  const hi = o.maxWidth / 2;

  // pointerup not captured, no radius info
  if (points.length === 1) return [{ ...points[0], r: lo }];

  let samplePeriod = 16;
  // for (let i = 0; i < points.length - 1; i++) {
  //   const period = points[i + 1].t - points[i].t;
  //   if (period === 0) {
  //     console.log(dist(points[i + 1], points[i]));
  //   }
  //   if (period > -1) samplePeriod = Math.min(samplePeriod, period);
  // }
  // console.log(samplePeriod);
  // samplePeriod = 16;
  // if (!Number.isFinite(samplePeriod)) return points.map((p) => ({ ...p, r: lo }));

  let smoothR = lo;
  const radii: Point4[] = [];

  let dtAccum = 0;

  // Parked with the backflow experiment below, which is its only reader.
  // let prev: Point3 | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];

    const ds = dist(curr, next);
    const _dt = next.t - curr.t;

    if (ds === 0 && i !== points.length - 2) {
      dtAccum += _dt;
      continue;
    }
    const dt = _dt + dtAccum;
    dtAccum = 0;

    // a pause spot is thinner leading in, and stays thick leading out
    // thick out b/c "dragging" ink
    // slightly thicker in b/c "backflow", but not implemeneted yet

    // Can be split into pause + movement
    if (dt > 2 * samplePeriod) {
      const pauseR = nextEma(smoothR, hi, dt, o.widthLag);

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
      // add pause (technically lasts dt - samplePeriod/2, but unnoticeable)

      // no thinner forwards points b/c "dragging" ink
      //
    } else if (dt > 0) {
      const speed = ds / dt;
      const speedRatio = Math.min(speed / o.thinSpeed, 1);
      const widthRatio = 1 - speedRatio;

      const targetR = lerp(lo, hi, widthRatio);

      smoothR = nextEma(smoothR, targetR, dt, o.widthLag);
      // smoothR *= Math.pow(target / smoothR, alpha); // geometric
    }
    // if dt === 0, use previous smoothR

    radii.push({ ...curr, r: smoothR });
    // prev = curr;
  }

  return radii;
}
