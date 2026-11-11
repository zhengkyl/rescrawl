import { CENTERLINE_DEFAULTS, type CenterlineOptions, type CubicNode, type Point3 } from "rescrawl";
import { type CornerTrace, markCorners } from "rescrawl/centerline/corner";
import { fitHand } from "rescrawl/centerline/fit";
import { retimeBadTimesteps } from "rescrawl/centerline/retime";
import { type Sample, toSmoothSamples } from "rescrawl/centerline/smooth";
import { varyThickness } from "rescrawl/thickness/radius";
import { stableSamples } from "rescrawl/Centerline";

export type CenterlineStages = {
  raw: Point3[];
  smoothed: Sample[];
  retimed: Sample[];
  radius: Sample[];
  nodes: CubicNode[];
};

const copy = (samples: Sample[]) => samples.map((p) => ({ ...p }));

// Centerline.curves(tOpen) in one pass, keeping each stage
export function centerlineStages(
  points: Point3[],
  options: CenterlineOptions,
  tOpen?: number,
  trace?: CornerTrace[],
): CenterlineStages {
  const o = { ...CENTERLINE_DEFAULTS, ...options };
  const px = 1 / o.zoom;
  const d = {
    ...o,
    minMove: o.minMove * px,
    thinSpeed: o.thinSpeed * px,
    cornerArm: o.cornerArm * px,
    smoothWindow: o.smoothWindow * px,
    handTol: o.handTol * px,
  };

  if (points.length === 0) {
    return { raw: points, smoothed: [], retimed: [], radius: [], nodes: [] };
  }

  const { samples, arcLengths, placed } = toSmoothSamples(points, d);
  const stable =
    tOpen == null ? samples.length : stableSamples(samples, arcLengths, placed, d.cornerArm);
  const smoothed = copy(samples);
  retimeBadTimesteps(samples, arcLengths, d);
  if (tOpen != null) {
    const tip = samples[samples.length - 1];
    tip.tEnd = Math.max(tip.tEnd, tOpen);
  }
  const retimed = copy(samples);
  varyThickness(samples, arcLengths, d);
  markCorners(samples, arcLengths, d, trace);

  const { body, tail } = fitHand(samples, arcLengths, d, 0, stable);
  return {
    raw: points,
    smoothed,
    retimed,
    radius: samples,
    nodes: [...body, ...tail],
  };
}
