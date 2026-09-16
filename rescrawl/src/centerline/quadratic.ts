import type { CenterlineNode, FitOptions } from "./fit.ts";
import { dist, lerp } from "../math.ts";
import type { Point4 } from "../math.ts";

// `fitCurve` with quadratic segments instead of cubic: the same samples, the
// same tangents, corners and tube test, and one quadratic per segment where
// `fitCurve` has a cubic. An experiment, copied rather than shared so the two
// can be compared without moving each other.
//
// What that costs: a cubic on fixed end tangents still has two free
// magnitudes to hug the samples with, and a quadratic has none -- the tangents
// pin its control point. It also cannot inflect or turn 180 degrees. What it
// buys: the nearest point on it has a closed form, where the cubic takes Newton.

const DEG = Math.PI / 180;

const MAX_RUN = 64;
// Tangents closer to parallel than this (as a cross product) never meet.
const PARALLEL = 1e-9;
// Legs longer than this many chords together are a near-parallel artefact,
// not a shape.
const MAG_RANGE = 3;
// Hermite magnitudes of zero: a straight chord.
const LINE: [number, number] = [0, 0];

// Real roots of a·t³ + b·t² + c·t + d, dropping to lower degree where the
// leading coefficients vanish. Cardano, with the trigonometric form for three
// real roots.
function solveCubic(a: number, b: number, c: number, d: number): number[] {
  const scale = Math.max(Math.abs(b), Math.abs(c), Math.abs(d));
  if (Math.abs(a) <= 1e-12 * scale) {
    if (Math.abs(b) <= 1e-12 * scale) return c === 0 ? [] : [-d / c];
    const disc = c * c - 4 * b * d;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [(-c + s) / (2 * b), (-c - s) / (2 * b)];
  }
  const B = b / a;
  const C = c / a;
  const Dd = d / a;
  const p = C - (B * B) / 3;
  const q = (2 * B * B * B) / 27 - (B * C) / 3 + Dd;
  const shift = -B / 3;
  const disc = (q * q) / 4 + (p * p * p) / 27;
  if (disc > 0) {
    const s = Math.sqrt(disc);
    return [Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s) + shift];
  }
  if (p === 0) return [shift];
  const r = 2 * Math.sqrt(-p / 3);
  const k = ((3 * q) / (2 * p)) * Math.sqrt(-3 / p);
  const phi = Math.acos(k < -1 ? -1 : k > 1 ? 1 : k) / 3;
  return [
    r * Math.cos(phi) + shift,
    r * Math.cos(phi - (2 * Math.PI) / 3) + shift,
    r * Math.cos(phi - (4 * Math.PI) / 3) + shift,
  ];
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

export function fitQuadratic(pts: Point4[], o: Required<FitOptions>): CenterlineNode[] {
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

  // The one quadratic ai..bi on the stored tangents, or null if there is none
  // or a sample between escapes the tube. Nothing is solved: with both end
  // tangents fixed, the control point can only be where their lines meet.
  // Returned as Hermite magnitudes -- a quadratic's end tangents are twice the
  // legs to its control point -- so every consumer of nodes reads it unchanged.
  const quadCovers = (ai: number, bi: number): [number, number] | null => {
    const a = pts[ai];
    const b = pts[bi];
    const tax = tout[2 * ai];
    const tay = tout[2 * ai + 1];
    const tbx = tin[2 * bi];
    const tby = tin[2 * bi + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const chord = Math.sqrt(dx * dx + dy * dy);
    if (chord === 0) return null;

    // a + lam·ta = b - mu·tb. Both legs must run forwards: a negative one is an
    // inflection, which no quadratic has.
    let lam: number;
    let mu: number;
    const det = tax * tby - tay * tbx;
    if (Math.abs(det) < PARALLEL) {
      // Parallel tangents meet nowhere; only a straight run along them works.
      if (tax * tbx + tay * tby < 0 || Math.abs(tax * dy - tay * dx) > PARALLEL * chord)
        return null;
      lam = mu = chord / 2;
    } else {
      lam = (dx * tby - dy * tbx) / det;
      mu = (tax * dy - tay * dx) / det;
      if (!(lam > 0 && mu > 0) || lam + mu > MAG_RANGE * chord) return null;
    }

    // P(t) = a + 2t·v + t²·w, with v = c - a and w = a - 2c + b.
    const vx = lam * tax;
    const vy = lam * tay;
    const wx = dx - 2 * vx;
    const wy = dy - 2 * vy;
    const vv = vx * vx + vy * vy;
    const vw = vx * wx + vy * wy;
    const ww = wx * wx + wy * wy;
    for (let j = ai + 1; j < bi; j++) {
      const p = pts[j];
      const e0x = a.x - p.x;
      const e0y = a.y - p.y;
      // Nearest point, exactly: (P - p)·P' = 0 is a cubic in t. Every real root
      // in [0, 1] is a candidate, and so are both ends.
      const roots = solveCubic(ww, 3 * vw, 2 * vv + e0x * wx + e0y * wy, e0x * vx + e0y * vy);
      let u = 0;
      let ex = e0x;
      let ey = e0y;
      let best = ex * ex + ey * ey;
      for (const t of [...roots, 1]) {
        if (!(t > 0 && t <= 1)) continue;
        const cx = e0x + 2 * t * vx + t * t * wx;
        const cy = e0y + 2 * t * vy + t * t * wy;
        const d2 = cx * cx + cy * cy;
        if (d2 < best) {
          best = d2;
          u = t;
          ex = cx;
          ey = cy;
        }
      }
      if (!inTube(a, b, p, u, ex, ey)) return null;
    }
    return [2 * lam, 2 * mu];
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
  const nodes: CenterlineNode[] = [nodeAt(0)];

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
    // A two-point segment has nothing between its ends to escape the tube, but
    // its tangents may still admit no quadratic; then it is the chord.
    let fit = quadCovers(a, i) ?? LINE;
    while (i < hi) {
      if (i - a < MAX_RUN && S[i + 1] - S[a] <= o.fitHorizon * o.maxWidth) {
        const m = quadCovers(a, i + 1);
        if (m) {
          fit = m;
          i++;
          continue;
        }
      }
      commit(i, fit);
      a = i;
      i = a + 1;
      fit = quadCovers(a, i) ?? LINE;
    }
    commit(hi, fit);
  }

  return nodes;
}
