import { toRadiiPointsFromRawSamples } from "./radius";
import { toOutline, toOutlineTension, type TensionOptions } from "./outline";
import { dropContained, simplify } from "./simplify";
import { smoothPositions } from "./smooth";
import type { Contact, Point3, RenderOptions, StrokeRender, StrokeStages } from "./types";
import { RENDER_DEFAULTS } from "./types";

// The whole centerline pipeline, in order, in one place.
//
//   raw         pointer samples exactly as recorded: position + timestamp
//   snapped     stage 0 -- quantized onto the grid a `.scrawl` is written to
//   radius      stage 1 -- + a radius per point, derived from pen speed
//   smoothed    stage 2 -- positions run through a moving average
//   distinct    stage 3a -- circles swallowed by a neighbour dropped
//   simplified  stage 3b -- circles already covered by the tube dropped


const ONLY_RADIUS = true;

export function runPipeline(points: Point3[], o: Required<RenderOptions>): StrokeStages {
  const snapped = points;
  const radius = toRadiiPointsFromRawSamples(snapped, o);
  const smoothed = ONLY_RADIUS ? radius : smoothPositions(radius, o); // should x,y smoothing come before or after adding dwell leave points?

  const distinct = dropContained(smoothed);
  const simplified = ONLY_RADIUS ? distinct : simplify(distinct, o.simplifyTol);
  return { raw: points, snapped, radius, smoothed, distinct, simplified };
}

const DEG = Math.PI / 180;

export function tensionOf(o: Required<RenderOptions>): TensionOptions {
  return {
    cornerAngle: o.cornerAngle * DEG,
    cornerScale: o.cornerScale,
    maxTurn: o.maxTurn * DEG,
    weighted: o.weightedAngle,
    cornerPoint: o.cornerPoint,
  };
}

// `tensionOutline` picks which construction wraps the points.
export function outlineOf(stages: StrokeStages, o: Required<RenderOptions>): Contact[] {
  return o.tensionOutline
    ? toOutlineTension(stages.simplified, tensionOf(o))
    : toOutline(stages.simplified);
}

export function renderStroke(stroke: Point3[], options: RenderOptions = {}): StrokeRender {
  if (stroke.length === 0) return { centerline: [], outline: [] };
  const o = { ...RENDER_DEFAULTS, ...options };
  const stages = runPipeline(stroke, o);
  return { centerline: stages.simplified, outline: outlineOf(stages, o) };
}

// The same render, plus every intermediate centerline it passed through. Same
// code path as `renderStroke` -- the stages are what that call already built.
export function renderStages(
  stroke: Point3[],
  options: RenderOptions = {},
): StrokeRender & { stages: StrokeStages } {
  const empty: StrokeStages = {
    raw: [], snapped: [], radius: [], smoothed: [], distinct: [], simplified: [],
  };
  if (stroke.length === 0) return { centerline: [], outline: [], stages: empty };
  const o = { ...RENDER_DEFAULTS, ...options };
  const stages = runPipeline(stroke, o);
  return { centerline: stages.simplified, outline: outlineOf(stages, o), stages };
}
