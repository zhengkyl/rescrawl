import { useSignal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { useStrokes } from "../strokeStore";
import { LIVE_TIMEOUT } from "../stroke";

//   idle      — parked at `elapsed` (paused, seeked, or the idle cap fired)
//   playing   — rAF-driven, runs to `duration` and parks there
//   recording — wall-clock, unbounded; `now()` is what stamps new points
type Mode = "idle" | "playing" | "recording";

export function usePlayhead() {
  const { duration } = useStrokes();
  const [mode, setMode] = useState<Mode>("idle");

  // 60 fps playhead, signal limits rerender to necessary components
  const elapsed = useSignal(0);
  const originRef = useRef<number | null>(null); // performance.now() baseline while running; null = paused

  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null); // the idle cap, only non-null during recording

  function getElapsed(): number {
    return getElapsedFromTs(performance.now());
  }
  // time relative to origin
  function getElapsedFromTs(ts: number): number {
    return ts - originRef.current!;
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

    setMode("idle");
  }

  function startPlayback() {
    pause();

    const newElapsed = elapsed.value >= duration.value ? 0 : elapsed.value;
    originRef.current = performance.now() - newElapsed;
    elapsed.value = newElapsed;

    setMode("playing");
    const frame = () => {
      const newElapsed = getElapsed();
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
      elapsed.value = getElapsed();
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  function penDown() {
    cancelTimer();
  }

  function penUp() {
    cancelTimer();
    timerRef.current = setTimeout(pause, LIVE_TIMEOUT);
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
    getElapsed,
    getElapsedFromTs,
    isIdle: mode === "idle",
    isPlaying: mode === "playing",
    isRecording: mode === "recording",
    seek,
    pause,
    startPlayback,
    startRecording,
    penDown,
    penUp,
  };
}

export type Playhead = ReturnType<typeof usePlayhead>;
