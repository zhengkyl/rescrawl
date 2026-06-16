import { renderStroke, strokeDebug, RENDER_DEFAULTS } from 'rescrawl';
import type { RenderOptions } from 'rescrawl';
import type { Stroke } from './utils';
import { drawnPoints } from './utils';

// A renderer turns one stroke's raw data into a renderable line. When `shapes`
// is present the consumer fills those (variable-width); otherwise it strokes
// `curve` at `width`.
export type RenderedLine = {
  curve: string;
  width: number;
  shapes?: string[];
};

// A purely-geometric drawer: given the points to draw, produce the line.
type Draw = (pts: Stroke, param: number) => RenderedLine;

export type StrategyDef = {
  id: string;
  label: string;
  color: string;
  defaultParam: number;
  paramLabel: string;   // '' means no param
  paramMin: number;
  paramMax: number;
  paramStep: number;
  // Draw the stroke as it exists at time `t` (Infinity = fully drawn).
  render: (stroke: Stroke, param: number, t: number) => RenderedLine;
};

export type ActiveStrategy = { def: StrategyDef; param: number };
export type StrategyState = { enabled: boolean; param: number };
export type StrategiesState = Record<string, StrategyState>;

// Independently-toggleable layers of the Debug overlay.
export type DebugLayers = { centerline: boolean; offsets: boolean; dots: boolean };
export const DEBUG_DEFAULTS: DebugLayers = { centerline: true, offsets: true, dots: true };

const LINE_WIDTH = 2;
const EMPTY: RenderedLine = { curve: '', width: LINE_WIDTH };

// Lift a geometric drawer into a time-aware renderer: map `t` to the drawn
// point prefix, then draw it. Keeps every algorithm free of timeline logic.
function timed(draw: Draw): StrategyDef['render'] {
  return (stroke, param, t) => {
    const pts = drawnPoints(stroke, t);
    return pts.length ? draw(pts, param) : EMPTY;
  };
}

function r(n: number) {
  return Math.round(n * 100) / 100;
}

// Polyline `d` over {x,y}; single point renders as a dot.
function polylinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${r(pts[0].x)},${r(pts[0].y)} L ${r(pts[0].x)},${r(pts[0].y)}`;
  return 'M ' + pts.map(p => `${r(p.x)},${r(p.y)}`).join(' L ');
}

// Add new rendering strategies here — each entry auto-appears in the Curve panel.
export const STRATEGY_DEFS: StrategyDef[] = [
  {
    id: 'debug',
    label: 'Debug',
    color: '#3b82f6',
    defaultParam: 0,
    paramLabel: '',
    paramMin: 0, paramMax: 0, paramStep: 0,
    // Special-cased in App: enabling this draws the debug overlay (centerline +
    // offset points + raw dots) rather than this polyline. The polyline render
    // is kept only as the fallback used for the selected-stroke highlight.
    render: timed((pts) => ({ curve: polylinePath(pts), width: LINE_WIDTH })),
  },
  {
    id: 'cubic',
    label: 'Cubic',
    color: '#f97316',
    defaultParam: 1,
    paramLabel: 'smooth',
    paramMin: 0, paramMax: 1, paramStep: 0.1,
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
export const INK_COLOR = '#1a1a1a';

export type InkOptions = Required<RenderOptions>;
export const INK_DEFAULTS: InkOptions = { ...RENDER_DEFAULTS };

// Draw the ink as of time `t` (Infinity = fully drawn).
export function renderInk(stroke: Stroke, options: InkOptions, t: number): RenderedLine {
  const pts = drawnPoints(stroke, t);
  return pts.length ? renderStroke(pts, options) : { curve: '', width: options.maxWidth };
}

// Debug geometry (centerline + outline points + raw recorded dots) as of `t`.
export function inkDebug(stroke: Stroke, options: InkOptions, t: number): { curve: string; points: { x: number; y: number }[]; dots: { x: number; y: number }[] } {
  const pts = drawnPoints(stroke, t);
  return pts.length ? strokeDebug(pts, options) : { curve: '', points: [], dots: [] };
}

// Slider metadata for every adjustable (numeric) ink value.
type NumericInkKey = { [K in keyof InkOptions]: InkOptions[K] extends number ? K : never }[keyof InkOptions];
export type InkControl = { key: NumericInkKey; label: string; min: number; max: number; step: number };
export const INK_CONTROLS: InkControl[] = [
  { key: 'minWidth', label: 'min width', min: 0, max: 20, step: 0.5 },
  { key: 'maxWidth', label: 'max width', min: 1, max: 40, step: 0.5 },
  { key: 'pressureMax', label: 'pressure max', min: 1024, max: 16384, step: 256 },
  { key: 'flowFull', label: 'flow full (ms)', min: 2, max: 200, step: 1 },
  { key: 'poolFull', label: 'pool full (ms)', min: 50, max: 1500, step: 10 },
  { key: 'smoothWidth', label: 'smooth width', min: 0, max: 12, step: 1 },
  { key: 'smooth', label: 'smooth', min: 0, max: 1, step: 0.05 },
  { key: 'simplify', label: 'simplify (px)', min: 0, max: 4, step: 0.05 },
];

export function getDefaultStrategies(): StrategiesState {
  // Overlays default off — ink alone is the default view.
  return Object.fromEntries(
    STRATEGY_DEFS.map(def => [def.id, { enabled: false, param: def.defaultParam }])
  );
}

export function getActiveStrategies(strategies: StrategiesState): ActiveStrategy[] {
  return STRATEGY_DEFS
    .filter(def => strategies[def.id]?.enabled)
    .map(def => ({ def, param: strategies[def.id]?.param ?? def.defaultParam }));
}
