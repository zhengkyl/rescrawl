import type { ReadonlySignal, Signal } from '@preact/signals';
import { computed, useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useApp } from '../context';
import type { ActiveStrategy, DebugLayers, InkOptions, StagePick } from '../curves';
import { DEBUG_STAGES, getActiveStrategies, hasRadiusLayer, INK_COLOR, inkStages, pickStagePoint, renderInk, STRATEGY_DEFS, strokeStages } from '../curves';
import { useStrokeCache } from '../hooks/useStrokeCache';
import { useStrokes } from '../strokeStore';
import type { Stroke } from '../utils';
import { activeStrokeAt, strokeEnd, withinStroke } from '../utils';
import { drawLine } from './strokeRender';

const INK_CHUNK = 128; // strokes per settled band
const HOVER_PX = 14; // how close, in screen px, the cursor must come to read a radius

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

// The stage point under the cursor, plus where the cursor was (in viewport px,
// which is what the label is positioned in).
type HoverPick = StagePick & { sx: number; sy: number };

// True if any raw sample of `s` is within `pad` of the cursor. The cheap reject
// in front of the hover hit test: a move over empty canvas costs a scan of
// coordinates instead of a run of the pipeline.
function nearCursor(s: Stroke, x: number, y: number, pad: number): boolean {
  for (const p of s) if (Math.abs(p.x - x) < pad && Math.abs(p.y - y) < pad) return true;
  return false;
}

// The picked circle, redrawn heavy in its stage's colour, plus a dot at its
// centre — a zero-length round-capped path, so the dot stays the same size on
// screen at any zoom while the ring tracks the real radius. Inside the canvas
// transform. Reads the signal, so a hover repaints this alone.
function HoverRing({ hover }: { hover: Signal<HoverPick | null> }) {
  const h = hover.value;
  if (h === null) return null;
  return (
    <g>
      <circle cx={h.x} cy={h.y} r={h.r} fill="none" stroke={h.color}
        stroke-width="2.5" vector-effect="non-scaling-stroke" />
      <path d={`M${h.x} ${h.y}h0`} stroke={h.color} stroke-width="5"
        stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </g>
  );
}

// The readout itself: radius and the gap to the next point of that stage, over
// the stage it came from. Outside the canvas transform, so
// it stays 13px whatever the zoom, and haloed rather than boxed so it reads over
// both white paper and dark ink.
function HoverLabel({ hover }: { hover: Signal<HoverPick | null> }) {
  const h = hover.value;
  if (h === null) return null;
  const halo = { stroke: 'rgba(0,0,0,0.85)', 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' } as const;
  // Sits above the cursor, except near the top edge, where there is no room.
  const below = h.sy < 34;
  return (
    <g transform={`translate(${h.sx},${h.sy})`}>
      <text x="14" y={below ? 20 : -15} font-size="13" fill="#fff" {...halo}>
        {`r ${h.r.toFixed(2)} · dt ${h.dt.toFixed(1)}ms`}
      </text>
      <text x="14" y={below ? 34 : -1} font-size="11" fill={h.color} {...halo}>{h.label}</text>
    </g>
  );
}

// Debug overlay for one ink stroke. Each pipeline stage is its own circle layer:
// the two stages before a radius exists are fixed-size dots, nested largest-first
// so they don't hide each other, and every stage after draws each point at its
// own radius — see DEBUG_STAGES for the order and colours. On top of those:
// hollow circles at the final radii (what the outline is actually wrapped
// around), the centerline curve, and a marker at every outline contact point.
function drawDebug(stroke: Stroke, options: InkOptions, t: number, key: string | number, layers: DebugLayers) {
  const { curve, spline, outline, stages } = inkStages(stroke, options, t);
  return (
    <g key={key}>
      {layers.circles && stages.simplified.map((p, j) => (
        <circle key={`c${j}`} cx={p.x} cy={p.y} r={p.r} fill="none"
          stroke="#3b82f6" stroke-width="0.5" stroke-opacity="0.5" vector-effect="non-scaling-stroke" />
      ))}
      {layers.centerline && <path d={curve} stroke="#3b82f6" stroke-width="1" fill="none" vector-effect="non-scaling-stroke" />}
      {layers.splineCurve && <path d={spline} stroke="#06b6d4" stroke-width="1" fill="none" vector-effect="non-scaling-stroke" />}
      {DEBUG_STAGES.map(({ key: k, color, dot }) => layers[k] && (
        <g key={k}>
          {stages[k].map((p, j) => (
            <circle key={j} cx={p.x} cy={p.y} r={'r' in p ? p.r : dot} fill="none"
              stroke={color} stroke-width="1" vector-effect="non-scaling-stroke" />
          ))}
        </g>
      ))}
      {layers.outline && outline.map((p, j) => <circle key={`o${j}`} cx={p.x} cy={p.y} r="1.2" fill="#ef4444" />)}
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

  // Radius readout: the stage point under the cursor. A signal, so tracking the
  // pointer re-renders the ring and the label alone rather than the canvas.
  const hover = useSignal<HoverPick | null>(null);

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
    const now = clock.getElapsedFromTs(e.timeStamp)
    hover.value = null;
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
    livePoints.value = [...rec, { x: last.x, y: last.y, t: clock.getElapsed() }];
    drawLoopRef.current = requestAnimationFrame(drawFrame);
  }

  function handlePointerMove(e: PointerEvent) {
    const rec = currentStrokeRef.current;
    if (rec === null) { updateHover(e); return; }

    const pt = view.svgToContent(e.clientX, e.clientY);
    const last = rec[rec.length - 1];
    // ignore non-movement updates (e.g. pens)
    if (pt.x === last.x && pt.y === last.y) return;

    const t = clock.getElapsedFromTs(e.timeStamp);
    rec.push({ x: pt.x, y: pt.y, t });
  }

  function commitStroke(e: PointerEvent) {
    const rec = currentStrokeRef.current;
    if (rec === null) return;
    if (drawLoopRef.current !== null) { cancelAnimationFrame(drawLoopRef.current); drawLoopRef.current = null; }
    // Capture the pointer-up point (final position + release time) so every
    // stroke has >= 2 points and the end dwell is recorded.
    const now = clock.getElapsedFromTs(e.timeStamp)

    const last = rec[rec.length - 1];
    const stroke: Stroke = [...rec, { x: last.x, y: last.y, t: now }];
    currentStrokeRef.current = null;
    livePoints.value = null;
    store.append(stroke);
    clock.penUp(now);
  }

  // --- Radius readout ---

  // With the debug overlay up, the stage circle nearest the cursor reports its
  // radius. Hit-tested in JS rather than off the DOM: the overlay is
  // `pointer-events: none` (see style.css) so the browser never hit-tests the
  // thousands of circles it draws, and picking the nearest CENTRE reads a
  // stack of nested circles better than picking whatever is painted on top.
  function updateHover(e: PointerEvent) {
    if (!hoverOn) return;
    const { x, y } = view.svgToContent(e.clientX, e.clientY);
    const t = clock.elapsed.peek();
    // The overlay's stages are recomputed here rather than cached, exactly as
    // the overlay itself does — one pipeline run per stroke that passes the
    // reject below, which in practice is the one under the cursor.
    let reach = HOVER_PX / view.zoom.peek();
    const pad = reach + inkOptions.maxWidth;
    const rect = view.svgRef.current!.getBoundingClientRect();
    let best: HoverPick | null = null;
    for (const s of strokes) {
      if (s[0].t > t || !nearCursor(s, x, y, pad)) continue;
      const hit = pickStagePoint(strokeStages(s, inkOptions, t), debug, x, y, reach);
      if (hit === null) continue;
      // Every later stroke now has to beat this one to take the readout.
      reach = hit.d;
      best = { ...hit, sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    }
    hover.value = best;
  }

  // --- Derived render data ---

  // The document, not the capture: what is drawn is what a file would hold.
  const strokes = store.strokes.value;
  const activeStrategies = useMemo(() => getActiveStrategies(strategies), [strategies]);
  const primaryStrategy: ActiveStrategy = activeStrategies[0] ?? { def: STRATEGY_DEFS[0], param: 0 };

  // The readout only exists where its circles do: debug overlay on, and at least
  // one layer that carries a radius. Anything that can move the ink out from
  // under a parked cursor (playback, or the layers going away) drops it, since
  // nothing else will fire until the pointer moves again.
  const hoverOn = activeStrategies.some(({ def }) => def.id === 'debug') && hasRadiusLayer(debug);
  useEffect(() => {
    if (!hoverOn || clock.isPlaying) hover.value = null;
  }, [hoverOn, clock.isPlaying]);

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
      onPointerLeave={() => { hover.value = null; }}
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

        {/* Radius readout: the ring rides the canvas, the label rides the cursor */}
        <HoverRing hover={hover} />
      </g>
      <HoverLabel hover={hover} />
    </svg>
  );
}
