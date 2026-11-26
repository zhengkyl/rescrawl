import { useApp } from "../context";
import type { BrushSettings, StrokeStyle } from "../stroke";
import { Slider } from "./Knobs";

const COLORS = [
  { hex: "#1a1a1a", name: "Black" },
  { hex: "#8b8d98", name: "Gray" },
  { hex: "#e5484d", name: "Red" },
  { hex: "#f76b15", name: "Orange" },
  { hex: "#ffc53d", name: "Yellow" },
  { hex: "#30a46c", name: "Green" },
  { hex: "#0090ff", name: "Blue" },
  { hex: "#8e4ec6", name: "Purple" },
];

export const SIZE_RANGE: Record<StrokeStyle, { min: number; max: number; step: number }> = {
  pen: { min: 0.5, max: 20, step: 0.5 },
  brush: { min: 1, max: 60, step: 1 },
};

// the size and color of a drawing tool, at the top of its drawer
export function BrushControls({ style }: { style: StrokeStyle }) {
  const { brushes, setBrushes } = useApp();
  const { size, color } = brushes[style];
  const set = (patch: Partial<BrushSettings>) =>
    setBrushes((b) => ({ ...b, [style]: { ...b[style], ...patch } }));
  const custom = !COLORS.some((c) => c.hex === color);
  return (
    <>
      <Slider label="size" {...SIZE_RANGE[style]} value={size} onInput={(v) => set({ size: v })} />
      <div class="swatches" role="group" aria-label="Color">
        {COLORS.map((c) => (
          <button
            key={c.hex}
            class={`swatch${c.hex === color ? " on" : ""}`}
            style={{ background: c.hex }}
            title={c.name}
            aria-label={c.name}
            aria-pressed={c.hex === color}
            onClick={() => set({ color: c.hex })}
          />
        ))}
        <label
          class={`swatch custom${custom ? " on" : ""}`}
          title="Any color"
          style={custom ? { background: color } : {}}
        >
          <input
            type="color"
            value={color}
            onInput={(e) => set({ color: (e.target as HTMLInputElement).value })}
            aria-label="Any color"
          />
        </label>
      </div>
    </>
  );
}
