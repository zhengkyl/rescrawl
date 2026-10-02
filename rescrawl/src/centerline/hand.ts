import { chordRule, type Point4 } from "../math.ts";
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
  const n = pts.length;
  if (n === 0) return [];

  const s = [0];
  const x = [0];
  const y = [0];
  {
    let total = 0;
    let totalX = 0;
    let totalY = 0;
    let prev = pts[0];
    let curr;
    for (let i = 1; i < n; i++) {
      curr = pts[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      totalX += dx;
      totalY += dy;
      total += Math.sqrt(dx * dx + dy * dy);
      x.push(totalX);
      y.push(totalY);
      s.push(total);

      prev = curr;
    }
  }

  const t = [];
  for (let i = 0; i < n; i++) {
    const prev = Math.max(i - 1, 0);
    const curr = i;
    const next = Math.min(i + 1, n - 1);

    const ax = x[curr] - x[prev];
    const ay = y[curr] - y[prev];
    const aMagn = s[curr] - s[prev];

    const bx = x[next] - x[curr];
    const by = y[next] - y[curr];
    const bMagn = s[next] - s[curr];

    if (aMagn === 0) {
      if (bMagn === 0) {
        t.push({ x: 1, y: 0 });
        continue;
      }
      t.push({ x: bx / bMagn, y: by / bMagn });
      continue;
    }
    if (bMagn === 0) {
      t.push({ x: ax / aMagn, y: ay / aMagn });
      continue;
    }

    const tx = (bMagn / aMagn) * ax + (aMagn / bMagn) * bx;
    const ty = (bMagn / aMagn) * ay + (aMagn / bMagn) * by;
    const tMagn = Math.sqrt(tx * tx + ty * ty);

    if (tMagn === 0) {
      t.push({ x: 1, y: 0 });
    } else {
      t.push({ x: tx / tMagn, y: ty / tMagn });
    }
  }

  const out: CenterlineNode[] = [
    {
      ...pts[0],
      ix: t[0].x,
      iy: t[0].y,
      ox: t[0].x,
      oy: t[0].y,
      mi: 0,
      mo: 0,
      slope: 0,
    },
  ];

  const fitWidth = o.fitTol * o.maxWidth;

  let a = 0;
  while (a < n - 1) {
    let m!: number;

    let b = a + 1;
    while (b < n) {
      const arc = s[b] - s[a];
      if (arc === 0) continue;

      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const chord = Math.sqrt(dx * dx + dy * dy);
      const bM = chordRule(chord, t[a].x, t[a].y, t[b].x, t[b].y);
      let fits = true;

      const tax = t[a].x * bM;
      const tay = t[a].y * bM;
      const tbx = t[b].x * bM;
      const tby = t[b].y * bM;

      for (let j = a + 1; j < b; j++) {
        const u = (s[j] - s[a]) / arc;

        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;

        const pux = h00 * x[a] + h10 * tax + h01 * x[b] + h11 * tbx;
        const puy = h00 * y[a] + h10 * tay + h01 * y[b] + h11 * tby;

        const gapx = pux - x[j];
        const gapy = puy - y[j];
        if (gapx * gapx + gapy * gapy > fitWidth * fitWidth) {
          fits = false;
          break;
        }
      }
      if (!fits) break;
      m = bM;
      b++;
    }
    b--;

    out[out.length - 1].mo = m;
    out.push({
      ...pts[b],
      ix: t[b].x,
      iy: t[b].y,
      ox: t[b].x,
      oy: t[b].y,
      mi: m,
      mo: 0,
      slope: 0,
    });

    a = b;
  }

  return out;
}
