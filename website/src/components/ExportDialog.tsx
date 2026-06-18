import { useRef, useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../context';
import { INK_COLOR, renderInk } from '../curves';
import { useCanvasView } from '../hooks/useCanvasView';
import { countPoints, reframe, serialize, simplifyStrokes, strokesBounds } from '../utils';
import { drawLine } from './strokeRender';

const DEFAULT_PADDING = 40;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ExportDialog() {
  const { store, inkOptions, setExportOpen } = useApp();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [filename, setFilename] = useState('');
  const [padding, setPadding] = useState(DEFAULT_PADDING);
  const [simplify, setSimplify] = useState(0);
  const [ballpoint, setBallpoint] = useState(false);
  const [relative, setRelative] = useState(false);

  // Preview camera: left-drag pans (button 0) since there's no drawing here.
  const view = useCanvasView(store.strokes, 0);

  // Simplify drives both the preview and the exported file, so derive once.
  const simplified = useMemo(() => simplifyStrokes(store.strokes, simplify), [store.strokes, simplify]);
  const bounds = strokesBounds(simplified);
  const text = useMemo(() => {
    const effective = reframe(simplified, padding);
    return serialize(effective, { ballpoint, relative });
  }, [simplified, padding, ballpoint, relative]);
  const fileSize = useMemo(() => new TextEncoder().encode(text).length, [text]);

  const onClose = () => setExportOpen(false);

  function handleExport(name: string) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.scrawl';
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  }

  // Mounted only while open (see Workspace), so this fires once: enter the top
  // layer and frame the strokes. Fields default via useState, so no reset needed;
  // closing (Esc, Cancel, or Export) clears `exportOpen`, which unmounts us.
  useEffect(() => {
    dialogRef.current!.showModal();
    view.fitToView(); // svg now laid out; frame the strokes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    handleExport(filename.trim() || 'drawing');
  }

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <form class="export-form" onSubmit={handleSubmit}>
        <div class="dialog-field">
          <label>Preview <span class="preview-hint">scroll to zoom · drag to pan</span></label>
          <div class="preview-wrap">
            <svg ref={view.svgRef} class="export-preview">
              <g ref={view.viewportRef}>
                {simplified.map((s, i) => drawLine(renderInk(s, inkOptions, Infinity), i, INK_COLOR))}
                {bounds && (
                  <rect
                    x={bounds.minX - padding}
                    y={bounds.minY - padding}
                    width={bounds.maxX - bounds.minX + 2 * padding}
                    height={bounds.maxY - bounds.minY + 2 * padding}
                    fill="none" stroke="#4f8ef7" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"
                  />
                )}
              </g>
            </svg>
            <button type="button" class="preview-reset" title="Reset view" onClick={() => view.fitToView()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
            </button>
          </div>
        </div>
        <div class="dialog-field">
          <label for="export-filename">Filename</label>
          <input
            type="text"
            id="export-filename"
            placeholder="drawing"
            spellcheck={false}
            value={filename}
            onInput={(e) => setFilename((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="dialog-field">
          <label for="export-padding">Padding</label>
          <input
            type="number"
            id="export-padding"
            min={0}
            value={padding}
            onInput={(e) => setPadding(+(e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="dialog-field">
          <label for="export-simplify">
            Simplify
            <span class="field-value">{simplify.toFixed(2)} px</span>
          </label>
          <input
            type="range"
            id="export-simplify"
            min={0}
            max={5}
            step={0.05}
            value={simplify}
            onInput={(e) => setSimplify(+(e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="dialog-field export-size">
          <span>{countPoints(simplified).toLocaleString()} points{simplify > 0 && ` (of ${countPoints(store.strokes).toLocaleString()})`}</span>
          <span class="field-value">{formatBytes(fileSize)}</span>
        </div>
        <div class="dialog-field">
          <label>
            <input type="checkbox" id="export-ballpoint" checked={ballpoint} onChange={(e) => setBallpoint((e.target as HTMLInputElement).checked)} />
            {' '}Ballpoint mode (omit pressure)
          </label>
        </div>
        <div class="dialog-field">
          <label>
            <input type="checkbox" id="export-relative" checked={relative} onChange={(e) => setRelative((e.target as HTMLInputElement).checked)} />
            {' '}All points relative (smaller; not re-importable)
          </label>
        </div>
        <div class="dialog-actions">
          <button type="button" id="export-cancel" onClick={onClose}>Cancel</button>
          <button type="submit" id="export-confirm">Export</button>
        </div>
      </form>
    </dialog>
  );
}
