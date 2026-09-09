// wide raw input -> narrow -> narrow -> narrow -> widen -> widen -> widen -> widen

export { chordRule, clamp11, dist, lerp, TAU, wrapPi } from "./math";
export { ENGINES, type Engine, type Shape } from "./engine";
export { fitCurve, fitEngine, fitOptions, toOutlineFit, type FitOptions } from "./fit";
export { greedyEngine, toOutlineGreedy, type GreedyOptions } from "./greedy";
export { sampledEngine, toOutlineSampled, type SampledOptions } from "./sampled";
export { tensionEngine, tensionOptions, toOutlineTension, type TensionOptions } from "./tension";
export { classicEngine, toOutline } from "./classic";
export { centerlineStages, renderStroke } from "./pipeline";
export { toRadiiPointsFromRawSamples } from "./radius";
export { dropContained, simplify } from "./simplify";
export { COMPRESS_DEFAULTS, RENDER_DEFAULTS } from "./types";
export type {
  CenterlineStages,
  CompressOptions,
  Contact,
  FitNode,
  OutlineEngine,
  Point2,
  Point3,
  Point4,
  RenderOptions,
  StrokeRender,
  StrokeStages,
} from "./types";
