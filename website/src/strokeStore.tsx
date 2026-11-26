import { batch, signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useMemo } from "preact/hooks";
import type { Stroke } from "./stroke";

type Op =
  | { type: "append"; stroke: Stroke }
  | { type: "replace"; prev: Stroke[]; next: Stroke[] }
  | { type: "set"; indices: number[]; prev: Stroke[]; next: Stroke[] };

export function applyStrokeOp(s: Stroke[], op: Op, dir: "undo" | "redo"): Stroke[] {
  switch (op.type) {
    case "append":
      return dir === "undo" ? s.slice(0, -1) : [...s, op.stroke];
    case "replace":
      return dir === "undo" ? op.prev : op.next;
    case "set": {
      const out = s.slice();
      const from = dir === "undo" ? op.prev : op.next;
      op.indices.forEach((i, k) => (out[i] = from[k]));
      return out;
    }
  }
}

function createStrokeStore() {
  const strokes = signal<Stroke[]>([]);
  const historyStack = signal<Op[]>([]);
  const historyIndex = signal(-1);

  function commit(next: Stroke[], op: Op) {
    const kept = historyStack.value.slice(0, historyIndex.value + 1);
    batch(() => {
      historyStack.value = [...kept, op];
      historyIndex.value = kept.length;
      strokes.value = next;
    });
  }

  function append(stroke: Stroke) {
    commit([...strokes.value, stroke], { type: "append", stroke });
  }

  function replace(next: Stroke[]) {
    commit(next, { type: "replace", prev: strokes.value, next });
  }

  // one undo step for all of them
  function set(indices: number[], changed: Stroke[]) {
    const prev = indices.map((i) => strokes.value[i]);
    const next = strokes.value.slice();
    indices.forEach((i, k) => (next[i] = changed[k]));
    commit(next, { type: "set", indices, prev, next: changed });
  }

  return {
    strokes,
    historyStack,
    historyIndex,
    append,
    replace,
    set,
  };
}

type StrokeStore = ReturnType<typeof createStrokeStore>;

const StrokeContext = createContext<StrokeStore>(null as unknown as StrokeStore);

export const useStrokes = () => useContext(StrokeContext);

export function StrokeProvider({ children }: { children: ComponentChildren }) {
  const store = useMemo(createStrokeStore, []);
  return <StrokeContext.Provider value={store}>{children}</StrokeContext.Provider>;
}
