import { type CornerOptions, markCorners } from "./centerline/corner.ts";
import { type CubicNode, fitHand, type HandOptions } from "./centerline/fit.ts";
import { fixBadTimesteps, holdEndUntil, type RetimeOptions } from "./centerline/retime.ts";
import { type SmoothOptions, toSmoothSamples } from "./centerline/smooth.ts";
import type { Point3 } from "./math.ts";
import { type RadiusOptions, varyThickness } from "./thickness/radius.ts";

export function getCenterline(
  prev: Centerline,
  points: Point3[],
  options: CenterlineOptions,
): Centerline {
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
  if (open) points = holdEndUntil(points, tOpen);

  if (points.length === 0) {
    return { curves: [], settled: 0 };
  }

  const { samples, arcLengths } = toSmoothSamples(points, d);
  fixBadTimesteps(samples, arcLengths, d);
  varyThickness(samples, arcLengths, d);
  markCorners(samples, arcLengths, d);

  return {
    curves: fitHand(samples, arcLengths, { ...d, open }),
    settled: 0,
  };
}

// lengths in screen px at `zoom`, except minWidth and maxWidth
export type CenterlineOptions = SmoothOptions &
  RetimeOptions &
  RadiusOptions &
  CornerOptions &
  HandOptions & {
    zoom?: number;
    tOpen?: number | null;
  };

export const CENTERLINE_DEFAULTS: Required<Omit<CenterlineOptions, "tOpen">> = {
  zoom: 1,
  smoothWindow: 0,
  minMove: 1.5,
  framePeriod: 1000 / 60,
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  cornerArm: 4,
  cornerTurn: 30,
  handTol: 0.8,
  reparam: 2,
};

export type Centerline = {
  curves: CubicNode[];
  settled: number;
};
