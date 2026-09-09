import { clamp11, dist, wrapPi } from "rescrawl/math";
import type { Contact, FitNode, Point4, RenderOptions } from "rescrawl/types";

// --- what the panel reads ---
//
// Two kinds of numbers live here, and the distinction matters when you are
// editing an engine:
//
//   MIRRORED   `segments`, `joints` and `nodeRows` recompute the angles the
//              engine builds from, the same way the engine does. They are
//              what the formula SAYS should happen. If you change the
//              formula, change them here too or the tables go stale.
//   DERIVED    everything about the contacts is read back out of the array
//              the engine actually returned -- which disc a contact sits on,
//              at what angle, whether its tangent is perpendicular to its
//              radius. Those stay honest no matter what you do to the engine.
//
// So a disagreement between the two halves of the panel is a real signal.
//
// Everything is over the NODES (what the engine kept), not the input points;
// `ptOf` maps a node back to the point it came from for the labels.

export const FLAT = 1e-3; // polyline engines; `fit` uses SMOOTH_TURN in fit.ts
const SMOOTH_TURN = 0.02; // keep in sync with fit.ts

export type Seg = {
  i: number;
  d: number;
  dr: number;
  thru: number;
  off: number;
  contained: boolean; // |dr| > d -- one disc swallows the other, no tangent exists
};

// One node, one side, in traversal order `from` -> `to`. `turn` is positive
// on the outside of a bend (an arc is swept between the two angles) and
// negative on the inside (the contacts cross, or fold into one corner point).
export type Joint = {
  i: number;
  side: 1 | -1;
  from: number;
  to: number;
  turn: number;
  branch: "sweep" | "fold" | "flat";
};

// What a `fit` node carries, as angles.
export type NodeRow = {
  i: number;
  angIn: number;
  angOut: number;
  off: number; // acos(-slope): how far the contact tilts back from the normal
  mi: number;
  mo: number;
  slope: number;
  corner: boolean;
};

// `primary` sits at one of the angles the engine builds from; `joint` is a
// blended or pushed-out contact (tension's mid angle, or either engine's
// inner corner point); `arc` is a step of a sweep between them; `sample` is
// one of the sampled engine's envelope points, which sits off every disc by
// design. `off-disc` is left for anything unaccounted for, which is a bug.
export type Kind = "primary" | "joint" | "arc" | "sample" | "off-disc";

export type ContactInfo = {
  owner: number; // index of the NODE it is closest to lying on
  angle: number; // angle from that disc's centre
  kind: Kind;
  side: 0 | 1 | -1; // which side's candidate it matched, 0 if none
  radiusErr: number; // |dist(c, centre) - r|, should be ~0
  perpErr: number; // tangent . radial unit, should be ~0
  dupPrev: boolean; // sits on top of the previous contact
};

export type Crossing = { x: number; y: number; a: number; b: number };

export type Analysis = {
  segs: Seg[];
  joints: Joint[];
  nodeRows: NodeRow[] | null; // `fit` only
  info: ContactInfo[];
  crossings: Crossing[];
  area: number;
  ptOf: number[]; // node index -> input point index
  dropped: number[]; // input point indices the engine did not keep
};

export const isFitNode = (p: Point4): p is FitNode => "ix" in p;

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

// --- what the engine says it will do ---
//
// Both walks of an outline visit every interior node once, so per node per
// side there are two angles a contact goes between, and possibly one blended
// contact between them. That is plain data, computed once up front, and it is
// all the tables and the classifier need. Each engine fills it in its own way
// below; the two are deliberately not folded together, because the angles
// they build from have nothing in common but their shape.

type Expect = {
  from: number; // angle the walk arrives at this node on
  to: number; // angle it leaves on
  joint: number | null; // a single blended / pushed-out contact between them
};

type Expected = {
  fwd: Expect[]; // side -1: contacts at thru - off, walked start -> end
  back: Expect[]; // side +1: contacts at thru + off, walked end -> start
  flat: number; // a turn below this is not worth a second contact
};

const NO_ANGLES: Expect = { from: NaN, to: NaN, joint: null };

// `tension` and `classic`: the contact angles are the external tangent
// directions of the segments either side. Tension then puts one contact at
// their (length-weighted) mean; classic keeps both.
function polylineExpect(nodes: Point4[], segs: Seg[], o: Required<RenderOptions>): Expected {
  const n = nodes.length;
  const fwd: Expect[] = [];
  const back: Expect[] = [];
  for (let i = 0; i < n; i++) {
    // Ends have one segment, so both candidates collapse to it.
    const b = segs[i > 0 ? i - 1 : 0];
    const f = segs[i < n - 1 ? i : n - 2];
    if (!b || !f) {
      fwd.push(NO_ANGLES);
      back.push(NO_ANGLES);
      continue;
    }
    const interior = i > 0 && i < n - 1;
    const sum = interior ? segs[i - 1].d + segs[i].d : 0;
    // Only tension blends; classic keeps both contacts as they are.
    const mid = (from: number, to: number, w: number) =>
      o.engine === "tension" && interior
        ? from + wrapPi(to - from) * (o.weightedAngle && sum > 0 ? w : 0.5)
        : null;
    // The parabola through three points leans on the shorter segment: the
    // `to` heading gets the other segment's length as its weight. Mirrors
    // `weight` in tension.ts.
    const wFwd = interior ? segs[i - 1].d / sum : 0.5;
    const wBack = interior ? segs[i].d / sum : 0.5;
    const fFrom = b.thru - b.off;
    const fTo = f.thru - f.off;
    fwd.push({ from: fFrom, to: fTo, joint: mid(fFrom, fTo, wFwd) });
    const bFrom = f.thru + f.off;
    const bTo = b.thru + b.off;
    back.push({ from: bFrom, to: bTo, joint: mid(bFrom, bTo, wBack) });
  }
  return { fwd, back, flat: FLAT };
}

// `fit`: the contact angles come from the node's own in/out tangents, tilted
// back from the normal by the radius slope. They differ only at a corner, and
// only the inside of one gets a blended contact -- and only when the engine
// is pushing it out to where the two tangent lines cross.
function fitExpect(ns: FitNode[], o: Required<RenderOptions>): Expected {
  const n = ns.length;
  const fwd: Expect[] = [];
  const back: Expect[] = [];
  for (let i = 0; i < n; i++) {
    const off = Math.acos(clamp11(-ns[i].slope));
    const angIn = Math.atan2(ns[i].iy, ns[i].ix);
    const angOut = Math.atan2(ns[i].oy, ns[i].ox);
    const interior = i > 0 && i < n - 1;
    // `greedy` has no corner-point construction, so it never blends.
    const cornerPoint = o.cornerPoint && o.engine !== "greedy";
    const corner = (from: number, to: number) => {
      if (!cornerPoint || !interior) return null;
      const g = wrapPi(to - from);
      return g < -SMOOTH_TURN ? from + g / 2 : null;
    };
    // Mirrors the two loops in `toOutlineFit`.
    const fFrom = angIn - off;
    const fTo = angOut - off;
    fwd.push({ from: fFrom, to: fTo, joint: corner(fFrom, fTo) });
    const bFrom = angOut + off;
    const bTo = angIn + off;
    back.push({ from: bFrom, to: bTo, joint: corner(bFrom, bTo) });
  }
  return { fwd, back, flat: SMOOTH_TURN };
}

// Both walks of one interior node, as the tables show them.
export function joints(n: number, ex: Expected): Joint[] {
  const out: Joint[] = [];
  if (n < 3) return out;
  for (let i = 1; i < n - 1; i++) {
    for (const [side, e] of [
      [1, ex.back[i]],
      [-1, ex.fwd[i]],
    ] as [1 | -1, Expect][]) {
      const turn = wrapPi(e.to - e.from);
      out.push({
        i,
        side,
        from: e.from,
        to: e.to,
        turn,
        branch: Math.abs(turn) <= ex.flat ? "flat" : turn > 0 ? "sweep" : "fold",
      });
    }
  }
  return out;
}

function nodeRows(ns: FitNode[]): NodeRow[] {
  return ns.map((p, i) => ({
    i,
    angIn: Math.atan2(p.iy, p.ix),
    angOut: Math.atan2(p.oy, p.ox),
    off: Math.acos(clamp11(-p.slope)),
    mi: p.mi,
    mo: p.mo,
    slope: p.slope,
    corner: p.corner,
  }));
}

const sameAngle = (a: number, b: number) => Math.abs(wrapPi(a - b)) < 1e-7;

// Which disc is this contact on, and where? Read entirely off the output,
// except that `ex` says which angles count as primary and joint.

// Which disc is this contact on, and where? Read entirely off the output,
// except that `ex` says which angles count as primary and which as a joint.
// `sampled` says off-disc contacts are the engine's envelope samples rather
// than a mistake.
function classify(c: Contact, nodes: Point4[], ex: Expected, sampled: boolean): ContactInfo {
  const n = nodes.length;
  const sides: [1 | -1, Expect[]][] = [
    [1, ex.back],
    [-1, ex.fwd],
  ];
  let owner = 0;
  let radiusErr = Infinity;
  for (let i = 0; i < n; i++) {
    const e = Math.abs(dist(c, nodes[i]) - nodes[i].r);
    if (e < radiusErr) {
      radiusErr = e;
      owner = i;
    }
  }
  const onDisc = radiusErr <= 1e-6;

  // An inner corner point sits off every disc, so "nearest radius" can pick
  // the wrong owner for it. Prefer the interior disc whose joint angle it is on.
  if (!onDisc) {
    for (let i = 1; i < n - 1; i++) {
      const a = Math.atan2(c.y - nodes[i].y, c.x - nodes[i].x);
      for (const [, walk] of sides) {
        const j = walk[i].joint;
        if (j !== null && sameAngle(a, j)) {
          owner = i;
          radiusErr = Math.abs(dist(c, nodes[i]) - nodes[i].r);
        }
      }
    }
  }

  const p = nodes[owner];
  const angle = Math.atan2(c.y - p.y, c.x - p.x);
  const perpErr = c.tx * Math.cos(angle) + c.ty * Math.sin(angle);

  // A single disc has no segments, so every contact it emits is emitted
  // directly rather than as an arc step.
  let kind: Kind = !onDisc ? (sampled ? "sample" : "off-disc") : n === 1 ? "primary" : "arc";
  let side: 0 | 1 | -1 = 0;
  if (n > 1) {
    for (const [s, walk] of sides) {
      const e = walk[owner];
      if (onDisc && (sameAngle(angle, e.from) || sameAngle(angle, e.to))) {
        kind = "primary";
        side = s;
      }
      if (e.joint !== null && sameAngle(angle, e.joint)) {
        kind = "joint";
        side = s;
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

// Nodes are a subsequence of the points, in order, so one forward walk pairs
// them up. A node that matches nothing (it should not happen) keeps its own
// index.
function mapNodes(pts: Point4[], nodes: Point4[]): { ptOf: number[]; dropped: number[] } {
  const ptOf: number[] = [];
  const kept = new Set<number>();
  let j = 0;
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    while (j < pts.length && (pts[j].x !== nd.x || pts[j].y !== nd.y || pts[j].r !== nd.r)) j++;
    if (j < pts.length) {
      ptOf.push(j);
      kept.add(j);
      j++;
    } else ptOf.push(i);
  }
  const dropped: number[] = [];
  for (let i = 0; i < pts.length; i++) if (!kept.has(i)) dropped.push(i);
  return { ptOf, dropped };
}

export function analyze(
  pts: Point4[],
  nodes: Point4[],
  cs: Contact[],
  o: Required<RenderOptions>,
): Analysis {
  const segs = segments(nodes);
  // `fit`, `sampled` and `greedy` share fitCurve, so all carry FitNodes and
  // put their node contacts at the same angles. The latter two also put
  // contacts along the envelope between nodes, off every disc by design.
  const envelope = o.engine === "sampled" || o.engine === "greedy";
  const fit = (o.engine === "fit" || envelope) && nodes.every(isFitNode);
  const ex = fit ? fitExpect(nodes as FitNode[], o) : polylineExpect(nodes, segs, o);
  const info = cs.map((c) => classify(c, nodes, ex, envelope));
  for (let i = 0; i < cs.length; i++)
    info[i].dupPrev = cs.length > 1 && dist(cs[i], cs[(i + cs.length - 1) % cs.length]) < 1e-9;
  return {
    segs,
    joints: joints(nodes.length, ex),
    nodeRows: fit ? nodeRows(nodes as FitNode[]) : null,
    info,
    crossings: selfCrossings(cs),
    area: shoelace(cs),
    ...mapNodes(pts, nodes),
  };
}
