// `p`: pen pressure, 0 to 1, recorded only from a stylus
export type Point = { x: number; y: number; t: number; p?: number };
export type StrokeStyle = "pen" | "brush";
// at least one point, so [0] and [length - 1] are safe
// `zoom`: screen px per drawing px while drawn; zooming the view moves nothing drawn
export type Stroke = { points: Point[]; zoom: number; style: StrokeStyle };

// ms of idle after a stroke before recording ends
export const LIVE_TIMEOUT = 2000;

export const strokeStart = (s: Stroke): number => s.points[0].t;
export const strokeEnd = (s: Stroke): number => s.points[s.points.length - 1].t;
export function withinStroke(s: Stroke, t: number) {
  return strokeStart(s) <= t && t < strokeEnd(s);
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

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
