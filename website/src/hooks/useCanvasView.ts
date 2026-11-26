import { batch, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useStrokes } from "../strokeStore";
import { type Stroke, strokesBounds } from "../stroke";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const FIT_PAD = 40; // padding when fitting view to content
const ANIMATE_MS = 300;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

type View = { panX: number; panY: number; zoom: number };

// a text field takes a space as a space
const TYPING =
  'input:not([type="range"], [type="checkbox"], [type="color"]), textarea, [contenteditable]';

// Safari's own pinch events; `scale` is since the gesture began
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

export function useCanvasView() {
  const { strokes } = useStrokes();
  const svgRef = useRef<SVGSVGElement>(null);
  // Space held: a mouse or pen drag pans instead of drawing
  const spaceRef = useRef(false);

  const panX = useSignal(0);
  const panY = useSignal(0);
  const zoom = useSignal(1);
  const transform = useComputed(
    () => `translate(${panX.value},${panY.value}) scale(${zoom.value})`,
  );

  const animRef = useRef<number | null>(null);

  function stopAnimation() {
    if (animRef.current === null) return;
    cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }

  // anything the user does to the view stops an animation
  function applyView(v: View) {
    stopAnimation();
    setView(v);
  }

  function setView(v: View) {
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

  // Zoom eases geometrically and the content point at the viewport's center moves in a
  // line, so a zoom out and back in doesn't swing past either end.
  function animateTo(to: View) {
    const rect = viewportRect();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyView(to);
      return;
    }
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const z0 = zoom.value;
    const c0x = (mx - panX.value) / z0;
    const c0y = (my - panY.value) / z0;
    const c1x = (mx - to.panX) / to.zoom;
    const c1y = (my - to.panY) / to.zoom;
    applyView({ panX: panX.value, panY: panY.value, zoom: z0 });
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATE_MS);
      const e = easeInOutCubic(t);
      const z = z0 * (to.zoom / z0) ** e;
      const cx = c0x + (c1x - c0x) * e;
      const cy = c0y + (c1y - c0y) * e;
      setView({ panX: mx - cx * z, panY: my - cy * z, zoom: z });
      animRef.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    animRef.current = requestAnimationFrame(frame);
  }

  // about the viewport's center
  function zoomTo(z: number) {
    const rect = viewportRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const next = clampZoom(z);
    const cx = (mx - panX.value) / zoom.value;
    const cy = (my - panY.value) / zoom.value;
    animateTo({ panX: mx - cx * next, panY: my - cy * next, zoom: next });
  }

  function svgToContent(clientX: number, clientY: number): { x: number; y: number } {
    const rect = viewportRect();
    return {
      x: (clientX - rect.left - panX.value) / zoom.value,
      y: (clientY - rect.top - panY.value) / zoom.value,
    };
  }

  // all of them in view, centered; none: the origin centered at 100%
  function fitView(list: Stroke[]): View | null {
    const rect = viewportRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const b = strokesBounds(list);
    if (!b) return { panX: rect.width / 2, panY: rect.height / 2, zoom: 1 };
    const w = b.maxX - b.minX + 2 * FIT_PAD;
    const h = b.maxY - b.minY + 2 * FIT_PAD;
    const z = clampZoom(Math.min(rect.width / w, rect.height / h));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return { panX: rect.width / 2 - cx * z, panY: rect.height / 2 - cy * z, zoom: z };
  }

  function fitStrokes(list: Stroke[]) {
    const v = fitView(list);
    if (v !== null) animateTo(v);
  }

  function fitToView() {
    fitStrokes(strokes.value);
  }

  useEffect(() => {
    const first = fitView(strokes.value);
    if (first !== null) applyView(first);
    const svg = svgRef.current!;

    let panning = false;
    let lastX = 0;
    let lastY = 0;
    // fingers down: their pinch is the canvas's, so only a trackpad's is handled here
    let touches = 0;
    let lastScale = 1;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? rect().height
            : 1;
      if (e.ctrlKey) {
        zoomAt(e.clientX, e.clientY, 1.001 ** (-e.deltaY * unit));
      } else {
        pan(-e.deltaX * unit, -e.deltaY * unit);
      }
    }
    const rect = () => svg.getBoundingClientRect();
    function handleGestureStart(e: Event) {
      e.preventDefault();
      lastScale = 1;
    }
    function handleGestureChange(e: Event) {
      e.preventDefault();
      const g = e as GestureEvent;
      if (touches === 0) zoomAt(g.clientX, g.clientY, g.scale / lastScale);
      lastScale = g.scale;
    }
    function countTouch(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      touches = Math.max(0, touches + (e.type === "pointerdown" ? 1 : -1));
    }
    function hand() {
      svg.dataset.hand = panning ? "grabbing" : spaceRef.current ? "grab" : "";
    }
    // A button focused by a click would take Space as a press; one reached by keyboard keeps it.
    function takesSpace(e: KeyboardEvent): boolean {
      const el = e.target as Element;
      if (el.closest?.(TYPING)) return false;
      return el === document.body || !el.matches(":focus-visible");
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || !takesSpace(e)) return;
      e.preventDefault();
      spaceRef.current = true;
      hand();
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space" || !spaceRef.current) return;
      e.preventDefault();
      spaceRef.current = false;
      hand();
    }
    function handleBlur() {
      spaceRef.current = false;
      hand();
    }
    // A middle press starts the browser's autoscroll, badge and all, off mousedown; it pans here.
    function handleMouseDown(e: MouseEvent) {
      if (e.button === 1) e.preventDefault();
    }
    function handlePointerDown(e: PointerEvent) {
      // the view holds still under a stroke or gesture starting
      stopAnimation();
      countTouch(e);
      const spaceDrag = e.button === 0 && spaceRef.current && e.pointerType !== "touch";
      if (e.button !== 1 && !spaceDrag) return;
      svg.setPointerCapture(e.pointerId);
      panning = true;
      hand();
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function handlePointerMove(e: PointerEvent) {
      if (!panning) return;
      pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function endPan(e: PointerEvent) {
      countTouch(e);
      panning = false;
      hand();
    }

    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("mousedown", handleMouseDown);
    svg.addEventListener("pointerdown", handlePointerDown);
    svg.addEventListener("pointermove", handlePointerMove);
    svg.addEventListener("pointerup", endPan);
    svg.addEventListener("pointercancel", endPan);
    svg.addEventListener("gesturestart", handleGestureStart);
    svg.addEventListener("gesturechange", handleGestureChange);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      stopAnimation();
      svg.removeEventListener("wheel", handleWheel);
      svg.removeEventListener("mousedown", handleMouseDown);
      svg.removeEventListener("pointerdown", handlePointerDown);
      svg.removeEventListener("pointermove", handlePointerMove);
      svg.removeEventListener("pointerup", endPan);
      svg.removeEventListener("pointercancel", endPan);
      svg.removeEventListener("gesturestart", handleGestureStart);
      svg.removeEventListener("gesturechange", handleGestureChange);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const spaceHeld = () => spaceRef.current;

  return {
    svgRef,
    transform,
    fitToView,
    fitStrokes,
    svgToContent,
    zoom,
    zoomTo,
    zoomAt,
    pan,
    spaceHeld,
  };
}
