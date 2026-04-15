import { useState, useEffect, useRef } from 'preact/hooks';
import {
  DEFAULT_CONFIG,
  toAbsolute, getInsertionAbs,
  serialize, serializeBallpoint, deserialize, compressText, decompressText,
  getEffectiveStrokes, alignApply,
} from '../utils';
import type { Stroke, AbsStroke, Config } from '../utils';
import { AppContext } from '../context';
import {
  clearCanvas, drawAllStrokes, drawDot, drawPath,
  drawInsertionCrosshair, renderHighlight, drawUpTo,
} from '../draw';
import { BottomBar } from './BottomBar';
import { Controls } from './Controls';
import { StrokeList } from './StrokeList';
import { ExportDialog } from './ExportDialog';
import { SettingsDialog } from './SettingsDialog';

export type Transforms = {
  smooth: boolean;
  smoothPasses: number;
  capDt: boolean;
  capDtMax: number;
  align: boolean;
  padX: number;
  padY: number;
};

const DEFAULT_TRANSFORMS: Transforms = {
  smooth: false, smoothPasses: 3,
  capDt: false, capDtMax: 2000,
  align: false, padX: 40, padY: 40,
};

// --- Pure stroke mutation functions ---

function applyDraw(s: Stroke[], index: number, stroke: Stroke): Stroke[] {
  const next = [...s];
  next.splice(index, 0, stroke);
  if (index + 1 < next.length) {
    let sumDx = 0, sumDy = 0;
    for (const { dx, dy } of stroke) { sumDx += dx; sumDy += dy; }
    next[index + 1] = [{ ...next[index + 1][0], dx: next[index + 1][0].dx - sumDx, dy: next[index + 1][0].dy - sumDy }, ...next[index + 1].slice(1)];
  }
  return next;
}

function applyDelete(s: Stroke[], index: number): Stroke[] {
  const next = [...s];
  if (index + 1 < next.length) {
    let sumDx = 0, sumDy = 0, sumDt = 0;
    for (const { dx, dy, dt } of next[index]) { sumDx += dx; sumDy += dy; sumDt += dt; }
    next[index + 1] = [{ ...next[index + 1][0], dx: next[index + 1][0].dx + sumDx, dy: next[index + 1][0].dy + sumDy, dt: next[index + 1][0].dt + sumDt }, ...next[index + 1].slice(1)];
  }
  next.splice(index, 1);
  return next;
}

function applySwap(s: Stroke[], index: number): Stroke[] {
  const j = index + 1;
  if (j >= s.length) return s;
  const A = s[index], B = s[j];
  let sumAdx = 0, sumAdy = 0;
  for (const { dx, dy } of A) { sumAdx += dx; sumAdy += dy; }
  let sumBdx = 0, sumBdy = 0;
  for (const { dx, dy } of B) { sumBdx += dx; sumBdy += dy; }
  const next = [...s];
  next[index] = [{ ...B[0], dx: sumAdx + B[0].dx, dy: sumAdy + B[0].dy }, ...B.slice(1)];
  next[j] = [{ ...A[0], dx: A[0].dx - sumAdx - sumBdx, dy: A[0].dy - sumAdy - sumBdy }, ...A.slice(1)];
  if (j + 1 < next.length) {
    next[j + 1] = [{ ...next[j + 1][0], dx: next[j + 1][0].dx + sumBdx, dy: next[j + 1][0].dy + sumBdy }, ...next[j + 1].slice(1)];
  }
  return next;
}

function applyEditFirst(s: Stroke[], index: number, field: 'dx' | 'dy' | 'dt', value: number): Stroke[] {
  const next = [...s];
  next[index] = [{ ...next[index][0], [field]: value }, ...next[index].slice(1)];
  return next;
}

// --- History ---

type HistoryOp =
  | { type: 'draw';   index: number; stroke: Stroke }
  | { type: 'delete'; index: number; stroke: Stroke }
  | { type: 'swap';   index: number }
  | { type: 'edit';   index: number; field: 'dx' | 'dy' | 'dt'; from: number; to: number }
  | { type: 'align';  fromDx: number; fromDy: number; toDx: number; toDy: number }
  | { type: 'bulk';   from: Stroke[]; to: Stroke[] };

function applyHistoryOp(s: Stroke[], op: HistoryOp, dir: 'undo' | 'redo'): Stroke[] {
  switch (op.type) {
    case 'draw':   return dir === 'undo' ? applyDelete(s, op.index) : applyDraw(s, op.index, op.stroke);
    case 'delete': return dir === 'undo' ? applyDraw(s, op.index, op.stroke) : applyDelete(s, op.index);
    case 'swap':   return applySwap(s, op.index);
    case 'edit':   return applyEditFirst(s, op.index, op.field, dir === 'undo' ? op.from : op.to);
    case 'align':
      if (s.length === 0) return s;
      return [[{ ...s[0][0], dx: dir === 'undo' ? op.fromDx : op.toDx, dy: dir === 'undo' ? op.fromDy : op.toDy }, ...s[0].slice(1)], ...s.slice(1)];
    case 'bulk':   return dir === 'undo' ? op.from : op.to;
  }
}

// --- Component ---

function pointerPt(canvas: HTMLCanvasElement, e: PointerEvent, startTime: number) {
  const scale = canvas.width / canvas.offsetWidth;
  return {
    x: Math.round(e.offsetX * scale),
    y: Math.round(e.offsetY * scale),
    t: Math.round(performance.now() - startTime),
    pressure: Math.round(e.pressure * 8192),
    tiltX: e.tiltX,
    tiltY: e.tiltY,
  };
}

export function App() {
  // --- Refs (imperative handles only) ---
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const ctxRef           = useRef<CanvasRenderingContext2D | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastAbsPtRef     = useRef<ReturnType<typeof pointerPt> | null>(null);
  const liveAbsPtsRef    = useRef<{ x: number; y: number }[]>([]);
  const startTimeRef     = useRef(0);
  const rafRef           = useRef<number | null>(null);
  const replayAbsRef     = useRef<AbsStroke[]>([]);
  const replayDurRef     = useRef(0);
  const replayElapsedRef = useRef(0);

  // Mirror of strokes state kept in sync synchronously so undo/redo don't read stale state
  const strokesRef = useRef<Stroke[]>([]);

  // --- State ---
  const [strokes, setStrokes]               = useState<Stroke[]>([]);
  const [selectedStroke, setSelectedStroke] = useState<number | null>(null);
  const [insertionPoint, setInsertionPoint] = useState(0);
  const [transforms, setTransforms]         = useState<Transforms>(DEFAULT_TRANSFORMS);
  const [isPlaying, setIsPlaying]           = useState(false);
  const [replayElapsed, setReplayElapsed]   = useState(0);
  const [replayDuration, setReplayDuration] = useState(0);
  const [config, setConfig] = useState<Config>(() => ({
    ...DEFAULT_CONFIG,
    ...JSON.parse(localStorage.getItem('rescrawl-config') || '{}'),
  }));
  const [exportOpen, setExportOpen]     = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // --- History ---
  const historyRef      = useRef<HistoryOp[]>([]);
  const historyIndexRef = useRef(-1);

  // Persist config
  useEffect(() => {
    localStorage.setItem('rescrawl-config', JSON.stringify(config));
  }, [config]);

  // Panel side class
  useEffect(() => {
    document.body.classList.toggle('panel-left', !config.sidebarRight);
  }, [config.sidebarRight]);

  // Canvas setup — once on mount
  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = 1080;
    canvas.height = 1620;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;
    clearCanvas(ctx, config.guidelines);
  }, []);

  // --- Helpers ---

  function redraw(
    s = strokes,
    sel = selectedStroke,
    ip = insertionPoint,
    tr = transforms,
    cfg = config,
  ) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (tr.align) {
      clearCanvas(ctx, cfg.guidelines);
      drawAllStrokes(ctx, alignApply(s, tr.padX, tr.padY), tr.smooth, tr.smoothPasses);
      drawInsertionCrosshair(ctx, s, ip);
    } else {
      renderHighlight(ctx, s, sel, ip, tr.smooth, tr.smoothPasses, cfg.guidelines);
    }
  }

  function updateReplay(s = strokes, tr = transforms) {
    const cfg = { capDtEnabled: tr.capDt, capDtMax: tr.capDtMax, alignEnabled: tr.align, padX: tr.padX, padY: tr.padY };
    const abs = toAbsolute(getEffectiveStrokes(s, cfg));
    replayAbsRef.current = abs;
    const dur = abs.flat().at(-1)?.t ?? 0;
    replayDurRef.current = dur;
    setReplayDuration(dur);
  }

  function commit(next: Stroke[], ip: number, sel: number | null = null, tr = transforms) {
    strokesRef.current = next;
    setStrokes(next);
    setInsertionPoint(ip);
    setSelectedStroke(sel);
    updateReplay(next, tr);
    redraw(next, sel, ip, tr);
  }

  function pushHistory(op: HistoryOp) {
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(op);
    historyIndexRef.current++;
    setCanUndo(true);
    setCanRedo(false);
  }

  // Refs so keyboard handler always calls the latest version without stale closures
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

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
    redraw(next, null, ip);
    setCanUndo(historyIndexRef.current >= 0);
    setCanRedo(true);
  };

  redoRef.current = function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const op = historyRef.current[historyIndexRef.current];
    const next = applyHistoryOp(strokesRef.current, op, 'redo');
    strokesRef.current = next;
    const ip = Math.min(insertionPoint, next.length);
    setStrokes(next);
    setInsertionPoint(ip);
    setSelectedStroke(null);
    updateReplay(next);
    redraw(next, null, ip);
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };

  // Keyboard shortcuts
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
    const smooth = transforms.smooth;
    const passes = transforms.smoothPasses;
    const guidelines = config.guidelines;

    function frame(now: number) {
      const elapsed = Math.min(now - frameStart, replayDurRef.current);
      replayElapsedRef.current = elapsed;
      setReplayElapsed(elapsed);
      drawUpTo(ctxRef.current!, replayAbsRef.current, elapsed, smooth, passes, guidelines);
      if (elapsed < replayDurRef.current) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
        setIsPlaying(false);
      }
    }
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
    redraw();
  }

  function scrubTo(ms: number) {
    pauseReplay();
    replayElapsedRef.current = ms;
    setReplayElapsed(ms);
    drawUpTo(ctxRef.current!, replayAbsRef.current, ms, transforms.smooth, transforms.smoothPasses, config.guidelines);
  }

  function togglePlay() {
    if (rafRef.current) pauseReplay();
    else startReplay();
  }

  // --- Pointer events ---

  function handlePointerDown(e: PointerEvent) {
    if (rafRef.current !== null) return;
    if (transforms.align) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    if (strokes.length === 0 && currentStrokeRef.current === null) {
      startTimeRef.current = performance.now();
    }
    const pt = pointerPt(canvasRef.current!, e, startTimeRef.current);
    lastAbsPtRef.current = pt;
    const insertAbs = getInsertionAbs(strokes, insertionPoint);
    currentStrokeRef.current = [{ dx: pt.x - insertAbs.x, dy: pt.y - insertAbs.y, dt: pt.t - insertAbs.t, pressure: pt.pressure, tiltX: pt.tiltX, tiltY: pt.tiltY }];
    liveAbsPtsRef.current = [{ x: pt.x, y: pt.y }];
  }

  function handlePointerMove(e: PointerEvent) {
    if (currentStrokeRef.current === null) return;
    const ctx = ctxRef.current!;
    const pt = pointerPt(canvasRef.current!, e, startTimeRef.current);
    const last = lastAbsPtRef.current!;
    const dx = pt.x - last.x, dy = pt.y - last.y;
    if (dx === 0 && dy === 0) return;
    currentStrokeRef.current.push({ dx, dy, dt: pt.t - last.t, pressure: pt.pressure, tiltX: pt.tiltX, tiltY: pt.tiltY });
    const prev = last;
    lastAbsPtRef.current = pt;
    if (transforms.smooth) {
      liveAbsPtsRef.current.push({ x: pt.x, y: pt.y });
      clearCanvas(ctx, config.guidelines);
      drawAllStrokes(ctx, strokes, transforms.smooth, transforms.smoothPasses);
      const live = liveAbsPtsRef.current;
      if (live.length >= 2) drawPath(ctx, live, true, transforms.smoothPasses);
      else drawDot(ctx, live[0]);
      drawInsertionCrosshair(ctx, strokes, insertionPoint);
    } else {
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  }

  function commitStroke() {
    if (currentStrokeRef.current === null) return;
    const ctx = ctxRef.current!;
    const last = lastAbsPtRef.current!;
    if (currentStrokeRef.current.length === 1) drawDot(ctx, last);
    const stroke = currentStrokeRef.current;
    const k = insertionPoint;
    currentStrokeRef.current = null;
    lastAbsPtRef.current = null;
    const next = applyDraw(strokes, k, stroke);
    pushHistory({ type: 'draw', index: k, stroke });
    commit(next, k + 1, selectedStroke);
  }

  function handlePointerUp() { commitStroke(); }
  function handlePointerCancel() { commitStroke(); }

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

  function editFirstPoint(i: number, field: 'dx' | 'dy' | 'dt', value: number) {
    const from = strokes[i][0][field];
    const next = applyEditFirst(strokes, i, field, value);
    pushHistory({ type: 'edit', index: i, field, from, to: value });
    commit(next, insertionPoint, selectedStroke);
  }

  // --- Transforms ---

  function handleTransformsChange(next: Transforms) {
    setTransforms(next);
    updateReplay(strokes, next);
    redraw(strokes, selectedStroke, insertionPoint, next);
  }

  function handleAlignApply() {
    const next = alignApply(strokes, transforms.padX, transforms.padY);
    pushHistory({ type: 'align', fromDx: strokes[0][0].dx, fromDy: strokes[0][0].dy, toDx: next[0][0].dx, toDy: next[0][0].dy });
    const nextTr = { ...transforms, align: false };
    setTransforms(nextTr);
    commit(next, insertionPoint, selectedStroke, nextTr);
  }

  // --- Clear ---

  function handleClear() {
    if (!confirm('Clear all strokes?')) return;
    stopReplay();
    pushHistory({ type: 'bulk', from: strokes, to: [] });
    commit([], 0);
  }

  // --- Import / Export ---

  async function handleImport(file: File) {
    const raw = await file.text();
    const text = file.name.endsWith('.gz') ? await decompressText(raw) : raw;
    stopReplay();
    const nextTr = { ...DEFAULT_TRANSFORMS };
    const imported = deserialize(text);
    // Reset startTime so new strokes drawn after import have correct relative timing
    const lastT = toAbsolute(imported).flat().at(-1)?.t ?? 0;
    startTimeRef.current = performance.now() - lastT;
    pushHistory({ type: 'bulk', from: strokes, to: imported });
    setTransforms(nextTr);
    commit(imported, imported.length, null, nextTr);
  }

  async function handleExport(filename: string, gzip: boolean, ballpoint: boolean) {
    const cfg = { capDtEnabled: transforms.capDt, capDtMax: transforms.capDtMax, alignEnabled: transforms.align, padX: transforms.padX, padY: transforms.padY };
    const effective = getEffectiveStrokes(strokes, cfg);
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

  return (
    <AppContext.Provider value={{
      strokes, selectedStroke, insertionPoint,
      setSelectedStroke: (i) => { setSelectedStroke(i); redraw(strokes, i, insertionPoint); },
      setInsertionPoint: (i) => { setInsertionPoint(i); redraw(strokes, selectedStroke, i); },
      deleteStroke,
      swapStrokes,
      editFirstPoint,
    }}>
      <div id="main-area">
        <div id="canvas-area">
          <div id="floating-toolbar">
            <button id="btn-undo" disabled={!canUndo} onClick={() => undoRef.current()} title="Undo (Ctrl+Z)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 14 4 9l5-5"/>
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
              </svg>
            </button>
            <button id="btn-redo" disabled={!canRedo} onClick={() => redoRef.current()} title="Redo (Ctrl+Y)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 14 5-5-5-5"/>
                <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>
              </svg>
            </button>
          </div>
          <canvas
            ref={canvasRef}
            id="canvas"
            class={transforms.align ? 'no-draw' : ''}
            onPointerDown={handlePointerDown as any}
            onPointerMove={handlePointerMove as any}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onContextMenu={(e) => e.preventDefault()}
          />
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
          transforms={transforms}
          onTransformsChange={handleTransformsChange}
          onAlignApply={handleAlignApply}
          guidelines={config.guidelines}
          onGuidelinesChange={(v) => {
            const next = { ...config, guidelines: v };
            setConfig(next);
            redraw(strokes, selectedStroke, insertionPoint, transforms, next);
          }}
          hasStrokes={strokes.length > 0}
          onImport={handleImport}
          onExportOpen={() => setExportOpen(true)}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
        <StrokeList />
      </div>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} onExport={handleExport} />
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
