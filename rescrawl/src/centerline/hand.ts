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
  o: Required<FitOptions> & { reparam: number },
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

  const t = [];
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

  const end = n - 1;

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

      const chordDirX = dx / chordLength;
      const chordDirY = dy / chordLength;

      const ca = t[a].x * chordDirX + t[a].y * chordDirY;
      const cb = t[b].x * chordDirX + t[b].y * chordDirY;

      // an end tangent pointing backwards along the chord leaves the triangle empty
      if (ca <= 0 || cb <= 0) {
        break;
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

        const alpha = 0.5;
        const lower = alpha * chordLength;
        const twoUpper = (3 - alpha) * chordLength;

        // projection on chord
        const maca = ma * ca;
        const mbcb = mb * cb;
        if (det === 0 || maca < lower || mbcb < lower || maca + mbcb > twoUpper) {
          const err = (m1: number, m2: number) =>
            A * m1 * m1 + 2 * B * m1 * m2 + C * m2 * m2 - 2 * E * m1 - 2 * F * m2;

          // where the hypotenuse meets each leg: the other projection is already at lower
          const upper = twoUpper - lower;
          const corners = [
            [lower / ca, lower / cb],
            [upper / ca, lower / cb],
            [lower / ca, upper / cb],
          ];
          let bestA = NaN;
          let bestB = NaN;
          let bestErr = Infinity;

          for (let k = 0; k < 3; k++) {
            const [pa, pb] = corners[k];
            const [qa, qb] = corners[(k + 1) % 3];
            const da = qa - pa;
            const db = qb - pb;

            const h = A * da * da + 2 * B * da * db + C * db * db;
            const g = (A * pa + B * pb - E) * da + (B * pa + C * pb - F) * db;

            // err(s) = err(P) + 2g * s + h * s^2
            // -g/h is root
            const step = h > 0 ? clamp(-g / h, 0, 1) : g < 0 ? 1 : 0;

            const m1 = pa + step * da;
            const m2 = pb + step * db;

            const err1 = err(m1, m2);
            if (err1 < bestErr) {
              bestA = m1;
              bestB = m2;
              bestErr = err1;
            }
          }
          ma = bestA;
          mb = bestB;
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

  return out;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(v, hi));
}
