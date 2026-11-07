import { CENTERLINE_DEFAULTS, type CenterlineOptions, type CubicNode, type Point3 } from "rescrawl";
import { type CornerTrace, markCorners } from "rescrawl/centerline/corner";
import { fitHand } from "rescrawl/centerline/fit";
import { fixBadTimesteps, holdEndUntil } from "rescrawl/centerline/retime";
import { type Sample, toSmoothSamples } from "rescrawl/centerline/smooth";
import { varyThickness } from "rescrawl/thickness/radius";

export type CenterlineStages = {
  raw: Point3[];
  smoothed: Sample[];
  retimed: Sample[];
  radius: Sample[];
  nodes: CubicNode[];
};

const copy = (samples: Sample[]) => samples.map((p) => ({ ...p }));

export function centerlineStages(
  points: Point3[],
  options: CenterlineOptions,
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

  const tOpen = options.tOpen;
  const open = typeof tOpen === "number";
  const raw = open ? holdEndUntil(points, tOpen) : points;

  if (raw.length === 0) {
    return { raw, smoothed: [], retimed: [], radius: [], nodes: [] };
  }

  const { samples, arcLengths } = toSmoothSamples(raw, d);
  const smoothed = copy(samples);
  fixBadTimesteps(samples, arcLengths, d);
  const retimed = copy(samples);
  varyThickness(samples, arcLengths, d);
  markCorners(samples, arcLengths, d, trace);

  return {
    raw,
    smoothed,
    retimed,
    radius: samples,
    nodes: fitHand(samples, arcLengths, { ...d, open }),
  };
}
