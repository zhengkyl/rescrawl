import type { Point2 } from "./types";

export const TAU = Math.PI * 2;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp11 = (n: number) => (n < -1 ? -1 : n > 1 ? 1 : n);

// `b - a` wrapped to [-PI, PI)
export const wrapPi = (d: number) => d - TAU * Math.floor((d + Math.PI) / TAU);

// Math.hypot is 3-4x slower
export const dist = (a: Point2, b: Point2) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

// The chord rule: the full Hermite tangent length for a cubic between two
// points with unit tangents (ax, ay) and (bx, by) is the chord times
// sec²(turn/4) -- the factor that makes a cubic reproduce a circular arc of
// that turn. It is 1 when the tangents are parallel, so a straight run emits
// its chord exactly, and 1.172 across a quarter turn.
export function chordRule(chord: number, ax: number, ay: number, bx: number, by: number): number {
  // cos(turn/2) by half angle, so sec²(turn/4) needs no trig of its own.
  const half = Math.sqrt((1 + clamp11(ax * bx + ay * by)) / 2);
  return (chord * 2) / (1 + half);
}
