import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AppContext } from '../context';
import type { ActiveStrategy, RenderedLine, StrategiesState } from '../curves';
import { getActiveStrategies, getDefaultStrategies, INK, STRATEGY_DEFS } from '../curves';
import { useCanvasView } from '../hooks/useCanvasView';
import { useLiveRecording } from '../hooks/useLiveRecording';
import { useReplay } from '../hooks/useReplay';
import { useStrokeStore } from '../strokeStore';
import type { Config, Stroke } from '../utils';
import {
  compressText, decompressText,
  DEFAULT_CONFIG,
  deserialize,
  reframe,
  serialize, serializeBallpoint,
  strokesBounds,
} from '../utils';
import { BottomBar } from './BottomBar';
import { CanvasBackground } from './CanvasBackground';
import { Controls } from './Controls';
import { CurvePanel } from './CurvePanel';
import { ExportDialog } from './ExportDialog';
import { SettingsDialog } from './SettingsDialog';
import { StaminaRing } from './StaminaRing';
import { StrokeList } from './StrokeList';

const DEFAULT_EXPORT_PADDING = 40;
const PRESSURE_MAX = 8192;

// One renderer's output for one stroke, as SVG primitives: fill the shapes if
// present (variable width), otherwise stroke the centreline curve.
function drawLine(line: RenderedLine, key: string | number, color: string) {
  if (line.shapes && line.shapes.length) {
    return line.shapes.map((d, j) => <path key={`${key}-${j}`} d={d} fill={color} />);
  }
  return (
    <path key={key} d={line.curve} stroke={color} stroke-width={line.width}
      fill="none" stroke-linecap="round" stroke-linejoin="round" />
  );
}

export function App() {
  const store = useStrokeStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useCanvasView(svgRef, store.strokes);
  const replay = useReplay(store.strokes);
  const live = useLiveRecording();

  // In-progress stroke: `currentStrokeRef` is the authoritative builder (read on
  // commit); `livePoints` mirrors it for rendering through the active strategies.
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const isPanningRef = useRef(false);
  const panLastRef = useRef({ x: 0, y: 0 });
  const [livePoints, setLivePoints] = useState<Stroke | null>(null);

  const [strategies, setStrategies] = useState<StrategiesState>(getDefaultStrategies);
  const [config, setConfig] = useState<Config>(() => ({
    ...DEFAULT_CONFIG,
    ...JSON.parse(localStorage.getItem('rescrawl-config') || '{}'),
  }));
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPadding, setExportPadding] = useState(DEFAULT_EXPORT_PADDING);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Persist config; reflect sidebar side on <body>.
  useEffect(() => { localStorage.setItem('rescrawl-config', JSON.stringify(config)); }, [config]);
  useEffect(() => { document.body.classList.toggle('panel-left', !config.sidebarRight); }, [config.sidebarRight]);

  // Undo/redo shortcuts (store actions are stable).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); store.undo(); }
      else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); store.redo(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store.undo, store.redo]);

  // --- Pointer / drawing ---

  function handlePointerDown(e: PointerEvent) {
    live.updateCursor(e.clientX, e.clientY);
    if (e.button === 1) {
      svgRef.current!.setPointerCapture(e.pointerId);
      isPanningRef.current = true;
      panLastRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 || replay.isPlaying) return;

    svgRef.current!.setPointerCapture(e.pointerId);
    const pt = view.svgToContent(e.clientX, e.clientY);
    live.strokeStarted();
    const stroke: Stroke = [{ x: pt.x, y: pt.y, t: live.now(), p: Math.round(e.pressure * PRESSURE_MAX) }];
    currentStrokeRef.current = stroke;
    lastPtRef.current = pt;
    setLivePoints([...stroke]);
  }

  function handlePointerMove(e: PointerEvent) {
    live.updateCursor(e.clientX, e.clientY);
    if (isPanningRef.current) {
      view.pan(e.clientX - panLastRef.current.x, e.clientY - panLastRef.current.y);
      panLastRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (currentStrokeRef.current === null) return;

    const pt = view.svgToContent(e.clientX, e.clientY);
    const last = lastPtRef.current!;
    if (pt.x === last.x && pt.y === last.y) return;

    currentStrokeRef.current.push({ x: pt.x, y: pt.y, t: live.now(), p: Math.round(e.pressure * PRESSURE_MAX) });
    lastPtRef.current = pt;
    setLivePoints([...currentStrokeRef.current]);
  }

  function commitStroke() {
    const stroke = currentStrokeRef.current;
    if (stroke === null) return;
    currentStrokeRef.current = null;
    lastPtRef.current = null;
    setLivePoints(null);
    store.draw(stroke);
    live.strokeEnded();
  }

  function handlePointerUp() {
    if (isPanningRef.current) { isPanningRef.current = false; return; }
    commitStroke();
  }
  function handlePointerCancel() {
    isPanningRef.current = false;
    commitStroke();
  }

  // --- Import / export / clear ---

  function handleClear() {
    if (!confirm('Clear all strokes?')) return;
    replay.stop();
    live.reset();
    store.clear();
  }

  async function handleImport(file: File) {
    const raw = await file.text();
    const text = file.name.endsWith('.gz') ? await decompressText(raw) : raw;
    replay.stop();
    const imported = deserialize(text);
    const lastT = imported.reduce((m, st) => st.reduce((mm, pt) => Math.max(mm, pt.t), m), 0);
    live.reset(lastT); // continue the live clock from the imported end
    setStrategies(getDefaultStrategies());
    store.replaceAll(imported);
  }

  async function handleExport(filename: string, gzip: boolean, ballpoint: boolean) {
    const effective = reframe(store.strokes, exportPadding);
    const text = ballpoint ? serializeBallpoint(effective) : serialize(effective);
    const content = gzip ? await compressText(text) : text;
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename + (gzip ? '.scrawl.gz' : '.scrawl');
    a.click();
    URL.revokeObjectURL(a.href);
    setExportOpen(false);
  }

  // --- Derived render data ---

  const { strokes, selectedStroke, insertionPoint } = store;
  const activeStrategies = useMemo(() => getActiveStrategies(strategies), [strategies]);
  const primaryStrategy: ActiveStrategy = activeStrategies[0] ?? { def: STRATEGY_DEFS[0], param: 0 };

  // Renderers draw each stroke "as of" this time; the playhead during replay,
  // otherwise fully drawn.
  const drawTime = replay.isReplaying ? replay.elapsed : Infinity;

  // Ink is the always-on base layer; toggleable reference curves draw on top.
  // Both memoised so an in-progress stroke (live preview) doesn't recompute every
  // committed stroke on each pointer move.
  const inkLayer = useMemo(
    () => <g>{strokes.map((stroke, i) => drawLine(INK.render(stroke, INK.defaultParam, drawTime), i, INK.color))}</g>,
    [strokes, drawTime],
  );
  const overlayLayer = useMemo(
    () => activeStrategies.map(({ def, param }) => (
      <g key={def.id}>
        {strokes.map((stroke, i) => drawLine(def.render(stroke, param, drawTime), i, def.color))}
      </g>
    )),
    [activeStrategies, strokes, drawTime],
  );

  const exportBounds = exportOpen ? strokesBounds(strokes) : null;
  const crosshairPos = insertionPoint < strokes.length ? strokes[insertionPoint][0] : null;

  return (
    <AppContext.Provider value={{
      strokes, selectedStroke, insertionPoint,
      setSelectedStroke: store.select,
      setInsertionPoint: store.setInsertion,
      deleteStroke: store.deleteStroke,
      swapStrokes: store.swapStrokes,
      editFirstPoint: store.editFirstPoint,
    }}>
      <div id="main-area">
        <div id="canvas-wrapper">
          {live.isLive && (
            <div id="rec-indicator" title="Recording — timings are live">
              <span class="rec-dot" />REC
            </div>
          )}
          <StaminaRing containerRef={live.ringRef} arcRef={live.arcRef} />
          <div id="floating-toolbar">
            <button id="btn-undo" disabled={!store.canUndo} onClick={store.undo} title="Undo (Ctrl+Z)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button id="btn-redo" disabled={!store.canRedo} onClick={store.redo} title="Redo (Ctrl+Y)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </svg>
            </button>
            <button id="btn-reset-view" onClick={view.fitToView} title="Reset view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
            </button>
          </div>
          <div id="canvas-area">
            <svg
              ref={svgRef}
              id="canvas-svg"
              class={live.isLive ? 'live' : ''}
              onPointerDown={handlePointerDown as any}
              onPointerMove={handlePointerMove as any}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onContextMenu={(e) => e.preventDefault()}
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
                    <g>{drawLine(INK.render(livePoints, INK.defaultParam, Infinity), 'live-ink', INK.color)}</g>
                    {activeStrategies.map(({ def, param }) => (
                      <g key={`live-${def.id}`}>{drawLine(def.render(livePoints, param, Infinity), 'live', def.color)}</g>
                    ))}
                  </>
                )}

                {/* Export frame preview — used bounds + padding */}
                {exportBounds && (
                  <rect
                    x={exportBounds.minX - exportPadding}
                    y={exportBounds.minY - exportPadding}
                    width={exportBounds.maxX - exportBounds.minX + 2 * exportPadding}
                    height={exportBounds.maxY - exportBounds.minY + 2 * exportPadding}
                    fill="none" stroke="#4f8ef7" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"
                  />
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
          </div>
        </div>
        <BottomBar
          isPlaying={replay.isPlaying}
          replayElapsed={replay.elapsed}
          replayDuration={replay.duration}
          canPlay={strokes.length > 0}
          onPlay={replay.toggle}
          onScrub={replay.scrub}
          onClear={handleClear}
        />
      </div>
      <div id="panel">
        <Controls
          guidelines={config.guidelines}
          onGuidelinesChange={(v) => setConfig(c => ({ ...c, guidelines: v }))}
          hasStrokes={strokes.length > 0}
          onImport={handleImport}
          onExportOpen={() => setExportOpen(true)}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
        <div id="curve-panel">
          <CurvePanel strategies={strategies} onChange={setStrategies} />
        </div>
        <StrokeList />
      </div>
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onExport={handleExport}
        padding={exportPadding}
        onPaddingChange={setExportPadding}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sidebarRight={config.sidebarRight}
        onSidebarRightChange={(v) => setConfig(c => ({ ...c, sidebarRight: v }))}
        onReset={() => setConfig({ ...DEFAULT_CONFIG })}
      />
    </AppContext.Provider>
  );
}
