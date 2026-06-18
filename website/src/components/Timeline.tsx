import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../context';
import type { Stroke } from '../utils';
import { strokeEnd, strokeStart } from '../utils';

// Fixed time scale: the timeline never rescales, it only grows wider and scrolls
// as the recording's duration increases — like a video/audio editor track.
const PX_PER_SEC = 120;
const PX_PER_MS = PX_PER_SEC / 1000;
const END_PAD = 240;      // trailing space (px) so the end isn't flush to the edge
const FOLLOW_MARGIN = 48; // keep the playhead this far inside the right edge

const RULER_H = 16;       // ruler/label band height (px)
const LANE_H = 12;        // vertical pitch of a stacked-stroke lane (px)
const BAND_PAD = 6;       // gap between ruler and the first lane (px)

const msToPx = (ms: number) => ms * PX_PER_MS;

type Span = { index: number; start: number; end: number; lane: number };

const strokeSpan = (st: Stroke): [number, number] => [strokeStart(st), strokeEnd(st)];

// Greedily pack strokes into lanes so overlapping spans stack instead of
// colliding (interval-graph coloring). Strokes are placed in start order, each
// into the first lane whose previous stroke has already ended.
function layoutLanes(strokes: Stroke[]): { spans: Span[]; lanes: number } {
  const spans: Span[] = strokes.map((st, index) => {
    const [start, end] = strokeSpan(st);
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

// Choose a tick spacing (in seconds) that stays legible at the fixed scale.
function tickStep(): number {
  for (const step of [1, 2, 5, 10, 30, 60]) {
    if (step * PX_PER_SEC >= 64) return step;
  }
  return 60;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

// The timeline re-renders every frame (live head while recording, playhead while
// playing), but the ticks only change when the duration crosses a new second.
// Memoise on the tick count so we don't rebuild O(duration) vnodes per frame —
// left unmemoised this allocates faster than GC can keep up on a long timeline.
function Ruler({ duration }: { duration: number }) {
  const step = tickStep();
  const last = Number.isFinite(duration) ? Math.max(0, Math.ceil(duration / 1000 / step)) * step : 0;
  return useMemo(() => {
    const ticks = [];
    for (let s = 0; s <= last; s += step) {
      ticks.push(
        <div key={s} class="timeline-tick" style={{ left: `${msToPx(s * 1000)}px` }}>
          <span class="timeline-tick-label">{formatTime(s * 1000)}</span>
        </div>,
      );
    }
    return <div class="timeline-ruler">{ticks}</div>;
  }, [last, step]);
}

type LiveSpan = { start: number; end: number; lane: number };

function segmentStyle(start: number, end: number, lane: number) {
  return {
    left: `${msToPx(start)}px`,
    width: `${msToPx(Math.max(0, end - start))}px`,
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

function StrokesLayer({ spans, lanes, selected, live }: { spans: Span[]; lanes: number; selected: number | null; live: LiveSpan | null }) {
  // Committed segments only change between strokes, so don't rebuild them on
  // every live frame while a stroke is being drawn.
  const committed = useMemo(
    () => spans.map((s) => (
      <div key={s.index} class={`timeline-stroke${s.index === selected ? ' is-selected' : ''}`} style={segmentStyle(s.start, s.end, s.lane)} />
    )),
    [spans, selected],
  );
  return (
    <div class="timeline-strokes" style={{ height: `${lanes * LANE_H}px` }}>
      {committed}
      {live && <div class="timeline-stroke is-live" style={segmentStyle(live.start, live.end, live.lane)} />}
    </div>
  );
}

export function Timeline() {
  const { replay, live, store } = useApp();
  const { scrub, isPlaying } = replay;

  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const layout = useMemo(() => layoutLanes(store.strokes), [store.strokes]);

  const recording = live.isLive;
  const canPlay = store.strokes.length > 0;

  // The playhead lives on the replay clock — scrubbing moves it and recording
  // seeds/rests it there (see App). The one exception is while a stroke is being
  // actively drawn: the store only commits between strokes, so poll the live
  // clock each frame for a smooth head and a growing segment. The grace ring
  // also needs per-frame updates, so keep polling for the whole live session.
  const [liveState, setLiveState] = useState<{ head: number; grace: number; start: number | null } | null>(null);
  useEffect(() => {
    if (!live.isLive) { setLiveState(null); return; }
    let raf = 0;
    const loop = () => {
      setLiveState({ head: live.now(), grace: live.graceFraction(), start: live.activeStart() });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live.isLive]);

  // Actively drawing a stroke (vs. the idle grace period between strokes).
  const drawing = liveState?.start != null;
  const head = liveState?.head ?? 0;

  // The stroke currently being drawn grows from its start to the live head.
  const liveSpan: LiveSpan | null = drawing
    ? { start: liveState!.start!, end: Math.max(liveState!.start!, head), lane: 0 }
    : null;
  if (liveSpan) liveSpan.lane = firstFreeLane(layout.spans, liveSpan.start, liveSpan.end);
  const displayLanes = Math.max(layout.lanes, liveSpan ? liveSpan.lane + 1 : 0);
  const trackHeight = Math.max(44, RULER_H + BAND_PAD + displayLanes * LANE_H + BAND_PAD);

  // While recording, the playhead is always the live clock (current time) so the
  // timeline keeps scrolling through the grace period instead of freezing at the
  // last stroke's end. The committed end (replay.duration) is surfaced separately
  // as the "tentative end" marker below.
  const elapsed = recording && liveState ? head : replay.elapsed;
  const duration = Math.max(replay.duration, elapsed);
  const playheadX = msToPx(elapsed);
  const contentWidth = Math.max(0, msToPx(duration)) + END_PAD;

  // The tentative end: where committed content stops, i.e. where replay and
  // export currently end. New strokes are appended at the current time (the
  // playhead, which can be scrubbed anywhere, including past this) — the marker
  // is purely the replay/export boundary. Always shown when there's content and
  // we're not live; while live, the playhead and grace ring convey current time.
  const tentativeX = msToPx(replay.duration);
  const showTentative = !recording && replay.duration > 0;

  // The "played" highlight fills up to the playhead, but never past the content
  // end into empty trailing time — except while drawing, where content grows
  // with the playhead.
  const playedX = drawing ? playheadX : Math.min(playheadX, tentativeX);

  function seekFromEvent(e: PointerEvent) {
    const content = trackRef.current?.querySelector('.timeline-content');
    if (!content) return;
    const rect = content.getBoundingClientRect();
    const ms = (e.clientX - rect.left) / PX_PER_MS;
    // Not clamped to the content end: the playhead can be parked past it (e.g. to
    // leave trailing time), and `duration` grows to follow so the track expands.
    scrub(Math.max(0, ms));
  }

  function onPointerDown(e: PointerEvent) {
    if (duration <= 0 || recording) return; // don't fight the live head
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

  // Auto-follow the playhead while playing or recording so the latest content
  // stays in view. Stay out of the way when the user is dragging or paused.
  useLayoutEffect(() => {
    if (draggingRef.current) return;
    if (!isPlaying && !recording) return;
    const track = trackRef.current;
    if (!track) return;
    const left = track.scrollLeft;
    const right = left + track.clientWidth;
    if (playheadX > right - FOLLOW_MARGIN) {
      track.scrollLeft = playheadX - track.clientWidth + FOLLOW_MARGIN;
    } else if (playheadX < left) {
      track.scrollLeft = Math.max(0, playheadX - FOLLOW_MARGIN);
    }
  }, [playheadX, isPlaying, recording]);

  const empty = duration <= 0;

  return (
    <div class={`timeline${recording ? ' is-live' : ''}`}>
      <div class="timeline-header">
        <button id="btn-play" disabled={!canPlay} onClick={replay.toggle}>{isPlaying ? '⏸' : '▶'}</button>
        <div class="timeline-readout">
          {formatTime(elapsed)} / {formatTime(duration)}
        </div>
      </div>
      <div class={`timeline-track${empty ? ' is-empty' : ''}`} ref={trackRef} style={{ height: `${trackHeight}px` }}>
        <div
          class="timeline-content"
          style={{ width: `${contentWidth}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <Ruler duration={duration} />
          <StrokesLayer spans={layout.spans} lanes={displayLanes} selected={store.selectedStroke} live={liveSpan} />
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
            {recording && liveState ? (
              <svg class="timeline-grace" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
                <circle cx={RING_C} cy={RING_C} r={RING_R} fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="3" />
                <path d={graceArc(liveState.grace)} fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" />
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
