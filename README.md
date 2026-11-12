# rescrawl

Draw beautiful lines and save as an animated SVG

Create animated handwriting SVGs

Try it: https://rescrawl.kylezhe.ng

Originally made for this blog post https://kylezhe.ng/writes/shakespeares-sonnets

### The pipeline

A Primer on Bézier Curves

- https://pomax.github.io/bezierinfo/index.html

https://raphlinus.github.io/curves/2022/09/09/parallel-beziers.html

https://github.com/paperjs/paper.js/issues/371

`rescrawl` converts a list of (x, y, t) points into a brush-like stroke. The stroke width varies with speed and time to imitate flowing ink. For a different approach using only (x, y) points try the legendary [perfect-freehand](https://github.com/steveruizok/perfect-freehand).

### Animating it

> I once did this manually for over 100 Japanese characters to create stroke order diagrams (https://github.com/zhengkyl/strokesvg). At 5-10 a day, it took less than 2 weeks, which is much faster than it took to write and refine rescrawl.

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
