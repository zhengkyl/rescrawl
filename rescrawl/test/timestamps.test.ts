import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { holdEndUntil, retimeBadTimesteps } from "../src/centerline/retime.ts";
import { type Sample, toSmoothSamples } from "../src/centerline/smooth.ts";
import { dist, type Point3 } from "../src/math.ts";

// No fold past exact repeats, so these read as the stamps alone.
const O = { framePeriod: 16, minMove: 0 };

// x along a line, 10px a sample, at the given stamps
const line = (ts: number[]): Point3[] => ts.map((t, i) => ({ x: i * 10, y: 0, t }));
const xt = (pts: Sample[]) => pts.map((p) => [p.x, +p.tStart.toFixed(1), +p.tEnd.toFixed(1)]);
const run = (pts: Point3[], o: { framePeriod: number; minMove: number } = O) => {
  const { samples, arcLengths } = toSmoothSamples(pts, { smoothWindow: 0, minMove: o.minMove });
  retimeBadTimesteps(samples, arcLengths, o);
  return samples;
};

describe("retime", () => {
  test("leaves clean input alone, leaving each sample as it arrives", () => {
    const pts = line([0, 16, 32, 48]);
    assert.deepEqual(
      run(pts),
      pts.map((p) => ({ x: p.x, y: p.y, tStart: p.t, tEnd: p.t, r: 1, corner: false })),
    );
  });

  test("spreads a frame's samples back over one period", () => {
    assert.deepEqual(xt(run(line([0, 16, 32, 32, 48]))), [
      [0, 0, 0],
      [10, 16, 16],
      [20, 24, 24],
      [30, 32, 32],
      [40, 48, 48],
    ]);
  });

  test("raises an early stamp to the one before it, sharing its frame", () => {
    assert.deepEqual(
      run(line([0, 16, 32, 24, 48])).map((p) => p.tStart),
      [0, 16, 24, 32, 48],
    );
  });

  // the cost of never moving old samples: a late stamp drags the ones after it
  test("a late stamp holds the ones after it, not the ones before", () => {
    assert.deepEqual(xt(run(line([0, 16, 32, 500, 48, 64]))), [
      [0, 0, 0],
      [10, 16, 16],
      [20, 32, 484],
      [30, 489.3, 489.3],
      [40, 494.7, 494.7],
      [50, 500, 500],
    ]);
  });

  test("a pause: the pen sat until one frame before the next sample", () => {
    assert.deepEqual(xt(run(line([0, 16, 32, 332, 348]))), [
      [0, 0, 0],
      [10, 16, 16],
      [20, 32, 316],
      [30, 332, 332],
      [40, 348, 348],
    ]);
  });

  test("a repeat in a frame is folded into the sample before it", () => {
    const pts = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 16 },
      { x: 10, y: 0, t: 16 },
      { x: 20, y: 0, t: 32 },
      { x: 20, y: 0, t: 32 },
    ];
    assert.deepEqual(xt(run(pts)), [
      [0, 0, 0],
      [10, 16, 16],
      [20, 32, 32],
    ]);
  });

  // the pointerup sample, and the live tip, are both this
  test("a later repeat at the end is the pen held there", () => {
    const pts = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 16 },
      { x: 10, y: 0, t: 400 },
    ];
    assert.deepEqual(xt(run(pts)), [
      [0, 0, 0],
      [10, 16, 400],
    ]);
  });

  test("holdEndUntil: the pen held at its last position, never before it got there", () => {
    const pts = line([0, 16, 32]);
    assert.deepEqual(xt(run(holdEndUntil(pts, 200))), [
      [0, 0, 0],
      [10, 16, 16],
      [20, 32, 200],
    ]);
    // a clock behind the last stamp would otherwise pull the samples back
    assert.deepEqual(run(holdEndUntil(pts, 20)), run(pts));
    assert.deepEqual(holdEndUntil([], 5), []);
  });

  test("a sample within minMove of the last kept is folded in: first kept", () => {
    const pts = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 16 },
      { x: 5, y: 0, t: 32 },
      { x: 5.5, y: 0, t: 48 },
      { x: 10, y: 0, t: 64 },
    ];
    assert.deepEqual(xt(run(pts, { ...O, minMove: 1.5 })), [
      [0, 0, 16],
      [5, 32, 48],
      [10, 64, 64],
    ]);
  });

  // Every recorded stroke: no two kept samples in a row within minMove, time
  // never runs backwards, and each sample is left before the next arrives.
  // Nothing moves by more than two periods: one of spreading, and at most one
  // of a stamp that ran backwards (stylus cursive's pointerdown, 0 -> -30).
  test("recorded samples", () => {
    const dir = new URL("./samples/", import.meta.url);
    const o = { framePeriod: 1000 / 60, minMove: 1.5 };
    for (const file of readdirSync(dir)) {
      const raw: Point3[] = JSON.parse(readFileSync(new URL(file, dir), "utf8")).raw;
      const out = run(raw, o);
      for (let i = 0; i < out.length; i++) {
        assert.ok(out[i].tEnd >= out[i].tStart, `${file}: left before arriving at ${i}`);
        if (i === 0) continue;
        assert.ok(dist(out[i], out[i - 1]) > o.minMove, `${file}: within minMove at ${i}`);
        assert.ok(out[i].tStart > out[i - 1].tEnd, `${file}: no time to move into ${i}`);
      }
      // Kept samples are recorded ones, in order; every recorded sample is
      // kept or within minMove of the last kept before it.
      let j = -1;
      for (let i = 0; i < raw.length; i++) {
        const p = raw[i];
        if (j + 1 < out.length && out[j + 1].x === p.x && out[j + 1].y === p.y) {
          j++;
          assert.ok(
            Math.abs(out[j].tStart - p.t) <= 2000 / 60,
            `${file}: moved ${out[j].tStart - p.t}`,
          );
        } else {
          assert.ok(j >= 0 && dist(out[j], p) <= o.minMove, `${file}: ${i} lost`);
        }
      }
      assert.equal(j, out.length - 1, `${file}: extra samples`);
    }
  });
});
