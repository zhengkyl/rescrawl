import type { CornerOptions } from "./centerline/corner.ts";
import type { FitOptions } from "./centerline/fit.ts";
import type { PressureOptions } from "./brush/pressure.ts";
import type { RetimeOptions } from "./centerline/retime.ts";
import type { SmoothOptions } from "./centerline/smooth.ts";
import type { LineBrushOptions } from "./brush/LineBrush.ts";
import type { RadiiOptions } from "./brush/radius.ts";

// lengths are screen px at `zoom`, screen px per drawing px
export type InkOptions = SmoothOptions &
  RetimeOptions &
  CornerOptions &
  FitOptions &
  PressureOptions &
  RadiiOptions &
  LineBrushOptions & {
    zoom?: number;
    // "auto": the points' own pressure when they carry one, else from speed
    pressure?: "auto" | "speed";
  };

export const INK_DEFAULTS: Required<InkOptions> = {
  zoom: 1,
  smoothWindow: 4,
  minMove: 1,
  framePeriod: 1000 / 60,
  lookahead: 8,
  tolerance: 0.5,
  refitRounds: 2,
  settleTime: 100,
  pressure: "auto",
  thinSpeed: 0.5,
  minWidth: 8,
  maxWidth: 16,
  widthLag: 80,
  width: 2,
};

// a spread would copy an undefined over its default
export function withDefaults(options: InkOptions): Required<InkOptions> {
  const o: Record<string, unknown> = { ...INK_DEFAULTS };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) o[k] = v;
  return o as Required<InkOptions>;
}
