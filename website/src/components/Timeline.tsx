import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../context';
import { useStrokes } from '../strokeStore';
import type { Stroke } from '../utils';
import { activeStrokeAt, strokeEnd, strokeStart } from '../utils';

// Time scale, in px per second — the timeline's zoom, like a video editor track.
// Ctrl+scroll rescales about the cursor; the track otherwise just grows wider and
// scrolls as the recording's duration increases.
const DEFAULT_PX_PER_SEC = 120;
const MIN_PX_PER_SEC = 4;    // ~4 minutes across a 1000px track
const MAX_PX_PER_SEC = 4000; // 4px per ms, for ms-level stroke timing
const END_PAD = 240;      // trailing space (px) so the end isn't flush to the edge
const FOLLOW_MARGIN = 48; // keep the playhead this far inside the right edge

const RULER_H = 16;       // ruler/label band height (px)
const LANE_H = 12;        // vertical pitch of a stacked-stroke lane (px)
const BAND_PAD = 6;       // gap between ruler and the first lane (px)

const clampScale = (s: number) => Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, s));

type Span = { index: number; start: number; end: number; lane: number };

// Greedily pack strokes into lanes so overlapping spans stack instead of
// colliding (interval-graph coloring). Strokes are placed in start order, each
// into the first lane whose previous stroke has already ended.
function layoutLanes(strokes: Stroke[]): { spans: Span[]; lanes: number } {
  const spans: Span[] = strokes.map((st, index) => {

    const start = strokeStart(st)
    const end = strokeEnd(st)
    return { index, start, end, lane: 0 };
  });
  const order = [...spans].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  for (const s of order) {
    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.end); }
    else laneEnds[lane] = s.end;
    s.lane = lane;
  }
  return { spans, lanes: Math.max(1, laneEnds.length) };
}

// Depletion-arc geometry for the live countdown ring on the playhead. Starts at
// the top, drawn clockwise, so as `frac` shrinks the trailing edge recedes
// counterclockwise (Zelda-style stamina depletion).
const RING_R = 9;
const RING_C = 12;
const RING_SIZE = RING_C * 2;
function graceArc(frac: number): string {
  frac = Math.max(0, Math.min(1, frac));
  const cx = RING_C, cy = RING_C, r = RING_R;
  if (frac >= 1) return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`;
  const ang = frac * 2 * Math.PI;
  const x1 = cx + r * Math.sin(ang);
  const y1 = cy - r * Math.cos(ang);
  const largeArc = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
}

// Tick spacing ladder, in seconds — a 1/2/5 progression from 10ms to an hour so
// every zoom level lands on a round number.
const TICK_STEPS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600,
];
const MIN_TICK_PX = 64; // narrowest gap that still fits a label

// Coarsest-first is wrong here: we want the *finest* spacing whose labels don't
// collide, so walk from the bottom and take the first that clears MIN_TICK_PX.
function tickStep(pxPerSec: number): number {
  return TICK_STEPS.find((step) => step * pxPerSec >= MIN_TICK_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

// Sub-second ticks need decimals; whole-second ones would only show a noisy ".0".
const stepDecimals = (step: number) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

function formatTime(ms: number, decimals = 0): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = (total - m * 60).toFixed(decimals);
  // "12.34" needs 5 chars to keep 1:05.5 from rendering as 1:5.5.
  return m > 0 ? `${m}:${s.padStart(decimals > 0 ? decimals + 3 : 2, '0')}` : `${s}s`;
}

// The timeline re-renders every frame (live head while recording, playhead while
// playing), but the ticks only change when the duration crosses a new second.
// Memoise on the tick count so we don't rebuild O(duration) vnodes per frame —
// left unmemoised this allocates faster than GC can keep up on a long timeline.
function Ruler({ duration, pxPerMs }: { duration: number; pxPerMs: number }) {
  const step = tickStep(pxPerMs * 1000);
  const count = Number.isFinite(duration) ? Math.max(0, Math.ceil(duration / 1000 / step)) : 0;
  return useMemo(() => {
    const decimals = stepDecimals(step);
    const ticks = [];
    // Indexed, not accumulated: `s += 0.05` drifts off the round values the whole
    // ladder exists to hit.
    for (let i = 0; i <= count; i++) {
      const ms = i * step * 1000;
      ticks.push(
        <div key={i} class="timeline-tick" style={{ left: `${ms * pxPerMs}px` }}>
          <span class="timeline-tick-label">{formatTime(ms, decimals)}</span>
        </div>,
      );
    }
    return <div class="timeline-ruler">{ticks}</div>;
  }, [count, step, pxPerMs]);
}

type LiveSpan = { start: number; end: number; lane: number };

function segmentStyle(start: number, end: number, lane: number, pxPerMs: number) {
  return {
    left: `${start * pxPerMs}px`,
    width: `${Math.max(0, end - start) * pxPerMs}px`,
    top: `${lane * LANE_H + LANE_H / 2}px`,
  };
}

// First lane not occupied by a committed stroke overlapping [start, end] — where
// the in-progress stroke goes so a concurrent (multi-touch) stroke won't collide.
function firstFreeLane(spans: Span[], start: number, end: number): number {
  const used = new Set<number>();
  for (const s of spans) if (s.start < end && s.end > start) used.add(s.lane);
  let lane = 0;
  while (used.has(lane)) lane++;
  return lane;
}

function StrokesLayer({ spans, lanes, selected, live, pxPerMs }: { spans: Span[]; lanes: number; selected: number | null; live: LiveSpan | null; pxPerMs: number }) {
  // Committed segments only change between strokes (or a rescale), so don't
  // rebuild them on every live frame while a stroke is being drawn.
  const committed = useMemo(
    () => spans.map((s) => (
      <div key={s.index} class={`timeline-stroke${s.index === selected ? ' is-selected' : ''}`} style={segmentStyle(s.start, s.end, s.lane, pxPerMs)} />
    )),
    [spans, selected, pxPerMs],
  );
  return (
    <div class="timeline-strokes" style={{ height: `${lanes * LANE_H}px` }}>
      {committed}
      {live && <div class="timeline-stroke is-live" style={segmentStyle(live.start, live.end, live.lane, pxPerMs)} />}
    </div>
  );
}

export function Timeline() {
  const { clock } = useApp();
  const strokes = useStrokes().strokes.value;
  const { seek, isPlaying, isRecording, isIdle } = clock;

  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const pxPerMs = pxPerSec / 1000;
  // The wheel listener is bound once, so it reads the live scale through a ref
  const pxPerMsRef = useRef(pxPerMs);
  pxPerMsRef.current = pxPerMs;
  // Handed from the zoom gesture to the layout effect that restores scroll.
  const anchorRef = useRef<{ ms: number; offsetX: number } | null>(null);

  const layout = useMemo(() => layoutLanes(strokes), [strokes]);

  const canPlay = strokes.length > 0;

  // A recording session drives `elapsed` per frame, so everything below reads
  // straight off the clock — no polling loop, and the playhead keeps scrolling
  // through the grace period instead of freezing at the last stroke's end. The
  // committed end (clock.duration) is the "tentative end" marker below.
  const elapsed = clock.elapsed.value;

  // Actively drawing a stroke (vs. the idle grace period between strokes).
  const activeStart = clock.activeStart();

  // The stroke currently being drawn grows from its start to the live head.
  const liveSpan: LiveSpan | null = activeStart !== null
    ? { start: activeStart, end: Math.max(activeStart, elapsed), lane: 0 }
    : null;
  if (liveSpan) liveSpan.lane = firstFreeLane(layout.spans, liveSpan.start, liveSpan.end);
  const displayLanes = Math.max(layout.lanes, liveSpan ? liveSpan.lane + 1 : 0);
  const trackHeight = Math.max(44, RULER_H + BAND_PAD + displayLanes * LANE_H + BAND_PAD);

  const duration = Math.max(clock.duration.value, elapsed);
  const playheadX = elapsed * pxPerMs;
  const contentWidth = Math.max(0, duration * pxPerMs) + END_PAD;

  // The tentative end: where committed content stops, i.e. where replay and
  // export currently end. New strokes are appended at the current time (the
  // playhead, which can be scrubbed anywhere, including past this) — the marker
  // is purely the replay/export boundary. Always shown when there's content and
  // we're not live; while live, the playhead and grace ring convey current time.
  const tentativeX = clock.duration.value * pxPerMs;
  const showTentative = !isRecording && clock.duration.value > 0;

  // The "played" highlight fills up to the playhead, but never past the content
  // end into empty trailing time — except while drawing, where content grows
  // with the playhead.
  const playedX = activeStart !== null ? playheadX : Math.min(playheadX, tentativeX);

  function seekFromEvent(e: PointerEvent) {
    const content = trackRef.current!.querySelector('.timeline-content');
    if (!content) return;
    const rect = content.getBoundingClientRect();
    const ms = (e.clientX - rect.left) / pxPerMs;
    // Not clamped to the content end: the playhead can be parked past it (e.g. to
    // leave trailing time), and `duration` grows to follow so the track expands.
    seek(Math.max(0, ms));
  }

  function onPointerDown(e: PointerEvent) {
    if (duration <= 0 || isRecording) return; // don't fight the live head
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFromEvent(e);
  }

  function onPointerMove(e: PointerEvent) {
    if (draggingRef.current) seekFromEvent(e);
  }

  function onPointerUp(e: PointerEvent) {
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  // Ctrl+scroll rescales about the cursor 
  // A plain wheel scrolls the track horizontally
  // Bound imperatively for `passive: false`
  // both branches need preventDefault to beat page zoom/scroll.
  useEffect(() => {
    const track = trackRef.current!;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (!e.ctrlKey) {
        track.scrollLeft += e.deltaX || e.deltaY;
        return;
      }
      // Pin the time under the cursor: record where it is now, and restore that
      // screen position once the new scale has been laid out.
      const offsetX = e.clientX - track.getBoundingClientRect().left;
      anchorRef.current = { ms: (track.scrollLeft + offsetX) / pxPerMsRef.current, offsetX };
      setPxPerSec((s) => clampScale(s * Math.pow(1.001, -e.deltaY)));
    }
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => track.removeEventListener('wheel', onWheel);
  }, []);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return; // rescale came from the reset button, not a gesture
    anchorRef.current = null;
    trackRef.current!.scrollLeft = anchor.ms * pxPerMs - anchor.offsetX;
  }, [pxPerMs]);

  // Auto-follow the playhead while playing or recording so the latest content
  // stays in view. Stay out of the way when the user is dragging or paused.
  useLayoutEffect(() => {
    if (draggingRef.current) return;
    if (!isPlaying && !isRecording) return;
    const track = trackRef.current;
    if (!track) return;
    const left = track.scrollLeft;
    const right = left + track.clientWidth;
    if (playheadX > right - FOLLOW_MARGIN) {
      track.scrollLeft = playheadX - track.clientWidth + FOLLOW_MARGIN;
    } else if (playheadX < left) {
      track.scrollLeft = Math.max(0, playheadX - FOLLOW_MARGIN);
    }
  }, [playheadX, isPlaying, isRecording]);

  const empty = duration <= 0;

  // Highlight the segment of the stroke under the playhead (while not recording),
  // mirroring the canvas's active-stroke highlight.
  const activeStroke = isRecording ? null : activeStrokeAt(strokes, elapsed);

  return (
    <div class={`timeline${isRecording ? ' is-live' : ''}`}>
      <div class="timeline-header">
        <button id="btn-play" disabled={!canPlay} onClick={isPlaying ? clock.pause : clock.startPlayback}>{isPlaying ? '⏸' : '▶'}</button>
        <div class="timeline-readout">
          {formatTime(elapsed)} / {formatTime(duration)}
        </div>
        <span
          class="timeline-zoom"
          title="Time scale (Ctrl+scroll) — click to reset"
          onClick={() => setPxPerSec(DEFAULT_PX_PER_SEC)}
        >
          {(pxPerSec / DEFAULT_PX_PER_SEC).toFixed(2).replace(/\.?0+$/, '')}&times;
        </span>
      </div>
      <div class={`timeline-track${empty ? ' is-empty' : ''}`} ref={trackRef} style={{ height: `${trackHeight}px` }}>
        <div
          class="timeline-content"
          style={{ width: `${contentWidth}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <Ruler duration={duration} pxPerMs={pxPerMs} />
          <StrokesLayer spans={layout.spans} lanes={displayLanes} selected={activeStroke} live={liveSpan} pxPerMs={pxPerMs} />
          <div class="timeline-played" style={{ width: `${playedX}px` }} />
          {showTentative && (
            <div
              class="timeline-tentative"
              style={{ left: `${tentativeX}px` }}
              title="Replay & export end here"
            >
              <div class="timeline-tentative-handle" />
            </div>
          )}
          <div class="timeline-playhead" style={{ left: `${playheadX}px` }}>
            {isRecording ? (
              <svg class="timeline-grace" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
                <circle cx={RING_C} cy={RING_C} r={RING_R} fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="3" />
                <path d={graceArc(clock.graceFraction())} fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" />
              </svg>
            ) : (
              <div class="timeline-playhead-handle" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
