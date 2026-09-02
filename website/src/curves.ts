import type { Contact, Point4, RenderOptions, StrokeStages } from "rescrawl";
import { RENDER_DEFAULTS, renderStages, renderStroke } from "rescrawl";
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
export type DebugLayers = Record<
  StageKey | "circles" | "centerline" | "outline",
  boolean
>;

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
  { key: "simplified", label: "3b · simplified", color: "#3b82f6" },
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
  simplified: true,
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

export type InkOptions = Required<RenderOptions>;
export const INK_DEFAULTS: InkOptions = { ...RENDER_DEFAULTS };

export function renderInk(stroke: Stroke, options: InkOptions, t: number): RenderedLine {
  const pts = elapsedPoints(stroke, t);
  if (!pts.length) return EMPTY;
  const { centerline, outline } = renderStroke(pts, options);
  return { curve: centerlinePath(centerline), shapes: [outlinePath(outline)] };
}

// Every stage of the pipeline for one stroke as of `t`, plus the two pieces of
// derived geometry the overlay can draw. Same call the renderer makes, so what
// you see is what got drawn.
export function inkStages(
  stroke: Stroke,
  options: InkOptions,
  t: number,
): { curve: string; outline: Contact[]; stages: StrokeStages } {
  const pts = elapsedPoints(stroke, t);
  const { centerline, outline, stages } = renderStages(pts, options);
  return { curve: centerlinePath(centerline), outline, stages };
}

// Just the stages of one stroke as of `t` — the same pipeline run `inkStages`
// makes, without the path strings the overlay needs and a hit test does not.
export function strokeStages(stroke: Stroke, options: InkOptions, t: number): StrokeStages {
  const pts = elapsedPoints(stroke, t);
  return renderStages(pts, options).stages;
}

// Split the option keys by value type so a slider can only ever be pointed at a
// number and a checkbox only ever at a boolean.
type NumberKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];
type BooleanKeys<T> = { [K in keyof T]-?: T[K] extends boolean ? K : never }[keyof T];

// Slider metadata for every adjustable ink value.
export type InkControl = {
  key: NumberKeys<InkOptions>;
  label: string;
  min: number;
  max: number;
  step: number;
};
export const INK_CONTROLS: InkControl[] = [
  // min 1, not 0: log-space width smoothing has no representation for zero width.
  { key: "minWidth", label: "min width", min: 1, max: 20, step: 0.5 },
  { key: "maxWidth", label: "max width", min: 1, max: 40, step: 0.5 },
  { key: "thinSpeed", label: "thin speed (px/ms)", min: 0.05, max: 4, step: 0.05 },
  { key: "widthLag", label: "width lag (ms)", min: 2, max: 300, step: 1 },
  // step 2 keeps the window odd; 1 is the no-smoothing identity.
  { key: "smoothWindow", label: "smooth window (pts)", min: 1, max: 21, step: 2 },
  // How far the ink may move when a point is dropped, as a fraction of the local
  // radius. 0 is lossless and drops almost nothing.
  { key: "simplifyTol", label: "simplify tol (xr)", min: 0, max: 1, step: 0.01 },
  // Tension outline only (see `toOutlineTension`). `cornerAngle` is where the
  // contact magnitude is halfway from the chord rule to the corner rule;
  // `maxTurn` is where it gives up and falls back to the tangent construction.
  { key: "cornerAngle", label: "corner angle (deg)", min: 0, max: 180, step: 1 },
  { key: "cornerScale", label: "corner scale (xr)", min: 0, max: 3, step: 0.05 },
  { key: "maxTurn", label: "max turn (deg)", min: 0, max: 180, step: 1 },
];

// Ink options that are on/off rather than a range.
export type InkToggle = { key: BooleanKeys<InkOptions>; label: string };
export const INK_TOGGLES: InkToggle[] = [
  { key: "tensionOutline", label: "tension outline" },
  { key: "weightedAngle", label: "tension: weighted angle" },
  { key: "cornerPoint", label: "tension: inner corner point" },
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
