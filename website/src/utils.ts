export type Point = { x: number; y: number; t: number };
// Invariant: a *stored* stroke always holds at least one point — recording
// commits >= 2 (pen-down + release), import yields >= 1 per line, and every edit
// maps points 1:1 — so [0] and [length - 1] are indexed unguarded throughout.
// `drawnPoints` is the exception: a time-clipped prefix can be empty, which is
// why its callers (curves.ts) check before drawing.
//
// `zoom`: screen px per drawing px while it was drawn. The pipeline reads its
// screen-px knobs at this zoom, never the view's, so zooming the view moves
// nothing already drawn. A stroke keeps the zoom it started at.
export type Stroke = { points: Point[]; zoom: number };

export const DEFAULT_CONFIG = {
  sidebarRight: false,
  guidelines: true,
};

export type Config = typeof DEFAULT_CONFIG;

// ms of idle after a stroke before recording ends
export const LIVE_TIMEOUT = 2000;

// --- Bounds & framing ---

// `t` is monotonic within a stroke, so its first/last sample are its time span.
export const strokeStart = (s: Stroke): number => s.points[0].t;
export const strokeEnd = (s: Stroke): number => s.points[s.points.length - 1].t;
export function withinStroke(s: Stroke, t: number) {
  return strokeStart(s) <= t && t < strokeEnd(s);
}

export function activeStrokeAt(strokes: Stroke[], t: number): number | null {
  for (let i = 0; i < strokes.length; i++) {
    if (withinStroke(strokes[i], t)) {
      return i;
    }
  }
  return null;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function strokesBounds(strokes: Stroke[]): Bounds | null {
  if (strokes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const stroke of strokes)
    for (const pt of stroke.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  return { minX, minY, maxX, maxY };
}

// Translate every point so the content's top-left bound sits at (pad, pad) —
// used to reframe a drawing to its used bounds + padding on export.
export function reframe(strokes: Stroke[], pad: number): Stroke[] {
  const b = strokesBounds(strokes);
  if (!b) return strokes;
  const k = Math.pow(10, POS_DIGITS);
  const dx = Math.round((pad - b.minX) * k) / k,
    dy = Math.round((pad - b.minY) * k) / k;
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })),
  }));
}

export function countPoints(strokes: Stroke[]): number {
  return strokes.reduce((n, s) => n + s.points.length, 0);
}

// The prefix of a stroke that has been drawn by time `t`: every sample with
// t <= `t`, plus an interpolated head sitting exactly where the raw pen was at
// `t`. `Infinity` returns the whole stroke; a time before the stroke starts
// returns nothing. This is the single bridge between the timeline and geometry.
export function elapsedPoints({ points }: Stroke, t: number): Point[] {
  const n = points.length;
  if (t < points[0].t) return [];
  if (t >= points[n - 1].t) return points;
  let i = 0;
  while (i < n - 1 && points[i + 1].t <= t) i++;
  const a = points[i],
    b = points[i + 1];
  // TODO stroke is not ordered? remove when ordered
  const f = Math.max((t - a.t) / (b.t - a.t), 0);
  const head: Point = {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    t,
  };
  return [...points.slice(0, i + 1), head, { ...head }];
}

// --- Serialization ---
const POS_DIGITS = 1;
const TIME_DIGITS = 0;

// Strokes are newline-separated; points within a stroke are ";"-separated. A
// point is "x,y,t". By default the first point of each stroke is absolute and
// the rest are deltas from the previous point.
//
// A line starting with "#" is not a stroke. It holds ";"-separated commands,
// each a name and its arguments split by spaces, applying to every stroke after
// it until changed. Anything else after a "#" is a comment, and a reader that
// skips every "#" line still gets every stroke:
//   zoom z   screen px per drawing px the strokes were drawn at; 1 until set
//
// Options:
//   relative — chain deltas across strokes too, so only the very first point of
//              the file is absolute. Lossy on import (stroke origins are no
//              longer recoverable independently) — for size experiments only.
export function serialize(strokes: Stroke[], opts: { relative?: boolean } = {}): string {
  const { relative = false } = opts;
  const pk = Math.pow(10, POS_DIGITS);
  const tk = Math.pow(10, TIME_DIGITS);
  let prev: Point | null = null;
  let zoom = 1;
  const lines: string[] = [];
  for (const { points, zoom: z } of strokes) {
    // Written as JS prints it, the shortest form that reads back exactly.
    if (z !== zoom) lines.push(`#zoom ${z}`);
    zoom = z;
    const line = points
      .map((pt, i) => {
        const ref = i === 0 ? (relative ? prev : null) : points[i - 1];
        const x = Math.round((pt.x - (ref?.x ?? 0)) * pk) / pk;
        const y = Math.round((pt.y - (ref?.y ?? 0)) * pk) / pk;
        const t = Math.round((pt.t - (ref?.t ?? 0)) * tk) / tk;
        return `${x},${y},${t}`;
      })
      .join(";");
    prev = points[points.length - 1];
    lines.push(line);
  }
  return lines.join("\n");
}

const isCommandLine = (line: string) => line.trimStart().startsWith("#");

// The commands on one "#" line, applied to `zoom`; anything not a well-formed
// command is a comment.
function readCommands(line: string, zoom: number): number {
  for (const command of line.trimStart().slice(1).split(";")) {
    const [name, ...args] = command.trim().split(/\s+/);
    if (name === "zoom" && args.length === 1) {
      const z = Number(args[0]);
      if (Number.isFinite(z) && z > 0) zoom = z;
    }
  }
  return zoom;
}

// The file's own grid, read off the file: the finest decimal any field is
// written to. Nothing declares it in a header, but every number in the file was
// produced by rounding to it, so the widest tail present is it.
//
// Read off stroke lines only: a command's numbers are not on the grid.
function decimalsIn(text: string): number {
  let max = 0;
  for (const line of text.split("\n")) {
    if (isCommandLine(line)) continue;
    for (const m of line.matchAll(/\.(\d+)/g)) if (m[1].length > max) max = m[1].length;
  }
  return Math.min(max, 6);
}

// Deltas accumulate, and summing rounded decimals in binary drifts off the grid
// they were written on — 0.1 + 0.2 is 0.30000000000000004. Stage 0 snaps that
// straight back, so the drift never reaches the ink; the reason to head it off
// anyway is everything that reads a stored point WITHOUT going through the
// pipeline — bounds, the playhead's interpolation, re-serializing on the next
// export. Accumulating in whole grid units and dividing once at the end makes
// the points come back exactly as they were written.
export function deserialize(text: string): Stroke[] {
  const k = Math.pow(10, decimalsIn(text));
  const strokes: Stroke[] = [];
  let zoom = 1;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    if (isCommandLine(line)) {
      zoom = readCommands(line, zoom);
      continue;
    }
    const points: Point[] = [];
    let x = 0,
      y = 0,
      t = 0;
    line.split(";").forEach((token, i) => {
      const parts = token.split(",").map((n) => Math.round(Number(n) * k));
      if (i === 0) {
        [x, y, t] = parts;
      } else {
        x += parts[0];
        y += parts[1];
        t += parts[2];
      }
      points.push({ x: x / k, y: y / k, t: t / k });
    });
    strokes.push({ points, zoom });
  }
  return strokes;
}
