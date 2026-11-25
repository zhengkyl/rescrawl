import type { CenterlineFit } from "../centerline/fit.ts";

// fill nonzero, or stroke at `width` with round caps and joins
export type Paint = "fill" | { width: number };

// paths[0..settled) never change
export type BrushPaths = { paths: string[]; settled: number };

// one per stroke
export type Brush = {
  paint: Paint;
  draw(fit: CenterlineFit): BrushPaths;
};
