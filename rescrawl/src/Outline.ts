import type { CubicNode } from "./centerline/fit.ts";
import { chordRule, clamp11, dist, TAU } from "./math.ts";

export type OutlineNode = {
  x: number;
  y: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
};

// point on a disc's rim and the outline's unit direction there
type Contact = { x: number; y: number; tx: number; ty: number };

// y increases downwards, so angles increase clockwise on screen
function rimContact(c: CubicNode, a: number): Contact {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + c.r * cos, y: c.y + c.r * sin, tx: -sin, ty: cos };
}

// handles along the two tangents, at the length that makes a circular arc
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

export type OutlineOptions = {
  outlineTol?: number; // screen px the drawn outline may stray from the envelope
  outlineDepth?: number; // most midpoint splits one centerline segment may take per side
  zoom?: number;
};

export const OUTLINE_DEFAULTS: Required<OutlineOptions> = {
  outlineTol: 0.25,
  outlineDepth: 14,
  zoom: 1,
};

// Envelope points one candidate cubic is checked against
const TEST = 8;

// off by 1.8% of radius
const CAP_CUBICS = 1;

// a stroke of one disc: two caps
function dot(p: CubicNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  const m = 2 * CAP_CUBICS;
  for (let j = 0; j < m; j++) {
    out.push(curve(rimContact(p, (TAU * j) / m), rimContact(p, (TAU * (j + 1)) / m)));
  }
  return out;
}

// half turn round p, in increasing angle
function cap(out: OutlineNode[], p: CubicNode, from: Contact, to: Contact) {
  const angle = Math.atan2(from.y - p.y, from.x - p.x);
  let A = from;
  for (let j = 1; j < CAP_CUBICS; j++) {
    const B = rimContact(p, angle + (Math.PI * j) / CAP_CUBICS);
    out.push(curve(A, B));
    A = B;
  }
  out.push(curve(A, to));
}

// Where the pen touches its envelope on side s of segment k at u
function contact(ns: CubicNode[], k: number, s: 1 | -1, u: number): Contact {
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
}

// One closed piece per run between corners; filled nonzero, their union is the
// stroke. A segment's sides depend only on its own two nodes, so settled
// segments and settled pieces are built once.
export class Outline {
  private tol2: number;
  private maxDepth: number;

  private settled: OutlineNode[][] = [];
  private resume = 0;
  private forward: OutlineNode[][] = [];
  private back: OutlineNode[][] = [];

  constructor(options: OutlineOptions) {
    const { outlineTol, outlineDepth, zoom } = { ...OUTLINE_DEFAULTS, ...options };
    const tol = outlineTol / zoom;
    this.tol2 = tol * tol;
    this.maxDepth = outlineDepth;
  }

  // pieces at the front of the last `pieces()` that can no longer change
  settledCount(): number {
    return this.settled.length;
  }

  /**
   * @param ns From `Centerline.curves`
   * @param settledNodes From `Centerline.settledCount`; all of them when left out
   */
  pieces(ns: CubicNode[], settledNodes = ns.length): OutlineNode[][] {
    if (ns.length === 0) return [];
    if (ns.length === 1) return [dot(ns[0])];

    const open: OutlineNode[][] = [];
    let start = this.resume;
    for (let i = start + 1; i < ns.length; i++) {
      const ends = ns[i].corner || i === ns.length - 1;
      if (!ends) continue;
      const p = this.piece(ns, start, i, settledNodes);
      // settled once every segment is and its end cannot move: a corner, or
      // the last node of a finished stroke
      if (i <= settledNodes && (ns[i].corner || settledNodes === ns.length)) {
        this.settled.push(p);
        this.resume = i;
        // sides kept so far all belong to settled pieces
        this.forward.length = 0;
        this.back.length = 0;
      } else {
        open.push(p);
      }
      start = i;
    }
    return [...this.settled, ...open];
  }

  // one loop round nodes lo..hi: side, end cap, other side, start cap
  private piece(ns: CubicNode[], lo: number, hi: number, settledNodes: number): OutlineNode[] {
    const out: OutlineNode[] = [];
    for (let k = lo; k < hi; k++) {
      for (const c of this.side(ns, k, -1, settledNodes)) out.push(c);
    }
    cap(out, ns[hi], contact(ns, hi - 1, -1, 1), contact(ns, hi - 1, 1, 1));
    for (let k = hi - 1; k >= lo; k--) {
      for (const c of this.side(ns, k, 1, settledNodes)) out.push(c);
    }
    cap(out, ns[lo], contact(ns, lo, 1, 0), contact(ns, lo, -1, 0));
    return out;
  }

  // Side s of segment k as the loop walks it: with the stroke on side -1,
  // against it on side 1. Segment k is settled when node k is.
  private side(ns: CubicNode[], k: number, s: 1 | -1, settledNodes: number): OutlineNode[] {
    const kept = s === -1 ? this.forward : this.back;
    if (kept[k] !== undefined) return kept[k];
    const u0 = s === -1 ? 0 : 1;
    const u1 = 1 - u0;
    const out: OutlineNode[] = [];
    this.span(out, ns, k, s, u0, u1, contact(ns, k, s, u0), contact(ns, k, s, u1), 0);
    if (k < settledNodes) kept[k] = out;
    return out;
  }

  // The envelope from A at u0 to B at u1, onto `out`. A span the cubic does
  // not cover splits at its midpoint until it is shorter than the tolerance or
  // out of depth; what is left is drawn as a line, which cannot stray further
  // than the envelope between its ends does.
  private span(
    out: OutlineNode[],
    ns: CubicNode[],
    k: number,
    s: 1 | -1,
    u0: number,
    u1: number,
    A: Contact,
    B: Contact,
    depth: number,
  ) {
    const c = curve(A, B);
    if (this.covers(ns, k, s, u0, u1, c, B)) {
      out.push(c);
      return;
    }
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    if (depth < this.maxDepth && dx * dx + dy * dy >= this.tol2) {
      const um = (u0 + u1) / 2;
      const M = contact(ns, k, s, um);
      this.span(out, ns, k, s, u0, um, A, M, depth + 1);
      this.span(out, ns, k, s, um, u1, M, B, depth + 1);
      return;
    }
    out.push(line(A, B));
  }

  // does the cubic A, ending at B, stay within tolerance of the envelope?
  private covers(
    ns: CubicNode[],
    k: number,
    s: 1 | -1,
    u0: number,
    u1: number,
    A: OutlineNode,
    B: Contact,
  ): boolean {
    const p1x = A.c1x;
    const p1y = A.c1y;
    const p2x = A.c2x;
    const p2y = A.c2y;
    for (let j = 1; j <= TEST; j++) {
      const f = j / (TEST + 1);
      const p = contact(ns, k, s, u0 + (u1 - u0) * f);
      // (ex, ey) is p to the cubic at v; two Newton steps to the nearest point
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
        // not heading for a minimum
        if (dg <= 0) break;
        v -= g / dg;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      if (ex * ex + ey * ey > this.tol2) return false;
    }
    return true;
  }
}
