import type { Point3, RenderOptions } from "rescrawl";
import { RENDER_DEFAULTS, renderStroke } from "rescrawl";
import { outlinePath } from "rescrawl/svg";
import { GroupLabel, Slider } from "./controls";

// rescrawl's own engine: the full pipeline (radius from speed, smoothing,
// distinct discs, fit, greedy outline) with every knob it takes.

type Stroke = Point3[];

export type GreedyOptions = Required<RenderOptions>;

export const GREEDY_DEFAULTS: GreedyOptions = { ...RENDER_DEFAULTS, engine: "greedy" };

export function greedyPath(stroke: Stroke, o: GreedyOptions): string {
  if (stroke.length === 0) return "";
  return outlinePath(renderStroke(stroke, o).outline);
}

// Numeric knobs only — `engine` is pinned to greedy on this canvas.
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
        label="thin speed (px/ms)"
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
        label="smooth window (pts)"
        value={options.smoothWindow}
        min={0}
        max={15}
        step={1}
        onInput={set("smoothWindow")}
      />

      <GroupLabel>Fit</GroupLabel>
      <Slider
        label="fit tol (xr)"
        value={options.fitTol}
        min={0}
        max={1}
        step={0.01}
        onInput={set("fitTol")}
      />
      <Slider
        label="corner angle (deg)"
        value={options.fitCornerAngle}
        min={10}
        max={180}
        step={1}
        onInput={set("fitCornerAngle")}
      />
      <Slider
        label="fit window (x pen)"
        value={options.fitWindow}
        min={0.1}
        max={5}
        step={0.05}
        onInput={set("fitWindow")}
      />
      <Slider
        label="fit horizon (x pen)"
        value={options.fitHorizon}
        min={0.5}
        max={50}
        step={0.25}
        onInput={set("fitHorizon")}
      />

      <GroupLabel>Outline</GroupLabel>
      <Slider
        label="outline tol (x pen)"
        value={options.outlineTol}
        min={0.005}
        max={0.25}
        step={0.005}
        onInput={set("outlineTol")}
      />
      <Slider
        label="outline horizon (x pen)"
        value={options.outlineHorizon}
        min={0.5}
        max={20}
        step={0.25}
        onInput={set("outlineHorizon")}
      />
    </>
  );
}
