import type { ReadonlySignal, Signal } from "@preact/signals";
import { batch, useComputed, useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import type { Point3 } from "rescrawl";
import type { FreehandOptions } from "./freehand";
import { FREEHAND_DEFAULTS, FreehandSettings, freehandPath } from "./freehand";
import type { GreedyOptions } from "./greedy";
import { GREEDY_DEFAULTS, GreedySettings, greedyPath } from "./greedy";
import "./compare.css";

// The engine grid: one drawable canvas per stroke engine, all showing the same
// strokes through the same camera. Draw on any of them and every canvas records
// the same input — the only difference between the cells is the engine that
// turns those samples into ink, and the settings each engine exposes.

export type Stroke = Point3[];

const INK = "#1a1a1a";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

// One camera for the whole grid. Each cell hands in its own bounding rect, so
// a gesture anchored at the cursor works from whichever cell it started in
// while every cell ends up with the same transform.
type View = {
  transform: ReadonlySignal<string>;
  zoom: Signal<number>;
  toContent: (rect: DOMRect, clientX: number, clientY: number) => { x: number; y: number };
  pan: (dx: number, dy: number) => void;
  zoomAt: (rect: DOMRect, clientX: number, clientY: number, factor: number) => void;
  reset: () => void;
};

function useSharedView(): View {
  const panX = useSignal(0);
  const panY = useSignal(0);
  const zoom = useSignal(1);
  // Batched so the transform recomputes once per gesture frame, not per axis.
  const apply = (x: number, y: number, z: number) =>
    batch(() => {
      panX.value = x;
      panY.value = y;
      zoom.value = z;
    });
  return {
    transform: useComputed(() => `translate(${panX.value},${panY.value}) scale(${zoom.value})`),
    zoom,
    toContent: (rect, clientX, clientY) => ({
      x: (clientX - rect.left - panX.value) / zoom.value,
      y: (clientY - rect.top - panY.value) / zoom.value,
    }),
    pan: (dx, dy) => apply(panX.value + dx, panY.value + dy, zoom.value),
    zoomAt: (rect, clientX, clientY, factor) => {
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const z = zoom.value;
      const next = clampZoom(z * factor);
      apply(mx - ((mx - panX.value) / z) * next, my - ((my - panY.value) / z) * next, next);
    },
    reset: () => apply(0, 0, 1),
  };
}

// The pen: one in-progress stroke, shared by every cell. `points` is what the
// cells draw as the live stroke; `commit` is what lands in the document.
type Pen = {
  points: Signal<Stroke | null>;
  down: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  up: () => void;
};

function usePen(commit: (stroke: Stroke) => void): Pen {
  const points = useSignal<Stroke | null>(null);
  const recRef = useRef<Stroke | null>(null);
  const startRef = useRef(0);
  const loopRef = useRef<number | null>(null);

  const now = () => performance.now() - startRef.current;

  // While the pen is down, republish the stroke every frame with a trailing tip
  // at (last position, now) — that dwell is what the width model reads when the
  // pen stops moving, so the ink thickens under a held pen.
  function frame() {
    const rec = recRef.current;
    if (rec === null) {
      loopRef.current = null;
      return;
    }
    const last = rec[rec.length - 1];
    points.value = [...rec, { x: last.x, y: last.y, t: now() }];
    loopRef.current = requestAnimationFrame(frame);
  }

  return {
    points,
    down(x, y) {
      if (recRef.current !== null) return;
      startRef.current = performance.now();
      recRef.current = [{ x, y, t: 0 }];
      frame();
    },
    move(x, y) {
      const rec = recRef.current;
      if (rec === null) return;
      const last = rec[rec.length - 1];
      // ignore non-movement updates (e.g. pens)
      if (x === last.x && y === last.y) return;
      rec.push({ x, y, t: now() });
    },
    up() {
      const rec = recRef.current;
      if (rec === null) return;
      if (loopRef.current !== null) cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
      // The release point (final position + release time) so every stroke has
      // >= 2 points and the end dwell is recorded.
      const last = rec[rec.length - 1];
      const stroke: Stroke = [...rec, { x: last.x, y: last.y, t: now() }];
      recRef.current = null;
      points.value = null;
      commit(stroke);
    },
  };
}

// What one engine costs to run, in ms per live frame -- read like an fps
// counter, not like a benchmark. The window is short and turns over fast, so
// the numbers track what the pen is doing right now, and the graph beside them
// is the point: it shows how OFTEN a frame blows the budget, which no single
// summary number can say.
const WINDOW = 120; // frames on screen -- about 2s at 60fps
const PUBLISH_MS = 100; // 10Hz: fast enough to read as live
const BUDGET_MS = 1000 / 60; // one 60fps frame -- the line spikes are measured against

type FrameStats = {
  frames: number;
  median: number;
  max: number;
  spikes: number; // frames over budget, in the window
  bars: number[]; // the window itself, oldest first
};

const NO_FRAMES: FrameStats = { frames: 0, median: 0, max: 0, spikes: 0, bars: [] };

function useFrameStats() {
  const stats = useSignal<FrameStats>(NO_FRAMES);
  // Every frame accrues here; only `publish` reaches the signal, so a 60fps
  // stroke repaints the meter ten times a second instead of sixty -- and the
  // sort it costs runs at that rate too, over 120 samples, not per frame.
  const acc = useRef({ ring: [] as number[], next: 0, frames: 0, at: 0 });

  function publish() {
    const a = acc.current;
    a.at = performance.now();
    // Oldest first, so the graph reads left to right as time.
    const bars =
      a.ring.length < WINDOW
        ? a.ring.slice()
        : [...a.ring.slice(a.next), ...a.ring.slice(0, a.next)];
    const sorted = [...bars].sort((x, y) => x - y);
    stats.value = {
      frames: a.frames,
      median: sorted[sorted.length >> 1],
      max: sorted[sorted.length - 1],
      spikes: bars.reduce((n, v) => n + (v > BUDGET_MS ? 1 : 0), 0),
      bars,
    };
  }
  return {
    stats,
    sample(ms: number) {
      const a = acc.current;
      a.frames++;
      if (a.ring.length < WINDOW) a.ring.push(ms);
      else a.ring[a.next] = ms;
      a.next = (a.next + 1) % WINDOW;
      if (performance.now() - a.at >= PUBLISH_MS) publish();
    },
    // On pen-up, so the last frames of a stroke are never left unreported.
    // Nothing renders while the pen is up, so the meter then holds the profile
    // of the stroke just drawn rather than decaying to zero.
    flush() {
      if (acc.current.frames > 0) publish();
    },
    reset() {
      acc.current = { ring: [], next: 0, frames: 0, at: 0 };
      stats.value = NO_FRAMES;
    },
  };
}

type FrameMeter = ReturnType<typeof useFrameStats>;

// The live stroke, drawn through this cell's engine. Its own component so the
// per-frame repaint touches one path and not the cell's committed ink -- and
// so the clock around `render` times exactly the engine, once per frame.
function LiveInk({
  pen,
  render,
  meter,
}: {
  pen: Pen;
  render: (s: Stroke) => string;
  meter: FrameMeter;
}) {
  const pts = pen.points.value;
  if (pts === null) {
    meter.flush();
    return null;
  }
  const t0 = performance.now();
  const d = render(pts);
  meter.sample(performance.now() - t0);
  return <path d={d} fill={INK} fill-rule="nonzero" />;
}

// Path data is ASCII, so one character is one byte.
function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
}

// Reads the signal, so the per-frame numbers repaint this line alone.
const GRAPH_H = 22;

// Minecraft's lag meter, in miniature: one bar per frame in the window, oldest
// left, scaled so the budget line is always on screen. Bars over budget are
// drawn red -- their spacing across the graph is the spike rate.
function FrameGraph({ bars }: { bars: number[] }) {
  const scale = Math.max(BUDGET_MS, ...bars);
  let ok = "";
  let over = "";
  for (let i = 0; i < bars.length; i++) {
    const h = Math.max((bars[i] / scale) * GRAPH_H, 0.5);
    const seg = `M${i + 0.5} ${GRAPH_H}V${(GRAPH_H - h).toFixed(2)}`;
    if (bars[i] > BUDGET_MS) over += seg;
    else ok += seg;
  }
  const budgetY = GRAPH_H - (BUDGET_MS / scale) * GRAPH_H;
  return (
    <svg class="frame-graph" viewBox={`0 0 ${WINDOW} ${GRAPH_H}`} preserveAspectRatio="none">
      <path d={ok} stroke="#9aa7b4" stroke-width="1" fill="none" />
      <path d={over} stroke="#ef4444" stroke-width="1" fill="none" />
      <path
        d={`M0 ${budgetY.toFixed(2)}H${WINDOW}`}
        stroke="#c9c9c9"
        stroke-width="1"
        fill="none"
        stroke-dasharray="3 3"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}

// Reads the signal, so the per-frame numbers repaint this line alone.
function FrameReadout({ stats }: { stats: Signal<FrameStats> }) {
  const { frames, median, max, spikes, bars } = stats.value;
  if (frames === 0) return <span class="stat-dim">frame —</span>;
  return (
    <>
      <span>
        frame {median.toFixed(2)} · max {max.toFixed(2)} ms
      </span>
      <FrameGraph bars={bars} />
      <span class={spikes === 0 ? "stat-dim" : "stat-hot"}>
        {spikes}/{bars.length} over {BUDGET_MS.toFixed(1)} ms
      </span>
    </>
  );
}

// One canvas in the grid: the shared strokes drawn through one engine, plus
// that engine's settings folded into a <details> over the corner.
//
// `paths` is the committed ink, already rendered by the caller (so it is
// recomputed only when the strokes or that engine's options change); `render`
// is the same engine applied to the live stroke, per frame.
function Cell({
  title,
  note,
  view,
  pen,
  paths,
  render,
  meter,
  settings,
}: {
  title: string;
  note: string;
  view: View;
  pen: Pen;
  paths: string[];
  render: (s: Stroke) => string;
  meter: FrameMeter;
  settings: ComponentChildren;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);

  // The committed ink as it would be written to a file -- the live stroke is
  // left out so the number holds still between strokes.
  const bytes = useMemo(() => paths.reduce((n, d) => n + d.length, 0), [paths]);

  const rect = () => svgRef.current!.getBoundingClientRect();
  const at = (e: PointerEvent) => view.toContent(rect(), e.clientX, e.clientY);

  function handlePointerDown(e: PointerEvent) {
    // Middle button pans, left button draws.
    if (e.button === 1) {
      svgRef.current!.setPointerCapture(e.pointerId);
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = at(e);
    pen.down(p.x, p.y);
  }

  function handlePointerMove(e: PointerEvent) {
    const drag = panning.current;
    if (drag !== null) {
      view.pan(e.clientX - drag.x, e.clientY - drag.y);
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const p = at(e);
    pen.move(p.x, p.y);
  }

  function endGesture() {
    panning.current = null;
    pen.up();
  }

  return (
    <section class="cell">
      <svg
        ref={svgRef}
        class="cell-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onWheel={(e) => {
          e.preventDefault();
          if (e.ctrlKey) view.zoomAt(rect(), e.clientX, e.clientY, Math.pow(1.001, -e.deltaY));
          else view.pan(-e.deltaX, -e.deltaY);
        }}
        // stylus long press
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={view.transform}>
          {paths.map((d, i) => (
            <path key={i} d={d} fill={INK} fill-rule="nonzero" />
          ))}
          <LiveInk pen={pen} render={render} meter={meter} />
        </g>
      </svg>
      <div class="cell-hud">
        <div class="cell-title">{title}</div>
        <div class="cell-note">{note}</div>
        <div
          class="cell-stats"
          title="Outline path data for the committed strokes, and the time this engine takes to rebuild the live stroke, over the last 120 frames. Click to reset the meter."
          onClick={meter.reset}
        >
          <span>svg {formatBytes(bytes)}</span>
          <FrameReadout stats={meter.stats} />
        </div>
      </div>
      <details class="cell-settings">
        <summary>settings</summary>
        <div class="cell-knobs">{settings}</div>
      </details>
    </section>
  );
}

export function ComparePage() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [greedy, setGreedy] = useState<GreedyOptions>(GREEDY_DEFAULTS);
  const [freehand, setFreehand] = useState<FreehandOptions>(FREEHAND_DEFAULTS);

  const view = useSharedView();
  const pen = usePen((stroke) => setStrokes((prev) => [...prev, stroke]));
  // One meter per cell: they time the same frames through different engines.
  const greedyMeter = useFrameStats();
  const freehandMeter = useFrameStats();

  // Committed ink per engine: one pass over the strokes, redone only when they
  // or that engine's knobs change — never while the pen is moving.
  const greedyPaths = useMemo(() => strokes.map((s) => greedyPath(s, greedy)), [strokes, greedy]);
  const freehandPaths = useMemo(
    () => strokes.map((s) => freehandPath(s, freehand)),
    [strokes, freehand],
  );

  return (
    <>
      <header class="grid-bar">
        <span class="grid-title">engine grid</span>
        <span class="grid-hint">draw on any canvas · wheel pans · ctrl+wheel zooms</span>
        <button onClick={() => setStrokes((prev) => prev.slice(0, -1))} disabled={!strokes.length}>
          Undo
        </button>
        <button
          onClick={() => {
            setStrokes([]);
            greedyMeter.reset();
            freehandMeter.reset();
          }}
          disabled={!strokes.length}
        >
          Clear
        </button>
        <button onClick={view.reset}>Reset view</button>
      </header>
      <div class="grid">
        <Cell
          title="rescrawl · greedy"
          note="speed → radius, fitted centerline, greedy envelope outline"
          view={view}
          pen={pen}
          paths={greedyPaths}
          render={(s) => greedyPath(s, greedy)}
          meter={greedyMeter}
          settings={<GreedySettings options={greedy} onChange={setGreedy} />}
        />
        <Cell
          title="perfect-freehand"
          note="raw samples, simulated pressure, its own streamlining"
          view={view}
          pen={pen}
          paths={freehandPaths}
          render={(s) => freehandPath(s, freehand)}
          meter={freehandMeter}
          settings={<FreehandSettings options={freehand} onChange={setFreehand} />}
        />
      </div>
    </>
  );
}
