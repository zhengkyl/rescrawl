import type { Point4 } from "../math.ts";

export function dropContained(pts: Point4[]) {
  const out: Point4[] = [];
  for (const p of pts) {
    let keep = true;
    while (out.length) {
      const q = out[out.length - 1];

      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dr = p.r - q.r;
      if (dx * dx + dy * dy > dr * dr) {
        break; // dist > delta r, nodes do not contain each other
      }

      if (dr < 0) {
        // q contains p
        keep = false;
        break;
      }

      // p contains q
      out.pop();
    }
    if (keep) out.push(p);
  }
  return out;
}
