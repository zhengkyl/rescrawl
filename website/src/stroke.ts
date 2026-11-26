// `t`: wall-clock ms, as the event stamped it
// `p`: pen pressure, 0 to 1, recorded only from a stylus
export type Point = { x: number; y: number; t: number; p?: number };
export type StrokeStyle = "pen" | "brush";
// at least one point, so [0] and [length - 1] are safe
// `zoom`: screen px per drawing px while drawn, which sets how closely the fit follows the hand
// `size`: the pen's width or the brush's widest, in drawing px
export type Stroke = {
  points: Point[];
  zoom: number;
  style: StrokeStyle;
  size: number;
  color: string;
};

export type BrushSettings = { size: number; color: string };
export const BRUSH_DEFAULTS: Record<StrokeStyle, BrushSettings> = {
  pen: { size: 2, color: "#1a1a1a" },
  brush: { size: 16, color: "#1a1a1a" },
};
export const BRUSHES_STORAGE_KEY = "rescrawl-brushes-1";

export const eventTime = (e: Event): number => performance.timeOrigin + e.timeStamp;
export const timeNow = (): number => performance.timeOrigin + performance.now();

export const strokeStart = (s: Stroke): number => s.points[0].t;
export const strokeEnd = (s: Stroke): number => s.points[s.points.length - 1].t;

export type ReplayOptions = { maxPause: number };
export const REPLAY_DEFAULTS: ReplayOptions = { maxPause: 1000 };
export const REPLAY_STORAGE_KEY = "rescrawl-replay-1";

// replay time is wall-clock time less `offsets[i]` for stroke i: the first stroke
// starts at 0, and a pause between strokes longer than maxPause plays as maxPause
export type ReplayTimes = { offsets: number[]; ends: number[]; duration: number };

export function replayTimes(strokes: Stroke[], maxPause: number): ReplayTimes {
  const offsets: number[] = [];
  const ends: number[] = [];
  let offset = strokes.length > 0 ? strokeStart(strokes[0]) : 0;
  let last = offset;
  let duration = 0;
  for (const s of strokes) {
    offset += Math.max(0, strokeStart(s) - last - maxPause);
    last = Math.max(last, strokeEnd(s));
    offsets.push(offset);
    ends.push(strokeEnd(s) - offset);
    duration = Math.max(duration, strokeEnd(s) - offset);
  }
  return { offsets, ends, duration };
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function strokesBounds(strokes: Stroke[]): Bounds | null {
  if (strokes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const stroke of strokes)
    for (const pt of stroke.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  return { minX, minY, maxX, maxY };
}
