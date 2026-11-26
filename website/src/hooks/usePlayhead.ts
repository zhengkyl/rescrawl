import type { ReadonlySignal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";

// replay time, in ms; runs to `duration` and parks there
export function usePlayhead(duration: ReadonlySignal<number>) {
  const [playing, setPlaying] = useState(false);
  const elapsed = useSignal(0);
  const rafRef = useRef<number | null>(null);

  function pause() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(false);
  }

  function seek(ms: number) {
    pause();
    elapsed.value = ms;
  }

  function startPlayback() {
    pause();
    const from = elapsed.value >= duration.value ? 0 : elapsed.value;
    const origin = performance.now() - from;
    elapsed.value = from;
    setPlaying(true);
    const frame = () => {
      const t = performance.now() - origin;
      if (t < duration.value) {
        elapsed.value = t;
        rafRef.current = requestAnimationFrame(frame);
      } else {
        seek(duration.value);
      }
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  useEffect(() => pause, []);

  return { elapsed, duration, isPlaying: playing, seek, pause, startPlayback };
}

export type Playhead = ReturnType<typeof usePlayhead>;
