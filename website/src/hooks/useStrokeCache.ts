import { useRef } from 'preact/hooks';
import type { RenderedLine } from '../curves';
import type { Stroke } from '../utils';

// Per-stroke cache of fully-drawn geometry. A committed stroke's geometry is
// fixed until the stroke is edited (which produces a new array — the store reuses
// refs for untouched strokes), so we key by stroke identity in a WeakMap and only
// recompute on a miss. The inner Map keys by a `variant` string so one stroke can
// hold several renders (e.g. one per active reference strategy). The whole cache
// is dropped when `rev` changes — pass whatever the geometry depends on (ink
// options for the ink layer, the active strategies for overlays).
//
// This collapses the per-replay-frame cost from "render every stroke" to "render
// only the 0–1 strokes straddling the playhead"; fully-drawn strokes hit the
// cache and not-yet-started ones are culled by the caller.
export function useStrokeCache(rev: unknown) {
  const cacheRef = useRef<WeakMap<Stroke, Map<string, RenderedLine>>>(new WeakMap());
  const revRef = useRef(rev);

  if (revRef.current !== rev) {
    cacheRef.current = new WeakMap();
    revRef.current = rev;
  }

  // Stable across renders (it reads live state through refs) so it can sit in a
  // memo's deps without busting it every frame.
  const apiRef = useRef<{ get: (s: Stroke, variant: string, compute: () => RenderedLine) => RenderedLine } | null>(null);
  if (!apiRef.current) {
    apiRef.current = {
      get(stroke, variant, compute) {
        let byVariant = cacheRef.current.get(stroke);
        if (!byVariant) { byVariant = new Map(); cacheRef.current.set(stroke, byVariant); }
        let line = byVariant.get(variant);
        if (line === undefined) { line = compute(); byVariant.set(variant, line); }
        return line;
      },
    };
  }

  return apiRef.current;
}
