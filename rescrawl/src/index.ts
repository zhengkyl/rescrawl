// wide raw input -> narrow -> narrow -> narrow -> widen -> widen -> widen -> widen

export { type CenterlineNode, fitCurve, type FitOptions } from "./centerline/fit.ts";
export { dropContained } from "./centerline/simplify.ts";
export type { SmoothOptions } from "./centerline/smooth.ts";
export { ENGINES, type Engine, type OutlineEngine, type Shape } from "./engine.ts";
export {
  chordRule,
  clamp11,
  dist,
  lerp,
  type Point2,
  type Point3,
  type Point4,
  TAU,
  wrapPi,
} from "./math.ts";
export type { OutlineNode } from "./outline/contact.ts";
export { greedyEngine, type GreedyOptions, toOutlineGreedy } from "./outline/greedy.ts";
export {
  type CenterlineStages,
  centerlineStages,
  RENDER_DEFAULTS,
  type RenderOptions,
  renderStroke,
  type StrokeRender,
  type StrokeStages,
} from "./pipeline.ts";
export { type RadiusOptions, toRadiiPointsFromRawSamples } from "./thickness/radius.ts";
