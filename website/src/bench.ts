import type { InkOptions, OutlineMode } from "./curves";
import { renderInk } from "./curves";
import type { Stroke } from "./utils";
import { strokeEnd } from "./utils";

// --- interframe jitter ---
//
// Ink that has been laid down should not move, and it does: the open segment
// keeps refitting as samples arrive. The motion is a fraction of a pixel, so
// eyeballing it is hopeless.
//
// So: render each frame to a canvas and count the pixels that changed from the
// last one. The growing tail changes every frame no matter what the engine
// does, and that is fine -- it costs every engine the same, and the comparison
// is relative.
//
// Two cadences, because the app draws at two:
//
//   draw      pen down. `App.drawFrame` re-renders every frame with the samples
//             that have arrived PLUS a dwell point at the last position, so the
//             radius keeps growing while the pen sits still.
//   animate   playback. `elapsedPoints` clips the stroke at `t`.

const CANVAS_MAX = 420; // px on the long side; the diff is per-pixel work
const MAX_FRAMES = 150; // a long dwell would otherwise run to thousands
const ALPHA = 8; // alpha steps a pixel must move to count as changed

export type BenchMode = "draw" | "animate";

export type Stats = {
  frames: number;
  mean: number; // pixels changed per frame
  max: number;
  pct: number; // mean, as a percentage of the pixels the stroke inks
};

export type Row = {
  engine: OutlineMode;
  mode: BenchMode;
  perSample: Record<string, Stats>;
  overall: Stats;
};

export type Sample = { name: string; stroke: Stroke };

// --- the two frame series ---

// What `App.drawFrame` hands the renderer while the pen is down.
export function drawFrames(stroke: Stroke, frameMs: number): Stroke[] {
  const out: Stroke[] = [];
  const end = strokeEnd(stroke);
  let i = 0;
  const at = (t: number) => {
    while (i + 1 < stroke.length && stroke[i + 1].t <= t) i++;
    const arrived = stroke.slice(0, i + 1);
    const last = arrived[arrived.length - 1];
    out.push([...arrived, { x: last.x, y: last.y, t }]);
  };
  for (let t = stroke[0].t; t < end; t += frameMs) at(t);
  // The stroke rarely ends on a frame boundary, and the last stretch is the one
  // that moves most, so the final state is always measured.
  at(end);
  return out;
}

// The playhead's own frames; the renderer clips the stroke at each `t` itself.
export function animateTimes(stroke: Stroke, frameMs: number): number[] {
  const out: number[] = [];
  const end = strokeEnd(stroke);
  for (let t = stroke[0].t; t < end; t += frameMs) out.push(t);
  out.push(end);
  return out;
}

// Every engine gets the same cadence, so a coarser one on a long stroke is
// still a fair comparison.
function step(stroke: Stroke, frameMs: number): number {
  const span = strokeEnd(stroke) - stroke[0].t;
  return Math.max(frameMs, span / MAX_FRAMES);
}

// --- rasterize ---

type Pad = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
};

// One canvas per (stroke, engine, mode) run, framed on the whole stroke so
// every frame lands on the same pixel grid -- otherwise the diff would be
// measuring the framing, not the ink.
function makePad(stroke: Stroke, o: InkOptions): Pad {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = o.maxWidth + 2;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const scale = Math.min(1, CANVAS_MAX / Math.max(maxX - minX, maxY - minY, 1));
  const w = Math.max(1, Math.ceil((maxX - minX) * scale));
  const h = Math.max(1, Math.ceil((maxY - minY) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
  return { ctx, w, h };
}

// Raw RGBA, walked with a stride of 4. Only alpha is read -- coverage is what
// moves, colour never changes -- but copying the alpha plane out first would be
// a whole extra pass over the buffer for nothing.
function inkPixels(pad: Pad, d: string): Uint8ClampedArray {
  pad.ctx.save();
  pad.ctx.setTransform(1, 0, 0, 1, 0, 0);
  pad.ctx.clearRect(0, 0, pad.w, pad.h);
  pad.ctx.restore();
  if (d) pad.ctx.fill(new Path2D(d));
  return pad.ctx.getImageData(0, 0, pad.w, pad.h).data;
}

// --- one stroke, one engine, one mode ---
//
// A generator so the caller can hand the browser a frame between chunks: a full
// grid is a few thousand rasterizations and would otherwise lock the tab.
function* measureSteps(
  stroke: Stroke,
  o: InkOptions,
  mode: BenchMode,
  frameMs: number,
): Generator<null, Stats, void> {
  const pad = makePad(stroke, o);
  const ms = step(stroke, frameMs);
  const inputs: (Stroke | number)[] =
    mode === "draw" ? drawFrames(stroke, ms) : animateTimes(stroke, ms);

  let prev: Uint8ClampedArray | null = null;
  let total = 0;
  let max = 0;
  let pairs = 0;
  let inked = 0;

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const line =
      mode === "draw"
        ? renderInk(input as Stroke, o, Infinity)
        : renderInk(stroke, o, input as number);
    const cur = inkPixels(pad, line.shapes?.[0] ?? "");

    // One pass: how much ink this frame lays down, and how much of it moved.
    let on = 0;
    let changed = 0;
    for (let j = 3; j < cur.length; j += 4) {
      const a = cur[j];
      if (a > 127) on++;
      if (prev !== null) {
        const dv = a - prev[j];
        if (dv > ALPHA || dv < -ALPHA) changed++;
      }
    }
    // The last frame is the whole stroke, so this settles on its full extent.
    if (on > inked) inked = on;
    if (prev !== null) {
      total += changed;
      if (changed > max) max = changed;
      pairs++;
    }
    prev = cur;
    if ((i & 7) === 7) yield null;
  }

  const mean = pairs ? total / pairs : 0;
  return { frames: pairs, mean, max, pct: inked ? (100 * mean) / inked : 0 };
}

export function* benchRuns(
  samples: Sample[],
  engines: OutlineMode[],
  o: InkOptions,
  frameMs: number,
): Generator<Row | null, void, void> {
  for (const engine of engines) {
    for (const mode of ["draw", "animate"] as BenchMode[]) {
      const perSample: Record<string, Stats> = {};
      for (const s of samples) {
        if (s.stroke.length < 2) continue;
        perSample[s.name] = yield* measureSteps(s.stroke, { ...o, engine }, mode, frameMs);
      }
      // The overall row is the worst across samples, not an average of
      // averages: one sample that shakes is the thing you want to see.
      const rows = Object.values(perSample);
      const worst = (pick: (s: Stats) => number) => (rows.length ? Math.max(...rows.map(pick)) : 0);
      yield {
        engine,
        mode,
        perSample,
        overall: {
          frames: rows.reduce((a, r) => a + r.frames, 0),
          mean: worst((r) => r.mean),
          max: worst((r) => r.max),
          pct: worst((r) => r.pct),
        },
      };
    }
  }
}
