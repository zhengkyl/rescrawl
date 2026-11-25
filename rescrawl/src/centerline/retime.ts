import { lerp } from "../math.ts";
import type { Sample } from "./smooth.ts";

export type RetimeOptions = {
  framePeriod?: number; // ms between input frames
  lookahead?: number;
};

// Firefox on Windows uses coarse system clock 64Hz(15.6ms)
// "sometimes" we get multiple samples from one clock frame
// Chrome uses sub-millisecond clock, so not an issue there
export function retimeDuplicateTimestamps(samples: Sample[], o: Required<RetimeOptions>) {
  let start = 0;
  while (start < samples.length) {
    const tEnd = samples[start].t;
    let end = start;
    while (end + 1 < samples.length && samples[end + 1].t === tEnd) end++;

    // best guess timestamp for leaving prev
    let prevTOut = tEnd - o.framePeriod;
    if (start > 0) {
      const prev = samples[start - 1];
      // if prev folded sample shares this timestamp, discard tOut
      const left = prev.tOut === tEnd ? prev.t : prev.tOut;
      prevTOut = Math.max(left, prevTOut);
      prev.tOut = prevTOut;
    }

    let from = samples[Math.max(start - 1, 0)].s;
    const last = samples[end].s;
    let t = prevTOut;
    for (let j = start; j <= end; j++) {
      const s = samples[j].s;
      const step = s - from;
      if (j === end) {
        t = tEnd;
      } else if (last - s <= o.lookahead) {
        t = lerp(t, tEnd, step / (last - from));
      } else {
        t = lerp(t, tEnd, 1 - Math.exp(-step / o.lookahead));
      }
      samples[j].t = t;
      samples[j].tOut = j === end ? Math.max(t, samples[j].tOut) : t;
      from = s;
    }
    start = end + 1;
  }
}
