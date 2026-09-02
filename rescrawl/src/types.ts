export type Point2 = { x: number; y: number };
export type Point3 = { x: number; y: number; t: number };
export type Point4 = { x: number; y: number; t: number; r: number };
// `m`, when present, is the full Hermite tangent length at this contact, used
// on both sides of it. Absent, `outlinePath` falls back to its chord rule.
export type Contact = Point2 & { tx: number; ty: number; m?: number };

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
  // `toOutlineTension` instead of `toOutline`: one contact per node per side,
  // the turn carried by tangent magnitude. Angles here are in degrees so they
  // read naturally on a slider; see `TensionOptions` for what each one does.
  tensionOutline?: boolean;
  cornerAngle?: number; // deg
  cornerScale?: number;
  maxTurn?: number; // deg
  weightedAngle?: boolean;
  cornerPoint?: boolean;
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
  tensionOutline: false,
  cornerAngle: 45,
  cornerScale: 1.4,
  maxTurn: 150,
  weightedAngle: true,
  cornerPoint: false,
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
};

export type StrokeRender = {
  centerline: Point4[];
  outline: Contact[]; // closed loop
};
