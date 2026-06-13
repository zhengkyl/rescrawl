import { useEffect, useRef, useState } from 'preact/hooks';
import { staminaArc } from '../components/StaminaRing';

const LIVE_TIMEOUT = 2000;    // ms of idle after a stroke before live mode ends
const STAMINA_WINDOW = 1000;  // only show the ring during the last Nms of the countdown
const STAMINA_OFFSET_X = 52;  // ring distance right of the cursor (px)
const STAMINA_OFFSET_Y = 52;  // ring distance above the cursor (px)
const STAMINA_EASE = 0.12;    // position smoothing per frame (lower = floatier)

// Owns the recording clock. Stroke timings only advance while "live" (drawing
// plus a short grace period after each stroke), which naturally caps the gap
// between strokes. Also drives the floating countdown ring imperatively.
export function useLiveRecording() {
  const [isLive, setIsLive] = useState(false);

  const baseRef = useRef(0);                    // live ms banked from ended sessions
  const sessionStartRef = useRef<number | null>(null); // performance.now() of current session, or null
  const countdownStartRef = useRef(0);          // performance.now() when the grace countdown began
  const rafRef = useRef<number | null>(null);   // rAF id driving the ring
  const cursorRef = useRef({ x: 0, y: 0 });     // latest pointer position (client coords)
  const ringPosRef = useRef({ x: 0, y: 0 });    // eased ring position (client coords)
  const ringRef = useRef<HTMLDivElement>(null);
  const arcRef = useRef<SVGPathElement>(null);

  const ringTarget = () => ({ x: cursorRef.current.x + STAMINA_OFFSET_X, y: cursorRef.current.y - STAMINA_OFFSET_Y });

  // Current live-elapsed ms (banked sessions + the running one, if any).
  function now(): number {
    const running = sessionStartRef.current !== null ? performance.now() - sessionStartRef.current : 0;
    return Math.round(baseRef.current + running);
  }

  function updateCursor(x: number, y: number) {
    cursorRef.current = { x, y };
  }

  function cancelCountdown() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (ringRef.current) ringRef.current.style.opacity = '0';
  }

  // A stroke started: (re)enter live mode and cancel any pending countdown.
  function strokeStarted() {
    cancelCountdown();
    if (sessionStartRef.current === null) sessionStartRef.current = performance.now();
    setIsLive(true);
  }

  function endLive() {
    if (sessionStartRef.current !== null) {
      baseRef.current += performance.now() - sessionStartRef.current;
      sessionStartRef.current = null;
    }
    cancelCountdown();
    setIsLive(false);
  }

  function frame(t: number) {
    const remaining = LIVE_TIMEOUT - (t - countdownStartRef.current);
    if (remaining <= 0) { rafRef.current = null; endLive(); return; }

    const target = ringTarget();
    const show = remaining <= STAMINA_WINDOW;
    const pos = ringPosRef.current;
    if (show) {
      pos.x += (target.x - pos.x) * STAMINA_EASE;
      pos.y += (target.y - pos.y) * STAMINA_EASE;
    } else {
      pos.x = target.x; pos.y = target.y; // park at the cursor while hidden
    }
    const el = ringRef.current;
    if (el) {
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.style.opacity = show ? '1' : '0';
    }
    if (show) arcRef.current?.setAttribute('d', staminaArc(remaining / STAMINA_WINDOW));
    rafRef.current = requestAnimationFrame(frame);
  }

  // A stroke ended: start the grace countdown unless drawing resumes.
  function strokeEnded() {
    countdownStartRef.current = performance.now();
    ringPosRef.current = ringTarget();
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(frame);
  }

  // Reset the clock (e.g. on clear) or seed it (e.g. continuing an import).
  function reset(base = 0) {
    cancelCountdown();
    baseRef.current = base;
    sessionStartRef.current = null;
    setIsLive(false);
  }

  useEffect(() => () => cancelCountdown(), []);

  return { isLive, now, updateCursor, strokeStarted, strokeEnded, reset, ringRef, arcRef };
}
