import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Centerline } from "../src/centerline/Centerline.ts";
import { setSpeedPressure } from "../src/brush/pressure.ts";
import type { Point3 } from "../src/math.ts";
import { OutlineBrush } from "../src/brush/OutlineBrush.ts";
import { RECORDED_STROKES, STROKES } from "./strokes.ts";

function outline(pts: Point3[], o: { minWidth: number; maxWidth: number; zoom: number }) {
  const line = new Centerline(pts, o);
  const fit = line.end();
  setSpeedPressure(fit.samples, o);
  return new OutlineBrush(o).pieces(fit).pieces.flat();
}

// the same hand motion at another zoom lays the same ink on screen
function scaleFree(pts: Point3[]) {
  const k = 2;
  const one = outline(pts, { minWidth: 1.5, maxWidth: 8, zoom: 1 });
  const two = outline(
    pts.map((p) => ({ x: p.x * k, y: p.y * k, t: p.t })),
    { minWidth: 1.5, maxWidth: 8, zoom: 1 / k },
  );
  assert.equal(two.length, one.length, "contact count changed with scale");
  for (let i = 0; i < one.length; i++) {
    const d = Math.hypot(one[i].x * k - two[i].x, one[i].y * k - two[i].y);
    assert.ok(d < 1e-9, `contact ${i} is ${d.toExponential(1)}px off`);
  }
}

describe("the outline is scale free", () => {
  for (const [name, pts] of Object.entries(STROKES)) {
    test(name, () => scaleFree(pts));
  }
  test(`bench.scrawl (${RECORDED_STROKES.length} strokes)`, () => {
    RECORDED_STROKES.forEach((pts) => scaleFree(pts));
  });
});
