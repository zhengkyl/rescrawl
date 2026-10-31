import { dist, lerp, type Point3 } from "./math.ts";

export type RetimeOptions = {
  framePeriod?: number; // ms between input frames
  pauseFrames?: number; // a gap over this many frames is the pen sitting still
};

// Recorded timestamps, made into times the pen was actually there. Trusts the
// order of the samples, not their stamps, on one assumption: a stamp can be
// late, never early. Every fault in the recordings is a late stamp --
//
//   - a frame's events all on the frame's time, up to ~24px apart on one ms
//   - a pointerdown stamped after the moves that followed it
//   - the sample after a pause, stamped when the frame it moved in ended
//
// So a sample is no later than any sample after it, and each time is capped at
// the earliest stamp from it to the end. Samples left sharing a time are one
// frame: the last keeps the time, the ones before it are spread back by arc
// length over at most one `framePeriod`. Any more of the gap before the frame
// is the pen sitting still, and past `pauseFrames` frames it gets a sample of
// its own: the position before the gap, stamped where the frame began.
//
// Live, that sample is the tip -- the last position at the current time --
// frozen when the pen moves again, so it moves no ink already shown. The rest
// rewrites only the newest frame, except where a stamp runs backwards. That
// holds only with `framePeriod` fixed: estimated from the stroke so far, it
// would retime history with every sample.
//
// A stamp that comes early breaks the assumption: it pulls every sample before
// it back. None of the recordings has one.
export function retime(points: Point3[], o: Required<RetimeOptions>): Point3[] {
  const n = points.length;
  const t = points.map((p) => p.t);
  for (let i = n - 2; i >= 0; i--) t[i] = Math.min(t[i], t[i + 1]);

  const out: Point3[] = [];
  let i = 0;
  while (i < n) {
    // the frame: every sample left on t[i]
    let end = i;
    while (end + 1 < n && t[end + 1] === t[i]) end++;
    const frameEnd = t[end];
    const earliest = frameEnd - o.framePeriod;
    const frameStart = i > 0 ? Math.max(t[i - 1], earliest) : earliest;

    if (i > 0 && frameEnd - t[i - 1] > o.pauseFrames * o.framePeriod) {
      const a = points[i - 1];
      if (a.x !== points[i].x || a.y !== points[i].y) out.push({ x: a.x, y: a.y, t: frameStart });
    }

    // arc length to each sample of the frame, from the sample before it -- or
    // from the frame's own first sample, at the start of the stroke
    const s: number[] = [];
    let along = 0;
    for (let j = i; j <= end; j++) {
      if (j > 0) along += dist(points[j - 1], points[j]);
      s.push(along);
    }
    const base = i > 0 ? 0 : s[0];
    const total = s[s.length - 1] - base;
    for (let j = i; j <= end; j++) {
      const f = total > 0 ? (s[j - i] - base) / total : 1;
      out.push({ ...points[j], t: j === end ? frameEnd : lerp(frameStart, frameEnd, f) });
    }
    i = end + 1;
  }
  return out;
}
