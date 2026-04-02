import { createContext } from 'preact';
import type { Stroke } from './utils';

export type AppContextValue = {
  strokes: Stroke[];
  selectedStroke: number | null;
  insertionPoint: number;
  setSelectedStroke: (i: number | null) => void;
  setInsertionPoint: (i: number) => void;
  deleteStroke: (i: number) => void;
  swapStrokes: (i: number) => void;
  editFirstPoint: (i: number, field: 'dx' | 'dy' | 'dt', value: number) => void;
};

export const AppContext = createContext<AppContextValue>({
  strokes: [],
  selectedStroke: null,
  insertionPoint: 0,
  setSelectedStroke: () => {},
  setInsertionPoint: () => {},
  deleteStroke: () => {},
  swapStrokes: () => {},
  editFirstPoint: () => {},
});
