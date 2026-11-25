import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { Centerline } from "../src/centerline/Centerline.ts";
import { markCorners } from "../src/centerline/corner.ts";
import { setSpeedPressure } from "../src/brush/pressure.ts";
import { retimeDuplicateTimestamps } from "../src/centerline/retime.ts";
import { type Sample, toSmoothSamples } from "../src/centerline/smooth.ts";
import { Ink } from "../src/Ink.ts";
import { LineBrush } from "../src/brush/LineBrush.ts";
import type { Point3 } from "../src/math.ts";
import { OutlineBrush } from "../src/brush/OutlineBrush.ts";

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

// pressure at i reads samples[i + 1].t, so the last stable sample's isn't final
function same(a: Sample, b: Sample, withPressure: boolean) {
  return withPressure ? isDeepStrictEqual(a, b) : isDeepStrictEqual({ ...a, p: b.p }, b);
}

describe("stable samples don't change as the stroke goes on", () => {
  for (const file of files) {
    test(file, () => {
      const { raw, options } = sample(file);
      const o = new Centerline([], options)["options"];

      const run = (points: Point3[]) => {
        const { samples, fixedIndex: fixed } = toSmoothSamples(points, o);
        // nothing reads more than lookahead past a sample
        let stableIndex = fixed;
        while (stableIndex >= 0 && samples[fixed].s - samples[stableIndex].s <= o.lookahead) {
          stableIndex--;
        }
        retimeDuplicateTimestamps(samples, o);
        markCorners(samples, o);
        setSpeedPressure(samples, options);
        return { samples, stableIndex };
      };

      const full = run(raw);
      let fed = 0;
      for (const frame of frames(raw)) {
        fed += frame.length;
        const { samples, stableIndex } = run(raw.slice(0, fed));
        const i = samples.findIndex(
          (s, i) => i <= stableIndex && !same(s, full.samples[i], i < stableIndex),
        );
        assert.equal(i, -1, `sample ${i} of 0..${stableIndex} stable changed after ${fed} points`);
      }

      // no timestamps: one frame that never ends still settles
      const flat = raw.map((p) => ({ ...p, t: 0 }));
      const whole = run(flat);
      let settled = -1;
      for (let fed = 1; fed <= flat.length; fed += 3) {
        const { samples, stableIndex } = run(flat.slice(0, fed));
        const i = samples.findIndex(
          (s, i) => i <= stableIndex && !same(s, whole.samples[i], i < stableIndex),
        );
        assert.equal(
          i,
          -1,
          `untimed sample ${i} of 0..${stableIndex} stable changed after ${fed} points`,
        );
        settled = stableIndex;
      }
      if (whole.samples.length > 10) assert.ok(settled >= 0, "untimed: nothing settled");
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
        settledWhileOpen = live.fit(frame[0].t).settled;
      }
      const { nodes: drawn, samples } = live.end();

      const whole = new Centerline([...raw], options);
      const { nodes: once, samples: onceSamples } = whole.end();

      assert.equal(drawn.length, once.length, "node count");
      const i = drawn.findIndex((n, i) => !isDeepStrictEqual(n, once[i]));
      assert.equal(i, -1, `node ${i} of ${once.length}, ${settledWhileOpen} settled while open`);
      assert.deepEqual(samples, onceSamples, "samples");
      if (once.length > 10) assert.ok(settledWhileOpen > 0, "nothing settled while drawing");
    });
  }
});

describe("the resumed outline is what a single pass draws", () => {
  for (const file of files) {
    test(file, () => {
      const { raw, options } = sample(file);

      const live = new Centerline([], options);
      const pen = new OutlineBrush(options);
      const fit = (line: Centerline, tOpen?: number) => {
        const out = tOpen === undefined ? line.end() : line.fit(tOpen);
        setSpeedPressure(out.samples, options);
        return out;
      };
      const settled: unknown[] = [];
      const fs = frames(raw);
      fs.forEach((frame, f) => {
        for (const p of frame) live.update(p);
        // at the frame, then held until just before the next, as an app's clock sees it
        const times = f + 1 < fs.length ? [frame[0].t, fs[f + 1][0].t - 0.5] : [frame[0].t];
        for (const t of times) {
          const { pieces, settled: n } = pen.pieces(fit(live, t));
          for (let i = settled.length; i < n; i++) settled.push(structuredClone(pieces[i]));
        }
      });
      const { pieces: drawn, settled: settledAtEnd } = pen.pieces(fit(live));

      const whole = new Centerline([...raw], options);
      const once = new OutlineBrush(options).pieces(fit(whole)).pieces;

      assert.equal(drawn.length, once.length, "piece count");
      const i = drawn.findIndex((p, i) => !isDeepStrictEqual(p, once[i]));
      assert.equal(i, -1, `piece ${i} of ${once.length}`);
      const j = settled.findIndex((p, i) => !isDeepStrictEqual(p, once[i]));
      assert.equal(j, -1, `piece ${j} changed after it was settled`);
      assert.equal(settledAtEnd, once.length, "pieces left unsettled at the end");
      if (once.length > 3) assert.ok(settled.length > 0, "nothing settled while drawing");
    });
  }
});

describe("ink fed a frame at a time draws what a single pass does", () => {
  const brushes = {
    "outline brush": () => new OutlineBrush(),
    "line brush": () => new LineBrush(),
  };
  for (const [name, brush] of Object.entries(brushes)) {
    for (const file of files) {
      test(`${name}: ${file}`, () => {
        const { raw, options } = sample(file);

        const live = new Ink(brush(), options);
        const settled: string[] = [];
        const fs = frames(raw);
        fs.forEach((frame, f) => {
          for (const p of frame) live.update(p);
          const times = f + 1 < fs.length ? [frame[0].t, fs[f + 1][0].t - 0.5] : [frame[0].t];
          for (const t of times) {
            const { paths, settled: n } = live.draw(t);
            for (let i = 0; i < settled.length; i++) {
              assert.equal(paths[i], settled[i], `path ${i} changed after it was settled`);
            }
            for (let i = settled.length; i < n; i++) settled.push(paths[i]);
          }
        });
        const drawn = live.end();

        const whole = new Ink(brush(), options);
        for (const p of raw) whole.update(p);
        const once = whole.end();

        assert.equal(drawn.settled, drawn.paths.length, "paths left unsettled at the end");
        // line brush stretches depend on when they settled
        if (name === "outline brush") assert.deepEqual(drawn.paths, once.paths);
        else assert.deepEqual(live.fit.nodes, whole.fit.nodes);
        if (once.paths.length > 3) assert.ok(settled.length > 0, "nothing settled while drawing");
      });
    }
  }
});
