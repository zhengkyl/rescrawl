import { useMemo, useRef, useState } from "preact/hooks";
import type { Point2 } from "rescrawl";
import { extendFit } from "rescrawl/centerline/extend";
import "./extend.css";

// A bench for one function: raw points in, cubics out. Nothing else from the
// library runs here -- no smoothing, no widths, no outline -- so whatever is
// on screen is exactly what `extendFit` returned.
//
// Two ways to feed it: draw (every pointer sample becomes a raw point, and the
// fit reruns on the whole prefix each frame) or click (one raw point per
// click). Either way the `fed` slider walks the same input back a point at a
// time, so an incremental fitter can be watched making each decision.

type Mode = "draw" | "click";

// Alternating, so a split between two cubics is visible even where the join
// is smooth. A third colour would be wasted -- neighbours are what matters.
const SEGMENT_COLORS = ["#2563eb", "#e11d48"];

const cubicPath = (c: Point2[]) =>
  `M${c[0].x} ${c[0].y}C${c[1].x} ${c[1].y} ${c[2].x} ${c[2].y} ${c[3].x} ${c[3].y}`;

const isFinitePoint = (p: Point2) => Number.isFinite(p.x) && Number.isFinite(p.y);

// A cubic whose handles both sit on their endpoints is a straight line wearing
// a cubic's clothes. Counted in the HUD because a run of them means the fitter
// is emitting the polyline back, not fitting anything.
const isFlat = (c: Point2[]) =>
  c[0].x === c[1].x && c[0].y === c[1].y && c[3].x === c[2].x && c[3].y === c[2].y;

export function ExtendPage() {
  const [points, setPoints] = useState<Point2[]>([]);
  const [fed, setFed] = useState(0);
  const [mode, setMode] = useState<Mode>("draw");
  const [showRaw, setShowRaw] = useState(true);
  const [showHandles, setShowHandles] = useState(true);
  const [showDropped, setShowDropped] = useState(false);
  const [minGap, setMinGap] = useState(1);
  const [iterations, setIterations] = useState(3);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });

  const svgRef = useRef<SVGSVGElement>(null);
  // The live array: pointermove fires faster than render, so appends read the
  // ref rather than the state a stale closure would hand them.
  const liveRef = useRef<Point2[]>([]);
  const drawing = useRef(false);
  const panning = useRef<{ x: number; y: number } | null>(null);

  const cubics = useMemo(
    () => extendFit(points.slice(0, fed), iterations),
    [points, fed, iterations],
  );

  const flat = cubics === null ? 0 : cubics.filter(isFlat).length;
  const broken = cubics === null ? 0 : cubics.filter((c) => !c.every(isFinitePoint)).length;

  // Which raw points survived into the output, by identity. A split writes `p`
  // itself into the new segment's q3, so a raw point that is still an endpoint
  // is one the fit kept; every other fed point the extension swallowed, where
  // q3 becomes e3 -- near p, within tolerance, but not p. Identity rather than
  // coordinates, because e3 can land on a raw point by coincidence and that is
  // still not the same decision.
  const { kept, dropped } = useMemo(() => {
    const kept = new Set<Point2>();
    if (cubics !== null) {
      for (const c of cubics) {
        kept.add(c[0]);
        kept.add(c[3]);
      }
    }
    let survived = 0;
    for (let i = 0; i < fed; i++) if (kept.has(points[i])) survived++;
    return { kept, dropped: fed - survived };
  }, [cubics, points, fed]);

  // Everything needed to replay this frame outside the page: the fed prefix at
  // full precision, the knob that changes the fit, and what came back.
  function copyData() {
    const data = { iterations, points: points.slice(0, fed), cubics };
    navigator.clipboard.writeText(JSON.stringify(data));
  }

  function commit(next: Point2[]) {
    liveRef.current = next;
    setPoints(next);
    setFed(next.length);
  }

  function append(p: Point2) {
    commit([...liveRef.current, p]);
  }

  const toContent = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - view.x) / view.zoom,
      y: (e.clientY - r.top - view.y) / view.zoom,
    };
  };

  function handlePointerDown(e: PointerEvent) {
    // Middle button pans, left button feeds points.
    if (e.button === 1) {
      svgRef.current!.setPointerCapture(e.pointerId);
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    append(toContent(e));
    if (mode === "draw") drawing.current = true;
  }

  function handlePointerMove(e: PointerEvent) {
    const drag = panning.current;
    if (drag !== null) {
      setView((v) => ({ ...v, x: v.x + e.clientX - drag.x, y: v.y + e.clientY - drag.y }));
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drawing.current) return;
    const p = toContent(e);
    const last = liveRef.current[liveRef.current.length - 1];
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    // A repeated sample is never raw input, it is a stationary pen -- and a
    // zero-length chord is the one thing every fitter divides by.
    if (dx === 0 && dy === 0) return;
    if (dx * dx + dy * dy < minGap * minGap) return;
    append(p);
  }

  function endGesture() {
    panning.current = null;
    drawing.current = false;
  }

  function zoomAt(e: WheelEvent, factor: number) {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const next = Math.max(0.1, Math.min(40, v.zoom * factor));
      return {
        x: mx - ((mx - v.x) / v.zoom) * next,
        y: my - ((my - v.y) / v.zoom) * next,
        zoom: next,
      };
    });
  }

  // Markers are drawn inside the zoomed group, so their radii carry the
  // inverse -- a dot stays a dot at 40x, where the tolerance lives.
  const s = 1 / view.zoom;

  return (
    <>
      <header class="bar">
        <span class="bar-title">extendFit</span>

        <div class="seg">
          <button class={mode === "draw" ? "on" : ""} onClick={() => setMode("draw")}>
            draw
          </button>
          <button class={mode === "click" ? "on" : ""} onClick={() => setMode("click")}>
            click
          </button>
        </div>

        <label
          class="knob"
          title="Minimum distance between consecutive raw points while drawing. 0 feeds every pointer sample."
        >
          gap
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={minGap}
            onInput={(e) => setMinGap(+(e.target as HTMLInputElement).value)}
          />
          <span class="num">{minGap}</span>
        </label>

        <label
          class="knob"
          title="Newton iterations for the closest point on the curve. 0 leaves a at 1, so nothing ever extends."
        >
          newton
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={iterations}
            onInput={(e) => setIterations(+(e.target as HTMLInputElement).value)}
          />
          <span class="num">{iterations}</span>
        </label>

        <label class="check">
          <input
            type="checkbox"
            checked={showRaw}
            onInput={(e) => setShowRaw((e.target as HTMLInputElement).checked)}
          />
          raw points
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={showHandles}
            onInput={(e) => setShowHandles((e.target as HTMLInputElement).checked)}
          />
          handles
        </label>
        <label
          class={showRaw ? "check" : "check off"}
          title="Colour the raw points the fit swallowed, and enlarge the ones it kept as segment endpoints."
        >
          <input
            type="checkbox"
            checked={showDropped}
            disabled={!showRaw}
            onInput={(e) => setShowDropped((e.target as HTMLInputElement).checked)}
          />
          dropped
        </label>

        <span class="spacer" />

        <button
          onClick={copyData}
          disabled={fed === 0}
          title="copy the fed points, newton iterations and output cubics as JSON"
        >
          copy
        </button>
        <button onClick={() => commit(liveRef.current.slice(0, -1))} disabled={points.length === 0}>
          undo
        </button>
        <button onClick={() => commit([])} disabled={points.length === 0}>
          clear
        </button>
        <button onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>reset view</button>
      </header>

      <div class="stage">
        <svg
          ref={svgRef}
          class="canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onWheel={(e) => {
            e.preventDefault();
            if (e.ctrlKey) zoomAt(e, Math.pow(1.001, -e.deltaY));
            else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
          }}
          // stylus long press
          onContextMenu={(e) => e.preventDefault()}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}>
            {showHandles && cubics !== null && (
              <g class="handles">
                {cubics.map((c, i) => (
                  <g key={i}>
                    <path
                      d={`M${c[0].x} ${c[0].y}L${c[1].x} ${c[1].y}M${c[3].x} ${c[3].y}L${c[2].x} ${c[2].y}`}
                      fill="none"
                      stroke="#8b5cf6"
                      stroke-width="1"
                      stroke-dasharray="3 3"
                      vector-effect="non-scaling-stroke"
                    />
                    <circle
                      cx={c[1].x}
                      cy={c[1].y}
                      r={3 * s}
                      fill="#fff"
                      stroke="#8b5cf6"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <circle
                      cx={c[2].x}
                      cy={c[2].y}
                      r={3 * s}
                      fill="#fff"
                      stroke="#8b5cf6"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    {/* the split: where one cubic hands off to the next */}
                    <circle
                      cx={c[3].x}
                      cy={c[3].y}
                      r={4 * s}
                      fill="none"
                      stroke="#111"
                      stroke-width="1.5"
                      vector-effect="non-scaling-stroke"
                    />
                  </g>
                ))}
              </g>
            )}

            {cubics !== null &&
              cubics.map((c, i) => (
                <path
                  key={i}
                  d={cubicPath(c)}
                  fill="none"
                  stroke={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
                  stroke-width="2"
                  vector-effect="non-scaling-stroke"
                />
              ))}

            {showRaw && (
              <g class="raw">
                {points.map((p, i) => {
                  // Beyond the fed prefix it is input the fit has not seen yet.
                  if (i >= fed) {
                    return (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={2.5 * s}
                        fill="none"
                        stroke="#bbb"
                        stroke-width="1"
                        vector-effect="non-scaling-stroke"
                      />
                    );
                  }
                  if (!showDropped) {
                    return <circle key={i} cx={p.x} cy={p.y} r={2.5 * s} fill="#111" />;
                  }
                  // Big black anchors are the points that became endpoints; the
                  // amber ones between them are what the fit threw away.
                  return kept.has(p) ? (
                    <circle key={i} cx={p.x} cy={p.y} r={4 * s} fill="#111" />
                  ) : (
                    <circle key={i} cx={p.x} cy={p.y} r={2 * s} fill="#f59e0b" />
                  );
                })}
              </g>
            )}
          </g>
        </svg>

        {points.length === 0 && (
          <p class="hint">
            {mode === "draw" ? "drag to draw" : "click to add one raw point"} · ctrl+wheel zooms ·
            middle-drag pans
          </p>
        )}
      </div>

      <footer class="bar">
        <button
          onClick={() => setFed((n) => Math.max(0, n - 1))}
          disabled={fed === 0}
          title="feed one fewer raw point"
        >
          ◀
        </button>
        <input
          class="scrub"
          type="range"
          min={0}
          max={points.length}
          step={1}
          value={fed}
          onInput={(e) => setFed(+(e.target as HTMLInputElement).value)}
        />
        <button
          onClick={() => setFed((n) => Math.min(points.length, n + 1))}
          disabled={fed === points.length}
          title="feed one more raw point"
        >
          ▶
        </button>
        <span class="stat">
          fed {fed}/{points.length}
        </span>
        <span class="spacer" />
        <span class="stat">{cubics === null ? "null" : `${cubics.length} cubics`}</span>
        <span
          class="stat dim"
          title="raw points the fit swallowed -- fed, minus the ones that became segment endpoints"
        >
          {dropped} dropped
        </span>
        <span
          class={flat === 0 ? "stat dim" : "stat warn"}
          title="cubics whose handles sit on their endpoints -- a straight line, not a fit"
        >
          {flat} flat
        </span>
        <span
          class={broken === 0 ? "stat dim" : "stat warn"}
          title="cubics containing NaN or Infinity -- these draw nothing"
        >
          {broken} non-finite
        </span>
        <span class="stat dim">{(view.zoom * 100).toFixed(0)}%</span>
      </footer>
    </>
  );
}
