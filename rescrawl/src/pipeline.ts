import { ENGINES } from "./engine.ts";
import { toRadiiPointsFromRawSamples } from "./radius.ts";
import { dropContained } from "./simplify.ts";
import { smoothPositions } from "./smooth.ts";
import type { CenterlineStages, Point3, RenderOptions, StrokeRender } from "./types.ts";
import { RENDER_DEFAULTS } from "./types.ts";

// The whole pipeline, in order, in one place.
//
//   raw         pointer samples exactly as recorded: position + timestamp
//   radius      stage 1 -- + a radius per point, derived from pen speed
//   smoothed    stage 2 -- positions run through a moving average
//   distinct    stage 3 -- circles swallowed by a neighbour dropped
//   nodes       stage 4 -- what the engine kept of the centerline
//   outline     stage 4 -- the closed loop it wrapped around them
//
// Stage 4 is one call on the engine named by `o.engine`: which samples survive
// as nodes and how the outline is built are the same decision, so they are not
// split into two numbers. See `engine.ts`.

// Stages 1 to 3: the centerline every engine starts from. Split out so a
// consumer that brings its own outline (the website's perfect-freehand mode)
// can take the discs without running an engine it does not want.
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
