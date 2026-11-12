import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { Centerline, stableSamples } from "../src/Centerline.ts";
import { Outline } from "../src/Outline.ts";
import { markCorners } from "../src/centerline/corner.ts";
import { retimeBadTimesteps } from "../src/centerline/retime.ts";
import { toSmoothSamples } from "../src/centerline/smooth.ts";
import type { Point3 } from "../src/math.ts";
import { varyThickness } from "../src/thickness/radius.ts";

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
  return { raw: d.raw.slice(0, d.fed) as Point3[], options };
}

// input arrives frame-coalesced: the points of one frame share a timestamp
function frames(raw: Point3[]): Point3[][] {
  const out: Point3[][] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && last[0].t === p.t) last.push(p);
    else out.push([p]);
  }
  return out;
}

const files = readdirSync(new URL("./samples/", import.meta.url)).filter((f) =>
  f.endsWith(".json"),
);

describe("stable samples don't change as the stroke goes on", () => {
  for (const file of files) {
    test(file, () => {
      const { raw, options } = sample(file);
      // zoom-scaled, as the pipeline sees them
      const o = new Centerline([], options)["options"];

      const run = (points: Point3[]) => {
        const { samples, arcLengths, placed } = toSmoothSamples(points, o);
        const stable = stableSamples(samples, arcLengths, placed, o.cornerArm);
        retimeBadTimesteps(samples, arcLengths, o);
        markCorners(samples, arcLengths, o);
        varyThickness(samples, arcLengths, o);
        return { samples, stable };
      };

      const full = run(raw).samples;
      let fed = 0;
      for (const frame of frames(raw)) {
        fed += frame.length;
        const { samples, stable } = run(raw.slice(0, fed));
        const i = samples.findIndex((s, i) => i < stable && !isDeepStrictEqual(s, full[i]));
        assert.equal(i, -1, `sample ${i} of ${stable} stable changed after ${fed} points`);
      }
    });
  }
});

describe("settled ink is what a single pass draws", () => {
  for (const file of files) {
    test(file, () => {
      const { raw, options } = sample(file);

      const live = new Centerline([], options);
      let settledWhileOpen = 0;
      for (const frame of frames(raw)) {
        for (const p of frame) live.update(p);
        live.curves(frame[0].t);
        settledWhileOpen = live.settledCount();
      }
      const drawn = live.curves();

      const once = new Centerline([...raw], options).curves();

      assert.equal(drawn.length, once.length, "node count");
      const i = drawn.findIndex((n, i) => !isDeepStrictEqual(n, once[i]));
      assert.equal(i, -1, `node ${i} of ${once.length}, ${settledWhileOpen} settled while open`);
      if (once.length > 10) assert.ok(settledWhileOpen > 0, "nothing settled while drawing");
    });
  }
});

describe("the resumed outline is what a single pass draws", () => {
  for (const file of files) {
    test(file, () => {
      const { raw, options } = sample(file);

      const live = new Centerline([], options);
      const outline = new Outline(options);
      // every piece that was called settled while drawing, as it was then
      const settled: unknown[] = [];
      for (const frame of frames(raw)) {
        for (const p of frame) live.update(p);
        const pieces = outline.pieces(live.curves(frame[0].t), live.settledCount());
        for (let i = settled.length; i < outline.settledCount(); i++) {
          settled.push(structuredClone(pieces[i]));
        }
      }
      const nodes = live.curves();
      const drawn = outline.pieces(nodes, live.settledCount());

      const once = new Outline(options).pieces(new Centerline([...raw], options).curves());

      assert.equal(drawn.length, once.length, "piece count");
      const i = drawn.findIndex((p, i) => !isDeepStrictEqual(p, once[i]));
      assert.equal(i, -1, `piece ${i} of ${once.length}`);
      const j = settled.findIndex((p, i) => !isDeepStrictEqual(p, once[i]));
      assert.equal(j, -1, `piece ${j} changed after it was settled`);
      assert.equal(outline.settledCount(), once.length, "pieces left unsettled at the end");
      if (once.length > 3) assert.ok(settled.length > 0, "nothing settled while drawing");
    });
  }
});
