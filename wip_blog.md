Turning pen or mouse movement into a beautifully rendered stroke requires two major steps. First, the input points must be turned into a smooth path. Then, the desired shape must be drawn along that path, whether it's a simple line or a brushstroke that ebbs and flows. There are many ways to accomplish this, but I had a specific vision to optimize for. I wanted to store recordings of handwriting and drawings while taking as little storage space as possible. The choices and compromises I made resulted in [`rescrawl`](https://github.com/zhengkyl/rescrawl), my library for replayable drawings on the web.

For efficient storage and replay, converting the input points into a vector path

When drawing digitally, the pen or mouse position is reported at a regular frequency, perhaps a few hundred times per second. Connecting all these points with straight lines is simple, but the result will not be smooth. In fast sections the points are too sparse for straight lines to approximate curves, and in slow sections the dense points contain unintentional jitter.

Not to mention that the list of timestamped positions is a landmine-laden landfill. The positions have to be filtered, smoothed, and deduplicated. Timestamps are consistantly inconsistant; multiple positions sharing a timestamp or even negative time steps have to be reinterpreted. Like a paleontologist, we must carefully excavate the user's intent from a matrix of refuse.

For efficient storage and replay, converting the input points into a bezier spline is a fundamental decision. A spline is made of multiple curves, which each can represent a section of the drawn path with only a few control points.

To render strokes beautifully, the input must first be smoothed and then used to calculate a well-fitting curve. For realtime drawing, there are further constraints: old parts of the curve cannot noticeably move, and it must run quickly.

Success means continuously converting uncompressed raw points into efficient smooth paths without the user any the wiser.

Each sample is roughly equidistant in time, after for accounting for stops

Should smoothing happen based on distance or time? Distance is actually ~velocity. small = slow or stops, large = fast

## Curve fitting

### Input

- Browsers cap input at the display refresh rate

- Timestamps are not guaranteed to be sequential or spaced evenly

- No input during stops

### Smoothing

- necessary to avoid slow jitter

- moves curves torwards lines

### Corners

- not all strokes are only smooth curves

## Stroke rendering
