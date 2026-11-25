import { readdirSync, readFileSync } from "node:fs";
import { getStroke } from "perfect-freehand";
import { Centerline } from "../src/centerline/Centerline.ts";
import type { CubicNode } from "../src/centerline/fit.ts";
import { Ink } from "../src/Ink.ts";
import type { Point3 } from "../src/math.ts";
import type { InkOptions } from "../src/options.ts";
import type { OutlineNode } from "../src/brush/outline.ts";
import { OutlineBrush } from "../src/brush/OutlineBrush.ts";
import { RECORDED_STROKES } from "./strokes.ts";

// closed polygons as flat x, y pairs, in drawing px
type Shape = number[][];

type Renderer = { name: string; draw: (frames: Point3[][], zoom: number) => Shape[] };

const WIDTH = { minWidth: 1.5, maxWidth: 8 };

function frames(raw: Point3[]): Point3[][] {
  const out: Point3[][] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && last[0].t === p.t) last.push(p);
    else out.push([p]);
  }
  return out;
}

function flatten(pieces: OutlineNode[][], zoom: number): Shape {
  return pieces.map((cs) => {
    const out: number[] = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % cs.length];
      const span =
        Math.hypot(a.c1x - a.x, a.c1y - a.y) +
        Math.hypot(a.c2x - a.c1x, a.c2y - a.c1y) +
        Math.hypot(b.x - a.c2x, b.y - a.c2y);
      const n = Math.max(2, Math.ceil(span * zoom));
      for (let j = 0; j < n; j++) {
        const u = j / n;
        const v = 1 - u;
        out.push(
          v * v * v * a.x + 3 * v * v * u * a.c1x + 3 * v * u * u * a.c2x + u * u * u * b.x,
          v * v * v * a.y + 3 * v * v * u * a.c1y + 3 * v * u * u * a.c2y + u * u * u * b.y,
        );
      }
    }
    return out;
  });
}

// the library as an app drives it
function rescrawl(name: string, width = WIDTH, options: InkOptions = {}): Renderer {
  return {
    name,
    draw(fs, zoom) {
      // widths are screen px; held to the same drawing px as the other renderers
      const o = {
        ...options,
        minWidth: width.minWidth * zoom,
        maxWidth: width.maxWidth * zoom,
        zoom,
      };
      const pen = new OutlineBrush(o);
      const ink = new Ink(pen, o);
      const out: Shape[] = [];
      for (const f of fs) {
        for (const p of f) ink.update(p);
        ink.draw(f[0].t);
        out.push(flatten(pen.outline.pieces, zoom));
      }
      ink.end();
      out.push(flatten(pen.outline.pieces, zoom));
      return out;
    },
  };
}

// the fitted curve as an SVG stroke draws it: boxes along it and discs at the
// joins, wound the same way so nonzero fills their union
function strokeShape(nodes: CubicNode[], r: number, zoom: number): Shape {
  const out: Shape = [];
  const disc = (x: number, y: number) => {
    const poly: number[] = [];
    for (let j = 24; j > 0; j--) {
      const a = (2 * Math.PI * j) / 24;
      poly.push(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    out.push(poly);
  };
  for (let k = 0; k < nodes.length; k++) {
    const a = nodes[k];
    const b = nodes[k + 1];
    if (b === undefined) break;
    const span =
      Math.hypot(a.c1x - a.x, a.c1y - a.y) +
      Math.hypot(a.c2x - a.c1x, a.c2y - a.c1y) +
      Math.hypot(b.x - a.c2x, b.y - a.c2y);
    const n = Math.max(2, Math.ceil(span * zoom));
    let px = a.x;
    let py = a.y;
    for (let j = 1; j <= n; j++) {
      const u = j / n;
      const v = 1 - u;
      const qx = v * v * v * a.x + 3 * v * v * u * a.c1x + 3 * v * u * u * a.c2x + u * u * u * b.x;
      const qy = v * v * v * a.y + 3 * v * v * u * a.c1y + 3 * v * u * u * a.c2y + u * u * u * b.y;
      const L = Math.hypot(qx - px, qy - py);
      if (L > 0) {
        const nx = (-(qy - py) / L) * r;
        const ny = ((qx - px) / L) * r;
        out.push([px + nx, py + ny, qx + nx, qy + ny, qx - nx, qy - ny, px - nx, py - ny]);
      }
      disc(px, py);
      px = qx;
      py = qy;
    }
  }
  const last = nodes[nodes.length - 1];
  if (last !== undefined) disc(last.x, last.y);
  return out;
}

function svgStroke(name: string, width: number): Renderer {
  return {
    name,
    draw(fs, zoom) {
      const line = new Centerline([], { zoom });
      const out: Shape[] = [];
      for (const f of fs) {
        for (const p of f) line.update(p);
        out.push(strokeShape(line.fit(f[0].t).nodes, width / 2, zoom));
      }
      out.push(strokeShape(line.end().nodes, width / 2, zoom));
      return out;
    },
  };
}

// the usual way to drive it: every point so far, every frame
function perfectFreehand(name: string, thinning: number): Renderer {
  return {
    name,
    draw(fs, _zoom) {
      const pts: Point3[] = [];
      const shape = (last: boolean) => [
        getStroke(pts, { size: WIDTH.maxWidth, thinning, last }).flatMap((p) => [p[0], p[1]]),
      ];
      const out: Shape[] = [];
      for (const f of fs) {
        for (const p of f) pts.push(p);
        out.push(shape(false));
      }
      out.push(shape(true));
      return out;
    },
  };
}

class Raster {
  private x0: number;
  private y0: number;
  private zoom: number;
  private w: number;
  private h: number;
  stride: number;

  constructor(raw: Point3[], zoom: number) {
    const pad = 16;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of raw) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    this.x0 = x0 - pad;
    this.y0 = y0 - pad;
    this.zoom = zoom;
    this.w = Math.ceil((x1 - x0 + 2 * pad) * zoom);
    this.h = Math.ceil((y1 - y0 + 2 * pad) * zoom);
    this.stride = Math.ceil(this.w / 32);
  }

  at(p: Point3): [number, number] {
    return [(p.x - this.x0) * this.zoom, (p.y - this.y0) * this.zoom];
  }

  fill(shape: Shape): Uint32Array {
    const { w, h, stride } = this;

    const edges: number[] = [];
    for (const poly of shape) {
      const n = poly.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        edges.push(
          (poly[2 * i] - this.x0) * this.zoom,
          (poly[2 * i + 1] - this.y0) * this.zoom,
          (poly[2 * j] - this.x0) * this.zoom,
          (poly[2 * j + 1] - this.y0) * this.zoom,
        );
      }
    }

    // row r is crossed at y = r + 0.5 by an edge with one end at or above it
    const rows = (ay: number, by: number) => {
      const lo = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5));
      const hi = Math.min(h, Math.ceil(Math.max(ay, by) - 0.5));
      return [lo, hi];
    };

    const start = new Uint32Array(h + 1);
    for (let e = 0; e < edges.length; e += 4) {
      const [lo, hi] = rows(edges[e + 1], edges[e + 3]);
      for (let r = lo; r < hi; r++) start[r + 1]++;
    }
    for (let r = 0; r < h; r++) start[r + 1] += start[r];

    // a crossing is its x in 1/1024 px, doubled, plus one when heading down
    const crossings = new Float64Array(start[h]);
    const at = start.slice(0, h);
    for (let e = 0; e < edges.length; e += 4) {
      const ax = edges[e];
      const ay = edges[e + 1];
      const bx = edges[e + 2];
      const by = edges[e + 3];
      const [lo, hi] = rows(ay, by);
      for (let r = lo; r < hi; r++) {
        const x = ax + ((r + 0.5 - ay) / (by - ay)) * (bx - ax);
        crossings[at[r]++] = Math.round(x * 1024) * 2 + (by > ay ? 1 : 0);
      }
    }

    const bits = new Uint32Array(stride * h);
    for (let r = 0; r < h; r++) {
      const row = crossings.subarray(start[r], start[r + 1]).sort();
      let winding = 0;
      let from = 0;
      for (const c of row) {
        const down = c - 2 * Math.floor(c / 2);
        const x = (c - down) / 2 / 1024;
        const before = winding;
        winding += down === 1 ? 1 : -1;
        if (before === 0) from = x;
        if (winding !== 0) continue;
        // pixels whose centre lies in [from, x)
        const c0 = Math.max(0, Math.ceil(from - 0.5));
        const c1 = Math.min(w, Math.ceil(x - 0.5));
        for (let px = c0; px < c1; px++) bits[r * stride + (px >> 5)] |= 1 << (px & 31);
      }
    }
    return bits;
  }
}

function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function minus(a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) n += popcount(a[i] & ~b[i]);
  return n;
}

type Tally = {
  ink: number; // pixels of the finished strokes
  lost: number; // pixels lost, summed over every frame
  trail: number; // those further than PEN from where the pen was that frame and the one before
  worst: number; // most pixels lost in one frame
  jumps: number; // frames that lost more than JUMP pixels
  frames: number;
  vanished: number; // pixels inked at some frame and not in the finished stroke
  ms: number;
};

// a loss the eye catches in a single frame, where a few edge pixels are not
const JUMP = 20;

// screen px round the pen where ink is expected to shift as the tip moves on
const PEN = 12;

// pixels set in a and not in b, further than PEN from both points
function minusFar(
  a: Uint32Array,
  b: Uint32Array,
  stride: number,
  p: [number, number],
  q: [number, number],
): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const word = a[i] & ~b[i];
    if (word === 0) continue;
    const y = Math.floor(i / stride) + 0.5;
    for (let bit = 0; bit < 32; bit++) {
      if ((word & (1 << bit)) === 0) continue;
      const x = (i % stride) * 32 + bit + 0.5;
      const dp = (x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]);
      const dq = (x - q[0]) * (x - q[0]) + (y - q[1]) * (y - q[1]);
      if (dp > PEN * PEN && dq > PEN * PEN) n++;
    }
  }
  return n;
}

function measure(render: Renderer, raw: Point3[], zoom: number, tally: Tally) {
  const raster = new Raster(raw, zoom);
  const fs = frames(raw);
  const t = performance.now();
  const shapes = render.draw(fs, zoom);
  tally.ms += performance.now() - t;

  // where the pen is at each shape: the pen-up shape is at the last frame's
  const pens = fs.map((f) => raster.at(f[f.length - 1]));
  pens.push(pens[pens.length - 1]);

  let prev: Uint32Array | undefined;
  let ever: Uint32Array | undefined;
  for (let f = 0; f < shapes.length; f++) {
    const bits = raster.fill(shapes[f]);
    if (prev !== undefined && ever !== undefined) {
      const lost = minus(prev, bits);
      tally.lost += lost;
      if (lost > 0) tally.trail += minusFar(prev, bits, raster.stride, pens[f - 1], pens[f]);
      tally.worst = Math.max(tally.worst, lost);
      if (lost > JUMP) tally.jumps++;
      for (let i = 0; i < bits.length; i++) ever[i] |= bits[i];
    } else {
      ever = bits.slice();
    }
    prev = bits;
    tally.frames++;
  }
  if (prev === undefined || ever === undefined) return;
  tally.ink += minus(prev, new Uint32Array(prev.length));
  tally.vanished += minus(ever, prev);
}

const sets: { name: string; zoom: number; strokes: Point3[][] }[] = [
  { name: `bench.scrawl (${RECORDED_STROKES.length})`, zoom: 1, strokes: RECORDED_STROKES },
];
const dir = new URL("./samples/", import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  sets.push({ name: d.label, zoom: d.zoom, strokes: [d.raw.slice(0, d.fed)] });
}

const renderers: Renderer[] = [
  perfectFreehand("perfect-freehand", 0.5),
  perfectFreehand("perfect-freehand, one width", 0),
  svgStroke("rescrawl, svg stroke", WIDTH.maxWidth),
  rescrawl("rescrawl, fixed width", { minWidth: 8, maxWidth: 8 }),
  rescrawl("rescrawl, node radii"),
];

const empty = (): Tally => ({
  ink: 0,
  lost: 0,
  trail: 0,
  worst: 0,
  jumps: 0,
  frames: 0,
  vanished: 0,
  ms: 0,
});
const pad = (s: string | number, n: number) => String(s).padStart(n);
const pct = (a: number, b: number) => ((100 * a) / b).toFixed(1) + "%";

const totals = renderers.map(empty);
const perSet: string[] = [];
for (const set of sets) {
  let row = set.name.slice(0, 31).padEnd(32);
  renderers.forEach((render, i) => {
    const tally = empty();
    for (const raw of set.strokes) measure(render, raw, set.zoom, tally);
    row += pad(pct(tally.lost, tally.ink), 9);
    const total = totals[i];
    total.ink += tally.ink;
    total.lost += tally.lost;
    total.trail += tally.trail;
    total.worst = Math.max(total.worst, tally.worst);
    total.jumps += tally.jumps;
    total.frames += tally.frames;
    total.vanished += tally.vanished;
    total.ms += tally.ms;
  });
  perSet.push(row);
}

console.log(
  `${"renderer".padEnd(30)}${pad("ink px", 8)}${pad("lost px", 9)}${pad("lost", 8)}${pad("trail", 8)}` +
    `${pad("per frame", 11)}${pad("worst", 7)}${pad(`>${JUMP}px`, 8)}${pad("vanished", 10)}${pad("ms/frame", 10)}`,
);
renderers.forEach((render, i) => {
  const t = totals[i];
  console.log(
    render.name.padEnd(30) +
      pad(t.ink, 8) +
      pad(t.lost, 9) +
      pad(pct(t.lost, t.ink), 8) +
      pad(pct(t.trail, t.ink), 8) +
      pad((t.lost / t.frames).toFixed(2), 11) +
      pad(t.worst, 7) +
      pad(t.jumps, 8) +
      pad(pct(t.vanished, t.ink), 10) +
      pad((t.ms / t.frames).toFixed(3), 10),
  );
});
console.log(
  `\n${totals[0].frames} frames. lost: pixels inked in one frame and not the next, over the finished ink.` +
    `\ntrail: the part of lost more than ${PEN}px behind the pen, where laid ink should not move.` +
    `\nvanished: pixels inked at some frame that the finished stroke does not ink.`,
);

// what jitter is traded against: segments, and how much the finished curves bend
{
  let segments = 0;
  let bend = 0;
  for (const set of sets) {
    for (const raw of set.strokes) {
      const ns = new Centerline([...raw], { zoom: set.zoom }).end().nodes;
      segments += Math.max(0, ns.length - 1);
      for (let k = 0; k + 1 < ns.length; k++) {
        const a = ns[k];
        const b = ns[k + 1];
        const N = 24;
        for (let j = 0; j <= N; j++) {
          const u = j / N;
          const v = 1 - u;
          const dx =
            3 * (v * v * (a.c1x - a.x) + 2 * v * u * (a.c2x - a.c1x) + u * u * (b.x - a.c2x));
          const dy =
            3 * (v * v * (a.c1y - a.y) + 2 * v * u * (a.c2y - a.c1y) + u * u * (b.y - a.c2y));
          const ddx = 6 * (v * (a.c2x - 2 * a.c1x + a.x) + u * (b.x - 2 * a.c2x + a.c1x));
          const ddy = 6 * (v * (a.c2y - 2 * a.c1y + a.y) + u * (b.y - 2 * a.c2y + a.c1y));
          const speed = Math.hypot(dx, dy);
          if (speed === 0) continue;
          // curvature in 1/screen px, squared, over the arc length
          const curvature = (dx * ddy - dy * ddx) / (speed * speed * speed) / set.zoom;
          bend += curvature * curvature * ((speed * set.zoom) / N);
        }
      }
    }
  }
  console.log(
    `\nfinished rescrawl curves: ${segments} segments, bending energy ${bend.toFixed(1)}`,
  );
}

console.log(`\nlost, per set, renderers in the order above`);
for (const row of perSet) console.log(row);
