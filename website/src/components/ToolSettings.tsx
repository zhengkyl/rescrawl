import { type Tool, useApp } from "../context";
import { INK_DEFAULTS, type InkOptions } from "../ink";
import { REPLAY_DEFAULTS } from "../stroke";
import { BrushControls } from "./Brushes";
import { type Knob, Slider } from "./Knobs";

const BRUSH_KNOBS: Knob[] = [
  { key: "thinnest", label: "thinnest (of size)", min: 0.05, max: 1, step: 0.05 },
  { key: "thinSpeed", label: "thin speed (screen px/ms)", min: 0.05, max: 4, step: 0.05 },
  { key: "widthLag", label: "width lag (ms)", min: 2, max: 300, step: 1 },
];

function resetInk(o: InkOptions, keys: (keyof InkOptions)[]): InkOptions {
  return { ...o, ...Object.fromEntries(keys.map((k) => [k, INK_DEFAULTS[k]])) };
}

export function ToolSettings({ tool }: { tool: Tool }) {
  const { inkOptions, setInkOptions, replay } = useApp();
  if (tool === "brush") {
    return (
      <>
        <BrushControls style="brush" />
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
        {BRUSH_KNOBS.map((k) => (
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
        <button
          onClick={() =>
            setInkOptions((o) => resetInk(o, ["pressure", ...BRUSH_KNOBS.map((k) => k.key)]))
          }
        >
          Reset
        </button>
      </>
    );
  }
  if (tool === "replay") {
    return (
      <>
        <Slider
          label="longest pause (ms)"
          min={0}
          max={5000}
          step={100}
          value={replay.value.maxPause}
          onInput={(v) => (replay.value = { ...replay.value, maxPause: v })}
        />
        <button onClick={() => (replay.value = { ...REPLAY_DEFAULTS })}>Reset</button>
      </>
    );
  }
  if (tool === "pen") return <BrushControls style="pen" />;
  return <p class="note">Click or drag to select strokes; Shift adds to the selection.</p>;
}
