import { readFileSync } from "node:fs";
import type { Point3 } from "../src/math.ts";
import { stroke } from "./geometry.ts";

function trace(f: (u: number) => [number, number], ms: number): Point3[] {
  const out: Point3[] = [];
  for (let t = 0; t <= ms; t += 1000 / 120) {
    const [x, y] = f(t / ms);
    out.push({ x, y, t });
  }
  return out;
}

export const STROKES: Record<string, Point3[]> = {
  straight: trace((u) => [40 + u * 300, 100], 600),
  curve: trace((u) => [40 + u * 300, 120 + 60 * Math.sin(u * Math.PI * 2)], 900),
  corner: trace((u) => (u < 0.5 ? [40 + u * 400, 60] : [240, 60 + (u - 0.5) * 400]), 800),
  loop: trace(
    (u) => [150 + 70 * Math.cos(u * 2 * Math.PI), 120 + 70 * Math.sin(u * 2 * Math.PI)],
    1000,
  ),
  flick: trace((u) => [30 + u * 480, 100 + 80 * Math.sin(u * Math.PI)], 320),
  backtrack: stroke(
    "40.8,40,0;0.8,2.4,16;1.6,30.4,21;0,38.4,16;0,52,16;-3.2,50.4,17;0,31.2,16;" +
      "0,20,20;0,1.6,16;0,-0.8,31;0,-5.6,13;0,0,0",
  ),
  "backtrack, dwell": stroke(
    "42.6,40,0;0,1.3,8;0,11,20;0,21.1,16;0,43,16;-0.9,26.4,16;-0.9,12.7,16;-0.9,15.4,16;" +
      "0,4,16;0,1.8,16;0,-1.3,56;0,-1.8,16;0,-7.9,16;0.9,-12.7,16;0.4,-6.6,8;0,0,0",
  ),
  "backtrack, curved": stroke(
    "68.1,40,0;-0.9,11.9,16;-4,25,16;-6.6,39.1,16;-7,40.4,16;-5.3,37.3,16;-3.5,28.1,16;" +
      "-0.4,17.1,16;-0.4,1.8,16;0,-1.8,40;0.9,-9.2,16;3.5,-18.9,16;6.6,-33.4,16;3.5,-19.3,8;0,0,0",
  ),
  "slow start": stroke(
    "40,40,0;1.6,0,16;4.8,11.2,16;8,35.2,17;18.4,103.2,16;12.8,84,16;8.8,76,20;3.2,37.6,12;" +
      "2.4,32,16;0,16.8,16;0.8,-1.6,124;5.6,-11.2,12;11.2,-24.8,20;12.8,-23.2,8;0,0,0",
  ),
  "tight curve": stroke(
    "98,135.8,4023;0.9,-0.3,11;2.3,-0.5,16;1,-0.2,12;1.5,0,16;2.1,1.4,23;1.2,1.8,17;" +
      "0.6,2.7,11;0.5,4.6,17;0,5.4,16;0,6.2,16;0,5.8,21;0,0,0",
  ),
};

// A page of real handwriting, one stroke per line, as the app exported it.
// The fixtures above are all short and deliberate; this is what actual input
// looks like, and the only thing here long enough to say what a stroke costs.
export const RECORDED_STROKES: Point3[][] = readFileSync(
  new URL("./bench.scrawl", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((l) => l.trim())
  .map(stroke);
