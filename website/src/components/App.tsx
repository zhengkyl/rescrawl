import { useEffect, useRef, useState } from 'preact/hooks';
import { AppContext } from '../context';
import type { ActiveStrategy, RenderedLine, StrategiesState } from '../curves';
import { getActiveStrategies, getDefaultStrategies, STRATEGY_DEFS } from '../curves';
import type { Config, Stroke } from '../utils';
import {
  compressText, decompressText,
  DEFAULT_CONFIG,
  deserialize,
  reframe,
  serialize, serializeBallpoint,
  strokesBounds,
} from '../utils';
import { BottomBar } from './BottomBar';
import { Controls } from './Controls';
import { CurvePanel } from './CurvePanel';
import { ExportDialog } from './ExportDialog';
import { SettingsDialog } from './SettingsDialog';
import { StrokeList } from './StrokeList';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const LINE_SPACING = 40;
const CANVAS_EXTENT = 100000; // half-size of the "infinite" background
const FIT_PAD = 40;           // padding when fitting view to content
const DEFAULT_EXPORT_PADDING = 40;
const LIVE_TIMEOUT = 2000;    // ms of idle after a stroke before live mode ends
const STAMINA_R = 11;         // stamina ring radius (px)
const STAMINA_C = 14;         // stamina ring svg center (px)
const STAMINA_SIZE = STAMINA_C * 2;
const STAMINA_OFFSET_X = 52;  // ring distance right of the cursor (px)
const STAMINA_OFFSET_Y = 52;  // ring distance above the cursor (px)
const STAMINA_EASE = 0.12;    // position smoothing per frame (lower = floatier)
const STAMINA_WINDOW = 1000;  // only show the ring during the last Nms of the countdown

export type Transforms = {
  strategies: StrategiesState;
};

const DEFAULT_TRANSFORMS: Transforms = {
  strategies: getDefaultStrategies(),
};

// --- Render helpers ---

// Prefix of a stroke drawn by `elapsed` (points are time-ordered).
function truncateStroke(stroke: Stroke, elapsed: number): Stroke {
  const out: Stroke = [];
  for (const pt of stroke) {
    if (pt.t > elapsed) break;
    out.push(pt);
  }
  return out;
}

// Remaining-fraction arc starting at the top, drawn clockwise — so as `frac`
// shrinks the trailing edge recedes counterclockwise (Zelda-style depletion).
function staminaArc(cx: number, cy: number, r: number, frac: number): string {
  frac = Math.max(0, Math.min(1, frac));
  if (frac >= 1) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`;
  }
  const ang = frac * 2 * Math.PI;
  const x1 = cx + r * Math.sin(ang);
  const y1 = cy - r * Math.cos(ang);
  const largeArc = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
}

// One renderer's output for one stroke, as SVG primitives.
function drawLine(line: RenderedLine, key: string | number, color: string) {
  if (line.shapes && line.shapes.length) {
    return line.shapes.map((d, j) => (
      <path key={`${key}-${j}`} d={d} fill={color} />
    ));
  }
  return (
    <path
      key={key}
      d={line.curve}
      stroke={color}
      stroke-width={line.width}
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  );
}

// --- Pure stroke mutation functions ---

function applyDraw(s: Stroke[], index: number, stroke: Stroke): Stroke[] {
  const next = [...s];
  next.splice(index, 0, stroke);
  return next;
}

function applyDelete(s: Stroke[], index: number): Stroke[] {
  const next = [...s];
  next.splice(index, 1);
  return next;
}

function applySwap(s: Stroke[], index: number): Stroke[] {
  const j = index + 1;
  if (j >= s.length) return s;
  const next = [...s];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

// Translate a whole stroke so its first point's `field` becomes `value`.
function applyEditFirst(s: Stroke[], index: number, field: 'x' | 'y' | 't', value: number): Stroke[] {
  const next = [...s];
  const delta = value - next[index][0][field];
  next[index] = next[index].map(pt => ({ ...pt, [field]: pt[field] + delta }));
  return next;
}

// --- History ---

type HistoryOp =
  | { type: 'draw'; index: number; stroke: Stroke }
  | { type: 'delete'; index: number; stroke: Stroke }
  | { type: 'swap'; index: number }
  | { type: 'edit'; index: number; field: 'x' | 'y' | 't'; from: number; to: number }
  | { type: 'bulk'; from: Stroke[]; to: Stroke[] };

function applyHistoryOp(s: Stroke[], op: HistoryOp, dir: 'undo' | 'redo'): Stroke[] {
  switch (op.type) {
    case 'draw': return dir === 'undo' ? applyDelete(s, op.index) : applyDraw(s, op.index, op.stroke);
    case 'delete': return dir === 'undo' ? applyDraw(s, op.index, op.stroke) : applyDelete(s, op.index);
    case 'swap': return applySwap(s, op.index);
    case 'edit': return applyEditFirst(s, op.index, op.field, dir === 'undo' ? op.from : op.to);
    case 'bulk': return dir === 'undo' ? op.from : op.to;
  }
}

// --- Component ---

export function App() {
  // --- Refs ---
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const livePathRef = useRef<SVGPathElement>(null);
  const viewRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const isPanningRef = useRef(false);
  const panLastRef = useRef({ x: 0, y: 0 });
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastAbsPtRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const livePointsRef = useRef<{ x: number; y: number }[]>([]);
  // Live recording clock: stroke timings only accumulate while "live" (drawing
  // plus a short grace period after each stroke).
  const liveBaseRef = useRef(0);                      // live ms banked from ended sessions
  const sessionStartRef = useRef<number | null>(null); // performance.now() of current session, or null
  const countdownStartRef = useRef(0);                 // performance.now() when the grace countdown began
  const staminaRafRef = useRef<number | null>(null);   // rAF id driving the countdown ring
  const cursorRef = useRef({ x: 0, y: 0 });            // latest pointer position (client coords)
  const staminaPosRef = useRef({ x: 0, y: 0 });        // eased ring position (client coords)
  const staminaRef = useRef<HTMLDivElement>(null);
  const staminaArcRef = useRef<SVGPathElement>(null);
  const rafRef = useRef<number | null>(null);
  const replayAbsRef = useRef<Stroke[]>([]);
  const replayDurRef = useRef(0);
  const replayElapsedRef = useRef(0);
  const strokesRef = useRef<Stroke[]>([]);

  // --- State ---
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedStroke, setSelectedStroke] = useState<number | null>(null);
  const [insertionPoint, setInsertionPoint] = useState(0);
  const [transforms, setTransforms] = useState<Transforms>(DEFAULT_TRANSFORMS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayElapsed, setReplayElapsed] = useState(0);
  const [replayDuration, setReplayDuration] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const [config, setConfig] = useState<Config>(() => ({
    ...DEFAULT_CONFIG,
    ...JSON.parse(localStorage.getItem('rescrawl-config') || '{}'),
  }));
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPadding, setExportPadding] = useState(DEFAULT_EXPORT_PADDING);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // --- History ---
  const historyRef = useRef<HistoryOp[]>([]);
  const historyIndexRef = useRef(-1);

  // Persist config
  useEffect(() => {
    localStorage.setItem('rescrawl-config', JSON.stringify(config));
  }, [config]);

  // Panel side class
  useEffect(() => {
    document.body.classList.toggle('panel-left', !config.sidebarRight);
  }, [config.sidebarRight]);

  // --- View (pan/zoom) ---

  function applyView(v: { panX: number; panY: number; zoom: number }) {
    viewRef.current = v;
    viewportRef.current?.setAttribute('transform', `translate(${v.panX},${v.panY}) scale(${v.zoom})`);
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
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(rect.width / w, rect.height / h)));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    applyView({ panX: rect.width / 2 - cx * zoom, panY: rect.height / 2 - cy * zoom, zoom });
  }

  // Mount: fit view, attach wheel listener
  useEffect(() => {
    fitToView();

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { panX, panY, zoom } = viewRef.current;
      const factor = Math.pow(1.001, -e.deltaY);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      const cx = (mx - panX) / zoom;
      const cy = (my - panY) / zoom;
      applyView({ panX: mx - cx * newZoom, panY: my - cy * newZoom, zoom: newZoom });
    }

    const svg = svgRef.current!;
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  // --- Coordinate helpers ---

  function svgToContent(e: PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    const { panX, panY, zoom } = viewRef.current;
    return {
      x: Math.round((e.clientX - rect.left - panX) / zoom),
      y: Math.round((e.clientY - rect.top - panY) / zoom),
    };
  }

  // --- Replay helpers ---

  function updateReplay(s = strokes) {
    replayAbsRef.current = s;
    const dur = s.reduce((m, st) => st.reduce((mm, pt) => Math.max(mm, pt.t), m), 0);
    // Keep the playhead pinned to the end while it's already there (e.g. after
    // drawing), so the time position tracks the latest content; a deliberate
    // mid-scrub position is left untouched.
    const followEnd = replayElapsedRef.current >= replayDurRef.current;
    replayDurRef.current = dur;
    setReplayDuration(dur);
    if (followEnd) {
      replayElapsedRef.current = dur;
      setReplayElapsed(dur);
    }
  }

  // --- Commit helper ---

  function commit(next: Stroke[], ip: number, sel: number | null = null) {
    strokesRef.current = next;
    setStrokes(next);
    setInsertionPoint(ip);
    setSelectedStroke(sel);
    updateReplay(next);
  }

  function pushHistory(op: HistoryOp) {
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(op);
    historyIndexRef.current++;
    setCanUndo(true);
    setCanRedo(false);
  }

  const undoRef = useRef<() => void>(() => { });
  const redoRef = useRef<() => void>(() => { });

  undoRef.current = function undo() {
    if (historyIndexRef.current < 0) return;
    const op = historyRef.current[historyIndexRef.current];
    historyIndexRef.current--;
    const next = applyHistoryOp(strokesRef.current, op, 'undo');
    strokesRef.current = next;
    const ip = Math.min(insertionPoint, next.length);
    setStrokes(next);
    setInsertionPoint(ip);
    setSelectedStroke(null);
    updateReplay(next);
    setCanUndo(historyIndexRef.current >= 0);
    setCanRedo(true);
  };

  redoRef.current = function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const op = historyRef.current[historyIndexRef.current];
    const prevLength = strokesRef.current.length;
    const next = applyHistoryOp(strokesRef.current, op, 'redo');
    strokesRef.current = next;
    const ip = (op.type === 'draw' && insertionPoint === prevLength)
      ? next.length
      : Math.min(insertionPoint, next.length);
    setStrokes(next);
    setInsertionPoint(ip);
    setSelectedStroke(null);
    updateReplay(next);
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); undoRef.current(); }
      else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redoRef.current(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Replay ---

  function startReplay() {
    if (replayElapsedRef.current >= replayDurRef.current) replayElapsedRef.current = 0;
    const frameStart = performance.now() - replayElapsedRef.current;

    function frame(now: number) {
      const elapsed = Math.min(now - frameStart, replayDurRef.current);
      replayElapsedRef.current = elapsed;
      setReplayElapsed(elapsed);
      if (elapsed < replayDurRef.current) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
        setIsPlaying(false);
        setIsReplaying(false);
      }
    }
    setIsReplaying(true);
    rafRef.current = requestAnimationFrame(frame);
    setIsPlaying(true);
  }

  function pauseReplay() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setIsPlaying(false);
  }

  function stopReplay() {
    pauseReplay();
    replayElapsedRef.current = 0;
    setReplayElapsed(0);
    setIsReplaying(false);
  }

  function scrubTo(ms: number) {
    pauseReplay();
    replayElapsedRef.current = ms;
    setReplayElapsed(ms);
    setIsReplaying(true);
  }

  function togglePlay() {
    if (rafRef.current) pauseReplay();
    else startReplay();
  }

  // --- Live recording clock ---

  // Live-elapsed ms right now (banked sessions + the running one, if any).
  function liveNow() {
    const running = sessionStartRef.current !== null ? performance.now() - sessionStartRef.current : 0;
    return Math.round(liveBaseRef.current + running);
  }

  function cancelCountdown() {
    if (staminaRafRef.current !== null) { cancelAnimationFrame(staminaRafRef.current); staminaRafRef.current = null; }
    if (staminaRef.current) staminaRef.current.style.opacity = '0';
  }

  // A stroke started: (re)enter live mode and cancel any pending countdown.
  function enterLive() {
    cancelCountdown();
    if (sessionStartRef.current === null) sessionStartRef.current = performance.now();
    setIsLive(true);
  }

  // Freeze the live clock and leave live mode.
  function endLive() {
    if (sessionStartRef.current !== null) {
      liveBaseRef.current += performance.now() - sessionStartRef.current;
      sessionStartRef.current = null;
    }
    cancelCountdown();
    setIsLive(false);
  }

  // Drive the floating stamina ring; ends live mode when the countdown empties.
  // The ring only appears for the final STAMINA_WINDOW ms, easing toward the
  // cursor so it floats and trails behind.
  function staminaFrame(now: number) {
    const remaining = LIVE_TIMEOUT - (now - countdownStartRef.current);
    if (remaining <= 0) { staminaRafRef.current = null; endLive(); return; }

    const targetX = cursorRef.current.x + STAMINA_OFFSET_X;
    const targetY = cursorRef.current.y - STAMINA_OFFSET_Y;
    const show = remaining <= STAMINA_WINDOW;
    const pos = staminaPosRef.current;
    if (show) {
      pos.x += (targetX - pos.x) * STAMINA_EASE;
      pos.y += (targetY - pos.y) * STAMINA_EASE;
    } else {
      pos.x = targetX; pos.y = targetY; // park at the cursor while hidden
    }

    const el = staminaRef.current;
    if (el) {
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.style.opacity = show ? '1' : '0';
    }
    if (show) {
      staminaArcRef.current?.setAttribute('d', staminaArc(STAMINA_C, STAMINA_C, STAMINA_R, remaining / STAMINA_WINDOW));
    }
    staminaRafRef.current = requestAnimationFrame(staminaFrame);
  }

  // A stroke ended: start the grace countdown unless drawing resumes.
  function scheduleEndLive() {
    countdownStartRef.current = performance.now();
    staminaPosRef.current = { x: cursorRef.current.x + STAMINA_OFFSET_X, y: cursorRef.current.y - STAMINA_OFFSET_Y };
    if (staminaRafRef.current === null) staminaRafRef.current = requestAnimationFrame(staminaFrame);
  }

  // Reset the clock (e.g. on clear) or seed it (e.g. continuing an import).
  function resetLive(base = 0) {
    cancelCountdown();
    liveBaseRef.current = base;
    sessionStartRef.current = null;
    setIsLive(false);
  }

  useEffect(() => () => cancelCountdown(), []);

  // --- Pointer events ---

  function handlePointerDown(e: PointerEvent) {
    cursorRef.current = { x: e.clientX, y: e.clientY };
    if (e.button === 1) {
      svgRef.current!.setPointerCapture(e.pointerId);
      isPanningRef.current = true;
      panLastRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    if (rafRef.current !== null) return;

    svgRef.current!.setPointerCapture(e.pointerId);
    const contentPt = svgToContent(e);

    enterLive();
    const t = liveNow();

    currentStrokeRef.current = [{
      x: contentPt.x,
      y: contentPt.y,
      t,
      p: Math.round(e.pressure * 8192),
    }];
    lastAbsPtRef.current = { x: contentPt.x, y: contentPt.y, t };
    livePointsRef.current = [{ x: contentPt.x, y: contentPt.y }];
    if (livePathRef.current) livePathRef.current.setAttribute('d', '');
  }

  function handlePointerMove(e: PointerEvent) {
    cursorRef.current = { x: e.clientX, y: e.clientY };
    if (isPanningRef.current) {
      const dx = e.clientX - panLastRef.current.x;
      const dy = e.clientY - panLastRef.current.y;
      panLastRef.current = { x: e.clientX, y: e.clientY };
      const { panX, panY, zoom } = viewRef.current;
      applyView({ panX: panX + dx, panY: panY + dy, zoom });
      return;
    }
    if (currentStrokeRef.current === null) return;

    const contentPt = svgToContent(e);
    const last = lastAbsPtRef.current!;
    const dx = contentPt.x - last.x;
    const dy = contentPt.y - last.y;
    if (dx === 0 && dy === 0) return;

    const t = liveNow();
    currentStrokeRef.current.push({
      x: contentPt.x,
      y: contentPt.y,
      t,
      p: Math.round(e.pressure * 8192),
    });
    lastAbsPtRef.current = { x: contentPt.x, y: contentPt.y, t };

    livePointsRef.current.push({ x: contentPt.x, y: contentPt.y });
    const pts = livePointsRef.current;
    if (livePathRef.current && pts.length >= 2) {
      livePathRef.current.setAttribute('d', 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L '));
    }
  }

  function commitStroke() {
    if (currentStrokeRef.current === null) return;
    const stroke = currentStrokeRef.current;
    const k = insertionPoint;
    currentStrokeRef.current = null;
    lastAbsPtRef.current = null;
    livePointsRef.current = [];
    if (livePathRef.current) livePathRef.current.setAttribute('d', '');
    const next = applyDraw(strokes, k, stroke);
    pushHistory({ type: 'draw', index: k, stroke });
    commit(next, k + 1, selectedStroke);
    scheduleEndLive();
  }

  function handlePointerUp(e: PointerEvent) {
    if (isPanningRef.current) { isPanningRef.current = false; return; }
    commitStroke();
  }
  function handlePointerCancel() {
    isPanningRef.current = false;
    commitStroke();
  }

  // --- Stroke operations ---

  function deleteStroke(i: number) {
    const stroke = strokes[i];
    const next = applyDelete(strokes, i);
    const newIp = insertionPoint > i ? insertionPoint - 1 : insertionPoint;
    pushHistory({ type: 'delete', index: i, stroke });
    commit(next, newIp);
  }

  function swapStrokes(i: number) {
    if (i + 1 >= strokes.length) return;
    const next = applySwap(strokes, i);
    pushHistory({ type: 'swap', index: i });
    commit(next, insertionPoint, selectedStroke);
  }

  function editFirstPoint(i: number, field: 'x' | 'y' | 't', value: number) {
    const from = strokes[i][0][field];
    const next = applyEditFirst(strokes, i, field, value);
    pushHistory({ type: 'edit', index: i, field, from, to: value });
    commit(next, insertionPoint, selectedStroke);
  }

  // --- Transforms ---

  function handleTransformsChange(next: Transforms) {
    setTransforms(next);
  }

  function handleClear() {
    if (!confirm('Clear all strokes?')) return;
    stopReplay();
    resetLive();
    pushHistory({ type: 'bulk', from: strokes, to: [] });
    commit([], 0);
  }

  async function handleImport(file: File) {
    const raw = await file.text();
    const text = file.name.endsWith('.gz') ? await decompressText(raw) : raw;
    stopReplay();
    const imported = deserialize(text);
    const lastT = imported.reduce((m, st) => st.reduce((mm, pt) => Math.max(mm, pt.t), m), 0);
    resetLive(lastT); // continue the live clock from the imported end
    pushHistory({ type: 'bulk', from: strokes, to: imported });
    setTransforms({ ...DEFAULT_TRANSFORMS });
    commit(imported, imported.length, null);
  }

  async function handleExport(filename: string, gzip: boolean, ballpoint: boolean) {
    const effective = reframe(strokes, exportPadding);
    const text = ballpoint ? serializeBallpoint(effective) : serialize(effective);
    const content = gzip ? await compressText(text) : text;
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename + (gzip ? '.scrawl.gz' : '.scrawl');
    a.click();
    URL.revokeObjectURL(a.href);
    setExportOpen(false);
  }

  // --- Derived render data ---

  const activeStrategies = getActiveStrategies(transforms.strategies);

  // Strokes to draw: full when static, truncated to the scrub position on replay.
  const renderStrokes = isReplaying
    ? replayAbsRef.current.map(s => truncateStroke(s, replayElapsed)).filter(s => s.length > 0)
    : strokes;

  // Primary strategy for selected highlight (first active, fallback to polyline)
  const primaryStrategy: ActiveStrategy = activeStrategies[0] ?? { def: STRATEGY_DEFS[0], param: 0 };

  // Export frame preview: content bounds expanded by the padding.
  const exportBounds = exportOpen ? strokesBounds(strokes) : null;

  // Insertion crosshair position — start of the stroke at the insertion point
  const crosshairPos = insertionPoint < strokes.length
    ? strokes[insertionPoint][0]
    : null;

  return (
    <AppContext.Provider value={{
      strokes, selectedStroke, insertionPoint,
      setSelectedStroke: (i) => setSelectedStroke(i),
      setInsertionPoint: (i) => setInsertionPoint(i),
      deleteStroke,
      swapStrokes,
      editFirstPoint,
    }}>
      <div id="main-area">
        <div id="canvas-wrapper">
          {isLive && (
            <div id="rec-indicator" title="Recording — timings are live">
              <span class="rec-dot" />REC
            </div>
          )}
          {/* Floating stamina ring — depletes over the live-mode countdown */}
          <div id="stamina" ref={staminaRef}>
            <svg width={STAMINA_SIZE} height={STAMINA_SIZE} viewBox={`0 0 ${STAMINA_SIZE} ${STAMINA_SIZE}`}>
              <circle cx={STAMINA_C} cy={STAMINA_C} r={STAMINA_R} fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="3" />
              <path ref={staminaArcRef} fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" />
            </svg>
          </div>
          <div id="floating-toolbar">
            <button id="btn-undo" disabled={!canUndo} onClick={() => undoRef.current()} title="Undo (Ctrl+Z)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button id="btn-redo" disabled={!canRedo} onClick={() => redoRef.current()} title="Redo (Ctrl+Y)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </svg>
            </button>
            <button id="btn-reset-view" onClick={fitToView} title="Reset view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
            </button>
          </div>
          <div id="canvas-area">
            <svg
              ref={svgRef}
              id="canvas-svg"
              class={isLive ? 'live' : ''}
              onPointerDown={handlePointerDown as any}
              onPointerMove={handlePointerMove as any}
              onPointerUp={handlePointerUp as any}
              onPointerCancel={handlePointerCancel}
              onContextMenu={(e) => e.preventDefault()}
            >
              <defs>
                {/* Infinitely tiling ruled guidelines */}
                <pattern id="guidelines" width={LINE_SPACING} height={LINE_SPACING} patternUnits="userSpaceOnUse">
                  <line x1="0" y1={LINE_SPACING} x2={LINE_SPACING} y2={LINE_SPACING} stroke="#c8d8f0" stroke-width="1" />
                </pattern>
              </defs>
              <g ref={viewportRef}>
                {/* Infinite canvas background */}
                <rect x={-CANVAS_EXTENT} y={-CANVAS_EXTENT} width={2 * CANVAS_EXTENT} height={2 * CANVAS_EXTENT} fill="white" />
                {config.guidelines && (
                  <rect x={-CANVAS_EXTENT} y={-CANVAS_EXTENT} width={2 * CANVAS_EXTENT} height={2 * CANVAS_EXTENT} fill="url(#guidelines)" />
                )}

                {/* Committed strokes — one renderer per active strategy, each
                    stroke drawn uniformly (filled shapes or stroked curve) */}
                {activeStrategies.map(({ def, param }) => {
                  const color = def.id === 'polyline' ? '#000' : def.color;
                  return (
                    <g key={def.id}>
                      {renderStrokes.map((stroke, i) => drawLine(def.render(stroke, param), i, color))}
                    </g>
                  );
                })}

                {/* Selected stroke highlight */}
                {!isReplaying && selectedStroke !== null && strokes[selectedStroke] && (
                  <g>{drawLine(primaryStrategy.def.render(strokes[selectedStroke], primaryStrategy.param), 'sel', '#4f8ef7')}</g>
                )}

                {/* Live stroke — updated directly via ref */}
                <path
                  ref={livePathRef}
                  stroke="#000"
                  stroke-width="2"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />

                {/* Export frame preview — used bounds + padding */}
                {exportBounds && (
                  <rect
                    x={exportBounds.minX - exportPadding}
                    y={exportBounds.minY - exportPadding}
                    width={exportBounds.maxX - exportBounds.minX + 2 * exportPadding}
                    height={exportBounds.maxY - exportBounds.minY + 2 * exportPadding}
                    fill="none"
                    stroke="#4f8ef7"
                    stroke-width="1.5"
                    stroke-dasharray="6 4"
                    vector-effect="non-scaling-stroke"
                  />
                )}

                {/* Insertion crosshair */}
                {crosshairPos && (
                  <g>
                    <line
                      x1={crosshairPos.x - 12} y1={crosshairPos.y}
                      x2={crosshairPos.x + 12} y2={crosshairPos.y}
                      stroke="#4f8ef7" stroke-width="1.5" stroke-dasharray="3 3"
                    />
                    <line
                      x1={crosshairPos.x} y1={crosshairPos.y - 12}
                      x2={crosshairPos.x} y2={crosshairPos.y + 12}
                      stroke="#4f8ef7" stroke-width="1.5" stroke-dasharray="3 3"
                    />
                  </g>
                )}
              </g>
            </svg>
          </div>
        </div>
        <BottomBar
          isPlaying={isPlaying}
          replayElapsed={replayElapsed}
          replayDuration={replayDuration}
          canPlay={strokes.length > 0}
          onPlay={togglePlay}
          onScrub={scrubTo}
          onClear={handleClear}
        />
      </div>
      <div id="panel">
        <Controls
          guidelines={config.guidelines}
          onGuidelinesChange={(v) => setConfig(c => ({ ...c, guidelines: v }))}
          hasStrokes={strokes.length > 0}
          onImport={handleImport}
          onExportOpen={() => setExportOpen(true)}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
        <div id="curve-panel">
          <CurvePanel
            strategies={transforms.strategies}
            onChange={(s) => handleTransformsChange({ ...transforms, strategies: s })}
          />
        </div>
        <StrokeList />
      </div>
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onExport={handleExport}
        padding={exportPadding}
        onPaddingChange={setExportPadding}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sidebarRight={config.sidebarRight}
        onSidebarRightChange={(v) => setConfig(c => ({ ...c, sidebarRight: v }))}
        onReset={() => setConfig({ ...DEFAULT_CONFIG })}
      />
    </AppContext.Provider>
  );
}
