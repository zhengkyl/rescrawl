import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderStroke } from "../src/pipeline.ts";
import type { Point3 } from "../src/math.ts";
import { RECORDED_STROKES, STROKES } from "./strokes.ts";

// Every length in stage 4 is a multiple of `maxWidth`. Scale the drawing and
// the pen together and the shape must come out identical, scaled.
function scaleFree(pts: Point3[]) {
  const k = 2;
  const one = renderStroke(pts, { minWidth: 1.5, maxWidth: 8, thinSpeed: 1 }).outline;
  const two = renderStroke(
    pts.map((p) => ({ x: p.x * k, y: p.y * k, t: p.t })),
    { minWidth: 1.5 * k, maxWidth: 8 * k, thinSpeed: 1 * k },
  ).outline;
  assert.equal(two.length, one.length, "contact count changed with scale");
  for (let i = 0; i < one.length; i++) {
    const d = Math.hypot(one[i].x * k - two[i].x, one[i].y * k - two[i].y);
    assert.ok(d < 1e-9, `contact ${i} is ${d.toExponential(1)}px off`);
  }
}

describe("the fit is scale free", () => {
  for (const [name, pts] of Object.entries(STROKES)) test(name, () => scaleFree(pts));
  test(`bench.scrawl (${RECORDED_STROKES.length} strokes)`, () => {
    RECORDED_STROKES.forEach(scaleFree);
  });
});
