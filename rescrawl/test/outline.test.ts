import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Centerline } from "../src/Centerline.ts";
import type { Point3 } from "../src/math.ts";
import { toOutlineNodeQuad } from "../src/outline/node-quad.ts";
import { RECORDED_STROKES, STROKES } from "./strokes.ts";

const outline = (pts: Point3[], o: { minWidth: number; maxWidth: number; zoom: number }) =>
  toOutlineNodeQuad(new Centerline(pts, o).curves(), o).flat();

// Drawing at another zoom is drawing with the pen scaled to match: the same
// hand motion must lay the same ink on screen. At half the zoom the same screen
// path is twice as long in drawing px; with the pen doubled, the shape must come
// out identical, scaled. Every other option is in screen units and stays put.
function scaleFree(pts: Point3[]) {
  const k = 2;
  const one = outline(pts, { minWidth: 1.5, maxWidth: 8, zoom: 1 });
  const two = outline(
    pts.map((p) => ({ x: p.x * k, y: p.y * k, t: p.t })),
    { minWidth: 1.5 * k, maxWidth: 8 * k, zoom: 1 / k },
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
