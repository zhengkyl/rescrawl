import { getStroke } from "perfect-freehand";
import type { Contact, OutlineEngine, Point4, RenderOptions, StrokeStages } from "rescrawl";
import { centerlineStages, RENDER_DEFAULTS, renderStroke } from "rescrawl";
import { centerlinePath, outlinePath } from "rescrawl/svg";
import type { Stroke } from "./utils";
import { elapsedPoints } from "./utils";

// A renderer turns one stroke's raw data into a renderable line. When `shapes`
// is present the consumer fills those (variable-width); otherwise it strokes
// `curve` at `width`.
export type RenderedLine = {
  curve: string;
  width?: number;
  shapes?: string[];
};

// A purely-geometric drawer: given the points to draw, produce the line.
type Draw = (pts: Stroke, param: number) => RenderedLine;

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

// Independently-toggleable layers of the Debug overlay. The first five are the
// pipeline's stages, drawn as dots at the points that stage produced — turning
// two of them on side by side is what shows you what that stage did. The rest
// are derived geometry.
export type StageKey = keyof StrokeStages;
export type DebugLayers = Record<StageKey | "circles" | "centerline" | "outline", boolean>;

// `dot` is a fixed marker size in px, and only the two stages that carry no
// radius get one — they shrink so raw and snapped nest instead of hiding each
// other. From `radius` on, a stage draws each point at its own r: that circle is
// what the outline is wrapped around, so two stages side by side compare the
// ink they would actually lay down rather than two arbitrary dots.
export type StageLayer = { key: StageKey; label: string; color: string; dot?: number };
export const DEBUG_STAGES: StageLayer[] = [
  { key: "raw", label: "in · raw input", color: "#10b981", dot: 3.6 },
  { key: "snapped", label: "0 · snapped (grid)", color: "#84cc16", dot: 3.0 },
  { key: "radius", label: "1 · radius", color: "#eab308" },
  { key: "smoothed", label: "2 · smoothed", color: "#f97316" },
  { key: "distinct", label: "3a · distinct", color: "#a855f7" },
  { key: "nodes", label: "3b · nodes", color: "#3b82f6" },
];

export type ExtraLayer = {
  key: "circles" | "centerline" | "outline";
  label: string;
  color: string;
};
export const DEBUG_EXTRAS: ExtraLayer[] = [
  { key: "circles", label: "radius circles", color: "#3b82f6" },
  { key: "centerline", label: "centerline", color: "#3b82f6" },
  { key: "outline", label: "4 · outline pts", color: "#ef4444" },
];

// One stage point picked out of the overlay, for the radius readout. `dt` is the
// gap to the next point of that stage — and on its last point, the gap to where
// the stroke itself ends, which is not the same place: every stage from `radius`
// on stops one raw sample early (see `toRadiiPointsFromRawSamples`), so the final
// gap is the pen-up dwell rather than nothing. Note that a stage drops points, so
// dt is the span the surviving point now covers, not the raw sample period.
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
  snapped: false,
  radius: false,
  smoothed: false,
  distinct: false,
  nodes: true,
  circles: false,
  centerline: true,
  outline: false,
};

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
    // Special-cased in App: enabling this draws the debug overlay (centerline +
    // offset points + raw dots) rather than this polyline. The polyline render
    // is kept only as the fallback used for the selected-stroke highlight.
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

// The engines the site can draw with: rescrawl's own, plus perfect-freehand
// as the reference to compare against. Freehand is not part of the library,
// so it is a website-level mode layered on `RenderOptions`.
export type OutlineMode = OutlineEngine | "freehand";
export type FreehandPressure = "simulate" | "radius";

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

export type InkOptions = Omit<Required<RenderOptions>, "engine"> &
  FreehandOptions & { engine: OutlineMode };

export const INK_DEFAULTS: InkOptions = {
  ...RENDER_DEFAULTS,
  // RENDER_DEFAULTS is 0 (a finished stroke); the site draws live ink, so it
  // holds a few samples back. Zeroed again for anything already finished.
  liveBuffer: 4,
  fhPressure: "simulate",
  fhThinning: 0.5,
  fhSmoothing: 0.5,
  fhStreamline: 0.5,
  fhTaper: false,
};

// What rescrawl gets. `live` is whether the pen is still down on this stroke —
// the live pointer stroke, or a replay stopped partway through one. Only then
// is the live buffer real: a finished stroke has all its data, so it settles
// to the end. Never called in freehand mode, which runs no engine at all.
function toRenderOptions(o: InkOptions, live: boolean): Required<RenderOptions> {
  return {
    ...o,
    engine: o.engine === "freehand" ? "fit" : o.engine,
    liveBuffer: live ? o.liveBuffer : 0,
  };
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

// perfect-freehand gets the discs as stage 3a left them and nothing else: no
// engine runs, and in particular no simplify. It has its own `streamline` and
// `smoothing` for that, and running rescrawl's simplify first would be two
// thinning passes stacked, which is not the thing being compared. So `nodes`
// here is just `distinct` — the overlay's 3b layer shows no drop in this mode.
function renderFreehand(pts: Stroke, o: InkOptions): Freehand {
  const pre = centerlineStages(pts, { ...o, engine: "fit" });
  const stages: StrokeStages = { ...pre, nodes: pre.distinct };
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

// `live` says the pen has not lifted yet at `t`, so what this draws is not
// final — see `toRenderOptions`. The caller knows: the stroke being drawn right
// now is live, and so is a replay whose playhead sits inside a stroke.
export function renderInk(
  stroke: Stroke,
  options: InkOptions,
  t: number,
  live = false,
): RenderedLine {
  const pts = elapsedPoints(stroke, t);
  if (!pts.length) return EMPTY;
  if (options.engine === "freehand") {
    const { stages, polygon } = renderFreehand(pts, options);
    return { curve: centerlinePath(stages.nodes), shapes: [polygonPath(polygon)] };
  }
  const { outline, spine } = renderStroke(pts, toRenderOptions(options, live));
  return { curve: spine, shapes: [outlinePath(outline)] };
}

// Every stage of the pipeline for one stroke as of `t`, plus the two pieces of
// derived geometry the overlay can draw. Same call the renderer makes, so what
// you see is what got drawn. In freehand mode the outline points are the
// polygon's vertices; they carry no tangent.
export function inkStages(
  stroke: Stroke,
  options: InkOptions,
  t: number,
  live = false,
): { curve: string; outline: Contact[]; stages: StrokeStages } {
  const pts = elapsedPoints(stroke, t);
  if (options.engine === "freehand") {
    const { stages, polygon } = renderFreehand(pts, options);
    const outline = polygon.map(([x, y]) => ({ x, y, tx: 0, ty: 0 }));
    return { curve: centerlinePath(stages.nodes), outline, stages };
  }
  const { stages, outline, spine } = renderStroke(pts, toRenderOptions(options, live));
  return { curve: spine, outline, stages };
}

// Just the stages of one stroke as of `t` — the same pipeline run `inkStages`
// makes, without the path strings the overlay needs and a hit test does not.
export function strokeStages(
  stroke: Stroke,
  options: InkOptions,
  t: number,
  live = false,
): StrokeStages {
  const pts = elapsedPoints(stroke, t);
  if (options.engine === "freehand") return renderFreehand(pts, options).stages;
  return renderStroke(pts, toRenderOptions(options, live)).stages;
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

// Which engine a knob belongs to. Written out rather than derived: each
// engine's own file lists what it reads, and this is the panel saying the
// same thing in the panel's terms.
const ifFit = (o: InkOptions) => o.engine === "fit";
const ifSampled = (o: InkOptions) => o.engine === "sampled";
const ifGreedy = (o: InkOptions) => o.engine === "greedy";
// All three run `fitCurve` for stage 3b, so they share its knobs.
const ifFitCurve = (o: InkOptions) => ifFit(o) || ifSampled(o) || ifGreedy(o);
const ifTension = (o: InkOptions) => o.engine === "tension";
const ifClassic = (o: InkOptions) => o.engine === "classic";
const ifFreehand = (o: InkOptions) => o.engine === "freehand";
const ifPolyline = (o: InkOptions) => ifTension(o) || ifClassic(o);
// The polyline engines can switch their simplify off; the fit always fits.
const ifPolylineSimplify = (o: InkOptions) => ifPolyline(o) && o.simplify;
const ifSettles = (o: InkOptions) => ifFitCurve(o) || ifPolylineSimplify(o);

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
        label: "thin speed (px/ms)",
        min: 0.05,
        max: 4,
        step: 0.05,
      },
      { kind: "range", key: "widthLag", label: "width lag (ms)", min: 2, max: 300, step: 1 },
    ],
  },
  {
    // Stages 3b + 4 are the engine, so its knobs live under it. Freehand is
    // the odd one out: it takes the discs straight from stage 3a and brings
    // its own everything, so none of rescrawl's knobs apply to it.
    label: "Engine",
    items: [
      {
        kind: "select",
        key: "engine",
        label: "engine",
        choices: [
          { value: "fit", label: "fit — settled lines and cubics" },
          { value: "sampled", label: "sampled — walk the envelope" },
          { value: "greedy", label: "greedy — contacts where the error demands" },
          { value: "tension", label: "tension — turn in the magnitude" },
          { value: "classic", label: "classic — tangent sweep" },
          { value: "freehand", label: "perfect-freehand" },
        ],
      },
      // Every rescrawl engine: how far the ink may move where a sample is
      // dropped, as a fraction of the local radius. 0 is lossless.
      {
        kind: "range",
        key: "tol",
        label: "tolerance (xr)",
        min: 0,
        max: 1,
        step: 0.01,
        when: ifSettles,
      },
      // Samples behind the pen that stage 3b may not touch yet, so a node
      // commits only once this many sit behind it. Live ink only.
      {
        kind: "range",
        key: "liveBuffer",
        label: "live buffer (pts)",
        min: 0,
        max: 20,
        step: 1,
        when: ifSettles,
      },
      // --- fit ---
      // A turn sharper than the angle, measured over the distance either
      // side, is a corner; the distance is also the window the tangent and
      // radius slope are read over, and twice it is how far behind the pen
      // samples settle. See `fitCurve`.
      {
        kind: "range",
        key: "fitCornerAngle",
        label: "corner angle (deg)",
        min: 10,
        max: 180,
        step: 1,
        when: ifFitCurve,
      },
      {
        kind: "range",
        key: "fitCornerDist",
        label: "tangent span (px)",
        min: 1,
        max: 40,
        step: 0.5,
        when: ifFitCurve,
      },
      // How far one segment may run before it commits anyway. The open
      // segment is the only committed-looking ink that still moves, so this
      // bounds how far behind the pen anything can change; larger is sparser.
      {
        kind: "range",
        key: "fitHorizon",
        label: "horizon (px)",
        min: 4,
        max: 400,
        step: 1,
        when: ifFitCurve,
      },
      // --- sampled ---
      // px along the centerline between outline contacts. Smaller is closer
      // to the true envelope and a bigger path; this is its only knob.
      {
        kind: "range",
        key: "sampleStep",
        label: "sample step (px)",
        min: 0.5,
        max: 30,
        step: 0.5,
        when: ifSampled,
      },
      // --- greedy ---
      // px the drawn outline may stray from the true envelope. The only
      // knob: contacts go wherever a hop would otherwise exceed it.
      {
        kind: "range",
        key: "outlineTol",
        label: "outline tolerance (px)",
        min: 0.05,
        max: 2,
        step: 0.05,
        when: ifGreedy,
      },
      // --- tension and classic ---
      { kind: "toggle", key: "simplify", label: "simplify (3b)", when: ifPolyline },
      // Longest stretch one segment may span. Keeps a point every so often
      // down a straight, so the outline has something to hold it straight.
      {
        kind: "range",
        key: "simplifyMaxMs",
        label: "max span (ms)",
        min: 10,
        max: 1000,
        step: 10,
        when: ifPolylineSimplify,
      },
      // --- tension only ---
      // The sag budget comes from the tolerance above; `maxTurn` is where it
      // gives up and falls back to the tangent construction.
      {
        kind: "range",
        key: "cornerScale",
        label: "corner scale (xr)",
        min: 0,
        max: 3,
        step: 0.05,
        when: ifTension,
      },
      {
        kind: "range",
        key: "maxTurn",
        label: "max turn (deg)",
        min: 0,
        max: 180,
        step: 1,
        when: ifTension,
      },
      { kind: "toggle", key: "weightedAngle", label: "weighted angle", when: ifTension },
      // Read by both fit and tension.
      {
        kind: "toggle",
        key: "cornerPoint",
        label: "inner corner point",
        // Not greedy: it has no corner constructions to point at.
        when: (o) => ifFit(o) || ifSampled(o) || ifTension(o),
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
