import { clamp11, dist, TAU } from "./math";
import { hermiteMag } from "./svg";
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

function pushSweep2(out: Contact[], c: Point4, from: number, to: number): void {
  const span = wrapZeroTau(to - from);
  if (span < MIN_EXTERIOR_ANGLE_PER_BEZIER) {
    out.push(contactAt(c, from + span / 2));
    return;
  }

  const segments = Math.ceil(span / MAX_ANGLE_PER_BEZIER - ARC_EPS);
  for (let k = 0; k <= segments; k++) out.push(contactAt(c, from + (span * k) / segments));
}

// A cap that is exactly a half turn lands a hair over PI as often as not, and
// would flip between one and two cubics with the noise.
const ARC_EPS = 1e-9;

// Math.PI (2 cubic approx) has 1.8% error
// for reference, 3 segment is 0.15%, 4 segment is 0.027%
const MAX_ANGLE_PER_BEZIER = Math.PI / 2;

const MIN_EXTERIOR_ANGLE_PER_BEZIER = Math.PI / 4;
const MIN_INTERIOR_ANGLE_PER_BEZIER = Math.PI / 4;

export function toOutline(pts: Point4[]): Contact[] {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) {
    const out: Contact[] = [];
    for (let k = 0; k < TAU / MAX_ANGLE_PER_BEZIER; k++) {
      out.push(contactAt(pts[0], k * MAX_ANGLE_PER_BEZIER));
    }
    return out;
  }

  // y increases downwards, so unit circle is flipped vertically
  // angles increase clockwise

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

  const angles = (i: number, side: 1 | -1) => {
    const back = i > 0 ? i - 1 : 0;
    const fwd = i < n - 1 ? i : n - 2;
    return [thru[back] + side * off[back], thru[fwd] + side * off[fwd]] as const;
  };

  const out: Contact[] = [];

  // Start cap: the long way round the first disc, TAU - 2·off, back to the
  // contact the loop opened on.
  pushSweep2(out, pts[0], thru[0] + off[0], thru[0] - off[0]);

  for (let i = 1; i < n - 1; i++) {
    const [behind, ahead] = angles(i, -1);
    const [behind2, ahead2] = angles(i, 1);

    const outAngle = wrapZeroTau(ahead - behind2);
    const inAngle = wrapZeroTau(behind - behind2);

    if (outAngle < inAngle) {
      const gap = inAngle - outAngle;
      if (gap < MIN_INTERIOR_ANGLE_PER_BEZIER) {
        // out.push(contactAt(pts[i], behind));
        out.push(contactAt(pts[i], ahead + gap / 2));
      } else {
        // inside of a corner, don't sweep
        out.push(contactAt(pts[i], behind));
        out.push(contactAt(pts[i], ahead));
      }
    } else {
      pushSweep2(out, pts[i], behind, ahead);
    }
  }

  // End cap: round the last disc from its left contact to its right one. The
  // sweep is 2·off, which passes through the tip because the tip angle sits
  // between them by construction.
  const endL = thru[n - 2] - off[n - 2];
  const endR = thru[n - 2] + off[n - 2];
  pushSweep2(out, pts[n - 1], endL, endR);

  for (let i = n - 2; i >= 1; i--) {
    const [behind, ahead] = angles(i, 1);
    const [behind2, ahead2] = angles(i, -1);

    const outAngle = wrapZeroTau(behind - ahead2);
    const inAngle = wrapZeroTau(ahead - ahead2);

    if (outAngle < inAngle) {
      const gap = inAngle - outAngle;
      if (gap < MIN_INTERIOR_ANGLE_PER_BEZIER) {
        out.push(contactAt(pts[i], behind + gap / 2));
      } else {
        out.push(contactAt(pts[i], ahead));
        out.push(contactAt(pts[i], behind));
      }
    } else {
      pushSweep2(out, pts[i], ahead, behind);
    }
  }

  return out;
}

// --- one contact per node per side, with the turn carried by tension ---
//
// The model here is a smooth variable-width stroke, not discs joined by
// tangents. Every interior node gets exactly one contact per side, at the
// (length-weighted) mean of its behind and ahead angles, with the usual
// perpendicular tangent. What varies with the turn is the contact's Hermite
// magnitude `m`: a gentle bend keeps the chord rule, so the cubics through it
// stay a smooth spline; a sharp bend pulls `m` down toward `cornerScale·r·|g|`,
// which is roughly what one cubic pair needs to imitate the round corner a pen
// of radius r leaves. The blend is continuous in the turn, so nothing snaps.
//
// Only turns beyond `maxTurn` (near-backtracks) fall back to the tangent
// construction: an arc on the outside, the crossed pair on the inside.

export type TensionOptions = {
  cornerAngle: number; // rad; the turn at which `m` is halfway from the chord rule to the corner rule
  cornerScale: number; // corner rule is cornerScale·r·|turn|; ~1.4 fits a round pen corner
  maxTurn: number; // rad; beyond this |turn| use the sweep / fold construction instead
  weighted: boolean; // parabolic (length-weighted) contact angle instead of the plain mid
  cornerPoint: boolean; // inside of a bend: push the contact out to where the two tangent lines cross
};

export const TENSION_DEFAULTS: TensionOptions = {
  cornerAngle: Math.PI / 4,
  cornerScale: 10,
  maxTurn: Math.PI / 2,
  weighted: true,
  cornerPoint: true,
};

export function toOutlineTension(pts: Point4[], o: TensionOptions = TENSION_DEFAULTS): Contact[] {
  const n = pts.length;
  if (n < 2) return toOutline(pts);

  const thru = new Array<number>(n - 1);
  const off = new Array<number>(n - 1);
  const len = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = dist(a, b);
    len[i] = d;
    thru[i] = Math.atan2(b.y - a.y, b.x - a.x);
    off[i] = Math.acos(clamp11(d > 0 ? (a.r - b.r) / d : 0));
  }

  const out: Contact[] = [];
  // Per contact: the signed turn it absorbs and its disc radius, or null for
  // cap and fallback contacts, which keep the chord rule.
  const turns: ({ g: number; r: number } | null)[] = [];
  const push = (c: Contact, t: { g: number; r: number } | null = null) => {
    out.push(c);
    turns.push(t);
  };
  const pushArc = (c: Point4, from: number, to: number) => {
    const span = wrapZeroTau(to - from);
    const segments = Math.ceil(span / MAX_ANGLE_PER_BEZIER - ARC_EPS);
    for (let k = 0; k <= segments; k++) push(contactAt(c, from + (span * k) / segments));
  };

  // One side of one interior node, in traversal order `from` -> `to`. `ref` is
  // the other side's contact for the segment we arrived on: the turn is
  // convex when `to` lies on the far side of the disc from it. `wTo` is the
  // weight the parabolic tangent gives the `to` heading.
  const joint = (i: number, from: number, to: number, ref: number, wTo: number) => {
    const p = pts[i];
    const outAngle = wrapZeroTau(to - ref);
    const inAngle = wrapZeroTau(from - ref);
    const convex = outAngle >= inAngle;
    const g = convex ? wrapZeroTau(to - from) : -wrapZeroTau(from - to);

    if (Math.abs(g) > o.maxTurn) {
      if (convex) pushArc(p, from, to);
      else {
        push(contactAt(p, from));
        push(contactAt(p, to));
      }
      return;
    }

    const c = contactAt(p, from + g * (o.weighted ? wTo : 0.5));
    if (o.cornerPoint && !convex) {
      // Both tangent lines touch this disc, so they cross on the bisector at
      // r·sec(g/2) regardless of the neighbours' radii.
      const s = 1 / Math.cos(g / 2);
      c.x = p.x + (c.x - p.x) * s;
      c.y = p.y + (c.y - p.y) * s;
    }
    push(c, { g, r: p.r });
  };

  const weight = (i: number, ofAhead: boolean) => {
    const sum = len[i - 1] + len[i];
    if (sum === 0) return 0.5;
    // The parabola through three points leans on the shorter segment: the
    // ahead heading gets the behind length as its weight, and vice versa.
    return (ofAhead ? len[i - 1] : len[i]) / sum;
  };

  pushArc(pts[0], thru[0] + off[0], thru[0] - off[0]);
  for (let i = 1; i < n - 1; i++) {
    const behind = thru[i - 1] - off[i - 1];
    const ahead = thru[i] - off[i];
    joint(i, behind, ahead, thru[i - 1] + off[i - 1], weight(i, true));
  }
  pushArc(pts[n - 1], thru[n - 2] - off[n - 2], thru[n - 2] + off[n - 2]);
  for (let i = n - 2; i >= 1; i--) {
    const behind = thru[i - 1] + off[i - 1];
    const ahead = thru[i] + off[i];
    joint(i, ahead, behind, thru[i] - off[i], weight(i, false));
  }

  // Magnitudes need the neighbours placed, so they come last. The chord rule
  // is averaged over the two cubics that meet here so one `m` serves both.
  const N = out.length;
  const a2 = o.cornerAngle * o.cornerAngle;
  for (let i = 0; i < N; i++) {
    const t = turns[i];
    if (!t) continue;
    const c = out[i];
    const chord = (hermiteMag(out[(i + N - 1) % N], c) + hermiteMag(c, out[(i + 1) % N])) / 2;
    const corner = o.cornerScale * t.r * Math.abs(t.g);
    const g2 = t.g * t.g;
    const w = g2 + a2 === 0 ? 0 : g2 / (g2 + a2);
    c.m = chord + (corner - chord) * w;
  }
  return out;
}

export function offsetOutline(samples: Sample[]): Contact[] {
  return [];
}
