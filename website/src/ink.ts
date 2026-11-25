import {
  type CenterlineFit,
  Ink,
  type InkOptions as LibraryInkOptions,
  LineBrush,
  type Paint,
  OutlineBrush,
} from "rescrawl";
import type { Stroke } from "./stroke";

export const INK_COLOR = "#1a1a1a";

// bump when a knob's meaning changes: stale knob settings are dropped, strokes are kept
export const INK_STORAGE_KEY = "rescrawl-ink-7";

export type InkOptions = Required<LibraryInkOptions>;
export { INK_DEFAULTS } from "rescrawl";

export type Drawn = { paths: string[]; paint: Paint };

// fed the stroke's points as their time comes, so a replay draws what the pen drew
export class StrokeInk {
  private stroke: Stroke;
  private ink: Ink;
  private paint: Paint;
  private fed = 0;
  t = -Infinity;

  constructor(stroke: Stroke, options: InkOptions) {
    this.stroke = stroke;
    const o = { ...options, zoom: stroke.zoom };
    const brush = stroke.style === "pen" ? new LineBrush(o) : new OutlineBrush(o);
    this.paint = brush.paint;
    this.ink = new Ink(brush, o);
  }

  get fit(): CenterlineFit {
    return this.ink.fit;
  }

  // the pen still down at t
  at(t: number): Drawn {
    const pts = this.stroke.points;
    while (this.fed < pts.length && pts[this.fed].t <= t) this.ink.update(pts[this.fed++]);
    this.t = t;
    return { paths: this.ink.draw(t).paths, paint: this.paint };
  }

  whole(): Drawn {
    const pts = this.stroke.points;
    while (this.fed < pts.length) this.ink.update(pts[this.fed++]);
    return { paths: this.ink.end().paths, paint: this.paint };
  }
}
