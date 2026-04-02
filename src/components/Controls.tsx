import { useRef } from 'preact/hooks';
import type { Transforms } from './App';

type Props = {
  transforms: Transforms;
  onTransformsChange: (t: Transforms) => void;
  onAlignApply: () => void;
  guidelines: boolean;
  onGuidelinesChange: (v: boolean) => void;
  hasStrokes: boolean;
  onImport: (file: File) => void;
  onExportOpen: () => void;
  onSettingsOpen: () => void;
};

export function Controls({
  transforms, onTransformsChange, onAlignApply,
  guidelines, onGuidelinesChange,
  hasStrokes, onImport, onExportOpen, onSettingsOpen,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Transforms>) => onTransformsChange({ ...transforms, ...patch });

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
      <div class="section-label">Transformations</div>
      <div class="btn-row">
        <button id="btn-smooth" class={transforms.smooth ? 'active' : ''} onClick={() => set({ smooth: !transforms.smooth })}>Smooth</button>
        <input type="number" id="smooth-input" value={transforms.smoothPasses} min={1} title="Smooth passes"
          onInput={(e) => set({ smoothPasses: +(e.target as HTMLInputElement).value })} />
      </div>
      <div class="btn-row">
        <button id="btn-cap-dt" class={transforms.capDt ? 'active' : ''} onClick={() => set({ capDt: !transforms.capDt })}>Cap dt</button>
        <input type="number" id="cap-dt-input" value={transforms.capDtMax} min={1} title="Max dt (ms)"
          onInput={(e) => set({ capDtMax: +(e.target as HTMLInputElement).value })} />
      </div>
      <div class="section-label">Layout</div>
      <div class="btn-row">
        <button id="btn-align" class={transforms.align ? 'active' : ''} onClick={() => set({ align: !transforms.align })}>Align</button>
      </div>
      <div class="btn-row">
        <input type="number" id="pad-x-input" value={transforms.padX} min={0} title="Padding x (px)" placeholder="x"
          onInput={(e) => set({ padX: +(e.target as HTMLInputElement).value })} />
        <input type="number" id="pad-y-input" value={transforms.padY} min={0} title="Padding y (px)" placeholder="y"
          onInput={(e) => set({ padY: +(e.target as HTMLInputElement).value })} />
      </div>
      <div class="btn-row">
        <button id="btn-align-apply" disabled={!transforms.align} onClick={onAlignApply}>Apply</button>
      </div>
    </div>
  );
}
