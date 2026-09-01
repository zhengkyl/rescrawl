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
