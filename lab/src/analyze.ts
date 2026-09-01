import { clamp11, dist, wrapPi } from "rescrawl/math";
import type { Contact, Point4 } from "rescrawl/types";

// --- what the panel reads ---
//
// Two kinds of numbers live here, and the distinction matters when you are
// editing `toOutline`:
//
//   MIRRORED   `segments` and `joints` recompute thru/off/turn straight from
//              the points, the same way the function does. They are what the
//              formula SAYS should happen. If you change the formula, change
//              them here too or the tables go stale.
//   DERIVED    everything about the contacts is read back out of the array
//              `toOutline` actually returned -- which disc a contact sits on,
//              at what angle, whether its tangent is perpendicular to its
//              radius. Those stay honest no matter what you do to the function.
//
// So a disagreement between the two halves of the panel is a real signal.

export const FLAT = 1e-3; // keep in sync with outline.ts

export type Seg = {
  i: number;
  d: number;
  dr: number;
  thru: number;
  off: number;
  contained: boolean; // |dr| > d -- one disc swallows the other, no tangent exists
};

export type Joint = {
  i: number;
  side: 1 | -1;
  behind: number;
  ahead: number;
  turn: number;
  branch: "sweep" | "fold" | "flat";
};

export type Kind = "primary" | "arc" | "off-disc";

export type ContactInfo = {
  owner: number; // index of the disc it is closest to lying ON
  angle: number; // angle from that disc's centre
  kind: Kind; // does it match a thru+-off angle, or is it a sweep interior point?
  side: 0 | 1 | -1; // which side's candidate it matched, 0 if none
  radiusErr: number; // |dist(c, centre) - r|, should be ~0
  perpErr: number; // tangent . radial unit, should be ~0
  dupPrev: boolean; // sits on top of the previous contact
};

export type Crossing = { x: number; y: number; a: number; b: number };

export type Analysis = {
  segs: Seg[];
  joints: Joint[];
  info: ContactInfo[];
  crossings: Crossing[];
  area: number;
};

export function segments(pts: Point4[]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = dist(a, b);
    const dr = a.r - b.r;
    segs.push({
      i,
      d,
      dr,
      thru: Math.atan2(b.y - a.y, b.x - a.x),
      off: Math.acos(clamp11(d > 0 ? dr / d : 0)),
      contained: Math.abs(dr) > d,
    });
  }
  return segs;
}

// The two candidate angles at point `i` on one side: from the segment behind
// and from the segment ahead. Ends have one segment, so both collapse to it.
export function anglesAt(segs: Seg[], n: number, i: number, side: 1 | -1) {
  const back = segs[i > 0 ? i - 1 : 0];
  const fwd = segs[i < n - 1 ? i : n - 2];
  return [back.thru + side * back.off, fwd.thru + side * fwd.off] as const;
}

export function joints(pts: Point4[], segs: Seg[]): Joint[] {
  const n = pts.length;
  const out: Joint[] = [];
  if (n < 3) return out;
  for (let i = 1; i < n - 1; i++) {
    for (const side of [1, -1] as const) {
      const [behind, ahead] = anglesAt(segs, n, i, side);
      // Left walks forward, right walks backward, so the right side measures
      // the turn the other way round -- same as the two loops in `toOutline`.
      const turn = side === 1 ? wrapPi(ahead - behind) : wrapPi(behind - ahead);
      out.push({
        i,
        side,
        behind,
        ahead,
        turn,
        branch: Math.abs(turn) <= FLAT ? "flat" : turn < 0 ? "sweep" : "fold",
      });
    }
  }
  return out;
}

// Which disc is this contact on, and where? Read entirely off the output.
function classify(c: Contact, pts: Point4[], segs: Seg[]): ContactInfo {
  let owner = 0;
  let radiusErr = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const e = Math.abs(dist(c, pts[i]) - pts[i].r);
    if (e < radiusErr) {
      radiusErr = e;
      owner = i;
    }
  }
  const p = pts[owner];
  const angle = Math.atan2(c.y - p.y, c.x - p.x);
  const perpErr = c.tx * Math.cos(angle) + c.ty * Math.sin(angle);

  // A single disc has no segments, so every contact it emits is emitted
  // directly rather than by `pushSweep`.
  let kind: Kind = radiusErr > 1e-6 ? "off-disc" : pts.length === 1 ? "primary" : "arc";
  let side: 0 | 1 | -1 = 0;
  if (kind === "arc") {
    for (const s of [1, -1] as const) {
      for (const cand of anglesAt(segs, pts.length, owner, s)) {
        if (Math.abs(wrapPi(angle - cand)) < 1e-7) {
          kind = "primary";
          side = s;
        }
      }
    }
  }
  return { owner, angle, kind, side, radiusErr, perpErr, dupPrev: false };
}

// Where the contact polygon crosses itself. The painted shape is cubics, not
// this polygon, but a crossing here is a fold there -- it is how you see the
// inner side of a hard bend eating itself.
function selfCrossings(cs: Contact[]): Crossing[] {
  const n = cs.length;
  const out: Crossing[] = [];
  if (n < 4) return out;
  for (let a = 0; a < n; a++) {
    const p = cs[a];
    const p2 = cs[(a + 1) % n];
    for (let b = a + 2; b < n; b++) {
      if (a === 0 && b === n - 1) continue; // adjacent across the wrap
      const q = cs[b];
      const q2 = cs[(b + 1) % n];
      const rx = p2.x - p.x,
        ry = p2.y - p.y;
      const sx = q2.x - q.x,
        sy = q2.y - q.y;
      const den = rx * sy - ry * sx;
      if (den === 0) continue;
      const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den;
      const u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9)
        out.push({ x: p.x + rx * t, y: p.y + ry * t, a, b });
    }
  }
  return out;
}

const shoelace = (cs: Contact[]) => {
  let s = 0;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};

export function analyze(pts: Point4[], cs: Contact[]): Analysis {
  const segs = segments(pts);
  const info = cs.map((c) => classify(c, pts, segs));
  for (let i = 0; i < cs.length; i++)
    info[i].dupPrev = cs.length > 1 && dist(cs[i], cs[(i + cs.length - 1) % cs.length]) < 1e-9;
  return {
    segs,
    joints: joints(pts, segs),
    info,
    crossings: selfCrossings(cs),
    area: shoelace(cs),
  };
}
