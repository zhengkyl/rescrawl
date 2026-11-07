import { lerp, type Point3 } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type RetimeOptions = {
  framePeriod?: number; // ms between input frames
};

export function fixBadTimesteps(
  samples: Sample[],
  arcLength: Float64Array,
  o: Required<RetimeOptions>,
) {
  let start = 0;
  while (start < samples.length) {
    const frameEnd = samples[start].tStart;
    let end = start;
    while (end + 1 < samples.length && samples[end + 1].tStart === frameEnd) end++;

    let frameStart = frameEnd - o.framePeriod;
    if (start > 0) {
      const prev = samples[start - 1];
      // a folded sample stamped on this frame isn't a hold
      const left = prev.tEnd < frameEnd ? prev.tEnd : prev.tStart;
      frameStart = Math.max(left, frameStart);
      prev.tEnd = frameStart;
    }

    // arc length from the sample before the frame, or the frame's own first
    const from = arcLength[Math.max(start - 1, 0)];
    const total = arcLength[end] - from;
    for (let j = start; j <= end; j++) {
      const along = arcLength[j] - from;
      const held = samples[j].tEnd;
      const time = along === total ? frameEnd : lerp(frameStart, frameEnd, along / total);
      samples[j].tStart = time;
      samples[j].tEnd = j === end ? Math.max(time, held) : time;
    }
    start = end + 1;
  }
}

// hold last point until t
export function holdEndUntil<P extends Point3>(points: P[], t: number): P[] {
  if (points.length === 0) return points;
  const last = points[points.length - 1];
  return [...points, { ...last, t: Math.max(t, last.t) }];
}
