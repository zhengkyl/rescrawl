import { basis, type CenterlineNode } from "../centerline/fit.ts";
import { chordRule, clamp11, dist, type Point4 } from "../math.ts";
import {
  contactAt,
  discLoop,
  MAX_ANGLE_PER_BEZIER,
  type OutlineNode,
  wrapZeroTau,
} from "./contact.ts";

// A node-anchored outline. One contact per centerline node per side, and the
// cubic between two neighbouring contacts subdivided at its midpoint until it
// tracks the true envelope. The only arcs are the two end caps.
//
// Corner detection is OFF -- `renderStroke` turns it off for this outline. The
// centerline is therefore G1 end to end: `ix` equals `ox` at every node, so the
// contact a segment
// leaves a node with is the one the next segment arrives at, and the whole loop
// is tangent-continuous by construction. A sharp turn is high curvature rather
// than a break, which is what removes every mid-stroke rim stretch and the cut
// across a fold. Where the centerline turns tighter than the pen is wide the
// offset still crosses itself; the fit reproduces the crossing and nonzero
// winding fills it.
//
// Contacts are pinned to nodes, so once a node settles its ink never moves
// again. That locality is the point: an engine that decides contacts by walking
// the whole loop has to re-anchor everything behind a hop it re-decides.
//
// A variant should copy this file's envelope math rather than share it, so the
// two can be compared without moving each other. See `pipeline.ts`.

export type NodeFitOptions = {
  maxWidth?: number; // width at a standstill; the unit `nodeTol` is measured in
  nodeTol?: number; // × maxWidth the drawn outline may stray from the envelope
  nodeDepth?: number; // midpoint splits one centerline segment may take per side
};

// Envelope samples one candidate cubic is checked against. Interior only: the
// ends are exact by construction, and a split re-tests fresh parameters.
const TEST = 8;
// × maxWidth: closer than this and two contacts are the same point. A cusp on
// the inner offset puts several samples on top of each other.
const SAME = 1e-9;

export function toOutlineNodeFit(ns: CenterlineNode[], o: Required<NodeFitOptions>): OutlineNode[] {
  const n = ns.length;
  if (n === 0) return [];
  if (n === 1) return discLoop(ns[0]);

  // The fitted centerline of segment k at u, with the radius running as a
  // Hermite on the same parameter. `rs` is dr/ds, which is what leans the
  // contact off the normal.
  const at = (k: number, u: number) => {
    const a = ns[k];
    const b = ns[k + 1];
    // A line is stored with zero magnitudes; as a Hermite it is the chord.
    const line = a.mo === 0 && b.mi === 0;
    const L = dist(a, b);
    const px = line ? b.x - a.x : a.mo * a.ox;
    const py = line ? b.y - a.y : a.mo * a.oy;
    const qx = line ? b.x - a.x : b.mi * b.ix;
    const qy = line ? b.y - a.y : b.mi * b.iy;
    const h = basis(u);
    const x = h.h00 * a.x + h.h10 * px + h.h01 * b.x + h.h11 * qx;
    const y = h.h00 * a.y + h.h10 * py + h.h01 * b.y + h.h11 * qy;
    let dx = h.d00 * a.x + h.d10 * px + h.d01 * b.x + h.d11 * qx;
    let dy = h.d00 * a.y + h.d10 * py + h.d01 * b.y + h.d11 * qy;
    const speed = Math.sqrt(dx * dx + dy * dy);
    if (speed > 0) {
      dx /= speed;
      dy /= speed;
    } else {
      dx = a.ox;
      dy = a.oy;
    }
    const ma = line ? L : a.mo;
    const mb = line ? L : b.mi;
    const r = h.h00 * a.r + h.h10 * a.slope * ma + h.h01 * b.r + h.h11 * b.slope * mb;
    const ru = h.d00 * a.r + h.d10 * a.slope * ma + h.d01 * b.r + h.d11 * b.slope * mb;
    return { x, y, dx, dy, r, rs: clamp11(speed > 0 ? ru / speed : 0) };
  };

  // Envelope contact of segment k on side s at u; s is -1 with the stroke, +1
  // against. The boundary of the swept disc is where a disc touches its
  // neighbours, which is NOT the normal offset: the contact's radial direction
  // satisfies u·T = -dr/ds, so a growing pen leans its contact backwards. At
  // u = 0 and 1 it lands exactly on the node's rim, which is what lets the end
  // caps meet the sides tangentially.
  const envelope = (k: number, s: 1 | -1, u: number): OutlineNode => {
    const c = at(k, u);
    const w = s * Math.sqrt(1 - c.rs * c.rs);
    // radial unit vector from the centre to the contact
    const ex = -c.rs * c.dx - w * c.dy;
    const ey = -c.rs * c.dy + w * c.dx;
    let tx = -ey;
    let ty = ex;
    // The tangent points the way the loop is walked: with the stroke on the
    // forward side, against it on the way back.
    if ((tx * c.dx + ty * c.dy) * s > 0) {
      tx = -tx;
      ty = -ty;
    }
    return { x: c.x + c.r * ex, y: c.y + c.r * ey, tx, ty };
  };

  const tol2 = o.nodeTol * o.nodeTol * o.maxWidth * o.maxWidth;
  const maxDepth = Math.max(0, Math.round(o.nodeDepth));
  const same = SAME * o.maxWidth;

  // Does the cubic `outlinePath` would draw between A and B stay within `tol`
  // of the envelope over u0..u1? Same construction as the serializer: unit
  // tangents scaled by the chord rule, control points at a third. Two Newton
  // steps put each sample on its nearest point of the cubic.
  const covers = (
    k: number,
    s: 1 | -1,
    u0: number,
    u1: number,
    A: OutlineNode,
    B: OutlineNode,
  ): boolean => {
    const m = chordRule(dist(A, B), A.tx, A.ty, B.tx, B.ty);
    const px = A.tx * m;
    const py = A.ty * m;
    const qx = B.tx * m;
    const qy = B.ty * m;
    for (let j = 1; j <= TEST; j++) {
      const f = j / (TEST + 1);
      const p = envelope(k, s, u0 + (u1 - u0) * f);
      let v = f;
      let ex = 0;
      let ey = 0;
      for (let step = 0; step < 3; step++) {
        const h = basis(v);
        ex = h.h00 * A.x + h.h10 * px + h.h01 * B.x + h.h11 * qx - p.x;
        ey = h.h00 * A.y + h.h10 * py + h.h01 * B.y + h.h11 * qy - p.y;
        if (step === 2) break;
        const dx = h.d00 * A.x + h.d10 * px + h.d01 * B.x + h.d11 * qx;
        const dy = h.d00 * A.y + h.d10 * py + h.d01 * B.y + h.d11 * qy;
        const sx = h.s00 * A.x + h.s10 * px + h.s01 * B.x + h.s11 * qx;
        const sy = h.s00 * A.y + h.s10 * py + h.s01 * B.y + h.s11 * qy;
        const g = ex * dx + ey * dy;
        const dg = dx * dx + dy * dy + ex * sx + ey * sy;
        if (dg <= 0) break;
        v -= g / dg;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      if (ex * ex + ey * ey > tol2) return false;
    }
    return true;
  };

  const out: OutlineNode[] = [];
  const add = (c: OutlineNode) => {
    const last = out[out.length - 1];
    if (last && Math.abs(c.x - last.x) < same && Math.abs(c.y - last.y) < same) return;
    out.push(c);
  };

  // The envelope of segment k, side s, from u0 to u1. `u0`'s contact is already
  // out; this adds every contact after it, up to and including `u1`'s. Splits
  // land at the midpoint rather than at the worst sample, so re-fitting a
  // stroke puts them back in the same places instead of shuffling the ink.
  const span = (k: number, s: 1 | -1, u0: number, u1: number, A: OutlineNode, depth: number) => {
    const B = envelope(k, s, u1);
    if (depth < maxDepth && !covers(k, s, u0, u1, A, B)) {
      const um = (u0 + u1) / 2;
      const M = envelope(k, s, um);
      span(k, s, u0, um, A, depth + 1);
      span(k, s, um, u1, M, depth + 1);
      return;
    }
    add(B);
  };

  // A stretch of a node's own rim, walked in increasing angle. `from`'s contact
  // is already out and `to`'s belongs to the side that follows, so only the
  // interior lands here -- one cubic per MAX_ANGLE_PER_BEZIER, which is the arc
  // the chord rule reproduces.
  const rim = (p: Point4, from: number, to: number) => {
    const sweep = wrapZeroTau(to - from);
    const m = Math.ceil(sweep / MAX_ANGLE_PER_BEZIER);
    for (let j = 1; j < m; j++) add(contactAt(p, from + (sweep * j) / m));
  };
  const angleOf = (c: Point4, p: OutlineNode) => Math.atan2(p.y - c.y, p.x - c.x);

  // Forward side, out from node 0. Each segment's contact at u = 0 is the one
  // the segment before left at u = 1 -- identical, since with no corners a node
  // has one tangent and one radius slope.
  add(envelope(0, -1, 0));
  for (let k = 0; k < n - 1; k++) span(k, -1, 0, 1, envelope(k, -1, 0), 0);

  // End cap, from the forward side round to the back one.
  const tail = ns[n - 1];
  const tailIn = out[out.length - 1];
  const tailOut = envelope(n - 2, 1, 1);
  rim(tail, angleOf(tail, tailIn), angleOf(tail, tailOut));
  add(tailOut);

  // Back side, home to node 0.
  for (let k = n - 2; k >= 0; k--) span(k, 1, 1, 0, envelope(k, 1, 1), 0);

  // The start cap closes the loop onto `out[0]`, where the forward side opened,
  // so that contact is left off and the path's `z` draws the last cubic.
  const head = ns[0];
  rim(head, angleOf(head, out[out.length - 1]), angleOf(head, out[0]));

  return out;
}
