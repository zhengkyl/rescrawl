import { dist, type Point3 } from "./math.ts";

// WIP api rework
function getCenterline(prev: N2[], points: Point3[], options: O2) {
  const pn = prev.length;
  if (pn >= 3) {
    // last segment can change
    points = points.slice(prev[pn - 2].inputIndex);
  }

  const n = points.length;
  if (n === 0) {
    return [];
  }

  const s = new Float64Array(n); // arc length prefix sum
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + dist(points[i - 1], points[i]);

  // const smooth = smoothPositions(points, options);
  // const clean = retime(smooth, options);
}

type O2 = {
  openT: number;
};

type N2 = {
  x: number;
  y: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;

  startT: number;
  endT: number;

  // width: number;
  inputIndex: number;
};
