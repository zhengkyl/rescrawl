import { chordRule, type Point4 } from "../math.ts";
import type { CenterlineNode, FitOptions } from "./fit.ts";

//   (ix, iy)  unit tangent arriving      (ox, oy)  unit tangent leaving
//   mi        length arriving            mo        length leaving
//   slope     dr/ds -- only the outline reads it; leave 0 until step 8
//
// The segment from node a to node b is the cubic Bezier
//
//   a,   a + (a.ox, a.oy) · a.mo/3,   b - (b.ix, b.iy) · b.mi/3,   b
//
// so mo = mi = 0 is a straight chord. The lengths are Hermite tangent
// lengths; a Bezier handle is a third of one. That is the whole output: which
// samples become nodes, and those numbers at each.
//
// thoughts
// b/c tangent at point n changes when n + 1 point is available
// segments are not "closed" until 2 points after end
// at any time, a segment can lose its last point
// and closed segments can reopen within one "frame"
//
//
export function fitHand(
  rawPts: Point4[],
  o: Required<FitOptions> & { reparam: number; open: boolean },
): CenterlineNode[] {
  if (rawPts.length === 0) return [];

  const pts = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    const prev = rawPts[i - 1];
    const curr = rawPts[i];
    if (curr.x !== prev.x || curr.y !== prev.y) {
      pts.push(curr);
    }
  }

  const n = pts.length;
  if (n === 1) {
    return [{ ...pts[0], ix: 1, iy: 0, ox: 1, oy: 0, mi: 0, mo: 0, slope: 0 }];
  }

  const s = [0];
  const x = [0];
  const y = [0];
  {
    let total = 0;
    let totalX = 0;
    let totalY = 0;
    let prev = pts[0];
    let curr;
    for (let i = 1; i < n; i++) {
      curr = pts[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      totalX += dx;
      totalY += dy;
      total += Math.sqrt(dx * dx + dy * dy);
      x.push(totalX);
      y.push(totalY);
      s.push(total);

      prev = curr;
    }
  }

  const t: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const curr = i;
    const prev = i > 0 ? i - 1 : 0;
    const next = i < n - 1 ? i + 1 : n - 1;

    const ax = x[curr] - x[prev];
    const ay = y[curr] - y[prev];
    const aMagn = s[curr] - s[prev];

    const bx = x[next] - x[curr];
    const by = y[next] - y[curr];
    const bMagn = s[next] - s[curr];

    if (i === 0) {
      t.push({ x: bx / bMagn, y: by / bMagn });
      continue;
    }
    if (i === n - 1) {
      t.push({ x: ax / aMagn, y: ay / aMagn });
      continue;
    }

    const tx = (bMagn / aMagn) * ax + (aMagn / bMagn) * bx;
    const ty = (bMagn / aMagn) * ay + (aMagn / bMagn) * by;
    const tMagn = Math.sqrt(tx * tx + ty * ty);

    if (tMagn === 0) {
      t.push({ x: bx / bMagn, y: by / bMagn });
      continue;
    }

    t.push({ x: tx / tMagn, y: ty / tMagn });
  }

  const out: CenterlineNode[] = [
    {
      ...pts[0],
      ix: t[0].x,
      iy: t[0].y,
      ox: t[0].x,
      oy: t[0].y,
      mi: 0,
      mo: 0,
      slope: 0,
    },
  ];

  const fitWidth = o.fitTol * o.maxWidth;

  const held = o.open && n > 2;
  const end = held ? n - 2 : n - 1;

  let a = 0;
  while (a < end) {
    let mo = 0;
    let mi = 0;

    let b = a + 1;
    while (b <= end) {
      const arc = s[b] - s[a];

      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const chordLength = Math.sqrt(dx * dx + dy * dy);
      if (chordLength === 0) break;

      const mc = chordRule(chordLength, t[a].x, t[a].y, t[b].x, t[b].y);

      const twoPoints = b === a + 1;
      if (twoPoints) {
        mo = mc;
        mi = mc;
        b++;
        continue;
      }

      let ma!: number;
      let mb!: number;

      let taX!: number;
      let taY!: number;
      let tbX!: number;
      let tbY!: number;

      const us: number[] = [];
      for (let j = a + 1; j < b; j++) {
        us.push((s[j] - s[a]) / arc);
      }

      let fits = true;
      const newtonIterations = o.reparam;
      for (let i = 0; i <= newtonIterations; i++) {
        let A = 0;
        let B = 0;
        let C = 0;
        let E = 0;
        let F = 0;
        for (let j = a + 1; j < b; j++) {
          const u = us[j - a - 1];

          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;

          const rjX = x[j] - h00 * x[a] - h01 * x[b];
          const rjY = y[j] - h00 * y[a] - h01 * y[b];
          A += h10 * h10;
          B += h10 * h11 * (t[a].x * t[b].x + t[a].y * t[b].y);
          C += h11 * h11;
          E += h10 * (t[a].x * rjX + t[a].y * rjY);
          F += h11 * (t[b].x * rjX + t[b].y * rjY);
        }
        const det = A * C - B * B;
        ma = (E * C - B * F) / det;
        mb = (A * F - B * E) / det;

        // ratio between slowest and fastest speed
        const alpha = 0.6;

        const stalls = (m1: number, m2: number) =>
          m1 <= 0 ||
          m2 <= 0 ||
          speedRatio(dx, dy, t[a].x * m1, t[a].y * m1, t[b].x * m2, t[b].y * m2) < alpha * alpha;

        if (det === 0 || stalls(ma, mb)) {
          // when does this stall?
          if (stalls(mc, mc)) {
            fits = false;
            break;
          }
          if (det === 0) {
            ma = mc;
            mb = mc;
          } else {
            let lo = 0;
            let hi = 1;
            for (let k = 0; k < 6; k++) {
              const mid = (lo + hi) / 2;
              if (stalls(ma + mid * (mc - ma), mb + mid * (mc - mb))) {
                lo = mid;
              } else {
                hi = mid;
              }
            }
            ma += hi * (mc - ma);
            mb += hi * (mc - mb);
          }
        }

        taX = t[a].x * ma;
        taY = t[a].y * ma;
        tbX = t[b].x * mb;
        tbY = t[b].y * mb;

        fits = true;
        for (let j = a + 1; j < b; j++) {
          const u = us[j - a - 1];

          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;

          const pux = h00 * x[a] + h10 * taX + h01 * x[b] + h11 * tbX;
          const puy = h00 * y[a] + h10 * taY + h01 * y[b] + h11 * tbY;

          const gapx = pux - x[j];
          const gapy = puy - y[j];

          const hp00 = 6 * u2 - 6 * u;
          const hp10 = 3 * u2 - 4 * u + 1;
          const hp01 = -6 * u2 + 6 * u;
          const hp11 = 3 * u2 - 2 * u;

          const ppux = hp00 * x[a] + hp10 * taX + hp01 * x[b] + hp11 * tbX;
          const ppuy = hp00 * y[a] + hp10 * taY + hp01 * y[b] + hp11 * tbY;

          const hpp00 = 12 * u - 6;
          const hpp10 = 6 * u - 4;
          const hpp01 = -12 * u + 6;
          const hpp11 = 6 * u - 2;

          const pppux = hpp00 * x[a] + hpp10 * taX + hpp01 * x[b] + hpp11 * tbX;
          const pppuy = hpp00 * y[a] + hpp10 * taY + hpp01 * y[b] + hpp11 * tbY;

          const f = gapx * ppux + gapy * ppuy;
          const fp = ppux * ppux + ppuy * ppuy + gapx * pppux + gapy * pppuy;

          // fp is second derivative, > 0 means upward parabola aka min, otherwise no good
          if (fp > 0) {
            us[j - a - 1] = Math.max(0, Math.min(u - f / fp, 1));
          }

          {
            const u = us[j - a - 1];
            const u2 = u * u;
            const u3 = u2 * u;
            const h00 = 2 * u3 - 3 * u2 + 1;
            const h10 = u3 - 2 * u2 + u;
            const h01 = -2 * u3 + 3 * u2;
            const h11 = u3 - u2;

            const pux = h00 * x[a] + h10 * taX + h01 * x[b] + h11 * tbX;
            const puy = h00 * y[a] + h10 * taY + h01 * y[b] + h11 * tbY;

            const gapx = pux - x[j];
            const gapy = puy - y[j];

            if (gapx * gapx + gapy * gapy > fitWidth * fitWidth) {
              fits = false;
            }
          }
        }

        if (fits) {
          break;
        }
      }

      if (!fits) break;
      mo = ma;
      mi = mb;
      b++;
    }
    b--;

    out[out.length - 1].mo = mo;
    out.push({
      ...pts[b],
      ix: t[b].x,
      iy: t[b].y,
      ox: t[b].x,
      oy: t[b].y,
      mi: mi,
      mo: 0,
      slope: 0,
    });

    a = b;
  }

  if (held) {
    const tip = n - 1;
    const dx = x[tip] - x[end];
    const dy = y[tip] - y[end];
    const m = chordRule(Math.sqrt(dx * dx + dy * dy), t[end].x, t[end].y, t[tip].x, t[tip].y);
    out[out.length - 1].mo = m;
    out.push({
      ...pts[tip],
      ix: t[tip].x,
      iy: t[tip].y,
      ox: t[tip].x,
      oy: t[tip].y,
      mi: m,
      mo: 0,
      slope: 0,
    });
  }

  return out;
}

function speedRatio(dx: number, dy: number, t0x: number, t0y: number, t1x: number, t1y: number) {
  // P'(u)
  const c0x = t0x;
  const c0y = t0y;
  const c1x = -4 * t0x - 2 * t1x + 6 * dx;
  const c1y = -4 * t0y - 2 * t1y + 6 * dy;
  const c2x = 3 * t0x + 3 * t1x - 6 * dx;
  const c2y = 3 * t0y + 3 * t1y - 6 * dy;

  // (P' . P')' / 2 = k3 u^3 + k2 u^2 + k1 u + k0
  const k0 = c0x * c1x + c0y * c1y;
  const k1 = c1x * c1x + c1y * c1y + 2 * (c0x * c2x + c0y * c2y);
  const k2 = 3 * (c1x * c2x + c1y * c2y);
  const k3 = 2 * (c2x * c2x + c2y * c2y);

  // find roots
  // 3 k3 u^2 + 2 k2 u + k1
  // -2 k2 +- sqrt(4 k2^2 - 12 k3 k1) / 6 k3
  // -k2 +- sqrt(k2^2 - 3 k3 k1) / 3 k3

  const fenceposts = [0];
  if (k3 > 0) {
    const discrim = k2 * k2 - 3 * k3 * k1;
    if (discrim > 0) {
      const root = Math.sqrt(discrim);
      const r1 = (-k2 - root) / (3 * k3);
      const r2 = (-k2 + root) / (3 * k3);
      if (r1 > 0 && r1 < 1) fenceposts.push(r1);
      if (r2 > 0 && r2 < 1) fenceposts.push(r2);
    }
  }
  fenceposts.push(1);

  const startV2 = c0x * c0x + c0y * c0y;
  const endX = c0x + c1x + c2x;
  const endY = c0y + c1y + c2y;
  const endV2 = endX * endX + endY * endY;

  let lo = Math.min(startV2, endV2);
  let hi = Math.max(startV2, endV2);

  for (let i = 1; i < fenceposts.length; i++) {
    let u0 = fenceposts[i - 1];
    let u1 = fenceposts[i];

    let f0 = k0 + u0 * (k1 + u0 * (k2 + u0 * k3));
    const f1 = k0 + u1 * (k1 + u1 * (k2 + u1 * k3));

    if (f0 * f1 > 0) continue;

    for (let k = 0; k < 14; k++) {
      const mid = (u0 + u1) / 2;
      const fm = k0 + mid * (k1 + mid * (k2 + mid * k3));
      if (f0 * fm <= 0) {
        u1 = mid;
      } else {
        u0 = mid;
        f0 = fm;
      }
    }

    const u = (u0 + u1) / 2;
    const vx = c0x + u * (c1x + u * c2x);
    const vy = c0y + u * (c1y + u * c2y);
    const speed = vx * vx + vy * vy;
    if (speed < lo) lo = speed;
    if (speed > hi) hi = speed;
  }
  return lo / hi;
}
