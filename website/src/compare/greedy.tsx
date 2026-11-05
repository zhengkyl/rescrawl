import type { Point3, RenderOptions } from "rescrawl";
import { RENDER_DEFAULTS, renderStroke } from "rescrawl";
import { outlinePath } from "rescrawl/svg";
import { GroupLabel, Slider } from "./controls";

// rescrawl's own pipeline in full (smoothing, retime, radius from speed, the
// fit, the greedy outline) with every knob it takes.

type Stroke = Point3[];

export type GreedyOptions = Required<RenderOptions>;

export const GREEDY_DEFAULTS: GreedyOptions = {
  ...RENDER_DEFAULTS,
  outline: "greedy",
};

export function greedyPath(stroke: Stroke, o: GreedyOptions): string {
  if (stroke.length === 0) return "";
  return outlinePath(renderStroke(stroke, o).outline);
}

// Numeric knobs only — the outline is pinned on this canvas.
type NumberKey = {
  [K in keyof GreedyOptions]-?: GreedyOptions[K] extends number ? K : never;
}[keyof GreedyOptions];

export function GreedySettings({
  options,
  onChange,
}: {
  options: GreedyOptions;
  onChange: (next: GreedyOptions) => void;
}) {
  const set = (key: NumberKey) => (v: number) => onChange({ ...options, [key]: v });
  return (
    <>
      <GroupLabel>Width</GroupLabel>
      {/* min 1, not 0: log-space width smoothing has no representation for zero width. */}
      <Slider
        label="min width"
        value={options.minWidth}
        min={1}
        max={20}
        step={0.5}
        onInput={set("minWidth")}
      />
      <Slider
        label="max width"
        value={options.maxWidth}
        min={1}
        max={40}
        step={0.5}
        onInput={set("maxWidth")}
      />
      <Slider
        label="thin speed (screen px/ms)"
        value={options.thinSpeed}
        min={0.05}
        max={4}
        step={0.05}
        onInput={set("thinSpeed")}
      />
      <Slider
        label="width lag (ms)"
        value={options.widthLag}
        min={2}
        max={300}
        step={1}
        onInput={set("widthLag")}
      />

      <GroupLabel>Centerline</GroupLabel>
      <Slider
        label="smooth window (screen px)"
        value={options.smoothWindow}
        min={0}
        max={16}
        step={0.5}
        onInput={set("smoothWindow")}
      />

      <GroupLabel>Fit</GroupLabel>
      <Slider
        label="hand tol (screen px)"
        value={options.handTol}
        min={0}
        max={8}
        step={0.05}
        onInput={set("handTol")}
      />
      <Slider
        label="reparam (rounds)"
        value={options.reparam}
        min={0}
        max={10}
        step={1}
        onInput={set("reparam")}
      />

      <GroupLabel>Outline</GroupLabel>
      <Slider
        label="outline tol (screen px)"
        value={options.outlineTol}
        min={0.04}
        max={2}
        step={0.01}
        onInput={set("outlineTol")}
      />
      <Slider
        label="outline horizon (screen px)"
        value={options.outlineHorizon}
        min={4}
        max={160}
        step={2}
        onInput={set("outlineHorizon")}
      />
    </>
  );
}
