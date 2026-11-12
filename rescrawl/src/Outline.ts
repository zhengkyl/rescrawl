import type { CubicNode } from "./centerline/fit.ts";
import { chordRule, clamp11, dist, TAU } from "./math.ts";

// A point of the outline and the handles of the cubic that leaves it for the
// next point, the last one leaving for the first. The same shape `CubicNode`
// gives the centerline. A straight stretch has its handles on its two ends.
export type OutlineNode = {
  x: number;
  y: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
};

// A point on a pen disc's rim and the unit direction the outline runs there,
// which is square to the radius.
type Contact = { x: number; y: number; tx: number; ty: number };

// y increases downwards, so angles increase clockwise on screen
function rimContact(c: CubicNode, a: number): Contact {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + c.r * cos, y: c.y + c.r * sin, tx: -sin, ty: cos };
}

// The cubic from A to B with its handles along the two tangents, a third of
// the chord rule long: the length that makes a circular arc of the turn.
function curve(A: Contact, B: Contact): OutlineNode {
  const m = chordRule(dist(A, B), A.tx, A.ty, B.tx, B.ty) / 3;
  return {
    x: A.x,
    y: A.y,
    c1x: A.x + A.tx * m,
    c1y: A.y + A.ty * m,
    c2x: B.x - B.tx * m,
    c2y: B.y - B.ty * m,
  };
}

function line(A: Contact, B: Contact): OutlineNode {
  return { x: A.x, y: A.y, c1x: A.x, c1y: A.y, c2x: B.x, c2y: B.y };
}

export type NodeCubicOptions = {
  outlineTol?: number; // screen px the drawn outline may stray from the envelope
  outlineDepth?: number; // most midpoint splits one centerline segment may take per side
  zoom?: number;
};

export const NODE_CUBIC_DEFAULTS: Required<NodeCubicOptions> = {
  outlineTol: 0.25,
  outlineDepth: 14,
  zoom: 1,
};

// Envelope points one candidate cubic is checked against, ends excluded: the
// ends are exact by construction.
const TEST = 8;

// Cubics per end cap. A cap is always a half turn: the radius is flat at a
// node, so both side contacts there sit square to the centerline. The
// chord-rule cubic of a half turn is the standard circular arc, off by 1.8% of
// the radius, and the caps are the one thing drawn without a check.
const CAP_CUBICS = 1;

// The stroke is split at corners, where a node has two tangents, and each piece
// is outlined on its own. Filled nonzero, the pieces' union is the stroke.
export function toOutlineNodeCubic(ns: CubicNode[], options: NodeCubicOptions): OutlineNode[][] {
  const { outlineTol, outlineDepth, zoom } = { ...NODE_CUBIC_DEFAULTS, ...options };
  const tol = outlineTol / zoom;

  if (ns.length === 0) return [];
  if (ns.length === 1) return [dot(ns[0])];

  const pieces: OutlineNode[][] = [];
  let start = 0;
  for (let i = 1; i < ns.length; i++) {
    if (i === ns.length - 1 || ns[i].corner) {
      pieces.push(piece(ns.slice(start, i + 1), tol, outlineDepth));
      start = i;
    }
  }
  return pieces;
}

// a stroke of one disc: two caps
function dot(p: CubicNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  const m = 2 * CAP_CUBICS;
  for (let j = 0; j < m; j++) {
    out.push(curve(rimContact(p, (TAU * j) / m), rimContact(p, (TAU * (j + 1)) / m)));
  }
  return out;
}

// One loop round the piece: out along one side, round the end cap, back along
// the other, round the start cap.
function piece(ns: CubicNode[], tol: number, maxDepth: number): OutlineNode[] {
  const n = ns.length;
  const tol2 = tol * tol;
  const out: OutlineNode[] = [];

  // Where the pen touches its envelope on side s of segment k at u. That is
  // not the normal offset: the radial direction to the contact satisfies
  // e·T = -dr/ds, so a growing pen touches behind the normal.
  const contact = (k: number, s: 1 | -1, u: number): Contact => {
    const a = ns[k];
    const b = ns[k + 1];
    const v = 1 - u;
    const x = v * v * v * a.x + 3 * v * v * u * a.c1x + 3 * v * u * u * a.c2x + u * u * u * b.x;
    const y = v * v * v * a.y + 3 * v * v * u * a.c1y + 3 * v * u * u * a.c2y + u * u * u * b.y;
    let dx = 3 * (v * v * (a.c1x - a.x) + 2 * v * u * (a.c2x - a.c1x) + u * u * (b.x - a.c2x));
    let dy = 3 * (v * v * (a.c1y - a.y) + 2 * v * u * (a.c2y - a.c1y) + u * u * (b.y - a.c2y));
    const speed = Math.sqrt(dx * dx + dy * dy);
    // radius is a smoothstep in u, flat at both nodes; `rs` is dr/ds
    const r = b.r + (a.r - b.r) * ((2 * u - 3) * u * u + 1);
    let rs = 0;
    if (speed > 0) {
      dx /= speed;
      dy /= speed;
      rs = clamp11(((a.r - b.r) * 6 * u * (u - 1)) / speed);
    } else {
      // a stalled handle: the chord's direction stands in
      const L = dist(a, b);
      dx = (b.x - a.x) / L;
      dy = (b.y - a.y) / L;
    }
    const w = s * Math.sqrt(1 - rs * rs);
    const ex = -rs * dx - w * dy;
    const ey = -rs * dy + w * dx;
    return { x: x + r * ex, y: y + r * ey, tx: -ey, ty: ex };
  };

  // Does the cubic A, ending at B, stay within `tol` of the envelope over
  // u0..u1?
  const covers = (
    k: number,
    s: 1 | -1,
    u0: number,
    u1: number,
    A: OutlineNode,
    B: Contact,
  ): boolean => {
    const p1x = A.c1x;
    const p1y = A.c1y;
    const p2x = A.c2x;
    const p2y = A.c2y;
    for (let j = 1; j <= TEST; j++) {
      const f = j / (TEST + 1);
      const p = contact(k, s, u0 + (u1 - u0) * f);
      // (ex, ey) runs from p to the cubic at v; two Newton steps on
      // d/dv |C(v) - p|² bring v to the nearest point
      let v = f;
      let ex = 0;
      let ey = 0;
      for (let step = 0; ; step++) {
        const w = 1 - v;
        ex = w * w * w * A.x + 3 * w * w * v * p1x + 3 * w * v * v * p2x + v * v * v * B.x - p.x;
        ey = w * w * w * A.y + 3 * w * w * v * p1y + 3 * w * v * v * p2y + v * v * v * B.y - p.y;
        if (step === 2) break;
        const dx = 3 * (w * w * (p1x - A.x) + 2 * w * v * (p2x - p1x) + v * v * (B.x - p2x));
        const dy = 3 * (w * w * (p1y - A.y) + 2 * w * v * (p2y - p1y) + v * v * (B.y - p2y));
        const ddx = 6 * (w * (p2x - 2 * p1x + A.x) + v * (B.x - 2 * p2x + p1x));
        const ddy = 6 * (w * (p2y - 2 * p1y + A.y) + v * (B.y - 2 * p2y + p1y));
        const g = ex * dx + ey * dy;
        const dg = dx * dx + dy * dy + ex * ddx + ey * ddy;
        // not a minimum this way: keep what there is
        if (dg <= 0) break;
        v -= g / dg;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      if (ex * ex + ey * ey > tol2) return false;
    }
    return true;
  };

  // The envelope of segment k, side s, from A at u0 to B at u1: every curve
  // it takes to get there.
  //
  // A span the cubic does not cover splits at its midpoint, so a settled
  // segment always splits in the same places. It stops splitting when it is
  // shorter than the tolerance or out of depth, and what is left is drawn as a
  // line, which cannot stray further than the envelope between its ends does.
  const span = (
    k: number,
    s: 1 | -1,
    u0: number,
    u1: number,
    A: Contact,
    B: Contact,
    depth: number,
  ) => {
    const c = curve(A, B);
    if (covers(k, s, u0, u1, c, B)) {
      out.push(c);
      return;
    }
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    if (depth < maxDepth && dx * dx + dy * dy >= tol2) {
      const um = (u0 + u1) / 2;
      const M = contact(k, s, um);
      span(k, s, u0, um, A, M, depth + 1);
      span(k, s, um, u1, M, B, depth + 1);
      return;
    }
    out.push(line(A, B));
  };

  // The half turn round p from one side's contact to the other's, in
  // increasing angle.
  const cap = (p: CubicNode, from: Contact, to: Contact) => {
    const angle = Math.atan2(from.y - p.y, from.x - p.x);
    let A = from;
    for (let j = 1; j < CAP_CUBICS; j++) {
      const B = rimContact(p, angle + (Math.PI * j) / CAP_CUBICS);
      out.push(curve(A, B));
      A = B;
    }
    out.push(curve(A, to));
  };

  // forward side, out from node 0
  const first = contact(0, -1, 0);
  let A = first;
  for (let k = 0; k < n - 1; k++) {
    const B = contact(k, -1, 1);
    span(k, -1, 0, 1, A, B, 0);
    A = B;
  }

  const back = contact(n - 2, 1, 1);
  cap(ns[n - 1], A, back);

  // back side, home to node 0
  A = back;
  for (let k = n - 2; k >= 0; k--) {
    const B = contact(k, 1, 0);
    span(k, 1, 1, 0, A, B, 0);
    A = B;
  }

  cap(ns[0], A, first);

  return out;
}
