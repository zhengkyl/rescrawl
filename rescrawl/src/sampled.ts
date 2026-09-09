import { arcAngles, contactAt, discLoop } from "./contact";
import type { Shape } from "./engine";
import { basis, fitCurve, fitOptions } from "./fit";
import { clamp11, dist, wrapPi } from "./math";
import { fitPath } from "./svg";
import type { Contact, FitNode, Point4, RenderOptions } from "./types";

// --- the sampled engine: fit the centerline, then walk the envelope ---
//
// Stage 3b is `fitCurve`, exactly as the `fit` engine uses it: the same nodes,
// the same tangents, the same settled-commit rule. Stage 4 is the other way
// round from `toOutlineFit`.
//
//   fit       one cubic per side per segment. The two end contacts and their
//             tangents are exact, and the two Hermite magnitudes between them
//             are solved by least squares against the true envelope. Few
//             contacts, and a linear solve per side per segment to place them.
//   sampled   no solve at all. March along the segment in steps of about
//             `sampleStep` px and drop a contact at each one, taking the
//             envelope's exact position AND tangent there. `outlinePath` then
//             joins consecutive contacts with its chord rule, which is a G1
//             Hermite through two points with known tangents, so the error
//             falls off like the step to the fourth power. Many contacts, but
//             every one of them sits exactly on the true outline.
//
// So this trades path size for having no fitting step in the outline at all:
// nothing here can be "a bad fit", only under-sampled. Turn `sampleStep` down
// until the shape stops changing and that is the true envelope; the `fit`
// engine's job is to match it with far fewer points.
//
// The envelope math below is deliberately its own copy of what `toOutlineFit`
// uses rather than a shared helper. These two are meant to be compared, and a
// shared envelope would mean an edit to one silently moved the other.
//
// Between two nodes the centerline is a Hermite cubic and the radius a
// Hermite too, with each node's own dr/ds as the end derivative. Sweeping a
// disc of that radius along that curve leaves an envelope whose contact on
// side s at parameter u is
//
//   E(u) = P(u) + r(u) · ( -r'·T(u) + s·sqrt(1 - r'²)·rot90(T(u)) ),  r' = dr/ds
//
// tilted back from the normal by acos(-r'), which for a straight run of two
// discs is their common tangent line exactly.

// Turns smaller than this are treated as smooth, so a node gets one contact
// per side. Same threshold as `toOutlineFit`, its own copy.
const SMOOTH_TURN = 0.02;
// Sub-chords used to measure a segment's arc length, to decide how many
// samples it gets. It only picks a step count, so it can be coarse.
const LENGTH_SAMPLES = 8;

export type SampledOptions = {
  step: number; // px along the centerline between outline contacts
  cornerPoint: boolean; // inside of a corner: one contact where the tangent lines cross
};

export function toOutlineSampled(ns: FitNode[], o: SampledOptions): Contact[] {
  const n = ns.length;
  if (n === 0) return [];
  if (n === 1) return discLoop(ns[0]);

  const off = (i: number) => Math.acos(clamp11(-ns[i].slope));
  const angIn = (i: number) => Math.atan2(ns[i].iy, ns[i].ix);
  const angOut = (i: number) => Math.atan2(ns[i].oy, ns[i].ox);

  // The fitted centerline of segment k at u: position, unit tangent, radius,
  // and dr/ds there.
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
    // Radius as a Hermite in u, its end derivatives the node slopes scaled by
    // the parametric speed there, so dr/ds matches the nodes exactly.
    const ma = line ? L : a.mo;
    const mb = line ? L : b.mi;
    const r = h.h00 * a.r + h.h10 * a.slope * ma + h.h01 * b.r + h.h11 * b.slope * mb;
    const ru = h.d00 * a.r + h.d10 * a.slope * ma + h.d01 * b.r + h.d11 * b.slope * mb;
    return { x, y, dx, dy, r, rs: clamp11(speed > 0 ? ru / speed : 0) };
  };

  // The envelope contact of segment k on side s at u, with the outline's own
  // forward unit tangent there.
  const envelope = (k: number, s: 1 | -1, u: number): Contact => {
    const c = at(k, u);
    const w = s * Math.sqrt(1 - c.rs * c.rs);
    // radial unit vector from the centre to the contact
    const ex = -c.rs * c.dx - w * c.dy;
    const ey = -c.rs * c.dy + w * c.dx;
    // Outline tangent: perpendicular to the radius, pointing the way this
    // side is WALKED. Side -1 is walked with the stroke, side +1 against it,
    // and `outlinePath` hangs its handles off this direction, so a tangent
    // pointing the wrong way draws a loop between two neighbours.
    let tx = -ey;
    let ty = ex;
    if ((tx * c.dx + ty * c.dy) * s > 0) {
      tx = -tx;
      ty = -ty;
    }
    return { x: c.x + c.r * ex, y: c.y + c.r * ey, tx, ty };
  };

  // How many steps each segment is cut into. Measured along the CENTERLINE,
  // so the outside of a bend is sampled a little sparsely and the inside a
  // little densely, by a factor of at most r / radius-of-curvature.
  const steps = new Array<number>(n - 1);
  for (let k = 0; k < n - 1; k++) {
    let L = 0;
    let prev = at(k, 0);
    for (let j = 1; j <= LENGTH_SAMPLES; j++) {
      const c = at(k, j / LENGTH_SAMPLES);
      L += dist(prev, c);
      prev = c;
    }
    steps[k] = Math.max(1, Math.ceil(L / o.step));
  }

  const out: Contact[] = [];
  const push = (c: Contact) => out.push(c);
  const pushArc = (p: Point4, from: number, to: number) => {
    for (const a of arcAngles(from, to)) push(contactAt(p, a));
  };

  // One node, on one side, arriving at angle `from` and leaving at `to`. They
  // differ only where the fit called a corner, so this is the only place the
  // walk is not just envelope samples.
  const joint = (i: number, from: number, to: number) => {
    const p = ns[i];
    const g = wrapPi(to - from);
    if (Math.abs(g) < SMOOTH_TURN) {
      push(contactAt(p, from));
      return;
    }
    if (g > 0) {
      // outside of the corner: round it off with the pen's own rim
      pushArc(p, from, to);
      return;
    }
    if (o.cornerPoint) {
      // Both tangent lines touch this disc, so they cross on the bisector at
      // r·sec(g/2). One contact there, arriving along the in-line with a zero
      // handle out, so the next run leaves on its own tangent.
      const c = contactAt(p, from + g / 2);
      const sc = 1 / Math.cos(g / 2);
      c.x = p.x + (c.x - p.x) * sc;
      c.y = p.y + (c.y - p.y) * sc;
      const a = contactAt(p, from);
      c.tx = a.tx;
      c.ty = a.ty;
      c.mOut = 0;
      push(c);
      return;
    }
    // inside of the corner: the crossed pair, filled by nonzero winding
    push(contactAt(p, from));
    push(contactAt(p, to));
  };

  // The loop, once round. Each cap ends on the contact the next walk starts
  // from, and each joint emits the contact the next segment starts from, so
  // no contact is ever emitted twice.

  // Start cap: the long way round the first disc, on to the forward side.
  pushArc(ns[0], angOut(0) + off(0), angOut(0) - off(0));

  // Forward, on the side whose contacts sit at thru - off.
  for (let k = 0; k < n - 1; k++) {
    const m = steps[k];
    for (let j = 1; j < m; j++) push(envelope(k, -1, j / m));
    if (k + 1 < n - 1) joint(k + 1, angIn(k + 1) - off(k + 1), angOut(k + 1) - off(k + 1));
  }

  // End cap: round the last disc onto the backward side.
  pushArc(ns[n - 1], angIn(n - 1) - off(n - 1), angIn(n - 1) + off(n - 1));

  // Back, at thru + off, arriving at each segment's end first. The last
  // segment walked is segment 0, whose u = 0 contact is where the start cap
  // began, so the loop closes onto it and it is not emitted again.
  for (let k = n - 2; k >= 0; k--) {
    const m = steps[k];
    for (let j = m - 1; j >= 1; j--) push(envelope(k, 1, j / m));
    if (k > 0) joint(k, angOut(k) + off(k), angIn(k) + off(k));
  }

  return out;
}

// --- the engine ---

// Reads: tol, liveBuffer, fitCornerAngle, fitCornerDist, fitHorizon,
// sampleStep, cornerPoint.
export function sampledEngine(distinct: Point4[], o: Required<RenderOptions>): Shape {
  const nodes = fitCurve(distinct, fitOptions(o));
  return {
    nodes,
    outline: toOutlineSampled(nodes, { step: o.sampleStep, cornerPoint: o.cornerPoint }),
    spine: fitPath(nodes),
  };
}
