import { ENGINES } from "./engine.ts";
import { toRadiiPointsFromRawSamples } from "./radius.ts";
import { dropContained } from "./simplify.ts";
import { smoothPositions } from "./smooth.ts";
import type { CenterlineStages, Point3, RenderOptions, StrokeRender } from "./types.ts";
import { RENDER_DEFAULTS } from "./types.ts";

//   raw       pointer samples as recorded
//   radius    stage 1 -- a radius per point, from pen speed
//   smoothed  stage 2 -- positions through a moving average
//   distinct  stage 3 -- circles swallowed by a neighbour dropped
//   nodes     stage 4 -- what the engine kept, and the outline around them

// Split out so a consumer that brings its own outline (the website's
// perfect-freehand mode) can take the discs without running an engine.
export function centerlineStages(stroke: Point3[], options: RenderOptions = {}): CenterlineStages {
  const o = { ...RENDER_DEFAULTS, ...options };
  const radius = toRadiiPointsFromRawSamples(stroke, o);
  const smoothed = smoothPositions(radius, o);
  const distinct = dropContained(smoothed);
  return { raw: stroke, radius, smoothed, distinct };
}

export function renderStroke(stroke: Point3[], options: RenderOptions = {}): StrokeRender {
  const o = { ...RENDER_DEFAULTS, ...options };
  const stages = centerlineStages(stroke, o);
  const { nodes, outline } = ENGINES[o.engine](stages.distinct, o);
  return { stages: { ...stages, nodes }, outline };
}
