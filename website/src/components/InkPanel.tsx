import { useApp } from '../context';
import { INK_CONTROLS } from '../curves';

export function InkPanel() {
  const { inkOptions: options, setInkOptions: onChange } = useApp();
  return (
    <>
      <div class="section-label">Ink</div>
      {INK_CONTROLS.map(c => (
        <label class="ink-row" key={c.key}>
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
      ))}
    </>
  );
}
