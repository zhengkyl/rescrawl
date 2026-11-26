import { batch, useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { AppContext, type Tool } from "../context";
import type { InkOptions } from "../ink";
import { INK_DEFAULTS, INK_STORAGE_KEY } from "../ink";
import { useCanvasView } from "../hooks/useCanvasView";
import { usePlayhead } from "../hooks/usePlayhead";
import {
  BRUSH_DEFAULTS,
  BRUSHES_STORAGE_KEY,
  type BrushSettings,
  REPLAY_DEFAULTS,
  REPLAY_STORAGE_KEY,
  type ReplayOptions,
  replayTimes,
  type StrokeStyle,
} from "../stroke";
import { load, save } from "../storage";
import { applyStrokeOp, useStrokes } from "../strokeStore";
import { Canvas } from "./Canvas";
import { Knobs } from "./Knobs";
import { Selection } from "./Selection";
import { Actions } from "./Actions";
import { Tools } from "./Tools";

const TYPING =
  'input:not([type="range"], [type="checkbox"], [type="color"]), textarea, [contenteditable]';

export function Workspace() {
  const store = useStrokes();
  const view = useCanvasView();
  const replay = useSignal<ReplayOptions>(load(REPLAY_STORAGE_KEY, REPLAY_DEFAULTS));
  const timing = useComputed(() => replayTimes(store.strokes.value, replay.value.maxPause));
  const clock = usePlayhead(useComputed(() => timing.value.duration));
  useSignalEffect(() => save(REPLAY_STORAGE_KEY, replay.value));

  const [inkOptions, setInkOptions] = useState<InkOptions>(() =>
    load(INK_STORAGE_KEY, INK_DEFAULTS),
  );
  const [brushes, setBrushes] = useState<Record<StrokeStyle, BrushSettings>>(() => {
    const saved = load(BRUSHES_STORAGE_KEY, BRUSH_DEFAULTS);
    return {
      pen: { ...BRUSH_DEFAULTS.pen, ...saved.pen },
      brush: { ...BRUSH_DEFAULTS.brush, ...saved.brush },
    };
  });
  const [knobsOpen, setKnobsOpen] = useState(false);
  const [tool, setToolState] = useState<Tool>("brush");
  const [selected, setSelected] = useState<number[]>([]);
  const closingPress = useRef<number | null>(null);
  function setTool(next: Tool) {
    setToolState(next);
    setSelected([]);
    // replay opens on the whole drawing
    if (next === "replay") clock.seek(clock.duration.peek());
    else clock.pause();
  }

  useEffect(() => save(INK_STORAGE_KEY, inkOptions), [inkOptions]);
  useEffect(() => save(BRUSHES_STORAGE_KEY, brushes), [brushes]);

  function undo() {
    if (store.historyIndex.value < 0) return;
    const op = store.historyStack.value[store.historyIndex.value];
    batch(() => {
      store.strokes.value = applyStrokeOp(store.strokes.value, op, "undo");
      store.historyIndex.value--;
    });
  }
  function redo() {
    if (store.historyIndex.value >= store.historyStack.value.length - 1) return;
    const op = store.historyStack.value[store.historyIndex.value + 1];
    batch(() => {
      store.strokes.value = applyStrokeOp(store.strokes.value, op, "redo");
      store.historyIndex.value++;
    });
  }
  // one undo step brings it all back
  function clear() {
    store.replace([]);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // a text field keeps its own undo
      if ((e.target as Element).closest?.(TYPING)) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // caps lock or shift makes it "Z"
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <AppContext.Provider
      value={{
        view,
        clock,
        replay,
        timing,
        inkOptions,
        setInkOptions,
        brushes,
        setBrushes,
        tool,
        setTool,
        selected,
        setSelected,
        undo,
        redo,
        closingPress,
      }}
    >
      <div id="canvas-wrapper">
        <Actions
          onUndo={undo}
          onRedo={redo}
          onClear={clear}
          knobsOpen={knobsOpen}
          onToggleKnobs={() => setKnobsOpen((o) => !o)}
        />
        <Canvas />
        <Tools />
        <Selection />
        {knobsOpen && <Knobs />}
      </div>
    </AppContext.Provider>
  );
}
