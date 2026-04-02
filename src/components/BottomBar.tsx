type Props = {
  isPlaying: boolean;
  replayElapsed: number;
  replayDuration: number;
  canPlay: boolean;
  onPlay: () => void;
  onScrub: (ms: number) => void;
  onClear: () => void;
};

export function BottomBar({ isPlaying, replayElapsed, replayDuration, canPlay, onPlay, onScrub, onClear }: Props) {
  return (
    <div id="bottom-bar">
      <button id="btn-play" disabled={!canPlay} onClick={onPlay}>{isPlaying ? '⏸' : '▶'}</button>
      <input
        type="range"
        id="scrubber"
        min={0}
        max={replayDuration}
        value={replayElapsed}
        step={1}
        disabled={!canPlay}
        onInput={(e) => onScrub(+(e.target as HTMLInputElement).value)}
      />
      <button id="btn-clear" disabled={isPlaying} onClick={onClear}>Clear</button>
    </div>
  );
}
