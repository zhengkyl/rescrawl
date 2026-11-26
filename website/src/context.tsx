import type { ReadonlySignal, Signal } from "@preact/signals";
import { createContext } from "preact";
import type { Dispatch, MutableRef, StateUpdater } from "preact/hooks";
import { useContext } from "preact/hooks";
import type { InkOptions } from "./ink";
import type { useCanvasView } from "./hooks/useCanvasView";
import type { Playhead } from "./hooks/usePlayhead";
import type { BrushSettings, ReplayOptions, ReplayTimes, StrokeStyle } from "./stroke";

// the pen and the brush draw new strokes in their style
export type Tool = StrokeStyle | "select" | "replay";

type AppContextValue = {
  view: ReturnType<typeof useCanvasView>;
  clock: Playhead;
  replay: Signal<ReplayOptions>;
  timing: ReadonlySignal<ReplayTimes>;
  inkOptions: InkOptions;
  setInkOptions: Dispatch<StateUpdater<InkOptions>>;
  // what the pen and the brush draw new strokes with
  brushes: Record<StrokeStyle, BrushSettings>;
  setBrushes: Dispatch<StateUpdater<Record<StrokeStyle, BrushSettings>>>;
  tool: Tool;
  setTool: (tool: Tool) => void;
  // indices of the strokes the select tool picked
  selected: number[];
  setSelected: (indices: number[]) => void;
  undo: () => void;
  redo: () => void;
  // the pointer whose press on the canvas closed the drawer; a tap of it only closes
  closingPress: MutableRef<number | null>;
};

export const AppContext = createContext<AppContextValue>(null as unknown as AppContextValue);

export const useApp = () => useContext(AppContext);
