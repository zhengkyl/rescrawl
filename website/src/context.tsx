import { createContext } from 'preact';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import { useContext } from 'preact/hooks';
import type { DebugLayers, InkOptions, StrategiesState } from './curves';
import type { useCanvasView } from './hooks/useCanvasView';
import type { useLiveRecording } from './hooks/useLiveRecording';
import type { useReplay } from './hooks/useReplay';
import type { StrokeStore } from './strokeStore';
import type { Config } from './utils';

// Everything the app shares lives here so the drawing surface (App) and the
// surrounding chrome (Workspace) can each pull exactly what they need instead of
// threading props down from a single owner.
export type AppContextValue = {
  store: StrokeStore;
  view: ReturnType<typeof useCanvasView>;
  replay: ReturnType<typeof useReplay>;
  live: ReturnType<typeof useLiveRecording>;

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
