import type { ReadonlySignal, Signal } from "@preact/signals";
import { computed, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { fitPath } from "rescrawl";
import { useApp } from "../context";
import type { Drawn, InkOptions } from "../ink";
import { StrokeInk } from "../ink";
import { useStrokes } from "../strokeStore";
import type { Point, Stroke } from "../stroke";
import { eventTime, timeNow, strokeEnd, strokeStart } from "../stroke";
import { drawInk } from "./drawInk";

const INK_CHUNK = 128; // strokes per settled band
const PICK_PX = 8; // how close, in screen px, a click must come to a stroke's edge
const DRAG_PX = 6; // screen px a select press moves before it is a drag, not a click
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
const MARQUEE_COLOR = "#4f8ef7";

type InkCache = WeakMap<Stroke, Drawn>;
type Box = { x0: number; y0: number; x1: number; y1: number };

// `ends`: replay time each stroke finishes, null outside replay, where all are drawn;
// `settled` changes only when a stroke in the band crosses the playhead
type Band = { strokes: Stroke[]; ends: number[] | null; settled: ReadonlySignal<number> };

function countSettled(ends: number[], elapsed: Signal<number>): number {
  let n = 0;
  for (const end of ends) if (end <= elapsed.value) n++;
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
  ends,
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
        if (ends !== null && ends[j] > drawTime) return null;
        let ink = cache.get(s);
        if (ink === undefined) {
          ink = new StrokeInk(s, inkOptions).whole();
          cache.set(s, ink);
        }
        return drawInk(ink, j);
      })}
    </g>
  );
}

// replayed as drawn, fed forward with the playhead, started over when it goes back
function ActiveInk({
  strokes,
  offsets,
  elapsed,
  inkOptions,
}: {
  strokes: Stroke[];
  offsets: number[];
  elapsed: Signal<number>;
  inkOptions: InkOptions;
}) {
  const inks = useMemo(() => new WeakMap<Stroke, StrokeInk>(), [inkOptions]);
  return (
    <g>
      {strokes.map((s, i) => {
        const t = elapsed.value + offsets[i];
        if (t < strokeStart(s) || t >= strokeEnd(s)) {
          inks.delete(s);
          return null;
        }
        let ink = inks.get(s);
        if (ink === undefined || t < ink.t) {
          ink = new StrokeInk(s, inkOptions);
          inks.set(s, ink);
        }
        return drawInk(ink.at(t), i);
      })}
    </g>
  );
}

// its own component, so the per-frame read skips <Canvas>
function LiveStroke({ ink }: { ink: Signal<Drawn | null> }) {
  if (ink.value === null) return null;
  return <g>{drawInk(ink.value, "live")}</g>;
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
  reach: number,
  o: InkOptions,
): number | null {
  let best: number | null = null;
  let bestD = reach;
  strokes.forEach((s, i) => {
    const half = s.size / 2 / s.zoom;
    const d = distToPath(s.points, x, y) - half;
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

// Liang-Barsky: some part of a to b lies in the box
function segmentInBox(a: Point, b: Point, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
    return true;
  };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return (
    clip(-dx, a.x - Math.min(box.x0, box.x1)) &&
    clip(dx, Math.max(box.x0, box.x1) - a.x) &&
    clip(-dy, a.y - Math.min(box.y0, box.y1)) &&
    clip(dy, Math.max(box.y0, box.y1) - a.y)
  );
}

// every stroke the box touches
function strokesInBox(strokes: Stroke[], box: Box): number[] {
  const hits: number[] = [];
  strokes.forEach((s, i) => {
    const ps = s.points;
    for (let j = 0; j < ps.length; j++) {
      if (segmentInBox(ps[j], ps[Math.min(j + 1, ps.length - 1)], box)) {
        hits.push(i);
        return;
      }
    }
  });
  return hits;
}

function Marquee({ box }: { box: Signal<Box | null> }) {
  const b = box.value;
  if (b === null) return null;
  return (
    <rect
      x={Math.min(b.x0, b.x1)}
      y={Math.min(b.y0, b.y1)}
      width={Math.abs(b.x1 - b.x0)}
      height={Math.abs(b.y1 - b.y0)}
      fill={MARQUEE_COLOR}
      fill-opacity="0.1"
      stroke={MARQUEE_COLOR}
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  );
}

function Inspect({ stroke, inkOptions }: { stroke: Stroke; inkOptions: InkOptions }) {
  const ns = useMemo(() => {
    const ink = new StrokeInk(stroke, inkOptions);
    ink.whole();
    return ink.fit.nodes;
  }, [stroke, inkOptions]);
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
  const {
    view,
    clock,
    timing,
    inkOptions,
    brushes,
    tool,
    selected,
    setSelected,
    undo,
    redo,
    closingPress,
  } = useApp();
  const replaying = tool === "replay";
  const store = useStrokes();

  const currentStrokeRef = useRef<Stroke | null>(null);
  const strokeInkRef = useRef<StrokeInk | null>(null);
  // the one pointer drawing; every other is ignored by the stroke
  const drawingIdRef = useRef<number | null>(null);
  const drawLoopRef = useRef<number | null>(null);
  const liveInk = useSignal<Drawn | null>(null);
  // where the select press went down, in content and screen px; shift adds to the selection
  const selectRef = useRef<{ x: number; y: number; sx: number; sy: number; add: boolean } | null>(
    null,
  );
  const marquee = useSignal<Box | null>(null);
  // The drawing or selecting press: where and when it went down, whether it has moved, and
  // whether it closed something on the way. A tap that closed something does nothing else.
  const pressRef = useRef<{
    x: number;
    y: number;
    t0: number;
    moved: boolean;
    closing: boolean;
  } | null>(null);

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
    // the drawer closed on this press, or a popover will on its release
    const closing =
      closingPress.current === e.pointerId || document.querySelector(":popover-open") !== null;
    closingPress.current = null;
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
    // Middle-button and Space drags pan, handled by useCanvasView.
    if (e.button !== 0 || drawingIdRef.current !== null || replaying || view.spaceHeld()) return;
    drawingIdRef.current = e.pointerId;
    view.svgRef.current!.setPointerCapture(e.pointerId);
    pressRef.current = { x: e.clientX, y: e.clientY, t0: e.timeStamp, moved: false, closing };
    if (tool === "select") {
      const { x, y } = view.svgToContent(e.clientX, e.clientY);
      selectRef.current = { x, y, sx: e.clientX, sy: e.clientY, add: e.shiftKey };
      return;
    }
    const pt = view.svgToContent(e.clientX, e.clientY);
    const now = eventTime(e);
    // the stroke keeps the view's zoom as the pen goes down
    const stroke: Stroke = {
      points: [{ x: pt.x, y: pt.y, t: now, ...pressure(e) }],
      zoom: view.zoom.peek(),
      style: tool,
      ...brushes[tool],
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
    // held back while it may yet be a closing tap, so the tap doesn't flash a dot
    const press = pressRef.current;
    const maybeTap =
      press !== null && press.closing && !press.moved && performance.now() - press.t0 < TAP_MS;
    liveInk.value = maybeTap ? null : ink.at(timeNow());
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
    if (e.pointerId !== drawingIdRef.current) return;
    const press = pressRef.current;
    if (press !== null && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_PX) {
      press.moved = true;
    }
    const sel = selectRef.current;
    if (sel !== null) {
      if (marquee.value === null && Math.hypot(e.clientX - sel.sx, e.clientY - sel.sy) <= DRAG_PX) {
        return;
      }
      const pt = view.svgToContent(e.clientX, e.clientY);
      marquee.value = { x0: sel.x, y0: sel.y, x1: pt.x, y1: pt.y };
      return;
    }
    const rec = currentStrokeRef.current;
    if (rec === null) return;
    const pt = view.svgToContent(e.clientX, e.clientY);
    rec.points.push({ x: pt.x, y: pt.y, t: eventTime(e), ...pressure(e) });
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
      if (e.pointerId === drawingIdRef.current) release(e);
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
    if (e.pointerId === drawingIdRef.current) release(e);
  }

  // the same tap as two- and three-finger taps: lifted soon, hardly moved
  function closingTap(e: PointerEvent): boolean {
    const press = pressRef.current;
    return press !== null && press.closing && !press.moved && e.timeStamp - press.t0 < TAP_MS;
  }

  function release(e: PointerEvent) {
    if (closingTap(e)) dropStroke();
    else if (selectRef.current === null) commitStroke(e);
    else if (e.type === "pointercancel") dropStroke();
    else finishSelect(e);
  }

  function finishSelect(e: PointerEvent) {
    const sel = selectRef.current!;
    const box = marquee.value;
    selectRef.current = null;
    marquee.value = null;
    drawingIdRef.current = null;
    pressRef.current = null;
    if (box !== null) {
      const hits = strokesInBox(strokes, box);
      setSelected(sel.add ? [...new Set([...selected, ...hits])].sort((a, b) => a - b) : hits);
      return;
    }
    const { x, y } = view.svgToContent(e.clientX, e.clientY);
    const hit = pickStroke(strokes, x, y, PICK_PX / view.zoom.peek(), inkOptions);
    if (!sel.add) setSelected(hit === null ? [] : [hit]);
    else if (hit !== null) {
      setSelected(
        selected.includes(hit)
          ? selected.filter((i) => i !== hit)
          : [...selected, hit].sort((a, b) => a - b),
      );
    }
  }

  function stopDrawing() {
    if (drawLoopRef.current !== null) {
      cancelAnimationFrame(drawLoopRef.current);
      drawLoopRef.current = null;
    }
    drawingIdRef.current = null;
    pressRef.current = null;
  }

  function dropStroke() {
    if (selectRef.current !== null) {
      selectRef.current = null;
      marquee.value = null;
      drawingIdRef.current = null;
      pressRef.current = null;
      return;
    }
    stopDrawing();
    currentStrokeRef.current = null;
    strokeInkRef.current = null;
    liveInk.value = null;
  }

  function commitStroke(e: PointerEvent) {
    const rec = currentStrokeRef.current;
    stopDrawing();
    if (rec === null) return;
    // The pen held until release, so the end dwell is recorded.
    const now = eventTime(e);
    const last = rec.points[rec.points.length - 1];
    rec.points.push({ ...last, t: Math.max(now, last.t) });
    // reuse the finished ink for the committed stroke
    cache.set(rec, strokeInkRef.current!.whole());
    currentStrokeRef.current = null;
    strokeInkRef.current = null;
    liveInk.value = null;
    store.append(rec);
  }

  const strokes = store.strokes.value;
  const cache = useMemo<InkCache>(() => new WeakMap(), [inkOptions]);

  // fixed-size bands, so a replay frame re-renders at most one
  const allEnds = replaying ? timing.value.ends : null;
  const bandsRef = useRef<{ ends: number[] | null; bands: Band[] }>({ ends: null, bands: [] });
  const bands = useMemo(() => {
    const prev = bandsRef.current.ends === allEnds ? bandsRef.current.bands : [];
    const next: Band[] = [];
    for (let i = 0; i < strokes.length; i += INK_CHUNK) {
      const chunk = strokes.slice(i, i + INK_CHUNK);
      const old = prev[next.length];
      if (old && sameStrokes(old.strokes, chunk)) {
        next.push(old);
        continue;
      }
      const ends = allEnds && allEnds.slice(i, i + INK_CHUNK);
      next.push({
        strokes: chunk,
        ends,
        settled: computed(() => (ends === null ? chunk.length : countSettled(ends, clock.elapsed))),
      });
    }
    bandsRef.current = { ends: allEnds, bands: next };
    return next;
  }, [strokes, allEnds]);

  return (
    <svg
      ref={view.svgRef}
      id="canvas-svg"
      class={tool === "select" || tool === "replay" ? tool : ""}
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
            ends={band.ends}
            settled={band.settled}
            elapsed={clock.elapsed}
            inkOptions={inkOptions}
            cache={cache}
          />
        ))}
        {replaying && (
          <ActiveInk
            strokes={strokes}
            offsets={timing.value.offsets}
            elapsed={clock.elapsed}
            inkOptions={inkOptions}
          />
        )}
        <LiveStroke ink={liveInk} />
        {tool === "select" &&
          selected
            .filter((i) => i < strokes.length)
            .map((i) => <Inspect key={i} stroke={strokes[i]} inkOptions={inkOptions} />)}
        <Marquee box={marquee} />
      </g>
    </svg>
  );
}
