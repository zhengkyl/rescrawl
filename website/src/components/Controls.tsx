import { useRef } from 'preact/hooks';

type Props = {
  guidelines: boolean;
  onGuidelinesChange: (v: boolean) => void;
  hasStrokes: boolean;
  onImport: (file: File) => void;
  onExportOpen: () => void;
  onSettingsOpen: () => void;
};

export function Controls({
  guidelines, onGuidelinesChange,
  hasStrokes, onImport, onExportOpen, onSettingsOpen,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div id="controls">
      <div class="btn-row">
        <button id="btn-settings" onClick={onSettingsOpen}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
            <path d="M9.7 4.1a2.3 2.3 0 0 1 4.6 0 2.3 2.3 0 0 0 3.3 2 2.3 2.3 0 0 1 2.4 4 2.3 2.3 0 0 0 0 3.8 2.3 2.3 0 0 1-2.4 4 2.3 2.3 0 0 0-3.3 2 2.3 2.3 0 0 1-4.6 0 2.3 2.3 0 0 0-3.3-2A2.3 2.3 0 0 1 4 14a2.3 2.3 0 0 0 0-3.8 2.3 2.3 0 0 1 2.3-4 2.3 2.3 0 0 0 3.4-2"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button id="btn-import" onClick={() => fileInputRef.current!.click()}>Import</button>
        <button id="btn-export" disabled={!hasStrokes} onClick={onExportOpen}>Export</button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".scrawl,.scrawl.gz"
        style="display:none"
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) { onImport(file); (e.target as HTMLInputElement).value = ''; }
        }}
      />
      <div class="section-label">Canvas</div>
      <label class="check-row">
        <input type="checkbox" id="chk-guidelines" checked={guidelines}
          onChange={(e) => onGuidelinesChange((e.target as HTMLInputElement).checked)} />
        {' '}Guidelines
      </label>
    </div>
  );
}
