import { arcAngles, contactAt, discLoop, wrapZeroTau } from "./contact";
import type { Shape } from "./engine";
import { clamp11, dist } from "./math";
import { simplify } from "./simplify";
import { centerlinePath, hermiteMag } from "./svg";
import type { Contact, Point4, RenderOptions } from "./types";

// --- the tension engine: polyline nodes, one contact per node per side ---
//
// Stage 3b is the tube simplify (`polylineNodes`). The outline carries every
// turn in the contacts' Hermite magnitudes instead of in extra contacts.
// Every interior node gets exactly one contact per side, at the
// (length-weighted) mean of its behind and ahead angles, with the usual
// perpendicular tangent. What varies is the contact's Hermite magnitude `m`,
// set by three things:
//
//   chord rule   the mean of the two chord rules meeting here — a smooth
//                spline wherever the data allows curvature.
//   sag cap      each chord is straight to within `sag·r` (what `simplify`
//                guarantees), so the bend the joint induces along it must stay
//                inside that: bulge ≈ (4/27)·m·sin δ, δ the angle between the
//                joint tangent and the chord, hence m ≤ (27/4)·sag·r / sin δ.
//                This is what keeps a long straight straight when the next
//                joint turns, and it does not depend on the chord's length.
//   corner floor `cornerScale·r·|turn|`, roughly what one cubic pair needs to
//                imitate the round corner a pen of radius r leaves, so a sharp
//                turn never collapses below the pen's own rounding.
//
// m = max(min(chord rule, sag caps), corner floor). Everything is continuous
// in the geometry, so nothing snaps.
//
// Only turns beyond `maxTurn` (near-backtracks) fall back to the tangent
// construction: an arc on the outside, the crossed pair on the inside.

export type TensionOptions = {
  sag: number; // how far a chord may be from straight, as a fraction of local r; Infinity = never cap
  cornerScale: number; // corner floor is cornerScale·r·|turn|; ~1.4 fits a round pen corner
  maxTurn: number; // rad; beyond this |turn| use the sweep / fold construction instead
  weighted: boolean; // parabolic (length-weighted) contact angle instead of the plain mid
  cornerPoint: boolean; // inside of a bend: push the contact out to where the two tangent lines cross
};

export function toOutlineTension(pts: Point4[], o: TensionOptions): Contact[] {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return discLoop(pts[0]);

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
    for (const a of arcAngles(from, to)) push(contactAt(c, a));
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

  // Magnitudes need the neighbours placed, so they come last. One `m` serves
  // both cubics that meet here, so the sag cap is the tighter of the two.
  const N = out.length;
  const sagCap = (from: Contact, to: Contact, c: Contact, s: number) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    // |sin δ| between the joint tangent and the chord, via the cross product.
    const sin = L > 0 ? Math.abs((dx * c.ty - dy * c.tx) / L) : 0;
    return sin > 0 ? (6.75 * s) / sin : Infinity;
  };
  for (let i = 0; i < N; i++) {
    const t = turns[i];
    if (!t) continue;
    const c = out[i];
    const prev = out[(i + N - 1) % N];
    const next = out[(i + 1) % N];
    const chord = (hermiteMag(prev, c) + hermiteMag(c, next)) / 2;
    const s = o.sag * t.r;
    const cap = Math.min(sagCap(prev, c, c, s), sagCap(c, next, c, s));
    const floor = o.cornerScale * t.r * Math.abs(t.g);
    c.m = Math.max(Math.min(chord, cap), floor);
  }
  return out;
}

// --- the engine ---

const DEG = Math.PI / 180;

export function tensionOptions(o: Required<RenderOptions>): TensionOptions {
  return {
    // The sag budget is what `simplify` guaranteed. Without it the chords are
    // raw samples, and there is nothing to hold the outline to.
    sag: o.simplify ? o.tol : Infinity,
    cornerScale: o.cornerScale,
    maxTurn: o.maxTurn * DEG,
    weighted: o.weightedAngle,
    cornerPoint: o.cornerPoint,
  };
}

// Reads: simplify, tol, simplifyMaxMs, liveBuffer, cornerScale, maxTurn,
// weightedAngle, cornerPoint.
export function tensionEngine(distinct: Point4[], o: Required<RenderOptions>): Shape {
  const nodes = o.simplify ? simplify(distinct, o.tol, o.simplifyMaxMs, o.liveBuffer) : distinct;
  return {
    nodes,
    outline: toOutlineTension(nodes, tensionOptions(o)),
    spine: centerlinePath(nodes),
  };
}
