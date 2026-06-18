// rescrawl — turn a single recorded stroke into renderable ink geometry:
// a cubic centerline plus a variable-width outline (the filled shape).
//
// Width is driven by per-node pressure, mapped to a half-width between
// `minWidth` and `maxWidth`. The pressure can come from the device, or — when
// `pressureFromTime` is set — be simulated from timing, so devices with no real
// pressure (mouse, plain touch) still get expressive ink. Two timings combine:
//   • motion: how fast the pen swept THROUGH a node (travel time to the next,
//     excluding any pause). Ramps over `flowFull` ms — fast = thin, slow = thick.
//   • pool: how long the pen sat STILL at a node. Ramps over the much longer
//     `poolFull` ms, so a quick tap stays small and only a deliberate hold grows
//     the dot toward maxWidth. The held tip is fed live by the draw-loop tip /
//     pointer-up point.
// The wider of the two wins, both capped at full, so neither exceeds maxWidth.
//
// Stability: the renderer is called fresh with a growing prefix (live drawing,
// replay scrubbing). Earlier geometry never moves or shrinks — the centerline
// clamps its last control point (only the final segment is live) and each gap
// freezes once the next point exists.

export type StrokePoint = { x: number; y: number; t: number; p: number };
export type Stroke = StrokePoint[];

export type RenderOptions = {
  minWidth?: number;    // stroke width at min pressure
  maxWidth?: number;    // stroke width at max pressure
  pressureMax?: number; // p value treated as full pressure
  pressureFromTime?: boolean; // ignore recorded pressure; simulate it from timing
  flowFull?: number;    // ms of slow motion through a point to reach full simulated width
  poolFull?: number;    // ms of holding still at a point to grow the dot to full width
  smoothWidth?: number; // moving-average passes over the (noisy) per-point width
  smooth?: number;      // centerline spline smoothing, 0..1
  simplify?: number;    // px: collapse near-collinear runs within this tolerance (0 = off)
};

export type StrokeRender = {
  curve: string;     // centerline path `d`
  shapes: string[];  // variable-width outline parts in draw order
  width: number;     // max full width
};

export const RENDER_DEFAULTS: Required<RenderOptions> = {
  minWidth: 1.5,
  maxWidth: 8,
  pressureMax: 8192,
  pressureFromTime: true,
  flowFull: 25,
  poolFull: 400,
  smoothWidth: 4,
  smooth: 1,
  simplify: 0.75,
};

const COINCIDENT_EPS = 0.5; // px — points closer than this are the same position
const DOT_TAP_MS = 250;     // a standalone tap held this briefly is just a dot, not a "hold to grow"

// --- small helpers ---

const r = (n: number) => Math.round(n * 100) / 100;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
type Vec = { x: number; y: number };

// A node is a distinct pen position. Runs of coincident samples collapse into
// one node; `t` is the arrival time and `tOut` the departure time (so travel
// speed to the next node excludes any time spent stationary here).
type Node = { x: number; y: number; t: number; tOut: number; p: number };

function collapse(stroke: Stroke): Node[] {
  const nodes: Node[] = [];
  for (const pt of stroke) {
    const last = nodes[nodes.length - 1];
    if (last && Math.abs(last.x - pt.x) < COINCIDENT_EPS && Math.abs(last.y - pt.y) < COINCIDENT_EPS) {
      last.tOut = pt.t;
      last.p = Math.max(last.p, pt.p);
    } else {
      nodes.push({ x: pt.x, y: pt.y, t: pt.t, tOut: pt.t, p: pt.p });
    }
  }
  return nodes;
}

// --- per-node half-width, from pressure ---
//
// Pressure (0..pressureMax) maps linearly to a half-width in [minWidth/2,
// maxWidth/2]. When `pressureFromTime` is set the recorded pressure is ignored
// and simulated from timing, as the wider of two effects (see the file header):
// fast motion through the node (travel time, over `flowFull`) and a stationary
// hold at it (sat time, over the much longer `poolFull`). Both clamp at full, so
// the result never exceeds a full-pressure stroke.
//
// Motion uses the outgoing segment, except at the leading edge (the live tip /
// final node), which has no outgoing segment and instead borrows the *incoming*
// one. That keeps the tip's width frozen at the speed it was drawn — matching
// the body, so the end cap reads as a round nib — instead of decaying to a thin
// taper that the live `sat` then pulses up and down between frames. Because
// `flowFull` ≪ `poolFull`, motion dominates while the pen moves; only a genuine
// hold (sat far longer than a normal draw gap) lets the pool grow the dot.
function halfWidth(nodes: Node[], i: number, o: Required<RenderOptions>): number {
  let pressureFactor: number;
  if (o.pressureFromTime) {
    const sat = nodes[i].tOut - nodes[i].t;                          // time sat still here
    const travel = i < nodes.length - 1
      ? nodes[i + 1].t - nodes[i].tOut                               // outgoing: time moving to the next
      : i > 0 ? nodes[i].t - nodes[i - 1].tOut : 0;                  // tip: borrow the incoming segment
    pressureFactor = Math.max(clamp01(travel / o.flowFull), clamp01(sat / o.poolFull));
  } else {
    pressureFactor = clamp01(nodes[i].p / o.pressureMax);
  }
  return (o.minWidth + (o.maxWidth - o.minWidth) * pressureFactor) / 2;
}

// Moving-average smooth of a per-node series ([1,2,1]/4), endpoints fixed. The
// inter-point time (hence raw width) is noisy; this keeps the stroke smooth.
function smoothSeries(arr: number[], passes: number): number[] {
  let cur = arr;
  for (let p = 0; p < passes && cur.length > 2; p++) {
    const next = cur.slice();
    for (let i = 1; i < cur.length - 1; i++) next[i] = (cur[i - 1] + 2 * cur[i] + cur[i + 1]) / 4;
    cur = next;
  }
  return cur;
}

// --- decimate near-collinear runs (slow drawing records far more points than
// the shape needs) ---
//
// Parameterize each run by time — the one axis that always increases — and drop
// a point when its x AND y both stay within `eps` of the straight chord
// interpolated by time between the run's endpoints. Matching the time-chord (not
// just a spatial line) means the run held a constant heading AND a constant
// speed, so collapsing it to its two endpoints changes neither the shape nor the
// width. Widths are precomputed at full resolution and carried on the kept
// nodes, so a fast thin line and a slow thick line both survive the collapse.
//
// Greedy from the start: every run but the trailing one is frozen as the stroke
// grows, matching the renderer's "only the final segment is live" guarantee.
// Core test: greedily walk the points, returning the indices to keep. A run from
// `a` collapses to its endpoints while every interior point stays within `eps` of
// the time-chord (see above). Shared by the renderer (on collapsed nodes) and the
// public `simplifyStroke` (on raw points), so both reduce identically.
function collinearKeep(pts: { x: number; y: number; t: number }[], eps: number): number[] {
  const n = pts.length;
  if (n <= 2 || eps <= 0) return pts.map((_, i) => i);
  const keep = [0];
  let a = 0;
  while (a < n - 1) {
    let k = a + 1; // furthest endpoint whose run stays within tolerance
    while (k < n - 1) {
      const end = k + 1, dt = pts[end].t - pts[a].t;
      let collinear = dt > 0;
      for (let j = a + 1; collinear && j <= k; j++) {
        const s = (pts[j].t - pts[a].t) / dt;
        collinear = Math.abs(pts[j].x - lerp(pts[a].x, pts[end].x, s)) <= eps &&
          Math.abs(pts[j].y - lerp(pts[a].y, pts[end].y, s)) <= eps;
      }
      if (!collinear) break;
      k = end;
    }
    keep.push(k);
    a = k;
  }
  return keep;
}

function simplifyCollinear(nodes: Node[], half: number[], eps: number): { nodes: Node[]; half: number[] } {
  if (nodes.length <= 2 || eps <= 0) return { nodes, half };
  const keep = collinearKeep(nodes, eps);
  return { nodes: keep.map(i => nodes[i]), half: keep.map(i => half[i]) };
}

// --- centerline (cardinal spline → cubic bezier) ---
//
// A cardinal spline through `pts`, emitted as chained cubic beziers (no leading
// `M`). Each interior control point pulls toward the chord of its neighbours,
// scaled by `smooth` (0 = straight polyline, 1 = Catmull-Rom). Endpoints clamp
// to themselves, so the first/last segment is frozen as soon as it exists.
function splineSegments(pts: Vec[], smooth: number): string {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n - 1)];
    const c1x = r(p1.x + (smooth * (p2.x - p0.x)) / 6), c1y = r(p1.y + (smooth * (p2.y - p0.y)) / 6);
    const c2x = r(p2.x - (smooth * (p3.x - p1.x)) / 6), c2y = r(p2.y - (smooth * (p3.y - p1.y)) / 6);
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${r(p2.x)},${r(p2.y)}`;
  }
  return d;
}

function centerlinePath(nodes: Node[], smooth: number): string {
  if (nodes.length === 1) return `M ${r(nodes[0].x)},${r(nodes[0].y)}`;
  return `M ${r(nodes[0].x)},${r(nodes[0].y)}` + splineSegments(nodes, smooth);
}

// --- variable-width outline ---

// Filled circle, for a single-point stroke (a dot / held tap).
function dotPath(c: Vec, radius: number): string {
  const rad = Math.max(radius, 0.5);
  return `M ${r(c.x - rad)},${r(c.y)} ` +
    `A ${r(rad)},${r(rad)} 0 1 0 ${r(c.x + rad)},${r(c.y)} ` +
    `A ${r(rad)},${r(rad)} 0 1 0 ${r(c.x - rad)},${r(c.y)} Z`;
}

// Per-node left/right outline points. Each node is a circle of radius half[i];
// the outline edges are the common tangents between consecutive circles, so the
// contact point tilts off the plain perpendicular by the rate the width changes
// along the stroke: sinφ = -d(half)/ds. With a constant width (φ = 0) this is a
// plain perpendicular offset; where the width tapers, the contacts rotate so the
// edges leave the end caps *tangentially* — a smooth teardrop, not a mushroom
// (a perpendicular offset would meet the round cap at a concave corner).
//
// The tilt is clamped shy of ±90° so a very steep taper (a wide pool feeding a
// thin line) keeps a visible cap instead of collapsing both contacts onto one
// pole. `sinp` is returned so the caps can pick the right arc sweep.
const MAX_TILT = 0.9;
function offsetPoints(nodes: Node[], half: number[], i: number): { left: Vec; right: Vec; sinp: number } {
  const n = nodes.length;
  const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
  let tx = nodes[b].x - nodes[a].x, ty = nodes[b].y - nodes[a].y;
  const ds = Math.hypot(tx, ty) || 1;
  tx /= ds; ty /= ds;            // unit tangent (direction of travel)
  const px = -ty, py = tx;       // unit normal, 90° left of travel
  let sinp = -(half[b] - half[a]) / ds;
  sinp = sinp < -MAX_TILT ? -MAX_TILT : sinp > MAX_TILT ? MAX_TILT : sinp;
  const cosp = Math.sqrt(1 - sinp * sinp);
  const h = half[i];
  return {
    left: { x: nodes[i].x + (cosp * px + sinp * tx) * h, y: nodes[i].y + (cosp * py + sinp * ty) * h },
    right: { x: nodes[i].x + (-cosp * px + sinp * tx) * h, y: nodes[i].y + (-cosp * py + sinp * ty) * h },
    sinp,
  };
}

// Drop nodes whose circle is wholly inside an adjacent node's circle. Such a
// node lies under the outline (the bigger circle already covers it), so it adds
// nothing — but it is exactly the case the tangent offset can't handle: when a
// wide pool feeds a node a fraction of a pixel away (a hold at the start, then
// the pen barely moves on), there is no common tangent between the two circles,
// and forcing one folds the edge back and bulges the outline past maxWidth.
// Removing the contained node guarantees every surviving pair is far enough
// apart to share a real tangent (ds > |Δhalf|), so the edge never folds.
function dropContained(nodes: Node[], half: number[]): { nodes: Node[]; half: number[] } {
  const outN: Node[] = [], outH: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (outN.length) {
      const last = outN[outN.length - 1], lh = outH[outH.length - 1];
      const d = Math.hypot(nodes[i].x - last.x, nodes[i].y - last.y);
      if (d + half[i] <= lh) continue;                 // node i sits inside the last kept node
      if (d + lh <= half[i]) { outN.pop(); outH.pop(); } // last kept node sits inside node i
    }
    outN.push(nodes[i]); outH.push(half[i]);
  }
  return { nodes: outN, half: outH };
}

// The filled shape as ONE closed outline: offset the centerline by the per-node
// half-width to a left edge and a right edge, run a smooth spline down the left
// edge, round-cap across the tip, back up the right edge, and round-cap across
// the tail. Far fewer points than a per-sample strip, and a single contour.
//
// Tradeoff vs. a per-segment strip: vertex normals can let the inner edge cross
// itself where the centerline bends sharply. Under nonzero fill the consistent
// winding (left forward / right backward) keeps those overlaps filled solid, so
// it reads fine; the width- and centerline-smoothing keep bends gentle enough
// that the edges don't invert in practice.
function outlinePath(allNodes: Node[], allHalf: number[], o: Required<RenderOptions>): string {
  const { nodes, half } = dropContained(allNodes, allHalf);
  const n = nodes.length;
  // Everything collapsed into one pool → just the pool circle.
  if (n === 1) return dotPath(nodes[0], Math.max(half[0], 0.5));
  const left: Vec[] = [], right: Vec[] = [];
  let sinp0 = 0, sinpN = 0;
  for (let i = 0; i < n; i++) {
    const e = offsetPoints(nodes, half, i);
    left.push(e.left); right.push(e.right);
    if (i === 0) sinp0 = e.sinp;
    if (i === n - 1) sinpN = e.sinp;
  }
  const rightRev = right.slice().reverse();
  const tip = r(half[n - 1]), tail = r(half[0]);
  // The caps are arcs of the end circles between the tilted edge contacts. Where
  // the width tapers the contacts shift toward the narrow side, so the cap that
  // wraps the wide back becomes a major arc (>180°): tail wraps the back, so it
  // is major when the start tapers down (sinp0 > 0); the tip wraps the front, so
  // it is major when the end flares out (sinpN < 0). Sweep 0 keeps each cap
  // bulging past its end; a zero half-width collapses the cap to a point.
  const tipLarge = sinpN < 0 ? 1 : 0;
  const tailLarge = sinp0 > 0 ? 1 : 0;
  return `M ${r(left[0].x)},${r(left[0].y)}` +
    splineSegments(left, o.smooth) +
    ` A ${tip},${tip} 0 ${tipLarge} 0 ${r(right[n - 1].x)},${r(right[n - 1].y)}` +
    splineSegments(rightRev, o.smooth) +
    ` A ${tail},${tail} 0 ${tailLarge} 0 ${r(left[0].x)},${r(left[0].y)} Z`;
}

// Round joins at sharp turns. The single-contour outline pinches where the
// centerline doubles back (a hairpin): the offset edges cross and the outer
// corner is left unrounded. A filled disc at such a node — drawn as its own
// shape so fill-rules can't punch a hole through the outline — patches the turn
// into a proper round join of the local width. Gentle bends are already rounded
// by the edge spline, so only turns past ~90° (cos of the deviation < 0) qualify.
function cornerDiscs(nodes: Node[], half: number[]): string[] {
  const discs: string[] = [];
  for (let i = 1; i < nodes.length - 1; i++) {
    const ax = nodes[i].x - nodes[i - 1].x, ay = nodes[i].y - nodes[i - 1].y;
    const bx = nodes[i + 1].x - nodes[i].x, by = nodes[i + 1].y - nodes[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    if ((ax * bx + ay * by) / (la * lb) < 0) discs.push(dotPath(nodes[i], Math.max(half[i], 0.5)));
  }
  return discs;
}

// --- public entry point ---

// Reduce a raw stroke's point count with the same time-chord test the renderer
// uses for its `simplify` option — drop samples within `eps` px of the chord
// their neighbours interpolate by time. Keeps x/y/t/p on the surviving points.
export function simplifyStroke(stroke: Stroke, eps: number): Stroke {
  if (stroke.length <= 2 || eps <= 0) return stroke;
  return collinearKeep(stroke, eps).map(i => stroke[i]);
}

export function renderStroke(stroke: Stroke, options: RenderOptions = {}, tapFloor = false): StrokeRender {
  const o = { ...RENDER_DEFAULTS, ...options };

  const nodes = collapse(stroke);
  if (nodes.length === 0) return { curve: '', shapes: [], width: o.maxWidth };

  const half = smoothSeries(nodes.map((_, i) => halfWidth(nodes, i, o)), o.smoothWidth);

  // A single position. While a stroke is in progress (or replaying), a lone node
  // is the seed of a line, so render it at its plain width to grow seamlessly
  // into the stroke. Only a committed standalone tap (`tapFloor`) gets the
  // visible dot floor: its size is driven consistently across devices — real
  // pressure (pen) follows how hard you pressed; without it (mouse/touch) a
  // click's duration isn't a "hold to grow" gesture, so only a deliberate hold
  // past DOT_TAP_MS grows it — floored so a light tap (a pen reporting ~0
  // pressure, or a quick click) still reads.
  if (nodes.length === 1) {
    let radius = half[0];
    if (tapFloor) {
      const factor = o.pressureFromTime
        ? clamp01((nodes[0].tOut - nodes[0].t - DOT_TAP_MS) / o.poolFull)
        : clamp01(nodes[0].p / o.pressureMax);
      radius = Math.max(o.minWidth, (o.minWidth + (o.maxWidth - o.minWidth) * factor) / 2);
    }
    return { curve: `M ${r(nodes[0].x)},${r(nodes[0].y)}`, shapes: [dotPath(nodes[0], radius)], width: o.maxWidth };
  }

  // Widths are computed above at full resolution; now drop redundant collinear
  // nodes for a lighter, smoother curve and outline.
  const s = simplifyCollinear(nodes, half, o.simplify);

  return {
    curve: centerlinePath(s.nodes, o.smooth),
    shapes: [outlinePath(s.nodes, s.half, o), ...cornerDiscs(s.nodes, s.half)],
    width: o.maxWidth,
  };
}

// Debug geometry: the cubic centerline path, every outline (offset) point — the
// left/right edge of the ribbon at each node — and `dots`, the raw recorded
// input positions the curve is fitted to.
export function strokeDebug(stroke: Stroke, options: RenderOptions = {}): { curve: string; points: Vec[]; dots: Vec[] } {
  const o = { ...RENDER_DEFAULTS, ...options };
  const dots = stroke.map((p) => ({ x: p.x, y: p.y }));
  const nodes = collapse(stroke);
  if (nodes.length === 0) return { curve: '', points: [], dots };
  if (nodes.length === 1) return { curve: `M ${r(nodes[0].x)},${r(nodes[0].y)}`, points: [{ x: nodes[0].x, y: nodes[0].y }], dots };

  const half = smoothSeries(nodes.map((_, i) => halfWidth(nodes, i, o)), o.smoothWidth);
  const s = simplifyCollinear(nodes, half, o.simplify);
  const d = dropContained(s.nodes, s.half);
  const points: Vec[] = [];
  for (let i = 0; i < d.nodes.length; i++) {
    const e = offsetPoints(d.nodes, d.half, i);
    points.push(e.left, e.right);
  }
  return { curve: centerlinePath(s.nodes, o.smooth), points, dots };
}
