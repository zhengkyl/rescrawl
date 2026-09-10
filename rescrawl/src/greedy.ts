import { contactAt, discLoop, wrapZeroTau } from "./contact.ts";
import type { Shape } from "./engine.ts";
import { basis, fitCurve } from "./fit.ts";
import { chordRule, clamp11, dist, wrapPi } from "./math.ts";
import type { Contact, FitNode, Point4, RenderOptions } from "./types.ts";

// --- the greedy engine: fit the centerline, then fit the outline the same way ---
//
// The nodes come from `fitCurve`, as in `fit` and `sampled`. The outline has no
// constructions in it at all -- no cap case, no corner case, no arc-per-
// quarter-turn rule, no inner corner point. There are only two steps:
//
//   1. Sample the whole closed outline densely, once round, as one sequence.
//   2. Walk it greedily and keep a contact only where the cubic that would
//      otherwise be drawn strays more than `outlineTol` px from those samples.
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

// A turn smaller than this is not a corner: the node's two tangents agree to
// within noise, so the outline runs straight through it.
const SMOOTH_TURN = 0.02;
// × maxWidth between the samples the tube test sees. The test can only judge
// what is sampled, so this bounds how short a feature can be and still cost a
// contact. Relative to the pen, not a pixel count: an absolute step put twice
// as many samples on the same curve when the drawing was scaled up, which moved
// every index the greedy walk probes and was what stopped this engine -- alone
// of the three -- reproducing its own shape at a different scale.
const FINE_STEP = 0.0625;
const MIN_FINE = 8; // samples per centerline segment at the very least
// Samples one hop may span, so a pathological run cannot cost quadratic time.
const MAX_HOP = 512;
// × maxWidth: two samples closer than this are the same point. The junction
// between a rim and a segment end is shared, and a zero-length hop has no
// tangent to speak of.
const SAME = 1e-10;

export function toOutlineGreedy(ns: FitNode[], o: Required<RenderOptions>): Contact[] {
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

  // Both lengths ride on the pen, so the dense loop is the same sequence of
  // samples whatever the drawing is scaled to.
  const fine = FINE_STEP * o.maxWidth;
  const same = SAME * o.maxWidth;

  const loop: Contact[] = [];
  // `cut[i]` marks a break in the curve immediately before sample i.
  const cut = new Set<number>();
  const add = (c: Contact, force = false) => {
    const last = loop[loop.length - 1];
    if (!force && last && Math.abs(c.x - last.x) < same && Math.abs(c.y - last.y) < same) return;
    loop.push(c);
  };
  // A stretch of the pen's own rim, walked in increasing angle.
  const rim = (p: Point4, from: number, to: number) => {
    const span = wrapZeroTau(to - from);
    const m = Math.max(2, Math.ceil((p.r * span) / fine));
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
    const m = Math.max(MIN_FINE, Math.ceil(dist(ns[k], ns[k + 1]) / fine));
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
  const capLo = loop.length;
  rim(ns[n - 1], angIn(n - 1) - off(n - 1), angIn(n - 1) + off(n - 1));
  const capHi = loop.length - 1;
  for (let k = n - 2; k >= 0; k--) {
    side(k, 1);
    if (k > 0) node(k, angOut(k) + off(k), angIn(k) + off(k));
  }
  // The last sample is segment 0's u = 0 on the back side, which is the same
  // point the start cap opened on, so drop it and let the loop close.
  const first = loop[0];
  while (loop.length > 1) {
    const last = loop[loop.length - 1];
    if (Math.abs(last.x - first.x) > same || Math.abs(last.y - first.y) > same) break;
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
  const tol2 = o.outlineTol * o.outlineTol * o.maxWidth * o.maxWidth;

  // The outline's `fitHorizon`: a hop may not span more than this, however well
  // a cubic would have covered it.
  //
  // Without it a hop is bounded only by the tolerance, and on a smooth fast
  // stroke that let one cubic swallow 32px of outline where `sampled` was
  // placing a contact every 4.6px. That matters because a hop reaching into the
  // still-unsettled zone near the pen re-decides its endpoint every frame, and
  // re-anchors every hop after it -- so the last contact you could trust sat a
  // whole hop further back than the unsettled nodes themselves, and churn
  // reached ~40px behind the pen against `fit`'s 7px. Capping the span trades a
  // few more contacts for a much shorter reach.
  const hopMax = o.outlineHorizon * o.maxWidth;
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

  // Sample 0 sits on node 0's disc, which never moves once the stroke has
  // started, so it is the one place on the loop that can be pinned. BOTH walks
  // start there and run outward, meeting in the end cap.
  //
  // The point is that a hop should be decided by data behind it. Walking once
  // round the loop instead would cross the end cap, which sits at the pen, so
  // the whole back side would re-anchor every frame. Walking outward from the
  // pinned start means only the two hops that meet at the cap are redrawn.
  //
  // Measured, this is NOT what limits how soon laid ink stops moving: the
  // outline is only as settled as the nodes under it, and `fitCurve` keeps
  // revising node magnitudes until the open segment commits, which is roughly
  // `fitHorizon` px behind the pen. Contacts here are exact-stable well before
  // that. Placement is anchored this way because it is the right shape for the
  // problem, not because it bought stability on its own.
  const meet = Math.max(capLo, Math.min(capHi, (capLo + capHi) >> 1));
  const cuts = [...cut].filter((i) => i > 0 && i < N).sort((a, b) => a - b);
  // [lo, hi] chopped at the folds inside it, ascending. A hop may not reach
  // across a fold, so each piece is walked on its own.
  const pieces = (lo: number, hi: number): [number, number][] => {
    const out: [number, number][] = [];
    let s = lo;
    for (const c of cuts)
      if (c > lo && c <= hi) {
        out.push([s, c - 1]);
        s = c;
      }
    out.push([s, hi]);
    return out;
  };

  const keep = new Set<number>([0]);
  // Extend from `from` towards `to` -- either direction -- keeping a contact
  // wherever the hop can go no further. The hop grows by doubling and is then
  // bisected back to the last end that passed: stepping one sample at a time
  // would retest the whole hop on every step, and the outline is sampled far
  // too finely for that. The test is not monotone in hop length, so this can
  // settle on a longer passing hop than a step-by-step walk would; either way
  // every hop committed passed the test.
  const walk = (from: number, to: number) => {
    const dir = to > from ? 1 : -1;
    const reach = (a: number, k: number) => {
      const b = a + dir * k;
      return dir > 0 ? Math.min(b, to) : Math.max(b, to);
    };
    const ok = (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return S[hi] - S[lo] <= hopMax && covers(lo, hi);
    };
    let a = from;
    while ((to - a) * dir > 1) {
      let pass = reach(a, 1); // a hop to the next sample spans nothing to fail
      let fail = -1;
      for (let step = 2; step <= MAX_HOP; step *= 2) {
        const b = reach(a, step);
        if ((b - pass) * dir <= 0) break;
        if (!ok(a, b)) {
          fail = b;
          break;
        }
        pass = b;
        if (b === to) break;
      }
      if (fail !== -1) {
        while (Math.abs(fail - pass) > 1) {
          const mid = pass + (((fail - pass) / 2) | 0);
          if (ok(a, mid)) pass = mid;
          else fail = mid;
        }
      }
      if (pass === to) break;
      keep.add(pass);
      a = pass;
    }
  };

  // Out from the pin along the forward side, into the cap.
  for (const [lo, hi] of pieces(0, meet)) {
    keep.add(lo);
    keep.add(hi);
    walk(lo, hi);
  }
  // Out from the pin along the back side, into the cap from the other end.
  // `seq[N]` is `seq[0]`, so the high end of each piece is the one nearer the
  // start of the stroke, and that is the end to anchor on.
  for (const [lo, hi] of pieces(meet, N)) {
    keep.add(lo);
    keep.add(hi === N ? 0 : hi);
    walk(hi, lo);
  }

  // Contacts come out in loop order whichever way they were decided.
  return [...keep].sort((a, b) => a - b).map((i) => seq[i]);
}

// --- the engine ---

// Reads: fitTol, fitCornerAngle, fitWindow, fitHorizon, outlineTol, outlineHorizon.
export function greedyEngine(distinct: Point4[], o: Required<RenderOptions>): Shape {
  const nodes = fitCurve(distinct, o);
  return { nodes, outline: toOutlineGreedy(nodes, o) };
}
