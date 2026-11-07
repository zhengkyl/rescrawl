import { dist, type Point3, quadControl } from "../src/math.ts";
import type { OutlineNode } from "../src/outline/contact.ts";

type Poly = { x: number; y: number }[];

// Each piece as `outlineQuadPath` draws it, flattened to a dense polygon.
// Testing against the contacts alone reports failures that are not real.
export function outlinePolygons(pieces: OutlineNode[][], step = 0.25): Poly[] {
  return pieces.map((cs) => {
    const out: Poly = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % cs.length];
      const q = quadControl(a.x, a.y, a.tx, a.ty, b.x, b.y, b.tx, b.ty) ?? {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
      const n = Math.max(3, Math.ceil((dist(a, b) + 1) / step));
      for (let j = 0; j < n; j++) {
        const u = j / n;
        const v = 1 - u;
        out.push({
          x: v * v * a.x + 2 * v * u * q.x + u * u * b.x,
          y: v * v * a.y + 2 * v * u * q.y + u * u * b.y,
        });
      }
    }
    return out;
  });
}

// Nonzero winding summed over every piece, the fill rule the renderer uses.
export function contains(polys: Poly[], px: number, py: number): boolean {
  let w = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
      if (a.y <= py) {
        if (b.y > py && side > 0) w++;
      } else if (b.y <= py && side < 0) w--;
    }
  }
  return w !== 0;
}

// Smallest fraction of any node's rim the outline contains. 1 is sound.
export function discCoverage(
  nodes: { x: number; y: number; r: number }[],
  pieces: OutlineNode[][],
  rim = 32,
): { worst: number; node: number } {
  const polys = outlinePolygons(pieces);
  let worst = 1;
  let node = -1;
  nodes.forEach((nd, i) => {
    let hit = 0;
    for (let k = 0; k < rim; k++) {
      const a = (2 * Math.PI * k) / rim;
      // 0.95 out: a point exactly on the rim is a coin toss for any winding test.
      if (contains(polys, nd.x + Math.cos(a) * nd.r * 0.95, nd.y + Math.sin(a) * nd.r * 0.95)) hit++;
    }
    if (hit / rim < worst) {
      worst = hit / rim;
      node = i;
    }
  });
  return { worst, node };
}

// One line of a `.scrawl`, so a stroke pastes in from the app as recorded.
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
