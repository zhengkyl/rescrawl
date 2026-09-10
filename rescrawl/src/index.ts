// wide raw input -> narrow -> narrow -> narrow -> widen -> widen -> widen -> widen

export { chordRule, clamp11, dist, lerp, TAU, wrapPi } from "./math.ts";
export { ENGINES, type Engine, type Shape } from "./engine.ts";
export { fitCurve } from "./fit.ts";
export { greedyEngine, toOutlineGreedy } from "./greedy.ts";
export { centerlineStages, renderStroke } from "./pipeline.ts";
export { toRadiiPointsFromRawSamples } from "./radius.ts";
export { dropContained } from "./simplify.ts";
export { RENDER_DEFAULTS } from "./types.ts";
export type {
  CenterlineStages,
  Contact,
  FitNode,
  OutlineEngine,
  Point2,
  Point3,
  Point4,
  RenderOptions,
  StrokeRender,
  StrokeStages,
} from "./types.ts";
