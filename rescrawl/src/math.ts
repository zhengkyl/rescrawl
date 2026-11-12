export type Point2 = { x: number; y: number };
export type Point3 = { x: number; y: number; t: number };

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

// hermite tangent length for circular arc is chord * sec²(turn/4)
export function chordRule(chord: number, ax: number, ay: number, bx: number, by: number): number {
  // apply half angle identity twice
  // cos^2(x/2) = (1 + cos(x)) / 2
  // sec²(x/4) = 2 / (1 + cos(x/2))
  const half = Math.sqrt((1 + clamp11(ax * bx + ay * by)) / 2);
  return (chord * 2) / (1 + half);
}
