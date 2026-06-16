import { useRef } from 'preact/hooks';
import { useApp } from '../context';
import { getDefaultStrategies } from '../curves';
import { deserialize } from '../utils';

export function Controls() {
  const { config, setConfig, store, replay, live, setStrategies, setExportOpen, setSettingsOpen } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasStrokes = store.strokes.length > 0;

  async function handleImport(file: File) {
    const text = await file.text();
    replay.stop();
    const imported = deserialize(text);
    const lastT = imported.reduce((m, st) => st.reduce((mm, pt) => Math.max(mm, pt.t), m), 0);
    live.reset(lastT); // continue the live clock from the imported end
    setStrategies(getDefaultStrategies());
    store.replaceAll(imported);
  }

  return (
    <div id="controls">
      <div class="btn-row">
        <button id="btn-settings" onClick={() => setSettingsOpen(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
            <path d="M9.7 4.1a2.3 2.3 0 0 1 4.6 0 2.3 2.3 0 0 0 3.3 2 2.3 2.3 0 0 1 2.4 4 2.3 2.3 0 0 0 0 3.8 2.3 2.3 0 0 1-2.4 4 2.3 2.3 0 0 0-3.3 2 2.3 2.3 0 0 1-4.6 0 2.3 2.3 0 0 0-3.3-2A2.3 2.3 0 0 1 4 14a2.3 2.3 0 0 0 0-3.8 2.3 2.3 0 0 1 2.3-4 2.3 2.3 0 0 0 3.4-2" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button id="btn-import" onClick={() => fileInputRef.current!.click()}>Import</button>
        <button id="btn-export" disabled={!hasStrokes} onClick={() => setExportOpen(true)}>Export</button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".scrawl"
        style="display:none"
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) { handleImport(file); (e.target as HTMLInputElement).value = ''; }
        }}
      />
      <div class="section-label">Canvas</div>
      <label class="check-row">
        <input type="checkbox" id="chk-guidelines" checked={config.guidelines}
          onChange={(e) => setConfig(c => ({ ...c, guidelines: (e.target as HTMLInputElement).checked }))} />
        {' '}Guidelines
      </label>
    </div>
  );
}
