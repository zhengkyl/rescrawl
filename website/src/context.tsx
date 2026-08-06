import { createContext } from 'preact';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import { useContext } from 'preact/hooks';
import type { DebugLayers, InkOptions, StrategiesState } from './curves';
import type { useCanvasView } from './hooks/useCanvasView';
import type { Playhead } from './hooks/usePlayhead';
import type { Config } from './utils';

// Per-workspace UI state, so the drawing surface (App) and the surrounding
// chrome (Workspace) can each pull exactly what they need instead of threading
// props down from a single owner. The strokes themselves are not here — they
// live in `strokeStore` as module-level signals and are imported directly.
export type AppContextValue = {
  view: ReturnType<typeof useCanvasView>;
  clock: Playhead;

  config: Config;
  setConfig: Dispatch<StateUpdater<Config>>;
  inkOptions: InkOptions;
  setInkOptions: Dispatch<StateUpdater<InkOptions>>;
  strategies: StrategiesState;
  setStrategies: Dispatch<StateUpdater<StrategiesState>>;
  debug: DebugLayers;
  setDebug: Dispatch<StateUpdater<DebugLayers>>;

  exportOpen: boolean;
  setExportOpen: Dispatch<StateUpdater<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<StateUpdater<boolean>>;
};

export const AppContext = createContext<AppContextValue>(null as unknown as AppContextValue);

export const useApp = () => useContext(AppContext);
