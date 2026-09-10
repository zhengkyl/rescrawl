export type Point2 = { x: number; y: number };
export type Point3 = { x: number; y: number; t: number };
export type Point4 = { x: number; y: number; t: number; r: number };
// `m`, when present, is the full Hermite tangent length at this contact, used
// on both sides of it. `mIn` / `mOut` override it for the cubic arriving at /
// leaving this contact, where the two differ. Absent, `outlinePath` falls back
// to its chord rule for that side.
export type Contact = Point2 & { tx: number; ty: number; m?: number; mIn?: number; mOut?: number };

// A centerline node from `fitCurve`. The segment between two nodes is a
// Hermite cubic from the first node's out-tangent (`ox`, `oy`, magnitude `mo`)
// to the second's in-tangent (`ix`, `iy`, magnitude `mi`). A magnitude of 0 on
// both ends is read as a straight chord by the consumers; `fitCurve` itself
// only emits cubics, since a straight run is a cubic whose tangents lie along
// the chord. In- and out-tangents differ only at a corner. The radius runs as
// a Hermite too, with `slope` (dr/ds) as its derivative at the node.
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

// Which engine turns the distinct centerline into the stroke's shape. An
// engine owns all of stage 4: which samples survive as nodes, what a node
// records about the path between them, and the outline wrapped around them
// -- see `engine.ts` for the contract.
//
//   fit       fitCurve, then one cubic per side per segment, its magnitudes
//             solved by least squares against the pen envelope.
//   sampled   the SAME fitCurve, then the envelope walked at a fixed step
//             with a contact dropped at each one. No outline fitting at all,
//             so it is the reference the other two are trying to match.
//   greedy    the SAME fitCurve, then the envelope fitted the way the
//             centerline was: a contact wherever the drawn cubic would
//             otherwise stray more than `outlineTol` px from the envelope.
export type OutlineEngine = "fit" | "sampled" | "greedy";

// Flat on purpose: every knob is one key, so a panel can bind a slider to it
// and a JSON blob can hold a preset. Which engine reads which key is declared
// by that engine's `knobs`; the rest is read by every run.
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
  outlineHorizon?: number; // × maxWidth one outline hop may span (greedy)
  sampleStep?: number; // × maxWidth along the centerline between contacts (sampled)
  cornerPoint?: boolean; // inside of a bend: one contact where the tangent lines cross (fit, sampled)
};

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  engine: "fit",
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
  sampleStep: 0.75,
  cornerPoint: false,
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
