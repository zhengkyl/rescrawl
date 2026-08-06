import { useSignal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { useStrokes } from "../strokeStore";
import { LIVE_TIMEOUT } from "../utils";

//   idle      — parked at `elapsed` (paused, seeked, or the idle cap fired)
//   playing   — rAF-driven, runs to `duration` and parks there
//   recording — wall-clock, unbounded; `now()` is what stamps new points
type Mode = "idle" | "playing" | "recording";

type Pen = { down: boolean; since: number };

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function usePlayhead() {
  const { duration } = useStrokes();
  const [mode, setMode] = useState<Mode>("idle");

  // 60 fps playhead, signal limits rerender to necessary components
  const elapsed = useSignal(0);
  const originRef = useRef<number | null>(null); // performance.now() baseline while running; null = paused

  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null); // the idle cap, only non-null during recording
  const penRef = useRef<Pen | null>(null); // null when not recording

  function now(): number {
    return nowFromTs(performance.now());
  }
  // time relative to origin
  function nowFromTs(ts: number): number {
    return Math.round(ts - originRef.current!);
  }

  function cancelRaf() {
    if (rafRef.current == null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function cancelTimer() {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function seek(ms: number) {
    pause();
    elapsed.value = ms;
  }

  function pause() {
    // shared
    cancelRaf();
    originRef.current = null;

    // recording only
    cancelTimer();
    penRef.current = null;

    setMode("idle");
  }

  function startPlayback() {
    pause();

    const newElapsed = elapsed.value >= duration.value ? 0 : elapsed.value;
    originRef.current = performance.now() - newElapsed;
    elapsed.value = newElapsed;

    setMode("playing");
    const frame = () => {
      const newElapsed = now();
      if (newElapsed < duration.value) {
        elapsed.value = newElapsed;
        rafRef.current = requestAnimationFrame(frame);
      } else {
        seek(duration.value);
      }
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  function startRecording(originTs: number) {
    pause();

    originRef.current = originTs - elapsed.value;

    setMode("recording");
    const frame = () => {
      elapsed.value = now();
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  function penDown(since: number) {
    penRef.current = { down: true, since };
    cancelTimer();
  }

  function penUp(since: number) {
    penRef.current = { down: false, since };
    cancelTimer();
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
      cancelRaf();
      cancelTimer();
    },
    [],
  );

  return {
    elapsed,
    duration,
    now,
    nowFromTs,
    isIdle: mode === "idle",
    isPlaying: mode === "playing",
    isRecording: mode === "recording",
    seek,
    pause,
    startPlayback,
    startRecording,
    penDown,
    penUp,
    activeStart,
    graceFraction,
  };
}

export type Playhead = ReturnType<typeof usePlayhead>;
