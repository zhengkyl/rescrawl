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

// The finalize pass, on the way to a file. `compressTol` drives a GLOBAL fit and
// is deliberately not part of `RenderOptions`: the renderer must never apply it,
// because a global rule re-splits a stroke as it grows. See `compress.ts`.
export type CompressOptions = {
  compressTol?: number; // px the stored path may stray from the captured one
};

// Which engine turns the distinct centerline into the stroke's shape. An
// engine owns stage 3b (which samples survive as nodes, and what a node
// records about the path between them) and stage 4 (the outline wrapped
// around those nodes) together -- see `engine.ts` for the contract.
//
//   fit       fitCurve, then one cubic per side per segment, its magnitudes
//             solved by least squares against the pen envelope.
//   sampled   the SAME fitCurve, then the envelope walked at a fixed step
//             with a contact dropped at each one. No outline fitting at all,
//             so it is the reference the other two are trying to match.
//   greedy    the SAME fitCurve, then the envelope fitted the way the
//             centerline was: a contact wherever the drawn cubic would
//             otherwise stray more than `outlineTol` px from the envelope.
//   tension   polyline simplify, one contact per node per side, turn carried
//             by the Hermite magnitude.
//   classic   polyline simplify, the older tangent sweep.
export type OutlineEngine = "fit" | "sampled" | "greedy" | "tension" | "classic";

// Flat on purpose: every knob is one key, so a panel can bind a slider to it
// and a JSON blob can hold a preset. Which engine reads which key is declared
// by that engine's `knobs`; the rest is read by every run.
export type RenderOptions = {
  engine?: OutlineEngine;
  // stage 1 -- radius from pen speed
  minWidth?: number; // width when moving at or above `thinSpeed`
  maxWidth?: number; // width at a standstill
  thinSpeed?: number; // px/ms at which the stroke reaches minWidth
  widthLag?: number; // ms for the width to catch up at a standstill
  // stage 2
  smoothWindow?: number; // points averaged per centerpoint, odd (1 = no smoothing)
  // every engine
  tol?: number; // ink the shape may gain where a sample is dropped, as a fraction of local r
  // Samples behind the pen held out of stage 3b, so a node is only ever
  // committed once this many samples sit behind it and laid ink stops moving.
  // MUST be 0 for a finished stroke -- see `simplify` and `fitCurve`.
  liveBuffer?: number;
  // `fit` -- see `FitOptions`
  fitCornerAngle?: number; // deg; a turn sharper than this over fitCornerDist is a corner
  fitCornerDist?: number; // px either side of a point that turn, tangent and slope are measured over
  fitHorizon?: number; // px a segment may span before it commits regardless; bounds live movement
  // `sampled`
  sampleStep?: number; // px along the centerline between outline contacts
  // `greedy`
  outlineTol?: number; // px the drawn outline may stray from the pen envelope
  // `tension` and `classic` -- the polyline simplify that stands in for the fit
  simplify?: boolean; // run it at all; off leaves every distinct point in
  simplifyMaxMs?: number; // longest stretch of the stroke one simplified segment may span
  // `tension` -- see `TensionOptions`; angles in degrees so they read on a slider
  cornerScale?: number;
  maxTurn?: number; // deg
  weightedAngle?: boolean;
  // `tension` and `fit`
  cornerPoint?: boolean; // inside of a bend: one contact where the two tangent lines cross
};

// `compressTol` is small on purpose: it is a shape tolerance, and `posDigits` is
// the file-size lever.
export const COMPRESS_DEFAULTS: Required<CompressOptions> = {
  compressTol: 0.25,
};

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  engine: "fit",
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  smoothWindow: 3,
  tol: 0.1,
  liveBuffer: 0,
  fitCornerAngle: 60,
  fitCornerDist: 6,
  fitHorizon: 24,
  sampleStep: 6,
  outlineTol: 0.25,
  simplify: true,
  simplifyMaxMs: 250,
  cornerScale: 1.4,
  maxTurn: 150,
  weightedAngle: true,
  cornerPoint: false,
};

// The centerline as each stage left it, oldest first. See `pipeline.ts` --
// the keys are in pipeline order.
export type CenterlineStages = {
  raw: Point3[];
  snapped: Point3[]; // stage 0 -- on the grid a `.scrawl` is written to
  radius: Point4[];
  smoothed: Point4[];
  distinct: Point4[]; // stage 3a -- what every engine starts from
};

export type StrokeStages = CenterlineStages & {
  // stage 3b -- what the engine kept. Under `fit` these are `FitNode`s, with
  // the tangents the outline needs; the polyline engines keep plain samples.
  nodes: Point4[];
};

export type StrokeRender = {
  stages: StrokeStages;
  outline: Contact[]; // stage 4 -- closed loop
  spine: string; // the centerline path as the engine reads its nodes; a debug aid
};
