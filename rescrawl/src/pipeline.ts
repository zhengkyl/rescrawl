import type { CenterlineNode, FitOptions } from "./centerline/fit.ts";
import { dropContained } from "./centerline/simplify.ts";
import { smoothPositions, type SmoothOptions } from "./centerline/smooth.ts";
import { ENGINES, type OutlineEngine } from "./engine.ts";
import type { Point3, Point4 } from "./math.ts";
import type { OutlineNode } from "./outline/contact.ts";
import type { GreedyOptions } from "./outline/greedy.ts";
import { toRadiiPointsFromRawSamples, type RadiusOptions } from "./thickness/radius.ts";

//   raw       pointer samples as recorded
//   radius    stage 1 -- a radius per point, from pen speed
//   smoothed  stage 2 -- positions through a moving average
//   distinct  stage 3 -- circles swallowed by a neighbour dropped
//   nodes     stage 4 -- what the engine kept, and the outline around them

// Every length is a multiple of `maxWidth` rather than a pixel count,
// so a drawing scaled up with a pen scaled to match fits identically.
export type RenderOptions = { engine?: OutlineEngine } & RadiusOptions &
  SmoothOptions &
  FitOptions &
  GreedyOptions;

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  engine: "greedy",
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  smoothWindow: 0,
  fitTol: 0.1,
  fitCornerAngle: 60,
  fitWindow: 0.75,
  fitHorizon: 3,
  outlineTol: 0.03125,
  outlineHorizon: 3,
};

// The centerline as each stage left it, oldest first; the keys are in
// pipeline order.
export type CenterlineStages = {
  raw: Point3[];
  radius: Point4[]; // stage 1
  smoothed: Point4[]; // stage 2
  distinct: Point4[]; // stage 3 -- what every engine starts from
};

export type StrokeStages = CenterlineStages & {
  // stage 4 -- what the engine kept, carrying the tangents the outline was
  // built on. Every engine runs `fitCurve`, so these are always `CenterlineNode`s.
  nodes: CenterlineNode[];
};

export type StrokeRender = {
  stages: StrokeStages;
  outline: OutlineNode[]; // stage 4 -- closed loop
};

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
  const { centerline: nodes, outline } = ENGINES[o.engine](stages.distinct, o);
  return { stages: { ...stages, nodes }, outline };
}
