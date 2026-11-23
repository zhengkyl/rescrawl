import { type CornerOptions, markCorners } from "./centerline/corner.ts";
import { type CenterlineFit, fitCubics, type FitOptions } from "./centerline/fit.ts";
import { retimeDuplicateTimestamps, type RetimeOptions } from "./centerline/retime.ts";
import { type SmoothOptions, toSmoothSamples } from "./centerline/smooth.ts";
import type { Point3 } from "./math.ts";

export class Centerline {
  private points: Point3[];
  private options: Required<CenterlineOptions>;

  private fit: CenterlineFit = { samples: [], nodes: [], settled: 0 };
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
    o.lookahead *= px;
    o.smoothWindow *= px;
    o.tolerance *= px;

    this.options = o;
  }
  update(point: Point3) {
    this.points.push(point);
  }
  curves(tOpen?: number): CenterlineFit {
    if (this.points.length === 0 || this.done) return this.fit;
    const o = this.options;

    const smooth = toSmoothSamples(this.points, o);
    const samples = smooth.samples;
    retimeDuplicateTimestamps(samples, o);
    markCorners(samples, o);

    if (tOpen != null) {
      const tip = samples[samples.length - 1];
      tip.tOut = Math.max(tip.tOut, tOpen);
    }

    let stableIndex = samples.length - 1;
    if (tOpen != null) {
      const fixedSampleS = samples[smooth.fixedIndex].s;
      stableIndex = smooth.fixedIndex - 1;
      while (stableIndex >= 0 && fixedSampleS - samples[stableIndex].s <= o.lookahead) {
        stableIndex--;
      }
    }

    this.fit = fitCubics(samples, o, stableIndex, this.fit);
    this.done = tOpen == null;
    return this.fit;
  }
}

// lengths in screen px at `zoom`
export type CenterlineOptions = SmoothOptions &
  RetimeOptions &
  CornerOptions &
  FitOptions & {
    zoom?: number;
  };

export const CENTERLINE_DEFAULTS: Required<CenterlineOptions> = {
  zoom: 1,
  smoothWindow: 4,
  minMove: 1,
  framePeriod: 1000 / 60,
  lookahead: 8,
  tolerance: 0.5,
  refitRounds: 2,
  settleTime: 100,
};
