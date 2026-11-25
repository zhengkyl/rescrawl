import type { ReadonlySignal, Signal } from "@preact/signals";
import { computed, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { fitPath } from "rescrawl";
import { useApp } from "../context";
import type { Drawn, InkOptions } from "../ink";
import { INK_COLOR, StrokeInk } from "../ink";
import { useStrokes } from "../strokeStore";
import type { Point, Stroke } from "../stroke";
import { strokeEnd, strokeStart, withinStroke } from "../stroke";
import { drawInk } from "./drawInk";

const INK_CHUNK = 128; // strokes per settled band
const PICK_PX = 8; // how close, in screen px, a click must come to a stroke's edge
// Two fingers always pan; zoom starts once their spread changes by ZOOM_SLOP,
// or PAN_ZOOM_SLOP once the midpoint has moved PAN_PX screen px.
const ZOOM_SLOP = 1.15;
const PAN_ZOOM_SLOP = 1.5;
const PAN_PX = 24;
// Two fingers tapped undo, three redo: all lifted within TAP_MS of the first
// landing, none moved TAP_PX. Panning waits for TAP_PX too, so a tap doesn't nudge.
const TAP_MS = 250;
const TAP_PX = 10;
const CURVE_COLOR = "#06b6d4";
const HANDLE_COLOR = "#ec4899";

type InkCache = WeakMap<Stroke, Drawn>;

// `settled` changes only when a stroke in the band crosses the playhead
type Band = { strokes: Stroke[]; settled: ReadonlySignal<number> };

function countSettled(strokes: Stroke[], elapsed: Signal<number>): number {
  let n = 0;
  for (const s of strokes) if (strokeEnd(s) <= elapsed.value) n++;
  return n;
}

function sameStrokes(a: Stroke[], b: Stroke[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// the settled count is the subscription; the playhead is only peeked
function InkBand({
  strokes,
  settled,
  elapsed,
  inkOptions,
  cache,
}: Band & { elapsed: Signal<number>; inkOptions: InkOptions; cache: InkCache }) {
  if (settled.value === 0) return null;
  const drawTime = elapsed.peek();
  return (
    <g>
      {strokes.map((s, j) => {
        if (strokeEnd(s) > drawTime) return null;
        let ink = cache.get(s);
        if (ink === undefined) {
          ink = new StrokeInk(s, inkOptions).whole();
          cache.set(s, ink);
        }
        return drawInk(ink, j, INK_COLOR);
      })}
    </g>
  );
}

// replayed as drawn, fed forward with the playhead, started over when it goes back
function ActiveInk({
  strokes,
  elapsed,
  inkOptions,
}: {
  strokes: Stroke[];
  elapsed: Signal<number>;
  inkOptions: InkOptions;
}) {
  const inks = useMemo(() => new WeakMap<Stroke, StrokeInk>(), [inkOptions]);
  const t = elapsed.value;
  return (
    <g>
      {strokes.map((s, i) => {
        if (!withinStroke(s, t)) {
          inks.delete(s);
          return null;
        }
        let ink = inks.get(s);
        if (ink === undefined || t < ink.t) {
          ink = new StrokeInk(s, inkOptions);
          inks.set(s, ink);
        }
        return drawInk(ink.at(t), i, INK_COLOR);
      })}
    </g>
  );
}

// its own component, so the per-frame read skips <Canvas>
function LiveStroke({ ink }: { ink: Signal<Drawn | null> }) {
  if (ink.value === null) return null;
  return <g>{drawInk(ink.value, "live", INK_COLOR)}</g>;
}

// a mouse reports a fixed 0.5
function pressure(e: PointerEvent): { p?: number } {
  return e.pointerType === "pen" ? { p: e.pressure } : {};
}

function distToPath(points: Point[], x: number, y: number): number {
  let best = Math.hypot(points[0].x - x, points[0].y - y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const f = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + f * dx - x, a.y + f * dy - y));
  }
  return best;
}

// the latest drawn wins, being on top
function pickStroke(
  strokes: Stroke[],
  x: number,
  y: number,
  t: number,
  reach: number,
  o: InkOptions,
): number | null {
  let best: number | null = null;
  let bestD = reach;
  strokes.forEach((s, i) => {
    if (strokeStart(s) > t) return;
    // widths are screen px at the stroke's zoom
    const half = (s.style === "pen" ? o.width : o.maxWidth) / 2 / s.zoom;
    const d = distToPath(s.points, x, y) - half;
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

function Inspect({
  stroke,
  elapsed,
  inkOptions,
}: {
  stroke: Stroke;
  elapsed: Signal<number>;
  inkOptions: InkOptions;
}) {
  const t = elapsed.value;
  if (t < strokeStart(stroke)) return null;
  const ink = new StrokeInk(stroke, inkOptions);
  if (t < strokeEnd(stroke)) ink.at(t);
  else ink.whole();
  const ns = ink.fit.nodes;
  const mark = (
    x: number,
    y: number,
    color: string,
    width: number,
    cap: "round" | "square" = "round",
  ) => (
    <path
      d={`M${x} ${y}h0`}
      stroke={color}
      stroke-width={width}
      stroke-linecap={cap}
      vector-effect="non-scaling-stroke"
    />
  );
  const line = (x1: number, y1: number, x2: number, y2: number) => (
    <path
      d={`M${x1} ${y1}L${x2} ${y2}`}
      stroke={HANDLE_COLOR}
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  );
  return (
    <g>
      <path
        d={fitPath(ns, 3)}
        fill="none"
        stroke={CURVE_COLOR}
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
      {ns.slice(1).map((b, i) => {
        const a = ns[i];
        return (
          <g key={`h${i}`}>
            {line(a.x, a.y, a.c1x, a.c1y)}
            {line(b.x, b.y, a.c2x, a.c2y)}
            {mark(a.c1x, a.c1y, HANDLE_COLOR, 4.5)}
            {mark(a.c2x, a.c2y, HANDLE_COLOR, 4.5)}
          </g>
        );
      })}
      {ns.map((n, i) => (
        <g key={`n${i}`}>
          {mark(n.x, n.y, CURVE_COLOR, n.corner ? 8 : 5, n.corner ? "square" : "round")}
        </g>
      ))}
    </g>
  );
}

export function Canvas() {
  const { view, clock, inkOptions, tool, selected, setSelected, undo, redo } = useApp();
  const store = useStrokes();

  const currentStrokeRef = useRef<Stroke | null>(null);
  const strokeInkRef = useRef<StrokeInk | null>(null);
  // the one pointer drawing; every other is ignored by the stroke
  const drawingIdRef = useRef<number | null>(null);
  const drawLoopRef = useRef<number | null>(null);
  const liveInk = useSignal<Drawn | null>(null);

  // fingers on the canvas; two or more pan and pinch until all are lifted
  const touchesRef = useRef(new Map<number, { x: number; y: number; x0: number; y0: number }>());
  const pinchingRef = useRef(false);
  // where the fingers were measured from, and what the gesture has done
  const gestureRef = useRef({
    x: 0,
    y: 0,
    d: 0,
    panning: false,
    panned: false,
    zooming: false,
  });
  // since the first finger landed: when, the most fingers down at once, and whether any moved
  const tapRef = useRef({ t0: 0, fingers: 0, moved: false });

  useEffect(
    () => () => {
      if (drawLoopRef.current !== null) cancelAnimationFrame(drawLoopRef.current);
    },
    [],
  );

  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType === "touch") {
      const touches = touchesRef.current;
      // a palm while the pen draws
      const drawing = drawingIdRef.current;
      if (drawing !== null && !touches.has(drawing)) return;
      if (touches.size === 0) tapRef.current = { t0: e.timeStamp, fingers: 0, moved: false };
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      tapRef.current.fingers = Math.max(tapRef.current.fingers, touches.size);
      view.svgRef.current!.setPointerCapture(e.pointerId);
      if (touches.size >= 2) {
        if (!pinchingRef.current) {
          gestureRef.current.zooming = false;
          gestureRef.current.panning = false;
          gestureRef.current.panned = false;
        }
        pinchingRef.current = true;
        restartGesture();
        // a second finger means the first was not drawing
        if (drawingIdRef.current !== null && touches.has(drawingIdRef.current)) dropStroke();
        return;
      }
      if (pinchingRef.current) return;
    }
    // Middle-button drag is the pan gesture, handled by useCanvasView.
    if (e.button !== 0 || drawingIdRef.current !== null) return;
    if (tool === "select") {
      const { x, y } = view.svgToContent(e.clientX, e.clientY);
      const reach = PICK_PX / view.zoom.peek();
      setSelected(pickStroke(strokes, x, y, clock.elapsed.peek(), reach, inkOptions));
      return;
    }
    drawingIdRef.current = e.pointerId;
    view.svgRef.current!.setPointerCapture(e.pointerId);
    // strokes start at the end of the recording, never in the past
    if (!clock.isRecording) {
      clock.seek(clock.duration.peek());
      clock.startRecording(e.timeStamp);
    }

    const pt = view.svgToContent(e.clientX, e.clientY);
    const now = clock.getElapsedFromTs(e.timeStamp);
    clock.penDown();
    // the stroke keeps the view's zoom as the pen goes down
    const stroke: Stroke = {
      points: [{ x: pt.x, y: pt.y, t: now, ...pressure(e) }],
      zoom: view.zoom.peek(),
      style: tool,
    };
    currentStrokeRef.current = stroke;
    strokeInkRef.current = new StrokeInk(stroke, inkOptions);
    drawFrame();
  }

  function drawFrame() {
    const ink = strokeInkRef.current;
    if (ink === null) {
      drawLoopRef.current = null;
      return;
    }
    liveInk.value = ink.at(clock.getElapsed());
    drawLoopRef.current = requestAnimationFrame(drawFrame);
  }

  function handlePointerMove(e: PointerEvent) {
    const touches = touchesRef.current;
    const touch = touches.get(e.pointerId);
    if (touch !== undefined && Math.hypot(e.clientX - touch.x0, e.clientY - touch.y0) > TAP_PX) {
      tapRef.current.moved = true;
    }
    if (pinchingRef.current && touch !== undefined) {
      const before = pinch();
      touches.set(e.pointerId, { ...touch, x: e.clientX, y: e.clientY });
      const after = pinch();
      if (!before || !after) return;
      const g = gestureRef.current;
      const travel = Math.hypot(after.x - g.x, after.y - g.y);
      if (!g.panned && travel > PAN_PX) g.panned = true;
      const slop = g.panned ? PAN_ZOOM_SLOP : ZOOM_SLOP;
      if (!g.zooming && g.d > 0 && Math.abs(Math.log(after.d / g.d)) > Math.log(slop)) {
        g.zooming = true;
      }
      if (!g.panning && (g.zooming || travel > TAP_PX)) {
        g.panning = true;
        // catch up on the movement held back
        view.pan(after.x - g.x, after.y - g.y);
      } else if (g.panning) {
        view.pan(after.x - before.x, after.y - before.y);
      }
      if (g.zooming && before.d > 0) view.zoomAt(after.x, after.y, after.d / before.d);
      return;
    }
    if (touch !== undefined) touches.set(e.pointerId, { ...touch, x: e.clientX, y: e.clientY });
    const rec = currentStrokeRef.current;
    if (rec === null || e.pointerId !== drawingIdRef.current) return;
    const pt = view.svgToContent(e.clientX, e.clientY);
    rec.points.push({ x: pt.x, y: pt.y, t: clock.getElapsedFromTs(e.timeStamp), ...pressure(e) });
  }

  // midpoint and spread of the first two fingers
  function pinch(): { x: number; y: number; d: number } | null {
    const [a, b] = touchesRef.current.values();
    if (a === undefined || b === undefined) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  function restartGesture() {
    const p = pinch();
    if (p) Object.assign(gestureRef.current, p);
  }

  function handlePointerUp(e: PointerEvent) {
    const touches = touchesRef.current;
    if (!touches.delete(e.pointerId)) {
      if (e.pointerId === drawingIdRef.current) commitStroke(e);
      return;
    }
    if (e.type === "pointercancel") tapRef.current.moved = true;
    if (touches.size === 0) {
      pinchingRef.current = false;
      const tap = tapRef.current;
      const g = gestureRef.current;
      if (!tap.moved && !g.panning && e.timeStamp - tap.t0 < TAP_MS) {
        if (tap.fingers === 2) undo();
        else if (tap.fingers === 3) redo();
      }
    }
    // a finger lifted from three or more: the pair changed
    else if (touches.size >= 2) restartGesture();
    if (e.pointerId === drawingIdRef.current) commitStroke(e);
  }

  function stopDrawing() {
    if (drawLoopRef.current !== null) {
      cancelAnimationFrame(drawLoopRef.current);
      drawLoopRef.current = null;
    }
    drawingIdRef.current = null;
  }

  function dropStroke() {
    stopDrawing();
    currentStrokeRef.current = null;
    strokeInkRef.current = null;
    liveInk.value = null;
    clock.penUp();
  }

  function commitStroke(e: PointerEvent) {
    const rec = currentStrokeRef.current;
    stopDrawing();
    if (rec === null) return;
    // The pen held until release, so the end dwell is recorded.
    const now = clock.getElapsedFromTs(e.timeStamp);
    const last = rec.points[rec.points.length - 1];
    rec.points.push({ ...last, t: Math.max(now, last.t) });
    // reuse the finished ink for the committed stroke
    cache.set(rec, strokeInkRef.current!.whole());
    currentStrokeRef.current = null;
    strokeInkRef.current = null;
    liveInk.value = null;
    store.append(rec);
    clock.penUp();
  }

  const strokes = store.strokes.value;
  const cache = useMemo<InkCache>(() => new WeakMap(), [inkOptions]);

  // fixed-size bands, so a replay frame re-renders at most one
  const bandsRef = useRef<Band[]>([]);
  const bands = useMemo(() => {
    const prev = bandsRef.current;
    const next: Band[] = [];
    for (let i = 0; i < strokes.length; i += INK_CHUNK) {
      const chunk = strokes.slice(i, i + INK_CHUNK);
      const old = prev[next.length];
      next.push(
        old && sameStrokes(old.strokes, chunk)
          ? old
          : { strokes: chunk, settled: computed(() => countSettled(chunk, clock.elapsed)) },
      );
    }
    bandsRef.current = next;
    return next;
  }, [strokes]);

  return (
    <svg
      ref={view.svgRef}
      id="canvas-svg"
      class={tool === "select" ? "select" : clock.isRecording ? "live" : ""}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      // stylus long press
      onContextMenu={(e) => e.preventDefault()}
    >
      <g transform={view.transform}>
        {bands.map((band, i) => (
          <InkBand
            key={i}
            strokes={band.strokes}
            settled={band.settled}
            elapsed={clock.elapsed}
            inkOptions={inkOptions}
            cache={cache}
          />
        ))}
        <ActiveInk strokes={strokes} elapsed={clock.elapsed} inkOptions={inkOptions} />
        <LiveStroke ink={liveInk} />
        {tool === "select" && selected !== null && selected < strokes.length && (
          <Inspect stroke={strokes[selected]} elapsed={clock.elapsed} inkOptions={inkOptions} />
        )}
      </g>
    </svg>
  );
}
