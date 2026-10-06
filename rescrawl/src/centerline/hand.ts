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

// `reparam`: rounds of "move each sample's u to the nearest point, then solve
// again" after the first solve. 0 is one solve at the arc-length guesses.
export function fitHand(
  pts: Point4[],
  o: Required<FitOptions> & { reparam: number },
): CenterlineNode[] {
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
    let mo = 0;
    let mi = 0;

    let b = a + 1;
    while (b < n) {
      const arc = s[b] - s[a];
      if (arc === 0) {
        b++;
        continue;
      }

      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const chord = Math.sqrt(dx * dx + dy * dy);
      const mc = chordRule(chord, t[a].x, t[a].y, t[b].x, t[b].y);
      const lower = mc / 3;
      const upper = mc * 3;

      let ma!: number;
      let mb!: number;

      let taX!: number;
      let taY!: number;
      let tbX!: number;
      let tbY!: number;

      const us: number[] = [];
      for (let j = a + 1; j < b; j++) {
        us.push((s[j] - s[a]) / arc);
      }

      const newtonIterations = o.reparam;
      for (let i = 0; i <= newtonIterations; i++) {
        let A = 0;
        let B = 0;
        let C = 0;
        let E = 0;
        let F = 0;
        for (let j = a + 1; j < b; j++) {
          const u = us[j - a - 1];

          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;

          const rjX = x[j] - h00 * x[a] - h01 * x[b];
          const rjY = y[j] - h00 * y[a] - h01 * y[b];
          A += h10 * h10;
          B += h10 * h11 * (t[a].x * t[b].x + t[a].y * t[b].y);
          C += h11 * h11;
          E += h10 * (t[a].x * rjX + t[a].y * rjY);
          F += h11 * (t[b].x * rjX + t[b].y * rjY);
        }
        const det = A * C - B * B;
        ma = (E * C - B * F) / det;
        mb = (A * F - B * E) / det;
        if (det === 0 || ma < lower || mb < lower || ma > upper || mb > upper) {
          ma = mb = mc;
        }

        taX = t[a].x * ma;
        taY = t[a].y * ma;
        tbX = t[b].x * mb;
        tbY = t[b].y * mb;

        for (let j = a + 1; j < b; j++) {
          const u = us[j - a - 1];

          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;

          const pux = h00 * x[a] + h10 * taX + h01 * x[b] + h11 * tbX;
          const puy = h00 * y[a] + h10 * taY + h01 * y[b] + h11 * tbY;

          const gapx = pux - x[j];
          const gapy = puy - y[j];

          const hp00 = 6 * u2 - 6 * u;
          const hp10 = 3 * u2 - 4 * u + 1;
          const hp01 = -6 * u2 + 6 * u;
          const hp11 = 3 * u2 - 2 * u;

          const ppux = hp00 * x[a] + hp10 * taX + hp01 * x[b] + hp11 * tbX;
          const ppuy = hp00 * y[a] + hp10 * taY + hp01 * y[b] + hp11 * tbY;

          const hpp00 = 12 * u - 6;
          const hpp10 = 6 * u - 4;
          const hpp01 = -12 * u + 6;
          const hpp11 = 6 * u - 2;

          const pppux = hpp00 * x[a] + hpp10 * taX + hpp01 * x[b] + hpp11 * tbX;
          const pppuy = hpp00 * y[a] + hpp10 * taY + hpp01 * y[b] + hpp11 * tbY;

          const f = gapx * ppux + gapy * ppuy;
          const fp = ppux * ppux + ppuy * ppuy + gapx * pppux + gapy * pppuy;

          if (fp <= 0) continue; // fp is second derivative, > 0 means upward parabola aka min, otherwise no good
          us[j - a - 1] = Math.max(0, Math.min(u - f / fp, 1));
        }
      }

      let fits = true;
      for (let j = a + 1; j < b; j++) {
        const u = us[j - a - 1];

        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;

        const pux = h00 * x[a] + h10 * taX + h01 * x[b] + h11 * tbX;
        const puy = h00 * y[a] + h10 * taY + h01 * y[b] + h11 * tbY;

        const gapx = pux - x[j];
        const gapy = puy - y[j];
        if (gapx * gapx + gapy * gapy > fitWidth * fitWidth) {
          fits = false;
          break;
        }
      }
      if (!fits) break;
      mo = ma;
      mi = mb;
      b++;
    }
    b--;

    out[out.length - 1].mo = mo;
    out.push({
      ...pts[b],
      ix: t[b].x,
      iy: t[b].y,
      ox: t[b].x,
      oy: t[b].y,
      mi: mi,
      mo: 0,
      slope: 0,
    });

    a = b;
  }

  return out;
}
