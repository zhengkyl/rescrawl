import { chordRule, dist, lerp } from "./math.ts";
import type { FitNode, Point4, RenderOptions } from "./types.ts";

// Stage 4, centerline half: which samples survive as nodes, and what each node
// records about the path through it. The outline half is in `greedy.ts`.
//
// Two things were measured and must not be re-added. There is no separate live
// path -- a growing stroke is fitted exactly like a finished one. A settled
// edge holding back the last 2·fitWindow px was tried and moved the settle
// boundary 12-24px FURTHER behind the pen, because withholding samples leaves
// more of the stroke drawn raw and judged later. And there is no line-first
// rule: a chord that passes the tube test leaves a tangent break at each end,
// which a wide pen shows as a kink. Only detected corners break tangency.

const DEG = Math.PI / 180;

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

// Least-squares Hermite magnitudes, held within MAG_RANGE of the chord rule:
// with one or two samples the system is barely determined and can return a
// curve that loops between them.
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

export function fitCurve(pts: Point4[], o: Required<RenderOptions>): FitNode[] {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return [single(pts[0])];

  // Cumulative chord length
  const S = new Float64Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + dist(pts[i - 1], pts[i]);

  const D = o.fitWindow * o.maxWidth;

  // First index at least D behind / ahead of i along the stroke, clamped. Used
  // where an index is what is wanted: loop bounds, and the corner scan.
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

  // Interpolated at exactly D, not snapped to the next sample past it.
  // Snapping made the arm `D plus the sample gap`: on a stroke sampled every
  // 27px the arm measured 26.5 against a nominal 6, so `fitWindow` did nothing.
  // Equal arms also make the secant a true central difference.
  type Arm = { x: number; y: number; r: number; s: number };
  const armBack = (i: number, lo: number): Arm => {
    let j = i;
    while (j > lo && S[i] - S[j] < D) j--;
    const target = S[i] - D;
    if (j === i || target <= S[j]) return { x: pts[j].x, y: pts[j].y, r: pts[j].r, s: S[j] };
    const seg = S[j + 1] - S[j];
    const f = seg > 0 ? (target - S[j]) / seg : 0;
    return {
      x: lerp(pts[j].x, pts[j + 1].x, f),
      y: lerp(pts[j].y, pts[j + 1].y, f),
      r: lerp(pts[j].r, pts[j + 1].r, f),
      s: target,
    };
  };
  const armFwd = (i: number, hi: number): Arm => {
    let j = i;
    while (j < hi && S[j] - S[i] < D) j++;
    const target = S[i] + D;
    if (j === i || target >= S[j]) return { x: pts[j].x, y: pts[j].y, r: pts[j].r, s: S[j] };
    const seg = S[j] - S[j - 1];
    const f = seg > 0 ? (target - S[j - 1]) / seg : 0;
    return {
      x: lerp(pts[j - 1].x, pts[j].x, f),
      y: lerp(pts[j - 1].y, pts[j].y, f),
      r: lerp(pts[j - 1].r, pts[j].r, f),
      s: target,
    };
  };

  // --- corners ---
  const angle = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const p = armBack(i, 0);
    const c = pts[i];
    const q = armFwd(i, n - 1);
    const ax = c.x - p.x;
    const ay = c.y - p.y;
    const bx = q.x - c.x;
    const by = q.y - c.y;
    angle[i] = Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  }
  // A retrace reads a flat 180 degrees across several samples, so the local max
  // is a plateau. Landing the corner before the turnaround leaves the tip
  // interior to the outgoing run, with a tangent that only sees the way back --
  // the outline then cuts across the tip instead of wrapping it. The turnaround
  // is the sample whose own neighbours point against each other.
  const turns = new Uint8Array(n);
  for (let i = 1; i < n - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x;
    const ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x;
    const by = pts[i + 1].y - pts[i].y;
    if (ax * bx + ay * by < 0) turns[i] = 1;
  }
  // A reversal outranks a merely-sharp sample whatever the angles say. Using it
  // only to settle exact ties fails: across a plateau the angles differ in their
  // last bits and never compare equal. `i` has always cleared the threshold.
  const SHARP = o.fitCornerAngle * DEG;
  const rank = (j: number, i: number) => {
    if (angle[j] < SHARP) return -1;
    if (turns[j] !== turns[i]) return turns[j] < turns[i] ? -1 : 1;
    return angle[j] === angle[i] ? 0 : angle[j] < angle[i] ? -1 : 1;
  };

  const corner = new Uint8Array(n);
  for (let i = 1; i < n - 1; i++) {
    if (angle[i] < SHARP) continue;
    // Local max over ±D; among equals the turnaround wins, then the earlier point.
    let max = true;
    for (let j = back(i, 0); max && j < i; j++) max = rank(j, i) < 0;
    for (let j = i + 1, hi = fwd(i, n - 1); max && j <= hi; j++) max = rank(j, i) <= 0;
    if (max) corner[i] = 1;
  }

  // `tin` arrives, `tout` leaves; they differ only at corners.
  const tin = new Float64Array(2 * n);
  const tout = new Float64Array(2 * n);
  const secant = (i: number, lo: number, hi: number, into: Float64Array) => {
    const p = armBack(i, lo);
    const q = armFwd(i, hi);
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
      // the one it starts.
      if (i > lo) secant(i, lo, hi, tin);
      if (i < hi) secant(i, lo, hi, tout);
    }
  }
  // The stroke's own ends only have one side.
  tin[0] = tout[0];
  tin[1] = tout[1];
  tout[2 * (n - 1)] = tin[2 * (n - 1)];
  tout[2 * (n - 1) + 1] = tin[2 * (n - 1) + 1];

  // dr/ds. Not cut at corners -- radius does not care about direction -- and
  // shared by both segments at a node, so the envelope stays continuous there.
  const slope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = armBack(i, 0);
    const q = armFwd(i, n - 1);
    const ds = q.s - p.s;
    slope[i] = ds > 0 ? (q.r - p.r) / ds : 0;
  }

  // Room between the sample's RIM and the tube wall at u: a fat sample is held
  // to a tighter line than a thin one.
  const inTube = (a: Point4, b: Point4, p: Point4, u: number, dx: number, dy: number) => {
    const gap = lerp(a.r, b.r, u) - p.r + o.fitTol * p.r;
    return gap > 0 && dx * dx + dy * dy <= gap * gap;
  };

  // Magnitudes for ai..bi, or null if a sample between escapes the tube.
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
      // Chord-length u overstates the distance; two Newton steps fix it.
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

  // The last run's closing segment is the open one while the pen is down.
  const runs = [0];
  for (let i = 1; i < n - 1; i++) if (corner[i]) runs.push(i);
  runs.push(n - 1);
  for (let k = 0; k < runs.length - 1; k++) {
    const lo = runs[k];
    const hi = runs[k + 1];
    let a = lo;
    let i = lo + 1;
    // A two-point segment has nothing between its ends, so it always fits.
    let fit = cubicCovers(a, i)!;
    while (i < hi) {
      if (i - a < MAX_RUN && S[i + 1] - S[a] <= o.fitHorizon * o.maxWidth) {
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

  return nodes;
}
