# Rescrawl

Create animated handwriting SVGs

Try it: https://rescrawl.kylezhe.ng

Originally made for this blog post https://kylezhe.ng/writes/shakespeares-sonnets

## Overview

Two outputs, and the whole library is arranged around the difference between them.

**`.scrawl` — the points.** A newline-separated list of strokes, each a `;`-separated run of `x,y,t` deltas. Re-importable, and the only output that round trips.

**Animated SVG — a drawing that draws itself.** A browser plays it; nothing reads it back. Being one-way is what lets it trade fidelity for bytes.

### The pipeline

`rescrawl` converts a list of (x, y, t) points into a brush-like stroke. The stroke width varies with speed and time to imitate flowing ink. For a different approach using only (x, y) points try the legendary [perfect-freehand](https://github.com/steveruizok/perfect-freehand).

```
in   raw         pointer samples: position + timestamp
 0   snapped     quantized onto the grid a .scrawl is written to
 1   radius      + a radius per point, from pen speed
 2   smoothed    positions through a moving average
 3a  distinct    circles swallowed by a neighbour dropped
 3b  simplified  circles already covered by the tube dropped
 3c  spline      resampled along a centripetal Catmull-Rom
 4   outline     the closed loop that actually gets filled
```

Stage 0 is first on purpose: it is the only stage whose output leaves the process. Everything from stage 1 down reads the snapped points and never the raw ones, so a stroke rendered as it is drawn and the same stroke rendered after a save-and-reload go through identical arrays.

### What may run under the pen

The pipeline renders **while the pen is down**, on a growing prefix, over and over. So everything in it has to be causal: a point's output is decided by that point and the ones before it, and nothing a later sample does may revise it. Snapping qualifies — a coordinate's grid cell depends on that coordinate alone. Append a thousand more samples and everything already on screen sits exactly where it was.

Decimation does not, so it is **not a pipeline stage**. It is a finalize pass (`compressStroke`) run once per complete stroke, on the way to a file.

Douglas–Peucker is the specific offender, and a smaller tolerance does not fix it, because the tolerance is not what is wrong. DP never _moves_ a point — it only selects — so the failure is subtler than drift: the **selection** changes as the stroke grows, and points the ink was already drawn through get dropped once a later sample makes them redundant. On a 300-sample test stroke, the first 240 samples decimate to a set holding 4 points the finished stroke does not keep. Each of those is a place where the curve re-settles behind the pen, and the radii shift with it, since stage 1 reads speed between neighbours that are no longer the same neighbours. The same thing breaks replay: a time-clipped prefix would decimate differently than the same prefix of the finished stroke, so a stroke would draw as one shape and end as another.

If a streaming decimator is wanted in the pipeline, it has to come from the local sequential family — Reumann–Witkam's directional corridor, or Opheim with its distance bounds — not a global fit.

Keeping it out of the renderer costs nothing, because the app applies it where complete strokes are held: the store keeps the captured points so the knob can always be turned back down, and derives the document from them. What gets drawn, measured and written to a file is that same derived array, so the canvas and the export cannot disagree.

### Why the finalize pass is idempotent

It snaps onto a decimal grid _before_ it decimates. A snap is idempotent alone, and so is DP — its recursion depends only on the deviation of the points it keeps from the chord between two kept endpoints, and dropping the others changes neither — but decimating _before_ snapping is not, because the snap then nudges survivors across the tolerance and the next pass drops a different set. Re-exporting an imported file changes nothing, however many times it happens. (The greedy anchor walk this replaced was not idempotent at all: its runs extend further once the points that broke them are gone, so every save lost a little more.)

Deviation is measured against the chord parameterized by **time**, not arc length. Everything downstream derives from speed, so a dropped sample must not change how fast the pen appears to have moved. A dwell falls out of it for free and losslessly — the pen is not moving, so the whole pause collapses to its two ends, and stage 1 cannot tell the difference because it smooths in log space toward a constant target.

### Animating it

`rescrawl/animate` emits the self-playing SVG. Per stroke: the outline becomes a `<clipPath>`, the centerline is drawn inside it stroked wide enough to cover, and that fat covering stroke is revealed by a `stroke-dashoffset` animation. SVG has no variable-width stroke, so the width comes from the clip and the motion from the dash.

> I once did this manually for over 100 Japanese characters to create stroke order diagrams (https://github.com/zhengkyl/strokesvg). At 5-10 a day, it took less than 2 weeks, which is much faster than it took to write and refine rescrawl.

Three things keep it to one file rather than one per stroke:

- **`pathLength="1"`** on every centerline, so dash distances are fractions of each stroke's own length and one shared `@keyframes` drives the whole drawing.
- **One shared `animation-duration`**, equal to the whole cycle including the hold. Per-stroke durations plus delays desync on a loop, because each stroke then repeats on its own period.
- **A per-stroke `linear()` easing** carrying everything else: when the stroke starts (a flat run at 0), how the pen actually moved — accelerations, and dwells as flat runs mid-curve — and that it stays finished until the loop comes round (a flat run at 1). Timing fidelity that would otherwise need per-stroke keyframes, for a handful of numbers.

Path data is emitted relative, with implied command letters, trimmed numbers and dropped separators. Relative deltas are measured from the position _as the parser will compute it_ — the running sum of the rounded deltas — so rounding error stays inside half a grid step instead of drifting with path length.

Decimals kept in path data is by far the largest size lever; the timing tolerance is about fidelity and barely moves the file. On curvy strokes `splineOutline` is both more accurate and smaller, since `toOutline` pays about four contacts per centerline point while the spline sampler adapts.

Two known infidelities, both inherent to reveal-by-dash:

- **The head leads.** The covering stroke is as wide as the stroke's widest point with a round cap, so where the ink is thinner the revealed edge runs ahead of the pen by up to `maxRadius - r`. A butt cap sits exactly on the pen but never reveals the end nib and shows a chisel edge mid-stroke.
- **Loops spill.** The clip is the whole stroke's outline, so where the spine passes near an earlier part of the same stroke, ink there fills in early. Cutting each stroke into several clip regions at its self-intersections is the fix, and is not done yet — so tight loops and scribbles run ahead of the pen.

### notes

The problem
Given a list of samples with x, y, t, output a centerline, a "smooth" list of points going "through" the points, and output an brush outline, a polygon made of "smooth" points "offset" from the centerline by a derived "pressure radius".

The reference ouput is a pen on paper, or a high polling rate pen in a drawing app. But we want SVG, and we get browser pointer events. We can use pointerdown and pointerup as is, but pointermove fires on changes at most at browser frame rate (not including getCoalescedEvents).

idea 1: an pointermove event implies a movement taking framegap=1/framerate time units. The remaining time gap was spent stationary before move. (Should movement time be framegap or framegap/2? move -1/2 and stop + 1/2 is closer mathematically, but practically?).

perfect freehand only keeps start and end points unmodified. All middle points are a fixed lerp between current raw sample and previous stored point. There is always a gap between pen and point, but it's "bounded" and scales with distance between samples. Given a lerp constant of t, 0 < t < 1, and n + 1 equally spaced samples, the lag gap is exactly t + t ^2 + t^3 + ... t^n which has limit of 1/(1-t). The gap decreases as samples become closer and increases as samples become farther apart, so most noticeable for large t and accelerating movement. For straight lines is fine, but it unavoidably reduces length of curves. Arc length is reduced by very roughly one lag gap per sample in curve in worst case (fast tight curves).

curve fitting is a bad fit for realtime streaming. We need all historical points to be fixed once rendered, so only a small buffer of samples can be fitted and a buffer delays rendering by a number of samples, not time.

as for filtering...

I don't udnerstand one euro and after AI adjustments to make it fit better, I don't understand it at all well enough to use. It's a low filter pass to smooth out noise, but again latency based on samples.

Adding small deadzone before adding new points. perfect-freehand does this. Essentially "quantizing" input to deadzone size. Reumann–Witkam is directional pipe-shaped "deadzone" and Opheim is variant with min/max dist constraint.

What if use window symmetric in time, not samples
average with partial samples?
