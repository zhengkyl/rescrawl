import { TAU } from "./math";
import type { Contact, Point4 } from "./types";

// --- what every outline is made of ---
//
// y increases downwards, so the unit circle is flipped vertically and angles
// increase clockwise. A contact is a point on a disc's rim with the outline's
// forward tangent there, which is perpendicular to the radius.

export function contactAt(c: Point4, a: number): Contact {
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

// A cap that is exactly a half turn lands a hair over PI as often as not, and
// would flip between one and two cubics with the noise.
export const ARC_EPS = 1e-9;

// The angles of an arc of the disc from `from` to `to`, increasing, in as few
// steps of at most MAX_ANGLE_PER_BEZIER as it takes; both ends included. A
// zero span is one angle.
export function arcAngles(from: number, to: number): number[] {
  const span = wrapZeroTau(to - from);
  const segments = Math.ceil(span / MAX_ANGLE_PER_BEZIER - ARC_EPS);
  const out: number[] = [];
  for (let k = 0; k <= segments; k++) out.push(from + (span * k) / segments);
  return out;
}

// A stroke of one disc: the full circle.
export function discLoop(p: Point4): Contact[] {
  const out: Contact[] = [];
  for (let k = 0; k < TAU / MAX_ANGLE_PER_BEZIER; k++) {
    out.push(contactAt(p, k * MAX_ANGLE_PER_BEZIER));
  }
  return out;
}
