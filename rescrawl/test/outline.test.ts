import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ENGINES } from "../src/engine.ts";
import { renderStroke } from "../src/pipeline.ts";
import type { OutlineEngine, Point3, RenderOptions } from "../src/types.ts";
import { RENDER_DEFAULTS } from "../src/types.ts";
import { discCoverage, stroke } from "./geometry.ts";

const ALL = Object.keys(ENGINES) as OutlineEngine[];
const shape = (pts: Point3[], o: RenderOptions = {}) => {
  const r = renderStroke(pts, o);
  return { nodes: r.stages.nodes, outline: r.outline };
};

// Sampled at 120Hz, the rate a pointer actually reports at.
function trace(f: (u: number) => [number, number], ms: number): Point3[] {
  const out: Point3[] = [];
  for (let t = 0; t <= ms; t += 1000 / 120) {
    const [x, y] = f(t / ms);
    out.push({ x, y, t });
  }
  return out;
}

const STROKES: Record<string, Point3[]> = {
  straight: trace((u) => [40 + u * 300, 100], 600),
  curve: trace((u) => [40 + u * 300, 120 + 60 * Math.sin(u * Math.PI * 2)], 900),
  corner: trace((u) => (u < 0.5 ? [40 + u * 400, 60] : [240, 60 + (u - 0.5) * 400]), 800),
  loop: trace(
    (u) => [150 + 70 * Math.cos(u * 2 * Math.PI), 120 + 70 * Math.sin(u * 2 * Math.PI)],
    1000,
  ),
  flick: trace((u) => [30 + u * 480, 100 + 80 * Math.sin(u * Math.PI)], 320),
  // Down the page, then back up over itself by about one window's worth. The
  // reversal reads a flat 180 degrees across three samples, and the corner has
  // to land on the tip rather than the sample before it -- otherwise the tip's
  // tangent only sees the way back and the outline cuts straight across it.
  backtrack: stroke(
    "40.8,40,0;0.8,2.4,16;1.6,30.4,21;0,38.4,16;0,52,16;-3.2,50.4,17;0,31.2,16;" +
      "0,20,20;0,1.6,16;0,-0.8,31;0,-5.6,13;0,0,0",
  ),
  // The same reversal but with a pause at the tip and a longer return, so the
  // near-180 readings around the tip are a hair apart instead of identical.
  // Ranking the tip only on an exact tie missed this one.
  "backtrack, dwell": stroke(
    "42.6,40,0;0,1.3,8;0,11,20;0,21.1,16;0,43,16;-0.9,26.4,16;-0.9,12.7,16;-0.9,15.4,16;" +
      "0,4,16;0,1.8,16;0,-1.3,56;0,-1.8,16;0,-7.9,16;0.9,-12.7,16;0.4,-6.6,8;0,0,0",
  ),
  // A curved approach into the reversal rather than a straight one, so no two
  // samples share a heading.
  "backtrack, curved": stroke(
    "68.1,40,0;-0.9,11.9,16;-4,25,16;-6.6,39.1,16;-7,40.4,16;-5.3,37.3,16;-3.5,28.1,16;" +
      "-0.4,17.1,16;-0.4,1.8,16;0,-1.8,40;0.9,-9.2,16;3.5,-18.9,16;6.6,-33.4,16;3.5,-19.3,8;0,0,0",
  ),
  // Starts almost stopped, then accelerates hard. The first step is 1.6px, so
  // the backward arm at sample 1 is a stub and the turn there reads 67 degrees
  // where a full window one sample later reads 10 -- a corner inside the start
  // cap, and a kink in it.
  "slow start": stroke(
    "40,40,0;1.6,0,16;4.8,11.2,16;8,35.2,17;18.4,103.2,16;12.8,84,16;8.8,76,20;3.2,37.6,12;" +
      "2.4,32,16;0,16.8,16;0.8,-1.6,124;5.6,-11.2,12;11.2,-24.8,20;12.8,-23.2,8;0,0,0",
  ),
  // A tight but smooth curve. Over a 6px window it turns 61 degrees and is
  // built as a corner; over 3px it turns 43, over 1.5px it turns 34. The turn
  // scales with the window, which is what a curve does and a corner does not.
  "tight curve": stroke(
    "98,135.8,4023;0.9,-0.3,11;2.3,-0.5,16;1,-0.2,12;1.5,0,16;2.1,1.4,23;1.2,1.8,17;" +
      "0.6,2.7,11;0.5,4.6,17;0,5.4,16;0,6.2,16;0,5.8,21;0,0,0",
  ),
};

describe("the outline wraps the ink", () => {
  // The one invariant everything else is a special case of: the shape the
  // renderer draws has to contain every disc the pen laid down.
  for (const engine of ALL) {
    for (const [name, pts] of Object.entries(STROKES)) {
      // Two open defects, recorded rather than hidden. Greedy loses a sliver of
      // the disc at the start of any stroke -- sub-pixel, and nothing to do
      // with the stroke's shape. And a tight curve is still built as a corner,
      // whose fold eats into the ink; see that fixture's note.
      const open =
        engine === "greedy"
          ? "greedy's opening cap is short"
          : name === "tight curve"
            ? "a tight curve is still built as a corner"
            : undefined;
      test(`${engine} / ${name}`, { todo: open }, () => {
        const { worst, node } = discCoverage(shape(pts, { engine }));
        assert.equal(worst, 1, `node ${node} is only ${(worst * 100).toFixed(0)}% covered`);
      });
    }
  }

  // The inner corner point sits at r·sec(g/2), which runs away as a bend
  // approaches a straight reversal: at 178 degrees it is 57·r, far enough to
  // throw the contact across the stroke.
  for (const engine of ["fit", "sampled"] as const) {
    test(`${engine} / sharp reversal with cornerPoint on`, () => {
      for (const turn of [150, 168, 174, 178, 180]) {
        const th = (turn * Math.PI) / 180;
        const pts: Point3[] = [];
        let t = 0;
        for (let i = 0; i <= 26; i++) pts.push({ x: 60 + 5 * i, y: 120, t: (t += 8) });
        for (let i = 1; i <= 26; i++)
          pts.push({
            x: 190 - 5 * i * Math.cos(Math.PI - th),
            y: 120 + 5 * i * Math.sin(Math.PI - th),
            t: (t += 8),
          });
        const { worst } = discCoverage(shape(pts, { engine, cornerPoint: true }));
        assert.equal(worst, 1, `${turn}° reversal: coverage fell to ${worst.toFixed(2)}`);
      }
    });
  }
});

describe("the fit is scale free", () => {
  // Every length in stage 4 is a multiple of `maxWidth`, so a drawing scaled up
  // with a pen scaled to match must produce the same shape, scaled. Only the
  // pen and the input speed are named in pixels.
  for (const engine of ALL) {
    test(engine, () => {
      const pts = STROKES.curve;
      const k = 2;
      const one = shape(pts, { engine, minWidth: 1.5, maxWidth: 8, thinSpeed: 1 });
      const two = shape(
        pts.map((p) => ({ x: p.x * k, y: p.y * k, t: p.t })),
        { engine, minWidth: 1.5 * k, maxWidth: 8 * k, thinSpeed: 1 * k },
      );
      assert.equal(two.outline.length, one.outline.length, "contact count changed with scale");
      for (let i = 0; i < one.outline.length; i++) {
        assert.ok(
          Math.hypot(
            one.outline[i].x * k - two.outline[i].x,
            one.outline[i].y * k - two.outline[i].y,
          ) < 1e-9,
          `contact ${i} is not where scaling says it should be`,
        );
      }
    });
  }
});

describe("greedy keeps its hops short", () => {
  // A hop reaching into the unsettled ink at the pen re-decides every frame and
  // re-anchors every hop behind it, so an uncapped hop drags the churn a long
  // way back. Uncapped, one hop on this stroke spanned 254px.
  for (const outlineHorizon of [1.5, 3, 6]) {
    test(`outlineHorizon ${outlineHorizon}`, () => {
      const cs = shape(STROKES.flick, { engine: "greedy", outlineHorizon }).outline;
      const cap = outlineHorizon * RENDER_DEFAULTS.maxWidth;
      for (let i = 1; i < cs.length; i++) {
        const d = Math.hypot(cs[i].x - cs[i - 1].x, cs[i].y - cs[i - 1].y);
        assert.ok(d <= cap + 1e-6, `hop ${i} spans ${d.toFixed(1)}px, cap is ${cap}px`);
      }
    });
  }
});
