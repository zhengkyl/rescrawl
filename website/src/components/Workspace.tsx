import { batch } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { AppContext } from '../context';
import type { DebugLayers, InkOptions, StrategiesState } from '../curves';
import { DEBUG_DEFAULTS, getDefaultStrategies, INK_DEFAULTS } from '../curves';
import { useCanvasView } from '../hooks/useCanvasView';
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
import { Toolbar } from './Toolbar';
import { ZoomControl } from './ZoomControl';

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
          <Toolbar
            onUndo={undo} onRedo={redo} onClear={clear} />
          <div id="canvas-area">
            <App />
          </div>
          <ZoomControl />
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
