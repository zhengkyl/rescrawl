import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../context';
import type { ActiveStrategy, DebugLayers, InkOptions } from '../curves';
import { getActiveStrategies, INK_COLOR, inkDebug, renderInk, STRATEGY_DEFS } from '../curves';
import type { Stroke } from '../utils';
import { CanvasBackground } from './CanvasBackground';
import { drawLine } from './strokeRender';

const PRESSURE_MAX = 8192;

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

  // --- Pointer / drawing ---

  function handlePointerDown(e: PointerEvent) {
    // Middle-button drag is the pan gesture, handled by useCanvasView.
    if (e.button !== 0 || replay.isPlaying) return;

    live.updateCursor(e.clientX, e.clientY);

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
    live.updateCursor(e.clientX, e.clientY);
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
    const stroke: Stroke = [...rec, { x: last.x, y: last.y, t: live.now(), p: last.p }];
    currentStrokeRef.current = null;
    setLivePoints(null);
    store.draw(stroke);
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

  // Ink is the always-on base layer; toggleable reference curves draw on top.
  // Both memoised so an in-progress stroke (live preview) doesn't recompute every
  // committed stroke on each pointer move.
  const inkLayer = useMemo(
    () => <g>{strokes.map((stroke, i) => drawLine(renderInk(stroke, inkOptions, drawTime), i, INK_COLOR))}</g>,
    [strokes, drawTime, inkOptions],
  );
  const overlayLayer = useMemo(
    () => activeStrategies.map(({ def, param }) => (
      <g key={def.id}>
        {def.id === 'debug'
          ? strokes.map((stroke, i) => drawDebug(stroke, inkOptions, drawTime, i, debug))
          : strokes.map((stroke, i) => drawLine(def.render(stroke, param, drawTime), i, def.color))}
      </g>
    )),
    [activeStrategies, strokes, drawTime, inkOptions, debug],
  );

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
    >
      <g ref={view.viewportRef}>
        <CanvasBackground guidelines={config.guidelines} />

        {/* Committed strokes: ink base, then overlay curves (memoised) */}
        {inkLayer}
        {overlayLayer}

        {/* Selected stroke highlight */}
        {!replay.isReplaying && selectedStroke !== null && strokes[selectedStroke] && (
          <g>{drawLine(primaryStrategy.def.render(strokes[selectedStroke], primaryStrategy.param, Infinity), 'sel', '#4f8ef7')}</g>
        )}

        {/* In-progress stroke — ink base plus any active overlay curves */}
        {livePoints && (
          <>
            <g>{drawLine(renderInk(livePoints, inkOptions, Infinity), 'live-ink', INK_COLOR)}</g>
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
