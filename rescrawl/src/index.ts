// rescrawl — turn a single recorded stroke into renderable ink geometry: one
// closed outline (the filled shape), plus its centerline for reference.
//
// Width comes from speed alone. The slower the pen was moving into a sample, the
// wider the ink; a pen that barely moved is widest. A pause is therefore not a
// special case with its own rule — it is simply the limit of "slow", so ink
// pools where the pen lingered and thins where it swept.
//
// The pipeline consumes time first and never looks at it again:
//
//   samples (x,y,t) → widths → points (x,y,half) → simplify → outline → path
//
// Stage 1 turns timing into a half-width per sample. Stage 2 resolves runs of
// coincident samples — which carry a width change but no shape — into real
// geometry. After that, no stage knows what time is.
//
// Stability: the renderer is called fresh with a growing prefix (live drawing,
// replay scrubbing). The width filter is causal and simplification is greedy
// from the start, so only the trailing run can still change.

export type StrokePoint = { x: number; y: number; t: number };
export type Stroke = StrokePoint[];

export type RenderOptions = {
  minWidth?: number; // width when moving at or above `thinSpeed`
  maxWidth?: number; // width at a standstill
  thinSpeed?: number; // px/ms at which the stroke reaches minWidth
  widthLag?: number; // ms of elapsed time for the width to catch up
  widthSpan?: number; // px of travel for the width to catch up
  simplify?: number; // px: drop points within this of the chord (0 = off)
};

export type StrokeRender = {
  curve: string; // centerline path `d`
  shapes: string[]; // the filled outline
  width: number; // max full width
};

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  minWidth: 1.5,
  maxWidth: 8,
  thinSpeed: 1,
  widthLag: 80,
  widthSpan: 30,
  simplify: 0.75,
};

const COINCIDENT_EPS = 0.5; // px — closer than this counts as the same position
const MAX_SLOPE = 0.5; // cap on d(half)/ds where a pool steps up from a thin approach
const CORNER_STEPS = 13; // fan segments used to round a turn past 90°
const CAP_STEPS = 16; // segments in each end cap

// --- small helpers ---

const r = (n: number) => Math.round(n * 100) / 100;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

type Vec = { x: number; y: number };

// A resolved point: a position and the half-width of the ink there. Time has
// already been folded into `half` by the time one of these exists.
type Pt = { x: number; y: number; half: number };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function rotate(p: Vec, c: Vec, a: number): Vec {
  const s = Math.sin(a),
    k = Math.cos(a);
  const dx = p.x - c.x,
    dy = p.y - c.y;
  return { x: dx * k - dy * s + c.x, y: dx * s + dy * k + c.y };
}

// --- stage 1: timing → width ---
//
// The target width is set by the speed into each sample: `thinSpeed` or faster
// is minWidth, a standstill is maxWidth. A first-order filter chases that target
// so width can never jump between neighbours, which is what removes the need for
// a separate smoothing pass over the width series.
//
// The filter's gain advances with ELAPSED TIME. That is the load-bearing choice:
// a library without timestamps has to make the gain proportional to distance
// instead, and a distance gain is exactly zero while the pen is stationary — it
// would freeze the width at the moment you stop, precisely where we want it to
// keep pooling. A zero-length segment carries no time either, so it is skipped
// rather than treated as infinitely fast.
function halfWidths(stroke: Stroke, o: Required<RenderOptions>): number[] {
  const lo = o.minWidth / 2,
    hi = o.maxWidth / 2;
  const half = [lo];
  let p = 0; // 0 = thinnest, 1 = thickest
  for (let i = 1; i < stroke.length; i++) {
    const dt = stroke[i].t - stroke[i - 1].t;
    if (dt > 0) {
      const ds = dist(stroke[i], stroke[i - 1]);
      const target = clamp01(1 - ds / dt / o.thinSpeed);
      // 1 - e^(-x) is the exact discretisation of a first-order filter, so the
      // result depends only on how far the filter advanced and not on how the
      // samples happened to be spaced. (A bare x would do the same for small
      // steps but has to clamp at 1, which would make every pause longer than
      // `widthLag` land on maxWidth — a flicked tap and a deliberate hold would
      // render identically.)
      //
      // The filter advances with elapsed time AND with distance travelled,
      // whichever gets there first. Time alone lets a pause pool the ink, but
      // leaves the pooled width trailing through the flick that follows, because
      // a fast stroke covers a lot of ground in very little time. Distance alone
      // — all a library without timestamps can use — freezes while the pen is
      // stationary, exactly where pooling needs to happen. Ink needs both.
      p += (target - p) * (1 - Math.exp(-(dt / o.widthLag + ds / o.widthSpan)));
    }
    half.push(lerp(lo, hi, p));
  }
  return half;
}

// --- stage 2: pooled width → geometry ---
//
// A pause records several samples at one position (the draw loop's per-frame tip
// while live, the pen-up sample once committed). They carry a width change but
// no shape, and a zero-length segment has no direction to offset perpendicular
// to. The same thing happens without exact coincidence — a pen that pauses,
// jitters a pixel and moves on climbs several px of width across one px of path.
//
// So collapse each coincident run to the width it *leaves* with, and before
// emitting any point whose width climbs faster than MAX_SLOPE, insert a holding
// point upstream at the approach width.
//
// KNOWN BROKEN: the guard implies rise/MAX_SLOPE > ds, so the min() below always
// picks ds * 0.9 — the slope term is unreachable and the ramp only ever shortens
// the transition by 10%. Left as-is pending a decision on what replaces it.
function resolve(stroke: Stroke, half: number[]): Pt[] {
  const pts: Pt[] = [];

  function push(x: number, y: number, h: number) {
    const prev = pts[pts.length - 1];
    if (prev) {
      const ds = dist({ x, y }, prev);
      const rise = h - prev.half;
      if (ds > 0 && rise > ds * MAX_SLOPE) {
        const back = Math.min(rise / MAX_SLOPE, ds * 0.9);
        pts.push({
          x: x - ((x - prev.x) / ds) * back,
          y: y - ((y - prev.y) / ds) * back,
          half: prev.half,
        });
      }
    }
    pts.push({ x, y, half: h });
  }

  let i = 0;
  while (i < stroke.length) {
    const at = stroke[i];
    let j = i;
    while (
      j + 1 < stroke.length &&
      Math.abs(stroke[j + 1].x - at.x) < COINCIDENT_EPS &&
      Math.abs(stroke[j + 1].y - at.y) < COINCIDENT_EPS
    )
      j++;
    push(at.x, at.y, half[j]);
    i = j + 1;
  }
  return pts;
}

// --- stage 3: decimate ---
//
// Greedy walk from an anchor, extending while every interior point stays within
// `eps` of the chord — in position AND in width, parameterized by arc length.
// Testing width too means a point carrying a width change survives even where
// the path is straight, which is what keeps the pool geometry above from being
// decimated away as "collinear".
//
// Greedy from the start rather than a global split (Douglas–Peucker): a global
// rule re-picks its split points as the stroke grows, so already-drawn geometry
// would shift.
//
// The last point is never used as a chord endpoint. While the pen is down it is
// the only point whose width is still moving — a pause keeps widening it every
// frame — and a chord anchored there re-interpolates every point dropped behind
// it, on every frame. That is what made a pause visibly re-thin the stroke it
// grew out of: the run behind the pen stayed collapsed while the chord to the
// swelling endpoint smeared the pool backwards over it, until the deviation
// finally crossed `eps` and the true, thinner widths snapped back. Excluding it
// costs one extra kept point and makes everything behind the pen immutable.
function decimate(pts: Pt[], eps: number): Pt[] {
  const n = pts.length;
  if (n <= 2 || eps <= 0) return pts;

  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));

  // Does every interior point of [a..end] sit within `eps` of the chord?
  function fits(a: number, k: number, end: number): boolean {
    const span = cum[end] - cum[a];
    if (span <= 0) return false;
    for (let j = a + 1; j <= k; j++) {
      const s = (cum[j] - cum[a]) / span;
      if (
        Math.abs(pts[j].x - lerp(pts[a].x, pts[end].x, s)) > eps ||
        Math.abs(pts[j].y - lerp(pts[a].y, pts[end].y, s)) > eps ||
        Math.abs(pts[j].half - lerp(pts[a].half, pts[end].half, s)) > eps
      )
        return false;
    }
    return true;
  }

  const out = [pts[0]];
  let a = 0;
  while (a < n - 1) {
    // `k < n - 2` stops the run one short, so `end` never reaches the last point.
    let k = a + 1;
    while (k < n - 2 && fits(a, k, k + 1)) k++;
    out.push(pts[k]);
    a = k;
  }
  return out;
}

// --- stage 4: outline ---
//
// Walk the points offsetting perpendicular to the direction of travel, collecting
// a left and a right edge, then join them into one closed loop with a cap at each
// end. The offset direction blends the incoming and outgoing headings by how
// aligned they are, so straight runs use the plain perpendicular and bends ease
// between the two.
//
// Nothing rotates the contact point along the tangent, so a steep width change
// cannot fold the edge back over itself — which is why there is no pass here to
// drop circles contained inside their neighbours.
//
// Where the path turns past 90° the two offset edges would cross, so instead of
// an offset pair we sweep a fan of points around that point: a real round join
// inside the same contour, rather than a disc patched over the seam afterwards.
function outlinePoints(pts: Pt[]): Vec[] {
  const n = pts.length;
  if (n === 1) return circle(pts[0], pts[0].half);

  // Unit heading into each point, pointing back toward the previous one.
  const head: Vec[] = new Array(n);
  for (let i = 1; i < n; i++) {
    const dx = pts[i - 1].x - pts[i].x,
      dy = pts[i - 1].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    head[i] = { x: dx / len, y: dy / len };
  }
  head[0] = head[1];

  const left: Vec[] = [],
    right: Vec[] = [];
  let prevSharp = false;

  for (let i = 0; i < n; i++) {
    const p = pts[i],
      h = p.half,
      v = head[i];
    const next = i < n - 1 ? head[i + 1] : v;
    const turn = i < n - 1 ? v.x * next.x + v.y * next.y : 1;
    const back = i > 0 ? v.x * head[i - 1].x + v.y * head[i - 1].y : 1;

    const sharpHere = back < 0 && !prevSharp;
    const sharpNext = turn < 0;

    if (sharpHere || sharpNext) {
      const ox = v.y * h,
        oy = -v.x * h;
      for (let s = 0; s <= 1; s += 1 / CORNER_STEPS) {
        left.push(rotate({ x: p.x - ox, y: p.y - oy }, p, Math.PI * s));
        right.push(rotate({ x: p.x + ox, y: p.y + oy }, p, -Math.PI * s));
      }
      prevSharp = sharpNext;
      continue;
    }
    prevSharp = false;

    const bx = lerp(next.x, v.x, turn),
      by = lerp(next.y, v.y, turn);
    const bl = Math.hypot(bx, by) || 1;
    const ox = (by / bl) * h,
      oy = (-bx / bl) * h;
    left.push({ x: p.x - ox, y: p.y - oy });
    right.push({ x: p.x + ox, y: p.y + oy });
  }

  // Caps sweep a half turn around each end, from one edge across to the other,
  // so the loop closes with a round nib. Built before `right` is reversed.
  const startCap: Vec[] = [],
    endCap: Vec[] = [];
  for (let k = 1; k < CAP_STEPS; k++) {
    const s = k / CAP_STEPS;
    endCap.push(rotate(left[left.length - 1], pts[n - 1], Math.PI * s));
    startCap.push(rotate(right[0], pts[0], Math.PI * s));
  }

  return left.concat(endCap, right.reverse(), startCap);
}

function circle(c: Vec, radius: number): Vec[] {
  const rad = Math.max(radius, 0.5);
  const out: Vec[] = [];
  for (let k = 0; k < CAP_STEPS * 2; k++) {
    const a = (k / (CAP_STEPS * 2)) * Math.PI * 2;
    out.push({ x: c.x + Math.cos(a) * rad, y: c.y + Math.sin(a) * rad });
  }
  return out;
}

// --- stage 5: polygon → path ---
//
// A closed loop as one path: a Catmull-Rom spline through the vertices, emitted
// as chained cubics. Each interior control point pulls toward the chord of its
// neighbours, so the curve is smooth and passes exactly through every vertex.
//
// It has to INTERPOLATE. The usual shortcut — a quadratic through each edge's
// midpoint using the vertex as its control — only approximates, cutting every
// corner toward the centre of curvature by |P₋₁ + P₊₁ - 2P| / 4, or L²/4R around
// an arc. Both edges of a ribbon bend the same way, so that cut does not cancel:
// it walks the whole stroke to the inside of the bend, by a distance that is a
// large fraction of the stroke's own width when the stroke is thin.
function loopPath(pts: Vec[]): string {
  const n = pts.length;
  if (n < 3) return "";
  const at = (i: number) => pts[(i + n) % n];
  let d = `M ${r(pts[0].x)},${r(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6,
      c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6,
      c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${r(p2.x)},${r(p2.y)}`;
  }
  return d + " Z";
}

function centerlinePath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${r(pts[0].x)},${r(pts[0].y)}`;
  return "M " + pts.map((p) => `${r(p.x)},${r(p.y)}`).join(" L ");
}

// --- public entry points ---

function points(stroke: Stroke, o: Required<RenderOptions>): Pt[] {
  return decimate(resolve(stroke, halfWidths(stroke, o)), o.simplify);
}

export function renderStroke(stroke: Stroke, options: RenderOptions = {}): StrokeRender {
  const o = { ...RENDER_DEFAULTS, ...options };
  if (stroke.length === 0) return { curve: "", shapes: [], width: o.maxWidth };

  const pts = points(stroke, o);
  return {
    curve: centerlinePath(pts),
    shapes: [loopPath(outlinePoints(pts))],
    width: o.maxWidth,
  };
}

// Debug geometry: the centerline, every outline vertex, and the raw recorded
// input positions the outline is built from.
export function strokeDebug(
  stroke: Stroke,
  options: RenderOptions = {},
): { curve: string; points: Vec[]; dots: Vec[] } {
  const o = { ...RENDER_DEFAULTS, ...options };
  const dots = stroke.map((p) => ({ x: p.x, y: p.y }));
  if (stroke.length === 0) return { curve: "", points: [], dots };
  const pts = points(stroke, o);
  return { curve: centerlinePath(pts), points: outlinePoints(pts), dots };
}

// Reduce a raw stroke's point count for storage. Unlike `decimate` this runs on
// samples that still carry time, so the chord is parameterized by time and a
// point survives if either its position or its timing departs from it — dropping
// a sample must not change the speeds the renderer will derive.
export function simplifyStroke(stroke: Stroke, eps: number): Stroke {
  const n = stroke.length;
  if (n <= 2 || eps <= 0) return stroke;
  const keep = [stroke[0]];
  let a = 0;
  while (a < n - 1) {
    let k = a + 1;
    while (k < n - 1) {
      const end = k + 1;
      const span = stroke[end].t - stroke[a].t;
      let ok = span > 0;
      for (let j = a + 1; ok && j <= k; j++) {
        const s = (stroke[j].t - stroke[a].t) / span;
        ok =
          Math.abs(stroke[j].x - lerp(stroke[a].x, stroke[end].x, s)) <= eps &&
          Math.abs(stroke[j].y - lerp(stroke[a].y, stroke[end].y, s)) <= eps;
      }
      if (!ok) break;
      k = end;
    }
    keep.push(stroke[k]);
    a = k;
  }
  return keep;
}
