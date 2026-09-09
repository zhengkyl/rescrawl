import { RENDER_DEFAULTS } from "rescrawl/types";
import type { Point4, RenderOptions } from "rescrawl/types";

export type Show = {
  fill: boolean;
  polygon: boolean;
  discs: boolean;
  centerline: boolean;
  tangents: boolean;
  contacts: boolean;
  radii: boolean;
  tangentDirs: boolean;
  labels: boolean;
  crossings: boolean;
  evenodd: boolean;
  drop: boolean;
};

export type Hover = { kind: "contact" | "point"; i: number } | null;

export type State = {
  pts: Point4[];
  // The whole option set, engine included. Only the knobs the current engine
  // declares are shown, but every engine's values are kept so switching back
  // and forth loses nothing.
  opts: Required<RenderOptions>;
  view: { cx: number; cy: number; scale: number }; // scale = px per world unit
  step: number; // -1 = whole loop
  sel: number | null;
  hover: Hover;
  show: Show;
};

const SHOW: Show = {
  fill: true,
  polygon: false,
  discs: true,
  centerline: true,
  tangents: false,
  contacts: true,
  radii: true,
  tangentDirs: false,
  labels: true,
  crossings: true,
  evenodd: false,
  drop: false,
};

// Radii that differ on purpose: a constant-width tube hides half of what the
// off-angle does.
export function preset(key: string): Point4[] {
  if (key === "uneven") return UNEVEN_ARC.map((p) => ({ ...p }));
  if (key === "corner") return CORNER.map((p) => ({ ...p }));
  const all: Point4[] = [
    { x: 90, y: 190, t: 0, r: 26 },
    { x: 180, y: 110, t: 100, r: 18 },
    { x: 280, y: 160, t: 200, r: 30 },
    { x: 360, y: 90, t: 300, r: 14 },
  ];
  return all.slice(0, Number(key)).map((p) => ({ ...p }));
}

// A smooth arc (radius 170 about (220, 330)) sampled with alternating 6° and
// 30° steps. Each long chord sits between two short ones: any magnitude rule
// that leans on the shorter neighbour flattens every long cubic and the arc
// renders as a rounded polygon. The sag cap only bites here once `sag` drops
// below what a 30° step actually sags, about 0.5·r.
const UNEVEN_ARC: Point4[] = [
  { x: 77.4, y: 237.4, t: 0, r: 12 },
  { x: 87.9, y: 223.0, t: 20, r: 12 },
  { x: 159.1, y: 171.3, t: 120, r: 12 },
  { x: 176.0, y: 165.8, t: 140, r: 12 },
  { x: 264.0, y: 165.8, t: 240, r: 12 },
  { x: 280.9, y: 171.3, t: 260, r: 12 },
  { x: 352.1, y: 223.0, t: 360, r: 12 },
  { x: 362.6, y: 237.4, t: 380, r: 12 },
];

// A right angle at P4, sampled every 30 px with the pen slowing into the
// corner. Under `fit` the turn at P4 is 90° over one sample either side, well
// past the default corner angle, so it splits the runs and gets in/out
// tangents of its own; the polyline engines see the same bend as one joint.
const CORNER: Point4[] = [
  { x: 80, y: 120, t: 0, r: 8 },
  { x: 110, y: 120, t: 40, r: 9 },
  { x: 140, y: 120, t: 80, r: 10 },
  { x: 170, y: 120, t: 120, r: 12 },
  { x: 200, y: 120, t: 170, r: 15 },
  { x: 200, y: 150, t: 220, r: 12 },
  { x: 200, y: 180, t: 260, r: 10 },
  { x: 200, y: 210, t: 300, r: 9 },
  { x: 200, y: 240, t: 340, r: 8 },
];

export function initial(): State {
  return {
    pts: preset("3"),
    opts: { ...RENDER_DEFAULTS },
    view: { cx: 220, cy: 150, scale: 2 },
    step: -1,
    sel: null,
    hover: null,
    show: { ...SHOW },
  };
}

const KEY = "outline-lab";

// Persisted so a hot reload -- the point of this app -- does not throw away the
// case you were looking at.
export function save(s: State) {
  const { pts, opts, view, step, sel, show } = s;
  try {
    localStorage.setItem(KEY, JSON.stringify({ pts, opts, view, step, sel, show }));
  } catch {}
}

export function load(): State {
  const base = initial();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const j = JSON.parse(raw);
    if (Array.isArray(j?.pts) && j.pts.length) base.pts = j.pts;
    if (j?.view) base.view = { ...base.view, ...j.view };
    if (typeof j?.step === "number") base.step = j.step;
    if (typeof j?.sel === "number") base.sel = j.sel;
    if (j?.show) base.show = { ...base.show, ...j.show };
    if (j?.opts) base.opts = { ...base.opts, ...j.opts };
  } catch {}
  return base;
}
