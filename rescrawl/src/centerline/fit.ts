import { chordRule } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type CubicNode = {
  x: number;
  y: number;
  tStart: number;
  tEnd: number;
  corner: boolean;

  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
};

export type FitOptions = {
  tolerance?: number;
  refitRounds?: number; // rounds of resolving sample's u
  settleTime?: number; // most ms of drawing one segment may span
};

export type CenterlineFit = {
  samples: Sample[];
  nodes: CubicNode[];
  settled: number;
};

const SPARSE = 20; // multiple of tolerance

// In o.tolerance. A tangent leans on the samples before it, not the one after,
// in proportion to the span it ends, wholly from LEAN.
const LEAN = 50;

// all 0 movement points must be filtered out before
//
// keeps prev's settled nodes and fits on from where the first unsettled one
// starts; nodes decided by samples[0..stableIndex] settle
// stableIndex === samples.length - 1 means the stroke is done, so all nodes settle
//
// writes `at` on every sample, those before the resume point as prev placed them
export function fitCubics(
  samples: Sample[],
  o: { tolerance: number; refitRounds: number; settleTime: number },
  stableIndex: number,
  prev: CenterlineFit,
): CenterlineFit {
  // the first unsettled node starts at the first sample placed at it
  let resume = 0;
  while (resume < prev.samples.length && prev.samples[resume].at !== prev.settled) resume++;
  for (let i = 0; i < resume; i++) samples[i].at = prev.samples[i].at;

  const body = prev.nodes.slice(0, prev.settled);
  const tail: CubicNode[] = [];

  const n = samples.length;
  const done = stableIndex === n - 1;
  if (n === 1) {
    const first = samples[0];
    first.at = body.length;
    (done ? body : tail).push(node(first, first.x, first.y, first.x, first.y));
    return { samples, nodes: [...body, ...tail], settled: body.length };
  }

  const x = [0];
  const y = [0];
  {
    let totalX = 0;
    let totalY = 0;
    let prev = samples[0];
    let curr;
    for (let i = 1; i < n; i++) {
      curr = samples[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      totalX += dx;
      totalY += dy;
      x.push(totalX);
      y.push(totalY);

      prev = curr;
    }
  }

  const tin: { x: number; y: number }[] = [];
  const tout: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const curr = i;
    const prev = i > 0 ? i - 1 : 0;
    const next = i < n - 1 ? i + 1 : n - 1;

    const ax = x[curr] - x[prev];
    const ay = y[curr] - y[prev];
    const aMagn = samples[curr].s - samples[prev].s;

    const bx = x[next] - x[curr];
    const by = y[next] - y[curr];
    const bMagn = samples[next].s - samples[curr].s;

    if (i === 0) {
      tin.push({ x: bx / bMagn, y: by / bMagn });
      tout.push(tin[i]);
      continue;
    }
    if (i === n - 1) {
      tin.push({ x: ax / aMagn, y: ay / aMagn });
      tout.push(tin[i]);
      continue;
    }
    if (samples[i].corner) {
      tin.push({ x: ax / aMagn, y: ay / aMagn });
      tout.push({ x: bx / bMagn, y: by / bMagn });
      continue;
    }

    const tx = (bMagn / aMagn) * ax + (aMagn / bMagn) * bx;
    const ty = (bMagn / aMagn) * ay + (aMagn / bMagn) * by;
    const tMagn = Math.sqrt(tx * tx + ty * ty);

    if (tMagn === 0) {
      tin.push({ x: bx / bMagn, y: by / bMagn });
      tout.push(tin[i]);
      continue;
    }

    tin.push({ x: tx / tMagn, y: ty / tMagn });
    tout.push(tin[i]);
  }

  // back[i]: the tangent at i of the circle through i and the two samples
  // before it, which is known as soon as i is
  const back: ({ x: number; y: number } | undefined)[] = [];
  for (let i = 0; i < n; i++) {
    back.push(undefined);
    if (i < 2 || samples[i - 1].corner) continue;
    const c = tin[i - 1];
    const bx = x[i] - x[i - 1];
    const by = y[i] - y[i - 1];
    const L = Math.sqrt(bx * bx + by * by);
    const along = (c.x * bx + c.y * by) / L;
    if (along > 0) back[i] = { x: (2 * along * bx) / L - c.x, y: (2 * along * by) / L - c.y };
  }
  for (let i = n - 2; i >= 1; i--) {
    const b = back[i];
    if (b === undefined || samples[i].corner) continue;
    const c = tin[i];
    if (b.x * c.x + b.y * c.y <= 0) continue;
    const L = Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    const w = Math.min(1, L / (LEAN * o.tolerance));
    const tx = (1 - w) * c.x + w * b.x;
    const ty = (1 - w) * c.y + w * b.y;
    const tMagn = Math.sqrt(tx * tx + ty * ty);
    tin[i] = { x: tx / tMagn, y: ty / tMagn };
    tout[i] = tin[i];
  }
  if (!done) {
    // the tip's tangent, were the pen to keep the turn it has
    const guess = back[n - 1];
    if (guess !== undefined) tin[n - 1] = guess;
  }

  // What the fit is held to: the samples, and where two are sparse, points
  // along the arc drawn between them. `di[i]` is where sample i sits among them.
  const X: number[] = [];
  const Y: number[] = [];
  const di: number[] = [];
  for (let i = 0; i < n; i++) {
    di.push(X.length);
    X.push(x[i]);
    Y.push(y[i]);
    if (i === n - 1) continue;
    const chord = Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i]);
    const between = Math.ceil(chord / (SPARSE * o.tolerance)) - 1;
    if (between < 1) continue;
    const m = chordRule(chord, tout[i].x, tout[i].y, tin[i + 1].x, tin[i + 1].y);
    for (let j = 1; j <= between; j++) {
      const u = j / (between + 1);
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      X.push(h00 * x[i] + h10 * m * tout[i].x + h01 * x[i + 1] + h11 * m * tin[i + 1].x);
      Y.push(h00 * y[i] + h10 * m * tout[i].y + h01 * y[i + 1] + h11 * m * tin[i + 1].y);
    }
  }

  let a = resume;
  while (a < n - 1) {
    let mo = 0;
    let mi = 0;
    let fitUs: number[] = [];
    const da = di[a];

    let b = a + 1;
    while (b < n && (b - 1 === a || !samples[b - 1].corner)) {
      if (b - 1 !== a && samples[b].t - samples[a].tOut > o.settleTime) break;
      const db = di[b];

      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const chordLength = Math.sqrt(dx * dx + dy * dy);
      if (chordLength === 0) break;

      const mc = chordRule(chordLength, tout[a].x, tout[a].y, tin[b].x, tin[b].y);

      const twoPoints = b === a + 1;
      if (twoPoints) {
        mo = mc;
        mi = mc;
        fitUs = [];
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
      let arc = 0;
      for (let j = da + 1; j <= db; j++) {
        arc += Math.hypot(X[j] - X[j - 1], Y[j] - Y[j - 1]);
        us.push(arc);
      }
      us.pop();
      for (let j = 0; j < us.length; j++) us[j] /= arc;

      let fits = true;
      const newtonIterations = o.refitRounds;
      for (let i = 0; i <= newtonIterations; i++) {
        let A = 0;
        let B = 0;
        let C = 0;
        let E = 0;
        let F = 0;
        for (let j = da + 1; j < db; j++) {
          const u = us[j - da - 1];

          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;

          const rjX = X[j] - h00 * x[a] - h01 * x[b];
          const rjY = Y[j] - h00 * y[a] - h01 * y[b];
          A += h10 * h10;
          B += h10 * h11 * (tout[a].x * tin[b].x + tout[a].y * tin[b].y);
          C += h11 * h11;
          E += h10 * (tout[a].x * rjX + tout[a].y * rjY);
          F += h11 * (tin[b].x * rjX + tin[b].y * rjY);
        }
        const det = A * C - B * B;
        ma = (E * C - B * F) / det;
        mb = (A * F - B * E) / det;

        // ratio between slowest and fastest speed
        const alpha = 0.6;

        const stalls = (m1: number, m2: number) =>
          m1 <= 0 ||
          m2 <= 0 ||
          speedRatio(dx, dy, tout[a].x * m1, tout[a].y * m1, tin[b].x * m2, tin[b].y * m2) <
            alpha * alpha;

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

        taX = tout[a].x * ma;
        taY = tout[a].y * ma;
        tbX = tin[b].x * mb;
        tbY = tin[b].y * mb;

        fits = true;
        for (let j = da + 1; j < db; j++) {
          const u = us[j - da - 1];

          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;

          const pux = h00 * x[a] + h10 * taX + h01 * x[b] + h11 * tbX;
          const puy = h00 * y[a] + h10 * taY + h01 * y[b] + h11 * tbY;

          const gapx = pux - X[j];
          const gapy = puy - Y[j];

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
            us[j - da - 1] = Math.max(0, Math.min(u - f / fp, 1));
          }

          {
            const u = us[j - da - 1];
            const u2 = u * u;
            const u3 = u2 * u;
            const h00 = 2 * u3 - 3 * u2 + 1;
            const h10 = u3 - 2 * u2 + u;
            const h01 = -2 * u3 + 3 * u2;
            const h11 = u3 - u2;

            const pux = h00 * x[a] + h10 * taX + h01 * x[b] + h11 * tbX;
            const puy = h00 * y[a] + h10 * taY + h01 * y[b] + h11 * tbY;

            const gapx = pux - X[j];
            const gapy = puy - Y[j];

            if (gapx * gapx + gapy * gapy > o.tolerance * o.tolerance) {
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
      fitUs = us;
      b++;
    }
    // two samples in one place: nothing fits, and the span is taken as it is
    if (b === a + 1) b++;
    b--;

    // tin[b] reads samples[b + 1]
    const settles = done || b < stableIndex;

    const k = body.length + tail.length;
    samples[a].at = k;
    // a sample whose u did not land past the one before shares its place
    let lastU = 0;
    for (let j = a + 1; j < b; j++) {
      const u = fitUs[di[j] - da - 1];
      if (u > lastU && u < 1) lastU = u;
      samples[j].at = k + lastU;
    }
    (settles ? body : tail).push(
      node(
        samples[a],
        samples[a].x + (mo / 3) * tout[a].x,
        samples[a].y + (mo / 3) * tout[a].y,
        samples[b].x - (mi / 3) * tin[b].x,
        samples[b].y - (mi / 3) * tin[b].y,
      ),
    );
    a = b;
  }

  const last = samples[n - 1];
  last.at = body.length + tail.length;
  (done ? body : tail).push(node(last, last.x, last.y, last.x, last.y));

  return { samples, nodes: [...body, ...tail], settled: body.length };
}

function node(s: Sample, c1x: number, c1y: number, c2x: number, c2y: number): CubicNode {
  return { x: s.x, y: s.y, tStart: s.t, tEnd: s.tOut, corner: s.corner, c1x, c1y, c2x, c2y };
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
