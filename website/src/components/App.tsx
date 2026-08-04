import { Component } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../context';
import type { ActiveStrategy, DebugLayers, InkOptions } from '../curves';
import { getActiveStrategies, INK_COLOR, inkDebug, renderInk, STRATEGY_DEFS } from '../curves';
import { useStrokeCache } from '../hooks/useStrokeCache';
import type { Stroke } from '../utils';
import { activeStrokeAt, strokeEnd, withinStroke } from '../utils';
import { CanvasBackground } from './CanvasBackground';
import { drawLine } from './strokeRender';

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

// The drawing surface: records pointer input into strokes and renders the live
// preview plus all committed strokes. Everything it touches comes from context.
export function App() {
  const { store, view, clock, inkOptions, strategies, debug, config } = useApp();

  // In-progress stroke: `currentStrokeRef` is the authoritative builder (read on
  // commit); `livePoints` mirrors it for rendering through the active strategies.
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawLoopRef = useRef<number | null>(null);
  const [livePoints, setLivePoints] = useState<Stroke | null>(null);

  // Stop the draw loop if we unmount mid-stroke.
  useEffect(() => () => { if (drawLoopRef.current !== null) cancelAnimationFrame(drawLoopRef.current); }, []);

  // --- Pointer / drawing ---

  function handlePointerDown(e: PointerEvent) {
    // Middle-button drag is the pan gesture, handled by useCanvasView.
    if (e.button !== 0 || clock.isPlaying) return;

    view.svgRef.current!.setPointerCapture(e.pointerId);

    // Records from wherever the playhead sits. Starting a stroke during the grace
    // period continues the running clock, so the gap is real; after the idle cap
    // fired the playhead is already parked at the capped end, which becomes the
    // gap before this stroke.
    clock.startRecording();

    const pt = view.svgToContent(e.clientX, e.clientY);
    clock.penDown();
    currentStrokeRef.current = [{ x: pt.x, y: pt.y, t: clock.now() }];
    drawFrame(); // renders the live stroke + starts the dwell loop
  }

  // While the pointer is down, re-render the in-progress stroke every frame with
  // a trailing "tip" point at (last position, now). The advancing tip timestamp
  // is how dwell grows a held dot / pools a pause, with no pointer events firing.
  function drawFrame() {
    const rec = currentStrokeRef.current;
    if (rec === null) { drawLoopRef.current = null; return; }
    const last = rec[rec.length - 1];
    setLivePoints([...rec, { x: last.x, y: last.y, t: clock.now() }]);
    drawLoopRef.current = requestAnimationFrame(drawFrame);
  }

  function handlePointerMove(e: PointerEvent) {
    const rec = currentStrokeRef.current;
    if (rec === null) return;

    const pt = view.svgToContent(e.clientX, e.clientY);
    const t = clock.now();

    // Freeze the pen's dwell at the previous position before recording the new
    // one. This is what makes time belong to the gap between two samples rather
    // than to a sample itself, so the renderer reads a node's dwell straight off
    // the next node's timestamp. It commits what the draw-loop tip only rendered.
    const last = rec[rec.length - 1];
    rec.push({ x: last.x, y: last.y, t });
    rec.push({ x: pt.x, y: pt.y, t });
  }

  function commitStroke() {
    const rec = currentStrokeRef.current;
    if (rec === null) return;
    if (drawLoopRef.current !== null) { cancelAnimationFrame(drawLoopRef.current); drawLoopRef.current = null; }
    // Capture the pointer-up point (final position + release time) so every
    // stroke has >= 2 points and the end dwell is recorded.
    const last = rec[rec.length - 1];
    const stroke: Stroke = [...rec, { x: last.x, y: last.y, t: clock.now() }];
    currentStrokeRef.current = null;
    setLivePoints(null);
    store.draw(stroke);
    // The playhead keeps running through the grace period, so the gap before the
    // next stroke is real time; the idle cap parks it if the grace runs out.
    clock.penUp();
  }

  // --- Derived render data ---

  const { strokes, insertionPoint } = store;
  const activeStrategies = useMemo(() => getActiveStrategies(strategies), [strategies]);
  const primaryStrategy: ActiveStrategy = activeStrategies[0] ?? { def: STRATEGY_DEFS[0], param: 0 };

  // The stroke under the playhead — highlighted while reviewing (not recording)
  // so it's clear which stroke the current time belongs to.
  const activeStroke = clock.isRecording ? null : activeStrokeAt(strokes, clock.elapsed);

  // Renderers draw each stroke "as of" the playhead — the canvas is a viewport
  // onto time, so nothing later than this is visible. `elapsed` is live in every
  // mode (the replay and recording loops both drive it), so no clock read here.
  const drawTime = clock.elapsed;

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
        withinStroke(s, drawTime)
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
      class={clock.isRecording ? 'live' : ''}
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

        {/* Active stroke highlight (under the playhead, while not recording) */}
        {activeStroke !== null && strokes[activeStroke] && (
          <g>{drawLine(primaryStrategy.def.render(strokes[activeStroke], primaryStrategy.param, drawTime), 'active', '#4f8ef7')}</g>
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
