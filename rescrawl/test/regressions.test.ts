import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { getCenterline } from "../src/getCenterline.ts";
import { toOutlineNodeQuad } from "../src/outline/node-quad.ts";

// A saved stroke and the bench settings it was saved with, as the library takes
// them: "average" smoothing is the window, "none" is 0.
function sample(file: string) {
  const d = JSON.parse(readFileSync(new URL(`./samples/${file}`, import.meta.url), "utf8"));
  const s = d.settings;
  const options = {
    ...s,
    zoom: d.zoom,
    smoothWindow: s.smooth === "average" ? s.smoothWindow : 0,
  };
  return { raw: d.raw.slice(0, d.fed), options };
}

const finite = (o: object) => Object.values(o).every((v) => typeof v !== "number" || Number.isFinite(v));

describe("non-finite", () => {
  // Equal-weight smoothing gave two neighbours whose windows held the same
  // samples the same position, and the hand fit divided by the zero step.
  const { raw, options } = sample("2026-11-01T23-25-01-non-finite.json");
  test("every node and contact finite", () => {
    const { curves } = getCenterline({ curves: [], settled: 0 }, raw, options);
    const outline = toOutlineNodeQuad(curves, options).flat();
    curves.forEach((n, i) => assert.ok(finite(n), `node ${i}: ${JSON.stringify(n)}`));
    outline.forEach((c, i) => assert.ok(finite(c), `contact ${i}: ${JSON.stringify(c)}`));
  });
});
