import { useApp } from "../context";
import { useStrokes } from "../strokeStore";

export function Actions({
  onUndo,
  onRedo,
  onClear,
  knobsOpen,
  onToggleKnobs,
}: {
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  knobsOpen: boolean;
  onToggleKnobs: () => void;
}) {
  const { clock, view } = useApp();

  const store = useStrokes();
  const canUndo = store.historyIndex.value >= 0;
  const canRedo = store.historyIndex.value < store.historyStack.value.length - 1;
  const canClear = store.strokes.value.length > 0;

  return (
    <div id="floating-toolbar">
      <button id="btn-undo" disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      </button>
      <button id="btn-redo" disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Y)">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </svg>
      </button>
      <button
        id="btn-clear"
        disabled={clock.isPlaying || !canClear}
        onClick={onClear}
        title="Clear all strokes"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
      </button>
      <button id="btn-reset-view" onClick={view.fitToView} title="Reset view">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6v6H9z" />
        </svg>
      </button>
      <button
        id="btn-knobs"
        class={knobsOpen ? "on" : ""}
        onClick={onToggleKnobs}
        title="Ink knobs"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      </button>
    </div>
  );
}
