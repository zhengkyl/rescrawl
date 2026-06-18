import { useEffect, useRef, useState } from 'preact/hooks';
import { AppContext } from '../context';
import type { DebugLayers, InkOptions, StrategiesState } from '../curves';
import { DEBUG_DEFAULTS, getDefaultStrategies, INK_DEFAULTS } from '../curves';
import { MAX_ZOOM, MIN_ZOOM, useCanvasView } from '../hooks/useCanvasView';
import { LIVE_TIMEOUT, useLiveRecording } from '../hooks/useLiveRecording';
import { useReplay } from '../hooks/useReplay';
import { useStrokeStore } from '../strokeStore';
import type { Config } from '../utils';
import { DEFAULT_CONFIG, strokeEnd, strokeStart } from '../utils';
import { ActiveStrokeEditor } from './ActiveStrokeEditor';
import { App } from './App';
import { BottomBar } from './BottomBar';
import { Controls } from './Controls';
import { CurvePanel } from './CurvePanel';
import { ExportDialog } from './ExportDialog';
import { InkPanel } from './InkPanel';
import { SettingsDialog } from './SettingsDialog';

// Owns all shared app state and the surrounding chrome (toolbar, panels, bottom
// bar, dialogs). The drawing surface itself is <App>, mounted in the canvas slot
// and fed entirely through context.
export function Workspace() {
  const store = useStrokeStore();
  const view = useCanvasView(store.strokes);

  const replay = useReplay(store.strokes);
  const live = useLiveRecording();

  const [strategies, setStrategies] = useState<StrategiesState>(getDefaultStrategies);
  const [debug, setDebug] = useState<DebugLayers>(DEBUG_DEFAULTS);
  const [inkOptions, setInkOptions] = useState<InkOptions>(() => ({
    ...INK_DEFAULTS,
    ...JSON.parse(localStorage.getItem('rescrawl-ink') || '{}'),
  }));
  const [config, setConfig] = useState<Config>(() => ({
    ...DEFAULT_CONFIG,
    ...JSON.parse(localStorage.getItem('rescrawl-config') || '{}'),
  }));
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Persist config + ink options; reflect sidebar side on <body>.
  useEffect(() => { localStorage.setItem('rescrawl-ink', JSON.stringify(inkOptions)); }, [inkOptions]);
  useEffect(() => { localStorage.setItem('rescrawl-config', JSON.stringify(config)); }, [config]);
  useEffect(() => { document.body.classList.toggle('panel-left', !config.sidebarRight); }, [config.sidebarRight]);

  function handleClear() {
    if (!confirm('Clear all strokes?')) return;
    replay.stop();
    live.reset();
    store.clear();
  }

  // Undo, then move the playhead to where the undone stroke began rather than
  // letting it follow to the new content end. Peeks the op about to be reversed;
  // for a removed (drawn) stroke that's its start time. The seek lands at a time
  // before the old duration, so useReplay's follow-to-end won't override it.
  function handleUndo() {
    const op = store.canUndo ? store.history[store.historyIndex] : null;
    store.undo();
    if (op && op.type === 'draw') replay.seek(strokeStart(op.stroke), true);
  }
  // Redo, restoring the playhead to where the redone draw left it: the stroke's
  // end plus the post-stroke grace gap, matching a fresh draw (rather than just
  // the stroke's last node). Pinned so the follow-to-end doesn't reclaim it.
  function handleRedo() {
    const op = store.canRedo ? store.history[store.historyIndex + 1] : null;
    store.redo();
    if (op && op.type === 'draw') replay.seek(strokeEnd(op.stroke) + LIVE_TIMEOUT, true);
  }
  // The keydown listener is bound once, so route through refs to always call the
  // latest handlers (which close over the current history).
  const undoRef = useRef(handleUndo);
  undoRef.current = handleUndo;
  const redoRef = useRef(handleRedo);
  redoRef.current = handleRedo;

  // Undo/redo shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); undoRef.current(); }
      else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redoRef.current(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <AppContext.Provider value={{
      store, view, replay, live,
      config, setConfig,
      inkOptions, setInkOptions,
      strategies, setStrategies,
      debug, setDebug,
      exportOpen, setExportOpen,
      settingsOpen, setSettingsOpen,
    }}>
      <div id="main-area">
        <div id="canvas-wrapper">
          <div id="floating-toolbar">
            <button id="btn-undo" disabled={!store.canUndo} onClick={handleUndo} title="Undo (Ctrl+Z)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button id="btn-redo" disabled={!store.canRedo} onClick={handleRedo} title="Redo (Ctrl+Y)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </svg>
            </button>
            <button id="btn-clear" disabled={replay.isPlaying || !store.strokes.length} onClick={handleClear} title="Clear all strokes">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
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
            <App />
          </div>
          <div id="zoom-control">
            <input
              type="range"
              min={Math.log(MIN_ZOOM)}
              max={Math.log(MAX_ZOOM)}
              step="any"
              value={Math.log(view.zoom)}
              onInput={(e) => view.zoomTo(Math.exp(+(e.currentTarget as HTMLInputElement).value))}
              title="Zoom (Ctrl+scroll)"
            />
            <span class="zoom-level" title="Reset to 100%" onClick={() => view.zoomTo(1)}>
              {Math.round(view.zoom * 100)}%
            </span>
          </div>
        </div>
        <BottomBar />
      </div>
      <div id="panel">
        <Controls />
        <div id="curve-panel">
          <CurvePanel />
          <InkPanel />
        </div>
        <ActiveStrokeEditor />
      </div>
      {exportOpen && <ExportDialog />}
      <SettingsDialog />
    </AppContext.Provider>
  );
}
