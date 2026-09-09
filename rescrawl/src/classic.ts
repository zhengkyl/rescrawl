import { arcAngles, contactAt, discLoop, wrapZeroTau } from "./contact";
import type { Shape } from "./engine";
import { clamp11, dist } from "./math";
import { simplify } from "./simplify";
import { centerlinePath } from "./svg";
import type { Contact, Point4, RenderOptions } from "./types";

// --- the classic engine: polyline nodes, tangent sweep outline ---
//
// The oldest construction, kept for comparison. Stage 3b is the tube
// simplify (`polylineNodes`); each node then gets the two contacts its
// neighbouring tangent lines put on it, with an arc between them on the
// outside of a bend and the crossed pair on the inside.

const MIN_EXTERIOR_ANGLE_PER_BEZIER = Math.PI / 4;
const MIN_INTERIOR_ANGLE_PER_BEZIER = Math.PI / 4;

function pushSweep2(out: Contact[], c: Point4, from: number, to: number): void {
  const span = wrapZeroTau(to - from);
  if (span < MIN_EXTERIOR_ANGLE_PER_BEZIER) {
    out.push(contactAt(c, from + span / 2));
    return;
  }
  for (const a of arcAngles(from, to)) out.push(contactAt(c, a));
}

export function toOutline(pts: Point4[]): Contact[] {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return discLoop(pts[0]);

  // y increases downwards, so unit circle is flipped vertically
  // angles increase clockwise

  // `dropContained` ensures |dr| <= d
  const thru = new Array<number>(n - 1);
  const off = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = dist(a, b);
    thru[i] = Math.atan2(b.y - a.y, b.x - a.x);
    off[i] = Math.acos(clamp11(d > 0 ? (a.r - b.r) / d : 0));
  }

  const angles = (i: number, side: 1 | -1) => {
    const back = i > 0 ? i - 1 : 0;
    const fwd = i < n - 1 ? i : n - 2;
    return [thru[back] + side * off[back], thru[fwd] + side * off[fwd]] as const;
  };

  const out: Contact[] = [];

  // Start cap: the long way round the first disc, TAU - 2·off, back to the
  // contact the loop opened on.
  pushSweep2(out, pts[0], thru[0] + off[0], thru[0] - off[0]);

  for (let i = 1; i < n - 1; i++) {
    const [behind, ahead] = angles(i, -1);
    const [behind2, ahead2] = angles(i, 1);

    const outAngle = wrapZeroTau(ahead - behind2);
    const inAngle = wrapZeroTau(behind - behind2);

    if (outAngle < inAngle) {
      const gap = inAngle - outAngle;
      if (gap < MIN_INTERIOR_ANGLE_PER_BEZIER) {
        // out.push(contactAt(pts[i], behind));
        out.push(contactAt(pts[i], ahead + gap / 2));
      } else {
        // inside of a corner, don't sweep
        out.push(contactAt(pts[i], behind));
        out.push(contactAt(pts[i], ahead));
      }
    } else {
      pushSweep2(out, pts[i], behind, ahead);
    }
  }

  // End cap: round the last disc from its left contact to its right one. The
  // sweep is 2·off, which passes through the tip because the tip angle sits
  // between them by construction.
  const endL = thru[n - 2] - off[n - 2];
  const endR = thru[n - 2] + off[n - 2];
  pushSweep2(out, pts[n - 1], endL, endR);

  for (let i = n - 2; i >= 1; i--) {
    const [behind, ahead] = angles(i, 1);
    const [behind2, ahead2] = angles(i, -1);

    const outAngle = wrapZeroTau(behind - ahead2);
    const inAngle = wrapZeroTau(ahead - ahead2);

    if (outAngle < inAngle) {
      const gap = inAngle - outAngle;
      if (gap < MIN_INTERIOR_ANGLE_PER_BEZIER) {
        out.push(contactAt(pts[i], behind + gap / 2));
      } else {
        out.push(contactAt(pts[i], ahead));
        out.push(contactAt(pts[i], behind));
      }
    } else {
      pushSweep2(out, pts[i], ahead, behind);
    }
  }

  return out;
}

// Reads: simplify, tol, simplifyMaxMs, liveBuffer.
export function classicEngine(distinct: Point4[], o: Required<RenderOptions>): Shape {
  const nodes = o.simplify ? simplify(distinct, o.tol, o.simplifyMaxMs, o.liveBuffer) : distinct;
  return { nodes, outline: toOutline(nodes), spine: centerlinePath(nodes) };
}
