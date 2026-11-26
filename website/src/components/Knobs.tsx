import { useApp } from "../context";
import { INK_DEFAULTS, type InkOptions } from "../ink";

type NumberKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

export type Knob = {
  key: NumberKeys<InkOptions>;
  label: string;
  min: number;
  max: number;
  step: number;
};

const KNOB_SECTIONS: { label: string; knobs: Knob[] }[] = [
  {
    label: "Centerline",
    knobs: [
      // a sample this close to the last one kept is the pen not having moved
      { key: "minMove", label: "min move (screen px)", min: 0, max: 6, step: 0.1 },
      // dense stretches pulled, sparse ones barely touched
      { key: "smoothWindow", label: "smooth window (screen px)", min: 0, max: 16, step: 0.5 },
      { key: "lookahead", label: "lookahead (screen px)", min: 0, max: 32, step: 0.5 },
    ],
  },
  {
    label: "Fit",
    knobs: [
      // the open segment under the pen stops refitting once the pen is this far past its start
      { key: "settleTime", label: "settle time (ms)", min: 20, max: 1000, step: 10 },
      { key: "refitRounds", label: "refit rounds", min: 0, max: 10, step: 1 },
      // how far a sample may lie off the segment that skips it
      { key: "tolerance", label: "tolerance (screen px)", min: 0.05, max: 8, step: 0.05 },
    ],
  },
];

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onInput,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (v: number) => void;
}) {
  return (
    <label class="knob">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onInput(+(e.target as HTMLInputElement).value)}
      />
      <output>{value}</output>
    </label>
  );
}

// the fit both the pen and the brush draw from
export function Knobs() {
  const { inkOptions, setInkOptions } = useApp();
  const keys = KNOB_SECTIONS.flatMap((s) => s.knobs.map((k) => k.key));
  return (
    <div id="knobs">
      {KNOB_SECTIONS.map((section) => (
        <section key={section.label}>
          <h2>{section.label}</h2>
          {section.knobs.map((k) => (
            <Slider
              key={k.key}
              label={k.label}
              min={k.min}
              max={k.max}
              step={k.step}
              value={inkOptions[k.key]}
              onInput={(v) => setInkOptions((o) => ({ ...o, [k.key]: v }))}
            />
          ))}
        </section>
      ))}
      <button
        onClick={() =>
          setInkOptions((o) => ({
            ...o,
            ...Object.fromEntries(keys.map((k) => [k, INK_DEFAULTS[k]])),
          }))
        }
      >
        Reset to defaults
      </button>
    </div>
  );
}
