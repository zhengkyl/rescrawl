import {
  CENTERLINE_DEFAULTS,
  type Centerline,
  type CenterlineOptions,
  type CubicNode,
  getCenterline,
  NODE_QUAD_DEFAULTS,
  type NodeQuadOptions,
  type OutlineNode,
  toOutlineNodeQuad,
} from "rescrawl";
import { fitPath, outlineQuadPath } from "rescrawl/svg";
import { type CenterlineStages, centerlineStages } from "./stages";
import type { Point, Stroke } from "./utils";
import { elapsedPoints, strokeEnd } from "./utils";

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
export type StageKey = keyof CenterlineStages;
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
  stages: CenterlineStages,
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
    const pts = stages[key] as { x: number; y: number; r: number; tStart: number }[];
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
          dt: (next ? next.tStart : end) - p.tStart,
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
export const fitCurvePath = (ns: CubicNode[]): string => fitPath(ns, 3);

// A corner node carries two tangents; at every other node the in- and
// out-tangents are the same vector. Drawn differently, because a corner is where
// the fit cut the run — the one node whose placement the outline wraps rather
// than rounds.
export const isCorner = (n: CubicNode): boolean => n.corner;

// The Bezier control points behind that spine, one pair per segment.
export type CurveHandle = { x: number; y: number; cx: number; cy: number };

export function curveHandles(ns: CubicNode[]): CurveHandle[] {
  const out: CurveHandle[] = [];
  for (let i = 1; i < ns.length; i++) {
    const a = ns[i - 1];
    const b = ns[i];
    out.push({ x: a.x, y: a.y, cx: a.c1x, cy: a.c1y });
    out.push({ x: b.x, y: b.y, cx: a.c2x, cy: a.c2y });
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

// Every length moved to screen px at once (some had been a multiple of the
// pen), and `engine` had split into `fit` and `outline`. A blob saved
// under an older meaning would be wrong, and for several knobs an old value is
// indistinguishable from a new one, so the key is versioned and stale panel
// settings are dropped. Strokes are stored separately and are unaffected.
export const INK_STORAGE_KEY = "rescrawl-ink-4";

export type InkOptions = Required<Omit<CenterlineOptions, "tOpen">> & Required<NodeQuadOptions>;

export const INK_DEFAULTS: InkOptions = { ...CENTERLINE_DEFAULTS, ...NODE_QUAD_DEFAULTS };

const NO_PREV: Centerline = { curves: [], settled: 0 };

const centerlineOptions = (stroke: Stroke, o: InkOptions, pts: Point[], open: boolean) => ({
  ...o,
  zoom: stroke.zoom,
  tOpen: open && pts.length > 0 ? pts[pts.length - 1].t : null,
});

export function renderInk(
  stroke: Stroke,
  options: InkOptions,
  t: number,
  open = t < strokeEnd(stroke),
): RenderedLine {
  const pts = elapsedPoints(stroke, t);
  if (!pts.length) return EMPTY;
  const { curves } = getCenterline(NO_PREV, pts, centerlineOptions(stroke, options, pts, open));
  return { shapes: [outlineQuadPath(toOutlineNodeQuad(curves, { ...options, zoom: stroke.zoom }))] };
}

// Every stage for one stroke as of `t`, plus the outline the overlay can mark.
export function inkStages(
  stroke: Stroke,
  options: InkOptions,
  t: number,
  open = t < strokeEnd(stroke),
): { outline: OutlineNode[]; stages: CenterlineStages } {
  const pts = elapsedPoints(stroke, t);
  const stages = centerlineStages(pts, centerlineOptions(stroke, options, pts, open));
  const pieces = toOutlineNodeQuad(stages.nodes, { ...options, zoom: stroke.zoom });
  return { outline: pieces.flat(), stages };
}

export function strokeStages(stroke: Stroke, options: InkOptions, t: number): CenterlineStages {
  const pts = elapsedPoints(stroke, t);
  return centerlineStages(pts, centerlineOptions(stroke, options, pts, t < strokeEnd(stroke)));
}

type NumberKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

// The ink panel, one section per pipeline concern.
export type InkControl = {
  key: NumberKeys<InkOptions>;
  label: string;
  min: number;
  max: number;
  step: number;
};
export type InkSection = { label: string; items: InkControl[] };

export const INK_SECTIONS: InkSection[] = [
  {
    label: "Width",
    items: [
      // min 1, not 0: log-space width smoothing has no representation for zero width.
      { key: "minWidth", label: "min width", min: 1, max: 20, step: 0.5 },
      { key: "maxWidth", label: "max width", min: 1, max: 40, step: 0.5 },
      {
        key: "thinSpeed",
        label: "thin speed (screen px/ms)",
        min: 0.05,
        max: 4,
        step: 0.05,
      },
      { key: "widthLag", label: "width lag (ms)", min: 2, max: 300, step: 1 },
    ],
  },
  {
    label: "Centerline",
    items: [
      // Stage 0, the one filter: a sample this close to the last one kept is
      // the pen not having moved, in screen px at the zoom the stroke was drawn at.
      {
        key: "minMove",
        label: "min move (screen px)",
        min: 0,
        max: 6,
        step: 0.1,
      },
      // Stage 0, off by default: dense stretches pulled, sparse ones barely
      // touched. For input that is visibly noisy.
      {
        key: "smoothWindow",
        label: "smooth window (screen px)",
        min: 0,
        max: 16,
        step: 0.5,
      },
      {
        key: "cornerArm",
        label: "corner arm (screen px)",
        min: 0,
        max: 32,
        step: 0.5,
      },
      {
        key: "cornerTurn",
        label: "corner turn (deg)",
        min: 0,
        max: 180,
        step: 1,
      },
    ],
  },
  {
    label: "Fit & outline",
    items: [
      {
        key: "reparam",
        label: "reparam (rounds)",
        min: 0,
        max: 10,
        step: 1,
      },
      // How far a sample may lie off the segment that skips it.
      {
        key: "handTol",
        label: "hand tol (screen px)",
        min: 0,
        max: 8,
        step: 0.05,
      },
      // How far the drawn outline may stray from the envelope: a segment's side
      // splits at its midpoint until one quadratic is this close.
      {
        key: "quadTol",
        label: "quad tol (screen px)",
        min: 0.04,
        max: 2,
        step: 0.01,
      },
      // The floor under that: at a cusp on the inner offset the error never
      // clears, so the split has to stop somewhere.
      {
        key: "quadDepth",
        label: "quad depth (splits)",
        min: 0,
        max: 10,
        step: 1,
      },
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
