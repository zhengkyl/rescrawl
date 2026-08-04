import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Stroke } from "../utils";
import { strokeEnd } from "../utils";

export const LIVE_TIMEOUT = 2000; // ms of idle after a stroke before recording ends

// What is driving the playhead:
//   idle      — parked at `elapsed` (paused, seeked, or the idle cap fired)
//   playing   — rAF-driven, runs to `duration` and parks there
//   recording — wall-clock, unbounded; `now()` is what stamps new points
type Mode = "idle" | "playing" | "recording";

type Pen = { down: boolean; since: number };

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function usePlayhead(strokes: Stroke[]) {
  const [mode, setMode] = useState<Mode>("idle");
  const [elapsed, setElapsedState] = useState(0);

  const elapsedRef = useRef(0);
  const originRef = useRef<number | null>(null); // performance.now() baseline while running; null = parked
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null); // the idle cap
  const penRef = useRef<Pen | null>(null); // null when not recording

  const duration = useMemo(
    () => strokes.reduce((max, st) => Math.max(max, strokeEnd(st)), 0),
    [strokes],
  );
  const durationRef = useRef(duration);
  durationRef.current = duration;

  // The clock: what time it is right now. Only valid while the playhead is
  // running — parked, there is no clock, and its position is `elapsed`. Every
  // caller is inside a running mode, which is why the origin is asserted.
  function now(): number {
    return Math.round(performance.now() - originRef.current!);
  }

  // Always the last write of a transition: it schedules the render, so the other
  // half of the clock (`originRef`) has to be settled before it runs.
  function setElapsed(ms: number) {
    elapsedRef.current = ms;
    setElapsedState(ms);
  }

  function stopLoop() {
    if (rafRef.current == null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function stopTimer() {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function seek(ms: number) {
    stopLoop();
    stopTimer();
    penRef.current = null;

    originRef.current = null;
    setElapsed(ms);
    setMode("idle");
  }

  // Start the playhead running from `ms`. The origin is the whole clock: both
  // replay and recording read it back through `now()`.
  function run(ms: number) {
    stopLoop();
    stopTimer();
    penRef.current = null;

    originRef.current = performance.now() - ms;
    setElapsed(ms);
  }

  // --- moving the playhead ---

  // Precondition: the playhead is running. Both callers satisfy it — the play
  // button (only shown while playing) and the idle cap (armed only by penUp).
  function pause() {
    seek(now());
  }

  function play() {
    const from = elapsedRef.current >= durationRef.current ? 0 : elapsedRef.current;
    run(from);
    setMode("playing");
    const frame = () => {
      const e = now();
      if (e < durationRef.current) {
        setElapsed(e);
        rafRef.current = requestAnimationFrame(frame);
      } else {
        seek(durationRef.current);
      }
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  // --- recording ---

  // A session drives `elapsed` per frame, so the canvas and timeline can just
  // read it — nothing polls the clock. The guard matters: re-running mid-session
  // would rebase the origin onto a frame-old `elapsed` and rewind the playhead,
  // so a stroke started during the grace period must leave the clock alone.
  function startRecording() {
    if (mode === "recording") return;
    run(elapsedRef.current);
    setMode("recording");
    const frame = () => {
      setElapsed(now());
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  function penDown() {
    stopTimer();
    penRef.current = { down: true, since: now() };
  }

  function penUp() {
    stopTimer();
    penRef.current = { down: false, since: now() };

    timerRef.current = setTimeout(pause, LIVE_TIMEOUT);
  }

  // Start of the in-progress stroke, or null between strokes. The timeline pairs
  // it with `now()` to draw the growing segment.
  function activeStart(): number | null {
    const pen = penRef.current;
    return pen !== null && pen.down ? pen.since : null;
  }

  function graceFraction(): number {
    const pen = penRef.current;
    if (pen === null) return 0;
    if (pen.down) return 1;
    return clamp01(1 - (now() - pen.since) / LIVE_TIMEOUT);
  }

  useEffect(
    () => () => {
      stopLoop();
      stopTimer();
    },
    [],
  );

  return {
    elapsed,
    duration,
    now,
    isPlaying: mode === "playing",
    isRecording: mode === "recording",
    seek,
    play,
    pause,
    startRecording,
    penDown,
    penUp,
    activeStart,
    graceFraction,
  };
}

export type Playhead = ReturnType<typeof usePlayhead>;
