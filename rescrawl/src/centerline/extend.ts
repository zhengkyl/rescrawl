import { lerp, type Point2 } from "../math.ts";

export function extendFit(points: Point2[], iterations = 3) {
  const n = points.length;
  if (n < 2) {
    // todo, proper shape
    return null;
  }

  const cubics = [];

  const third = 1 / 3;
  // start as straight line
  let q0: Point2 = points[0];
  let q3: Point2 = points[1];

  let q1: Point2 = { x: lerp(q0.x, q3.x, third), y: lerp(q0.y, q3.y, third) };
  let q2: Point2 = { x: lerp(q0.x, q3.x, 2 * third), y: lerp(q0.y, q3.y, 2 * third) };

  let us = [1];
  let nextUs: number[] = [];

  const LOCK = 4; // points to lock start/prev tangent
  let prev: [Point2, Point2, Point2, Point2] | null = null;
  let prevW = 0;

  for (let i = 2; i < points.length; i++) {
    const p = points[i];

    // closest point on existing curve

    // convert to power basis
    const Ax = q3.x - 3 * q2.x + 3 * q1.x - q0.x;
    const Ay = q3.y - 3 * q2.y + 3 * q1.y - q0.y;
    const Bx = 3 * (q2.x - 2 * q1.x + q0.x);
    const By = 3 * (q2.y - 2 * q1.y + q0.y);
    const Cx = 3 * (q1.x - q0.x);
    const Cy = 3 * (q1.y - q0.y);
    const Dx = q0.x;
    const Dy = q0.y;

    let a = 1;
    for (let j = 0; j < iterations; j++) {
      const a2 = a * a;
      const a3 = a2 * a;

      const qax = Ax * a3 + Bx * a2 + Cx * a + Dx;
      const qay = Ay * a3 + By * a2 + Cy * a + Dy;

      const qpax = 3 * Ax * a2 + 2 * Bx * a + Cx;
      const qpay = 3 * Ay * a2 + 2 * By * a + Cy;

      const qppax = 6 * Ax * a + 2 * Bx;
      const qppay = 6 * Ay * a + 2 * By;

      const fa = (qax - p.x) * qpax + (qay - p.y) * qpay;
      const fpa = qpax * qpax + qpay * qpay + (qax - p.x) * qppax + (qay - p.y) * qppay;

      a = a - fa / fpa;
    }

    // a should scale inverse to curve length
    const maxA = 1 + 2 / us.length;
    if (1 < a && a < maxA) {
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

      const diffX = p.x - e3x;
      const diffY = p.y - e3y;

      if (diffX * diffX + diffY * diffY < 0.8 * 0.8) {
        const s = 1 / a;
        let b1sq = 0;
        let b2sq = 0;
        let b1b2 = 0;
        let b1b3 = 0;
        let b2b3 = 0;
        for (const u of us) {
          const nu = u * s;

          nextUs.push(nu);

          const nu2 = nu * nu;
          const nui = 1 - nu;
          const b1 = 3 * nu * nui * nui;
          const b2 = 3 * nu2 * nui;
          const b3 = nu2 * nu;

          b1sq += b1 * b1;
          b2sq += b2 * b2;
          b1b2 += b1 * b2;
          b1b3 += b1 * b3;
          b2b3 += b2 * b3;
        }
        nextUs.push(1);

        let alpha;
        let beta;

        if (prev) {
          const k =
            Math.hypot(e1x - q0.x, e1y - q0.y) / Math.hypot(q0.x - prev[2].x, q0.y - prev[2].y);
          let gamma;
          if (prevW === 0 && us.length < 2) {
            // neither side has an interior point: min-norm
            const nn = k * k * b1sq + b2sq;
            gamma = (k * b1b3) / nn;
            beta = -b2b3 / nn;
          } else {
            const m11 = k * k * b1sq + prevW;
            const m12 = -k * b1b2;
            const r1 = k * b1b3;
            const r2 = -b2b3;
            const det = m11 * b2sq - m12 * m12;
            gamma = (r1 * b2sq - m12 * r2) / det;
            beta = (m11 * r2 - m12 * r1) / det;
          }
          alpha = -k * gamma;
          prev[2] = { x: prev[2].x + gamma * diffX, y: prev[2].y + gamma * diffY };
        } else if (cubics.length > 0) {
          // joint tangent is locked: q1 stays put
          alpha = 0;
          beta = -b2b3 / b2sq;
        } else if (us.length < 2) {
          alpha = -b1b3 / (b1sq + b2sq);
          beta = -b2b3 / (b1sq + b2sq);
        } else {
          const det = b1sq * b2sq - b1b2 * b1b2;
          alpha = (-b1b3 * b2sq + b2b3 * b1b2) / det;
          beta = (b1sq * -b2b3 + b1b2 * b1b3) / det;
        }

        q1 = { x: e1x + alpha * diffX, y: e1y + alpha * diffY };
        q2 = { x: e2x + beta * diffX, y: e2y + beta * diffY };
        q3 = p;

        us = nextUs;
        nextUs = [];

        if (prev && us.length >= LOCK) {
          cubics.push(prev);
          prev = null;
        }

        continue;
      }
    }
    if (prev) cubics.push(prev);
    prev = [q0, q1, q2, q3];
    prevW = 0;
    for (const u of us) {
      const b2 = 3 * u * u * (1 - u);
      prevW += b2 * b2;
    }
    us = [1];

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

  if (prev) cubics.push(prev);
  cubics.push([q0, q1, q2, q3]);

  return cubics;
}
