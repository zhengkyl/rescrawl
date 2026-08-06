import type { ReadonlySignal, Signal } from '@preact/signals';
import { computed, useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useApp } from '../context';
import type { ActiveStrategy, DebugLayers, InkOptions } from '../curves';
import { getActiveStrategies, INK_COLOR, inkDebug, renderInk, STRATEGY_DEFS } from '../curves';
import { useStrokeCache } from '../hooks/useStrokeCache';
import { useStrokes } from '../strokeStore';
import type { Stroke } from '../utils';
import { activeStrokeAt, strokeEnd, withinStroke } from '../utils';
import { drawLine } from './strokeRender';

const INK_CHUNK = 128; // strokes per settled band

// Threshold between pointermove events before record as hold
const MIN_HOLD_MS = 100;
// Best guess of pointermove timespan after a hold: 16ms / 2
const TRAVEL_MS = 8;

type InkCache = ReturnType<typeof useStrokeCache>;

// A band of committed strokes plus a computed for how many of them are settled
// (fully drawn) at the playhead. Computeds only notify when their value actually
// changes, so the count is the band's wake-up signal: it fires on the frames a
// stroke in this band crosses the playhead, and stays silent on every other one.
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

// One band's settled strokes, drawn from cached geometry. Reading `settled.value`
// is the entire subscription — signals auto-memoise a component that reads them,
// so this re-renders when its own count changes (or its strokes/ink options do)
// and sits out every other frame. The playhead is read with `peek` so it is
// deliberately *not* a dependency: which strokes are settled can only change when
// the count does, so the count is what decides a fresh read is needed.
function InkBand({ strokes, settled, elapsed, inkOptions, cache }: Band & {
  elapsed: Signal<number>;
  inkOptions: InkOptions;
  cache: InkCache;
}) {
  if (settled.value === 0) return null;
  const drawTime = elapsed.peek();
  return (
    <g>
      {strokes.map((s, j) =>
        strokeEnd(s) <= drawTime
          ? drawLine(cache.get(s, '', () => renderInk(s, inkOptions, Infinity)), j, INK_COLOR)
          : null,
      )}
    </g>
  );
}

// The 0–few strokes straddling the playhead — the only ink whose shape changes
// per frame, so it reads the playhead directly and is what re-renders with it.
function ActiveInk({ strokes, elapsed, inkOptions }: {
  strokes: Stroke[];
  elapsed: Signal<number>;
  inkOptions: InkOptions;
}) {
  const drawTime = elapsed.value;
  return (
    <g>
      {strokes.map((s, i) =>
        withinStroke(s, drawTime)
          ? drawLine(renderInk(s, inkOptions, drawTime), i, INK_COLOR)
          : null,
      )}
    </g>
  );
}

// The stroke under the playhead — highlighted while idle so
// it's clear which stroke the current time belongs to. Its own component so the
// per-frame read stays out of <App>, and so it keeps painting over the overlays.
function ActiveHighlight({ strokes, elapsed, isIdle, primary }: {
  strokes: Stroke[];
  elapsed: Signal<number>;
  isIdle: boolean;
  primary: ActiveStrategy;
}) {
  const drawTime = elapsed.value;
  const active = !isIdle ? null : activeStrokeAt(strokes, drawTime);
  if (active === null || !strokes[active]) return null;
  return <g>{drawLine(primary.def.render(strokes[active], primary.param, drawTime), 'active', '#4f8ef7')}</g>;
}

// Debug overlay for one ink stroke, each layer independently toggleable: the
// cubic centerline (blue), a marker at every outline (offset) point (red), and
// the raw recorded input positions the curve is fitted to (green, hollow).
function drawDebug(stroke: Stroke, options: InkOptions, t: number, key: string | number, layers: DebugLayers) {
  const { curve, points, dots } = inkDebug(stroke, options, t);
  return (
    <g key={key}>
      {layers.centerline && <path d={curve} stroke="#3b82f6" stroke-width="1" fill="none" vector-effect="non-scaling-stroke" />}
      {layers.offsets && points.map((p, j) => <circle key={`o${j}`} cx={p.x} cy={p.y} r="1.2" fill="#ef4444" />)}
      {layers.dots && dots.map((p, j) => (
        <circle key={`d${j}`} cx={p.x} cy={p.y} r="2.5" fill="none"
          stroke="#10b981" stroke-width="1" vector-effect="non-scaling-stroke" />
      ))}
    </g>
  );
}

// One reference-curve (or debug) overlay, split into a settled layer (strokes
// fully drawn at the playhead — cached geometry, stable vnodes, memoised on the
// settled count) and an active layer (the 0–few strokes straddling the playhead,
// rebuilt per frame). Strokes after the playhead are culled. Mirrors the ink
// layer so an overlay doesn't reintroduce the per-frame "rebuild every stroke".
function OverlayStrategy({ def, param, strokes, elapsed, inkOptions, debug, cache }: {
  def: ActiveStrategy['def'];
  param: number;
  strokes: Stroke[];
  elapsed: Signal<number>;
  inkOptions: InkOptions;
  debug: DebugLayers;
  cache: ReturnType<typeof useStrokeCache>;
}) {
  const drawTime = elapsed.value;
  const isDebug = def.id === 'debug';
  const settledCount = strokes.reduce((n, s) => n + (strokeEnd(s) <= drawTime ? 1 : 0), 0);
  const settled = useMemo(
    () => (
      <g>
        {strokes.map((s, i) => {
          if (strokeEnd(s) > drawTime) return null;
          // Debug geometry depends on ink options + layers (not cacheable); curve
          // strategies are independent of ink options, so they're cached.
          return isDebug
            ? drawDebug(s, inkOptions, Infinity, i, debug)
            : drawLine(cache.get(s, def.id, () => def.render(s, param, Infinity)), i, def.color);
        })}
      </g>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strokes, inkOptions, debug, def, param, isDebug, settledCount],
  );
  return (
    <g>
      {settled}
      <g>
        {strokes.map((s, i) =>
          withinStroke(s, drawTime)
            ? (isDebug
              ? drawDebug(s, inkOptions, drawTime, i, debug)
              : drawLine(def.render(s, param, drawTime), i, def.color))
            : null,
        )}
      </g>
    </g>
  );
}

// The in-progress stroke — ink base plus any active overlay curves, all drawn in
// full (`Infinity`) since it exists only up to the live head. Rebuilt from
// scratch on every frame the pen is down, so it owns that read and keeps <App>
// (and with it the committed bands) out of the drawing loop.
function LiveStroke({ points, inkOptions, strategies, debug }: {
  points: Signal<Stroke | null>;
  inkOptions: InkOptions;
  strategies: ActiveStrategy[];
  debug: DebugLayers;
}) {
  const live = points.value;
  if (live === null) return null;
  return (
    <>
      <g>{drawLine(renderInk(live, inkOptions, Infinity), 'live-ink', INK_COLOR)}</g>
      {strategies.map(({ def, param }) => (
        <g key={`live-${def.id}`}>
          {def.id === 'debug'
            ? drawDebug(live, inkOptions, Infinity, 'live-dbg', debug)
            : drawLine(def.render(live, param, Infinity), 'live', def.color)}
        </g>
      ))}
    </>
  );
}

// The drawing surface: records pointer input into strokes and renders the live
// preview plus all committed strokes. Everything it touches comes from context.
export function App() {
  const { view, clock, inkOptions, strategies, debug, config } = useApp();
  const store = useStrokes();

  // In-progress stroke: `currentStrokeRef` is the authoritative builder (read on
  // commit); `livePoints` mirrors it for rendering through the active strategies.
  // A signal, not state, so the per-frame rewrite while the pen is down re-renders
  // <LiveStroke> alone instead of this whole component.
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawLoopRef = useRef<number | null>(null);
  const livePoints = useSignal<Stroke | null>(null);

  // Stop the draw loop if we unmount mid-stroke.
  useEffect(() => () => { if (drawLoopRef.current !== null) cancelAnimationFrame(drawLoopRef.current); }, []);

  // --- Pointer / drawing ---

  function handlePointerDown(e: PointerEvent) {
    // Middle-button drag is the pan gesture, handled by useCanvasView.
    if (e.button !== 0 || clock.isPlaying) return;

    if (currentStrokeRef.current !== null) return;

    view.svgRef.current!.setPointerCapture(e.pointerId);

    if (clock.isIdle) {
      clock.startRecording(e.timeStamp);
    }

    const pt = view.svgToContent(e.clientX, e.clientY);
    const now = clock.nowFromTs(e.timeStamp)
    clock.penDown(now);
    currentStrokeRef.current = [{ x: pt.x, y: pt.y, t: now }];
    drawFrame(); // renders the live stroke + starts the dwell loop
  }

  // While the pointer is down, re-render the in-progress stroke every frame with
  // a trailing "tip" point at (last position, now).
  function drawFrame() {
    const rec = currentStrokeRef.current;
    if (rec === null) { drawLoopRef.current = null; return; }
    const last = rec[rec.length - 1];
    livePoints.value = [...rec, { x: last.x, y: last.y, t: clock.now() }];
    drawLoopRef.current = requestAnimationFrame(drawFrame);
  }

  function handlePointerMove(e: PointerEvent) {
    const rec = currentStrokeRef.current;
    if (rec === null) return;

    const pt = view.svgToContent(e.clientX, e.clientY);
    const last = rec[rec.length - 1];
    // some pens report non movement, ignore to use same hold logic as mouse
    if (pt.x === last.x && pt.y === last.y) return;

    // split gap since last point into hold, then move
    const t = clock.nowFromTs(e.timeStamp);
    const moveStart = t - TRAVEL_MS
    if (moveStart - last.t >= MIN_HOLD_MS) {
      rec.push({ x: last.x, y: last.y, t: moveStart });
    }

    rec.push({ x: pt.x, y: pt.y, t });
  }

  function commitStroke(e: PointerEvent) {
    const rec = currentStrokeRef.current;
    if (rec === null) return;
    if (drawLoopRef.current !== null) { cancelAnimationFrame(drawLoopRef.current); drawLoopRef.current = null; }
    // Capture the pointer-up point (final position + release time) so every
    // stroke has >= 2 points and the end dwell is recorded.
    const now = clock.nowFromTs(e.timeStamp)

    const last = rec[rec.length - 1];
    const stroke: Stroke = [...rec, { x: last.x, y: last.y, t: now }];
    currentStrokeRef.current = null;
    livePoints.value = null;
    store.append(stroke);
    clock.penUp(now);
  }

  // --- Derived render data ---

  const strokes = store.strokes.value;
  const activeStrategies = useMemo(() => getActiveStrategies(strategies), [strategies]);
  const primaryStrategy: ActiveStrategy = activeStrategies[0] ?? { def: STRATEGY_DEFS[0], param: 0 };

  // Ink is the always-on base layer; reference curves draw on top. Geometry is
  // cached per stroke (keyed by identity) so it's computed once, not per frame.
  const inkCache = useStrokeCache(inkOptions);
  const overlayCache = useStrokeCache(activeStrategies);

  // Committed strokes in fixed-size bands, so a replay frame re-renders at most
  // the one band a stroke just crossed rather than the whole scene — that
  // per-frame rebuild was saturating the cycle collector. Bands whose contents
  // survive a rebuild keep their identity (and their computed), so committing a
  // stroke only re-renders the band that changed. Note that <App> itself never
  // reads the playhead: every per-frame reader below is its own component.
  const bandsRef = useRef<Band[]>([]);
  const bands = useMemo(() => {
    const prev = bandsRef.current;
    const next: Band[] = [];
    for (let i = 0; i < strokes.length; i += INK_CHUNK) {
      const chunk = strokes.slice(i, i + INK_CHUNK);
      const old = prev[next.length];
      next.push(old && sameStrokes(old.strokes, chunk)
        ? old
        : { strokes: chunk, settled: computed(() => countSettled(chunk, clock.elapsed)) });
    }
    bandsRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);
  const overlayLayer = activeStrategies.map(({ def, param }) => (
    <OverlayStrategy key={def.id} def={def} param={param} strokes={strokes}
      elapsed={clock.elapsed} inkOptions={inkOptions} debug={debug} cache={overlayCache} />
  ));

  return (
    <svg
      ref={view.svgRef}
      id="canvas-svg"
      class={clock.isRecording ? 'live' : ''}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={commitStroke}
      onPointerCancel={commitStroke}
      // stylus long press
      onContextMenu={(e) => e.preventDefault()}
    >
      <g transform={view.transform}>

        {/* Committed strokes: settled (cached) + the strokes straddling the
            playhead, ink base then overlay curves */}
        {bands.map((band, ci) => (
          <InkBand key={ci} strokes={band.strokes} settled={band.settled}
            elapsed={clock.elapsed} inkOptions={inkOptions} cache={inkCache} />
        ))}
        <ActiveInk strokes={strokes} elapsed={clock.elapsed} inkOptions={inkOptions} />
        {overlayLayer}

        {/* Active stroke highlight (under the playhead, while not recording) */}
        <ActiveHighlight strokes={strokes} elapsed={clock.elapsed}
          isIdle={clock.isIdle} primary={primaryStrategy} />

        {/* In-progress stroke */}
        <LiveStroke points={livePoints} inkOptions={inkOptions}
          strategies={activeStrategies} debug={debug} />
      </g>
    </svg>
  );
}
