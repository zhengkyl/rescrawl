import { useEffect, useRef, useState } from 'preact/hooks';
import type { Stroke } from '../utils';

function totalDuration(strokes: Stroke[]): number {
  return strokes.reduce((m, st) => st.reduce((mm, pt) => Math.max(mm, pt.t), m), 0);
}

// Owns the replay playhead (a single elapsed-ms clock) and its rAF loop. The
// caller truncates strokes to `elapsed` for rendering — this hook only tracks
// time, not geometry.
export function useReplay(strokes: Stroke[]) {
  const rafRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const durRef = useRef(0);

  const [elapsed, setElapsedState] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);

  function setElapsed(ms: number) {
    elapsedRef.current = ms;
    setElapsedState(ms);
  }

  // Recompute duration when strokes change. Keep the playhead pinned to the end
  // while it's already there (e.g. after drawing) so the time position tracks
  // the latest content; a deliberate mid-scrub position is left untouched.
  useEffect(() => {
    const dur = totalDuration(strokes);
    const followEnd = elapsedRef.current >= durRef.current;
    durRef.current = dur;
    setDuration(dur);
    if (followEnd) setElapsed(dur);
  }, [strokes]);

  function pause() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setIsPlaying(false);
  }

  function play() {
    if (elapsedRef.current >= durRef.current) setElapsed(0);
    const frameStart = performance.now() - elapsedRef.current;
    function frame(now: number) {
      const e = Math.min(now - frameStart, durRef.current);
      setElapsed(e);
      if (e < durRef.current) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
        setIsPlaying(false);
        setIsReplaying(false);
      }
    }
    setIsReplaying(true);
    rafRef.current = requestAnimationFrame(frame);
    setIsPlaying(true);
  }

  function stop() {
    pause();
    setElapsed(0);
    setIsReplaying(false);
  }

  function scrub(ms: number) {
    pause();
    setElapsed(ms);
    setIsReplaying(true);
  }

  function toggle() {
    if (rafRef.current) pause();
    else play();
  }

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return { elapsed, duration, isPlaying, isReplaying, play, pause, stop, scrub, toggle };
}
