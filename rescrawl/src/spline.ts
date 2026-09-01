import { clamp11, dist, lerp, wrapPi } from "./math";
import type { Point4, Sample } from "./types";

// --- stage 3c: resample the centerline along a smooth curve ---
//
// Centripetal Catmull-Rom (alpha = 0.5) through the centerline, with the radius
// carried along as a third coordinate so width interpolates with position.
//
// Centripetal, not uniform. `simplify` leaves points deliberately UNEVENLY
// spaced — dense through corners, sparse down straights — and uniform
// Catmull-Rom overshoots and can cusp exactly where the spacing jumps.
// Centripetal knots (spacing = sqrt(chord)) are the standard fix, and they
// guarantee no cusp and no self-intersection inside a segment.
//
// Each sample carries `thru`/`off` rather than just a position, because that is
// what the outline is actually built from — see `offsetOutline` — and because
// those two angles are also what decides where samples are needed at all.
//
// Sampling is adaptive: the curve is bisected until no interval would put the
// emitted outline further than `tol` px from the true one. Density follows that
// error and nothing else, so a straight run costs almost nothing, a bend gets
// what it needs, and a corner does not run away.

// Envelope of a disc of radius r(s) swept along a curve: the silhouette touches
// at angle `off` from the heading, where cos(off) = -dr/ds. Straight from the
// cone: a radius growing at rate k has its tangent line tilted by asin(k), and
// the contact is perpendicular to that.
//
// |dr/ds| > 1 means the disc is growing faster than it is moving, i.e. it
// swallows its neighbour and has no external tangent. `dropContained` rules
// that out for the input points, but the spline can overshoot between them, so
// clamp rather than emit NaN.
function offAngle(dr: number, speed: number): number {
  return Math.acos(clamp11(speed > 0 ? -dr / speed : 0));
}

// Ceiling on bisections per segment: 2^(MAX_DEPTH + 1) samples in the worst
// case. Only a segment that is somehow curving faster than the tolerance can
// resolve will reach it, and stopping there beats not stopping.
const MAX_DEPTH = 6;

export function sampleSpline(pts: Point4[], tol: number): Sample[] {
  const n = pts.length;
  if (n < 2) return [];
  // A zero tolerance is never satisfiable and would bottom out on MAX_DEPTH
  // everywhere.
  const limit = Math.max(tol, 1e-3);

  // Centripetal knots. `dropContained` has already removed coincident points;
  // the floor only guards float dust.
  const knot = [0];
  for (let i = 1; i < n; i++) {
    knot.push(knot[i - 1] + Math.max(Math.sqrt(dist(pts[i], pts[i - 1])), 1e-6));
  }

  // Non-uniform Catmull-Rom tangent: the centred difference over the knot span
  // either side. The ends use their one-sided difference, so the curve leaves
  // the first point along its first chord.
  const mx = new Array<number>(n);
  const my = new Array<number>(n);
  const mr = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : 0;
    const b = i < n - 1 ? i + 1 : n - 1;
    const h = knot[b] - knot[a];
    mx[i] = (pts[b].x - pts[a].x) / h;
    my[i] = (pts[b].y - pts[a].y) / h;
    mr[i] = (pts[b].r - pts[a].r) / h;
  }

  // Cubic Hermite on segment `i`, at local parameter u in [0, 1]. `h` scales the
  // tangents back into the segment's own parameterisation.
  //
  // dr/ds needs arc length, not u: the h factors cancel in dr/du over |dP/du|,
  // so the raw u-derivatives are all this needs.
  function at(i: number, u: number): Sample {
    const a = pts[i];
    const b = pts[i + 1];
    const h = knot[i + 1] - knot[i];

    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    // d/du of the four basis functions
    const g00 = 6 * u2 - 6 * u;
    const g10 = 3 * u2 - 4 * u + 1;
    const g01 = -6 * u2 + 6 * u;
    const g11 = 3 * u2 - 2 * u;

    const x = h00 * a.x + h10 * h * mx[i] + h01 * b.x + h11 * h * mx[i + 1];
    const y = h00 * a.y + h10 * h * my[i] + h01 * b.y + h11 * h * my[i + 1];
    const r = h00 * a.r + h10 * h * mr[i] + h01 * b.r + h11 * h * mr[i + 1];

    const dx = g00 * a.x + g10 * h * mx[i] + g01 * b.x + g11 * h * mx[i + 1];
    const dy = g00 * a.y + g10 * h * my[i] + g01 * b.y + g11 * h * my[i + 1];
    const dr = g00 * a.r + g10 * h * mr[i] + g01 * b.r + g11 * h * mr[i + 1];

    const speed = Math.sqrt(dx * dx + dy * dy);
    return {
      x,
      y,
      // Radius can undershoot on a fast taper; a negative one would flip the
      // outline inside out.
      r: Math.max(r, 0),
      t: lerp(a.t, b.t, u),
      thru: Math.atan2(dy, dx),
      off: offAngle(dr, speed),
    };
  }

  // How far the emitted outline would stray from the true one between two
  // samples, in px, on whichever side is worse.
  //
  // Angle alone is not enough, and that is not a detail. At a sharp corner the
  // heading swings hard across a stretch where the curve barely moves, so an
  // angle test keeps splitting an interval that is already sub-pixel — samples
  // ended up 0.027px apart, thousands of them, all invisible. Distance alone is
  // no better: it over-samples a straight run and under-samples a tight bend.
  //
  // The product is the honest measure. A CHORD spanning L across a turn of
  // theta sits about L*theta/8 off the true arc, so that is the error the next
  // split would remove. It falls to zero when EITHER the turn or the chord
  // does, which is exactly the behaviour the two one-sided tests were missing.
  //
  // Conservative on purpose: what actually gets emitted between two contacts is
  // an arc-matching cubic, not the chord this estimates, so the real deviation
  // lands roughly an order of magnitude under `tol` — 0.4 here measures out at
  // about 0.03px. Read the knob as a budget, not a prediction.
  //
  // Measured between the CONTACT points, not the centres: the outline is what
  // is being approximated, it sits r away from the centre, and a swing of theta
  // moves it by r*theta. That is also why a fat stroke needs more samples than
  // a thin one through the same corner.
  function sideDeviation(a: Sample, b: Sample, side: number): number {
    const aAngle = a.thru + side * a.off;
    const bAngle = b.thru + side * b.off;
    const ax = a.x + a.r * Math.cos(aAngle);
    const ay = a.y + a.r * Math.sin(aAngle);
    const bx = b.x + b.r * Math.cos(bAngle);
    const by = b.y + b.r * Math.sin(bAngle);
    const chord = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    return (chord * Math.abs(wrapPi(bAngle - aAngle))) / 8;
  }

  function deviation(a: Sample, b: Sample): number {
    return Math.max(sideDeviation(a, b, 1), sideDeviation(a, b, -1));
  }

  const out: Sample[] = [];

  // Bisect until every interval deviates less than `limit`. Emits the left end
  // of each accepted interval, so the walk is half-open and the closing point
  // is pushed once at the very end.
  //
  // The midpoint is a TEST, not an unconditional emit. Catmull-Rom can leave a
  // segment's two ends near-parallel while it bows in between — an S through
  // the middle — which an end-to-end test alone would call flat; checking both
  // halves catches that. But emitting the midpoint regardless put a floor of
  // two samples per segment under every result, which is most of a doubling on
  // exactly the flat runs that need none.
  function walk(i: number, u0: number, s0: Sample, u1: number, s1: Sample, depth: number): void {
    const um = (u0 + u1) / 2;
    const sm = at(i, um);
    if (
      depth >= MAX_DEPTH ||
      (deviation(s0, s1) <= limit && deviation(s0, sm) <= limit && deviation(sm, s1) <= limit)
    ) {
      out.push(s0);
      return;
    }
    walk(i, u0, s0, um, sm, depth + 1);
    walk(i, um, sm, u1, s1, depth + 1);
  }

  for (let i = 0; i < n - 1; i++) walk(i, 0, at(i, 0), 1, at(i, 1), 0);
  out.push(at(n - 2, 1));
  return out;
}
