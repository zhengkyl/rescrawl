import { basis, type CenterlineNode } from "../centerline/fit.ts";
import { clamp11, dist, type Point4, quadControl, TAU } from "../math.ts";
import { contactAt, type OutlineNode, wrapZeroTau } from "./contact.ts";

// `node-fit` drawn with quadratics instead of cubics. Same shape of engine --
// one contact per centerline node per side, midpoint subdivision, corners off,
// caps the only arcs -- so the two differ in exactly one thing and can be read
// against each other. Serialize the result with `outlineQuadPath`, not
// `outlinePath`.
//
// What changes with the degree:
//
//   - Nothing is stored per node. A quadratic through two points with two
//     tangents is unique -- its control point is where the tangent lines cross
//     (`quadControl`) -- so there is no magnitude to pick and no chord rule.
//     An `OutlineNode` is already a complete description.
//   - A quadratic holds one sign of curvature end to end, so a piece the
//     envelope inflects across can never be covered. Subdivision is what
//     handles it: the split walks the inflection into a shorter and shorter
//     piece, which falls back to a line until it is under tolerance. Expect
//     more contacts than `node-fit` on an S-bend and about the same elsewhere.
//   - Its circles are worse. See MAX_ANGLE_PER_QUAD.
//
// A variant should copy this file's envelope math rather than share it, so the
// two can be compared without moving each other. See `pipeline.ts`.

export type NodeQuadOptions = {
  maxWidth?: number; // width at a standstill; the unit `quadTol` is measured in
  quadTol?: number; // × maxWidth the drawn outline may stray from the envelope
  quadDepth?: number; // midpoint splits one centerline segment may take per side
};

// Envelope samples one candidate quadratic is checked against. Interior only:
// the ends are exact by construction, and a split re-tests fresh parameters.
const TEST = 8;
// × maxWidth: closer than this and two contacts are the same point.
const SAME = 1e-9;

// A quadratic is a poorer circle than a cubic. With the control at the tangent
// intersection the mid-arc lands (cos(a/2) + sec(a/2))/2 out, so a quarter turn
// is 6.1% wide, PI/3 is 1.0%, PI/4 is 0.31% and PI/6 is 0.060%. PI/4 sits well
// inside any usable `quadTol` and costs 8 curves round a full circle, against
// the 4 cubics `MAX_ANGLE_PER_BEZIER` asks for.
const MAX_ANGLE_PER_QUAD = Math.PI / 2;

// A stroke of one disc: the full circle, in quadratic-sized pieces.
function quadDiscLoop(p: Point4): OutlineNode[] {
  const out: OutlineNode[] = [];
  const m = Math.ceil(TAU / MAX_ANGLE_PER_QUAD);
  for (let k = 0; k < m; k++) out.push(contactAt(p, (TAU * k) / m));
  return out;
}

export function toOutlineNodeQuad(
  ns: CenterlineNode[],
  o: Required<NodeQuadOptions>,
): OutlineNode[] {
  const n = ns.length;
  if (n === 0) return [];
  if (n === 1) return quadDiscLoop(ns[0]);

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

  const tol2 = o.quadTol * o.quadTol * o.maxWidth * o.maxWidth;
  const maxDepth = Math.max(0, Math.round(o.quadDepth));
  const same = SAME * o.maxWidth;

  // Does what `outlineQuadPath` would draw between A and B stay within `tol` of
  // the envelope over u0..u1? Exactly the serializer's construction: the
  // tangent-intersection quadratic, or the line it falls back to when the
  // tangents will not meet.
  const covers = (
    k: number,
    s: 1 | -1,
    u0: number,
    u1: number,
    A: OutlineNode,
    B: OutlineNode,
  ): boolean => {
    const q = quadControl(A.x, A.y, A.tx, A.ty, B.x, B.y, B.tx, B.ty);
    const lx = B.x - A.x;
    const ly = B.y - A.y;
    const L2 = lx * lx + ly * ly;
    for (let j = 1; j <= TEST; j++) {
      const f = j / (TEST + 1);
      const p = envelope(k, s, u0 + (u1 - u0) * f);
      let ex: number;
      let ey: number;
      if (q === null) {
        // Nearest point of the chord, which is what a fallback `l` draws.
        let v = L2 > 0 ? ((p.x - A.x) * lx + (p.y - A.y) * ly) / L2 : 0;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        ex = A.x + lx * v - p.x;
        ey = A.y + ly * v - p.y;
      } else {
        // Nearest point of the quadratic. Two Newton steps on d/dv |Q(v) - p|²,
        // whose second derivative is constant -- Q'' is 2(A - 2q + B).
        const cx = 2 * (q.x - A.x);
        const cy = 2 * (q.y - A.y);
        const ax = A.x - 2 * q.x + B.x;
        const ay = A.y - 2 * q.y + B.y;
        let v = f;
        ex = 0;
        ey = 0;
        for (let step = 0; step < 3; step++) {
          // Q(v) = A + c·v + a·v², so Q'(v) = c + 2a·v and Q''(v) = 2a.
          ex = A.x + cx * v + ax * v * v - p.x;
          ey = A.y + cy * v + ay * v * v - p.y;
          if (step === 2) break;
          const dx = cx + 2 * ax * v;
          const dy = cy + 2 * ay * v;
          const g = ex * dx + ey * dy;
          const dg = dx * dx + dy * dy + 2 * (ex * ax + ey * ay);
          if (dg <= 0) break;
          v -= g / dg;
          v = v < 0 ? 0 : v > 1 ? 1 : v;
        }
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
  // interior lands here -- one quadratic per MAX_ANGLE_PER_QUAD.
  const rim = (p: Point4, from: number, to: number) => {
    const sweep = wrapZeroTau(to - from);
    const m = Math.ceil(sweep / MAX_ANGLE_PER_QUAD);
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
  // so that contact is left off and the path's `z` draws the last curve.
  const head = ns[0];
  rim(head, angleOf(head, out[out.length - 1]), angleOf(head, out[0]));

  return out;
}
