import { chordRule, dist, type Point4 } from "../math.ts";
import type { CenterlineNode, FitOptions } from "./fit.ts";

// `fitCurve`, rebuilt by hand one idea at a time. Pick "hand" on the
// centerline bench (/centerline.html) and every save shows up there, next to
// the real "cubic" to compare against.
//
// Every step below is a complete fit on its own. Do them in order: each one
// changes one thing, says why, and says what should change on screen. Where
// fit.ts already does it, the step names the part to peek at. Helpers you may
// want are in ../math.ts: `dist`, `lerp`, `chordRule`.
//
// ---------------------------------------------------------------------------
// THE OUTPUT
//
// A CenterlineNode is a kept sample (its x, y, r, t) plus what the curve does
// there:
//
//   (ix, iy)  unit tangent arriving      (ox, oy)  unit tangent leaving
//   mi        length arriving            mo        length leaving
//   slope     dr/ds -- only the outline reads it; leave 0 until step 8
//
// The segment from node a to node b is the cubic Bezier
//
//   a,   a + (a.ox, a.oy) · a.mo/3,   b - (b.ix, b.iy) · b.mi/3,   b
//
// so mo = mi = 0 is a straight chord. The lengths are Hermite tangent
// lengths; a Bezier handle is a third of one. That is the whole output: which
// samples become nodes, and those numbers at each.
//
// ---------------------------------------------------------------------------
// STEP 3 -- tangents from a distance along the stroke, not from neighbours
//
// Pen jitter makes pts[i - 1] and pts[i + 1] mostly noise, and how far apart
// they are depends on pen speed. Read the direction over a fixed distance D
// instead:
//
//   S[i] = arc length to sample i      (S[0] = 0, S[i] = S[i-1] + dist)
//   D    = o.fitWindow * o.maxWidth    (6px at defaults)
//
//   back = the point on the polyline at arc length S[i] - D
//   fwd  = the point on the polyline at arc length S[i] + D
//   tangent = normalize(fwd - back)
//
// "The point at arc length s": find the two samples whose S straddle s and
// lerp between them. Clamp to the first / last sample off either end.
//
// On the bench: handles stop wobbling. Drag "window" and watch the tangents
// stiffen. fit.ts: `armBack`, `armFwd`, `secant`.
//
// ---------------------------------------------------------------------------
// STEP 4 -- drop samples: the greedy walk
//
// Now keep a sample only when it is needed. Starting from node a, try to end
// the segment at b = a + 1, a + 2, ... and keep going while the cubic a -> b
// (step 2's lengths) passes near every sample between. When b + 1 fails, end
// the segment at b, make b the new a, and go again.
//
// "Passes near", for now: for each sample j strictly between a and b,
//
//   u = (S[j] - S[a]) / (S[b] - S[a])     how far along, by arc length
//   d = distance from pts[j] to the cubic at u
//   pass if d <= 0.5px
//
// Two more ways a segment stops growing:
//   S[b + 1] - S[a] > o.fitHorizon * o.maxWidth -- while drawing, the segment
//     still open at the pen is the only ink that moves, so it is kept short
//   b - a >= 64 -- a cap on the work per segment
//
// Segment a -> a + 1 has nothing between its ends, so it always passes.
//
// On the bench: far fewer segments. Each try checks every sample between, so
// a segment of L samples costs ~L^2/2 checks -- that is the search, and the
// horizon is what bounds it. fit.ts: the "greedy extension" loop.
//
// To evaluate the cubic at u you need the Hermite basis:
//   h00 = 2u^3 - 3u^2 + 1     h10 = u^3 - 2u^2 + u
//   h01 = -2u^3 + 3u^2        h11 = u^3 - u^2
//   P(u) = h00·a + h10·(a.mo · ta) + h01·b + h11·(b.mi · tb)
//
// ---------------------------------------------------------------------------
// STEP 5 -- fit the two lengths instead of guessing them
//
// The chord rule never looks at the samples. With both tangents fixed, P(u)
// is linear in the two lengths ma (at a) and mb (at b):
//
//   P(u) = h00·a + h01·b + ma·h10·ta + mb·h11·tb
//
// so least squares is a 2x2 solve. With rj = pts[j] - h00·a - h01·b (the
// part the lengths have to explain), minimising sum |rj - ma·h10·ta -
// mb·h11·tb|^2 gives
//
//   [ sum h10^2            sum h10·h11·(ta·tb) ] [ma]   [ sum h10·(ta·rj) ]
//   [ sum h10·h11·(ta·tb)  sum h11^2           ] [mb] = [ sum h11·(tb·rj) ]
//
// with u for each sample from arc length, as in step 4. Solve by Cramer's
// rule. Fall back to the chord rule when the determinant is ~0 (0 or 1
// samples between), or when either length comes out negative or more than 3x
// the chord rule -- too few samples to trust, and the cubic would loop.
//
// On the bench: segments get longer at the same tolerance, and the two
// handles of a segment differ in length. fit.ts: `solveMagnitudes`.
//
// ---------------------------------------------------------------------------
// STEP 6 -- measure the real distance, and measure it in ink
//
// (a) The arc-length u is a guess, not the nearest point on the curve, so the
//     distance it gives is too large and good segments get rejected. Refine u
//     with Newton on f(u) = (P(u) - p) · P'(u):
//
//       u <- u - f / f',   f' = P'·P' + (P - p)·P''
//
//     Two steps from the guess is enough. Clamp u to [0, 1]. You need the
//     basis derivatives: differentiate the four h's above, twice.
//
// (b) Swap the fixed 0.5px for what dropping a sample does to the ink. The
//     ink is the union of every sample's disc. The segment sweeps a tube of
//     radius lerp(a.r, b.r, u). Sample j's disc stays inside the tube when
//     d + pj.r <= tube radius; allow fitTol of its own radius as slack:
//
//       gap = lerp(a.r, b.r, u) - pj.r + o.fitTol * pj.r
//       pass if gap > 0 and d <= gap
//
// On the bench: switch "discs" on -- every dropped disc sits inside the tube
// of the segment that skipped it. Drag "tol". fit.ts: `cubicCovers`, `inTube`.
//
// ---------------------------------------------------------------------------
// STEP 7 -- corners
//
// A smooth tangent across a sharp turn rounds it off; the greedy walk then
// spends many nodes hugging the rounding and still cuts the corner.
//
//   angle[i] = the turn between (pts[i] - back) and (fwd - pts[i]), with
//              step 3's arms: atan2(|cross|, dot)
//   corner   = angle[i] > o.fitCornerAngle degrees, and the largest angle
//              within D either side (a sharp turn reads sharp over several
//              samples; keep one)
//
// Corners cut the stroke into runs. Inside a run, clamp every arm to the run:
// back cannot reach before its start, fwd cannot pass its end. At a corner the
// in-tangent comes from the run it ends and the out-tangent from the run it
// starts, so (ix, iy) != (ox, oy) there -- the only place they differ. Walk
// each run separately: the greedy never crosses a corner, and the corner is
// always a node.
//
// On the bench: draw a V. Set corner to 181 (off), then back to 60. fit.ts:
// the "corners" section, `secant`, the runs loop. (fit.ts also prefers a
// retrace's turnaround sample among equals -- `turns` and `rank`. Skip it
// unless you draw back-and-forth strokes.)
//
// ---------------------------------------------------------------------------
// STEP 8 -- slope, for the outline
//
//   slope[i] = (r at fwd - r at back) / (S at fwd - S at back)
//
// using step 3's arms, NOT clamped at corners -- the radius does not care
// about direction. Nothing on the bench changes; the outline stage uses it to
// tilt the envelope where the pen speeds up or slows down.
//
// ---------------------------------------------------------------------------
// That is all of `fitCurve` except the incremental cache (`FitCache`), which
// changes how much is recomputed, never what comes out. Leave it for last.

export function fitHand(pts: Point4[], o: Required<FitOptions>): CenterlineNode[] {
  void o;
  const n = pts.length;

  const tangents = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(i - 1, 0)];
    const curr = pts[i];
    const next = pts[Math.min(i + 1, n - 1)];

    const ax = curr.x - prev.x;
    const ay = curr.y - prev.y;
    const aMagn = Math.sqrt(ax * ax + ay * ay);

    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    const bMagn = Math.sqrt(bx * bx + by * by);

    if (aMagn === 0) {
      tangents.push({ x: bx / bMagn, y: by / bMagn });
      continue;
    }
    if (bMagn === 0) {
      tangents.push({ x: ax / aMagn, y: ay / aMagn });
      continue;
    }

    const tx = (bMagn / aMagn) * ax + (aMagn / bMagn) * bx;
    const ty = (bMagn / aMagn) * ay + (aMagn / bMagn) * by;
    const tMagn = Math.sqrt(tx * tx + ty * ty);

    if (tMagn === 0) {
      // (prev === next) !== curr
      tangents.push({ x: 1, y: 0 });
    } else {
      tangents.push({ x: tx / tMagn, y: ty / tMagn });
    }
  }

  const out: CenterlineNode[] = [];
  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const t = tangents[i];

    out.push({
      x: curr.x,
      y: curr.y,
      t: curr.t,
      r: curr.r,
      ix: t.x,
      iy: t.y,
      ox: t.x,
      oy: t.y,
      mi: 0,
      mo: 0,
      slope: 0,
    });
  }

  for (let i = 0; i < n - 1; i++) {
    const curr = pts[i];
    const next = pts[i + 1];
    const t = tangents[i];
    const tNext = tangents[i + 1];
    const m = chordRule(dist(curr, next), t.x, t.y, tNext.x, tNext.y);

    out[i].mo = m;
    out[i + 1].mi = m;
  }

  return out;
}
