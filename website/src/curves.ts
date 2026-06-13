import { renderStroke } from 'rescrawl';
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
    id: 'polyline',
    label: 'Polyline',
    color: '#3b82f6',
    defaultParam: 0,
    paramLabel: '',
    paramMin: 0, paramMax: 0, paramStep: 0,
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
// reference curves layered on top.
export const INK: StrategyDef = {
  id: 'ink',
  label: 'Ink',
  color: '#1a1a1a',
  defaultParam: 8,
  paramLabel: 'max width',
  paramMin: 2, paramMax: 30, paramStep: 1,
  render: timed((pts, maxWidth) => renderStroke(pts, { maxWidth })),
};

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
