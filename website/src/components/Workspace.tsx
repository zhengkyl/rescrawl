import { batch } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { AppContext, type Tool } from "../context";
import type { InkOptions } from "../ink";
import { INK_DEFAULTS, INK_STORAGE_KEY } from "../ink";
import { useCanvasView } from "../hooks/useCanvasView";
import { usePlayhead } from "../hooks/usePlayhead";
import { applyStrokeOp, useStrokes } from "../strokeStore";
import { Canvas } from "./Canvas";
import { Knobs } from "./Knobs";
import { Timeline } from "./Timeline";
import { Actions } from "./Actions";
import { Tools } from "./Tools";
import { ZoomControl } from "./ZoomControl";

export function Workspace() {
  const store = useStrokes();
  const clock = usePlayhead();
  const view = useCanvasView();

  const [inkOptions, setInkOptions] = useState<InkOptions>(() => ({
    ...INK_DEFAULTS,
    ...JSON.parse(localStorage.getItem(INK_STORAGE_KEY) || "{}"),
  }));
  const [knobsOpen, setKnobsOpen] = useState(false);
  const [tool, setToolState] = useState<Tool>("brush");
  const [selected, setSelected] = useState<number | null>(null);
  function setTool(next: Tool) {
    setToolState(next);
    setSelected(null);
  }

  useEffect(() => {
    localStorage.setItem(INK_STORAGE_KEY, JSON.stringify(inkOptions));
  }, [inkOptions]);

  function undo() {
    if (store.historyIndex.value < 0) return;
    const entry = store.historyStack.value[store.historyIndex.value];
    batch(() => {
      store.strokes.value = applyStrokeOp(store.strokes.value, entry.op, "undo");
      store.historyIndex.value--;
    });
    if (entry.prevFocus !== null) clock.seek(entry.prevFocus);
  }
  function redo() {
    if (store.historyIndex.value >= store.historyStack.value.length - 1) return;
    const entry = store.historyStack.value[store.historyIndex.value + 1];
    batch(() => {
      store.strokes.value = applyStrokeOp(store.strokes.value, entry.op, "redo");
      store.historyIndex.value++;
    });
    if (entry.nextFocus !== null) clock.seek(entry.nextFocus);
  }
  function clear() {
    if (!confirm("Clear all strokes?")) return;
    clock.seek(0);
    store.replace([]);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
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
        inkOptions,
        setInkOptions,
        tool,
        setTool,
        selected,
        setSelected,
        undo,
        redo,
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
        {knobsOpen && <Knobs />}
        <ZoomControl />
      </div>
      <Timeline />
    </AppContext.Provider>
  );
}
