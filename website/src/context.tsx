import { createContext } from "preact";
import type { Dispatch, StateUpdater } from "preact/hooks";
import { useContext } from "preact/hooks";
import type { InkOptions } from "./ink";
import type { useCanvasView } from "./hooks/useCanvasView";
import type { Playhead } from "./hooks/usePlayhead";
import type { StrokeStyle } from "./stroke";

// the pen and the brush draw new strokes in their style
export type Tool = StrokeStyle | "select";

export type AppContextValue = {
  view: ReturnType<typeof useCanvasView>;
  clock: Playhead;
  inkOptions: InkOptions;
  setInkOptions: Dispatch<StateUpdater<InkOptions>>;
  tool: Tool;
  setTool: (tool: Tool) => void;
  // index of the stroke the select tool picked
  selected: number | null;
  setSelected: (index: number | null) => void;
  undo: () => void;
  redo: () => void;
};

export const AppContext = createContext<AppContextValue>(null as unknown as AppContextValue);

export const useApp = () => useContext(AppContext);
