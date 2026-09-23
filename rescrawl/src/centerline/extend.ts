import { lerp, type Point2 } from "../math.ts";

export function extendFit(points: Point2[]) {
  const n = points.length;
  if (n < 2) {
    // todo, proper shape
    return null;
  }

  const cubics = [];

  const MAX_DELTA = 2;
  const third = 1 / 3;
  // start as straight line
  let q0: Point2 = points[0];
  let q3: Point2 = points[1];

  let q1: Point2 = { x: lerp(q0.x, q3.x, third), y: lerp(q0.y, q3.y, third) };
  let q2: Point2 = { x: lerp(q0.x, q3.x, 2 * third), y: lerp(q0.y, q3.y, 2 * third) };

  for (let i = 2; i < points.length; i++) {
    const p = points[i];

    // naive linear guess
    // tangent = q3 + Q'(1)
    // project p onto tangent
    const dpx = p.x - q3.x;
    const dpy = p.y - q3.y;

    const qpx = 3 * (q3.x - q2.x);
    const qpy = 3 * (q3.y - q2.y);

    const dot = dpx * qpx + dpy * qpy;
    const magn2 = qpx * qpx + qpy * qpy;

    const delta = dot / magn2;

    if (0 < delta && delta <= MAX_DELTA) {
      const a = 1 + delta;

      const ai = 1 - a;
      const ai2 = ai * ai;
      const ai3 = ai2 * ai;
      const a2 = a * a;
      const a3 = a2 * a;

      // const e0x = q0.x;
      // const e0y = q0.y;
      const e1x = ai * q0.x + a * q1.x;
      const e1y = ai * q0.y + a * q1.y;
      const e2x = ai2 * q0.x + 2 * a * ai * q1.x + a2 * q2.x;
      const e2y = ai2 * q0.y + 2 * a * ai * q1.y + a2 * q2.y;
      const e3x = ai3 * q0.x + 3 * ai2 * a * q1.x + 3 * ai * a2 * q2.x + a3 * q3.x;
      const e3y = ai3 * q0.y + 3 * ai2 * a * q1.y + 3 * ai * a2 * q2.y + a3 * q3.y;

      const diffX = e3x - p.x;
      const diffY = e3y - p.y;
      if (diffX * diffX + diffY * diffY < 2 * 2) {
        q1 = { x: e1x, y: e1y };
        q2 = { x: e2x, y: e2y };
        q3 = { x: e3x, y: e3y };
        continue;
      }
    }

    cubics.push([q0, q1, q2, q3]);

    const tx = q3.x - q2.x;
    const ty = q3.y - q2.y;
    const tm = Math.sqrt(tx * tx + ty * ty);

    const cx = p.x - q3.x;
    const cy = p.y - q3.y;
    const chord = Math.sqrt(cx * cx + cy * cy);

    q0 = q3;
    q1 = { x: q3.x + (tx / tm) * chord * third, y: q3.y + (ty / tm) * chord * third };
    q2 = { x: lerp(q0.x, p.x, 2 * third), y: lerp(q0.y, p.y, 2 * third) };
    q3 = p;
  }

  cubics.push([q0, q1, q2, q3]);

  return cubics;
}
