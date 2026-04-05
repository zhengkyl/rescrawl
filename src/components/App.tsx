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

    const next = [...strokes];
    next.splice(k, 0, stroke);
    if (k + 1 < next.length) {
      let sumDx = 0, sumDy = 0;
      for (const { dx, dy } of stroke) { sumDx += dx; sumDy += dy; }
      next[k + 1] = [{ ...next[k + 1][0], dx: next[k + 1][0].dx - sumDx, dy: next[k + 1][0].dy - sumDy }, ...next[k + 1].slice(1)];
    }
    const newIp = k + 1;
    setStrokes(next);
    setInsertionPoint(newIp);
    updateReplay(next);
    redraw(next, selectedStroke, newIp);
  }

  function handlePointerUp() { commitStroke(); }
  function handlePointerCancel() { commitStroke(); }

  // --- Stroke operations ---

  function deleteStroke(i: number) {
    const next = [...strokes];
    if (i + 1 < next.length) {
      let sumDx = 0, sumDy = 0, sumDt = 0;
      for (const { dx, dy, dt } of next[i]) { sumDx += dx; sumDy += dy; sumDt += dt; }
      next[i + 1] = [{ ...next[i + 1][0], dx: next[i + 1][0].dx + sumDx, dy: next[i + 1][0].dy + sumDy, dt: next[i + 1][0].dt + sumDt }, ...next[i + 1].slice(1)];
    }
    next.splice(i, 1);
    const newIp = insertionPoint > i ? insertionPoint - 1 : insertionPoint;
    setStrokes(next);
    setInsertionPoint(newIp);
    setSelectedStroke(null);
    updateReplay(next);
    redraw(next, null, newIp);
  }

  function swapStrokes(i: number) {
    const j = i + 1;
    if (j >= strokes.length) return;
    const next = strokes.map(s => [...s]);
    const A = next[i], B = next[j];
    let sumAdx = 0, sumAdy = 0;
    for (const { dx, dy } of A) { sumAdx += dx; sumAdy += dy; }
    let sumBdx = 0, sumBdy = 0;
    for (const { dx, dy } of B) { sumBdx += dx; sumBdy += dy; }
    next[i] = B; next[j] = A;
    next[i][0] = { ...next[i][0], dx: sumAdx + B[0].dx, dy: sumAdy + B[0].dy };
    next[j][0] = { ...next[j][0], dx: A[0].dx - sumAdx - sumBdx, dy: A[0].dy - sumAdy - sumBdy };
    if (j + 1 < next.length) {
      next[j + 1][0] = { ...next[j + 1][0], dx: next[j + 1][0].dx + sumBdx, dy: next[j + 1][0].dy + sumBdy };
    }
    setStrokes(next);
    updateReplay(next);
    redraw(next, selectedStroke, insertionPoint);
  }

  function editFirstPoint(i: number, field: 'dx' | 'dy' | 'dt', value: number) {
    const next = strokes.map(s => [...s]);
    next[i][0] = { ...next[i][0], [field]: value };
    setStrokes(next);
    updateReplay(next);
    redraw(next, selectedStroke, insertionPoint);
  }

  // --- Transforms ---

  function handleTransformsChange(next: Transforms) {
    setTransforms(next);
    updateReplay(strokes, next);
    redraw(strokes, selectedStroke, insertionPoint, next);
  }

  function handleAlignApply() {
    const next = alignApply(strokes, transforms.padX, transforms.padY);
    const nextTr = { ...transforms, align: false };
    setStrokes(next);
    setTransforms(nextTr);
    updateReplay(next, nextTr);
    redraw(next, selectedStroke, insertionPoint, nextTr);
  }

  // --- Clear ---

  function handleClear() {
    if (!confirm('Clear all strokes?')) return;
    stopReplay();
    setStrokes([]);
    setSelectedStroke(null);
    setInsertionPoint(0);
    replayAbsRef.current = [];
    replayDurRef.current = 0;
    setReplayDuration(0);
    clearCanvas(ctxRef.current!, config.guidelines);
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
    setStrokes(imported);
    setSelectedStroke(null);
    setInsertionPoint(imported.length);
    setTransforms(nextTr);
    updateReplay(imported, nextTr);
    redraw(imported, null, imported.length, nextTr);
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
