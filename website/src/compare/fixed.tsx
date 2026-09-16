import type { Point3 } from "rescrawl";
import { centerlineStages, fitCurve, RENDER_DEFAULTS } from "rescrawl";
import { fitPath } from "rescrawl/svg";
import { GroupLabel, Slider } from "./controls";

// rescrawl's centerline alone: the width pinned so every disc is the same size,
// the fitted nodes as one open path, and SVG's own stroke with round caps and
// joins standing in for the outline. No envelope, no greedy walk.

type Stroke = Point3[];

export type FixedOptions = {
  width: number;
  smoothWindow: number;
  fitTol: number;
  fitCornerAngle: number;
  fitWindow: number;
  fitHorizon: number;
};

export const FIXED_DEFAULTS: FixedOptions = {
  width: RENDER_DEFAULTS.maxWidth,
  smoothWindow: RENDER_DEFAULTS.smoothWindow,
  fitTol: RENDER_DEFAULTS.fitTol,
  fitCornerAngle: RENDER_DEFAULTS.fitCornerAngle,
  fitWindow: RENDER_DEFAULTS.fitWindow,
  fitHorizon: RENDER_DEFAULTS.fitHorizon,
};

export function fixedPath(stroke: Stroke, o: FixedOptions): string {
  if (stroke.length === 0) return "";
  // min = max width holds the radius constant whatever the pen's speed.
  const { distinct } = centerlineStages(stroke, {
    minWidth: o.width,
    maxWidth: o.width,
    smoothWindow: o.smoothWindow,
  });
  const nodes = fitCurve(distinct, {
    maxWidth: o.width,
    fitTol: o.fitTol,
    fitCornerAngle: o.fitCornerAngle,
    fitWindow: o.fitWindow,
    fitHorizon: o.fitHorizon,
  });
  // A tap leaves one node, and a bare moveto strokes nothing; a zero-length
  // segment is what gets the round caps drawn as a dot.
  if (nodes.length === 1) return `M${nodes[0].x} ${nodes[0].y}h0`;
  return fitPath(nodes);
}

export function FixedSettings({
  options,
  onChange,
}: {
  options: FixedOptions;
  onChange: (next: FixedOptions) => void;
}) {
  const set = (key: keyof FixedOptions) => (v: number) => onChange({ ...options, [key]: v });
  return (
    <>
      <GroupLabel>Width</GroupLabel>
      <Slider
        label="width"
        value={options.width}
        min={1}
        max={40}
        step={0.5}
        onInput={set("width")}
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
    </>
  );
}
