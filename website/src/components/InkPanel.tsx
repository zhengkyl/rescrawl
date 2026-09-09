import { useApp } from "../context";
import type { InkControl, InkOptions, InkSelect, InkToggle } from "../curves";
import { INK_SECTIONS } from "../curves";

function Slider({
  c,
  options,
  onChange,
}: {
  c: InkControl;
  options: InkOptions;
  onChange: (next: InkOptions) => void;
}) {
  return (
    <label class={`ink-row${c.when ? " ink-dep" : ""}`}>
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

function Toggle({
  c,
  options,
  onChange,
}: {
  c: InkToggle;
  options: InkOptions;
  onChange: (next: InkOptions) => void;
}) {
  return (
    <label class={`ink-toggle${c.when ? " ink-dep" : ""}`}>
      <input
        type="checkbox"
        checked={options[c.key]}
        onInput={(e) => onChange({ ...options, [c.key]: (e.target as HTMLInputElement).checked })}
      />
      {c.label}
    </label>
  );
}

function Select({
  c,
  options,
  onChange,
}: {
  c: InkSelect;
  options: InkOptions;
  onChange: (next: InkOptions) => void;
}) {
  return (
    <label class={`ink-row${c.when ? " ink-dep" : ""}`}>
      <span class="ink-label">{c.label}</span>
      <select
        class="ink-select"
        value={options[c.key]}
        onChange={(e) => onChange({ ...options, [c.key]: (e.target as HTMLSelectElement).value })}
      >
        {c.choices.map((ch) => (
          <option key={ch.value} value={ch.value}>
            {ch.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// One `.panel-section` per entry of INK_SECTIONS. Knobs whose `when` is false
// are not rendered at all, so a switched-off feature takes one line.
export function InkPanel() {
  const { inkOptions: options, setInkOptions: onChange } = useApp();
  return (
    <>
      {INK_SECTIONS.map((section) => (
        <div class="panel-section" key={section.label}>
          <div class="section-label">{section.label}</div>
          {section.items
            .filter((c) => !c.when || c.when(options))
            .map((c) =>
              c.kind === "range" ? (
                <Slider key={c.key} c={c} options={options} onChange={onChange} />
              ) : c.kind === "select" ? (
                <Select key={c.key} c={c} options={options} onChange={onChange} />
              ) : (
                <Toggle key={c.key} c={c} options={options} onChange={onChange} />
              ),
            )}
        </div>
      ))}
    </>
  );
}
