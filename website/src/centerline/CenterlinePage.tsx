import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Centerline,
  CENTERLINE_DEFAULTS,
  type CenterlineOptions,
  type CubicNode,
  holdEndUntil,
  type Point2,
  type Point3,
} from "rescrawl";
import type { CornerTrace } from "rescrawl/centerline/corner";
import { centerlineStages } from "../stages";
import { deserialize } from "../utils";
import "./centerline.css";

// A bench for the raw-points-to-centerline half of the pipeline, and nothing
// past it -- no outline. One stroke goes in, through
//
//   smoothing -> retime -> radius -> corners -> fit
//
// -- the library's own `Centerline`, with the knobs here folded into its
// options -- and the fit comes out as plain
// Bezier cubics, for drawing and measuring.
//
// The `fed` scrubber walks the input back a sample at a time and reruns
// everything on that prefix -- which is what the live app does every frame --
// so the fit can be watched making each decision.

type RadiusKind = "speed" | "fixed";

type Cubic = [Point2, Point2, Point2, Point2];
// How a stroke was recorded. `coalesced`: whether the events the browser
// merged into each frame were recorded too.
type Meta = { pointerType: string; zoom: number; coalesced: boolean } | null;

const DEFAULTS = {
  radius: "speed" as RadiusKind,
  minWidth: CENTERLINE_DEFAULTS.minWidth,
  maxWidth: CENTERLINE_DEFAULTS.maxWidth,
  thinSpeed: CENTERLINE_DEFAULTS.thinSpeed,
  widthLag: CENTERLINE_DEFAULTS.widthLag,

  cornerArm: CENTERLINE_DEFAULTS.cornerArm,
  cornerTurn: 30, // deg here, rad to the library
  cornerDebug: false,

  smoothWindow: CENTERLINE_DEFAULTS.smoothWindow,

  handTol: CENTERLINE_DEFAULTS.handTol,
  reparam: 2,

  showRaw: true,
  showInput: true,
  showCurve: true,
  showHandles: true,
  showCorners: true,
  showOnion: false,
  curveAtWidth: false,
  curveOneColor: false,
  showReplay: false,
  showPens: false,
  replaySpeed: 1,
  onionFrames: 5,

  coalesced: true,
  framePeriod: 1000 / 60,
  minMove: CENTERLINE_DEFAULTS.minMove,
};
type Settings = typeof DEFAULTS;

// Versioned: lengths moved from multiples of the pen to screen px, and a value
// saved under the old meaning reads as a different one.
const SETTINGS_KEY = "rescrawl-centerline-settings-3";
const STROKES_KEY = "rescrawl-centerline-strokes";

// Storage can be missing or throw (private windows, blocked site data); the
// page works without it, it just forgets on reload.
function load<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text === null ? fallback : { ...fallback, ...JSON.parse(text) };
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// --- the pipeline ---

// The knobs as the library's options, for a stroke drawn at `zoom`. "fixed"
// radius is min = max width, which holds the radius at the full pen whatever
// the speed -- pen speed out of the picture when only the path is under study.
const pipelineOptions = (s: Settings, zoom: number): CenterlineOptions => ({
  ...s,
  zoom,
  minWidth: s.radius === "fixed" ? s.maxWidth : s.minWidth,
  cornerTurn: s.cornerTurn * DEG,
});

// open: the pen is still down on the last point
const tOpen = (pts: Point3[], open: boolean) =>
  open && pts.length > 0 ? pts[pts.length - 1].t : undefined;

const DEG = Math.PI / 180;

// A node list as Bezier cubics.
function nodeCubics(ns: CubicNode[]): Cubic[] {
  const out: Cubic[] = [];
  for (let i = 1; i < ns.length; i++) {
    const a = ns[i - 1];
    const b = ns[i];
    out.push([
      { x: a.x, y: a.y },
      { x: a.c1x, y: a.c1y },
      { x: a.c2x, y: a.c2y },
      { x: b.x, y: b.y },
    ]);
  }
  return out;
}

// The fit as drawn: its nodes as cubics, and each node's t, one more than
// there are cubics.
type Fitted = {
  cubics: Cubic[];
  times: number[];
};

// The stroke as it stood after `fed` samples, through the whole pipeline.
// `open`: the pen is still down, so more samples are coming.
function run(stroke: Point3[], fed: number, s: Settings, zoom: number, open: boolean): Fitted {
  const pts = stroke.slice(0, fed);
  const curves = new Centerline(pts, pipelineOptions(s, zoom)).curves(tOpen(pts, open));
  return { cubics: nodeCubics(curves), times: curves.map((n) => n.tStart) };
}

// Mean ms per call. One call is under the timer's resolution for most strokes,
// so with `repeat` it reruns until ~1ms has passed (at most 20 calls). Not
// while drawing: the pipeline repeated on every frame is what made drawing lag.
// The numbers settle once the pen lifts.
function timed<T>(f: () => T, repeat: boolean): [T, number] {
  if (!repeat) {
    const start = performance.now();
    const out = f();
    return [out, performance.now() - start];
  }
  let out = f();
  const start = performance.now();
  let now = start;
  let runs = 0;
  do {
    out = f();
    runs++;
    now = performance.now();
  } while (now - start < 1 && runs < 20);
  return [out, (now - start) / runs];
}

// --- measuring ---

const isFinitePoint = (p: Point2) => Number.isFinite(p.x) && Number.isFinite(p.y);
const isStraight = (c: Cubic) =>
  c[0].x === c[1].x && c[0].y === c[1].y && c[3].x === c[2].x && c[3].y === c[2].y;

const SAMPLES = 24;

// A cubic as a polyline, fine enough that distance to it stands in for
// distance to the curve, with the box around it.
type Sampled = { poly: Point2[]; minX: number; minY: number; maxX: number; maxY: number };

// A straight cubic is its chord: 24 samples of a line are 24 times the work
// for nothing.
function cubicPoly(c: Cubic): Point2[] {
  if (isStraight(c)) return [c[0], c[3]];
  const poly: Point2[] = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const u = k / SAMPLES;
    const v = 1 - u;
    const b0 = v * v * v;
    const b1 = 3 * v * v * u;
    const b2 = 3 * v * u * u;
    const b3 = u * u * u;
    poly.push({
      x: b0 * c[0].x + b1 * c[1].x + b2 * c[2].x + b3 * c[3].x,
      y: b0 * c[0].y + b1 * c[1].y + b2 * c[2].y + b3 * c[3].y,
    });
  }
  return poly;
}

// Non-finite cubics are left out -- they draw nothing either.
function sampleCubics(cs: Cubic[]): Sampled[] {
  const out: Sampled[] = [];
  for (const c of cs) {
    if (!c.every(isFinitePoint)) continue;
    const poly = cubicPoly(c);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const q of poly) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
    out.push({ poly, minX, minY, maxX, maxY });
  }
  return out;
}

// Squared distance from p to one sampled cubic, or `best` if nothing is nearer.
function polyDist2(p: Point2, poly: Point2[], best: number): number {
  for (let k = 1; k < poly.length; k++) {
    const a = poly[k - 1];
    const b = poly[k];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let u = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const dx = a.x + abx * u - p.x;
    const dy = a.y + aby * u - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return best;
}

// Max and mean distance from points to the curve; null with no curve to
// measure against.
//
// Every point against every cubic was 25-80ms a frame at a few hundred
// samples, and a second at 2000. Instead each cubic's box goes into a grid,
// and a point searches outward from its own cell, ring by ring, stopping once
// the next ring is further than the nearest cubic found. Points arrive in
// stroke order, so the cubic nearest the last point is measured first: that
// bound is usually tight enough that the first ring or two settle it.
function deviation(pts: Point2[], cs: Sampled[]) {
  if (cs.length === 0 || pts.length === 0) return null;

  const G = 16; // px per cell
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cs) {
    x0 = Math.min(x0, c.minX);
    y0 = Math.min(y0, c.minY);
    x1 = Math.max(x1, c.maxX);
    y1 = Math.max(y1, c.maxY);
  }
  const cols = Math.floor((x1 - x0) / G) + 1;
  const rows = Math.floor((y1 - y0) / G) + 1;
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  cs.forEach((c, j) => {
    for (let cy = Math.floor((c.minY - y0) / G); cy <= Math.floor((c.maxY - y0) / G); cy++) {
      for (let cx = Math.floor((c.minX - x0) / G); cx <= Math.floor((c.maxX - x0) / G); cx++) {
        cells[cy * cols + cx].push(j);
      }
    }
  });

  // A cubic spanning several cells is measured once per query.
  const seen = new Int32Array(cs.length);
  let max = 0;
  let sum = 0;
  let hint = 0;
  for (let q = 0; q < pts.length; q++) {
    const p = pts[q];
    let best = polyDist2(p, cs[hint].poly, Infinity);
    seen[hint] = q + 1;
    // The point's cell, clamped onto the grid; a point off the grid still
    // searches outward from its nearest edge.
    const pcx = Math.min(cols - 1, Math.max(0, Math.floor((p.x - x0) / G)));
    const pcy = Math.min(rows - 1, Math.max(0, Math.floor((p.y - y0) / G)));
    // How far p itself is off the grid: every cell is at least this far.
    const ox = p.x < x0 ? x0 - p.x : p.x > x1 ? p.x - x1 : 0;
    const oy = p.y < y0 ? y0 - p.y : p.y > y1 ? p.y - y1 : 0;
    const off = Math.sqrt(ox * ox + oy * oy);
    const rMax = Math.max(pcx, cols - 1 - pcx, pcy, rows - 1 - pcy);
    for (let r = 0; r <= rMax; r++) {
      for (let cy = pcy - r; cy <= pcy + r; cy++) {
        if (cy < 0 || cy >= rows) continue;
        // the ring only: full rows at top and bottom, the two ends between
        const step = cy === pcy - r || cy === pcy + r ? 1 : 2 * r;
        for (let cx = pcx - r; cx <= pcx + r; cx += Math.max(step, 1)) {
          if (cx < 0 || cx >= cols) continue;
          for (const j of cells[cy * cols + cx]) {
            if (seen[j] === q + 1) continue;
            seen[j] = q + 1;
            const c = cs[j];
            const dx = c.minX > p.x ? c.minX - p.x : p.x > c.maxX ? p.x - c.maxX : 0;
            const dy = c.minY > p.y ? c.minY - p.y : p.y > c.maxY ? p.y - c.maxY : 0;
            if (dx * dx + dy * dy >= best) continue;
            const d2 = polyDist2(p, c.poly, best);
            if (d2 < best) {
              best = d2;
              hint = j;
            }
          }
        }
      }
      // Everything in ring r + 1 is at least r cells beyond p's own cell.
      const beyond = off + r * G;
      if (beyond * beyond >= best) break;
    }
    const d = Math.sqrt(best);
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / pts.length };
}

// --- replay ---

// The curve played back as an animation: each segment runs from its start
// node's t to its end node's t at constant speed along its length -- the way a
// dash-offset animation draws a path. Held against the raw samples, each at
// its own t, to see how far that animation strays from where the pen was.

// A segment as a polyline with the length run up to each vertex; null where
// the cubic is non-finite and draws nothing.
type ReplaySeg = { poly: Point2[]; len: number[] } | null;

function replaySegs(cubics: Cubic[]): ReplaySeg[] {
  return cubics.map((c) => {
    if (!c.every(isFinitePoint)) return null;
    const poly = cubicPoly(c);
    const len = [0];
    for (let k = 1; k < poly.length; k++) {
      len.push(len[k - 1] + Math.hypot(poly[k].x - poly[k - 1].x, poly[k].y - poly[k - 1].y));
    }
    return { poly, len };
  });
}

// The segment playing at t, and how far along it the pen is as a fraction of
// its length. Before the first node or after the last, the nearest end. A
// segment of no duration is never the one playing, unless t is exactly its
// time and it is the last.
function replaySegAt(times: number[], t: number): { seg: number; f: number } {
  let lo = 0;
  let hi = times.length - 2;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (times[m] <= t) lo = m;
    else hi = m - 1;
  }
  const a = times[lo];
  const b = times[lo + 1];
  const f = b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 1;
  return { seg: lo, f };
}

// The point a fraction f of the way along a segment, by length.
function alongSeg(sg: NonNullable<ReplaySeg>, f: number): Point2 {
  const { poly, len } = sg;
  const target = f * len[len.length - 1];
  let k = 1;
  while (k < len.length - 1 && len[k] < target) k++;
  const d = len[k] - len[k - 1];
  const g = d > 0 ? (target - len[k - 1]) / d : 0;
  return {
    x: poly[k - 1].x + (poly[k].x - poly[k - 1].x) * g,
    y: poly[k - 1].y + (poly[k].y - poly[k - 1].y) * g,
  };
}

// The length along a segment of the point on it nearest p.
function nearestAlong(sg: NonNullable<ReplaySeg>, p: Point2): number {
  const { poly, len } = sg;
  let best = Infinity;
  let at = 0;
  for (let k = 1; k < poly.length; k++) {
    const a = poly[k - 1];
    const abx = poly[k].x - a.x;
    const aby = poly[k].y - a.y;
    const len2 = abx * abx + aby * aby;
    let u = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const dx = a.x + abx * u - p.x;
    const dy = a.y + aby * u - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      at = len[k - 1] + (len[k] - len[k - 1]) * u;
    }
  }
  return at;
}

// Per raw sample in the replay's time span: how far the replay is from it at
// its t (px), and how early or late the replay passes the nearest point of
// that segment (ms) -- px alone overstates a fast flick, where a few ms is many
// px and no animation would show it. A sample sharing its ms with a neighbour
// is skipped: the recordings have pairs 20px apart on one timestamp, and
// between them the reference jumps in no time.
function replayError(raw: Point3[], cubics: Cubic[], times: number[]) {
  if (cubics.length === 0) return null;
  const segs = replaySegs(cubics);
  const first = times[0];
  const last = times[times.length - 1];
  const offsets: [Point2, Point2][] = [];
  let maxPx = 0;
  let sumPx = 0;
  let maxMs = 0;
  let sumMs = 0;
  let worst = -1;
  let skipped = 0;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (p.t < first || p.t > last) continue;
    if ((i > 0 && raw[i - 1].t === p.t) || (i + 1 < raw.length && raw[i + 1].t === p.t)) {
      skipped++;
      continue;
    }
    const { seg, f } = replaySegAt(times, p.t);
    const sg = segs[seg];
    if (sg === null) continue;
    const q = alongSeg(sg, f);
    const px = Math.hypot(q.x - p.x, q.y - p.y);
    const total = sg.len[sg.len.length - 1];
    const u = total > 0 ? nearestAlong(sg, p) / total : 0;
    const ms = Math.abs(times[seg] + u * (times[seg + 1] - times[seg]) - p.t);
    offsets.push([p, q]);
    sumPx += px;
    sumMs += ms;
    if (px > maxPx) {
      maxPx = px;
      worst = offsets.length - 1;
    }
    if (ms > maxMs) maxMs = ms;
  }
  if (offsets.length === 0) return null;
  const n = offsets.length;
  return { maxPx, meanPx: sumPx / n, maxMs, meanMs: sumMs / n, worst, offsets, skipped };
}

// Where the pen was at t, between the samples either side. Of samples sharing
// one t, the last.
function rawAt(raw: Point3[], t: number): Point2 {
  if (t <= raw[0].t) return raw[0];
  if (t >= raw[raw.length - 1].t) return raw[raw.length - 1];
  let lo = 0;
  let hi = raw.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (raw[m].t <= t) lo = m;
    else hi = m;
  }
  const a = raw[lo];
  const b = raw[hi];
  const f = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// --- drawing ---

// Alternating, so a split between two cubics is visible even where the join
// is smooth.
const SEGMENT_COLORS = ["#2563eb", "#e11d48"];
// The whole curve, when segments are not told apart.
const CURVE_COLOR = "#2563eb";
// Earlier frames, one colour whatever the segments, fading with age.
const ONION_COLOR = "#0d9488";
const CORNER_COLOR = "#c026d3";
const PROBE_COLOR = "#ea580c";
// The replayed pen, and its offsets from the raw samples.
const REPLAY_COLOR = "#0891b2";

const cubicPath = (c: Cubic) =>
  `M${c[0].x} ${c[0].y}C${c[1].x} ${c[1].y} ${c[2].x} ${c[2].y} ${c[3].x} ${c[3].y}`;

// Every mark of a layer goes into one path. An SVG element per point and per
// segment -- thousands of them, re-diffed and repainted every frame -- is what
// made drawing lag once strokes got dense.

// Circles as two arcs each; `r` in content px.
function circlesPath(pts: Point2[], r: (p: Point2) => number): string {
  let d = "";
  for (const p of pts) {
    const pr = r(p);
    d += `M${p.x - pr} ${p.y}a${pr} ${pr} 0 1 0 ${2 * pr} 0a${pr} ${pr} 0 1 0 ${-2 * pr} 0`;
  }
  return d;
}

// Diamonds, `r` from centre to tip in content px.
function diamondsPath(pts: Point2[], r: number): string {
  let d = "";
  for (const p of pts) d += `M${p.x - r} ${p.y}l${r} ${-r}l${r} ${r}l${-r} ${r}z`;
  return d;
}

const cubicsPath = (cs: Cubic[]) => cs.map(cubicPath).join("");

const fmt = (n: number | undefined, digits = 2) =>
  n === undefined || !Number.isFinite(n) ? "–" : n.toFixed(digits);

// --- controls ---

function Knob(props: {
  label: string;
  title: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (v: number) => void;
}) {
  const digits = props.step >= 1 ? 0 : Math.ceil(-Math.log10(props.step));
  return (
    <label class="knob" title={props.title}>
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onInput(+(e.target as HTMLInputElement).value)}
      />
      <span class="num">{props.value.toFixed(digits)}</span>
    </label>
  );
}

function Pick<T extends string>(props: { options: T[]; value: T; onPick: (v: T) => void }) {
  return (
    <div class="pick">
      {props.options.map((o) => (
        <button key={o} class={o === props.value ? "on" : ""} onClick={() => props.onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Check(props: { label: string; value: boolean; onInput: (v: boolean) => void }) {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={props.value}
        onInput={(e) => props.onInput((e.target as HTMLInputElement).checked)}
      />
      {props.label}
    </label>
  );
}

function Section(props: { title: string; children: ComponentChildren }) {
  return (
    <section class="section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

// --- corner inspector ---

// Past the threshold but not the most-turning sample near it: suppressed.
const verdict = (r: CornerTrace, thr: number) =>
  r.corner ? "→ corner" : r.turn >= thr ? "→ suppressed" : "→ not";

// out/in per vertex, log scale, with each vertex's turn below it
function CornerStrip(props: {
  trace: CornerTrace[];
  s: Settings;
  probe: number | null;
  onProbe: (at: number) => void;
}) {
  const { trace, s } = props;
  const N = trace.length;
  const H = 110;
  const TH = 40;

  const plot = useMemo(() => {
    let lo = 1;
    let hi = 1;
    for (const r of trace) {
      lo = Math.min(lo, r.out / r.in);
      hi = Math.max(hi, r.out / r.in);
    }
    // ratio 1 makes lo === hi
    const L0 = Math.log(lo);
    const L1 = Math.max(Math.log(hi), L0 + Math.log(10));
    const y = (v: number) => H - ((Math.log(v) - L0) / (L1 - L0)) * H;

    let ratio = "";
    let corners = "";
    let turn = "";
    trace.forEach((r, i) => {
      const x = i + 0.5;
      ratio += `${i === 0 ? "M" : "L"}${x} ${y(r.out / r.in)}`;
      turn += `${i === 0 ? "M" : "L"}${x} ${TH - (r.turn / Math.PI) * TH}`;
      if (r.corner) corners += `M${x} 0V${H}`;
    });
    return {
      ratio,
      corners,
      one: `M0 ${y(1)}H${N}`,
      turn,
      lo,
      hi: Math.exp(L1),
    };
  }, [trace]);

  const i = trace.findIndex((r) => r.at === props.probe);
  const row = i === -1 ? null : trace[i];
  const thr = s.cornerTurn * DEG;

  const pick = (e: PointerEvent) => {
    const b = (e.currentTarget as Element).getBoundingClientRect();
    const j = Math.floor(((e.clientX - b.left) / b.width) * N);
    if (j >= 0 && j < N) props.onProbe(trace[j].at);
  };

  return (
    <div class="strip">
      <div class="strip-head">
        {row === null ? (
          <span class="dim">no vertex probed</span>
        ) : (
          <>
            <span>
              vertex {i + 1}/{N} <span class="dim">(sample {row.at})</span>
            </span>
            <span>in {fmt(row.in)}px</span>
            <span>out {fmt(row.out)}px</span>
            <span>×{fmt(row.out / row.in)}</span>
            <span class={row.turn >= thr ? "ok" : "warn"}>turn {fmt(row.turn / DEG, 0)}°</span>
            <span class={row.corner ? "ok" : "dim"}>{verdict(row, thr)}</span>
          </>
        )}
        <span class="spacer" />
        <span class="dim">need {s.cornerTurn}°</span>
      </div>
      <div class="strip-plot">
        <span class="strip-axis">
          <span>×{fmt(plot.hi, 1)}</span>
          <span>out/in</span>
          <span>×{fmt(plot.lo, 2)}</span>
        </span>
        <svg
          viewBox={`0 0 ${N} ${H}`}
          preserveAspectRatio="none"
          height={H}
          onPointerDown={(e) => {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) pick(e);
          }}
        >
          <path d={plot.one} stroke="#444" stroke-width="1" vector-effect="non-scaling-stroke" />
          <path
            d={plot.corners}
            stroke={CORNER_COLOR}
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
          <path
            d={plot.ratio}
            fill="none"
            stroke="#8ab4f8"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
          {row !== null && (
            <path
              d={`M${i + 0.5} 0V${H}`}
              stroke="#fff"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div class="strip-plot">
        <span class="strip-axis">
          <span>180°</span>
          <span>turn</span>
          <span>0°</span>
        </span>
        <svg
          viewBox={`0 0 ${N} ${TH}`}
          preserveAspectRatio="none"
          height={TH}
          onPointerDown={(e) => {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) pick(e);
          }}
        >
          <path
            d={`M0 ${TH - (s.cornerTurn / 180) * TH}H${N}`}
            stroke="#e0a050"
            stroke-width="1"
            stroke-dasharray="3 2"
            vector-effect="non-scaling-stroke"
          />
          <path
            d={plot.turn}
            fill="none"
            stroke="#8ab4f8"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
          {row !== null && (
            <path
              d={`M${i + 0.5} 0V${TH}`}
              stroke="#fff"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div class="strip-key">
        <span style={{ color: "#8ab4f8" }}>out/in, turn</span>
        <span style={{ color: "#e0a050" }}>min turn</span>
        <span style={{ color: "#666" }}>×1</span>
        <span style={{ color: CORNER_COLOR }}>corner</span>
      </div>
    </div>
  );
}

export function CenterlinePage() {
  const [s, setS] = useState<Settings>(() => load(SETTINGS_KEY, DEFAULTS));
  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));

  // Imports can hold several strokes; one is on the bench at a time.
  const [saved] = useState(() =>
    load(STROKES_KEY, { strokes: [] as Point3[][], index: 0, meta: null as Meta }),
  );
  const [strokes, setStrokes] = useState<Point3[][]>(saved.strokes);
  const [index, setIndex] = useState(Math.min(saved.index, Math.max(0, saved.strokes.length - 1)));
  const stroke = strokes[index] ?? [];
  const [fed, setFed] = useState(stroke.length);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [drawing, setDrawing] = useState(false);
  // How the stroke on the bench was drawn, when it was drawn here.
  const [meta, setMeta] = useState<Meta>(saved.meta);
  const [saveStatus, setSaveStatus] = useState("");
  const [probe, setProbe] = useState<number | null>(null);
  // The replay: whether it is playing, and the stroke time the pens are at,
  // set by playing or by the time slider.
  const [playing, setPlaying] = useState(false);
  const [playT, setPlayT] = useState<number | null>(null);
  const playFrom = useRef(0);

  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The stroke being drawn: pointermove fires faster than render, so appends
  // read the ref rather than the state a stale closure would hand them.
  const liveRef = useRef<Point3[] | null>(null);
  const t0 = useRef(0);
  // pointermove can fire several times per display frame. Samples are appended
  // as they arrive, and the page re-renders once per frame on whatever came.
  const frameReq = useRef(0);
  const panning = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => save(SETTINGS_KEY, s), [s]);
  // Not while drawing: a stroke is saved once, at pen-up.
  useEffect(() => {
    if (liveRef.current === null) save(STROKES_KEY, { strokes, index, meta });
  }, [strokes, index, meta]);

  // The zoom the stroke was drawn at: stage 0's filter is in screen px, as the
  // pen moved on screen. An imported stroke does not say, so 1.
  const drawnZoom = meta?.zoom ?? 1;

  // The same pipeline one sample earlier: what was on screen the frame before.
  const ghost = useMemo((): Fitted => {
    if (fed < 2) return { cubics: [], times: [] };
    return run(stroke, fed - 1, s, drawnZoom, true);
  }, [stroke, fed, s, drawnZoom]);

  // Onion skin: the last `onionFrames` frames before this one, newest first,
  // each as it stood with the pen still down. The newest is the ghost.
  const onion = useMemo((): string[] => {
    if (!s.showOnion) return [];
    const out: string[] = [];
    for (let j = 1; j <= s.onionFrames && fed - j >= 1; j++) {
      const cubics = j === 1 ? ghost.cubics : run(stroke, fed - j, s, drawnZoom, true).cubics;
      out.push(cubicsPath(cubics));
    }
    return out;
  }, [stroke, fed, s, drawnZoom, ghost]);

  const frame = useMemo(() => {
    const repeat = !drawing;
    // Open while drawing, and whenever the scrubber stops short of the end: that
    // prefix is the stroke as it stood with the pen still down.
    const open = drawing || fed < stroke.length;
    const pts = stroke.slice(0, fed);
    const o = pipelineOptions(s, drawnZoom);
    const t = tOpen(pts, open);
    const [curves, tCenterline] = timed(() => new Centerline(pts, o).curves(t), repeat);
    const trace: CornerTrace[] = [];
    const { radius } = centerlineStages(pts, o, t, trace);
    return {
      raw: radius.map((p) => ({ x: p.x, y: p.y, t: p.tStart })),
      radius,
      trace: s.cornerDebug ? trace : null,
      input: radius,
      cubics: nodeCubics(curves),
      times: curves.map((n) => n.tStart),
      tCenterline,
    };
  }, [stroke, fed, s, drawnZoom, drawing]);

  // How densely the stroke was sampled. The pen-up sample repeats the last
  // position, so zero-length gaps are left out.
  const sampling = useMemo(() => {
    const px: number[] = [];
    const ms: number[] = [];
    for (let i = 1; i < stroke.length; i++) {
      const d = Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
      if (d === 0) continue;
      px.push(d);
      ms.push(stroke[i].t - stroke[i - 1].t);
    }
    if (px.length === 0) return null;
    const q = (a: number[], f: number) => a.sort((x, y) => x - y)[Math.floor(f * (a.length - 1))];
    return { px50: q(px, 0.5), px90: q(px, 0.9), ms50: q(ms, 0.5), ms90: q(ms, 0.9) };
  }, [stroke]);

  const stats = useMemo(() => {
    const polys = sampleCubics(frame.cubics);
    // Against the samples the pen actually laid down.
    const raw = deviation(stroke.slice(0, fed), polys);
    const input = deviation(frame.input, polys);
    // How far ink from the frame before moved, leaving out that frame's last
    // segment -- the open one, which is allowed to change.
    const settled = sampleCubics(ghost.cubics.slice(0, -1)).flatMap((c) => c.poly);
    const moved = settled.length > 0 ? deviation(settled, polys) : null;
    return {
      raw,
      input,
      moved,
      broken: frame.cubics.filter((c) => !c.every(isFinitePoint)).length,
    };
  }, [frame, ghost, stroke, fed]);

  // The samples timed as the pipeline saw them. The replay is held against
  // these.
  const laid = frame.raw;
  // Not while drawing: it is read once the pen lifts.
  const replay = useMemo(
    () => (drawing ? null : replayError(laid, frame.cubics, frame.times)),
    [frame, laid, drawing],
  );

  // The replay's span: the first node's t to the last.
  const span =
    frame.times.length < 2
      ? null
      : { from: frame.times[0], to: frame.times[frame.times.length - 1] };
  // The time the pens are drawn at, held inside the span: a new frame -- a
  // scrub of `fed`, a setting -- can move it out from under a time set before.
  const penT =
    span === null || !s.showPens
      ? null
      : Math.min(span.to, Math.max(span.from, playT ?? span.from));

  // From where the pens are, or from the start once they reach the end.
  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (span === null || penT === null) return;
    playFrom.current = penT >= span.to ? span.from : penT;
    setPlaying(true);
  }

  // At `replaySpeed` times real time, as it was when play was pressed. A new
  // frame mid-play does not restart it; the pens are held to the new span.
  useEffect(() => {
    if (!playing) return;
    if (span === null) {
      setPlaying(false);
      return;
    }
    const to = span.to;
    const from = playFrom.current;
    const speed = s.replaySpeed;
    const start = performance.now();
    let req = 0;
    const tick = (now: number) => {
      const t = from + (now - start) * speed;
      if (t >= to) {
        setPlayT(to);
        setPlaying(false);
        return;
      }
      setPlayT(t);
      req = requestAnimationFrame(tick);
    };
    req = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(req);
  }, [playing]);

  // Both pens at `penT`: where the raw samples put it, and where the replayed
  // curve does, and the gap between.
  const playLayer = useMemo(() => {
    if (penT === null || fed === 0) return null;
    const { seg, f } = replaySegAt(frame.times, penT);
    const sg = replaySegs([frame.cubics[seg]])[0];
    if (sg === null) return null;
    const raw = rawAt(laid, penT);
    const curve = alongSeg(sg, f);
    return { raw, curve, gap: Math.hypot(curve.x - raw.x, curve.y - raw.y) };
  }, [penT, frame, laid, fed]);

  // Markers are drawn inside the zoomed group, so their radii carry the
  // inverse -- a dot stays a dot at 40x.
  const k = 1 / view.zoom;
  // The curve as a hairline, or as wide as the pen in content px, so it grows
  // with the zoom like the ink would.
  const curveStroke = s.curveAtWidth
    ? ({
        "stroke-width": s.maxWidth,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      } as const)
    : ({ "stroke-width": 2, "vector-effect": "non-scaling-stroke" } as const);

  const layers = useMemo(() => {
    const { cubics, input } = frame;
    const curved = cubics.filter((c) => !isStraight(c));
    let handleLines = "";
    for (const c of curved) {
      handleLines += `M${c[0].x} ${c[0].y}L${c[1].x} ${c[1].y}M${c[3].x} ${c[3].y}L${c[2].x} ${c[2].y}`;
    }
    const nodes = cubics.length === 0 ? [] : [cubics[0][0], ...cubics.map((c) => c[3])];
    return {
      handleLines,
      handleDots: circlesPath(
        curved.flatMap((c) => [c[1], c[2]]),
        () => 3 * k,
      ),
      // even and odd segments, one path per colour
      curves: SEGMENT_COLORS.map((_, j) =>
        cubicsPath(cubics.filter((_, i) => i % SEGMENT_COLORS.length === j)),
      ),
      nodes: circlesPath(nodes, () => 4 * k),
      rawFed: circlesPath(stroke.slice(0, fed), () => 2 * k),
      rawUnfed: circlesPath(stroke.slice(fed), () => 2.5 * k),
      input: circlesPath(input, () => 2 * k),
      corners: diamondsPath(
        input.filter((p) => p.corner),
        6 * k,
      ),
    };
  }, [frame, stroke, fed, k]);

  const replayLayer = useMemo(() => {
    if (!s.showReplay || replay === null) return null;
    let offsets = "";
    for (const [p, q] of replay.offsets) offsets += `M${p.x} ${p.y}L${q.x} ${q.y}`;
    // -1, so undefined, when every offset is 0
    const w = replay.offsets[replay.worst];
    return { offsets, worst: w === undefined ? "" : `M${w[0].x} ${w[0].y}L${w[1].x} ${w[1].y}` };
  }, [s.showReplay, replay]);

  const probeLayer = useMemo(() => {
    const row = frame.trace?.find((r) => r.at === probe);
    if (row === undefined) return null;
    const pts = frame.radius;
    const a = pts[row.prev];
    const p = pts[row.at];
    const b = pts[row.next];
    return {
      in: `M${a.x} ${a.y}L${p.x} ${p.y}`,
      out: `M${p.x} ${p.y}L${b.x} ${b.y}`,
      at: circlesPath([p], () => 9 * k),
    };
  }, [frame, probe, k]);

  // --- input ---

  function pick(next: Point3[][], i: number) {
    setStrokes(next);
    setIndex(i);
    setFed(next[i]?.length ?? 0);
  }

  function importText(text: string) {
    let next: Point3[][];
    try {
      // This page's own copy format first, then the main app's export.
      const data = JSON.parse(text);
      next = [data.raw];
      setMeta(
        typeof data.pointerType === "string"
          ? {
              pointerType: data.pointerType,
              zoom: data.zoom ?? 1,
              coalesced: data.coalesced === true,
            }
          : null,
      );
    } catch {
      // A .scrawl from the main page. The bench keeps one note of how its
      // strokes were drawn, so they take the first one's zoom.
      const imported = deserialize(text);
      next = imported.map((st) => st.points);
      const zoom = imported[0]?.zoom ?? 1;
      setMeta(zoom === 1 ? null : { pointerType: "imported", zoom, coalesced: false });
    }
    next = next.filter((st) => Array.isArray(st) && st.length > 0);
    if (next.length === 0) return;
    pick(next, 0);
    frameStroke(next[0]);
  }

  async function paste() {
    try {
      importText(await navigator.clipboard.readText());
    } catch {}
  }

  // Everything needed to replay this frame outside the page: the fed samples
  // at full precision, every setting, and the cubics that came back.
  function copyData() {
    const data = { settings: s, raw: stroke.slice(0, fed), cubics: frame.cubics };
    navigator.clipboard.writeText(JSON.stringify(data));
  }

  // Dev server only: write the whole stroke to rescrawl/test/samples/ (see
  // vite.config.ts). The label is for whoever reads the file later -- what was
  // being drawn, what looked wrong.
  async function saveSample() {
    const label = window.prompt("Label (optional): what you drew, what looks wrong", "");
    if (label === null) return;
    const data = {
      label,
      savedAt: new Date().toISOString(),
      // Jitter in content px depends on the device and on the zoom drawn at.
      pointerType: meta?.pointerType ?? "unknown",
      zoom: meta?.zoom ?? null,
      coalesced: meta?.coalesced ?? null,
      devicePixelRatio: window.devicePixelRatio,
      fed, // the frame on screen when saved
      settings: s,
      raw: stroke,
    };
    try {
      const res = await fetch("/__samples", { method: "POST", body: JSON.stringify(data) });
      const text = await res.text();
      setSaveStatus(res.ok ? `saved ${text}` : `save failed: ${text}`);
    } catch (e) {
      setSaveStatus(`save failed: ${e}`);
    }
  }

  // Fit the stroke's bounds into the canvas.
  function frameStroke(st: Point3[]) {
    const svg = svgRef.current;
    if (svg === null || st.length === 0) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of st) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const r = svg.getBoundingClientRect();
    const PAD = 40;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const zoom = Math.max(0.1, Math.min(40, (r.width - 2 * PAD) / w, (r.height - 2 * PAD) / h));
    setView({
      x: r.width / 2 - ((minX + maxX) / 2) * zoom,
      y: r.height / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  }

  const toContent = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - view.x) / view.zoom,
      y: (e.clientY - r.top - view.y) / view.zoom,
    };
  };

  // Recorded the way the main app records: t in ms from pen-down, and the pen
  // held at its last position until pen-up so the release time is kept.
  function handlePointerDown(e: PointerEvent) {
    // Middle button pans, left button draws.
    if (e.button === 1) {
      svgRef.current!.setPointerCapture(e.pointerId);
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    if (e.shiftKey && frame.trace !== null) {
      const c = toContent(e);
      let best = Infinity;
      for (const r of frame.trace) {
        const q = frame.radius[r.at];
        const d = (q.x - c.x) ** 2 + (q.y - c.y) ** 2;
        if (d < best) {
          best = d;
          setProbe(r.at);
        }
      }
      return;
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    t0.current = e.timeStamp;
    setMeta({ pointerType: e.pointerType, zoom: view.zoom, coalesced: s.coalesced });
    setSaveStatus("");
    const live = [{ ...toContent(e), t: 0 }];
    liveRef.current = live;
    setDrawing(true);
    pick([live.slice()], 0);
  }

  function handlePointerMove(e: PointerEvent) {
    const drag = panning.current;
    if (drag !== null) {
      setView((v) => ({ ...v, x: v.x + e.clientX - drag.x, y: v.y + e.clientY - drag.y }));
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const live = liveRef.current;
    if (live === null) return;
    // The browser delivers one pointermove per display frame and folds the
    // rest into it; getCoalescedEvents hands them back, each with its own
    // position and time. Some browsers lack it or return an empty list.
    const merged =
      s.coalesced && typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const ev of merged.length > 0 ? merged : [e]) {
      live.push({ ...toContent(ev), t: ev.timeStamp - t0.current });
    }
    if (frameReq.current === 0) {
      frameReq.current = requestAnimationFrame(() => {
        frameReq.current = 0;
        // A copy, so the memos see a new stroke.
        if (liveRef.current !== null) pick([liveRef.current.slice()], 0);
      });
    }
  }

  function endGesture(e: PointerEvent) {
    panning.current = null;
    const live = liveRef.current;
    if (live === null) return;
    cancelAnimationFrame(frameReq.current);
    frameReq.current = 0;
    liveRef.current = null;
    setDrawing(false);
    pick([holdEndUntil(live, e.timeStamp - t0.current)], 0);
  }

  function zoomAt(e: WheelEvent, factor: number) {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const next = Math.max(0.1, Math.min(40, v.zoom * factor));
      return {
        x: mx - ((mx - v.x) / v.zoom) * next,
        y: my - ((my - v.y) / v.zoom) * next,
        zoom: next,
      };
    });
  }

  // Arrow keys step the scrubber, unless a control has focus and wants them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") setFed((n) => Math.max(0, n - 1));
      else if (e.key === "ArrowRight") setFed((n) => Math.min(stroke.length, n + 1));
      else if ((e.key === "[" || e.key === "]") && frame.trace !== null) {
        const i = frame.trace.findIndex((r) => r.at === probe);
        const row = i === -1 ? frame.trace[0] : frame.trace[i + (e.key === "[" ? -1 : 1)];
        if (row !== undefined) setProbe(row.at);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stroke.length, frame.trace, probe]);

  const { cubics, input } = frame;

  return (
    <>
      <header class="bar">
        <span class="bar-title">centerline</span>
        {strokes.length > 1 && (
          <>
            <button onClick={() => pick(strokes, index - 1)} disabled={index === 0}>
              ◀
            </button>
            <span class="stat">
              stroke {index + 1}/{strokes.length}
            </span>
            <button
              onClick={() => pick(strokes, index + 1)}
              disabled={index === strokes.length - 1}
            >
              ▶
            </button>
          </>
        )}
        <span class="spacer" />
        {saveStatus !== "" && <span class="stat dim">{saveStatus}</span>}
        <button
          onClick={paste}
          title="paste a stroke: this page's copied JSON, or text exported from the main page"
        >
          paste
        </button>
        <button
          onClick={() => fileRef.current!.click()}
          title="open a file exported from the main page"
        >
          open
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={async (e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (file) importText(await file.text());
          }}
        />
        <button
          onClick={copyData}
          disabled={fed === 0}
          title="copy the fed samples, every setting and the output cubics as JSON"
        >
          copy
        </button>
        {import.meta.env.DEV && (
          <button
            onClick={saveSample}
            disabled={stroke.length === 0}
            title="save this stroke to rescrawl/test/samples/ (dev server only)"
          >
            save
          </button>
        )}
        <button onClick={() => pick([], 0)} disabled={strokes.length === 0}>
          clear
        </button>
        <button onClick={() => frameStroke(stroke)}>frame</button>
      </header>

      <div class="main">
        <aside class="panel">
          <Section title="input">
            <Check
              label="record merged events"
              value={s.coalesced}
              onInput={(coalesced) => set({ coalesced })}
            />
            <Knob
              label="frame ms"
              title="ms between input frames. A run of samples on one ms is spread back over at most this; any more of a gap is the pen sitting still."
              min={4}
              max={34}
              step={0.1}
              value={s.framePeriod}
              onInput={(framePeriod) => set({ framePeriod })}
            />
            <Knob
              label="min move"
              title="Screen px a sample must be from the last one kept, or it is folded into it: the one filter in the pipeline. The first is kept, later ones only extend how long the pen stayed."
              min={0}
              max={6}
              step={0.1}
              value={s.minMove}
              onInput={(minMove) => set({ minMove })}
            />
            <p class="note">
              stamps trusted to be late, never early; a sample within min move, or a gap past one
              frame, is the pen sitting still until it leaves
            </p>
          </Section>

          <Section title="radius">
            <Pick
              options={["speed", "fixed"] as RadiusKind[]}
              value={s.radius}
              onPick={(radius) => set({ radius })}
            />
            <Knob
              label="max width"
              title="Pen width at a standstill. Also the fixed radius."
              min={1}
              max={40}
              step={0.5}
              value={s.maxWidth}
              onInput={(maxWidth) => set({ maxWidth })}
            />
            {s.radius === "speed" && (
              <>
                <Knob
                  label="min width"
                  title="Pen width at or above thin speed."
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={s.minWidth}
                  onInput={(minWidth) => set({ minWidth })}
                />
                <Knob
                  label="thin speed"
                  title="Screen px/ms at which the stroke reaches min width."
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={s.thinSpeed}
                  onInput={(thinSpeed) => set({ thinSpeed })}
                />
                <Knob
                  label="lag"
                  title="ms for the width to catch up."
                  min={0}
                  max={400}
                  step={5}
                  value={s.widthLag}
                  onInput={(widthLag) => set({ widthLag })}
                />
              </>
            )}
          </Section>

          <Section title="corners">
            <Knob
              label="arm"
              title="Screen px of arc length either side of a sample that its in and out chords reach."
              min={0}
              max={32}
              step={0.5}
              value={s.cornerArm}
              onInput={(cornerArm) => set({ cornerArm })}
            />
            <Knob
              label="min turn°"
              title="angle between in chord and out chord at or above this, and the most of any sample within arm"
              min={0}
              max={180}
              step={1}
              value={s.cornerTurn}
              onInput={(cornerTurn) => set({ cornerTurn })}
            />
            <Check
              label="inspect"
              value={s.cornerDebug}
              onInput={(cornerDebug) => set({ cornerDebug })}
            />
            {s.cornerDebug && (
              <p class="note">
                shift-click the canvas or drag in the strip to probe a vertex; [ ] step it
              </p>
            )}
          </Section>

          <Section title="smoothing">
            <Knob
              label="window"
              title="Screen px of arc length either side of a point averaged into it (smoothPositions). 0 is off. Shrinks toward the ends so they pass through."
              min={0}
              max={16}
              step={0.5}
              value={s.smoothWindow}
              onInput={(smoothWindow) => set({ smoothWindow })}
            />
          </Section>

          <Section title="fit">
            <Knob
              label="tol"
              title="Screen px a sample may lie off the segment that skips it."
              min={0}
              max={8}
              step={0.05}
              value={s.handTol}
              onInput={(handTol) => set({ handTol })}
            />
            <Knob
              label="reparam"
              title="Rounds of: move each sample's u to the nearest point on the curve, then solve the lengths again. 0 is one solve at the arc-length guesses."
              min={0}
              max={10}
              step={1}
              value={s.reparam}
              onInput={(reparam) => set({ reparam })}
            />
          </Section>

          <Section title="layers">
            <Check label="raw samples" value={s.showRaw} onInput={(showRaw) => set({ showRaw })} />
            <Check
              label="fit input"
              value={s.showInput}
              onInput={(showInput) => set({ showInput })}
            />
            <Check label="curve" value={s.showCurve} onInput={(showCurve) => set({ showCurve })} />
            {s.showCurve && (
              <Check
                label="at max width"
                value={s.curveAtWidth}
                onInput={(curveAtWidth) => set({ curveAtWidth })}
              />
            )}
            {s.showCurve && (
              <Check
                label="one colour"
                value={s.curveOneColor}
                onInput={(curveOneColor) => set({ curveOneColor })}
              />
            )}
            <Check
              label="handles + nodes"
              value={s.showHandles}
              onInput={(showHandles) => set({ showHandles })}
            />
            <Check
              label="corners"
              value={s.showCorners}
              onInput={(showCorners) => set({ showCorners })}
            />
            <Check
              label="onion skin"
              value={s.showOnion}
              onInput={(showOnion) => set({ showOnion })}
            />
            {s.showOnion && (
              <Knob
                label="frames"
                title="How many earlier frames to draw under the curve, fading with age."
                min={1}
                max={20}
                step={1}
                value={s.onionFrames}
                onInput={(onionFrames) => set({ onionFrames })}
              />
            )}
          </Section>

          <Section title="replay">
            <Check
              label="offsets at sample times"
              value={s.showReplay}
              onInput={(showReplay) => set({ showReplay })}
            />
            <Check
              label="pens at time"
              value={s.showPens}
              onInput={(showPens) => set({ showPens })}
            />
            <Knob
              label="speed"
              title="Playback speed, × real time."
              min={0.05}
              max={1}
              step={0.05}
              value={s.replaySpeed}
              onInput={(replaySpeed) => set({ replaySpeed })}
            />
            <p class="note">
              each segment runs from its start node's t to its end node's t at constant speed; scrub
              or play the pens from the bar below
            </p>
          </Section>

          <Section title="readout">
            <table class="readout">
              <tbody>
                {sampling !== null && (
                  <tr title="gap between consecutive raw samples, px and ms: median / 90th percentile. How the stroke was recorded is in brackets.">
                    <th>sample gap</th>
                    <td>
                      {fmt(sampling.px50, 1)} / {fmt(sampling.px90, 1)} px
                      <br />
                      {fmt(sampling.ms50, 0)} / {fmt(sampling.ms90, 0)} ms
                      <span class="dim">
                        {" "}
                        (
                        {meta === null
                          ? "imported"
                          : `${meta.pointerType}${meta.coalesced ? ", merged" : ""}`}
                        )
                      </span>
                    </td>
                  </tr>
                )}
                <tr title="samples kept by stage 0 -- the one filter -- of those fed; every stage after keeps them all">
                  <th>kept</th>
                  <td>
                    {input.length}
                    <span class="dim"> of {fed}</span>
                  </td>
                </tr>
                <tr title="corners flagged in the fit input">
                  <th>corners</th>
                  <td>{input.filter((p) => p.corner).length}</td>
                </tr>
                <tr>
                  <th>segments</th>
                  <td>{cubics.length}</td>
                </tr>
                {stats.broken > 0 && (
                  <tr title="cubics containing NaN or Infinity -- these draw nothing">
                    <th>non-finite</th>
                    <td class="warn">{stats.broken}</td>
                  </tr>
                )}
                <tr title="distance from each raw sample to the curve: max / mean, px">
                  <th>err vs raw</th>
                  <td>
                    {fmt(stats.raw?.max)} / {fmt(stats.raw?.mean)}
                  </td>
                </tr>
                <tr title="distance from each fit input point to the curve: max / mean, px">
                  <th>err vs input</th>
                  <td>
                    {fmt(stats.input?.max)} / {fmt(stats.input?.mean)}
                  </td>
                </tr>
                <tr title="how far the previous frame's settled ink (all but its last segment) is from this frame's curve: max, px">
                  <th>moved</th>
                  <td class={stats.moved !== null && stats.moved.max > 0.5 ? "warn" : ""}>
                    {fmt(stats.moved?.max, 3)}
                  </td>
                </tr>
                {replay !== null && (
                  <tr title="the curve replayed segment by segment between its nodes' timestamps, against each raw sample at its own: max / mean distance at that time (px), and max / mean how early or late the replay passes the sample (ms). Samples sharing their ms with a neighbour are skipped.">
                    <th>replay</th>
                    <td>
                      {fmt(replay.maxPx, 1)} / {fmt(replay.meanPx, 1)} px
                      <br />
                      <span class={replay.maxMs > 1000 / 60 ? "warn" : ""}>
                        {fmt(replay.maxMs, 0)}
                      </span>{" "}
                      / {fmt(replay.meanMs, 1)} ms
                      {replay.skipped > 0 && (
                        <span class="dim"> ({replay.skipped} same-ms skipped)</span>
                      )}
                    </td>
                  </tr>
                )}
                <tr title="mean ms per Centerline.curves call">
                  <th>ms</th>
                  <td>{fmt(frame.tCenterline, 3)}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <button class="reset" onClick={() => setS({ ...DEFAULTS })}>
            reset settings
          </button>
        </aside>

        <div class="stage">
          <div class="view">
            <svg
              ref={svgRef}
              class="canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onWheel={(e) => {
                e.preventDefault();
                if (e.ctrlKey) zoomAt(e, Math.pow(1.001, -e.deltaY));
                else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
              }}
              // stylus long press
              onContextMenu={(e) => e.preventDefault()}
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}>
                {/* oldest first, so newer frames draw over it */}
                {onion
                  .map((d, j) => (
                    <path
                      key={j}
                      d={d}
                      fill="none"
                      stroke={ONION_COLOR}
                      stroke-width="1.5"
                      stroke-opacity={0.7 * (1 - j / onion.length)}
                      vector-effect="non-scaling-stroke"
                    />
                  ))
                  .reverse()}
                {s.showHandles && (
                  <path
                    d={layers.handleLines}
                    fill="none"
                    stroke="#8b5cf6"
                    stroke-width="1"
                    stroke-dasharray="3 3"
                    vector-effect="non-scaling-stroke"
                  />
                )}
                {s.showHandles && (
                  <path
                    d={layers.handleDots}
                    fill="#fff"
                    stroke="#8b5cf6"
                    stroke-width="1"
                    vector-effect="non-scaling-stroke"
                  />
                )}
                {s.showCurve &&
                  layers.curves.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      fill="none"
                      stroke={s.curveOneColor ? CURVE_COLOR : SEGMENT_COLORS[i]}
                      {...curveStroke}
                    />
                  ))}
                {/* the nodes: where one segment hands off to the next */}
                {s.showHandles && (
                  <path
                    d={layers.nodes}
                    fill="none"
                    stroke="#111"
                    stroke-width="1.5"
                    vector-effect="non-scaling-stroke"
                  />
                )}
                {s.showRaw && (
                  <>
                    <path d={layers.rawFed} fill="#111" />
                    {/* beyond the fed prefix: input the fit has not seen yet */}
                    <path
                      d={layers.rawUnfed}
                      fill="none"
                      stroke="#bbb"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                  </>
                )}
                {s.showInput && <path d={layers.input} fill="#16a34a" />}
                {s.showCorners && (
                  <path
                    d={layers.corners}
                    fill="none"
                    stroke={CORNER_COLOR}
                    stroke-width="2"
                    vector-effect="non-scaling-stroke"
                  />
                )}
                {probeLayer !== null && (
                  <>
                    <path
                      d={probeLayer.in}
                      fill="none"
                      stroke={PROBE_COLOR}
                      stroke-width="1.5"
                      stroke-dasharray="4 3"
                      vector-effect="non-scaling-stroke"
                    />
                    <path
                      d={probeLayer.out}
                      fill="none"
                      stroke={PROBE_COLOR}
                      stroke-width="3"
                      vector-effect="non-scaling-stroke"
                    />
                    <path
                      d={probeLayer.at}
                      fill="none"
                      stroke={PROBE_COLOR}
                      stroke-width="2"
                      vector-effect="non-scaling-stroke"
                    />
                  </>
                )}
                {replayLayer !== null && (
                  <>
                    <path
                      d={replayLayer.offsets}
                      fill="none"
                      stroke={REPLAY_COLOR}
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <path
                      d={replayLayer.worst}
                      fill="none"
                      stroke={REPLAY_COLOR}
                      stroke-width="3"
                      vector-effect="non-scaling-stroke"
                    />
                  </>
                )}
                {playLayer !== null && (
                  <>
                    <path
                      d={`M${playLayer.raw.x} ${playLayer.raw.y}L${playLayer.curve.x} ${playLayer.curve.y}`}
                      fill="none"
                      stroke={REPLAY_COLOR}
                      stroke-width="1.5"
                      vector-effect="non-scaling-stroke"
                    />
                    <path
                      d={circlesPath([playLayer.raw], () => 6 * k)}
                      fill="none"
                      stroke="#111"
                      stroke-width="2"
                      vector-effect="non-scaling-stroke"
                    />
                    <path d={circlesPath([playLayer.curve], () => 5 * k)} fill={REPLAY_COLOR} />
                  </>
                )}
              </g>
            </svg>

            {stroke.length === 0 && (
              <p class="hint">
                drag to draw · paste or open a stroke from the main page · ctrl+wheel zooms ·
                middle-drag pans
              </p>
            )}
            <div class="legend">
              <span>
                <i style={{ background: "#111" }} />
                raw
              </span>
              <span>
                <i style={{ background: "#16a34a" }} />
                fit input
              </span>
              {s.curveOneColor ? (
                <span>
                  <i style={{ background: CURVE_COLOR }} />
                  curve
                </span>
              ) : (
                <span>
                  <i style={{ background: SEGMENT_COLORS[0] }} />
                  <i style={{ background: SEGMENT_COLORS[1] }} />
                  segments
                </span>
              )}
              <span>
                <i style={{ background: CORNER_COLOR }} />
                corner
              </span>
              {probeLayer !== null && (
                <span>
                  <i style={{ background: PROBE_COLOR }} />
                  probe: in dashed, out solid
                </span>
              )}
              {(replayLayer !== null || playLayer !== null) && (
                <span>
                  <i style={{ background: REPLAY_COLOR }} />
                  replay: {playLayer !== null ? "filled, raw ringed" : "offset, worst thick"}
                </span>
              )}
            </div>
          </div>
          {frame.trace !== null && (
            <CornerStrip trace={frame.trace} s={s} probe={probe} onProbe={setProbe} />
          )}
        </div>
      </div>

      <footer class="bar">
        <button
          onClick={() => setFed((n) => Math.max(0, n - 1))}
          disabled={fed === 0}
          title="feed one fewer sample (←)"
        >
          ◀
        </button>
        <input
          class="scrub"
          type="range"
          min={0}
          max={stroke.length}
          step={1}
          value={fed}
          onInput={(e) => setFed(+(e.target as HTMLInputElement).value)}
        />
        <button
          onClick={() => setFed((n) => Math.min(stroke.length, n + 1))}
          disabled={fed === stroke.length}
          title="feed one more sample (→)"
        >
          ▶
        </button>
        <span class="stat">
          fed {fed}/{stroke.length}
        </span>
        {span !== null && penT !== null && (
          <>
            <button
              onClick={togglePlay}
              title="play the curve back between its nodes' timestamps, beside the raw samples at theirs"
            >
              {playing ? "pause" : "play"}
            </button>
            <input
              class="scrub"
              type="range"
              min={span.from}
              max={span.to}
              step={1}
              value={penT}
              title="replay time"
              onInput={(e) => {
                setPlaying(false);
                setPlayT(+(e.target as HTMLInputElement).value);
              }}
            />
            <span class="stat pen">
              {fmt(penT - stroke[0].t, 0)} ms · gap {fmt(playLayer?.gap, 1)} px
            </span>
          </>
        )}
        <span class="stat dim">{(view.zoom * 100).toFixed(0)}%</span>
      </footer>
    </>
  );
}
