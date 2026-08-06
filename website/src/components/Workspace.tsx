import { batch } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { AppContext } from '../context';
import type { DebugLayers, InkOptions, StrategiesState } from '../curves';
import { DEBUG_DEFAULTS, getDefaultStrategies, INK_DEFAULTS } from '../curves';
import { MAX_ZOOM, MIN_ZOOM, useCanvasView } from '../hooks/useCanvasView';
import { usePlayhead } from '../hooks/usePlayhead';
import { applyStrokeOp, useStrokes } from '../strokeStore';
import type { Config } from '../utils';
import { DEFAULT_CONFIG } from '../utils';
import { App } from './App';
import { Controls } from './Controls';
import { CurvePanel } from './CurvePanel';
import { ExportDialog } from './ExportDialog';
import { InkPanel } from './InkPanel';
import { SettingsDialog } from './SettingsDialog';
import { Timeline } from './Timeline';

export function Workspace() {
  const store = useStrokes();
  const clock = usePlayhead();
  const view = useCanvasView();

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

  function undo() {
    if (store.historyIndex.value < 0) return;
    const entry = store.historyStack.value[store.historyIndex.value];
    batch(() => {
      store.strokes.value = applyStrokeOp(store.strokes.value, entry.op, "undo");
      store.historyIndex.value--;
    });
    clock.seek(entry.prevFocus)
  }
  function redo() {
    if (store.historyIndex.value >= store.historyStack.value.length - 1) return;
    const entry = store.historyStack.value[store.historyIndex.value + 1];
    batch(() => {
      store.strokes.value = applyStrokeOp(store.strokes.value, entry.op, "redo");
      store.historyIndex.value++;
    });
    clock.seek(entry.nextFocus);
  }
  function clear() {
    if (!confirm('Clear all strokes?')) return;
    clock.seek(0);
    store.replace([]);
  }


  // Undo/redo shortcuts. The listener is bound once and that's fine: the store is
  // read at call time, and `clock.seek` only touches refs, signals, and a stable
  // setState — so there is no stale render scope to close over.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault(); undo();
      } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault(); redo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <AppContext.Provider value={{
      view, clock,
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
            <button id="btn-undo" disabled={store.historyIndex.value < 0} onClick={undo} title="Undo (Ctrl+Z)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button id="btn-redo" disabled={store.historyIndex.value >= store.historyStack.value.length - 1} onClick={redo} title="Redo (Ctrl+Y)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </svg>
            </button>
            <button id="btn-clear" disabled={clock.isPlaying || !store.strokes.value.length} onClick={clear} title="Clear all strokes">
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
              value={Math.log(view.zoom.value)}
              onInput={(e) => view.zoomTo(Math.exp(+(e.currentTarget as HTMLInputElement).value))}
              title="Zoom (Ctrl+scroll)"
            />
            <span class="zoom-level" title="Reset to 100%" onClick={() => view.zoomTo(1)}>
              {Math.round(view.zoom.value * 100)}%
            </span>
          </div>
        </div>
        <div id="bottom-bar">
          <Timeline />
        </div>
      </div>
      <div id="panel">
        <Controls />
        <div id="curve-panel">
          <CurvePanel />
          <InkPanel />
        </div>
      </div>
      {exportOpen && <ExportDialog />}
      <SettingsDialog />
    </AppContext.Provider>
  );
}
