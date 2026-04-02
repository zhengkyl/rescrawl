import { smoothAverage, getInsertionAbs } from './utils';
import type { Stroke, AbsStroke, AbsPoint } from './utils';

const LINE_SPACING = 40;

export function clearCanvas(ctx: CanvasRenderingContext2D, guidelines: boolean) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (guidelines) {
    ctx.save();
    ctx.strokeStyle = '#c8d8f0';
    ctx.lineWidth = 1;
    for (let y = LINE_SPACING; y < ctx.canvas.height; y += LINE_SPACING) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ctx.canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function drawDot(ctx: CanvasRenderingContext2D, pt: { x: number; y: number }) {
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle as string;
  ctx.fill();
}

export function drawPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], smooth: boolean, passes: number) {
  const p = smooth ? smoothAverage(pts, passes) : pts;
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.stroke();
}

export function drawAllStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], smooth: boolean, passes: number) {
  let prev = { x: 0, y: 0 };
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      prev = { x: prev.x + stroke[0].dx, y: prev.y + stroke[0].dy };
      drawDot(ctx, prev);
      continue;
    }
    const pts: { x: number; y: number }[] = [];
    for (const { dx, dy } of stroke) {
      prev = { x: prev.x + dx, y: prev.y + dy };
      pts.push({ x: prev.x, y: prev.y });
    }
    drawPath(ctx, pts, smooth, passes);
  }
}

export function drawInsertionCrosshair(ctx: CanvasRenderingContext2D, strokes: Stroke[], insertionPoint: number) {
  if (strokes.length === 0 || insertionPoint >= strokes.length) return;
  const { x, y } = getInsertionAbs(strokes, insertionPoint);
  const size = 12;
  ctx.save();
  ctx.strokeStyle = '#4f8ef7';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

export function renderHighlight(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  selectedStroke: number | null,
  insertionPoint: number,
  smooth: boolean,
  passes: number,
  guidelines: boolean,
) {
  clearCanvas(ctx, guidelines);
  drawAllStrokes(ctx, strokes, smooth, passes);
  if (selectedStroke !== null) {
    const stroke = strokes[selectedStroke];
    let prev = { x: 0, y: 0 };
    for (let i = 0; i < selectedStroke; i++)
      for (const { dx, dy } of strokes[i]) prev = { x: prev.x + dx, y: prev.y + dy };
    ctx.save();
    ctx.strokeStyle = '#4f8ef7';
    ctx.lineWidth = 3;
    if (stroke.length === 1) {
      prev = { x: prev.x + stroke[0].dx, y: prev.y + stroke[0].dy };
      drawDot(ctx, prev);
    } else {
      const pts: { x: number; y: number }[] = [];
      for (const { dx, dy } of stroke) {
        prev = { x: prev.x + dx, y: prev.y + dy };
        pts.push({ x: prev.x, y: prev.y });
      }
      drawPath(ctx, pts, smooth, passes);
    }
    ctx.restore();
  }
  drawInsertionCrosshair(ctx, strokes, insertionPoint);
}

export function drawUpTo(
  ctx: CanvasRenderingContext2D,
  absStrokes: AbsStroke[],
  elapsed: number,
  smooth: boolean,
  passes: number,
  guidelines: boolean,
) {
  clearCanvas(ctx, guidelines);
  for (const stroke of absStrokes) {
    if (stroke[0].t > elapsed) break;
    if (stroke.length === 1) { drawDot(ctx, stroke[0]); continue; }
    const pts: AbsPoint[] = [];
    for (const pt of stroke) {
      if (pt.t > elapsed) break;
      pts.push(pt);
    }
    if (pts.length >= 2) drawPath(ctx, pts, smooth, passes);
  }
}
