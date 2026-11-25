import { useApp } from "../context";
import { INK_DEFAULTS, type InkOptions } from "../ink";

type NumberKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

type Knob = {
  key: NumberKeys<InkOptions>;
  label: string;
  min: number;
  max: number;
  step: number;
};

const KNOB_SECTIONS: { label: string; knobs: Knob[] }[] = [
  {
    label: "Pen",
    knobs: [{ key: "width", label: "width (screen px)", min: 0.5, max: 20, step: 0.5 }],
  },
  {
    label: "Brush",
    knobs: [
      { key: "minWidth", label: "min width (screen px)", min: 1, max: 20, step: 0.5 },
      { key: "maxWidth", label: "max width (screen px)", min: 1, max: 40, step: 0.5 },
      { key: "thinSpeed", label: "thin speed (screen px/ms)", min: 0.05, max: 4, step: 0.05 },
      { key: "widthLag", label: "width lag (ms)", min: 2, max: 300, step: 1 },
    ],
  },
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

export function Knobs() {
  const { inkOptions, setInkOptions } = useApp();
  return (
    <div id="knobs">
      <label class="toggle">
        <input
          type="checkbox"
          checked={inkOptions.pressure === "auto"}
          onChange={(e) =>
            setInkOptions((o) => ({
              ...o,
              pressure: (e.target as HTMLInputElement).checked ? "auto" : "speed",
            }))
          }
        />
        pen pressure, where a stylus recorded it
      </label>
      {KNOB_SECTIONS.map((section) => (
        <section key={section.label}>
          <h2>{section.label}</h2>
          {section.knobs.map((k) => (
            <label class="knob" key={k.key}>
              <span>{k.label}</span>
              <input
                type="range"
                min={k.min}
                max={k.max}
                step={k.step}
                value={inkOptions[k.key]}
                onInput={(e) =>
                  setInkOptions((o) => ({ ...o, [k.key]: +(e.target as HTMLInputElement).value }))
                }
              />
              <output>{inkOptions[k.key]}</output>
            </label>
          ))}
        </section>
      ))}
      <button onClick={() => setInkOptions({ ...INK_DEFAULTS })}>Reset to defaults</button>
    </div>
  );
}
