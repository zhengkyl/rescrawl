import {
  type CenterlineFit,
  Ink,
  INK_DEFAULTS as LIBRARY_DEFAULTS,
  type InkOptions as LibraryInkOptions,
  LineBrush,
  type Paint,
  OutlineBrush,
} from "rescrawl";
import type { Stroke } from "./stroke";

// bump when a knob's meaning changes: stale knob settings are dropped, strokes are kept
export const INK_STORAGE_KEY = "rescrawl-ink-8";

// widths come from each stroke's size; `thinnest`: the brush's narrowest, as a fraction of it
export type InkOptions = Omit<
  Required<LibraryInkOptions>,
  "zoom" | "width" | "minWidth" | "maxWidth"
> & { thinnest: number };

const { zoom, width, minWidth, maxWidth, ...rest } = LIBRARY_DEFAULTS;
export const INK_DEFAULTS: InkOptions = { ...rest, thinnest: minWidth / maxWidth };

export type Drawn = { paths: string[]; paint: Paint; color: string };

// fed the stroke's points as their time comes, so a replay draws what the pen drew
export class StrokeInk {
  private stroke: Stroke;
  private ink: Ink;
  private paint: Paint;
  private color: string;
  private fed = 0;
  t = -Infinity;

  constructor(stroke: Stroke, options: InkOptions) {
    this.stroke = stroke;
    this.color = stroke.color;
    const { thinnest, ...knobs } = options;
    const o = {
      ...knobs,
      zoom: stroke.zoom,
      width: stroke.size,
      maxWidth: stroke.size,
      minWidth: stroke.size * thinnest,
    };
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
    return { paths: this.ink.draw(t).paths, paint: this.paint, color: this.color };
  }

  whole(): Drawn {
    const pts = this.stroke.points;
    while (this.fed < pts.length) this.ink.update(pts[this.fed++]);
    return { paths: this.ink.end().paths, paint: this.paint, color: this.color };
  }
}
