import { clamp11, dist, TAU } from "./math";
import type { Contact, Point4, Sample } from "./types";

function contactAt(c: Point4, a: number): Contact {
  const cos = Math.cos(a),
    sin = Math.sin(a);
  return { x: c.x + c.r * cos, y: c.y + c.r * sin, tx: -sin, ty: cos };
}

/** Converts to [0, TAU) */
function wrapZeroTau(a: number) {
  return a - TAU * Math.floor(a / TAU);
}

// The interior samples of a decreasing sweep from `from` to `to` around one
// disc — endpoints excluded, since a sweep only ever bridges two contacts that
// are already in the list. Split so no single cubic spans more than a quarter
// turn: one cubic per quarter is accurate to ~2.7e-4·r, per half only ~1e-2·r.
function pushSweep(out: Contact[], c: Point4, from: number, to: number): void {
  const span = wrapZeroTau(to - from);
  const steps = Math.ceil(span / MAX_CURVE_ANGLE);
  for (let k = 1; k < steps; k++) out.push(contactAt(c, from + (span * k) / steps));
}

// NEXT TASK
// This strat fixes backtrack collapse, but adds extra points for small turns if tangents cross
// potential solution by checking dot product of in/out
// or check angle on both left and right?
// does backtrack only collapse when both negative?
function pushSweep2(out: Contact[], c: Point4, from: number, to: number): void {
  const span = wrapZeroTau(to - from);
  const steps = Math.ceil(span / MAX_CURVE_ANGLE);
  for (let k = 0; k <= steps; k++) out.push(contactAt(c, from + (span * k) / steps));
}

const MAX_CURVE_ANGLE = Math.PI;

export function toOutline(pts: Point4[]): Contact[] {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) {
    const out: Contact[] = [];
    for (let k = 0; k < TAU / MAX_CURVE_ANGLE; k++) {
      out.push(contactAt(pts[0], k * MAX_CURVE_ANGLE));
    }
    return out;
  }

  // y increases downwards, so unit circle is flipped vertically
  // angles increase clockwise
  //
  //

  // Per segment: the direction through the two centres, and the external tangent angle off it
  // `dropContained` ensures |dr| <= d
  const thru = new Array<number>(n - 1);
  const off = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = dist(a, b);
    thru[i] = Math.atan2(b.y - a.y, b.x - a.x);
    off[i] = Math.acos(clamp11(d > 0 ? (a.r - b.r) / d : 0));
  }

  // Two angles per side per interior point: one from the segment behind, one
  // from the segment ahead. The ends have only one segment, and `back === fwd`
  // collapses them to a single contact there.
  const angles = (i: number, side: 1 | -1) => {
    const back = i > 0 ? i - 1 : 0;
    const fwd = i < n - 1 ? i : n - 2;
    return [thru[back] + side * off[back], thru[fwd] + side * off[fwd]] as const;
  };

  // Below this the two contacts are the same point and the join is flat, so the
  // second contact and its zero-length arc are dropped. ~0.06°, small enough to
  // be invisible and large enough that a collinear run stays one contact.
  const FLAT = 1e-3;

  const out: Contact[] = [];

  for (let i = 0; i < n; i++) {
    const [behind, ahead] = angles(i, -1);

    if (i > 0 && i < n - 1) {
      pushSweep2(out, pts[i], behind, ahead);
    } else {
      out.push(contactAt(pts[i], behind));
    }

    // out.push(contactAt(pts[i], behind));

    // const turn = wrapZeroTau(ahead - behind);
    // if (i > 0 && i < n - 1 && Math.abs(turn) > FLAT) {
    //   if (turn > Math.PI / 2) pushSweep(out, pts[i], behind, ahead);
    //   out.push(contactAt(pts[i], ahead));
    // }
  }

  // End cap: round the last disc from its left contact to its right one. The
  // sweep is 2·off, which passes through the tip because the tip angle sits
  // between them by construction.
  const endL = thru[n - 2] - off[n - 2];
  const endR = thru[n - 2] + off[n - 2];
  pushSweep(out, pts[n - 1], endL, endR);

  for (let i = n - 1; i >= 0; i--) {
    const [behind, ahead] = angles(i, 1);

    if (i > 0 && i < n - 1) {
      pushSweep2(out, pts[i], ahead, behind);
    } else {
      out.push(contactAt(pts[i], ahead));
    }

    // out.push(contactAt(pts[i], ahead));

    // const turn = wrapZeroTau(behind - ahead);
    // if (i > 0 && i < n - 1 && Math.abs(turn) > FLAT) {
    //   if (turn > Math.PI / 2) pushSweep(out, pts[i], ahead, behind);
    //   out.push(contactAt(pts[i], behind));
    // }
  }

  // Start cap: the long way round the first disc, TAU - 2·off, back to the
  // contact the loop opened on.
  pushSweep(out, pts[0], thru[0] + off[0], thru[0] - off[0]);
  return out;
}

// The same envelope as `toOutline`, evaluated continuously along the sampled
// spline instead of once per segment.
//
// This is the whole difference, and it is worth being precise about: the two
// functions use the identical formula. `toOutline` computes `off` per SEGMENT,
// which leaves every interior point holding two different angles — one from the
// segment behind, one from the segment ahead — and it splits the difference.
// That bisector is exact nowhere. It is what makes a corner pinch, and the
// error grows with the turn, which is exactly where `simplify` has left the
// points furthest apart.
//
// A sample off the spline has one heading and one dr/ds, so it has one correct
// angle and there is nothing to average away. The cost is point count: contacts
// now scale with how much the outline turns, not with the centerline.
export function offsetOutline(samples: Sample[]): Contact[] {
  return [];
  // const n = samples.length;
  // if (n === 0) return [];
  // if (n === 1) {
  //   const out: Contact[] = [];
  //   for (let k = 0; k < 4; k++) out.push(contactAt(samples[0], -k * (Math.PI / 2)));
  //   return out;
  // }

  // const out: Contact[] = [];
  // for (let i = 0; i < n; i++) out.push(contactAt(samples[i], samples[i].thru + samples[i].off));
  // const last = samples[n - 1];
  // pushSweep(out, last, last.thru + last.off, last.thru - last.off);
  // for (let i = n - 1; i >= 0; i--)
  //   out.push(contactAt(samples[i], samples[i].thru - samples[i].off));
  // const first = samples[0];
  // pushSweep(out, first, first.thru - first.off, first.thru + first.off);
  // return out;
}
