import { TAU } from "../math.ts";
import type { Point2 } from "../math.ts";

type Disc = Point2 & { r: number };

// --- what every outline is made of ---
//
// y increases downwards, so the unit circle is flipped vertically and angles
// increase clockwise. A contact is a point on a disc's rim with the outline's
// forward tangent there, which is perpendicular to the radius.

// A point and the direction the loop leaves it in; how far the curve between
// two of them reaches is the serializer's chord rule, not stored here.
export type OutlineNode = Point2 & {
  tx: number;
  ty: number;
};

export function contactAt(c: Disc, a: number): OutlineNode {
  const cos = Math.cos(a),
    sin = Math.sin(a);
  return { x: c.x + c.r * cos, y: c.y + c.r * sin, tx: -sin, ty: cos };
}

/** Converts to [0, TAU) */
export function wrapZeroTau(a: number) {
  return a - TAU * Math.floor(a / TAU);
}
