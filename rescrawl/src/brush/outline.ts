import type { CenterlineFit, CubicNode } from "../centerline/fit.ts";
import { chordRule, clamp11, dist } from "../math.ts";

export type OutlineNode = {
  x: number;
  y: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
};

// one closed piece per run between corners; pieces[0..settled) can no longer change
export type OutlinePieces = { pieces: OutlineNode[][]; settled: number };

type Contact = { x: number; y: number; tx: number; ty: number };

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

// radius is a smoothstep between the two nodes'
function contact(ns: CubicNode[], r: number[], k: number, s: 1 | -1, u: number): Contact {
  const a = ns[k];
  const b = ns[k + 1];
  const v = 1 - u;
  const x = v * v * v * a.x + 3 * v * v * u * a.c1x + 3 * v * u * u * a.c2x + u * u * u * b.x;
  const y = v * v * v * a.y + 3 * v * v * u * a.c1y + 3 * v * u * u * a.c2y + u * u * u * b.y;
  let dx = 3 * (v * v * (a.c1x - a.x) + 2 * v * u * (a.c2x - a.c1x) + u * u * (b.x - a.c2x));
  let dy = 3 * (v * v * (a.c1y - a.y) + 2 * v * u * (a.c2y - a.c1y) + u * u * (b.y - a.c2y));
  const speed = Math.sqrt(dx * dx + dy * dy);
  const ra = r[k];
  const rb = r[k + 1];
  const rad = rb + (ra - rb) * ((2 * u - 3) * u * u + 1);
  // dr/ds
  let rs = 0;
  if (speed > 0) {
    dx /= speed;
    dy /= speed;
    rs = clamp11(((ra - rb) * 6 * u * (u - 1)) / speed);
  } else {
    // stalled handle: use the chord
    const L = dist(a, b);
    if (L === 0) {
      // both nodes on one spot
      dx = 1;
      dy = 0;
    } else {
      dx = (b.x - a.x) / L;
      dy = (b.y - a.y) / L;
    }
  }
  const w = s * Math.sqrt(1 - rs * rs);
  const ex = -rs * dx - w * dy;
  const ey = -rs * dy + w * dx;
  return { x: x + rad * ex, y: y + rad * ey, tx: -ey, ty: ex };
}

function dot(p: CubicNode, r: number): OutlineNode[] {
  const right = { x: p.x + r, y: p.y, tx: 0, ty: 1 };
  const left = { x: p.x - r, y: p.y, tx: 0, ty: -1 };
  return [curve(right, left), curve(left, right)];
}

// most turn across half a cubic: cos 20°
const MAX_TURN = Math.cos(Math.PI / 9);
const MAX_DEPTH = 4;

function span(
  out: OutlineNode[],
  ns: CubicNode[],
  r: number[],
  k: number,
  s: 1 | -1,
  u0: number,
  u1: number,
  A: Contact,
  B: Contact,
  depth: number,
) {
  const um = (u0 + u1) / 2;
  const M = contact(ns, r, k, s, um);
  if (A.tx * M.tx + A.ty * M.ty >= MAX_TURN && M.tx * B.tx + M.ty * B.ty >= MAX_TURN) {
    out.push(curve(A, B));
  } else if (depth === MAX_DEPTH) {
    out.push(line(A, B));
  } else {
    span(out, ns, r, k, s, u0, um, A, M, depth + 1);
    span(out, ns, r, k, s, um, u1, M, B, depth + 1);
  }
}

function side(out: OutlineNode[], ns: CubicNode[], r: number[], k: number, s: 1 | -1) {
  const u0 = s === -1 ? 0 : 1;
  const u1 = 1 - u0;
  span(out, ns, r, k, s, u0, u1, contact(ns, r, k, s, u0), contact(ns, r, k, s, u1), 0);
}

function piece(ns: CubicNode[], r: number[], lo: number, hi: number): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let k = lo; k < hi; k++) side(out, ns, r, k, -1);
  out.push(curve(contact(ns, r, hi - 1, -1, 1), contact(ns, r, hi - 1, 1, 1)));
  for (let k = hi - 1; k >= lo; k--) side(out, ns, r, k, 1);
  out.push(curve(contact(ns, r, lo, 1, 0), contact(ns, r, lo, -1, 0)));
  return out;
}

export function outlinePieces(fit: CenterlineFit, r: number[]): OutlinePieces {
  const ns = fit.nodes;
  const n = ns.length;
  if (n === 0) return { pieces: [], settled: 0 };
  if (n === 1) return { pieces: [dot(ns[0], r[0])], settled: fit.settled };

  const pieces: OutlineNode[][] = [];
  let settled = 0;
  let lo = 0;
  for (let hi = 1; hi < n; hi++) {
    if (!ns[hi].corner && hi < n - 1) continue;
    pieces.push(piece(ns, r, lo, hi));
    // its segments settled, and it ends on a corner or the finished stroke's end
    if (hi <= fit.settled && (ns[hi].corner || fit.settled === n)) settled = pieces.length;
    lo = hi;
  }
  return { pieces, settled };
}
