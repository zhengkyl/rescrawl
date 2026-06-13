export type Point = { x: number; y: number; t: number; p: number };
export type Stroke = Point[];

export const DEFAULT_CONFIG = {
  sidebarRight: false,
  guidelines: true,
};

export type Config = typeof DEFAULT_CONFIG;

// --- Bounds & framing ---

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function strokesBounds(strokes: Stroke[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes)
    for (const pt of stroke) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

// Translate every point so the content's top-left bound sits at (pad, pad) —
// used to reframe a drawing to its used bounds + padding on export.
export function reframe(strokes: Stroke[], pad: number): Stroke[] {
  const b = strokesBounds(strokes);
  if (!b) return strokes;
  const dx = pad - b.minX, dy = pad - b.minY;
  return strokes.map(stroke =>
    stroke.map(pt => ({ ...pt, x: pt.x + dx, y: pt.y + dy }))
  );
}

// The prefix of a stroke that has been drawn by time `t`: every sample with
// t <= `t`, plus an interpolated head sitting exactly where the raw pen was at
// `t`. `Infinity` returns the whole stroke; a time before the stroke starts
// returns nothing. This is the single bridge between the timeline and geometry.
export function drawnPoints(stroke: Stroke, t: number): Stroke {
  const n = stroke.length;
  if (n === 0 || t < stroke[0].t) return [];
  if (t >= stroke[n - 1].t) return stroke;
  let i = 0;
  while (i < n - 1 && stroke[i + 1].t <= t) i++;
  const a = stroke[i], b = stroke[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  if (f <= 0) return stroke.slice(0, i + 1);
  const head: Point = {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    t,
    p: a.p + (b.p - a.p) * f,
  };
  return [...stroke.slice(0, i + 1), head];
}

// --- Serialization ---
// Per stroke: first point absolute "x,y,t,p", rest relative "dx,dy,dt,dp".

export function serializeBallpoint(strokes: Stroke[]): string {
  return strokes.map(stroke =>
    stroke.map((pt, i) => {
      if (i === 0) return `${pt.x},${pt.y},${pt.t}`;
      const prev = stroke[i - 1];
      return `${pt.x - prev.x},${pt.y - prev.y},${pt.t - prev.t}`;
    }).join(';')
  ).join('\n');
}

export function serialize(strokes: Stroke[]): string {
  return strokes.map(stroke =>
    stroke.map((pt, i) => {
      if (i === 0) return `${pt.x},${pt.y},${pt.t},${pt.p}`;
      const prev = stroke[i - 1];
      return `${pt.x - prev.x},${pt.y - prev.y},${pt.t - prev.t},${pt.p - prev.p}`;
    }).join(';')
  ).join('\n');
}

export function deserialize(text: string): Stroke[] {
  return text.split('\n').filter(line => line.trim() !== '').map(line => {
    const stroke: Stroke = [];
    let x = 0, y = 0, t = 0, p = 0;
    line.split(';').forEach((token, i) => {
      const parts = token.split(',').map(Number);
      if (i === 0) {
        [x, y, t] = parts;
        p = parts[3] ?? 0;
      } else {
        x += parts[0];
        y += parts[1];
        t += parts[2];
        p += parts[3] ?? 0;
      }
      stroke.push({ x, y, t, p });
    });
    return stroke;
  });
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
