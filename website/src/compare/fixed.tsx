import type { Point3 } from "rescrawl";
import { centerlineStages, fitCenterline, RENDER_DEFAULTS } from "rescrawl";
import { fitPath } from "rescrawl/svg";
import { GroupLabel, Slider } from "./controls";

// rescrawl's centerline alone: the width pinned so every disc is the same size,
// the fitted nodes as one open path, and SVG's own stroke with round caps and
// joins standing in for the outline. No envelope, no greedy walk.

type Stroke = Point3[];

export type FixedOptions = {
  width: number;
  smoothWindow: number;
  handTol: number;
  reparam: number;
};

export const FIXED_DEFAULTS: FixedOptions = {
  width: RENDER_DEFAULTS.maxWidth,
  smoothWindow: RENDER_DEFAULTS.smoothWindow,
  handTol: RENDER_DEFAULTS.handTol,
  reparam: RENDER_DEFAULTS.reparam,
};

export function fixedPath(stroke: Stroke, o: FixedOptions): string {
  if (stroke.length === 0) return "";
  // min = max width holds the radius constant whatever the pen's speed.
  const options = {
    minWidth: o.width,
    maxWidth: o.width,
    smoothWindow: o.smoothWindow,
    handTol: o.handTol,
    reparam: o.reparam,
  };
  const nodes = fitCenterline(centerlineStages(stroke, options), options);
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
    </>
  );
}
