import type { Brush, BrushPaths, Paint } from "./Brush.ts";
import type { CenterlineFit } from "../centerline/fit.ts";
import { outlinePieces, type OutlinePieces } from "./outline.ts";
import { type InkOptions, withDefaults } from "../options.ts";
import { gridDigits, outlineCubicPath } from "../svg.ts";
import { pressureRadii } from "./radius.ts";

export class OutlineBrush implements Brush {
  paint: Paint = "fill";
  outline: OutlinePieces = { pieces: [], settled: 0 };

  private options: InkOptions;
  private paths: string[] = [];
  private digits: number;

  constructor(options: InkOptions = {}) {
    this.options = options;
    const o = withDefaults(options);
    this.digits = gridDigits(o.tolerance / o.zoom);
  }

  draw(fit: CenterlineFit): BrushPaths {
    const outline = this.pieces(fit);
    this.outline = outline;
    const { pieces, settled } = outline;
    for (let i = this.paths.length; i < settled; i++) {
      this.paths.push(outlineCubicPath([pieces[i]], this.digits));
    }
    const open = pieces.slice(settled).map((p) => outlineCubicPath([p], this.digits));
    return { paths: [...this.paths, ...open], settled };
  }

  pieces(fit: CenterlineFit): OutlinePieces {
    const radii = pressureRadii(fit.samples, this.options);
    // a node's radius is its first sample's
    const r: number[] = [];
    fit.samples.forEach((s, i) => {
      if (s.at === r.length) r.push(radii[i]);
    });
    return outlinePieces(fit, r);
  }
}
