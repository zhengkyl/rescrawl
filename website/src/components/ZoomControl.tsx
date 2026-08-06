import { useApp } from '../context';
import { MAX_ZOOM, MIN_ZOOM } from '../hooks/useCanvasView';

export function ZoomControl() {
  const { view } = useApp();

  return (
    <div id="zoom-control">
      <input
        type="range"
        min={Math.log(MIN_ZOOM)}
        max={Math.log(MAX_ZOOM)}
        step="any"
        value={Math.log(view.zoom.value)}
        onInput={(e) => view.zoomTo(Math.exp(+(e.currentTarget as HTMLInputElement).value))}
        title="Zoom (Ctrl+scroll)"
      />
      <span class="zoom-level" title="Reset to 100%" onClick={() => view.zoomTo(1)}>
        {Math.round(view.zoom.value * 100)}%
      </span>
    </div>
  );
}
