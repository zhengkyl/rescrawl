export type Point2 = { x: number; y: number };
export type Point3 = { x: number; y: number; t: number };
export type Point4 = { x: number; y: number; t: number; r: number };
export type Contact = Point2 & { tx: number; ty: number };

// A point on the sampled centre spline, carrying the two angles the outline is
// built from: `thru` is the heading there, `off` the angle off it at which the
// envelope of the swept disc touches. See `spline.ts`.
export type Sample = Point4 & { thru: number; off: number };

// The finalize pass, on the way to a file. `compressTol` drives a GLOBAL fit and
// is deliberately not part of `RenderOptions`: the renderer must never apply it,
// because a global rule re-splits a stroke as it grows. See `compress.ts`.
export type CompressOptions = {
  compressTol?: number; // px the stored path may stray from the captured one
};

export type RenderOptions = {
  minWidth?: number; // width when moving at or above `thinSpeed`
  maxWidth?: number; // width at a standstill
  thinSpeed?: number; // px/ms at which the stroke reaches minWidth
  widthLag?: number; // ms for the width to catch up at a standstill
  smoothWindow?: number; // points averaged per centerpoint, odd (1 = no smoothing)
  simplifyTol?: number; // ink the shape may gain per dropped point, as a fraction of local radius
  splineTol?: number; // px the outline may stray between centre-spline samples
  splineOutline?: boolean; // build the outline from the spline instead of straight off the points
};


// `compressTol` is small on purpose: it is a shape tolerance, and `posDigits` is
// the file-size lever.
export const COMPRESS_DEFAULTS: Required<CompressOptions> = {
  compressTol: 0.25,
};

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  smoothWindow: 3,
  simplifyTol: 0.1,
  splineTol: 0.4,
  splineOutline: false,
};

// The centerline as each stage left it, oldest first. See `pipeline.ts` -- the
// keys are in pipeline order and `simplified` is what the outline is built from.
export type StrokeStages = {
  raw: Point3[];
  snapped: Point3[]; // stage 0 -- on the grid a `.scrawl` is written to
  radius: Point4[];
  smoothed: Point4[];
  distinct: Point4[];
  simplified: Point4[];
  spline: Sample[]; // always sampled; `splineOutline` decides whether the outline uses it
};

export type StrokeRender = {
  centerline: Point4[];
  outline: Contact[]; // closed loop
};
