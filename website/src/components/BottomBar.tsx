import { useApp } from '../context';

export function BottomBar() {
  const { replay, store, live } = useApp();
  const canPlay = store.strokes.length > 0;

  function handleClear() {
    if (!confirm('Clear all strokes?')) return;
    replay.stop();
    live.reset();
    store.clear();
  }

  return (
    <div id="bottom-bar">
      <button id="btn-play" disabled={!canPlay} onClick={replay.toggle}>{replay.isPlaying ? '⏸' : '▶'}</button>
      <input
        type="range"
        id="scrubber"
        min={0}
        max={replay.duration}
        value={replay.elapsed}
        step={1}
        disabled={!canPlay}
        onInput={(e) => replay.scrub(+(e.target as HTMLInputElement).value)}
      />
      <button id="btn-clear" disabled={replay.isPlaying} onClick={handleClear}>Clear</button>
    </div>
  );
}
