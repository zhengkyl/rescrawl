import { useEffect, useRef, useState } from 'preact/hooks';

const LIVE_TIMEOUT = 2000; // ms of idle after a stroke before live mode ends

// Owns the recording clock. Stroke timings only advance while "live" (drawing
// plus a short grace period after each stroke), which naturally caps the gap
// between strokes. The live head and the grace countdown are surfaced through
// `now()` / `graceFraction()` so the timeline can visualise them.
export function useLiveRecording() {
  const [isLive, setIsLive] = useState(false);

  const baseRef = useRef(0);                            // live ms banked from ended sessions
  const sessionStartRef = useRef<number | null>(null); // performance.now() of current session, or null
  const countdownStartRef = useRef<number | null>(null); // performance.now() when the grace countdown began, or null while drawing
  const timerRef = useRef<number | null>(null);        // timeout that ends live mode when the grace runs out
  const activeStartRef = useRef<number | null>(null);  // live-ms start of the stroke being drawn, or null when not drawing

  // Live-ms timestamp of the in-progress stroke's start, or null between
  // strokes. The timeline pairs this with `now()` to draw the growing segment.
  function activeStart(): number | null {
    return activeStartRef.current;
  }

  // Current live-elapsed ms (banked sessions + the running one, if any).
  function now(): number {
    const running = sessionStartRef.current !== null ? performance.now() - sessionStartRef.current : 0;
    return Math.round(baseRef.current + running);
  }

  // Fraction of the post-stroke grace period remaining: 1 while a stroke is in
  // progress, depleting to 0 over LIVE_TIMEOUT once the pen lifts, 0 when not
  // live. The timeline reads this each frame to draw the depletion ring.
  function graceFraction(): number {
    if (sessionStartRef.current === null) return 0;       // not live
    if (countdownStartRef.current === null) return 1;     // actively drawing
    const remaining = LIVE_TIMEOUT - (performance.now() - countdownStartRef.current);
    return Math.max(0, Math.min(1, remaining / LIVE_TIMEOUT));
  }

  function clearTimer() {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
  }

  function endLive() {
    if (sessionStartRef.current !== null) {
      baseRef.current += performance.now() - sessionStartRef.current;
      sessionStartRef.current = null;
    }
    countdownStartRef.current = null;
    clearTimer();
    setIsLive(false);
  }

  // A stroke started: (re)enter live mode and cancel any pending countdown.
  function strokeStarted() {
    clearTimer();
    countdownStartRef.current = null;
    if (sessionStartRef.current === null) sessionStartRef.current = performance.now();
    activeStartRef.current = now();
    setIsLive(true);
  }

  // A stroke ended: start the grace countdown; live mode ends if it runs out.
  function strokeEnded() {
    activeStartRef.current = null;
    countdownStartRef.current = performance.now();
    clearTimer();
    timerRef.current = setTimeout(endLive, LIVE_TIMEOUT) as unknown as number;
  }

  // Reset the clock (e.g. on clear) or seed it (e.g. continuing an import).
  function reset(base = 0) {
    clearTimer();
    baseRef.current = base;
    sessionStartRef.current = null;
    countdownStartRef.current = null;
    activeStartRef.current = null;
    setIsLive(false);
  }

  useEffect(() => () => clearTimer(), []);

  return { isLive, now, graceFraction, activeStart, strokeStarted, strokeEnded, reset };
}
