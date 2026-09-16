import { type CenterlineNode, fitCurve, type FitOptions } from "./centerline/fit.ts";
import { fitQuadratic } from "./centerline/quadratic.ts";
import { dropContained, smoothPositions, type SmoothOptions } from "./centerline/smooth.ts";
import type { Point3, Point4 } from "./math.ts";
import type { OutlineNode } from "./outline/contact.ts";
import { type GreedyOptions, toOutlineGreedy } from "./outline/greedy.ts";
import { type NodeFitOptions, toOutlineNodeFit } from "./outline/node-fit.ts";
import { type NodeQuadOptions, toOutlineNodeQuad } from "./outline/node-quad.ts";
import { toRadiiPointsFromRawSamples, type RadiusOptions } from "./thickness/radius.ts";

//   raw       pointer samples as recorded
//   radius    stage 1 -- a radius per point, from pen speed
//   smoothed  stage 2 -- positions through a moving average
//   distinct  stage 3 -- circles swallowed by a neighbour dropped
//   nodes     stage 4 -- the fit: which discs survive, and the tangents through them
//   outline   stage 5 -- the closed loop laid around them

// Stage 4, the fit. To try a variant, write another
// `(pts, o) => CenterlineNode[]` under `centerline/` and add it here; it is
// then selectable everywhere a fit is named, against every outline below.
// Copy an existing one rather than sharing its internals, so the two can be
// compared without moving each other.
export type FitKind = "cubic" | "quadratic";
export const FITS: Record<FitKind, (pts: Point4[], o: Required<FitOptions>) => CenterlineNode[]> = {
  cubic: fitCurve,
  quadratic: fitQuadratic,
};

// Stage 5, the outline: where the contacts go on the envelope the nodes sweep.
// Same deal -- one file each, copied rather than shared.
export type OutlineKind = "greedy" | "node-fit" | "node-quad";
export type OutlineOptions = GreedyOptions & NodeFitOptions & NodeQuadOptions;
export const OUTLINES: Record<
  OutlineKind,
  (ns: CenterlineNode[], o: Required<OutlineOptions>) => OutlineNode[]
> = {
  greedy: toOutlineGreedy,
  "node-fit": toOutlineNodeFit,
  "node-quad": toOutlineNodeQuad,
};

// Every length is a multiple of `maxWidth` rather than a pixel count,
// so a drawing scaled up with a pen scaled to match fits identically.
export type RenderOptions = { fit?: FitKind; outline?: OutlineKind } & RadiusOptions &
  SmoothOptions &
  FitOptions &
  OutlineOptions;

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  fit: "cubic",
  outline: "greedy",
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
  nodeTol: 0.03125,
  nodeDepth: 6,
  quadTol: 0.03125,
  quadDepth: 6,
};

// The centerline as each stage left it, oldest first; the keys are in
// pipeline order.
export type CenterlineStages = {
  raw: Point3[];
  radius: Point4[]; // stage 1
  smoothed: Point4[]; // stage 2
  distinct: Point4[]; // stage 3 -- what every fit starts from
};

export type StrokeStages = CenterlineStages & {
  nodes: CenterlineNode[]; // stage 4 -- what the fit kept, and the tangents there
};

export type StrokeRender = {
  stages: StrokeStages;
  outline: OutlineNode[]; // stage 5 -- closed loop
};

// Split out so a consumer that brings its own outline (the website's
// perfect-freehand mode) can take the discs without fitting them.
export function centerlineStages(points: Point3[], options: RenderOptions = {}): CenterlineStages {
  const o = { ...RENDER_DEFAULTS, ...options };
  const radius = toRadiiPointsFromRawSamples(points, o);
  const smoothed = smoothPositions(radius, o);
  const distinct = dropContained(smoothed);
  return { raw: points, radius, smoothed, distinct };
}

export function renderStroke(stroke: Point3[], options: RenderOptions = {}): StrokeRender {
  const o = { ...RENDER_DEFAULTS, ...options };
  const stages = centerlineStages(stroke, o);
  // `node-fit` and `node-quad` build no corner: they need one tangent per node,
  // so corner detection is off for them. The turn a corner is judged on lives
  // in [0, PI], so a threshold past 180 degrees can never be met.
  const fitOptions = o.outline === "greedy" ? o : { ...o, fitCornerAngle: 181 };
  const nodes = FITS[o.fit](stages.distinct, fitOptions);
  return { stages: { ...stages, nodes }, outline: OUTLINES[o.outline](nodes, o) };
}
