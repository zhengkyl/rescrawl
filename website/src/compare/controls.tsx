// Dumb widgets for the per-canvas settings. They know nothing about any
// engine's options — each engine's panel wires its own keys to them, so the
// two panels stay independent of each other.

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onInput,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onInput: (v: number) => void;
}) {
  return (
    <label class="knob">
      <span class="knob-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onInput(+(e.target as HTMLInputElement).value)}
      />
      <span class="knob-value">{value}</span>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onInput,
}: {
  label: string;
  checked: boolean;
  onInput: (v: boolean) => void;
}) {
  return (
    <label class="knob-toggle">
      <input
        type="checkbox"
        checked={checked}
        onInput={(e) => onInput((e.target as HTMLInputElement).checked)}
      />
      {label}
    </label>
  );
}

export function Select({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label class="knob">
      <span class="knob-label">{label}</span>
      <select
        class="knob-select"
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function GroupLabel({ children }: { children: string }) {
  return <div class="knob-group">{children}</div>;
}
