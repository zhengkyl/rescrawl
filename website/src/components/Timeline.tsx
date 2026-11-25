import { useRef } from "preact/hooks";
import { useApp } from "../context";

export function Timeline() {
  const { clock } = useApp();
  const { seek, isPlaying, isRecording } = clock;
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const elapsed = clock.elapsed.value;
  const duration = Math.max(clock.duration.value, elapsed);
  const frac = duration > 0 ? elapsed / duration : 0;

  function seekFromEvent(e: PointerEvent) {
    const rect = trackRef.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(f * clock.duration.value);
  }

  return (
    <div id="timeline" class={isRecording ? "live" : ""}>
      <button
        id="btn-play"
        disabled={clock.duration.value <= 0 || isRecording}
        onClick={isPlaying ? clock.pause : clock.startPlayback}
        title={isPlaying ? "Pause" : "Replay"}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          {isPlaying ? <path d="M1 0h3v10H1zM6 0h3v10H6z" /> : <path d="M1 0l9 5-9 5z" />}
        </svg>
      </button>
      <div
        class="track"
        ref={trackRef}
        onPointerDown={(e) => {
          if (isRecording || clock.duration.value <= 0) return;
          draggingRef.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => draggingRef.current && seekFromEvent(e)}
        onPointerUp={() => (draggingRef.current = false)}
        onPointerCancel={() => (draggingRef.current = false)}
      >
        <div class="played" style={{ width: `${frac * 100}%` }} />
        <div class="head" style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
