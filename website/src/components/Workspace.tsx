import { useEffect, useState } from 'preact/hooks';
import { AppContext } from '../context';
import type { DebugLayers, InkOptions, StrategiesState } from '../curves';
import { DEBUG_DEFAULTS, getDefaultStrategies, INK_DEFAULTS } from '../curves';
import { useCanvasView } from '../hooks/useCanvasView';
import { useLiveRecording } from '../hooks/useLiveRecording';
import { useReplay } from '../hooks/useReplay';
import { useStrokeStore } from '../strokeStore';
import type { Config } from '../utils';
import { DEFAULT_CONFIG } from '../utils';
import { App } from './App';
import { BottomBar } from './BottomBar';
import { Controls } from './Controls';
import { CurvePanel } from './CurvePanel';
import { ExportDialog } from './ExportDialog';
import { InkPanel } from './InkPanel';
import { SettingsDialog } from './SettingsDialog';
import { StrokeList } from './StrokeList';

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

  // Undo/redo shortcuts (store actions are stable).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); store.undo(); }
      else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); store.redo(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store.undo, store.redo]);

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
        </div>
        <BottomBar />
      </div>
      <div id="panel">
        <Controls />
        <div id="curve-panel">
          <CurvePanel />
          <InkPanel />
        </div>
        <StrokeList />
      </div>
      <ExportDialog />
      <SettingsDialog />
    </AppContext.Provider>
  );
}
