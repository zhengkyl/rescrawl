import { Component } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../context';
import type { ActiveStrategy, DebugLayers, InkOptions } from '../curves';
import { getActiveStrategies, INK_COLOR, inkDebug, renderInk, STRATEGY_DEFS } from '../curves';
import { useStrokeCache } from '../hooks/useStrokeCache';
import type { Stroke } from '../utils';
import { strokeEnd, strokeStart } from '../utils';
import { CanvasBackground } from './CanvasBackground';
import { drawLine } from './strokeRender';

const PRESSURE_MAX = 8192;
const INK_CHUNK = 128; // strokes per settled band

type InkCache = ReturnType<typeof useStrokeCache>;

// A band of committed strokes, rendering only those settled (fully drawn) at the
// playhead from cached geometry. `shouldComponentUpdate` keyed on `stamp` (how
// many of the band's strokes are settled) skips re-rendering on the frames where
// no stroke in this band crossed the playhead — so a replay frame rebuilds at
// most the one band a stroke just crossed, not the whole scene, which is what was
// drowning the cycle collector. `strokes` is compared by content so committing a
// stroke only rebuilds the band that changed, not every band.
class InkChunk extends Component<{ strokes: Stroke[]; drawTime: number; inkOptions: InkOptions; cache: InkCache; stamp: number }> {
  shouldComponentUpdate(next: InkChunk['props']) {
    const p = this.props;
    if (p.stamp !== next.stamp || p.inkOptions !== next.inkOptions || p.cache !== next.cache) return true;
    if (p.strokes === next.strokes) return false;
    if (p.strokes.length !== next.strokes.length) return true;
    for (let i = 0; i < p.strokes.length; i++) if (p.strokes[i] !== next.strokes[i]) return true;
    return false;
  }
  render() {
    const { strokes, drawTime, inkOptions, cache } = this.props;
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
function OverlayStrategy({ def, param, strokes, drawTime, inkOptions, debug, cache }: {
  def: ActiveStrategy['def'];
  param: number;
  strokes: Stroke[];
  drawTime: number;
  inkOptions: InkOptions;
  debug: DebugLayers;
  cache: ReturnType<typeof useStrokeCache>;
}) {
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
          strokeStart(s) <= drawTime && strokeEnd(s) > drawTime
            ? (isDebug
              ? drawDebug(s, inkOptions, drawTime, i, debug)
              : drawLine(def.render(s, param, drawTime), i, def.color))
            : null,
        )}
      </g>
    </g>
  );
}

// The drawing surface: records pointer input into strokes and renders the live
// preview plus all committed strokes. Everything it touches comes from context.
export function App() {
  const { store, view, replay, live, inkOptions, setInkOptions, strategies, debug, config } = useApp();

  // In-progress stroke: `currentStrokeRef` is the authoritative builder (read on
  // commit); `livePoints` mirrors it for rendering through the active strategies.
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);
  const drawLoopRef = useRef<number | null>(null);
  const [livePoints, setLivePoints] = useState<Stroke | null>(null);

  // Stop the draw loop if we unmount mid-stroke.
  useEffect(() => () => { if (drawLoopRef.current !== null) cancelAnimationFrame(drawLoopRef.current); }, []);

  // When the grace period lapses and live mode ends, leave the playhead at the
  // live end (current time, including the banked grace) instead of letting it
  // snap back to the last stroke's end. The timeline then keeps showing both the
  // current time (playhead) and the tentative replay/export end (marker), and the
  // next stroke resumes from here — preserving the inter-stroke gap. This runs in
  // a layout effect so the seek lands before paint: otherwise the render where
  // `isLive` just flipped false paints the playhead back at the committed end for
  // one frame (a visible snap) before the seek catches it up.
  const wasLiveRef = useRef(false);
  useLayoutEffect(() => {
    if (wasLiveRef.current && !live.isLive) replay.seek(live.now());
    wasLiveRef.current = live.isLive;
  }, [live.isLive]);

  // --- Pointer / drawing ---

  function handlePointerDown(e: PointerEvent) {
    // Middle-button drag is the pan gesture, handled by useCanvasView.
    if (e.button !== 0 || replay.isPlaying) return;

    view.svgRef.current!.setPointerCapture(e.pointerId);

    // Detect the input device and, when it changes, switch how pressure is
    // sourced: pens report real pressure; mouse/touch don't, so simulate it from
    // stroke timings (pressureFromTime). Only react to a *change* so a manual
    // toggle of the option still sticks while the same device is in use.
    if (e.pointerType !== lastPointerTypeRef.current) {
      lastPointerTypeRef.current = e.pointerType;
      const fromTime = e.pointerType !== 'pen';
      if (fromTime !== inkOptions.pressureFromTime) setInkOptions({ ...inkOptions, pressureFromTime: fromTime });
    }

    // A fresh recording session records from the playhead, so seed the live
    // clock to it; continuing within a session (during grace) keeps the clock.
    // After a long pause the playhead already sits at the live end (see the
    // live-end effect below), so this seed carries the capped grace as the gap
    // before the new stroke.
    if (!live.isLive) live.reset(replay.elapsed);
    replay.seek(replay.elapsed); // leave replay-clip mode so the canvas shows fully

    const pt = view.svgToContent(e.clientX, e.clientY);
    live.strokeStarted();
    currentStrokeRef.current = [{ x: pt.x, y: pt.y, t: live.now(), p: Math.round(e.pressure * PRESSURE_MAX) }];
    drawFrame(); // renders the live stroke + starts the dwell loop
  }

  // While the pointer is down, re-render the in-progress stroke every frame with
  // a trailing "tip" point at (last position, now). The advancing tip timestamp
  // is how dwell grows a held dot / pools a pause, with no pointer events firing.
  function drawFrame() {
    const rec = currentStrokeRef.current;
    if (rec === null) { drawLoopRef.current = null; return; }
    const last = rec[rec.length - 1];
    setLivePoints([...rec, { x: last.x, y: last.y, t: live.now(), p: last.p }]);
    drawLoopRef.current = requestAnimationFrame(drawFrame);
  }

  function handlePointerMove(e: PointerEvent) {
    if (currentStrokeRef.current === null) return;

    const pt = view.svgToContent(e.clientX, e.clientY);

    // Record distinct positions only; the draw loop handles rendering + dwell.
    currentStrokeRef.current.push({ x: pt.x, y: pt.y, t: live.now(), p: Math.round(e.pressure * PRESSURE_MAX) });
  }

  function commitStroke() {
    const rec = currentStrokeRef.current;
    if (rec === null) return;
    if (drawLoopRef.current !== null) { cancelAnimationFrame(drawLoopRef.current); drawLoopRef.current = null; }
    // Capture the pointer-up point (final position + release time) so every
    // stroke has >= 2 points and the end dwell is recorded.
    const last = rec[rec.length - 1];
    const endT = live.now();
    const stroke: Stroke = [...rec, { x: last.x, y: last.y, t: endT, p: 0 }];
    currentStrokeRef.current = null;
    setLivePoints(null);
    store.draw(stroke);
    replay.seek(endT); // rest the playhead at the end of the just-drawn stroke
    live.strokeEnded();
  }

  // --- Derived render data ---

  const { strokes, selectedStroke, insertionPoint } = store;
  const activeStrategies = useMemo(() => getActiveStrategies(strategies), [strategies]);
  const primaryStrategy: ActiveStrategy = activeStrategies[0] ?? { def: STRATEGY_DEFS[0], param: 0 };

  // Renderers draw each stroke "as of" this time; the playhead during replay,
  // otherwise fully drawn. Only clip when the playhead is genuinely mid-timeline:
  // at/past the end means "fully drawn", which also avoids a one-frame clip of a
  // freshly drawn stroke (elapsed/duration update a render later, via an effect).
  const drawTime = replay.isReplaying && replay.elapsed < replay.duration ? replay.elapsed : Infinity;

  // Ink is the always-on base layer; reference curves draw on top. Geometry is
  // cached per stroke (keyed by identity) so it's computed once, not per frame.
  const inkCache = useStrokeCache(inkOptions);
  const overlayCache = useStrokeCache(activeStrategies);

  // Render committed strokes as fixed-size bands so a replay frame only rebuilds
  // the one band a stroke just crossed (see InkChunk), not the whole scene — that
  // per-frame rebuild was saturating the cycle collector. The 0–few strokes
  // straddling the playhead are rebuilt live each frame; later strokes are culled.
  const inkChunks = useMemo(() => {
    const cs: Stroke[][] = [];
    for (let i = 0; i < strokes.length; i += INK_CHUNK) cs.push(strokes.slice(i, i + INK_CHUNK));
    return cs;
  }, [strokes]);
  const settledInk = inkChunks.map((chunk, ci) => {
    let stamp = 0;
    for (const s of chunk) if (strokeEnd(s) <= drawTime) stamp++;
    return <InkChunk key={ci} strokes={chunk} drawTime={drawTime} inkOptions={inkOptions} cache={inkCache} stamp={stamp} />;
  });
  const activeInk = (
    <g>
      {strokes.map((s, i) =>
        strokeStart(s) <= drawTime && strokeEnd(s) > drawTime
          ? drawLine(renderInk(s, inkOptions, drawTime), i, INK_COLOR)
          : null,
      )}
    </g>
  );
  const overlayLayer = activeStrategies.map(({ def, param }) => (
    <OverlayStrategy key={def.id} def={def} param={param} strokes={strokes}
      drawTime={drawTime} inkOptions={inkOptions} debug={debug} cache={overlayCache} />
  ));

  const crosshairPos = insertionPoint < strokes.length ? strokes[insertionPoint][0] : null;

  return (
    <svg
      ref={view.svgRef}
      id="canvas-svg"
      class={live.isLive ? 'live' : ''}
      onPointerDown={handlePointerDown as any}
      onPointerMove={handlePointerMove as any}
      onPointerUp={commitStroke}
      onPointerCancel={commitStroke}
      // stylus long press
      onContextMenu={(e) => e.preventDefault()}
    >
      <g ref={view.viewportRef}>
        <CanvasBackground guidelines={config.guidelines} />

        {/* Committed strokes: settled (cached) + the strokes straddling the
            playhead, ink base then overlay curves */}
        {settledInk}
        {activeInk}
        {overlayLayer}

        {/* Selected stroke highlight */}
        {!replay.isReplaying && selectedStroke !== null && strokes[selectedStroke] && (
          <g>{drawLine(primaryStrategy.def.render(strokes[selectedStroke], primaryStrategy.param, Infinity), 'sel', '#4f8ef7')}</g>
        )}

        {/* In-progress stroke — ink base plus any active overlay curves */}
        {livePoints && (
          <>
            <g>{drawLine(renderInk(livePoints, inkOptions, Infinity, true), 'live-ink', INK_COLOR)}</g>
            {activeStrategies.map(({ def, param }) => (
              <g key={`live-${def.id}`}>
                {def.id === 'debug'
                  ? drawDebug(livePoints, inkOptions, Infinity, 'live-dbg', debug)
                  : drawLine(def.render(livePoints, param, Infinity), 'live', def.color)}
              </g>
            ))}
          </>
        )}

        {/* Insertion crosshair */}
        {crosshairPos && (
          <g>
            <line x1={crosshairPos.x - 12} y1={crosshairPos.y} x2={crosshairPos.x + 12} y2={crosshairPos.y}
              stroke="#4f8ef7" stroke-width="1.5" stroke-dasharray="3 3" />
            <line x1={crosshairPos.x} y1={crosshairPos.y - 12} x2={crosshairPos.x} y2={crosshairPos.y + 12}
              stroke="#4f8ef7" stroke-width="1.5" stroke-dasharray="3 3" />
          </g>
        )}
      </g>
    </svg>
  );
}
