import { useState } from 'preact/hooks';
import { useApp } from '../context';
import type { EditField } from '../strokeStore';
import { activeStrokeAt } from '../utils';

const FIELDS: EditField[] = ['x', 'y', 't'];

// Edits the first point of the stroke under the playhead (the one highlighted on
// the canvas while not recording). x/y translate the whole stroke; t shifts it in
// time, optionally dragging every later stroke along so the gaps after it hold.
export function ActiveStrokeEditor() {
  const { store, replay, live } = useApp();
  const [propagate, setPropagate] = useState(false);

  const active = live.isLive ? null : activeStrokeAt(store.strokes, replay.elapsed);

  if (active === null) {
    return (
      <div id="active-stroke-editor">
        <div class="ase-empty">{live.isLive ? 'Recording…' : 'No stroke at playhead'}</div>
      </div>
    );
  }

  const first = store.strokes[active][0];

  function commit(field: EditField, value: number) {
    if (Number.isNaN(value)) return;
    store.editFirstPoint(active!, field, value, field === 't' && propagate);
    // Keep this stroke active at its new start so it stays selected and visible.
    if (field === 't') replay.seek(Math.max(0, value), true);
  }

  return (
    <div id="active-stroke-editor">
      <div class="ase-header">Active stroke · #{active + 1}</div>
      <div class="ase-fields">
        {FIELDS.map(field => (
          <label key={field}>
            {field}
            <input
              type="number"
              value={first[field]}
              onChange={(e) => commit(field, +(e.target as HTMLInputElement).value)}
            />
          </label>
        ))}
      </div>
      <label class="ase-propagate" title="When changing t, shift every later stroke by the same amount">
        <input type="checkbox" checked={propagate} onChange={(e) => setPropagate((e.target as HTMLInputElement).checked)} />
        {' '}Shift following strokes with t
      </label>
    </div>
  );
}
