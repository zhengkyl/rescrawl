import { lerp } from "./math";
import type { Point4 } from "./types";

// --- stage 3 of 4: drop points that do not change the shape ---
//
// Two passes, both about circles rather than about the curve:
//
//   dropContained  a circle entirely inside a neighbour contributes no ink at
//                  all, AND has no tangent line to it -- so it breaks the
//                  outline math downstream. Always runs.
//   simplify       a circle already covered by the tube between two others is
//                  redundant to within `tol`. This is the smoothness knob.
//
// Not to be confused with stage 0 (`compress.ts`), which also drops points but
// answers a different question: stage 0 decides what the FILE holds, in px of
// path deviation, and runs before any of this. Here the tolerance is a fraction
// of the local radius, because what is being tested is whether a circle adds
// ink -- a point that matters on a hairline is noise on a broad stroke.

// Longest run of points `simplify` will drop between two kept ones. Re-testing
// the pending run on every step is O(run^2) per run, so an unbroken straight
// stroke would go quadratic; a cap keeps it linear. Loose enough that it only
// binds on very smooth runs -- at 64 a 2000-point arc still collapses to ~32
// points with under 0.1px of error.
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

// Reumann-Witkam with a variable-radius tube.
//
// A point is dropped when its circle is already covered by the tube spanning
// the anchor and the chord end. Since that tube is convex and contains all
// three circles, it also contains hull(anchor, dropped) and hull(dropped, end)
// -- so dropping a point can only *add* a sliver of ink on the outside of a
// bend, never erode the shape. That one-sided error is the reason to test
// coverage rather than a chord distance: `decimate`'s eps can pull the outline
// inward, this cannot.
//
// At tol = 0 the test is lossless and therefore drops almost nothing: a
// constant-width stroke has gap = r - r = 0, so only exactly-collinear points
// go. tol is what makes it do work, and doubles as the smoothness knob.
//
// Sleeve-fitting: every point dropped since the anchor is re-tested against the
// lengthened chord, not just the most recent one. Testing only the newest point
// is O(n) but lets error accumulate without bound around a steady curve, since
// a point cleared against a short chord is never rechecked against the long one.
export function simplify(points: Point4[], tol: number): Point4[] {
  const n = points.length;
  if (n <= 2) return points;

  const out = [points[0]];
  let a = 0; // anchor: index of the last kept point
  let i = 1; // furthest chord end that still covers everything behind it
  while (i < n - 1) {
    // Would extending the chord to i + 1 still cover points (a, i]?
    let fits = i - a <= MAX_RUN;
    for (let j = a + 1; fits && j <= i; j++) {
      fits = covered(points[a], points[i + 1], points[j], tol);
    }
    if (fits) {
      i++;
      continue;
    }
    out.push(points[i]);
    a = i;
    i = a + 1;
  }
  out.push(points[n - 1]);
  return out;
}

// removes points completely covered by another
// these have no tangent lines between, so breaks downstream math
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
