import { batch, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useStrokes } from "../strokeStore";
import { strokesBounds } from "../utils";

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 10;
const FIT_PAD = 40; // padding when fitting view to content

type View = { panX: number; panY: number; zoom: number };

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

export function useCanvasView(panButton = 1) {
  const { strokes } = useStrokes();
  const svgRef = useRef<SVGSVGElement>(null);

  const panX = useSignal(0);
  const panY = useSignal(0);
  const zoom = useSignal(1);
  const transform = useComputed(
    () => `translate(${panX.value},${panY.value}) scale(${zoom.value})`,
  );

  function applyView(v: View) {
    // Batched so the transform recomputes once per gesture frame, not per axis.
    batch(() => {
      panX.value = v.panX;
      panY.value = v.panY;
      zoom.value = v.zoom;
    });
  }

  function pan(dx: number, dy: number) {
    applyView({ panX: panX.value + dx, panY: panY.value + dy, zoom: zoom.value });
  }

  const viewportRect = () => svgRef.current!.getBoundingClientRect();

  // Zoom about a screen point (client coords).
  function zoomAt(clientX: number, clientY: number, factor: number) {
    const rect = viewportRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const z = zoom.value;
    const newZoom = clampZoom(z * factor);
    const cx = (mx - panX.value) / z;
    const cy = (my - panY.value) / z;
    applyView({ panX: mx - cx * newZoom, panY: my - cy * newZoom, zoom: newZoom });
  }

  // Zoom to an absolute level about the viewport centre — used by the slider.
  function zoomTo(z: number) {
    const rect = viewportRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, clampZoom(z) / zoom.value);
  }

  function svgToContent(clientX: number, clientY: number): { x: number; y: number } {
    const rect = viewportRect();
    return {
      x: Math.round((clientX - rect.left - panX.value) / zoom.value),
      y: Math.round((clientY - rect.top - panY.value) / zoom.value),
    };
  }

  function fitToView() {
    const rect = viewportRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Read (not subscribed): fitToView only ever runs from an effect or a click.
    const b = strokesBounds(strokes.value);
    if (!b) {
      // Empty canvas: park the origin at the viewport centre at 1:1.
      applyView({ panX: rect.width / 2, panY: rect.height / 2, zoom: 1 });
      return;
    }
    const w = b.maxX - b.minX + 2 * FIT_PAD;
    const h = b.maxY - b.minY + 2 * FIT_PAD;
    const z = clampZoom(Math.min(rect.width / w, rect.height / h));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    applyView({ panX: rect.width / 2 - cx * z, panY: rect.height / 2 - cy * z, zoom: z });
  }

  // Mount: fit, and attach the camera input gestures — wheel to pan, ctrl+wheel
  // to zoom, and middle-mouse drag to pan. Owning the pan gesture here (rather
  // than in the drawing pointer handlers) keeps the camera fully self-contained.
  useEffect(() => {
    fitToView();
    const svg = svgRef.current!;

    let panning = false;
    let lastX = 0;
    let lastY = 0;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey) {
        zoomAt(e.clientX, e.clientY, Math.pow(1.001, -e.deltaY));
      } else {
        pan(-e.deltaX, -e.deltaY);
      }
    }
    function handlePointerDown(e: PointerEvent) {
      if (e.button !== panButton) return;
      svg.setPointerCapture(e.pointerId);
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
    function endPan() {
      panning = false;
    }

    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("pointerdown", handlePointerDown);
    svg.addEventListener("pointermove", handlePointerMove);
    svg.addEventListener("pointerup", endPan);
    svg.addEventListener("pointercancel", endPan);
    return () => {
      svg.removeEventListener("wheel", handleWheel);
      svg.removeEventListener("pointerdown", handlePointerDown);
      svg.removeEventListener("pointermove", handlePointerMove);
      svg.removeEventListener("pointerup", endPan);
      svg.removeEventListener("pointercancel", endPan);
    };
  }, []);

  return { svgRef, transform, fitToView, svgToContent, zoom, zoomTo };
}
