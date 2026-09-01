import "./style.css";
import { toOutline } from "rescrawl/outline";
import { dropContained } from "rescrawl/simplify";
import type { Contact, Point4 } from "rescrawl/types";
import { analyze } from "./analyze";
import { diagnostics, stepInfo } from "./panel";
import { scene } from "./scene";
import { load, preset, save, type Show, type State } from "./state";

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

const svg = $<SVGSVGElement>("#svg");
const diag = $<HTMLElement>("#diag");
const hud = $<HTMLElement>("#hud");
const stepEl = $<HTMLInputElement>("#step");
const stepNum = $<HTMLElement>("#stepNum");
const stepInfoEl = $<HTMLElement>("#stepInfo");
const pointRows = $<HTMLElement>("#pointRows");

const state: State = load();

const MAX_PTS = 8;

// --- geometry of the view -------------------------------------------------

const size = () => svg.getBoundingClientRect();

function toWorld(ev: { clientX: number; clientY: number }) {
  const r = size();
  const { cx, cy, scale } = state.view;
  return {
    x: cx + (ev.clientX - r.left - r.width / 2) / scale,
    y: cy + (ev.clientY - r.top - r.height / 2) / scale,
  };
}

// --- render ---------------------------------------------------------------

let rowsFor = -1;

function renderRows() {
  if (rowsFor !== state.pts.length) {
    rowsFor = state.pts.length;
    pointRows.innerHTML = state.pts
      .map(
        (_, i) => `<div class="ptrow" data-i="${i}">
          <span class="pname">P${i}</span>
          <label>x<input data-f="x" type="number" step="1"/></label>
          <label>y<input data-f="y" type="number" step="1"/></label>
          <label>r<input data-f="r" type="number" step="1" min="0.1"/></label>
          <button class="rm" data-rm="${i}" title="remove">×</button>
        </div>`,
      )
      .join("");
  }
  pointRows.querySelectorAll<HTMLElement>(".ptrow").forEach((row, i) => {
    row.classList.toggle("sel", state.sel === i);
    row.querySelectorAll<HTMLInputElement>("input").forEach((inp) => {
      if (inp === document.activeElement) return;
      const v = state.pts[i][inp.dataset.f as "x" | "y" | "r"];
      inp.value = String(Math.round(v * 100) / 100);
    });
  });
}

function render() {
  const r = size();
  const { cx, cy, scale } = state.view;
  const w = r.width / scale;
  const h = r.height / scale;
  svg.setAttribute("viewBox", `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);

  const pts = state.show.drop ? dropContained(state.pts) : state.pts;

  let cs: Contact[] = [];
  let err = "";
  try {
    cs = toOutline(pts);
  } catch (e) {
    err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  if (err) {
    hud.className = "err";
    hud.textContent = `toOutline threw — ${err}`;
  } else {
    hud.className = "";
    hud.textContent =
      state.show.drop && pts.length < state.pts.length
        ? `dropContained removed ${state.pts.length - pts.length} point(s)`
        : "";
  }

  const an = analyze(pts, cs);
  svg.innerHTML = scene(state, pts, cs, an, 1 / scale);
  diag.innerHTML = diagnostics(state, pts, cs, an);
  diag.querySelectorAll<HTMLElement>(".crow").forEach((row) => {
    const i = Number(row.dataset.c);
    row.onpointerenter = () => setHover({ kind: "contact", i });
    row.onpointerleave = () => setHover(null);
  });

  stepEl.max = String(cs.length);
  const stepVal = state.step < 0 ? cs.length : Math.min(state.step, cs.length);
  stepEl.value = String(stepVal);
  stepNum.textContent = state.step < 0 || stepVal >= cs.length ? "all" : `${stepVal}/${cs.length}`;
  stepInfoEl.innerHTML = stepInfo(state, cs, an);

  renderRows();
  save(state);
}

function setHover(h: State["hover"]) {
  const same =
    (h === null && state.hover === null) ||
    (h && state.hover && h.kind === state.hover.kind && h.i === state.hover.i);
  if (same) return;
  state.hover = h;
  render();
}

// --- editing --------------------------------------------------------------

function addPoint(at?: { x: number; y: number }) {
  if (state.pts.length >= MAX_PTS) return;
  const last = state.pts[state.pts.length - 1];
  const p = at ?? { x: last ? last.x + 90 : 200, y: last ? last.y : 150 };
  state.pts.push({ x: p.x, y: p.y, t: (last?.t ?? 0) + 100, r: last?.r ?? 20 });
  state.sel = state.pts.length - 1;
  render();
}

function removePoint(i: number) {
  if (state.pts.length <= 1) return;
  state.pts.splice(i, 1);
  state.sel = null;
  render();
}

// --- pointer --------------------------------------------------------------

type Drag =
  | { kind: "move"; i: number; dx: number; dy: number }
  | { kind: "radius"; i: number }
  | { kind: "pan"; x: number; y: number; cx: number; cy: number };

let drag: Drag | null = null;

svg.addEventListener("pointerdown", (ev: PointerEvent) => {
  const el = ev.target as SVGElement;
  const w = toWorld(ev);
  svg.setPointerCapture(ev.pointerId);

  if (el.dataset.pt !== undefined) {
    const i = Number(el.dataset.pt);
    state.sel = i;
    drag = { kind: "move", i, dx: state.pts[i].x - w.x, dy: state.pts[i].y - w.y };
  } else if (el.dataset.ring !== undefined) {
    const i = Number(el.dataset.ring);
    state.sel = i;
    drag = { kind: "radius", i };
  } else {
    drag = { kind: "pan", x: ev.clientX, y: ev.clientY, cx: state.view.cx, cy: state.view.cy };
  }
  render();
});

svg.addEventListener("pointermove", (ev: PointerEvent) => {
  if (!drag) {
    const el = ev.target as SVGElement;
    if (el.dataset.c !== undefined) setHover({ kind: "contact", i: Number(el.dataset.c) });
    else if (el.dataset.pt !== undefined) setHover({ kind: "point", i: Number(el.dataset.pt) });
    else if (el.dataset.ring !== undefined) setHover({ kind: "point", i: Number(el.dataset.ring) });
    else setHover(null);
    return;
  }
  const w = toWorld(ev);
  if (drag.kind === "move") {
    const p = state.pts[drag.i];
    p.x = Math.round((w.x + drag.dx) * 10) / 10;
    p.y = Math.round((w.y + drag.dy) * 10) / 10;
  } else if (drag.kind === "radius") {
    const p = state.pts[drag.i];
    p.r = Math.max(0.5, Math.round(Math.hypot(w.x - p.x, w.y - p.y) * 10) / 10);
  } else {
    state.view.cx = drag.cx - (ev.clientX - drag.x) / state.view.scale;
    state.view.cy = drag.cy - (ev.clientY - drag.y) / state.view.scale;
  }
  render();
});

const endDrag = (ev: PointerEvent) => {
  if (drag) svg.releasePointerCapture(ev.pointerId);
  drag = null;
};
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);

svg.addEventListener("dblclick", (ev: MouseEvent) => {
  const el = ev.target as SVGElement;
  if (el.dataset.pt !== undefined || el.dataset.ring !== undefined) return;
  addPoint(toWorld(ev));
});

svg.addEventListener(
  "wheel",
  (ev: WheelEvent) => {
    ev.preventDefault();
    const before = toWorld(ev);
    const k = Math.exp(-ev.deltaY / 400);
    state.view.scale = Math.min(40, Math.max(0.2, state.view.scale * k));
    const after = toWorld(ev);
    state.view.cx += before.x - after.x;
    state.view.cy += before.y - after.y;
    render();
  },
  { passive: false },
);

// --- keyboard -------------------------------------------------------------

window.addEventListener("keydown", (ev: KeyboardEvent) => {
  if ((ev.target as HTMLElement).tagName === "INPUT") return;
  const i = state.sel;
  const p = i === null ? null : state.pts[i];
  const s = ev.shiftKey ? 10 : 1;
  const nudge: Record<string, [number, number]> = {
    ArrowLeft: [-s, 0],
    ArrowRight: [s, 0],
    ArrowUp: [0, -s],
    ArrowDown: [0, s],
  };
  if (p && nudge[ev.key]) {
    p.x += nudge[ev.key][0];
    p.y += nudge[ev.key][1];
  } else if (p && (ev.key === "[" || ev.key === "]")) {
    p.r = Math.max(0.5, p.r + (ev.key === "]" ? s : -s));
  } else if (i !== null && (ev.key === "Delete" || ev.key === "Backspace")) {
    removePoint(i);
    return;
  } else if (ev.key === "a") {
    addPoint();
    return;
  } else if (ev.key === "Escape") {
    state.sel = null;
  } else return;
  ev.preventDefault();
  render();
});

// --- controls -------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    state.pts = preset(Number(b.dataset.preset));
    state.sel = null;
    state.step = -1;
    render();
  }),
);

$<HTMLButtonElement>("#add").addEventListener("click", () => addPoint());
$<HTMLButtonElement>("#del").addEventListener("click", () => removePoint(state.pts.length - 1));

document.querySelectorAll<HTMLInputElement>("[data-show]").forEach((box) => {
  const key = box.dataset.show as keyof Show;
  box.checked = state.show[key];
  box.addEventListener("change", () => {
    state.show[key] = box.checked;
    render();
  });
});

stepEl.addEventListener("input", () => {
  const v = Number(stepEl.value);
  state.step = v >= Number(stepEl.max) ? -1 : v;
  render();
});

pointRows.addEventListener("input", (ev) => {
  const inp = ev.target as HTMLInputElement;
  if (!inp.dataset.f) return;
  const i = Number((inp.closest(".ptrow") as HTMLElement).dataset.i);
  const v = Number(inp.value);
  if (!Number.isFinite(v)) return;
  state.pts[i][inp.dataset.f as "x" | "y" | "r"] = inp.dataset.f === "r" ? Math.max(0.1, v) : v;
  render();
});

pointRows.addEventListener("click", (ev) => {
  const el = ev.target as HTMLElement;
  if (el.dataset.rm !== undefined) removePoint(Number(el.dataset.rm));
  else {
    const row = el.closest(".ptrow") as HTMLElement | null;
    if (row) {
      state.sel = Number(row.dataset.i);
      render();
    }
  }
});

window.addEventListener("resize", render);
render();
