import { useEffect, useRef, useState } from 'preact/hooks';
import type { Stroke } from '../utils';
import { strokesBounds } from '../utils';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 10;
const FIT_PAD = 40; // padding when fitting view to content

type View = { panX: number; panY: number; zoom: number };

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

// Owns the pan/zoom camera: keeps the live transform on the viewport <g>,
// converts screen→content coordinates, and fits content to the viewport.
// `panButton` selects which pointer button drags to pan (default middle, so the
// main canvas keeps the left button free for drawing; a preview can pass 0).
export function useCanvasView(strokes: Stroke[], panButton = 1) {

  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);

  const viewRef = useRef<View>({ panX: 0, panY: 0, zoom: 1 });

  // Mirror the zoom for the UI (slider + readout). The transform is applied
  // imperatively for perf; this state only changes when zoom does — panning
  // calls setZoom with the same value, which React bails out of, so the frequent
  // pan path stays render-free.
  const [zoom, setZoom] = useState(1);

  function applyView(v: View) {
    viewRef.current = v;
    viewportRef.current?.setAttribute('transform', `translate(${v.panX},${v.panY}) scale(${v.zoom})`);
    setZoom(v.zoom);
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

  // Zoom to an absolute level about the viewport centre — used by the slider.
  function zoomTo(z: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, clampZoom(z) / viewRef.current.zoom);
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

  // Mount: fit, and attach the camera input gestures — wheel to pan, ctrl+wheel
  // to zoom, and middle-mouse drag to pan. Owning the pan gesture here (rather
  // than in the drawing pointer handlers) keeps the camera fully self-contained.
  useEffect(() => {
    fitToView();
    const svg = svgRef.current;
    if (!svg) return;

    let panning = false;
    let lastX = 0;
    let lastY = 0;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      // Ctrl+wheel zooms about the cursor (also the trackpad pinch gesture, which
      // browsers report as a ctrl-wheel); a plain wheel pans. Scrolling down moves
      // the content up, matching normal document scrolling.
      if (e.ctrlKey) zoomAt(e.clientX, e.clientY, Math.pow(1.001, -e.deltaY));
      else pan(-e.deltaX, -e.deltaY);
    }
    function handlePointerDown(e: PointerEvent) {
      if (e.button !== panButton) return;
      svg!.setPointerCapture(e.pointerId);
      panning = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function handlePointerMove(e: PointerEvent) {
      if (!panning) return;
      pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function endPan() { panning = false; }

    svg.addEventListener('wheel', handleWheel, { passive: false });
    svg.addEventListener('pointerdown', handlePointerDown);
    svg.addEventListener('pointermove', handlePointerMove);
    svg.addEventListener('pointerup', endPan);
    svg.addEventListener('pointercancel', endPan);
    return () => {
      svg.removeEventListener('wheel', handleWheel);
      svg.removeEventListener('pointerdown', handlePointerDown);
      svg.removeEventListener('pointermove', handlePointerMove);
      svg.removeEventListener('pointerup', endPan);
      svg.removeEventListener('pointercancel', endPan);
    };
  }, []);

  return { svgRef, viewportRef, fitToView, svgToContent, zoom, zoomTo };
}
