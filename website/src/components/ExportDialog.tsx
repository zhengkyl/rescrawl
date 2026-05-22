import { useRef, useEffect, useState } from 'preact/hooks';

type Props = {
  open: boolean;
  onClose: () => void;
  onExport: (filename: string, gzip: boolean, ballpoint: boolean) => void;
};

export function ExportDialog({ open, onClose, onExport }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [filename, setFilename] = useState('');
  const [gzip, setGzip] = useState(false);
  const [ballpoint, setBallpoint] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (open) {
      setFilename('');
      setGzip(false);
      setBallpoint(false);
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    onExport(filename.trim() || 'drawing', gzip, ballpoint);
  }

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <form onSubmit={handleSubmit}>
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
          <label>
            <input type="checkbox" id="export-gzip" checked={gzip} onChange={(e) => setGzip((e.target as HTMLInputElement).checked)} />
            {' '}Gzip compression
          </label>
        </div>
        <div class="dialog-field">
          <label>
            <input type="checkbox" id="export-ballpoint" checked={ballpoint} onChange={(e) => setBallpoint((e.target as HTMLInputElement).checked)} />
            {' '}Ballpoint mode (omit pressure/tilt)
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
