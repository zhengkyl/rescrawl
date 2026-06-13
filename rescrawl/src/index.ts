// rescrawl — turn a single recorded stroke into the geometry needed to
// animate it being "written": a centerline `curve` (revealed over time with
// stroke-dasharray) and a variable-width `shape` outline used as a mask.

export type StrokePoint = { x: number; y: number; t: number; p: number };
export type Stroke = StrokePoint[];

export type RenderOptions = {
  minWidth?: number;       // full stroke width at min thickness
  maxWidth?: number;       // full stroke width at max thickness
  pressureMax?: number;    // p value treated as full pressure
  velocityScale?: number;  // px/ms speed at which the stroke is fully thinned
  velocityWeight?: number; // 0..1 — how much velocity thins vs pressure alone
  smoothWidth?: number;    // moving-average passes over per-point width
  smooth?: number;         // centerline spline smoothing, 0..1
};

export type StrokeRender = {
  curve: string;     // centerline path `d`
  shapes: string[];  // variable-width outline parts in draw order; currently length 1
  width: number;     // max full width (centerline stroke width when shapes unused)
};

const DEFAULTS: Required<RenderOptions> = {
  minWidth: 2,
  maxWidth: 8,
  pressureMax: 8192,
  velocityScale: 3,
  velocityWeight: 0.5,
  smoothWidth: 2,
  smooth: 1,
};

// --- helpers ---

function r(n: number) {
  return Math.round(n * 100) / 100;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function dist(a: StrokePoint | Vec, b: StrokePoint | Vec) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

type Vec = { x: number; y: number };

// --- per-point width (pressure + velocity) ---

function pointWidths(stroke: Stroke, o: Required<RenderOptions>): number[] {
  const n = stroke.length;
  const half: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const pressureFactor = clamp01(stroke[i].p / o.pressureMax);

    // Average the speed of the segments adjacent to point i.
    let speedSum = 0, speedCount = 0;
    if (i > 0) {
      const dt = Math.max(stroke[i].t - stroke[i - 1].t, 1);
      speedSum += dist(stroke[i - 1], stroke[i]) / dt;
      speedCount++;
    }
    if (i < n - 1) {
      const dt = Math.max(stroke[i + 1].t - stroke[i].t, 1);
      speedSum += dist(stroke[i], stroke[i + 1]) / dt;
      speedCount++;
    }
    const speed = speedCount ? speedSum / speedCount : 0;
    const velocityFactor = clamp01(1 - speed / o.velocityScale);

    const factor = pressureFactor * lerp(1, velocityFactor, o.velocityWeight);
    half[i] = (o.minWidth + (o.maxWidth - o.minWidth) * factor) / 2;
  }

  // Smooth the (noisy) width series with moving averages.
  let cur = half;
  for (let pass = 0; pass < o.smoothWidth; pass++) {
    if (cur.length <= 2) break;
    const next = cur.slice();
    for (let i = 1; i < cur.length - 1; i++) {
      next[i] = (cur[i - 1] + 2 * cur[i] + cur[i + 1]) / 4;
    }
    cur = next;
  }
  return cur;
}

// --- centerline curve (cardinal spline -> cubic bezier) ---

function centerlinePath(pts: Vec[], smooth: number): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${r(pts[0].x)},${r(pts[0].y)}`;

  let d = `M ${r(pts[0].x)},${r(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = r(p1.x + (smooth * (p2.x - p0.x)) / 6);
    const cp1y = r(p1.y + (smooth * (p2.y - p0.y)) / 6);
    const cp2x = r(p2.x - (smooth * (p3.x - p1.x)) / 6);
    const cp2y = r(p2.y - (smooth * (p3.y - p1.y)) / 6);
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${r(p2.x)},${r(p2.y)}`;
  }
  return d;
}

// --- variable-width outline (the shape / mask) ---

// Unit normal at point i (tangent via central differences, rotated 90°).
function normalAt(pts: Vec[], i: number): Vec {
  const prev = pts[Math.max(i - 1, 0)];
  const next = pts[Math.min(i + 1, pts.length - 1)];
  let tx = next.x - prev.x;
  let ty = next.y - prev.y;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len; ty /= len;
  return { x: -ty, y: tx };
}

function lineTo(pts: Vec[]): string {
  return pts.map(p => `L ${r(p.x)},${r(p.y)}`).join(' ');
}

// A filled dot for a single-point stroke (two semicircle arcs).
function dotPath(c: Vec, radius: number): string {
  const rad = Math.max(radius, 0.5);
  return `M ${r(c.x - rad)},${r(c.y)} ` +
    `A ${r(rad)},${r(rad)} 0 1 1 ${r(c.x + rad)},${r(c.y)} ` +
    `A ${r(rad)},${r(rad)} 0 1 1 ${r(c.x - rad)},${r(c.y)} Z`;
}

function buildOutline(pts: Vec[], half: number[]): string {
  const n = pts.length;
  if (n === 1) return dotPath(pts[0], half[0]);

  const left: Vec[] = [];
  const right: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const nrm = normalAt(pts, i);
    left.push({ x: pts[i].x + nrm.x * half[i], y: pts[i].y + nrm.y * half[i] });
    right.push({ x: pts[i].x - nrm.x * half[i], y: pts[i].y - nrm.y * half[i] });
  }

  const endR = Math.max(half[n - 1], 0.5);
  const startR = Math.max(half[0], 0.5);

  // Forward along the left edge, round cap over the end, back along the right
  // edge, round cap over the start, close.
  return (
    `M ${r(left[0].x)},${r(left[0].y)} ` +
    lineTo(left.slice(1)) + ' ' +
    `A ${r(endR)},${r(endR)} 0 0 1 ${r(right[n - 1].x)},${r(right[n - 1].y)} ` +
    lineTo(right.slice(0, n - 1).reverse()) + ' ' +
    `A ${r(startR)},${r(startR)} 0 0 1 ${r(left[0].x)},${r(left[0].y)} Z`
  );
}

// --- public entry point ---

export function renderStroke(stroke: Stroke, options: RenderOptions = {}): StrokeRender {
  const o = { ...DEFAULTS, ...options };

  if (stroke.length === 0) {
    return { curve: '', shapes: [], width: o.maxWidth };
  }

  const pts: Vec[] = stroke.map(({ x, y }) => ({ x, y }));
  const half = pointWidths(stroke, o);

  const curve = centerlinePath(pts, o.smooth);
  const shapes = [buildOutline(pts, half)];

  return { curve, shapes, width: o.maxWidth };
}
