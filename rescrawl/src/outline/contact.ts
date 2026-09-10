import { TAU } from "../math.ts";
import type { Point2, Point4 } from "../math.ts";

// --- what every outline is made of ---
//
// y increases downwards, so the unit circle is flipped vertically and angles
// increase clockwise. A contact is a point on a disc's rim with the outline's
// forward tangent there, which is perpendicular to the radius.

// `m`, when present, is the full Hermite tangent length at this contact, used
// on both sides of it. `mIn` / `mOut` override it for the cubic arriving at /
// leaving this contact, where the two differ. Absent, `outlinePath` falls back
// to its chord rule for that side.
export type OutlineNode = Point2 & {
  tx: number;
  ty: number;
  m?: number;
  mIn?: number;
  mOut?: number;
};

export function contactAt(c: Point4, a: number): OutlineNode {
  const cos = Math.cos(a),
    sin = Math.sin(a);
  return { x: c.x + c.r * cos, y: c.y + c.r * sin, tx: -sin, ty: cos };
}

/** Converts to [0, TAU) */
export function wrapZeroTau(a: number) {
  return a - TAU * Math.floor(a / TAU);
}

// Math.PI (2 cubic approx) has 1.8% error
// for reference, 3 segment is 0.15%, 4 segment is 0.027%
export const MAX_ANGLE_PER_BEZIER = Math.PI / 2;

// A stroke of one disc: the full circle.
export function discLoop(p: Point4): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let k = 0; k < TAU / MAX_ANGLE_PER_BEZIER; k++) {
    out.push(contactAt(p, k * MAX_ANGLE_PER_BEZIER));
  }
  return out;
}
