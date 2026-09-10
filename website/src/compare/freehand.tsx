import { getStroke } from "perfect-freehand";
import type { Point3 } from "rescrawl";
import { GroupLabel, Slider, Toggle } from "./controls";

// perfect-freehand, fed the raw pointer samples and nothing else: it brings its
// own streamlining, smoothing and pressure model, so none of rescrawl's
// pipeline runs on this canvas.

type Stroke = Point3[];

export type FreehandOptions = {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
  taper: boolean;
};

export const FREEHAND_DEFAULTS: FreehandOptions = {
  size: 8,
  thinning: 0.5, // width
  streamline: 0.32, // centerline
  smoothing: 0.5, // _outline
  simulatePressure: true,
  taper: false,
};

function r(n: number) {
  return Math.round(n * 100) / 100;
}

// Closed polygon through the midpoints of consecutive points, each point as the
// quadratic control — the standard perfect-freehand path recipe.
function polygonPath(pts: number[][]): string {
  const n = pts.length;
  if (n === 0) return "";
  let d = `M ${r(pts[0][0])},${r(pts[0][1])} Q`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    d += ` ${r(x0)},${r(y0)} ${r((x0 + x1) / 2)},${r((y0 + y1) / 2)}`;
  }
  return d + " Z";
}

export function freehandPath(stroke: Stroke, o: FreehandOptions): string {
  if (stroke.length === 0) return "";
  const polygon = getStroke(
    stroke.map((p) => ({ x: p.x, y: p.y })),
    {
      size: o.size,
      thinning: o.thinning,
      smoothing: o.smoothing,
      streamline: o.streamline,
      simulatePressure: o.simulatePressure,
      start: { taper: o.taper },
      end: { taper: o.taper },
      last: true,
    },
  );
  return polygonPath(polygon);
}

export function FreehandSettings({
  options,
  onChange,
}: {
  options: FreehandOptions;
  onChange: (next: FreehandOptions) => void;
}) {
  return (
    <>
      {/* Sections by pipeline concern, so this panel and the greedy one line up
          knob for knob. perfect-freehand's `streamline` is the only one that
          touches the centerline; `smoothing` softens the outline, not it. */}
      <GroupLabel>Width</GroupLabel>
      <Slider
        label="size"
        value={options.size}
        min={1}
        max={40}
        step={0.5}
        onInput={(v) => onChange({ ...options, size: v })}
      />
      {/* Negative thinning inverts it: faster strokes come out fatter. */}
      <Slider
        label="thinning"
        value={options.thinning}
        min={-1}
        max={1}
        step={0.05}
        onInput={(v) => onChange({ ...options, thinning: v })}
      />
      {/* Off leaves the width fixed at `size`, whatever thinning says. */}
      <Toggle
        label="simulate pressure"
        checked={options.simulatePressure}
        onInput={(v) => onChange({ ...options, simulatePressure: v })}
      />

      <GroupLabel>Centerline</GroupLabel>
      <Slider
        label="streamline"
        value={options.streamline}
        min={0}
        max={1}
        step={0.05}
        onInput={(v) => onChange({ ...options, streamline: v })}
      />

      <GroupLabel>Outline</GroupLabel>
      <Slider
        label="smoothing"
        value={options.smoothing}
        min={0}
        max={1}
        step={0.05}
        onInput={(v) => onChange({ ...options, smoothing: v })}
      />
      <Toggle
        label="taper ends"
        checked={options.taper}
        onInput={(v) => onChange({ ...options, taper: v })}
      />
    </>
  );
}
