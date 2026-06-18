import { simplifyStroke } from 'rescrawl';

export type Point = { x: number; y: number; t: number; p: number };
export type Stroke = Point[];

export const DEFAULT_CONFIG = {
  sidebarRight: false,
  guidelines: true,
};

export type Config = typeof DEFAULT_CONFIG;

// --- Bounds & framing ---

// `t` is monotonic within a stroke, so its first/last sample are its time span.
export const strokeStart = (s: Stroke): number => (s.length ? s[0].t : 0);
export const strokeEnd = (s: Stroke): number => (s.length ? s[s.length - 1].t : 0);

// Index of the stroke "active" at time `t`: the one with the latest start at or
// before `t` (the stroke being drawn, or the most recent once the playhead is
// past it). Null if `t` precedes every stroke.
export function activeStrokeAt(strokes: Stroke[], t: number): number | null {
  let idx: number | null = null;
  let best = -Infinity;
  for (let i = 0; i < strokes.length; i++) {
    const s = strokeStart(strokes[i]);
    if (s <= t && s >= best) { best = s; idx = i; }
  }
  return idx;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function strokesBounds(strokes: Stroke[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes)
    for (const pt of stroke) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

// Translate every point so the content's top-left bound sits at (pad, pad) —
// used to reframe a drawing to its used bounds + padding on export.
export function reframe(strokes: Stroke[], pad: number): Stroke[] {
  const b = strokesBounds(strokes);
  if (!b) return strokes;
  const dx = pad - b.minX, dy = pad - b.minY;
  return strokes.map(stroke =>
    stroke.map(pt => ({ ...pt, x: pt.x + dx, y: pt.y + dy }))
  );
}

// --- Simplification ---
// Reduce stored point count (and file size) using rescrawl's own simplify logic,
// so export matches what the renderer's `simplify` option does.
export function simplifyStrokes(strokes: Stroke[], eps: number): Stroke[] {
  if (eps <= 0) return strokes;
  return strokes.map(s => simplifyStroke(s, eps));
}

export function countPoints(strokes: Stroke[]): number {
  return strokes.reduce((n, s) => n + s.length, 0);
}

// The prefix of a stroke that has been drawn by time `t`: every sample with
// t <= `t`, plus an interpolated head sitting exactly where the raw pen was at
// `t`. `Infinity` returns the whole stroke; a time before the stroke starts
// returns nothing. This is the single bridge between the timeline and geometry.
export function drawnPoints(stroke: Stroke, t: number): Stroke {
  const n = stroke.length;
  if (n === 0 || t < stroke[0].t) return [];
  if (t >= stroke[n - 1].t) return stroke;
  let i = 0;
  while (i < n - 1 && stroke[i + 1].t <= t) i++;
  const a = stroke[i], b = stroke[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  if (f <= 0) return stroke.slice(0, i + 1);
  const head: Point = {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    t,
    p: a.p + (b.p - a.p) * f,
  };
  return [...stroke.slice(0, i + 1), head];
}

// --- Serialization ---
// Strokes are newline-separated; points within a stroke are ";"-separated. A
// point is "x,y,t,p" (or "x,y,t" in ballpoint mode). By default the first point
// of each stroke is absolute and the rest are deltas from the previous point.
// Options:
//   ballpoint — drop pressure, and the trailing pointer-up/cancel sample (p:0,
//               position duplicating the previous point), which then carries
//               nothing.
//   relative  — chain deltas across strokes too, so only the very first point of
//               the file is absolute. Lossy on import (stroke origins are no
//               longer recoverable independently) — for size experiments only.
export function serialize(strokes: Stroke[], opts: { ballpoint?: boolean; relative?: boolean } = {}): string {
  const { ballpoint = false, relative = false } = opts;
  let prev: Point | null = null;
  return strokes.map(stroke => {
    const pts = ballpoint && stroke.length > 1 ? stroke.slice(0, -1) : stroke;
    const line = pts.map((pt, i) => {
      const ref = i === 0 ? (relative ? prev : null) : pts[i - 1];
      const x = pt.x - (ref?.x ?? 0);
      const y = pt.y - (ref?.y ?? 0);
      const t = pt.t - (ref?.t ?? 0);
      const p = pt.p - (ref?.p ?? 0);
      return ballpoint ? `${x},${y},${t}` : `${x},${y},${t},${p}`;
    }).join(';');
    if (pts.length) prev = pts[pts.length - 1];
    return line;
  }).join('\n');
}

export function deserialize(text: string): Stroke[] {
  return text.split('\n').filter(line => line.trim() !== '').map(line => {
    const stroke: Stroke = [];
    let x = 0, y = 0, t = 0, p = 0;
    line.split(';').forEach((token, i) => {
      const parts = token.split(',').map(Number);
      if (i === 0) {
        [x, y, t] = parts;
        p = parts[3] ?? 0;
      } else {
        x += parts[0];
        y += parts[1];
        t += parts[2];
        p += parts[3] ?? 0;
      }
      stroke.push({ x, y, t, p });
    });
    return stroke;
  });
}

