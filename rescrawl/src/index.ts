// wide raw input -> narrow -> narrow -> narrow -> widen -> widen -> widen -> widen

export { type CenterlineNode, fitCurve, type FitOptions } from "./centerline/fit.ts";
export { fitQuadratic } from "./centerline/quadratic.ts";
export type { SmoothOptions } from "./centerline/smooth.ts";
export {
  chordRule,
  clamp11,
  dist,
  lerp,
  type Point2,
  type Point3,
  type Point4,
  TAU,
  quadControl,
  wrapPi,
} from "./math.ts";
export type { OutlineNode } from "./outline/contact.ts";
export { type GreedyOptions, toOutlineGreedy } from "./outline/greedy.ts";
export { type NodeFitOptions, toOutlineNodeFit } from "./outline/node-fit.ts";
export { type NodeQuadOptions, toOutlineNodeQuad } from "./outline/node-quad.ts";
export {
  type CenterlineStages,
  centerlineStages,
  type FitKind,
  FITS,
  type OutlineKind,
  type OutlineOptions,
  OUTLINES,
  RENDER_DEFAULTS,
  type RenderOptions,
  renderStroke,
  type StrokeRender,
  type StrokeStages,
} from "./pipeline.ts";
export { type RadiusOptions, toRadiiPointsFromRawSamples } from "./thickness/radius.ts";
