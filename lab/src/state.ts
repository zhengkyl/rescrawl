import type { Point4 } from "rescrawl/types";

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
export function preset(n: number): Point4[] {
  const all: Point4[] = [
    { x: 90, y: 190, t: 0, r: 26 },
    { x: 180, y: 110, t: 100, r: 18 },
    { x: 280, y: 160, t: 200, r: 30 },
    { x: 360, y: 90, t: 300, r: 14 },
  ];
  return all.slice(0, n).map((p) => ({ ...p }));
}

export function initial(): State {
  return {
    pts: preset(3),
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
  const { pts, view, step, sel, show } = s;
  try {
    localStorage.setItem(KEY, JSON.stringify({ pts, view, step, sel, show }));
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
  } catch {}
  return base;
}
