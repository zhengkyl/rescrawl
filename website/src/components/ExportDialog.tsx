import { useRef, useEffect, useState } from 'preact/hooks';
import { useApp } from '../context';
import { INK_COLOR, renderInk } from '../curves';
import { useCanvasView } from '../hooks/useCanvasView';
import { reframe, serialize, serializeBallpoint, strokesBounds } from '../utils';
import { drawLine } from './strokeRender';

const DEFAULT_PADDING = 40;

export function ExportDialog() {
  const { store, inkOptions, exportOpen: open, setExportOpen } = useApp();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [filename, setFilename] = useState('');
  const [padding, setPadding] = useState(DEFAULT_PADDING);
  const [gzip, setGzip] = useState(false);
  const [ballpoint, setBallpoint] = useState(false);

  // Preview camera: left-drag pans (button 0) since there's no drawing here.
  const view = useCanvasView(store.strokes, 0);
  const bounds = strokesBounds(store.strokes);

  const onClose = () => setExportOpen(false);

  function handleExport(name: string, useGzip: boolean, useBallpoint: boolean) {
    const effective = reframe(store.strokes, padding);
    const text = useBallpoint ? serializeBallpoint(effective) : serialize(effective);
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + (useGzip ? '.scrawl.gz' : '.scrawl');
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  }

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (open) {
      setFilename('');
      setGzip(false);
      setBallpoint(false);
      dialog.showModal();
      view.fitToView(); // svg now laid out; frame the strokes
    } else {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    handleExport(filename.trim() || 'drawing', gzip, ballpoint);
  }

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div class="dialog-field">
          <label>Preview <span class="preview-hint">scroll to zoom · drag to pan</span></label>
          <div class="preview-wrap">
            <svg ref={view.svgRef} class="export-preview">
              <g ref={view.viewportRef}>
                {store.strokes.map((s, i) => drawLine(renderInk(s, inkOptions, Infinity), i, INK_COLOR))}
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
          <label>
            <input type="checkbox" id="export-gzip" checked={gzip} onChange={(e) => setGzip((e.target as HTMLInputElement).checked)} />
            {' '}Gzip compression
          </label>
        </div>
        <div class="dialog-field">
          <label>
            <input type="checkbox" id="export-ballpoint" checked={ballpoint} onChange={(e) => setBallpoint((e.target as HTMLInputElement).checked)} />
            {' '}Ballpoint mode (omit pressure)
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
