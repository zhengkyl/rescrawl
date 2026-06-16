import { useApp } from '../context';

export function StrokeList() {
  const { store } = useApp();
  const {
    strokes, selectedStroke, insertionPoint,
    select: setSelectedStroke,
    setInsertion: setInsertionPoint,
    deleteStroke, swapStrokes, editFirstPoint,
  } = store;

  if (strokes.length === 0) {
    return <div id="stroke-list"><div id="no-strokes">No strokes yet</div></div>;
  }

  const items: preact.ComponentChildren[] = [];

  items.push(
    <div
      key="cursor-0"
      class={'stroke-cursor' + (insertionPoint === 0 ? ' active' : '')}
      onClick={() => setInsertionPoint(0)}
    />
  );

  strokes.forEach((stroke, i) => {
    const { x, y, t } = stroke[0];
    items.push(
      <div
        key={`stroke-${i}`}
        class={'stroke-row' + (i === selectedStroke ? ' selected' : '')}
        onClick={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          setSelectedStroke(selectedStroke === i ? null : i);
        }}
      >
        <div class="stroke-header">
          <div class="stroke-label">Stroke {i + 1}</div>
          <div class="stroke-actions">
            <button class="btn-move-up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); swapStrokes(i - 1); }}>↑</button>
            <button class="btn-move-down" disabled={i === strokes.length - 1} onClick={(e) => { e.stopPropagation(); swapStrokes(i); }}>↓</button>
            <button class="btn-delete" onClick={(e) => { e.stopPropagation(); deleteStroke(i); }}>×</button>
          </div>
        </div>
        <div class="stroke-fields">
          {(['x', 'y', 't'] as const).map(field => (
            <label key={field}>
              {field}
              <input
                type="number"
                value={field === 'x' ? x : field === 'y' ? y : t}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => editFirstPoint(i, field, +(e.target as HTMLInputElement).value)}
              />
            </label>
          ))}
        </div>
      </div>
    );
    items.push(
      <div
        key={`cursor-${i + 1}`}
        class={'stroke-cursor' + (insertionPoint === i + 1 ? ' active' : '')}
        onClick={() => setInsertionPoint(i + 1)}
      />
    );
  });

  return <div id="stroke-list">{items}</div>;
}
