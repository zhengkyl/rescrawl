import { ENGINES } from "./engine";
import { toRadiiPointsFromRawSamples } from "./radius";
import { dropContained } from "./simplify";
import type { CenterlineStages, Point3, RenderOptions, StrokeRender } from "./types";
import { RENDER_DEFAULTS } from "./types";

// The whole pipeline, in order, in one place.
//
//   raw         pointer samples exactly as recorded: position + timestamp
//   snapped     stage 0 -- quantized onto the grid a `.scrawl` is written to
//   radius      stage 1 -- + a radius per point, derived from pen speed
//   smoothed    stage 2 -- positions run through a moving average
//   distinct    stage 3a -- circles swallowed by a neighbour dropped
//   nodes       stage 3b -- what the engine kept of the centerline
//   outline     stage 4  -- the closed loop the engine wrapped around them
//
// Stages 3b and 4 are one call on the engine named by `o.engine`; see
// `engine.ts`. While a stroke is being drawn, `liveBuffer` holds the last few
// samples back from that call: nothing there is committed until more samples
// arrive behind it. It is 0 for a finished stroke.

// Stages 0 to 3a: the centerline every engine starts from. Split out so a
// consumer that brings its own outline (the website's perfect-freehand mode)
// can take the discs without running an engine it does not want.
export function centerlineStages(stroke: Point3[], options: RenderOptions = {}): CenterlineStages {
  const o = { ...RENDER_DEFAULTS, ...options };
  const snapped = stroke;
  const radius = toRadiiPointsFromRawSamples(snapped, o);
  // const smoothed = smoothPositions(radius, o); // should x,y smoothing come before or after adding dwell leave points?
  const smoothed = radius;
  const distinct = dropContained(smoothed);
  return { raw: stroke, snapped, radius, smoothed, distinct };
}

export function renderStroke(stroke: Point3[], options: RenderOptions = {}): StrokeRender {
  const o = { ...RENDER_DEFAULTS, ...options };
  const pre = centerlineStages(stroke, o);
  const { nodes, outline, spine } = ENGINES[o.engine](pre.distinct, o);
  return { stages: { ...pre, nodes }, outline, spine };
}
