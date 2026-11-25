import { markCorners } from "./corner.ts";
import { type CenterlineFit, fitCubics } from "./fit.ts";
import { retimeDuplicateTimestamps } from "./retime.ts";
import { toSmoothSamples } from "./smooth.ts";
import type { Point3 } from "../math.ts";
import { type InkOptions, withDefaults } from "../options.ts";

export class Centerline {
  private points: Point3[];
  private options: Required<InkOptions>;

  private last: CenterlineFit = { samples: [], nodes: [], settled: 0 };
  private done = false;

  constructor(points: Point3[], options: InkOptions = {}) {
    this.points = points;

    const o = withDefaults(options);
    if (o.zoom <= 0) throw new RangeError(`zoom must be positive, got ${o.zoom}`);
    if (o.tolerance <= 0) throw new RangeError(`tolerance must be positive, got ${o.tolerance}`);

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
  // tOpen: the time now, the pen still down
  fit(tOpen: number): CenterlineFit {
    if (this.done) throw new Error("Centerline.fit after end");
    return this.run(tOpen);
  }

  end(): CenterlineFit {
    if (this.done) return this.last;
    const fit = this.run();
    this.done = true;
    return fit;
  }

  private run(tOpen?: number): CenterlineFit {
    if (this.points.length === 0) return this.last;
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

    this.last = fitCubics(samples, o, stableIndex, this.last);
    return this.last;
  }
}
