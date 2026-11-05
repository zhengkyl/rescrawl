import { lerp, type Point3 } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type RetimeOptions = {
  framePeriod?: number; // ms between input frames
};

export function retime(points: Sample[], s: Float64Array, o: Required<RetimeOptions>): Sample[] {
  const out = points.map((p) => ({ ...p }));

  let start = 0;
  while (start < out.length) {
    const frameEnd = out[start].tStart;
    let end = start;
    while (end + 1 < out.length && out[end + 1].tStart === frameEnd) end++;

    let frameStart = frameEnd - o.framePeriod;
    if (start > 0) {
      const prev = out[start - 1];
      // a folded sample stamped on this frame isn't a hold
      const left = prev.tEnd < frameEnd ? prev.tEnd : prev.tStart;
      frameStart = Math.max(left, frameStart);
      prev.tEnd = frameStart;
    }

    // arc length from the sample before the frame, or the frame's own first
    const from = s[Math.max(start - 1, 0)];
    const total = s[end] - from;
    for (let j = start; j <= end; j++) {
      const along = s[j] - from;
      const held = out[j].tEnd;
      const time = along === total ? frameEnd : lerp(frameStart, frameEnd, along / total);
      out[j].tStart = time;
      out[j].tEnd = j === end ? Math.max(time, held) : time;
    }
    start = end + 1;
  }
  return out;
}

// hold last point until t
export function holdEndUntil<P extends Point3>(points: P[], t: number): P[] {
  if (points.length === 0) return points;
  const last = points[points.length - 1];
  return [...points, { ...last, t: Math.max(t, last.t) }];
}
