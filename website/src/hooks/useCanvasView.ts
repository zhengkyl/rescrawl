import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { Stroke } from '../utils';
import { strokesBounds } from '../utils';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const FIT_PAD = 40; // padding when fitting view to content

type View = { panX: number; panY: number; zoom: number };

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

// Owns the pan/zoom camera: keeps the live transform on the viewport <g>,
// converts screen→content coordinates, and fits content to the viewport.
export function useCanvasView(svgRef: RefObject<SVGSVGElement>, strokes: Stroke[]) {
  const viewportRef = useRef<SVGGElement>(null);
  const viewRef = useRef<View>({ panX: 0, panY: 0, zoom: 1 });

  function applyView(v: View) {
    viewRef.current = v;
    viewportRef.current?.setAttribute('transform', `translate(${v.panX},${v.panY}) scale(${v.zoom})`);
  }

  function pan(dx: number, dy: number) {
    const { panX, panY, zoom } = viewRef.current;
    applyView({ panX: panX + dx, panY: panY + dy, zoom });
  }

  // Zoom about a screen point (client coords).
  function zoomAt(clientX: number, clientY: number, factor: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const { panX, panY, zoom } = viewRef.current;
    const newZoom = clampZoom(zoom * factor);
    const cx = (mx - panX) / zoom;
    const cy = (my - panY) / zoom;
    applyView({ panX: mx - cx * newZoom, panY: my - cy * newZoom, zoom: newZoom });
  }

  function svgToContent(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    const { panX, panY, zoom } = viewRef.current;
    return {
      x: Math.round((clientX - rect.left - panX) / zoom),
      y: Math.round((clientY - rect.top - panY) / zoom),
    };
  }

  function fitToView() {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const b = strokesBounds(strokes);
    if (!b) {
      // Empty canvas: park the origin at the viewport centre at 1:1.
      applyView({ panX: rect.width / 2, panY: rect.height / 2, zoom: 1 });
      return;
    }
    const w = (b.maxX - b.minX) + 2 * FIT_PAD;
    const h = (b.maxY - b.minY) + 2 * FIT_PAD;
    const zoom = clampZoom(Math.min(rect.width / w, rect.height / h));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    applyView({ panX: rect.width / 2 - cx * zoom, panY: rect.height / 2 - cy * zoom, zoom });
  }

  // Mount: fit, and attach a non-passive wheel listener for zoom.
  useEffect(() => {
    fitToView();
    const svg = svgRef.current;
    if (!svg) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.pow(1.001, -e.deltaY));
    }
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { viewportRef, fitToView, svgToContent, pan };
}
