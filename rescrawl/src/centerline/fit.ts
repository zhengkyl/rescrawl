import type { Point4 } from "../math.ts";
import { chordRule, dist, lerp } from "../math.ts";

// The segment between two nodes is a Hermite cubic from the first's out-tangent
// (`ox`, `oy`, magnitude `mo`) to the second's in-tangent (`ix`, `iy`, `mi`).
// Zero magnitudes at both ends read as a straight chord. In- and out-tangents
// differ only at a corner. The radius runs as a Hermite too, with `slope`
// (dr/ds) as its derivative.
export type CenterlineNode = Point4 & {
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  mi: number;
  mo: number;
  slope: number; // dr/ds: how fast the radius grows along the stroke here
};

export type FitOptions = {
  maxWidth?: number;
  //
  fitTol?: number; // ink the shape may gain where a sample is dropped, as a fraction of local r
  fitCornerAngle?: number; // deg; a turn sharper than this over `fitWindow` is a corner
  fitWindow?: number; // × maxWidth either side of a point that turn, tangent and radius slope are read over
  fitHorizon?: number; // × maxWidth a segment may span before it commits regardless
};

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

const single = (p: Point4): CenterlineNode => ({
  ...p,
  ix: 1,
  iy: 0,
  ox: 1,
  oy: 0,
  mi: 0,
  mo: 0,
  slope: 0,
});

// What one call settled, handed to the next so it can resume instead of
// refitting from sample 0.
//
// Every decision the fit makes is local: a tangent reads D either side, a
// corner D beyond that, and a segment end is decided by trying one sample past
// it. So once the pen is far enough past a node, nothing more of the stroke can
// change it, or anything before it. Such a node is settled, and the next call
// starts its greedy walk there, recomputing the per-sample arrays only past it.
//
// Nothing here is trusted: the stages before the fit are rerun from raw every
// frame and may rewrite the tail (the radius of the last sample, a disc popped
// by `dropContained`, a smoothing window that has not closed). The next call
// compares its input against `pts` over everything the settled nodes read, and
// resumes from the last node whose reads all still match -- or from scratch.
export type FitCache = {
  o: Required<FitOptions>;
  pts: Point4[]; // the input this was computed from
  S: Float64Array;
  angle: Float64Array;
  turns: Uint8Array;
  corner: Uint8Array;
  tin: Float64Array;
  tout: Float64Array;
  slope: Float64Array;
  nodes: CenterlineNode[]; // the whole output, settled or not
  idx: number[]; // sample index of each settled node; nodes[0..idx.length) are settled
  reach: number[]; // the last sample each settled node's decisions read
};

const sameOptions = (a: Required<FitOptions>, b: Required<FitOptions>) =>
  a.maxWidth === b.maxWidth &&
  a.fitTol === b.fitTol &&
  a.fitCornerAngle === b.fitCornerAngle &&
  a.fitWindow === b.fitWindow &&
  a.fitHorizon === b.fitHorizon;

const samePoint = (a: Point4, b: Point4) =>
  a.x === b.x && a.y === b.y && a.t === b.t && a.r === b.r;

export function fitCurve(pts: Point4[], o: Required<FitOptions>): CenterlineNode[] {
  return fitCurveIncremental(pts, o, null).nodes;
}

// `fitCurve`, resuming from what `prev` settled. The output is identical to a
// fresh fit of `pts` -- the cache only decides how much of it is recomputed.
// `reused` is how many leading nodes came from `prev`.
export function fitCurveIncremental(
  pts: Point4[],
  o: Required<FitOptions>,
  prev: FitCache | null,
): { nodes: CenterlineNode[]; cache: FitCache | null; reused: number } {
  const n = pts.length;
  if (n === 0) return { nodes: [], cache: null, reused: 0 };
  if (n === 1) return { nodes: [single(pts[0])], cache: null, reused: 0 };

  // --- where to resume ---
  // `keep` settled nodes carry over, the last of them at sample A. The first
  // sample that differs from `prev`'s input is k; a node is kept only if
  // everything it read lies before k.
  let keep = 0;
  let A = 0;
  if (prev !== null && prev.idx.length > 0 && sameOptions(prev.o, o)) {
    const lim = Math.min(prev.reach[prev.reach.length - 1], n - 1, prev.pts.length - 1);
    let k = 0;
    while (k <= lim && samePoint(prev.pts[k], pts[k])) k++;
    keep = prev.idx.length;
    while (keep > 0 && prev.reach[keep - 1] >= k) keep--;
    if (keep > 0) A = prev.idx[keep - 1];
  }
  // Per-sample values below `from` are copied, not recomputed. A settled node's
  // own tangent is final, so resuming at A recomputes from A + 1.
  const from = keep > 0 ? A + 1 : 0;

  // Cumulative chord length
  const S = new Float64Array(n);
  if (keep > 0) S.set(prev!.S.subarray(0, from));
  for (let i = Math.max(from, 1); i < n; i++) S[i] = S[i - 1] + dist(pts[i - 1], pts[i]);

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
  if (keep > 0) angle.set(prev!.angle.subarray(0, from));
  for (let i = Math.max(from, 1); i < n - 1; i++) {
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
  if (keep > 0) turns.set(prev!.turns.subarray(0, from));
  for (let i = Math.max(from, 1); i < n - 1; i++) {
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
  if (keep > 0) corner.set(prev!.corner.subarray(0, from));
  for (let i = Math.max(from, 1); i < n - 1; i++) {
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
  if (keep > 0) {
    tin.set(prev!.tin.subarray(0, 2 * from));
    tout.set(prev!.tout.subarray(0, 2 * from));
  }
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
  // The run each sample lies in is bounded by corners and the stroke's ends. A
  // corner can only clamp an arm within D behind `from`, so the scan for the
  // run start stops there; past that, bounding at 0 reads the same.
  let lo = 0;
  for (let j = from - 1, stop = back(from, 0); j > 0 && j >= stop; j--) {
    if (corner[j]) {
      lo = j;
      break;
    }
  }
  let hi = 0; // the next bound after i
  for (let i = from; i < n; i++) {
    if (hi <= i) {
      hi = i + 1;
      while (hi < n - 1 && !corner[hi]) hi++;
    }
    const bound = i === 0 || i === n - 1 || corner[i] === 1;
    // A corner's in-tangent belongs to the run it ends, its out-tangent to
    // the one it starts.
    if (i > 0) secant(i, lo, bound ? i : hi, tin);
    if (bound) lo = i;
    if (i < n - 1) secant(i, lo, hi, tout);
  }
  // The stroke's own ends only have one side.
  if (from === 0) {
    tin[0] = tout[0];
    tin[1] = tout[1];
  }
  tout[2 * (n - 1)] = tin[2 * (n - 1)];
  tout[2 * (n - 1) + 1] = tin[2 * (n - 1) + 1];

  // dr/ds. Not cut at corners -- radius does not care about direction -- and
  // shared by both segments at a node, so the envelope stays continuous there.
  const slope = new Float64Array(n);
  if (keep > 0) slope.set(prev!.slope.subarray(0, from));
  for (let i = from; i < n; i++) {
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
  const nodeAt = (i: number): CenterlineNode => ({
    ...pts[i],
    ix: tin[2 * i],
    iy: tin[2 * i + 1],
    ox: tout[2 * i],
    oy: tout[2 * i + 1],
    mi: 0,
    mo: 0,
    slope: slope[i],
  });
  // Settled nodes are shared with `prev`'s output and never written again --
  // except the last, whose `mo` belongs to the segment about to be refitted,
  // so it is copied.
  const nodes: CenterlineNode[] =
    keep > 0 ? [...prev!.nodes.slice(0, keep - 1), { ...prev!.nodes[keep - 1] }] : [nodeAt(0)];
  const idx: number[] = keep > 0 ? prev!.idx.slice(0, keep) : [0];

  const commit = (bi: number, m: [number, number]) => {
    const a = nodes[nodes.length - 1];
    const b = nodeAt(bi);
    a.mo = m[0];
    b.mi = m[1];
    nodes.push(b);
    idx.push(bi);
  };

  // The last run's closing segment is the open one while the pen is down.
  let a = A;
  while (a < n - 1) {
    // this run ends at the next corner, or the stroke's end
    let end = a + 1;
    while (end < n - 1 && !corner[end]) end++;
    let i = a + 1;

    // A two-point segment has nothing between its ends, so it always fits.
    let fit = cubicCovers(a, i)!;
    while (i < end) {
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

    commit(end, fit);
    a = end;
  }

  // --- what is settled ---
  // Node b was ended by trying b + 1: that read b + 1's tangent, which read
  // the corners within D of it, which read the angles within D of those, which
  // read D further still -- three `fwd`s -- plus one sample for `turns`. If
  // that chain stops on distance before the last sample (which is where the
  // pen is, and changes every frame), nothing past it can change b.
  const reach = keep > 0 ? prev!.reach.slice(0, keep) : [];
  for (let j = reach.length; j < nodes.length; j++) {
    const b = idx[j];
    if (b + 1 > n - 1) break;
    const r = fwd(fwd(fwd(b + 1, n - 1), n - 1), n - 1) + 1;
    if (r > n - 2) break;
    reach.push(r);
  }

  const cache: FitCache = {
    o: {
      maxWidth: o.maxWidth,
      fitTol: o.fitTol,
      fitCornerAngle: o.fitCornerAngle,
      fitWindow: o.fitWindow,
      fitHorizon: o.fitHorizon,
    },
    pts,
    S,
    angle,
    turns,
    corner,
    tin,
    tout,
    slope,
    nodes,
    idx: idx.slice(0, reach.length),
    reach,
  };
  return { nodes, cache, reused: keep };
}
