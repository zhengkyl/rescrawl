const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const btnPlay = document.getElementById('btn-play');
const scrubber = document.getElementById('scrubber');
const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const fileInput = document.getElementById('file-input');
const status = document.getElementById('status');
const strokeList = document.getElementById('stroke-list');
const btnAlign = document.getElementById('btn-align');
const padInput = document.getElementById('pad-input');
const btnExportZ = document.getElementById('btn-export-z');
const btnImportZ = document.getElementById('btn-import-z');
const fileInputZ = document.getElementById('file-input-z');
const btnExportG = document.getElementById('btn-export-g');
const btnImportG = document.getElementById('btn-import-g');
const fileInputG = document.getElementById('file-input-g');

// strokes: Array<Array<{dx, dy, dt}>>
// Every point is a delta from the previous point; prev starts at {x:0,y:0,t:0}
// and carries across stroke boundaries. Matches the .scrawl file format exactly.
let strokes = [];
let currentStroke = null;
let cursorAbs = { x: 0, y: 0, t: 0 }; // absolute position of last committed point
let lastAbsPt = null;                   // absolute position during active stroke
let startTime = 0;
let replayHandle = null;
let selectedStroke = null;

canvas.width = 1080;
canvas.height = 1620;

ctx.strokeStyle = '#000';
ctx.lineWidth = 2;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// --- Drawing ---
const LINE_SPACING = 40;
function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.strokeStyle = '#c8d8f0';
  ctx.lineWidth = 1;
  for (let y = LINE_SPACING; y < canvas.height; y += LINE_SPACING) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

clearCanvas();

function drawSegment(a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawDot(pt) {
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function pointerPt(e) {
  const scale = canvas.width / canvas.offsetWidth;
  return {
    x: Math.round(e.offsetX * scale),
    y: Math.round(e.offsetY * scale),
    t: Math.round(performance.now() - startTime),
  };
}

canvas.addEventListener('pointerdown', e => {
  if (replayHandle !== null) return;
  canvas.setPointerCapture(e.pointerId);
  if (strokes.length === 0 && currentStroke === null) startTime = performance.now();
  const pt = pointerPt(e);
  lastAbsPt = pt;
  currentStroke = [{ dx: pt.x - cursorAbs.x, dy: pt.y - cursorAbs.y, dt: pt.t - cursorAbs.t }];
});

canvas.addEventListener('pointermove', e => {
  if (currentStroke === null) return;
  const pt = pointerPt(e);
  const dx = pt.x - lastAbsPt.x, dy = pt.y - lastAbsPt.y;
  if (dx === 0 && dy === 0) return;
  drawSegment(lastAbsPt, pt);
  currentStroke.push({ dx, dy, dt: pt.t - lastAbsPt.t });
  lastAbsPt = pt;
});

canvas.addEventListener('pointerup', () => {
  if (currentStroke === null) return;
  if (currentStroke.length === 1) drawDot(lastAbsPt);
  strokes.push(currentStroke);
  cursorAbs = lastAbsPt;
  lastAbsPt = null;
  currentStroke = null;
  btnExport.disabled = false;
  btnExportZ.disabled = false;
  btnExportG.disabled = false;
  btnAlign.disabled = false;
  updateScrubber();
  renderPanel();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointercancel', () => {
  if (currentStroke === null) return;
  strokes.push(currentStroke);
  cursorAbs = lastAbsPt;
  lastAbsPt = null;
  currentStroke = null;
});

// --- Replay ---

function toAbsolute(deltaStrokes) {
  const result = [];
  let prev = { x: 0, y: 0, t: 0 };
  for (const stroke of deltaStrokes) {
    const abs = [];
    for (const { dx, dy, dt } of stroke) {
      prev = { x: prev.x + dx, y: prev.y + dy, t: prev.t + dt };
      abs.push({ ...prev });
    }
    result.push(abs);
  }
  return result;
}

let replayAbsStrokes = null;
let replayElapsed = 0;
let replayDuration = 0;

function drawUpTo(elapsed) {
  clearCanvas();
  for (const stroke of replayAbsStrokes) {
    if (stroke[0].t > elapsed) break;
    if (stroke.length === 1) { drawDot(stroke[0]); continue; }
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      if (stroke[i].t > elapsed) break;
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  }
}

function updateScrubber() {
  replayAbsStrokes = toAbsolute(strokes);
  replayDuration = replayAbsStrokes.flat().at(-1)?.t ?? 0;
  scrubber.max = replayDuration;
  scrubber.disabled = strokes.length === 0;
  btnPlay.disabled = strokes.length === 0;
}

function startReplay() {
  if (replayElapsed >= replayDuration) replayElapsed = 0;
  const frameStart = performance.now() - replayElapsed;
  btnPlay.textContent = '⏸';
  btnClear.disabled = true;

  function frame(now) {
    replayElapsed = Math.min(now - frameStart, replayDuration);
    drawUpTo(replayElapsed);
    scrubber.value = replayElapsed;
    if (replayElapsed < replayDuration) {
      replayHandle = requestAnimationFrame(frame);
    } else {
      replayHandle = null;
      btnPlay.textContent = '▶';
      btnClear.disabled = false;
    }
  }
  replayHandle = requestAnimationFrame(frame);
}

function pauseReplay() {
  if (replayHandle !== null) {
    cancelAnimationFrame(replayHandle);
    replayHandle = null;
  }
  btnPlay.textContent = '▶';
  btnClear.disabled = false;
}

function stopReplay() {
  pauseReplay();
  replayElapsed = 0;
  scrubber.value = 0;
}

btnPlay.addEventListener('click', () => {
  if (replayHandle !== null) pauseReplay();
  else startReplay();
});

scrubber.addEventListener('input', () => {
  pauseReplay();
  replayElapsed = +scrubber.value;
  drawUpTo(replayElapsed);
});

// --- Clear ---

btnClear.addEventListener('click', () => {
  stopReplay();
  clearCanvas();
  strokes = [];
  currentStroke = null;
  cursorAbs = { x: 0, y: 0, t: 0 };
  selectedStroke = null;
  btnExport.disabled = true;
  btnExportZ.disabled = true;
  btnExportG.disabled = true;
  btnAlign.disabled = true;
  status.textContent = '';
  updateScrubber();
  renderPanel();
});

// --- Serialization ---
// Text format (.scrawl): one stroke per line, points separated by ';', values by ','
// Every token is dx,dy,dt. In-memory format matches exactly — no conversion needed.

function serialize(strokes) {
  return strokes.map(stroke =>
    stroke.map(({ dx, dy, dt }) => `${dx},${dy},${dt}`).join(';')
  ).join('\n');
}

function deserialize(text) {
  return text.split('\n').filter(line => line.trim() !== '').map(line =>
    line.split(';').map(token => {
      const [dx, dy, dt] = token.split(',').map(Number);
      return { dx, dy, dt };
    })
  );
}

function drawAllStrokes(strokesToDraw) {
  let prev = { x: 0, y: 0 };
  for (const stroke of strokesToDraw) {
    if (stroke.length === 1) {
      prev = { x: prev.x + stroke[0].dx, y: prev.y + stroke[0].dy };
      drawDot(prev);
      continue;
    }
    ctx.beginPath();
    let first = true;
    for (const { dx, dy } of stroke) {
      prev = { x: prev.x + dx, y: prev.y + dy };
      if (first) { ctx.moveTo(prev.x, prev.y); first = false; }
      else ctx.lineTo(prev.x, prev.y);
    }
    ctx.stroke();
  }
}

function renderHighlight() {
  clearCanvas();
  drawAllStrokes(strokes);
  if (selectedStroke === null) return;
  const stroke = strokes[selectedStroke];
  let prev = { x: 0, y: 0 };
  for (let i = 0; i < selectedStroke; i++)
    for (const { dx, dy } of strokes[i]) prev = { x: prev.x + dx, y: prev.y + dy };
  ctx.save();
  ctx.strokeStyle = '#4f8ef7';
  ctx.lineWidth = 3;
  if (stroke.length === 1) {
    prev = { x: prev.x + stroke[0].dx, y: prev.y + stroke[0].dy };
    drawDot(prev);
  } else {
    ctx.beginPath();
    let first = true;
    for (const { dx, dy } of stroke) {
      prev = { x: prev.x + dx, y: prev.y + dy };
      if (first) { ctx.moveTo(prev.x, prev.y); first = false; }
      else ctx.lineTo(prev.x, prev.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function deleteStroke(i) {
  if (i + 1 < strokes.length) {
    let sumDx = 0, sumDy = 0, sumDt = 0;
    for (const { dx, dy, dt } of strokes[i]) { sumDx += dx; sumDy += dy; sumDt += dt; }
    strokes[i + 1][0].dx += sumDx;
    strokes[i + 1][0].dy += sumDy;
    strokes[i + 1][0].dt += sumDt;
  }
  strokes.splice(i, 1);
  cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
  selectedStroke = null;
  btnExport.disabled = strokes.length === 0;
  btnExportZ.disabled = strokes.length === 0;
  btnExportG.disabled = strokes.length === 0;
  btnAlign.disabled = strokes.length === 0;
  updateScrubber();
  clearCanvas();
  drawAllStrokes(strokes);
  renderPanel();
}

// --- Export ---

btnExport.addEventListener('click', () => {
  const text = serialize(strokes);
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'drawing.scrawl';
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- Import ---

btnImport.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  file.text().then(text => {
    stopReplay();
    strokes = deserialize(text);
    cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
    selectedStroke = null;
    clearCanvas();
    drawAllStrokes(strokes);
    btnExport.disabled = strokes.length === 0;
    btnExportZ.disabled = strokes.length === 0;
    btnExportG.disabled = strokes.length === 0;
    btnAlign.disabled = strokes.length === 0;
    updateScrubber();
    fileInput.value = '';
    renderPanel();
  });
});

// --- Panel ---

function renderPanel() {
  if (strokes.length === 0) {
    strokeList.innerHTML = '<div id="no-strokes">No strokes yet</div>';
    return;
  }
  strokeList.innerHTML = '';
  strokes.forEach((stroke, i) => {
    const { dx, dy, dt } = stroke[0];
    const row = document.createElement('div');
    row.className = 'stroke-row' + (i === selectedStroke ? ' selected' : '');
    row.dataset.stroke = i;
    row.innerHTML = `
      <div class="stroke-header">
        <div class="stroke-label">Stroke ${i + 1}</div>
        <button class="btn-delete" data-stroke="${i}">×</button>
      </div>
      <div class="stroke-fields">
        <label>dx<input type="number" value="${dx}" data-stroke="${i}" data-field="dx"></label>
        <label>dy<input type="number" value="${dy}" data-stroke="${i}" data-field="dy"></label>
        <label>dt<input type="number" value="${dt}" data-stroke="${i}" data-field="dt"></label>
      </div>
    `;
    strokeList.appendChild(row);
  });
}

strokeList.addEventListener('click', e => {
  const deleteBtn = e.target.closest('.btn-delete');
  if (deleteBtn) { deleteStroke(+deleteBtn.dataset.stroke); return; }
  const row = e.target.closest('.stroke-row');
  if (!row || e.target.tagName === 'INPUT') return;
  const i = +row.dataset.stroke;
  selectedStroke = selectedStroke === i ? null : i;
  renderHighlight();
  renderPanel();
});

strokeList.addEventListener('change', e => {
  const input = e.target;
  if (input.tagName !== 'INPUT') return;
  const i = +input.dataset.stroke;
  const field = input.dataset.field;
  strokes[i][0][field] = +input.value;
  updateScrubber();
  renderHighlight();
});

// --- Align ---

btnAlign.addEventListener('click', () => {
  const padding = +padInput.value;
  const abs = toAbsolute(strokes);
  let minX = Infinity, minY = Infinity;
  for (const stroke of abs)
    for (const pt of stroke) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
    }
  strokes[0][0].dx += padding - minX;
  strokes[0][0].dy += padding - minY;
  updateScrubber();
  clearCanvas();
  drawAllStrokes(strokes);
  renderPanel();
});

// --- Compressed format (.scrawlz) ---
// Variable-length base-47 encoding using printable ASCII 33–126.
// Chars 33–79 (47): terminal digit. Chars 80–126 (47): continuation digit.
// Signed integers zig-zag encoded first. No separators — self-delimiting.
// Typical mid-stroke point (dx=2, dy=-3, dt=16) → 3 chars vs "2,-3,16" (7 chars).

function encodeUint(n) {
  let s = '';
  while (n >= 47) { s += String.fromCharCode(n % 47 + 80); n = Math.floor(n / 47); }
  return s + String.fromCharCode(n + 33);
}

function decodeUint(str, pos) {
  let value = 0, mult = 1;
  while (true) {
    const c = str.charCodeAt(pos++);
    if (c >= 80) { value += (c - 80) * mult; mult *= 47; }
    else         { value += (c - 33) * mult; return { value, pos }; }
  }
}

function encodeInt(n)      { return encodeUint(n >= 0 ? n * 2 : -n * 2 - 1); }
function decodeInt(str, pos) {
  const { value: u, pos: p } = decodeUint(str, pos);
  return { value: (u & 1) ? -(u + 1) >> 1 : u >> 1, pos: p };
}

function serializeZ(strokes) {
  return strokes.map(stroke =>
    stroke.map(({ dx, dy, dt }) => encodeInt(dx) + encodeInt(dy) + encodeUint(dt)).join('')
  ).join('\n');
}

function deserializeZ(text) {
  return text.split('\n').filter(l => l.trim()).map(line => {
    const stroke = [];
    let pos = 0;
    while (pos < line.length) {
      const { value: dx, pos: p1 } = decodeInt(line, pos);
      const { value: dy, pos: p2 } = decodeInt(line, p1);
      const { value: dt, pos: p3 } = decodeUint(line, p2);
      stroke.push({ dx, dy, dt });
      pos = p3;
    }
    return stroke;
  });
}

btnExportZ.addEventListener('click', () => {
  const text = serializeZ(strokes);
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'drawing.scrawlz';
  a.click();
  URL.revokeObjectURL(a.href);
});

btnImportZ.addEventListener('click', () => fileInputZ.click());

fileInputZ.addEventListener('change', () => {
  const file = fileInputZ.files[0];
  if (!file) return;
  file.text().then(text => {
    stopReplay();
    strokes = deserializeZ(text);
    cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
    selectedStroke = null;
    clearCanvas();
    drawAllStrokes(strokes);
    btnExport.disabled = false;
    btnExportZ.disabled = false;
    btnExportG.disabled = false;
    btnAlign.disabled = false;
    updateScrubber();
    fileInputZ.value = '';
    renderPanel();
  });
});

// --- Gzip format (.scrawlg) ---
// Gzip-compresses the .scrawl text, then btoa-encodes the result.

async function compressText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function decompressText(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

btnExportG.addEventListener('click', async () => {
  const b64 = await compressText(serialize(strokes));
  const blob = new Blob([b64], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'drawing.scrawlg';
  a.click();
  URL.revokeObjectURL(a.href);
});

btnImportG.addEventListener('click', () => fileInputG.click());

fileInputG.addEventListener('change', () => {
  const file = fileInputG.files[0];
  if (!file) return;
  file.text().then(async b64 => {
    const text = await decompressText(b64);
    stopReplay();
    strokes = deserialize(text);
    cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
    selectedStroke = null;
    clearCanvas();
    drawAllStrokes(strokes);
    btnExport.disabled = false;
    btnExportZ.disabled = false;
    btnExportG.disabled = false;
    btnAlign.disabled = false;
    updateScrubber();
    fileInputG.value = '';
    renderPanel();
  });
});
