import { renderStroke } from "../src/pipeline.ts";
import type { Point3 } from "../src/types.ts";
import { discCoverage } from "./geometry.ts";
import { RECORDED_STROKES, STROKES } from "./strokes.ts";

// Numbers to watch, not assertions. Coverage is the fraction of the worst
// node's rim the outline actually contains -- 1 would mean every disc is
// wrapped, and nothing reaches that yet, so the point is the trend.

const REPEATS = 30;

function ms(run: () => void): number {
  run();
  const times: number[] = [];
  for (let i = 0; i < REPEATS; i++) {
    const t = performance.now();
    run();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1];
}

// Drawing re-renders the whole prefix every frame, so the live cost is what a
// stroke actually costs, not one render of the finished thing.
function frames(pts: Point3[]): Point3[][] {
  const step = Math.max(1, Math.floor(pts.length / 60));
  const out: Point3[][] = [];
  for (let n = 2; n <= pts.length; n += step) out.push(pts.slice(0, n));
  return out;
}

function measure(name: string, group: Point3[][]) {
  let nodes = 0;
  let contacts = 0;
  let worst = 1;
  let at = "-";
  group.forEach((pts, s) => {
    const r = renderStroke(pts);
    nodes += r.stages.nodes.length;
    contacts += r.outline.length;
    const c = discCoverage({ nodes: r.stages.nodes, outline: r.outline });
    if (c.worst < worst) {
      worst = c.worst;
      at = group.length > 1 ? `${s}:${c.node}` : `#${c.node}`;
    }
  });
  const fs = group.flatMap(frames);
  const live = ms(() => {
    for (const f of fs) renderStroke(f);
  });
  return {
    name,
    samples: group.reduce((a, p) => a + p.length, 0),
    nodes,
    contacts,
    worst,
    at,
    full: ms(() => {
      for (const pts of group) renderStroke(pts);
    }),
    frame: live / fs.length,
  };
}

const rows = [
  ...Object.entries(STROKES).map(([name, pts]) => measure(name, [pts])),
  measure(`bench.scrawl (${RECORDED_STROKES.length})`, RECORDED_STROKES),
];

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(
  `${"stroke".padEnd(19)}${pad("samples", 8)}${pad("nodes", 7)}${pad("contacts", 9)}` +
    `${pad("cover", 7)}${pad("worst", 8)}${pad("full", 9)}${pad("per frame", 11)}`,
);
for (const r of rows) {
  console.log(
    r.name.padEnd(19) +
      pad(r.samples, 8) +
      pad(r.nodes, 7) +
      pad(r.contacts, 9) +
      pad(r.worst.toFixed(2), 7) +
      pad(r.at, 8) +
      pad(`${r.full.toFixed(2)}ms`, 9) +
      pad(`${r.frame.toFixed(3)}ms`, 11),
  );
}
const mean = rows.reduce((a, r) => a + r.worst, 0) / rows.length;
const low = rows.reduce((a, r) => Math.min(a, r.worst), 1);
const slowest = rows.reduce((a, r) => Math.max(a, r.frame), 0);
console.log(
  `\ncoverage: ${mean.toFixed(3)} mean, ${low.toFixed(2)} worst   ` +
    `frame: ${slowest.toFixed(3)}ms slowest (16.7ms is one frame at 60fps)`,
);
