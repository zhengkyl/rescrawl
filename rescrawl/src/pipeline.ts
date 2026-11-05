import { type CornerOptions, type CornerPoint, markCorners } from "./centerline/corner.ts";
import { type CenterlineNode, fitHand, type HandOptions } from "./centerline/fit.ts";
import { retime, type RetimeOptions } from "./centerline/retime.ts";
import { type Sample, type SmoothOptions, toSmoothSamples } from "./centerline/smooth.ts";
import type { Point3 } from "./math.ts";
import type { OutlineNode } from "./outline/contact.ts";
import { type GreedyOptions, toOutlineGreedy } from "./outline/greedy.ts";
import { type NodeFitOptions, toOutlineNodeFit } from "./outline/node-fit.ts";
import { type NodeQuadOptions, toOutlineNodeQuad } from "./outline/node-quad.ts";
import { type RadiusOptions, toRadius } from "./thickness/radius.ts";

// Stage 4, the outline: where the contacts go on the envelope the nodes sweep.
// One file each, copied rather than shared.
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

// Drawing at 2x zoom is drawing with a 2x pen: the same hand motion lays the
// same ink on screen. So the pen is in drawing px, and everything about the
// hand or the eye is in screen px, at the `zoom` the stroke was drawn at --
// jitter, how far a sample moves, how far the ink may stray, how fast the pen
// goes. Units, option by option:
//
//   drawing px      minWidth, maxWidth
//   screen px       minMove, cornerArm, smoothWindow, handTol, outlineTol,
//                   outlineHorizon, nodeTol, quadTol
//   screen px/ms    thinSpeed
//   ms              framePeriod, widthLag
//
// `zoom` is the drawing's, never the view's: from the view, zooming would
// refit and refilter every stroke already drawn.
//
// `corners` switches its stage on; off, it passes points through.
export type RenderOptions = {
  outline?: OutlineKind;
  zoom?: number; // screen px per drawing px, as the stroke was drawn
  corners?: boolean;
} & RetimeOptions &
  RadiusOptions &
  CornerOptions &
  SmoothOptions &
  HandOptions &
  OutlineOptions;

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  outline: "greedy",
  zoom: 1,
  framePeriod: 1000 / 60,
  minMove: 1.5,
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  corners: false,
  cornerArm: 4,
  cornerTurn: 30,
  smoothWindow: 0,
  handTol: 0.8,
  reparam: 2,
  holdBack: true,
  outlineTol: 0.25,
  outlineHorizon: 24,
  nodeTol: 0.25,
  nodeDepth: 6,
  quadTol: 0.25,
  quadDepth: 6,
};

// The options as the stages read them, every length in drawing px: screen px
// and screen px/ms over `zoom`. The one place `zoom` is read.
export function toDrawingPx(o: Required<RenderOptions>): Required<RenderOptions> {
  const px = 1 / o.zoom;
  return {
    ...o,
    minMove: o.minMove * px,
    thinSpeed: o.thinSpeed * px,
    cornerArm: o.cornerArm * px,
    smoothWindow: o.smoothWindow * px,
    handTol: o.handTol * px,
    outlineTol: o.outlineTol * px,
    outlineHorizon: o.outlineHorizon * px,
    nodeTol: o.nodeTol * px,
    quadTol: o.quadTol * px,
  };
}

// The centerline as each stage left it, oldest first; the keys are in
// pipeline order.
export type CenterlineStages = {
  raw: Point3[];
  prefixSum: Float64Array; // arc length to each point of every stage from `smoothed` on
  smoothed: Sample[]; // stage 0
  retimed: Sample[]; // stage 1
  radius: CornerPoint[]; // stage 2 -- what every fit starts from
};

export type StrokeStages = CenterlineStages & {
  nodes: CenterlineNode[]; // stage 3 -- what the fit kept, and the tangents there
};

export type StrokeRender = {
  stages: StrokeStages;
  outline: OutlineNode[]; // stage 4 -- closed loop
};

// Stages 0-2 and stage 3, given options already in drawing px.
function stagesIn(points: Point3[], o: Required<RenderOptions>): CenterlineStages {
  const { points: smoothed, prefixSum } = toSmoothSamples(points, o);
  const retimed = retime(smoothed, prefixSum, o);
  // Corners are only flagged -- no point moves -- so they share stage 2.
  const radii = toRadius(retimed, prefixSum, o);
  const radius = o.corners ? markCorners(radii, prefixSum, o) : radii;
  return { raw: points, prefixSum, smoothed, retimed, radius };
}
// `open`: the pen is still down, so more samples are coming.
const fitIn = (stages: CenterlineStages, o: Required<RenderOptions>, open: boolean) =>
  fitHand(stages.radius, stages.prefixSum, { ...o, open: o.holdBack && open });

// Split out so a consumer that brings its own outline (the website's
// perfect-freehand mode) can take the discs without fitting them.
export function centerlineStages(points: Point3[], options: RenderOptions = {}): CenterlineStages {
  return stagesIn(points, toDrawingPx({ ...RENDER_DEFAULTS, ...options }));
}

// Stage 3 alone, for a consumer that wants the nodes without an outline.
export function fitCenterline(
  stages: CenterlineStages,
  options: RenderOptions = {},
  open = false,
): CenterlineNode[] {
  return fitIn(stages, toDrawingPx({ ...RENDER_DEFAULTS, ...options }), open);
}

export function renderStroke(
  stroke: Point3[],
  options: RenderOptions = {},
  open = false,
): StrokeRender {
  const opts = toDrawingPx({ ...RENDER_DEFAULTS, ...options });
  // `node-fit` and `node-quad` build no corner: they need one tangent per node,
  // so the corners stage is off for them.
  const o = opts.outline === "greedy" ? opts : { ...opts, corners: false };
  const stages = stagesIn(stroke, o);
  const nodes = fitIn(stages, o, open);
  return { stages: { ...stages, nodes }, outline: OUTLINES[o.outline](nodes, o) };
}
