export type Point = { dx: number; dy: number; dt: number; pressure: number; tiltX: number; tiltY: number };
export type Stroke = Point[];
export type AbsPoint = { x: number; y: number; t: number };
export type AbsStroke = AbsPoint[];

export const DEFAULT_CONFIG = {
  sidebarRight: false,
  guidelines: true,
};

export type Config = typeof DEFAULT_CONFIG;

// --- Geometry ---

export function toAbsolute(deltaStrokes: Stroke[]): AbsStroke[] {
  const result: AbsStroke[] = [];
  let prev: AbsPoint = { x: 0, y: 0, t: 0 };
  for (const stroke of deltaStrokes) {
    const abs: AbsStroke = [];
    for (const { dx, dy, dt } of stroke) {
      prev = { x: prev.x + dx, y: prev.y + dy, t: prev.t + dt };
      abs.push({ ...prev });
    }
    result.push(abs);
  }
  return result;
}

export function getInsertionAbs(strokes: Stroke[], k: number): AbsPoint {
  let pos: AbsPoint = { x: 0, y: 0, t: 0 };
  for (let i = 0; i < k; i++)
    for (const { dx, dy, dt } of strokes[i]) { pos.x += dx; pos.y += dy; pos.t += dt; }
  return pos;
}

// --- Transforms ---

export function capDtApply(strokes: Stroke[], max: number): Stroke[] {
  return strokes.map(stroke =>
    stroke.map(pt => ({ ...pt, dt: Math.min(pt.dt, max) }))
  );
}

export function alignApply(strokes: Stroke[], padX: number, padY: number): Stroke[] {
  if (strokes.length === 0) return strokes;
  const abs = toAbsolute(strokes);
  let minX = Infinity, minY = Infinity;
  for (const stroke of abs)
    for (const pt of stroke) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
    }
  const first = strokes[0];
  return [
    [{ ...first[0], dx: first[0].dx + padX - minX, dy: first[0].dy + padY - minY }, ...first.slice(1)],
    ...strokes.slice(1),
  ];
}

export type TransformConfig = {
  capDtEnabled: boolean;
  capDtMax: number;
  alignEnabled: boolean;
  padX: number;
  padY: number;
};

export function getEffectiveStrokes(strokes: Stroke[], cfg: TransformConfig): Stroke[] {
  let result = strokes;
  if (cfg.capDtEnabled) result = capDtApply(result, cfg.capDtMax);
  if (cfg.alignEnabled) result = alignApply(result, cfg.padX, cfg.padY);
  return result;
}

// --- Smooth ---

export function smoothAverage(pts: { x: number; y: number }[], passes = 3) {
  if (pts.length <= 2) return pts;
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const next = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      next.push({
        x: (cur[i - 1].x + 2 * cur[i].x + cur[i + 1].x) / 4,
        y: (cur[i - 1].y + 2 * cur[i].y + cur[i + 1].y) / 4,
      });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

// --- Serialization ---

export function serializeBallpoint(strokes: Stroke[]): string {
  return strokes.map(stroke =>
    stroke.map(({ dx, dy, dt }) => `${dx},${dy},${dt}`).join(';')
  ).join('\n');
}

export function serialize(strokes: Stroke[]): string {
  return strokes.map(stroke =>
    stroke.map(({ dx, dy, dt, pressure, tiltX, tiltY }) => `${dx},${dy},${dt},${pressure},${tiltX},${tiltY}`).join(';')
  ).join('\n');
}

export function deserialize(text: string): Stroke[] {
  return text.split('\n').filter(line => line.trim() !== '').map(line =>
    line.split(';').map(token => {
      const parts = token.split(',').map(Number);
      const [dx, dy, dt] = parts;
      const pressure = parts[3] ?? 0;
      const tiltX = parts[4] ?? 0;
      const tiltY = parts[5] ?? 0;
      return { dx, dy, dt, pressure, tiltX, tiltY };
    })
  );
}

export async function compressText(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function decompressText(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
