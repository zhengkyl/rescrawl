import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Point3 } from "../src/math.ts";
import { OUTLINES, type OutlineKind, renderStroke } from "../src/pipeline.ts";
import { RECORDED_STROKES, STROKES } from "./strokes.ts";

// Drawing at another zoom is drawing with the pen scaled to match: the same
// hand motion must lay the same ink on screen. At half the zoom the same screen
// path is twice as long in drawing px; with the pen doubled, the shape must come
// out identical, scaled. Every other option is in screen units and stays put.
function scaleFree(pts: Point3[], outline: OutlineKind) {
  const k = 2;
  const one = renderStroke(pts, { outline, minWidth: 1.5, maxWidth: 8 }).outline;
  const two = renderStroke(
    pts.map((p) => ({ x: p.x * k, y: p.y * k, t: p.t })),
    { outline, minWidth: 1.5 * k, maxWidth: 8 * k, zoom: 1 / k },
  ).outline;
  assert.equal(two.length, one.length, "contact count changed with scale");
  for (let i = 0; i < one.length; i++) {
    const d = Math.hypot(one[i].x * k - two[i].x, one[i].y * k - two[i].y);
    assert.ok(d < 1e-9, `contact ${i} is ${d.toExponential(1)}px off`);
  }
}

// Every outline, so a new one is held to it the moment it is registered.
for (const outline of Object.keys(OUTLINES) as OutlineKind[]) {
  describe(`${outline}: the fit is scale free`, () => {
    for (const [name, pts] of Object.entries(STROKES)) {
      test(name, () => scaleFree(pts, outline));
    }
    test(`bench.scrawl (${RECORDED_STROKES.length} strokes)`, () => {
      RECORDED_STROKES.forEach((pts) => scaleFree(pts, outline));
    });
  });
}
