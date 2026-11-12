import { type CornerOptions, markCorners } from "./centerline/corner.ts";
import { type CubicNode, fitHand, type HandOptions } from "./centerline/fit.ts";
import { retimeBadTimesteps, type RetimeOptions } from "./centerline/retime.ts";
import { type Sample, type SmoothOptions, toSmoothSamples } from "./centerline/smooth.ts";
import type { Point3 } from "./math.ts";
import { type RadiusOptions, varyThickness } from "./thickness/radius.ts";

export class Centerline {
  private points: Point3[];
  private options: Required<CenterlineOptions>;

  private resume = 0;
  private settled: CubicNode[] = [];
  private done = false;

  /**
   * @param points Owned by instance
   * @param options Pixel units are divided by zoom
   */
  constructor(points: Point3[], options: CenterlineOptions) {
    this.points = points;

    const o = { ...CENTERLINE_DEFAULTS, ...options };

    const px = 1 / o.zoom;
    o.minMove *= px;
    o.thinSpeed *= px;
    o.cornerArm *= px;
    o.smoothWindow *= px;
    o.handTol *= px;

    this.options = o;
  }
  update(point: Point3) {
    this.points.push(point);
  }
  // Nodes at the front of the last `curves()` that can no longer change. That
  // many segments are final too, and so is the node they end on.
  settledCount(): number {
    return this.settled.length;
  }
  curves(tOpen?: number): CubicNode[] {
    if (this.points.length === 0) return [];

    if (this.done) return [...this.settled];
    const o = this.options;

    const { samples, arcLengths, placed } = toSmoothSamples(this.points, o);

    retimeBadTimesteps(samples, arcLengths, o);
    markCorners(samples, arcLengths, o);

    if (tOpen != null) {
      const tip = samples[samples.length - 1];
      tip.tEnd = Math.max(tip.tEnd, tOpen);
    }
    varyThickness(samples, arcLengths, o);

    const stable =
      tOpen == null ? samples.length : stableSamples(samples, arcLengths, placed, o.cornerArm);
    const fit = fitHand(samples, arcLengths, o, this.resume, stable);
    this.settled.push(...fit.body);
    this.resume = fit.resume;
    this.done = tOpen == null;
    return [...this.settled, ...fit.tail];
  }
}
export function stableSamples(
  samples: Sample[],
  arcLengths: Float64Array,
  placed: number,
  cornerArm: number,
): number {
  // the last frame can still gain samples, and r[i] reads samples[i + 1].tStart
  let frame = placed;
  while (frame > 0 && samples[frame - 1].tStart === samples[placed].tStart) frame--;

  // turn[j] needs a placed sample more than cornerArm past j
  let turned = placed;
  while (turned >= 0 && arcLengths[placed] - arcLengths[turned] <= cornerArm) turned--;
  if (turned < 0) return 0;

  // corner[i] compares scores within cornerArm past i
  let corner = turned;
  while (corner > 0 && arcLengths[turned + 1] - arcLengths[corner - 1] <= cornerArm) corner--;

  return Math.max(0, Math.min(frame - 1, corner));
}

// lengths in screen px at `zoom`, except minWidth and maxWidth
export type CenterlineOptions = SmoothOptions &
  RetimeOptions &
  RadiusOptions &
  CornerOptions &
  HandOptions & {
    zoom?: number;
  };

export const CENTERLINE_DEFAULTS: Required<CenterlineOptions> = {
  zoom: 1,
  smoothWindow: 4,
  minMove: 1.5,
  framePeriod: 1000 / 60,
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  cornerArm: 4,
  cornerTurn: Math.PI / 2,
  handTol: 0.8,
  reparam: 2,
};
