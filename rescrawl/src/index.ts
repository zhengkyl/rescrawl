// wide raw input -> narrow -> narrow -> narrow -> widen -> widen -> widen -> widen

export type { CenterlineNode } from "./centerline/fit.ts";
export { holdEndUntil, retime, type RetimeOptions } from "./centerline/retime.ts";
export type { Sample, SmoothOptions } from "./centerline/smooth.ts";
export {
  chordRule,
  clamp11,
  dist,
  lerp,
  quadControl,
  TAU,
  wrapPi,
  type Point2,
  type Point3,
  type Point4,
} from "./math.ts";
export type { OutlineNode } from "./outline/contact.ts";
export { toOutlineGreedy, type GreedyOptions } from "./outline/greedy.ts";
export { toOutlineNodeFit, type NodeFitOptions } from "./outline/node-fit.ts";
export { toOutlineNodeQuad, type NodeQuadOptions } from "./outline/node-quad.ts";
export {
  centerlineStages,
  fitCenterline,
  OUTLINES,
  RENDER_DEFAULTS,
  renderStroke,
  toDrawingPx,
  type CenterlineStages,
  type OutlineKind,
  type OutlineOptions,
  type RenderOptions,
  type StrokeRender,
  type StrokeStages,
} from "./pipeline.ts";
export { toRadius, type RadiusOptions } from "./thickness/radius.ts";
