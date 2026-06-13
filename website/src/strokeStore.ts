import { useMemo, useReducer } from 'preact/hooks';
import type { Stroke } from './utils';

// Strokes are decoupled (each holds absolute points), so structural edits are
// plain array operations — no neighbour patching.
function applyDraw(s: Stroke[], index: number, stroke: Stroke): Stroke[] {
  const next = [...s];
  next.splice(index, 0, stroke);
  return next;
}

function applyDelete(s: Stroke[], index: number): Stroke[] {
  const next = [...s];
  next.splice(index, 1);
  return next;
}

function applySwap(s: Stroke[], index: number): Stroke[] {
  const j = index + 1;
  if (j >= s.length) return s;
  const next = [...s];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

export type EditField = 'x' | 'y' | 't';

// Translate a whole stroke so its first point's `field` becomes `value`.
function applyEditFirst(s: Stroke[], index: number, field: EditField, value: number): Stroke[] {
  const next = [...s];
  const delta = value - next[index][0][field];
  next[index] = next[index].map(pt => ({ ...pt, [field]: pt[field] + delta }));
  return next;
}

// --- History ---

type HistoryOp =
  | { type: 'draw'; index: number; stroke: Stroke }
  | { type: 'delete'; index: number; stroke: Stroke }
  | { type: 'swap'; index: number }
  | { type: 'edit'; index: number; field: EditField; from: number; to: number }
  | { type: 'bulk'; from: Stroke[]; to: Stroke[] };

function applyHistoryOp(s: Stroke[], op: HistoryOp, dir: 'undo' | 'redo'): Stroke[] {
  switch (op.type) {
    case 'draw': return dir === 'undo' ? applyDelete(s, op.index) : applyDraw(s, op.index, op.stroke);
    case 'delete': return dir === 'undo' ? applyDraw(s, op.index, op.stroke) : applyDelete(s, op.index);
    case 'swap': return applySwap(s, op.index);
    case 'edit': return applyEditFirst(s, op.index, op.field, dir === 'undo' ? op.from : op.to);
    case 'bulk': return dir === 'undo' ? op.from : op.to;
  }
}

// --- Reducer ---

export type StrokeState = {
  strokes: Stroke[];
  insertionPoint: number;
  selectedStroke: number | null;
  history: HistoryOp[];
  historyIndex: number;
};

const INITIAL: StrokeState = {
  strokes: [],
  insertionPoint: 0,
  selectedStroke: null,
  history: [],
  historyIndex: -1,
};

type StrokeAction =
  | { type: 'draw'; stroke: Stroke }
  | { type: 'delete'; index: number }
  | { type: 'swap'; index: number }
  | { type: 'editFirst'; index: number; field: EditField; value: number }
  | { type: 'clear' }
  | { type: 'replaceAll'; strokes: Stroke[] }
  | { type: 'select'; index: number | null }
  | { type: 'setInsertion'; index: number }
  | { type: 'undo' }
  | { type: 'redo' };

// Record an op (dropping any redo branch) alongside the resulting changes.
function withOp(state: StrokeState, op: HistoryOp, changes: Partial<StrokeState>): StrokeState {
  const history = state.history.slice(0, state.historyIndex + 1);
  history.push(op);
  return { ...state, ...changes, history, historyIndex: history.length - 1 };
}

function reducer(state: StrokeState, action: StrokeAction): StrokeState {
  switch (action.type) {
    case 'draw': {
      const index = state.insertionPoint;
      return withOp(state, { type: 'draw', index, stroke: action.stroke }, {
        strokes: applyDraw(state.strokes, index, action.stroke),
        insertionPoint: index + 1,
      });
    }
    case 'delete': {
      const i = action.index;
      return withOp(state, { type: 'delete', index: i, stroke: state.strokes[i] }, {
        strokes: applyDelete(state.strokes, i),
        insertionPoint: state.insertionPoint > i ? state.insertionPoint - 1 : state.insertionPoint,
        selectedStroke: null,
      });
    }
    case 'swap': {
      const i = action.index;
      if (i + 1 >= state.strokes.length) return state;
      return withOp(state, { type: 'swap', index: i }, { strokes: applySwap(state.strokes, i) });
    }
    case 'editFirst': {
      const { index, field, value } = action;
      return withOp(state, { type: 'edit', index, field, from: state.strokes[index][0][field], to: value }, {
        strokes: applyEditFirst(state.strokes, index, field, value),
      });
    }
    case 'clear':
      return withOp(state, { type: 'bulk', from: state.strokes, to: [] }, {
        strokes: [], insertionPoint: 0, selectedStroke: null,
      });
    case 'replaceAll':
      return withOp(state, { type: 'bulk', from: state.strokes, to: action.strokes }, {
        strokes: action.strokes, insertionPoint: action.strokes.length, selectedStroke: null,
      });
    case 'select':
      return { ...state, selectedStroke: action.index };
    case 'setInsertion':
      return { ...state, insertionPoint: action.index };
    case 'undo': {
      if (state.historyIndex < 0) return state;
      const op = state.history[state.historyIndex];
      const strokes = applyHistoryOp(state.strokes, op, 'undo');
      return {
        ...state, strokes,
        historyIndex: state.historyIndex - 1,
        insertionPoint: Math.min(state.insertionPoint, strokes.length),
        selectedStroke: null,
      };
    }
    case 'redo': {
      if (state.historyIndex >= state.history.length - 1) return state;
      const op = state.history[state.historyIndex + 1];
      const prevLength = state.strokes.length;
      const strokes = applyHistoryOp(state.strokes, op, 'redo');
      // Keep the cursor at the tail if a draw is being re-inserted there.
      const insertionPoint = (op.type === 'draw' && state.insertionPoint === prevLength)
        ? strokes.length
        : Math.min(state.insertionPoint, strokes.length);
      return { ...state, strokes, historyIndex: state.historyIndex + 1, insertionPoint, selectedStroke: null };
    }
  }
}

export function useStrokeStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // dispatch is stable, so these actions keep a stable identity across renders.
  const actions = useMemo(() => ({
    draw: (stroke: Stroke) => dispatch({ type: 'draw', stroke }),
    deleteStroke: (index: number) => dispatch({ type: 'delete', index }),
    swapStrokes: (index: number) => dispatch({ type: 'swap', index }),
    editFirstPoint: (index: number, field: EditField, value: number) => dispatch({ type: 'editFirst', index, field, value }),
    clear: () => dispatch({ type: 'clear' }),
    replaceAll: (strokes: Stroke[]) => dispatch({ type: 'replaceAll', strokes }),
    select: (index: number | null) => dispatch({ type: 'select', index }),
    setInsertion: (index: number) => dispatch({ type: 'setInsertion', index }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
  }), [dispatch]);

  return {
    ...state,
    ...actions,
    canUndo: state.historyIndex >= 0,
    canRedo: state.historyIndex < state.history.length - 1,
  };
}

export type StrokeStore = ReturnType<typeof useStrokeStore>;
