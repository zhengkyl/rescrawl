import type { Brush, BrushPaths, Paint } from "./Brush.ts";
import type { CenterlineFit } from "../centerline/fit.ts";
import { type InkOptions, withDefaults } from "../options.ts";
import { fitPath, gridDigits } from "../svg.ts";

export type LineBrushOptions = {
  width?: number;
};

// each newly settled stretch is its own path; round caps hide the joins
export class LineBrush implements Brush {
  paint: Paint;

  private paths: string[] = [];
  private end = 0;
  private digits: number;

  constructor(options: InkOptions = {}) {
    const o = withDefaults(options);
    this.paint = { width: o.width / o.zoom };
    this.digits = gridDigits(o.tolerance / o.zoom);
  }

  draw(fit: CenterlineFit): BrushPaths {
    const ns = fit.nodes;
    const n = ns.length;
    if (n === 0) return { paths: [], settled: 0 };
    if (n === 1) return { paths: [fitPath(ns, this.digits)], settled: fit.settled };
    // the last settled segment's end node is settled too
    const last = Math.min(fit.settled, n - 1);
    if (last > this.end) {
      this.paths.push(fitPath(ns.slice(this.end, last + 1), this.digits));
      this.end = last;
    }
    const open = this.end < n - 1 ? [fitPath(ns.slice(this.end), this.digits)] : [];
    return { paths: [...this.paths, ...open], settled: this.paths.length };
  }
}
