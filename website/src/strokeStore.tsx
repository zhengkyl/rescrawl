import { batch, computed, signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useMemo } from "preact/hooks";
import type { Stroke } from "./utils";
import { LIVE_TIMEOUT, strokeEnd, strokeStart } from "./utils";

type Op =
  | { type: "append"; stroke: Stroke }
  | { type: "replace"; prev: Stroke[]; next: Stroke[] };

type Entry = { op: Op; prevFocus: number; nextFocus: number };

export function applyStrokeOp(s: Stroke[], op: Op, dir: "undo" | "redo"): Stroke[] {
  switch (op.type) {
    case "append":
      return dir === "undo" ? s.slice(0, -1) : [...s, op.stroke];
    case "replace":
      return dir === "undo" ? op.prev : op.next;
  }
}

// Park just past a stroke, matching where a fresh draw leaves the playhead.
const parkAfter = (s: Stroke) => strokeEnd(s) + LIVE_TIMEOUT;
// Park past the last of a set — 0 when empty, as after a clear.
const parkAfterAll = (list: Stroke[]) => list.reduce((max, s) => Math.max(max, parkAfter(s)), 0);

function createStrokeStore() {
  const strokes = signal<Stroke[]>([]);
  const historyStack = signal<Entry[]>([]);
  const historyIndex = signal(-1);

  const duration = computed(() => strokes.value.reduce((max, s) => Math.max(max, strokeEnd(s)), 0));

  // drop any redo branch, append, advance.
  function commit(next: Stroke[], entry: Entry) {
    const kept = historyStack.value.slice(0, historyIndex.value + 1);
    batch(() => {
      historyStack.value = [...kept, entry];
      historyIndex.value = kept.length;
      strokes.value = next;
    });
  }

  function append(stroke: Stroke) {
    commit([...strokes.value, stroke], {
      op: { type: "append", stroke },
      prevFocus: strokeStart(stroke),
      nextFocus: parkAfter(stroke),
    });
  }

  function replace(next: Stroke[]) {
    const prev = strokes.value;
    commit(next, {
      op: { type: "replace", prev, next },
      prevFocus: parkAfterAll(prev),
      nextFocus: parkAfterAll(next),
    });
  }

  return {
    strokes,
    duration,
    historyStack,
    historyIndex,
    append,
    replace,
  };
}

export type StrokeStore = ReturnType<typeof createStrokeStore>;

const StrokeContext = createContext<StrokeStore>(null as unknown as StrokeStore);

export const useStrokes = () => useContext(StrokeContext);

export function StrokeProvider({ children }: { children: ComponentChildren }) {
  const store = useMemo(createStrokeStore, []);
  return <StrokeContext.Provider value={store}>{children}</StrokeContext.Provider>;
}
