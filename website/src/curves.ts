import { getStroke } from "perfect-freehand";
import type {
  CenterlineNode,
  OutlineKind,
  OutlineNode,
  Point4,
  RenderOptions,
  StrokeStages,
} from "rescrawl";
import { centerlineStages, RENDER_DEFAULTS, renderStroke } from "rescrawl";
import { fitPath, outlinePath, outlineQuadPath } from "rescrawl/svg";
import type { Point, Stroke } from "./utils";
import { elapsedPoints } from "./utils";

// A renderer turns one stroke's raw data into a renderable line. When `shapes`
// is present the consumer fills those (variable-width); otherwise it strokes
// `curve` at `width`. Ink always has shapes, so only the reference strategies
// set `curve`.
export type RenderedLine = {
  curve?: string;
  width?: number;
  shapes?: string[];
};

// A purely-geometric drawer: given the points to draw, produce the line.
type Draw = (pts: Point[], param: number) => RenderedLine;

export type StrategyDef = {
  id: string;
  label: string;
  color: string;
  defaultParam: number;
  paramLabel: string; // '' means no param
  paramMin: number;
  paramMax: number;
  paramStep: number;
  // Draw the stroke as it exists at time `t` (Infinity = fully drawn).
  render: (stroke: Stroke, param: number, t: number) => RenderedLine;
};

export type ActiveStrategy = { def: StrategyDef; param: number };
export type StrategyState = { enabled: boolean; param: number };
export type StrategiesState = Record<string, StrategyState>;

// Independently-toggleable layers of the Debug overlay. The first four are the
// pipeline's stages, drawn as dots at the points that stage produced — turning
// two of them on side by side is what shows you what that stage did. The rest
// are derived geometry.
export type StageKey = Exclude<keyof StrokeStages, "prefixSum">;
// Derived geometry, drawn from a stage rather than being one: what the fit
// shaped (`centerline`, `handles`) and what was laid around it (`outline`).
export type ExtraKey = "centerline" | "handles" | "outline";
export type DebugLayers = Record<StageKey | ExtraKey, boolean>;

// `dot` is a fixed marker size in px, and `raw`, `smoothed` and `retimed` carry
// no radius of their own. From `radius` on, a stage draws each point at its own r: that circle is
// what the outline is wrapped around, so two stages side by side compare the
// ink they would actually lay down rather than two arbitrary dots.
export type StageLayer = { key: StageKey; label: string; color: string; dot?: number };
export const DEBUG_STAGES: StageLayer[] = [
  { key: "raw", label: "in · raw input", color: "#10b981", dot: 3.6 },
  { key: "smoothed", label: "0 · smoothed", color: "#f97316", dot: 3.2 },
  { key: "retimed", label: "1 · retimed", color: "#64748b", dot: 2.8 },
  { key: "radius", label: "2 · radius", color: "#eab308" },
  { key: "nodes", label: "3 · nodes", color: "#3b82f6" },
];

export type ExtraLayer = {
  key: ExtraKey;
  label: string;
  color: string;
};
// Named, unlike the stage colours: the overlay draws these two as strokes and
// markers rather than one circle per point, so the colour is needed at the
// drawing site as well as on the toggle.
export const CENTERLINE_COLOR = "#06b6d4";
export const HANDLE_COLOR = "#ec4899";

// In pipeline order, like the stages above: the fit's spine and the control
// points it solved for, then the outline laid around them.
export const DEBUG_EXTRAS: ExtraLayer[] = [
  { key: "centerline", label: "3 · centerline nodes", color: CENTERLINE_COLOR },
  { key: "handles", label: "3 · curve handles", color: HANDLE_COLOR },
  { key: "outline", label: "4 · outline pts", color: "#ef4444" },
];

// One stage point picked out of the overlay, for the radius readout. `dt` is the
// gap to the next point of that stage — and on its last point, the gap to where
// the stroke itself ends: the pen-up dwell, which the last point holds as its
// `tEnd` (see `retime`). Note that a stage drops points, so dt is the span the
// surviving point now covers, not the raw sample period.
export type StagePick = {
  x: number;
  y: number;
  r: number;
  dt: number;
  d: number;
  label: string;
  color: string;
};

// Whether any layer that carries a radius is on — nothing to read out if not.
export const hasRadiusLayer = (layers: DebugLayers): boolean =>
  DEBUG_STAGES.some(({ key, dot }) => dot === undefined && layers[key]);

// The stage point nearest (x, y) among the enabled radius-carrying layers, or
// null if the nearest is further than `maxDist`. Only those layers are searched,
// so what the readout names is always a circle that is on screen; a tie goes to
// the later stage, which is the one drawn on top.
export function pickStagePoint(
  stages: StrokeStages,
  layers: DebugLayers,
  x: number,
  y: number,
  maxDist: number,
): StagePick | null {
  let best: StagePick | null = null;
  let bestD2 = maxDist * maxDist;
  // Where the stroke ends as of the playhead: `raw` is the input every stage was
  // derived from, so its last sample is the time the last point of any stage is
  // holding until. Mid-stroke that is the playhead, and the gap is the one the
  // width EMA is still accruing.
  const end = stages.raw.length ? stages.raw[stages.raw.length - 1].t : 0;
  for (const { key, label, color, dot } of DEBUG_STAGES) {
    if (dot !== undefined || !layers[key]) continue;
    const pts = stages[key] as Point4[];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        const next = pts[i + 1];
        best = {
          x: p.x,
          y: p.y,
          r: p.r,
          dt: (next ? next.t : end) - p.t,
          d: Math.sqrt(d2),
          label,
          color,
        };
      }
    }
  }
  return best;
}

// Input and final centerline on by default — the two ends of the pipeline.
// Everything between is opt-in, or the overlay is unreadable.
export const DEBUG_DEFAULTS: DebugLayers = {
  raw: true,
  retimed: false,
  radius: false,
  smoothed: false,
  nodes: true,
  centerline: false,
  handles: false,
  outline: false,
};

// --- what the fit produced, for the two stage-4 overlay layers ---

// The fitted centerline as path data: a line where the fit said line, a cubic on
// the stored tangents where it said cubic. This is the spine the outline was
// actually laid around, not a polyline through the nodes — so a segment the fit
// got wrong shows up here as the wrong curve rather than as a plausible one.
// More digits than the ink path bothers with, since this is read at whatever
// zoom the fit is being inspected at.
export const fitCurvePath = (ns: CenterlineNode[]): string => fitPath(ns, 3);

// A corner node carries two tangents; at every other node the in- and
// out-tangents are the same vector. Drawn differently, because a corner is where
// the fit cut the run — the one node whose placement the outline wraps rather
// than rounds.
export const isCorner = (n: CenterlineNode): boolean => n.ix !== n.ox || n.iy !== n.oy;

// The Bezier control points behind that spine, one pair per curved segment:
// `fitPath` puts them a third of the way along each end's Hermite tangent, so a
// handle's direction is the unit tangent the fit read and its length is the
// magnitude the fit solved for. The straight-chord test is `fitPath`'s, so the
// handles shown are exactly the ones the drawn curve used — a segment with no
// handles is one the fit decided not to curve.
export type CurveHandle = { x: number; y: number; cx: number; cy: number };

export function curveHandles(ns: CenterlineNode[]): CurveHandle[] {
  const out: CurveHandle[] = [];
  for (let i = 1; i < ns.length; i++) {
    const a = ns[i - 1];
    const b = ns[i];
    if (a.mo === 0 && b.mi === 0) continue;
    out.push({ x: a.x, y: a.y, cx: a.x + (a.ox * a.mo) / 3, cy: a.y + (a.oy * a.mo) / 3 });
    out.push({ x: b.x, y: b.y, cx: b.x - (b.ix * b.mi) / 3, cy: b.y - (b.iy * b.mi) / 3 });
  }
  return out;
}

const LINE_WIDTH = 2;
const EMPTY: RenderedLine = { curve: "", width: LINE_WIDTH };

// Lift a geometric drawer into a time-aware renderer: map `t` to the drawn
// point prefix, then draw it. Keeps every algorithm free of timeline logic.
function timed(draw: Draw): StrategyDef["render"] {
  return (stroke, param, t) => {
    const pts = elapsedPoints(stroke, t);
    return pts.length ? draw(pts, param) : EMPTY;
  };
}

function r(n: number) {
  return Math.round(n * 100) / 100;
}

// Polyline `d` over {x,y}; single point renders as a dot.
function polylinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${r(pts[0].x)},${r(pts[0].y)} L ${r(pts[0].x)},${r(pts[0].y)}`;
  return "M " + pts.map((p) => `${r(p.x)},${r(p.y)}`).join(" L ");
}

// Add new rendering strategies here — each entry auto-appears in the Curve panel.
export const STRATEGY_DEFS: StrategyDef[] = [
  {
    id: "debug",
    label: "Debug",
    color: "#3b82f6",
    defaultParam: 0,
    paramLabel: "",
    paramMin: 0,
    paramMax: 0,
    paramStep: 0,
    // Special-cased everywhere it is drawn: enabling this paints the debug
    // overlay (centerline + offset points + raw dots), never this polyline. The
    // render is here because `StrategyDef` requires one; nothing calls it.
    render: timed((pts) => ({ curve: polylinePath(pts), width: LINE_WIDTH })),
  },
  {
    id: "cubic",
    label: "Cubic",
    color: "#f97316",
    defaultParam: 1,
    paramLabel: "smooth",
    paramMin: 0,
    paramMax: 1,
    paramStep: 0.1,
    // Cardinal spline → cubic bezier. smooth=0: polyline, smooth=1: Catmull-Rom
    render: timed((pts, smooth) => {
      if (pts.length < 2) return { curve: polylinePath(pts), width: LINE_WIDTH };
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
      return { curve: d, width: LINE_WIDTH };
    }),
  },
];

// The main render type — variable-width calligraphic ink from the rescrawl
// library. Always drawn (as the base layer); the strategies above are optional
// reference curves layered on top. Unlike a strategy, ink takes the full set of
// rescrawl options (exposed as knobs in the panel).
export const INK_COLOR = "#1a1a1a";

// The outlines the site can draw with: rescrawl's own, plus perfect-freehand
// as the reference to compare against. Freehand is not part of the library,
// so it is a website-level mode layered on `RenderOptions`.
export type OutlineMode = OutlineKind | "freehand";
export type FreehandPressure = "simulate" | "radius";

// Every choice the outline select offers. Listed rather than derived so it reads
// next to its select below, and so a stored blob can be checked against it:
// options are persisted to localStorage, and one saved before an outline was
// removed still names it. An unknown name would index `OUTLINES` to undefined
// and throw on the first render, so it falls back to the default instead.
const OUTLINE_MODES: OutlineMode[] = ["greedy", "node-fit", "node-quad", "freehand"];

// Which outline emits contacts meant to be joined by quadratics. The library
// has one serializer per degree and an `OutlineNode[]` does not say which it
// wants, so the caller has to know -- and the caller is whoever picked it.
const outlinePathFor = (o: InkOptions, outline: OutlineNode[]): string =>
  o.outline === "node-quad" ? outlineQuadPath(outline) : outlinePath(outline);

export function withKnownModes(o: InkOptions): InkOptions {
  const outline = OUTLINE_MODES.includes(o.outline) ? o.outline : INK_DEFAULTS.outline;
  return outline === o.outline ? o : { ...o, outline };
}

// Every length moved to screen px at once (some had been a multiple of the
// pen), and `engine` had split into `fit` and `outline`. A blob saved
// under an older meaning would be wrong, and for several knobs an old value is
// indistinguishable from a new one, so the key is versioned and stale panel
// settings are dropped. Strokes are stored separately and are unaffected.
export const INK_STORAGE_KEY = "rescrawl-ink-4";

// perfect-freehand's knobs, prefixed so they can share one options object with
// rescrawl's. `size` is not here: it is `maxWidth`, so both engines draw the
// same pen. `fhPressure` picks where pressure comes from — freehand's own
// velocity simulation, or rescrawl's radius stage mapped back into pressure —
// so the width model and the outline construction can be compared separately.
export type FreehandOptions = {
  fhPressure: FreehandPressure;
  fhThinning: number;
  fhSmoothing: number;
  fhStreamline: number;
  fhTaper: boolean;
};

export type InkOptions = Omit<Required<RenderOptions>, "outline"> &
  FreehandOptions & { outline: OutlineMode };

export const INK_DEFAULTS: InkOptions = {
  ...RENDER_DEFAULTS,
  fhPressure: "simulate",
  fhThinning: 0.5,
  fhSmoothing: 0.5,
  fhStreamline: 0.5,
  fhTaper: false,
};

// What rescrawl gets, with the website-only mode folded back to an outline the
// library knows. Freehand brings its own, so which one is named is moot.
//
// `zoom` is the stroke's own, as it was drawn.
function toRenderOptions(o: InkOptions, zoom: number): Required<RenderOptions> {
  return { ...o, zoom, outline: o.outline === "freehand" ? "greedy" : o.outline };
}

// perfect-freehand's radius is size · (0.5 − thinning · (0.5 − pressure)), so
// this is that solved for pressure: the value that makes it draw radius `r`.
// With thinning at 0 the width is fixed and pressure is moot.
function pressureFor(rad: number, o: InkOptions): number {
  if (o.fhThinning === 0) return 0.5;
  const p = 0.5 + (rad / o.maxWidth - 0.5) / o.fhThinning;
  return Math.min(1, Math.max(0, p));
}

// Closed polygon through the midpoints of consecutive points, each point as
// the quadratic control — the standard perfect-freehand path recipe.
function polygonPath(pts: number[][]): string {
  const n = pts.length;
  if (n === 0) return "";
  let d = `M ${r(pts[0][0])},${r(pts[0][1])} Q`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    d += ` ${r(x0)},${r(y0)} ${r((x0 + x1) / 2)},${r((y0 + y1) / 2)}`;
  }
  return d + " Z";
}

type Freehand = { stages: StrokeStages; polygon: number[][] };

// A stage-3 sample dressed as a node, for the one mode that skips the fit.
// Zero magnitudes read as a straight chord, so these nodes describe the
// polyline through the samples — which is exactly what this mode's centerline is.
const asNode = (p: Point4): CenterlineNode => ({
  ...p,
  ix: 1,
  iy: 0,
  ox: 1,
  oy: 0,
  mi: 0,
  mo: 0,
  slope: 0,
});

// perfect-freehand gets the discs as stage 2 left them and nothing else: no
// fit runs. It has its own `streamline` and `smoothing`, and thinning the
// centerline first would be two such passes stacked, which is not the thing
// being compared. So `nodes` here is just `radius` — the overlay's nodes
// layer shows no fit in this mode.
function renderFreehand(pts: Point[], o: InkOptions, zoom: number): Freehand {
  const pre = centerlineStages(pts, toRenderOptions(o, zoom));
  const stages: StrokeStages = { ...pre, nodes: pre.radius.map(asNode) };
  const simulate = o.fhPressure === "simulate";
  const input = simulate
    ? stages.nodes
    : stages.nodes.map((p) => ({ x: p.x, y: p.y, pressure: pressureFor(p.r, o) }));
  const polygon = getStroke(input, {
    size: o.maxWidth,
    thinning: o.fhThinning,
    smoothing: o.fhSmoothing,
    streamline: o.fhStreamline,
    simulatePressure: simulate,
    start: { taper: o.fhTaper },
    end: { taper: o.fhTaper },
    last: true,
  });
  return { stages, polygon };
}

export function renderInk(stroke: Stroke, options: InkOptions, t: number): RenderedLine {
  const pts = elapsedPoints(stroke, t);
  if (!pts.length) return EMPTY;
  if (options.outline === "freehand") {
    return { shapes: [polygonPath(renderFreehand(pts, options, stroke.zoom).polygon)] };
  }
  const { outline } = renderStroke(pts, toRenderOptions(options, stroke.zoom));
  return { shapes: [outlinePathFor(options, outline)] };
}

// Every stage of the pipeline for one stroke as of `t`, plus the outline the
// overlay can mark. Same call the renderer makes, so what you see is what got
// drawn. In freehand mode the outline points are the polygon's vertices; they
// carry no tangent.
export function inkStages(
  stroke: Stroke,
  options: InkOptions,
  t: number,
): { outline: OutlineNode[]; stages: StrokeStages } {
  const pts = elapsedPoints(stroke, t);
  if (options.outline === "freehand") {
    const { stages, polygon } = renderFreehand(pts, options, stroke.zoom);
    const outline = polygon.map(([x, y]) => ({ x, y, tx: 0, ty: 0 }));
    return { outline, stages };
  }
  const { stages, outline } = renderStroke(pts, toRenderOptions(options, stroke.zoom));
  return { outline, stages };
}

// Just the stages of one stroke as of `t` — the same pipeline run `inkStages`
// makes, without the outline the overlay needs and a hit test does not.
export function strokeStages(stroke: Stroke, options: InkOptions, t: number): StrokeStages {
  const pts = elapsedPoints(stroke, t);
  if (options.outline === "freehand") return renderFreehand(pts, options, stroke.zoom).stages;
  return renderStroke(pts, toRenderOptions(options, stroke.zoom)).stages;
}

// Split the option keys by value type so a slider can only ever be pointed at a
// number and a checkbox only ever at a boolean.
type NumberKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];
type BooleanKeys<T> = { [K in keyof T]-?: T[K] extends boolean ? K : never }[keyof T];
type StringKeys<T> = { [K in keyof T]-?: T[K] extends string ? K : never }[keyof T];

// The ink panel, one section per pipeline concern. A `when` hides a knob until
// the option it depends on is switched on, so a section reads as "the toggle,
// then what it exposes".
export type InkControl = {
  kind: "range";
  key: NumberKeys<InkOptions>;
  label: string;
  min: number;
  max: number;
  step: number;
  when?: (o: InkOptions) => boolean;
};
export type InkToggle = {
  kind: "toggle";
  key: BooleanKeys<InkOptions>;
  label: string;
  when?: (o: InkOptions) => boolean;
};
export type InkSelect = {
  kind: "select";
  key: StringKeys<InkOptions>;
  label: string;
  choices: { value: string; label: string }[];
  when?: (o: InkOptions) => boolean;
};
export type InkItem = InkControl | InkToggle | InkSelect;
export type InkSection = { label: string; items: InkItem[] };

// Which stage a knob belongs to. Written out rather than derived: each fit and
// each outline says in its own file what it reads, and this is the panel saying
// the same thing in the panel's terms.
const ifFreehand = (o: InkOptions) => o.outline === "freehand";
// Freehand brings its own everything; the fit knobs are for whichever rescrawl
// outline is up, since every one of them is drawn around a fit.
const ifRescrawl = (o: InkOptions) => !ifFreehand(o);
const ifGreedy = (o: InkOptions) => o.outline === "greedy";
const ifNodeFit = (o: InkOptions) => o.outline === "node-fit";
const ifNodeQuad = (o: InkOptions) => o.outline === "node-quad";
// node-fit and node-quad switch the corners stage off (see `renderStroke`).
const ifCorners = (o: InkOptions) => ifGreedy(o) && o.corners;

export const INK_SECTIONS: InkSection[] = [
  {
    label: "Width",
    items: [
      // min 1, not 0: log-space width smoothing has no representation for zero width.
      { kind: "range", key: "minWidth", label: "min width", min: 1, max: 20, step: 0.5 },
      { kind: "range", key: "maxWidth", label: "max width", min: 1, max: 40, step: 0.5 },
      {
        kind: "range",
        key: "thinSpeed",
        label: "thin speed (screen px/ms)",
        min: 0.05,
        max: 4,
        step: 0.05,
      },
      { kind: "range", key: "widthLag", label: "width lag (ms)", min: 2, max: 300, step: 1 },
    ],
  },
  {
    // Stages 0 to 2, before the fit. No `when`: freehand takes its discs from
    // stage 2, so these reach it too.
    label: "Centerline",
    items: [
      // Stage 0, the one filter: a sample this close to the last one kept is
      // the pen not having moved, in screen px at the zoom the stroke was drawn at.
      {
        kind: "range",
        key: "minMove",
        label: "min move (screen px)",
        min: 0,
        max: 6,
        step: 0.1,
      },
      // Stage 0, off by default: dense stretches pulled, sparse ones barely
      // touched. For input that is visibly noisy.
      {
        kind: "range",
        key: "smoothWindow",
        label: "smooth window (screen px)",
        min: 0,
        max: 16,
        step: 0.5,
      },
      // Stage 2's corners. Only the greedy outline can draw one.
      { kind: "toggle", key: "corners", label: "corners", when: ifGreedy },
      {
        kind: "range",
        key: "cornerArm",
        label: "corner arm (screen px)",
        min: 0,
        max: 32,
        step: 0.5,
        when: ifCorners,
      },
      {
        kind: "range",
        key: "cornerTurn",
        label: "corner turn (deg)",
        min: 0,
        max: 180,
        step: 1,
        when: ifCorners,
      },
    ],
  },
  {
    // Stages 3 and 4 — the fit, and the outline laid around it — so their
    // knobs live under them. Freehand is the odd one out: it takes the discs
    // straight from stage 2 and brings its own everything, so none of
    // rescrawl's knobs apply to it.
    label: "Fit & outline",
    items: [
      // Stage 4. Freehand stands where an outline would, and takes stage 2
      // rather than a fit, so it is a choice here rather than its own select.
      {
        kind: "select",
        key: "outline",
        label: "outline",
        choices: [
          { value: "greedy", label: "greedy — contacts where the error demands" },
          { value: "node-fit", label: "node fit — contacts at nodes, subdivided" },
          { value: "node-quad", label: "node quad — the same, drawn as quadratics" },
          { value: "freehand", label: "perfect-freehand" },
        ],
      },
      // Stage 3: which discs become nodes, and what joins two of them.
      {
        kind: "range",
        key: "reparam",
        label: "reparam (rounds)",
        min: 0,
        max: 10,
        step: 1,
        when: ifRescrawl,
      },
      // How far a sample may lie off the segment that skips it.
      {
        kind: "range",
        key: "handTol",
        label: "hand tol (screen px)",
        min: 0,
        max: 8,
        step: 0.05,
        when: ifRescrawl,
      },
      // How far the drawn outline may stray from the true envelope: contacts
      // go wherever a hop would otherwise exceed it.
      {
        kind: "range",
        key: "outlineTol",
        label: "outline tol (screen px)",
        min: 0.04,
        max: 2,
        step: 0.01,
        when: ifGreedy,
      },
      // How far one hop may span, whatever the tolerance would have allowed.
      // A long hop reaching into the
      // unsettled ink at the pen re-decides every frame and re-anchors every
      // hop behind it, so this bounds how far back the churn reaches.
      {
        kind: "range",
        key: "outlineHorizon",
        label: "outline horizon (screen px)",
        min: 4,
        max: 160,
        step: 2,
        when: ifGreedy,
      },
      // --- node fit ---
      // Same question as `outlineTol`, asked per centerline segment: a segment's
      // side splits at its midpoint until one cubic tracks the envelope this
      // closely. Contacts stay pinned to nodes and to dyadic parameters, so
      // tightening this adds contacts without moving the ones already placed.
      {
        kind: "range",
        key: "nodeTol",
        label: "node tol (screen px)",
        min: 0.04,
        max: 2,
        step: 0.01,
        when: ifNodeFit,
      },
      // The floor under that: at a cusp on the inner offset the error never
      // clears, so the split has to stop somewhere. 0 is one cubic per segment
      // per side, whatever the tolerance says.
      {
        kind: "range",
        key: "nodeDepth",
        label: "node depth (splits)",
        min: 0,
        max: 10,
        step: 1,
        when: ifNodeFit,
      },
      // --- node quad ---
      // `nodeTol` and `nodeDepth` again, for the quadratic outline. Kept as their
      // own keys so the two degrees can be tuned apart and compared at a tolerance
      // each was actually set to.
      {
        kind: "range",
        key: "quadTol",
        label: "quad tol (screen px)",
        min: 0.04,
        max: 2,
        step: 0.01,
        when: ifNodeQuad,
      },
      {
        kind: "range",
        key: "quadDepth",
        label: "quad depth (splits)",
        min: 0,
        max: 10,
        step: 1,
        when: ifNodeQuad,
      },
      // --- perfect-freehand ---
      // Its `size` is `maxWidth` above. With pressure from the radius stage,
      // the Width knobs drive it and thinning is the map back; with simulated
      // pressure, only maxWidth and thinning matter.
      {
        kind: "select",
        key: "fhPressure",
        label: "pressure",
        choices: [
          { value: "simulate", label: "simulate (velocity)" },
          { value: "radius", label: "rescrawl radius" },
        ],
        when: ifFreehand,
      },
      {
        kind: "range",
        key: "fhThinning",
        label: "thinning",
        min: -1,
        max: 1,
        step: 0.05,
        when: ifFreehand,
      },
      {
        kind: "range",
        key: "fhSmoothing",
        label: "smoothing",
        min: 0,
        max: 1,
        step: 0.05,
        when: ifFreehand,
      },
      {
        kind: "range",
        key: "fhStreamline",
        label: "streamline",
        min: 0,
        max: 1,
        step: 0.05,
        when: ifFreehand,
      },
      { kind: "toggle", key: "fhTaper", label: "taper ends", when: ifFreehand },
    ],
  },
];

export function getDefaultStrategies(): StrategiesState {
  // Overlays default off — ink alone is the default view.
  return Object.fromEntries(
    STRATEGY_DEFS.map((def) => [def.id, { enabled: false, param: def.defaultParam }]),
  );
}

export function getActiveStrategies(strategies: StrategiesState): ActiveStrategy[] {
  return STRATEGY_DEFS.filter((def) => strategies[def.id]?.enabled).map((def) => ({
    def,
    param: strategies[def.id]?.param ?? def.defaultParam,
  }));
}
