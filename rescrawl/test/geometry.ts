import type { Shape } from "../src/engine.ts";
import { chordRule, dist } from "../src/math.ts";
import type { Contact, Point3 } from "../src/types.ts";

// --- test helpers: is the drawn shape sound? ---
//
// Every bug worth catching here shows up the same way: some part of the pen's
// disc ends up outside the outline that is supposed to wrap it. So the checks
// below reconstruct the polygon the renderer actually emits and ask whether it
// still contains the ink.

// The outline as `outlinePath` emits it -- one cubic per contact pair, control
// points at a third of the Hermite tangent -- flattened to a dense polygon.
// Testing against the contacts alone is not good enough: chords cut across the
// curve wherever contacts are sparse, and report failures that are not real.
export function outlinePolygon(cs: Contact[], step = 0.25): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    const m = chordRule(dist(a, b), a.tx, a.ty, b.tx, b.ty);
    const ka = (a.mOut ?? a.m ?? m) / 3;
    const kb = (b.mIn ?? b.m ?? m) / 3;
    const c1x = a.x + a.tx * ka;
    const c1y = a.y + a.ty * ka;
    const c2x = b.x - b.tx * kb;
    const c2y = b.y - b.ty * kb;
    const n = Math.max(3, Math.ceil((dist(a, b) + 1) / step));
    for (let j = 0; j < n; j++) {
      const u = j / n;
      const v = 1 - u;
      out.push({
        x: v * v * v * a.x + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * b.x,
        y: v * v * v * a.y + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * b.y,
      });
    }
  }
  return out;
}

// Nonzero winding, which is the fill rule the renderer uses: on the inside of a
// turn the outline folds back over itself, and that fold is filled.
export function contains(poly: { x: number; y: number }[], px: number, py: number): boolean {
  let w = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && side > 0) w++;
    } else if (b.y <= py && side < 0) w--;
  }
  return w !== 0;
}

// The smallest fraction of any node's rim the outline contains. 1 means every
// disc is wrapped; anything less means the shape has cut across the ink.
export function discCoverage(shape: Shape, rim = 32): { worst: number; node: number } {
  const poly = outlinePolygon(shape.outline);
  let worst = 1;
  let node = -1;
  shape.nodes.forEach((nd, i) => {
    let hit = 0;
    for (let k = 0; k < rim; k++) {
      const a = (2 * Math.PI * k) / rim;
      // 0.95 of the way out: the rim itself is the boundary, and a point
      // exactly on it is a coin toss for any winding test.
      if (contains(poly, nd.x + Math.cos(a) * nd.r * 0.95, nd.y + Math.sin(a) * nd.r * 0.95)) hit++;
    }
    if (hit / rim < worst) {
      worst = hit / rim;
      node = i;
    }
  });
  return { worst, node };
}

// `x,y,t;dx,dy,dt;...` -- one line of a `.scrawl`, so a stroke can be pasted in
// from the app exactly as it was recorded.
export function stroke(line: string): Point3[] {
  const out: Point3[] = [];
  let x = 0;
  let y = 0;
  let t = 0;
  line.split(";").forEach((tok, i) => {
    const p = tok.split(",").map(Number);
    if (i === 0) [x, y, t] = p;
    else {
      x += p[0];
      y += p[1];
      t += p[2];
    }
    out.push({ x, y, t });
  });
  return out;
}
