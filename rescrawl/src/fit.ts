import { arcAngles, contactAt, discLoop } from "./contact";
import type { Shape } from "./engine";
import { chordRule, clamp11, dist, lerp, wrapPi } from "./math";
import { fitPath } from "./svg";
import type { Contact, FitNode, Point4, RenderOptions } from "./types";

// --- the fit engine ---
//
// --- stage 3b: a greedy line-and-cubic fit that never revisits ---
//
// The centerline is simplified while it is being drawn, and what has been
// drawn must not move. Those two pull against each other, and this is the
// settlement:
//
//   settled    a point's tangent, radius slope and corner status all read from
//              a window `cornerDist` either side of it, and its corner status
//              also depends on the windows of the points inside its own. Once
//              the pen is about 2·cornerDist past a point, none of that can
//              change. Only settled points are eligible as segment ends, so a
//              committed segment is final: no later sample can re-split it.
//   horizon    a segment also commits once it spans `horizon` px, whether or
//              not it could go on. The one segment still open is the only
//              simplified ink that changes from frame to frame (it refits
//              within tolerance as samples settle), and the horizon bounds how
//              far behind the pen that reaches. Raise it for a sparser path,
//              lower it for a stiller one; Infinity commits on fit failure only.
//   live       the settled edge is also held `live` samples behind the pen,
//              on top of what the windows require. Nothing commits until that
//              many samples sit behind it. 0 for a finished stroke.
//   tail       between the settled edge and the pen the samples are drawn as
//              they are, one node each on their own tangents. That is the zone
//              that is still moving anyway, and it stays that way at pen-up
//              too, so lifting the pen changes nothing on screen.
//
// The fit itself, per run between corners, keeps the greedy Reumann-Witkam
// shape of `simplify`: extend the candidate while it covers every sample in
// the same tube test, commit the last one that did.
//
//   corners    a point where the direction over `cornerDist` px either side
//              turns by more than `cornerAngle`; a local max of that angle.
//              Corners split the stroke into runs; nothing is fitted across one.
//   tangents   the secant from `cornerDist` behind to `cornerDist` ahead, kept
//              inside the run, so a corner's in-tangent only sees the run
//              behind it and its out-tangent only the run ahead.
//   segment    a Hermite cubic through the two ends on those tangents, its
//              two magnitudes solved by least squares over the samples between
//              (Schneider's fit with the tangents fixed), and every sample
//              covered by the tube test measured against the curve. Where the
//              tangents lie along the chord that cubic is a straight line, so
//              straights come out straight without a separate line case.
//
// There is deliberately no line-first rule. A chord that passes the tube test
// on a gentle curve leaves a tangent break at each end, and on a wide pen the
// outline shows every one of those as a visible kink at the node, even when
// the centerline is within tolerance. Keeping every joint tangent-continuous
// is what makes the nodes invisible; only detected corners break it.
//
// The node list is the stroke's representation: what is drawn, and what is
// worth storing. Re-running this on the full sample list reproduces exactly
// the nodes that were displayed while drawing, because every decision reads
// only settled data.

export type FitOptions = {
  tol: number; // ink the shape may gain per dropped point, as a fraction of local r
  cornerAngle: number; // rad
  cornerDist: number; // px either side of a point that turn, tangent and slope are measured over
  horizon: number; // px a segment may span before it commits regardless
  live: number; // samples held out of the fit behind the pen; 0 for a finished stroke
};

const MAX_RUN = 64;
// Below this, the normal equations are treated as singular and the chord rule
// stands in for the least-squares magnitudes.
const SINGULAR = 1e-9;
// A least-squares magnitude further than this factor from the chord rule is
// taken as an artefact of too few samples, not a shape.
const MAG_RANGE = 3;

// Hermite basis and its first two derivatives at u.
export function basis(u: number) {
  const u2 = u * u;
  const u3 = u2 * u;
  return {
    h00: 2 * u3 - 3 * u2 + 1,
    h10: u3 - 2 * u2 + u,
    h01: -2 * u3 + 3 * u2,
    h11: u3 - u2,
    d00: 6 * u2 - 6 * u,
    d10: 3 * u2 - 4 * u + 1,
    d01: -6 * u2 + 6 * u,
    d11: 3 * u2 - 2 * u,
    s00: 12 * u - 6,
    s10: 6 * u - 4,
    s01: -12 * u + 6,
    s11: 6 * u - 2,
  };
}

// Least-squares Hermite magnitudes for a cubic from `a` to `b` with unit
// tangents ta and tb, over the samples `at(j)` for j in [0, count), each at
// chord-length parameter `u(j)`. Returns magnitudes held within MAG_RANGE of
// the chord rule: with one or two samples the system is barely determined,
// and what it returns can be anything that passes through them, including a
// curve that loops or bulges between samples.
export function solveMagnitudes(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tax: number,
  tay: number,
  tbx: number,
  tby: number,
  count: number,
  at: (j: number) => { x: number; y: number },
  u: (j: number) => number,
): [number, number] {
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  let x1 = 0;
  let x2 = 0;
  const tt = tax * tbx + tay * tby;
  for (let j = 0; j < count; j++) {
    const p = at(j);
    const { h00, h10, h01, h11 } = basis(u(j));
    // residual: the sample minus the position part of the Hermite; the two
    // basis vectors are h10·ta and h11·tb
    const rx = p.x - h00 * ax - h01 * bx;
    const ry = p.y - h00 * ay - h01 * by;
    c11 += h10 * h10;
    c12 += h10 * h11 * tt;
    c22 += h11 * h11;
    x1 += h10 * (tax * rx + tay * ry);
    x2 += h11 * (tbx * rx + tby * ry);
  }
  const det = c11 * c22 - c12 * c12;
  let ma = -1;
  let mb = -1;
  if (Math.abs(det) > SINGULAR * Math.max(c11 * c22, 1e-300)) {
    ma = (x1 * c22 - x2 * c12) / det;
    mb = (c11 * x2 - c12 * x1) / det;
  }
  const chord = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
  const mc = chordRule(chord, tax, tay, tbx, tby);
  if (
    !(ma > mc / MAG_RANGE) ||
    !(mb > mc / MAG_RANGE) ||
    ma > mc * MAG_RANGE ||
    mb > mc * MAG_RANGE
  ) {
    return [mc, mc];
  }
  return [ma, mb];
}

const single = (p: Point4): FitNode => ({
  ...p,
  ix: 1,
  iy: 0,
  ox: 1,
  oy: 0,
  mi: 0,
  mo: 0,
  slope: 0,
  corner: false,
});

export function fitCurve(pts: Point4[], o: FitOptions): FitNode[] {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return [single(pts[0])];

  // Cumulative chord length, the parameter everything below is measured along.
  const S = new Float64Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + dist(pts[i - 1], pts[i]);

  const D = o.cornerDist;
  // First index at least D behind / ahead of i along the stroke, clamped.
  const back = (i: number, lo: number) => {
    let j = i;
    while (j > lo && S[i] - S[j] < D) j--;
    return j;
  };
  const fwd = (i: number, hi: number) => {
    let j = i;
    while (j < hi && S[j] - S[i] < D) j++;
    return j;
  };

  // --- corners ---
  const angle = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const p = pts[back(i, 0)];
    const c = pts[i];
    const q = pts[fwd(i, n - 1)];
    const ax = c.x - p.x;
    const ay = c.y - p.y;
    const bx = q.x - c.x;
    const by = q.y - c.y;
    angle[i] = Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  }
  const corner = new Uint8Array(n);
  for (let i = 1; i < n - 1; i++) {
    if (angle[i] < o.cornerAngle) continue;
    // Local max over ±D; a tie goes to the earlier point.
    let max = true;
    for (let j = back(i, 0); max && j < i; j++) max = angle[j] < angle[i];
    for (let j = i + 1, hi = fwd(i, n - 1); max && j <= hi; j++) max = angle[j] <= angle[i];
    if (max) corner[i] = 1;
  }

  // --- tangents, per run ---
  // `tin` arrives at a point, `tout` leaves it; they differ only at corners.
  const tin = new Float64Array(2 * n);
  const tout = new Float64Array(2 * n);
  const secant = (i: number, lo: number, hi: number, into: Float64Array) => {
    const p = pts[back(i, lo)];
    const q = pts[fwd(i, hi)];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      dx /= d;
      dy /= d;
    } else {
      dx = 1;
      dy = 0;
    }
    into[2 * i] = dx;
    into[2 * i + 1] = dy;
  };
  const bounds = [0];
  for (let i = 1; i < n - 1; i++) if (corner[i]) bounds.push(i);
  bounds.push(n - 1);
  for (let k = 0; k < bounds.length - 1; k++) {
    const lo = bounds[k];
    const hi = bounds[k + 1];
    for (let i = lo; i <= hi; i++) {
      // A corner's in-tangent belongs to the run it ends, its out-tangent to
      // the one it starts; every other point gets the same secant for both.
      if (i > lo) secant(i, lo, hi, tin);
      if (i < hi) secant(i, lo, hi, tout);
    }
  }
  // The stroke's own ends only have one side.
  tin[0] = tout[0];
  tin[1] = tout[1];
  tout[2 * (n - 1)] = tin[2 * (n - 1)];
  tout[2 * (n - 1) + 1] = tin[2 * (n - 1) + 1];

  // --- radius slope ---
  // dr/ds over the same window. The outline tilts each contact by it, and
  // shares it between the segments meeting at a node so the pen envelope is
  // continuous there. Radius does not care about corners, so the window is
  // not cut at them.
  const slope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = back(i, 0);
    const q = fwd(i, n - 1);
    const ds = S[q] - S[p];
    slope[i] = ds > 0 ? (pts[q].r - pts[p].r) / ds : 0;
  }

  // --- the settled edge ---
  // The last index whose own window, and the windows of every point inside
  // it, stop short of the tip. Never the tip itself, so the tail is never
  // empty, and lifting the pen adds no new information about anything else.
  let settled = 0;
  for (let i = n - 1; i > 0; i--) {
    if (fwd(fwd(i, n - 1), n - 1) < n - 1) {
      settled = i;
      break;
    }
  }
  // The live buffer holds that edge further back: the last `live` samples stay
  // in the tail however far the pen has run on, so a node only commits once
  // that many samples sit behind it. It is 0 for a finished stroke -- pen up,
  // no more data coming, so the whole stroke may settle.
  const hold = n - 1 - Math.max(0, Math.floor(o.live));
  if (settled > hold) settled = hold > 0 ? hold : 0;

  // --- the tube test, against a chord or a cubic ---
  // Room between the sample's rim and the tube wall at parameter u; the disc
  // fits when its centre is within `gap` of the curve there. Same rule as
  // `covered` in simplify.ts.
  const inTube = (a: Point4, b: Point4, p: Point4, u: number, dx: number, dy: number) => {
    const gap = lerp(a.r, b.r, u) - p.r + o.tol * p.r;
    return gap > 0 && dx * dx + dy * dy <= gap * gap;
  };

  // Least-squares cubic from ai to bi on the tangents `tout[ai]` and
  // `tin[bi]`, then the tube test against it. Returns the magnitudes, or null
  // if a sample between does not fit.
  const cubicCovers = (ai: number, bi: number): [number, number] | null => {
    const a = pts[ai];
    const b = pts[bi];
    const tax = tout[2 * ai];
    const tay = tout[2 * ai + 1];
    const tbx = tin[2 * bi];
    const tby = tin[2 * bi + 1];
    const span = S[bi] - S[ai];
    const param = (j: number) => (span > 0 ? (S[ai + 1 + j] - S[ai]) / span : 0.5);
    const [ma, mb] = solveMagnitudes(
      a.x,
      a.y,
      b.x,
      b.y,
      tax,
      tay,
      tbx,
      tby,
      bi - ai - 1,
      (j) => pts[ai + 1 + j],
      param,
    );

    const px = ma * tax;
    const py = ma * tay;
    const qx = mb * tbx;
    const qy = mb * tby;
    for (let j = ai + 1; j < bi; j++) {
      const p = pts[j];
      let u = param(j - ai - 1);
      let ex = 0;
      let ey = 0;
      // Chord-length u overstates the distance; two Newton steps toward the
      // nearest point bring it close enough for a tolerance test.
      for (let step = 0; step < 3; step++) {
        const k = basis(u);
        ex = k.h00 * a.x + k.h10 * px + k.h01 * b.x + k.h11 * qx - p.x;
        ey = k.h00 * a.y + k.h10 * py + k.h01 * b.y + k.h11 * qy - p.y;
        if (step === 2) break;
        const dx = k.d00 * a.x + k.d10 * px + k.d01 * b.x + k.d11 * qx;
        const dy = k.d00 * a.y + k.d10 * py + k.d01 * b.y + k.d11 * qy;
        const sx = k.s00 * a.x + k.s10 * px + k.s01 * b.x + k.s11 * qx;
        const sy = k.s00 * a.y + k.s10 * py + k.s01 * b.y + k.s11 * qy;
        const f = ex * dx + ey * dy;
        const df = dx * dx + dy * dy + ex * sx + ey * sy;
        if (df <= 0) break;
        u -= f / df;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
      }
      if (!inTube(a, b, p, u, ex, ey)) return null;
    }
    return [ma, mb];
  };

  // --- greedy extension, one run at a time ---
  const nodeAt = (i: number): FitNode => ({
    ...pts[i],
    ix: tin[2 * i],
    iy: tin[2 * i + 1],
    ox: tout[2 * i],
    oy: tout[2 * i + 1],
    mi: 0,
    mo: 0,
    slope: slope[i],
    corner: corner[i] === 1,
  });
  const nodes: FitNode[] = [nodeAt(0)];

  const commit = (bi: number, m: [number, number]) => {
    const a = nodes[nodes.length - 1];
    const b = nodeAt(bi);
    a.mo = m[0];
    b.mi = m[1];
    nodes.push(b);
  };

  // Runs end at corners inside the settled part, and the last one at the
  // settled edge: its final segment is the open one.
  const runs = [0];
  for (let i = 1; i < settled; i++) if (corner[i]) runs.push(i);
  if (settled > 0) runs.push(settled);
  for (let k = 0; k < runs.length - 1; k++) {
    const lo = runs[k];
    const hi = runs[k + 1];
    let a = lo;
    let i = lo + 1;
    // The magnitudes of the segment a..i, as of the last candidate that fit.
    // A two-point segment has nothing between its ends to test, so it always
    // does.
    let fit = cubicCovers(a, i)!;
    while (i < hi) {
      if (i - a < MAX_RUN && S[i + 1] - S[a] <= o.horizon) {
        const m = cubicCovers(a, i + 1);
        if (m) {
          fit = m;
          i++;
          continue;
        }
      }
      commit(i, fit);
      a = i;
      i = a + 1;
      fit = cubicCovers(a, i)!;
    }
    commit(hi, fit);
  }

  // The tail: every sample past the settled edge as a node on its own
  // tangents, joined by chord-rule cubics.
  for (let j = settled + 1; j < n; j++) {
    const a = nodes[nodes.length - 1];
    const b = nodeAt(j);
    const m = chordRule(dist(a, b), a.ox, a.oy, b.ix, b.iy);
    a.mo = m;
    b.mi = m;
    nodes.push(b);
  }
  return nodes;
}

// --- outline of fitted nodes: the pen envelope, one cubic per side per segment ---
//
// Between two nodes the centerline is a Hermite cubic and the radius a Hermite
// too, with each node's own dr/ds as the end derivative on both sides of it.
// Sweeping a disc of that radius along that curve leaves an envelope, and its
// contact on side s at parameter u is
//
//   E(u) = P(u) + r(u) · ( -r'·T(u) + s·sqrt(1 - r'²)·rot90(T(u)) ),  r' = dr/ds
//
// tilted back by acos(-r') from the normal, which for a straight run of two
// discs is their common tangent line exactly. Because tangent and slope are
// per node and shared by the segments meeting there, the envelope is
// continuous across a smooth node, and the contact at a node is one point
// whichever segment computes it. That is what removes the bump the older
// per-node constructions left at every node.
//
// Each side of each segment is then one cubic: the exact end contacts, the
// exact end tangents (perpendicular to the disc radius, as an envelope must
// be), and the two Hermite magnitudes fitted by least squares to the envelope
// sampled inside the segment, so an inflection or a change of curvature in
// the centerline shows up on the outline instead of being flattened to an arc.
//
// A node whose in- and out-tangents agree gets one contact per side. Where
// they differ -- a detected corner, or a line dictating one side -- the turn
// is read off the two contact angles: when the outgoing contact lies ahead
// of the incoming one around the disc the side is convex and gets an arc
// between them; behind, and it is the inside, which gets the crossed pair
// (or, with `cornerPoint`, one contact where the two tangent lines cross).

export type FitOutlineOptions = {
  cornerPoint: boolean; // inside of a corner: one contact where the tangent lines cross
};

// Turns smaller than this are treated as smooth, with one contact at the
// incoming angle: the arc construction would emit two near-coincident
// contacts and a cubic between them that is shorter than the drawing error.
const SMOOTH_TURN = 0.02;
// Envelope samples inside a segment that the outline cubic is fitted to.
const ENVELOPE_SAMPLES = [0.2, 0.4, 0.6, 0.8];

export function toOutlineFit(ns: FitNode[], o: FitOutlineOptions): Contact[] {
  const n = ns.length;
  if (n === 0) return [];
  if (n === 1) return discLoop(ns[0]);

  const off = (i: number) => Math.acos(clamp11(-ns[i].slope));
  const angIn = (i: number) => Math.atan2(ns[i].iy, ns[i].ix);
  const angOut = (i: number) => Math.atan2(ns[i].oy, ns[i].ox);

  // The envelope contact of segment k on side s at u, with the forward unit
  // tangent of the outline there.
  const envelope = (k: number, s: 1 | -1, u: number) => {
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
    // Radius as a Hermite in u, its end derivatives the node slopes scaled
    // by the parametric speed there, so dr/ds matches the nodes exactly.
    const ma = line ? L : a.mo;
    const mb = line ? L : b.mi;
    const r = h.h00 * a.r + h.h10 * a.slope * ma + h.h01 * b.r + h.h11 * b.slope * mb;
    const ru = h.d00 * a.r + h.d10 * a.slope * ma + h.d01 * b.r + h.d11 * b.slope * mb;
    const rs = clamp11(speed > 0 ? ru / speed : 0);
    const c = -rs;
    const w = s * Math.sqrt(1 - rs * rs);
    // radial unit vector from the centre to the contact
    const ex = c * dx - w * dy;
    const ey = c * dy + w * dx;
    // outline tangent: perpendicular to the radius, pointing forward
    let tx = -ey;
    let ty = ex;
    if (tx * dx + ty * dy < 0) {
      tx = -tx;
      ty = -ty;
    }
    return { x: x + r * ex, y: y + r * ey, tx, ty };
  };

  // Hermite magnitudes of the outline cubic of segment k on side s, in the
  // forward direction: [at node k, at node k + 1]. Reversing a cubic keeps
  // its magnitudes, so the backward side reads the same pair the other way.
  const outlineMags = (k: number, s: 1 | -1): [number, number] => {
    const c0 = envelope(k, s, 0);
    const c1 = envelope(k, s, 1);
    const inner = ENVELOPE_SAMPLES.map((u) => envelope(k, s, u));
    // chord-length parameter of each inner sample along the sample polyline
    const cum = [0];
    let prev = c0;
    for (const c of inner) {
      cum.push(cum[cum.length - 1] + dist(prev, c));
      prev = c;
    }
    const total = cum[cum.length - 1] + dist(prev, c1);
    return solveMagnitudes(
      c0.x,
      c0.y,
      c1.x,
      c1.y,
      c0.tx,
      c0.ty,
      c1.tx,
      c1.ty,
      inner.length,
      (j) => inner[j],
      (j) => (total > 0 ? cum[j + 1] / total : 0.5),
    );
  };
  const magsF = new Array<[number, number]>(n - 1);
  const magsB = new Array<[number, number]>(n - 1);
  for (let k = 0; k < n - 1; k++) {
    magsF[k] = outlineMags(k, -1);
    magsB[k] = outlineMags(k, 1);
  }

  const out: Contact[] = [];
  const push = (c: Contact) => {
    out.push(c);
    return c;
  };
  // An arc of the disc from `from` to `to` (increasing angle); returns its two
  // end contacts so the caller can hang the neighbouring magnitudes on them.
  const pushArc = (c: Point4, from: number, to: number) => {
    const angles = arcAngles(from, to);
    const first = push(contactAt(c, angles[0]));
    let last = first;
    for (let k = 1; k < angles.length; k++) last = push(contactAt(c, angles[k]));
    return [first, last] as const;
  };

  // One node on one side, in traversal order `from` -> `to`, with the outline
  // magnitudes arriving and leaving on this side.
  const joint = (i: number, from: number, to: number, mIn: number, mOut: number) => {
    const p = ns[i];
    const g = wrapPi(to - from);
    if (Math.abs(g) < SMOOTH_TURN) {
      const c = push(contactAt(p, from));
      c.mIn = mIn;
      c.mOut = mOut;
      return;
    }
    if (g > 0) {
      const [first, last] = pushArc(p, from, to);
      first.mIn = mIn;
      last.mOut = mOut;
      return;
    }
    if (o.cornerPoint) {
      // Both tangent lines touch this disc, so they cross on the bisector at
      // r·sec(g/2). One contact there, arriving along the in-line with a zero
      // handle out: the next cubic starts from a point on its own tangent
      // line, which keeps a following straight straight.
      const c = contactAt(p, from + g / 2);
      const sc = 1 / Math.cos(g / 2);
      c.x = p.x + (c.x - p.x) * sc;
      c.y = p.y + (c.y - p.y) * sc;
      const a = contactAt(p, from);
      c.tx = a.tx;
      c.ty = a.ty;
      c.mIn = mIn;
      c.mOut = 0;
      push(c);
      return;
    }
    push(contactAt(p, from)).mIn = mIn;
    push(contactAt(p, to)).mOut = mOut;
  };

  // Forward, on the side whose contacts sit at thru - off.
  {
    const [, last] = pushArc(ns[0], angOut(0) + off(0), angOut(0) - off(0));
    last.mOut = magsF[0][0];
  }
  for (let i = 1; i < n - 1; i++) {
    joint(i, angIn(i) - off(i), angOut(i) - off(i), magsF[i - 1][1], magsF[i][0]);
  }
  {
    const [first, last] = pushArc(ns[n - 1], angIn(n - 1) - off(n - 1), angIn(n - 1) + off(n - 1));
    first.mIn = magsF[n - 2][1];
    last.mOut = magsB[n - 2][1];
  }
  // Back, on the side at thru + off, arriving at each segment's end first.
  for (let i = n - 2; i >= 1; i--) {
    joint(i, angOut(i) + off(i), angIn(i) + off(i), magsB[i][0], magsB[i - 1][1]);
  }
  out[0].mIn = magsB[0][0];
  return out;
}

// --- the engine ---

const DEG = Math.PI / 180;

export function fitOptions(o: Required<RenderOptions>): FitOptions {
  return {
    tol: o.tol,
    cornerAngle: o.fitCornerAngle * DEG,
    cornerDist: o.fitCornerDist,
    horizon: o.fitHorizon,
    live: o.liveBuffer,
  };
}

// Reads: tol, liveBuffer, fitCornerAngle, fitCornerDist, fitHorizon, cornerPoint.
export function fitEngine(distinct: Point4[], o: Required<RenderOptions>): Shape {
  const nodes = fitCurve(distinct, fitOptions(o));
  return {
    nodes,
    outline: toOutlineFit(nodes, { cornerPoint: o.cornerPoint }),
    spine: fitPath(nodes),
  };
}
