import { useApp } from '../context';
import type { InkControl, InkOptions } from '../curves';
import { INK_CONTROLS, INK_TOGGLES } from '../curves';

function Slider({ c, options, onChange }: {
  c: InkControl;
  options: InkOptions;
  onChange: (next: InkOptions) => void;
}) {
  return (
    <label class="ink-row">
      <span class="ink-label">{c.label}</span>
      <input
        type="range"
        min={c.min}
        max={c.max}
        step={c.step}
        value={options[c.key]}
        onInput={(e) => onChange({ ...options, [c.key]: +(e.target as HTMLInputElement).value })}
      />
      <span class="ink-value">{options[c.key]}</span>
    </label>
  );
}

export function InkPanel() {
  const { inkOptions: options, setInkOptions: onChange } = useApp();
  return (
    <>
      <div class="section-label">Ink</div>
      {INK_CONTROLS.map(c => <Slider key={c.key} c={c} options={options} onChange={onChange} />)}
      {INK_TOGGLES.map(c => (
        <label class="ink-toggle" key={c.key}>
          <input
            type="checkbox"
            checked={options[c.key]}
            onInput={(e) => onChange({ ...options, [c.key]: (e.target as HTMLInputElement).checked })}
          />
          {c.label}
        </label>
      ))}
    </>
  );
}
