export type Point2 = { x: number; y: number };
export type Point3 = { x: number; y: number; t: number };
export type Point4 = { x: number; y: number; t: number; r: number };

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

// The control point of the quadratic from A to B with unit tangents (atx, aty)
// leaving and (btx, bty) arriving: where the two tangent lines cross. The
// quadratic's answer to `chordRule` -- except there is nothing to choose. Two
// points and two tangents pin a quadratic outright, which is why an outline
// node needs no magnitude to be drawn as one.
//
// Null when the lines are parallel, or cross behind A or ahead of B. That is a
// piece no quadratic can span -- most often one the envelope inflects across,
// since a quadratic has a single sign of curvature end to end.
export function quadControl(
  ax: number,
  ay: number,
  atx: number,
  aty: number,
  bx: number,
  by: number,
  btx: number,
  bty: number,
): Point2 | null {
  // The tangents are unit, so this is the sine of the turn between them.
  const den = atx * bty - aty * btx;
  if (Math.abs(den) < 1e-12) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const s = (dx * bty - dy * btx) / den; // along A's tangent
  const t = (dy * atx - dx * aty) / den; // back along B's
  if (!(s > 0) || !(t > 0)) return null;
  return { x: ax + atx * s, y: ay + aty * s };
}
