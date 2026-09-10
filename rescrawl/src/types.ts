export type Point2 = { x: number; y: number };
export type Point3 = { x: number; y: number; t: number };
export type Point4 = { x: number; y: number; t: number; r: number };
// `m`, when present, is the full Hermite tangent length at this contact, used
// on both sides of it. `mIn` / `mOut` override it for the cubic arriving at /
// leaving this contact, where the two differ. Absent, `outlinePath` falls back
// to its chord rule for that side.
export type Contact = Point2 & { tx: number; ty: number; m?: number; mIn?: number; mOut?: number };

// The segment between two nodes is a Hermite cubic from the first's out-tangent
// (`ox`, `oy`, magnitude `mo`) to the second's in-tangent (`ix`, `iy`, `mi`).
// Zero magnitudes at both ends read as a straight chord. In- and out-tangents
// differ only at a corner. The radius runs as a Hermite too, with `slope`
// (dr/ds) as its derivative.
export type FitNode = Point4 & {
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  mi: number;
  mo: number;
  slope: number; // dr/ds: how fast the radius grows along the stroke here
  corner: boolean; // detected as a corner, so nothing was fitted across it
};

// One today; `engine.ts` says how to add a variant.
export type OutlineEngine = "greedy";

// Flat on purpose: one key per knob, so a panel binds a slider to it and a JSON
// blob holds a preset.
export type RenderOptions = {
  engine?: OutlineEngine;

  // --- stage 1: radius from pen speed ---
  minWidth?: number; // width when moving at or above `thinSpeed`
  maxWidth?: number; // width at a standstill
  thinSpeed?: number; // px/ms at which the stroke reaches minWidth
  widthLag?: number; // ms for the width to catch up at a standstill

  // --- stage 2 ---
  smoothWindow?: number; // points averaged per centerpoint, odd; 0 or 1 is no smoothing

  // --- stage 4: `fitCurve`, which every engine runs ---
  fitTol?: number; // ink the shape may gain where a sample is dropped, as a fraction of local r
  fitCornerAngle?: number; // deg; a turn sharper than this over `fitWindow` is a corner
  fitWindow?: number; // × maxWidth either side of a point that turn, tangent and radius slope are read over
  fitHorizon?: number; // × maxWidth a segment may span before it commits regardless

  // --- stage 4: the outline ---
  // Every length here is a multiple of `maxWidth` rather than a pixel count, so
  // a drawing scaled up with a pen scaled to match fits identically. `maxWidth`
  // is the one length the whole pipeline is measured against.
  outlineTol?: number; // × maxWidth the drawn outline may stray from the envelope (greedy)
  outlineHorizon?: number; // × maxWidth one outline hop may span
};

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  engine: "greedy",
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  smoothWindow: 0,
  fitTol: 0.1,
  fitCornerAngle: 60,
  fitWindow: 0.75,
  fitHorizon: 3,
  outlineTol: 0.03125,
  outlineHorizon: 3,
};

// The centerline as each stage left it, oldest first. See `pipeline.ts` --
// the keys are in pipeline order.
export type CenterlineStages = {
  raw: Point3[];
  radius: Point4[]; // stage 1
  smoothed: Point4[]; // stage 2
  distinct: Point4[]; // stage 3 -- what every engine starts from
};

export type StrokeStages = CenterlineStages & {
  // stage 4 -- what the engine kept, carrying the tangents the outline was
  // built on. Every engine runs `fitCurve`, so these are always `FitNode`s.
  nodes: FitNode[];
};

export type StrokeRender = {
  stages: StrokeStages;
  outline: Contact[]; // stage 4 -- closed loop
};
