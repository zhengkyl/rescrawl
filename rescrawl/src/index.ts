// wide raw input -> narrow -> narrow -> narrow -> widen -> widen -> widen -> widen

export { clamp11, dist, lerp, TAU, wrapPi } from "./math";
export { outlineOf, renderStages, renderStroke, runPipeline } from "./pipeline";
export { toRadiiPointsFromRawSamples } from "./radius";
export { COMPRESS_DEFAULTS, RENDER_DEFAULTS } from "./types";
export type {
  CompressOptions,
  Contact,
  Point2,
  Point3,
  Point4,
  RenderOptions,
  Sample,
  StrokeRender,
  StrokeStages,
} from "./types";
