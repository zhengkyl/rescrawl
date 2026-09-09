import { contactAt, discLoop, wrapZeroTau } from "./contact";
import type { Shape } from "./engine";
import { basis, fitCurve, fitOptions } from "./fit";
import { chordRule, clamp11, dist, wrapPi } from "./math";
import { fitPath } from "./svg";
import type { Contact, FitNode, Point4, RenderOptions } from "./types";

// --- the greedy engine: fit the centerline, then fit the outline the same way ---
//
// Stage 3b is `fitCurve`, as in `fit` and `sampled`. Stage 4 has no
// constructions in it at all -- no cap case, no corner case, no arc-per-
// quarter-turn rule, no inner corner point. There are only two steps:
//
//   1. Sample the whole closed outline densely, once round, as one sequence.
//   2. Walk it greedily and keep a contact only where the cubic that would
//      otherwise be drawn strays more than `tol` px from those samples.
//
// The reason the constructions can go is that the outline is ONE CURVE. The
// sides are the pen envelope, the caps and the outside of a corner are the
// pen's own rim, and they meet tangentially: the envelope at a segment end is
// the same point, with the same tangent, as the rim at that angle. So a cap
// is not a special object needing three contacts, it is just a stretch of
// curve that happens to be circular, and it costs whatever the tolerance says
// it costs -- one hop on a hairline pen, several on a fat one.
//
// The single exception is the INSIDE of a corner. There the two pieces of
// envelope cross instead of meeting, so the curve really is discontinuous and
// a hop must not span it. Those get a `break`, which forces a contact on both
// lips of the fold and reproduces the crossing exactly. Nonzero winding fills
// it. That is the only place this file knows what a corner is.
//
// Compared to the other two envelope engines:
//
//   sampled   contacts every `sampleStep` px regardless of need. Simple, but
//             it spends most of its contacts on straights.
//   fit       one cubic per side per centerline segment, magnitudes solved by
//             least squares. Cheap on contacts, but its hops are pinned to the
//             centerline's nodes, which is the wrong place when the outline's
//             turn concentrates somewhere else (a corner, a taper).
//   greedy    contacts where the error demands, chord-rule magnitudes. The two
//             sides are walked independently, so the inside of a bend gets
//             more contacts than the outside, which is where the outline
//             actually turns faster.
//
// The envelope math is its own copy, as in `sampled.ts`, so the engines can be
// edited and compared without moving each other.

export type GreedyOptions = {
  tol: number; // px the drawn outline may stray from the pen envelope
};

// A turn smaller than this is not a corner: the node's two tangents agree to
// within noise, so the outline runs straight through it.
const SMOOTH_TURN = 0.02;
// px between the samples the tube test sees. The test can only judge what is
// sampled, so this bounds how short a feature can be and still cost a contact.
const FINE_STEP = 0.5;
const MIN_FINE = 8; // samples per centerline segment at the very least
// Samples one hop may span, so a pathological run cannot cost quadratic time.
const MAX_HOP = 512;
// Two samples closer than this are the same point: the junction between a rim
// and a segment end is shared, and a zero-length hop has no tangent to speak of.
const SAME = 1e-9;

export function toOutlineGreedy(ns: FitNode[], o: GreedyOptions): Contact[] {
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
    const ma = line ? L : a.mo;
    const mb = line ? L : b.mi;
    const r = h.h00 * a.r + h.h10 * a.slope * ma + h.h01 * b.r + h.h11 * b.slope * mb;
    const ru = h.d00 * a.r + h.d10 * a.slope * ma + h.d01 * b.r + h.d11 * b.slope * mb;
    return { x, y, dx, dy, r, rs: clamp11(speed > 0 ? ru / speed : 0) };
  };

  // The envelope contact of segment k on side s at u, its tangent pointing the
  // way that side is walked: -1 with the stroke, +1 against it. At u = 0 and
  // u = 1 this lands exactly on the rim at angle angOut/angIn -+ off, with the
  // tangent `contactAt` gives there, which is what lets the rim stretches and
  // the sides be one curve.
  const envelope = (k: number, s: 1 | -1, u: number): Contact => {
    const c = at(k, u);
    const w = s * Math.sqrt(1 - c.rs * c.rs);
    // radial unit vector from the centre to the contact
    const ex = -c.rs * c.dx - w * c.dy;
    const ey = -c.rs * c.dy + w * c.dx;
    let tx = -ey;
    let ty = ex;
    if ((tx * c.dx + ty * c.dy) * s > 0) {
      tx = -tx;
      ty = -ty;
    }
    return { x: c.x + c.r * ex, y: c.y + c.r * ey, tx, ty };
  };

  // --- 1. the whole outline, sampled, once round ---

  const loop: Contact[] = [];
  // `cut[i]` marks a break in the curve immediately before sample i.
  const cut = new Set<number>();
  const add = (c: Contact, force = false) => {
    const last = loop[loop.length - 1];
    if (!force && last && Math.abs(c.x - last.x) < SAME && Math.abs(c.y - last.y) < SAME) return;
    loop.push(c);
  };
  // A stretch of the pen's own rim, walked in increasing angle.
  const rim = (p: Point4, from: number, to: number) => {
    const span = wrapZeroTau(to - from);
    const m = Math.max(2, Math.ceil((p.r * span) / FINE_STEP));
    for (let j = 0; j <= m; j++) add(contactAt(p, from + (span * j) / m));
  };
  // A node between two segments, on the side being walked. Outside the bend
  // the rim carries the turn; inside it, the two pieces cross and the curve
  // is cut. `from` is the angle arrived at, `to` the angle left on.
  const node = (i: number, from: number, to: number) => {
    const g = wrapPi(to - from);
    if (Math.abs(g) < SMOOTH_TURN) return; // one curve straight through
    if (g > 0) {
      rim(ns[i], from, to);
      return;
    }
    cut.add(loop.length); // the fold: the next sample opens a new run
  };
  const side = (k: number, s: 1 | -1) => {
    const m = Math.max(MIN_FINE, Math.ceil(dist(ns[k], ns[k + 1]) / FINE_STEP));
    // Forced when a cut has just been marked, so the fold's far lip survives
    // the coincidence check and stays the sample the cut points at.
    const force = cut.has(loop.length);
    for (let j = 0; j <= m; j++)
      add(envelope(k, s, s === -1 ? j / m : 1 - j / m), force && j === 0);
  };

  // Start cap, then the forward side, then the end cap, then back. Each cap
  // is just a rim stretch; nothing here treats it as an object.
  rim(ns[0], angOut(0) + off(0), angOut(0) - off(0));
  for (let k = 0; k < n - 1; k++) {
    side(k, -1);
    if (k + 1 < n - 1) node(k + 1, angIn(k + 1) - off(k + 1), angOut(k + 1) - off(k + 1));
  }
  rim(ns[n - 1], angIn(n - 1) - off(n - 1), angIn(n - 1) + off(n - 1));
  for (let k = n - 2; k >= 0; k--) {
    side(k, 1);
    if (k > 0) node(k, angOut(k) + off(k), angIn(k) + off(k));
  }
  // The last sample is segment 0's u = 0 on the back side, which is the same
  // point the start cap opened on, so drop it and let the loop close.
  const first = loop[0];
  while (loop.length > 1) {
    const last = loop[loop.length - 1];
    if (Math.abs(last.x - first.x) > SAME || Math.abs(last.y - first.y) > SAME) break;
    loop.pop();
  }
  const N = loop.length;
  if (N < 2) return loop;

  // --- 2. keep only the contacts the tolerance demands ---

  // `seq` repeats the first sample at the end so the closing hop is an
  // ordinary run rather than a special case.
  const seq = [...loop, loop[0]];
  const S = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) S[i] = S[i - 1] + dist(seq[i - 1], seq[i]);

  // Does the chord-rule cubic from sample a to sample b pass within `tol` of
  // every sample between? Each sample starts at its length fraction along the
  // hop and takes two Newton steps toward the nearest point of the cubic, the
  // same test `fitCurve` runs on the centerline.
  const tol2 = o.tol * o.tol;
  const covers = (a: number, b: number): boolean => {
    const A = seq[a];
    const B = seq[b];
    const m = chordRule(dist(A, B), A.tx, A.ty, B.tx, B.ty);
    const px = A.tx * m;
    const py = A.ty * m;
    const qx = B.tx * m;
    const qy = B.ty * m;
    const span = S[b] - S[a];
    for (let j = a + 1; j < b; j++) {
      const p = seq[j];
      let u = span > 0 ? (S[j] - S[a]) / span : 0.5;
      let ex = 0;
      let ey = 0;
      for (let step = 0; step < 3; step++) {
        const h = basis(u);
        ex = h.h00 * A.x + h.h10 * px + h.h01 * B.x + h.h11 * qx - p.x;
        ey = h.h00 * A.y + h.h10 * py + h.h01 * B.y + h.h11 * qy - p.y;
        if (step === 2) break;
        const dx = h.d00 * A.x + h.d10 * px + h.d01 * B.x + h.d11 * qx;
        const dy = h.d00 * A.y + h.d10 * py + h.d01 * B.y + h.d11 * qy;
        const sx = h.s00 * A.x + h.s10 * px + h.s01 * B.x + h.s11 * qx;
        const sy = h.s00 * A.y + h.s10 * py + h.s01 * B.y + h.s11 * qy;
        const f = ex * dx + ey * dy;
        const df = dx * dx + dy * dy + ex * sx + ey * sy;
        if (df <= 0) break;
        u -= f / df;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
      }
      if (ex * ex + ey * ey > tol2) return false;
    }
    return true;
  };

  // Sample 0 is pinned so the closed loop has somewhere to start; every other
  // anchor is a fold, where a hop may not reach across.
  const anchors = [0, ...[...cut].filter((i) => i > 0 && i < N).sort((a, b) => a - b)];

  const out: Contact[] = [];
  for (let j = 0; j < anchors.length; j++) {
    const lo = anchors[j];
    // A run STOPS on the near lip of the next fold; the fold's far lip opens
    // the run after it. Ending the run on the far lip instead would let a hop
    // reach straight across the discontinuity, skip the near lip, and redraw
    // the crossing as a shortcut -- which changes which side of the path a
    // whole region sits on, and so what gets filled.
    const next = anchors[j + 1];
    const hi = next === undefined ? N : next - 1;
    out.push(seq[lo]);
    // Extend the hop by doubling until the test fails, then bisect back to
    // the last end that passed. Stepping one sample at a time would retest
    // the whole hop on every step, and the outline is sampled far too finely
    // for that. The test is not monotone in hop length, so this can settle on
    // a longer passing hop than the step-by-step walk; either way every hop
    // committed passed the test.
    let a = lo;
    while (a < hi - 1) {
      const cap = Math.min(hi, a + MAX_HOP);
      let pass = a + 1; // a hop to the next sample spans nothing to fail
      let fail = -1;
      for (let step = 1; ; step *= 2) {
        const b = Math.min(a + 1 + step, cap);
        if (b <= pass) break;
        if (!covers(a, b)) {
          fail = b;
          break;
        }
        pass = b;
        if (b === cap) break;
      }
      if (fail > 0) {
        while (fail - pass > 1) {
          const mid = (pass + fail) >> 1;
          if (covers(a, mid)) pass = mid;
          else fail = mid;
        }
      }
      if (pass >= hi) break; // reached this run's far end, emitted below
      out.push(seq[pass]);
      a = pass;
    }
    // The near lip of the coming fold. The last run instead ends at seq[N],
    // which is seq[0], already emitted as the first anchor.
    if (hi < N) out.push(seq[hi]);
  }
  return out;
}

// --- the engine ---

// Reads: tol, liveBuffer, fitCornerAngle, fitCornerDist, fitHorizon, outlineTol.
export function greedyEngine(distinct: Point4[], o: Required<RenderOptions>): Shape {
  const nodes = fitCurve(distinct, fitOptions(o));
  return {
    nodes,
    outline: toOutlineGreedy(nodes, { tol: o.outlineTol }),
    spine: fitPath(nodes),
  };
}
