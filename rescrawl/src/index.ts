// wide raw input -> narrow -> narrow -> narrow -> widen -> widen -> widen -> widen

export { clamp11, dist, lerp, TAU, wrapPi } from "./math";
export { TENSION_DEFAULTS, toOutline, toOutlineTension, type TensionOptions } from "./outline";
export { outlineOf, renderStages, renderStroke, runPipeline, tensionOf } from "./pipeline";
export { toRadiiPointsFromRawSamples } from "./radius";
export { COMPRESS_DEFAULTS, RENDER_DEFAULTS } from "./types";
export type {
  CompressOptions,
  Contact,
  Point2,
  Point3,
  Point4,
  RenderOptions,
  StrokeRender,
  StrokeStages,
} from "./types";
