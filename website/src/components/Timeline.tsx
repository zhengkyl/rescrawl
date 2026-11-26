import { useApp } from "../context";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function Timeline() {
  const { clock } = useApp();
  const { seek, isPlaying } = clock;

  const elapsed = clock.elapsed.value;
  const duration = clock.duration.value;

  return (
    <div id="timeline">
      <button
        id="btn-play"
        disabled={duration <= 0}
        onClick={isPlaying ? clock.pause : clock.startPlayback}
        title={isPlaying ? "Pause" : "Replay"}
        aria-label={isPlaying ? "Pause" : "Replay"}
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          {isPlaying ? <path d="M1 0h3v10H1zM6 0h3v10H6z" /> : <path d="M1 0l9 5-9 5z" />}
        </svg>
      </button>
      <input
        class="scrub"
        type="range"
        min={0}
        max={duration}
        step="any"
        value={Math.min(elapsed, duration)}
        disabled={duration <= 0}
        onInput={(e) => seek(+(e.target as HTMLInputElement).value)}
        aria-label="Playhead"
        aria-valuetext={`${seconds(elapsed)} of ${seconds(duration)}`}
        // how much of the track is played, for style.css to fill
        style={{
          "--played": `${duration > 0 ? (100 * Math.min(elapsed, duration)) / duration : 0}%`,
        }}
      />
    </div>
  );
}
