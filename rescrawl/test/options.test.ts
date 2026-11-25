import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Centerline } from "../src/centerline/Centerline.ts";
import { gridDigits } from "../src/svg.ts";
import { STROKES } from "./strokes.ts";

describe("options", () => {
  test("an option given as undefined takes its default", () => {
    const left = new Centerline([...STROKES.curve], {}).end();
    const unset = { zoom: undefined, tolerance: undefined };
    const given = new Centerline([...STROKES.curve], unset).end();
    assert.deepEqual(given, left);
  });

  test("zero tolerance and zoom are refused", () => {
    assert.throws(() => new Centerline([], { tolerance: 0 }), RangeError);
    assert.throws(() => new Centerline([], { zoom: 0 }), RangeError);
  });
});

describe("svg grid", () => {
  test("its step is at most a fifth of the tolerance, and no finer than needed", () => {
    for (const tol of [0.005, 0.05, 0.3, 0.5, 1, 7, 10, 40, 1000]) {
      const digits = gridDigits(tol);
      const step = 10 ** -digits;
      assert.ok(step <= tol / 5, `${tol}: step ${step}`);
      if (digits > 0) assert.ok(step * 10 > tol / 5, `${tol}: step ${step} finer than needed`);
    }
    assert.equal(gridDigits(0.5), 1, "the default zoom keeps one digit");
  });
});
