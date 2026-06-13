import { renderStroke } from 'rescrawl';
import type { Stroke } from './utils';
import { smoothAverage } from './utils';

// A renderer turns one stroke's raw data into a renderable line. When `shapes`
// is present the consumer fills those (variable-width); otherwise it strokes
// `curve` at `width`.
export type RenderedLine = {
  curve: string;
  width: number;
  shapes?: string[];
};

export type StrategyDef = {
  id: string;
  label: string;
  color: string;
  defaultParam: number;
  paramLabel: string;   // '' means no param
  paramMin: number;
  paramMax: number;
  paramStep: number;
  render: (stroke: Stroke, param: number) => RenderedLine;
};

export type ActiveStrategy = { def: StrategyDef; param: number };
export type StrategyState = { enabled: boolean; param: number };
export type StrategiesState = Record<string, StrategyState>;

function r(n: number) {
  return Math.round(n * 100) / 100;
}

// Polyline `d` over {x,y}; single point renders as a dot.
function polylinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${r(pts[0].x)},${r(pts[0].y)} L ${r(pts[0].x)},${r(pts[0].y)}`;
  return 'M ' + pts.map(p => `${r(p.x)},${r(p.y)}`).join(' L ');
}

const LINE_WIDTH = 2;

// Add new rendering strategies here — each entry auto-appears in the Curve panel.
export const STRATEGY_DEFS: StrategyDef[] = [
  {
    id: 'polyline',
    label: 'Polyline',
    color: '#aaa',
    defaultParam: 0,
    paramLabel: '',
    paramMin: 0, paramMax: 0, paramStep: 0,
    render(stroke) {
      return { curve: polylinePath(stroke), width: LINE_WIDTH };
    },
  },
  {
    id: 'smooth-avg',
    label: 'Smooth Avg',
    color: '#4f8ef7',
    defaultParam: 3,
    paramLabel: 'passes',
    paramMin: 1, paramMax: 20, paramStep: 1,
    render(stroke, passes) {
      const pts = smoothAverage(stroke, Math.round(Math.max(1, passes)));
      return { curve: polylinePath(pts), width: LINE_WIDTH };
    },
  },
  {
    id: 'cubic',
    label: 'Cubic',
    color: '#f97316',
    defaultParam: 1,
    paramLabel: 'smooth',
    paramMin: 0, paramMax: 1, paramStep: 0.1,
    // Cardinal spline → cubic bezier. smooth=0: polyline, smooth=1: Catmull-Rom
    render(stroke, smooth) {
      if (stroke.length < 2) return { curve: polylinePath(stroke), width: LINE_WIDTH };
      let d = `M ${r(stroke[0].x)},${r(stroke[0].y)}`;
      for (let i = 0; i < stroke.length - 1; i++) {
        const p0 = stroke[Math.max(i - 1, 0)];
        const p1 = stroke[i];
        const p2 = stroke[i + 1];
        const p3 = stroke[Math.min(i + 2, stroke.length - 1)];
        const cp1x = r(p1.x + (smooth * (p2.x - p0.x)) / 6);
        const cp1y = r(p1.y + (smooth * (p2.y - p0.y)) / 6);
        const cp2x = r(p2.x - (smooth * (p3.x - p1.x)) / 6);
        const cp2y = r(p2.y - (smooth * (p3.y - p1.y)) / 6);
        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${r(p2.x)},${r(p2.y)}`;
      }
      return { curve: d, width: LINE_WIDTH };
    },
  },
  {
    id: 'chaikin',
    label: 'Chaikin',
    color: '#22c55e',
    defaultParam: 1,
    paramLabel: 'smooth',
    paramMin: 0, paramMax: 1, paramStep: 0.25,
    // Corner-cutting subdivision. Doesn't pass through original points.
    // smooth=0: polyline, smooth=1: 4 iterations of subdivision
    render(stroke, smooth) {
      let p: [number, number][] = stroke.map(({ x, y }) => [x, y]);
      const iterations = Math.round(smooth * 4);
      for (let iter = 0; iter < iterations; iter++) {
        const next: [number, number][] = [p[0]];
        for (let i = 0; i < p.length - 1; i++) {
          const [x0, y0] = p[i];
          const [x1, y1] = p[i + 1];
          next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
          next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
        }
        next.push(p[p.length - 1]);
        p = next;
      }
      return { curve: polylinePath(p.map(([x, y]) => ({ x, y }))), width: LINE_WIDTH };
    },
  },
  {
    id: 'ink',
    label: 'Ink',
    color: '#a855f7',
    defaultParam: 8,
    paramLabel: 'max width',
    paramMin: 2, paramMax: 30, paramStep: 1,
    // Variable-width calligraphic shape from the rescrawl library.
    render(stroke, maxWidth) {
      return renderStroke(stroke, { maxWidth });
    },
  },
];

export function getDefaultStrategies(): StrategiesState {
  return Object.fromEntries(
    STRATEGY_DEFS.map(def => [def.id, { enabled: def.id === 'polyline', param: def.defaultParam }])
  );
}

export function getActiveStrategies(strategies: StrategiesState): ActiveStrategy[] {
  return STRATEGY_DEFS
    .filter(def => strategies[def.id]?.enabled)
    .map(def => ({ def, param: strategies[def.id]?.param ?? def.defaultParam }));
}
