import { basis, type CenterlineNode, fitCurve, type FitOptions } from "../centerline/fit.ts";
import type { Shape } from "../engine.ts";
import { chordRule, clamp11, dist, type Point4, wrapPi } from "../math.ts";
import { contactAt, discLoop, type OutlineNode, wrapZeroTau } from "./contact.ts";

// Nodes from `fitCurve`, then the outline sampled densely once round and
// walked greedily: a contact only where the cubic that would otherwise be drawn
// strays more than `outlineTol` from those samples.
//
// There are no cap, corner or arc constructions because the outline is ONE
// CURVE -- sides are the pen envelope, caps and the outside of a corner are its
// rim, and they meet tangentially. The one exception is the INSIDE of a corner,
// where the two pieces cross instead of meeting; a hop must not span that, so
// it gets a cut and nonzero winding fills the fold.
//
// A variant should copy this file's envelope math rather than share it, so the
// two can be compared without moving each other. See `engine.ts`.

export type GreedyOptions = {
  maxWidth?: number; // width at a standstill; the unit the lengths below are measured in
  outlineTol?: number; // × maxWidth the drawn outline may stray from the envelope
  outlineHorizon?: number; // × maxWidth one outline hop may span
};

// Below this the node's tangents agree to within noise: not a corner.
const SMOOTH_TURN = 0.02;
// × maxWidth between the samples the tube test sees, so it bounds how short a
// feature can be and still cost a contact. Pen-relative, not pixels: an
// absolute step put twice as many samples on the same curve when the drawing
// was scaled up, moving every index the walk probes -- which is what stopped
// this engine reproducing its own shape at another scale.
const FINE_STEP = 0.0625;
const MIN_FINE = 8; // samples per centerline segment at the very least
// Samples one hop may span, so a pathological run cannot cost quadratic time.
const MAX_HOP = 512;
// × maxWidth: closer than this and two samples are the same point.
const SAME = 1e-10;

export function toOutlineGreedy(ns: CenterlineNode[], o: Required<GreedyOptions>): OutlineNode[] {
  const n = ns.length;
  if (n === 0) return [];
  if (n === 1) return discLoop(ns[0]);

  const off = (i: number) => Math.acos(clamp11(-ns[i].slope));
  const angIn = (i: number) => Math.atan2(ns[i].iy, ns[i].ix);
  const angOut = (i: number) => Math.atan2(ns[i].oy, ns[i].ox);

  // The fitted centerline of segment k at u.
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
  // against. At u = 0 and 1 it lands exactly on the rim, which is what lets the
  // rim stretches and the sides be one curve.
  const envelope = (k: number, s: 1 | -1, u: number): OutlineNode => {
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

  const loop: OutlineNode[] = [];
  // `cut[i]` marks a break in the curve immediately before sample i.
  const cut = new Set<number>();
  const add = (c: OutlineNode, force = false) => {
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
  // Outside the bend the rim carries the turn; inside, the two pieces cross and
  // the curve is cut.
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
    // Forced after a cut so the fold's far lip survives the coincidence check.
    const force = cut.has(loop.length);
    for (let j = 0; j <= m; j++)
      add(envelope(k, s, s === -1 ? j / m : 1 - j / m), force && j === 0);
  };

  // Start cap, forward side, end cap, back. A cap is just a rim stretch.
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
  // The last sample is where the start cap opened; drop it and let it close.
  const first = loop[0];
  while (loop.length > 1) {
    const last = loop[loop.length - 1];
    if (Math.abs(last.x - first.x) > same || Math.abs(last.y - first.y) > same) break;
    loop.pop();
  }
  const N = loop.length;
  if (N < 2) return loop;

  // --- 2. keep only the contacts the tolerance demands ---

  // `seq` repeats the first sample so the closing hop is an ordinary one.
  const seq = [...loop, loop[0]];
  const S = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) S[i] = S[i - 1] + dist(seq[i - 1], seq[i]);

  // Does the chord-rule cubic a..b pass within `tol` of every sample between?
  // Two Newton steps per sample, as `fitCurve` does on the centerline.
  const tol2 = o.outlineTol * o.outlineTol * o.maxWidth * o.maxWidth;

  // The outline's `fitHorizon`. Uncapped, one cubic swallowed 32px of outline
  // where a fixed-step engine placed a contact every 4.6px -- and a long hop
  // reaching into the unsettled ink at the pen re-decides every frame and
  // re-anchors every hop behind it, dragging churn ~40px back.
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

  // Sample 0 is on node 0's disc, the one place on the loop that never moves,
  // so both walks start there and run outward to meet in the end cap. Walking
  // once round instead would cross the cap at the pen and re-anchor the whole
  // back side every frame. (Measured, this is not what limits settling --
  // `fitCurve` revising the open segment is.)
  const meet = Math.max(capLo, Math.min(capHi, (capLo + capHi) >> 1));
  const cuts = [...cut].filter((i) => i > 0 && i < N).sort((a, b) => a - b);
  // [lo, hi] chopped at the folds inside it: a hop may not reach across one.
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
  // Keep a contact wherever the hop can go no further. It grows by doubling
  // then bisects back to the last end that passed -- stepping one sample at a
  // time would retest the whole hop each step. The test is not monotone in hop
  // length, so this can settle on a longer passing hop than a walk would.
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
  // Back side. `seq[N]` is `seq[0]`, so each piece's high end is the one nearer
  // the stroke start, and that is the end to anchor on.
  for (const [lo, hi] of pieces(meet, N)) {
    keep.add(lo);
    keep.add(hi === N ? 0 : hi);
    walk(hi, lo);
  }

  // Contacts come out in loop order whichever way they were decided.
  return [...keep].sort((a, b) => a - b).map((i) => seq[i]);
}

export function greedyEngine(distinct: Point4[], o: Required<FitOptions & GreedyOptions>): Shape {
  const nodes = fitCurve(distinct, o);
  return { centerline: nodes, outline: toOutlineGreedy(nodes, o) };
}
