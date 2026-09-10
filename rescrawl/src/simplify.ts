import { lerp } from "./math.ts";
import type { Point4 } from "./types.ts";

const MAX_RUN = 64;

function covered(a: Point4, b: Point4, p: Point4, tol: number): boolean {
  const ax = p.x - a.x;
  const ay = p.y - a.y;
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const bMagn2 = bx * bx + by * by;

  // Project p onto the chord, clamped, so a point off either end is tested
  // against that cap circle instead: at t = 0 the check below reduces to
  // |p - a| <= a.r - p.r, which is exactly circle-in-circle containment.
  let t = bMagn2 > 0 ? (ax * bx + ay * by) / bMagn2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  // perpendicular offset from the chord at t
  const dx = ax - t * bx;
  const dy = ay - t * by;
  const dist2 = dx * dx + dy * dy;

  // Room between p's rim and the tube wall at t. Negative means p is fatter
  // than the tube there and protrudes wherever it sits.
  //
  // Measuring against the lerped radius approximates the wall with a line
  // parallel to the chord; the true wall is the external tangent to the two
  // circles, which tilts when a.r != b.r (the exact bound is
  // gap / sqrt(1 - ((a.r - b.r) / |b|)^2), i.e. slightly wider). Erring narrow
  // only keeps extra points, so it stays on the safe side.
  const gap = lerp(a.r, b.r, t) - p.r + tol * p.r;
  return gap > 0 && dist2 <= gap * gap;
}

export function dropContained(pts: Point4[]) {
  const out: Point4[] = [];
  for (const p of pts) {
    let keep = true;
    while (out.length) {
      const q = out[out.length - 1];

      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dr = p.r - q.r;
      if (dx * dx + dy * dy > dr * dr) {
        break; // dist > delta r, nodes do not contain each other
      }

      if (dr < 0) {
        // q contains p
        keep = false;
        break;
      }

      // p contains q
      out.pop();
    }
    if (keep) out.push(p);
  }
  return out;
}
