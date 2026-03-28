// --- DOM references ---

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
const btnAlignApply = document.getElementById('btn-align-apply');
const btnSmooth = document.getElementById('btn-smooth');
const smoothInput = document.getElementById('smooth-input');
const btnCapDt = document.getElementById('btn-cap-dt');
const capDtInput = document.getElementById('cap-dt-input');
const padXInput = document.getElementById('pad-x-input');
const padYInput = document.getElementById('pad-y-input');
const exportDialog = document.getElementById('export-dialog');
const exportFilenameInput = document.getElementById('export-filename');
const exportGzipCheck = document.getElementById('export-gzip');
const exportCancel = document.getElementById('export-cancel');
const exportConfirm = document.getElementById('export-confirm');
const btnSettings = document.getElementById('btn-settings');
const settingsDialog = document.getElementById('settings-dialog');
const chkSidebarRight = document.getElementById('chk-sidebar-right');
const settingsClose = document.getElementById('settings-close');
const btnSettingsReset = document.getElementById('btn-settings-reset');
const chkGuidelines = document.getElementById('chk-guidelines');

// --- Config ---

const DEFAULT_CONFIG = {
  sidebarRight: false,
  guidelines: true,
};

const config = { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('rescrawl-config') || '{}') };

function saveConfig() {
  localStorage.setItem('rescrawl-config', JSON.stringify(config));
}

if (!config.sidebarRight) document.body.classList.add('panel-left');
chkSidebarRight.checked = config.sidebarRight;
chkGuidelines.checked = config.guidelines;

// --- State ---
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
let insertionPoint = 0; // index in [0..strokes.length]; default is strokes.length (end)
let liveAbsPts = []; // absolute points of in-progress stroke, for smooth live redraw
let smoothMode = false;
let replayAbsStrokes = null;
let replayElapsed = 0;
let replayDuration = 0;

// --- Canvas setup ---

canvas.width = 1080;
canvas.height = 1620;

ctx.strokeStyle = '#000';
ctx.lineWidth = 2;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

const LINE_SPACING = 40;

// --- Drawing ---

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (config.guidelines) {
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
}

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

function drawRawPath(pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

// Smooth pts with a 1-2-1 weighted average, repeated `passes` times.
// First and last points are pinned so endpoints are always exact.
function smoothAverage(pts, passes = 3) {
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

function drawSmoothPath(pts) {
  const s = smoothAverage(pts, +smoothInput.value);
  ctx.beginPath();
  ctx.moveTo(s[0].x, s[0].y);
  for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
  ctx.stroke();
}

function drawPath(pts) {
  smoothMode ? drawSmoothPath(pts) : drawRawPath(pts);
}

function drawAllStrokes(strokesToDraw) {
  let prev = { x: 0, y: 0 };
  for (const stroke of strokesToDraw) {
    if (stroke.length === 1) {
      prev = { x: prev.x + stroke[0].dx, y: prev.y + stroke[0].dy };
      drawDot(prev);
      continue;
    }
    const pts = [];
    for (const { dx, dy } of stroke) {
      prev = { x: prev.x + dx, y: prev.y + dy };
      pts.push({ x: prev.x, y: prev.y });
    }
    drawPath(pts);
  }
}

function drawInsertionCrosshair() {
  if (strokes.length === 0 || insertionPoint >= strokes.length) return;
  const { x, y } = getInsertionAbs(insertionPoint);
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

function renderHighlight() {
  clearCanvas();
  drawAllStrokes(strokes);
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
      drawDot(prev);
    } else {
      const pts = [];
      for (const { dx, dy } of stroke) {
        prev = { x: prev.x + dx, y: prev.y + dy };
        pts.push({ x: prev.x, y: prev.y });
      }
      drawPath(pts);
    }
    ctx.restore();
  }
  drawInsertionCrosshair();
}

clearCanvas();

// --- Geometry ---

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

function getInsertionAbs(k) {
  let pos = { x: 0, y: 0, t: 0 };
  for (let i = 0; i < k; i++)
    for (const { dx, dy, dt } of strokes[i]) { pos.x += dx; pos.y += dy; pos.t += dt; }
  return pos;
}

// --- Transforms ---

const dataTransforms = [];

const capDtTransform = {
  enabled: false,
  button: btnCapDt,
  apply(strokes) {
    const max = +capDtInput.value;
    return strokes.map(stroke =>
      stroke.map(({ dx, dy, dt }) => ({ dx, dy, dt: Math.min(dt, max) }))
    );
  },
};
dataTransforms.push(capDtTransform);

const alignTransform = {
  enabled: false,
  button: btnAlign,
  apply(strokes) {
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
      [{ ...first[0], dx: first[0].dx + +padXInput.value - minX, dy: first[0].dy + +padYInput.value - minY }, ...first.slice(1)],
      ...strokes.slice(1),
    ];
  },
};
dataTransforms.push(alignTransform);

function getEffectiveStrokes() {
  return dataTransforms
    .filter(t => t.enabled)
    .reduce((s, t) => t.apply(s), strokes);
}

function resetModes() {
  for (const t of dataTransforms) {
    t.enabled = false;
    t.button.classList.remove('active');
  }
  canvas.classList.remove('no-draw');
  btnAlignApply.disabled = true;
  smoothMode = false;
  btnSmooth.classList.remove('active');
}

// --- Replay ---

function drawUpTo(elapsed) {
  clearCanvas();
  for (const stroke of replayAbsStrokes) {
    if (stroke[0].t > elapsed) break;
    if (stroke.length === 1) { drawDot(stroke[0]); continue; }
    const pts = [];
    for (const pt of stroke) {
      if (pt.t > elapsed) break;
      pts.push(pt);
    }
    if (pts.length >= 2) drawPath(pts);
  }
}

function updateScrubber() {
  replayAbsStrokes = toAbsolute(getEffectiveStrokes());
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

// --- Stroke operations ---

function swapAdjacentStrokes(i) {
  // Swap strokes[i] and strokes[i+1], preserving absolute canvas positions.
  // Recalculates dx/dy of first points for the two swapped strokes and the
  // following stroke; dt is never touched.
  const j = i + 1;
  if (j >= strokes.length) return;

  const A = strokes[i], B = strokes[j];

  let sumAdx = 0, sumAdy = 0;
  for (const { dx, dy } of A) { sumAdx += dx; sumAdy += dy; }
  let sumBdx = 0, sumBdy = 0;
  for (const { dx, dy } of B) { sumBdx += dx; sumBdy += dy; }

  // B goes to position i (now starts relative to prevEnd instead of eA)
  const newBdx = sumAdx + B[0].dx;
  const newBdy = sumAdy + B[0].dy;
  // A goes to position j (now starts relative to eB instead of prevEnd)
  const newAdx = A[0].dx - sumAdx - sumBdx;
  const newAdy = A[0].dy - sumAdy - sumBdy;

  strokes[i] = B;
  strokes[j] = A;
  strokes[i][0] = { ...strokes[i][0], dx: newBdx, dy: newBdy };
  strokes[j][0] = { ...strokes[j][0], dx: newAdx, dy: newAdy };

  // The stroke after j (C) now follows A (ends at eA) instead of B (ends at eB)
  if (j + 1 < strokes.length) {
    const C = strokes[j + 1];
    C[0] = { ...C[0], dx: C[0].dx + sumBdx, dy: C[0].dy + sumBdy };
  }

  cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
  updateScrubber();
  renderHighlight();
  renderPanel();
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
  if (insertionPoint > i) insertionPoint--;
  cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
  selectedStroke = null;
  btnExport.disabled = strokes.length === 0;
  updateScrubber();
  renderHighlight();
  renderPanel();
}

// --- Serialization & compression ---
// Text format (.scrawl): one stroke per line, points separated by ';', values by ','
// Every token is dx,dy,dt. In-memory format matches exactly — no conversion needed.
// Gzip format (.scrawl.gz): gzip-compresses the .scrawl text, then btoa-encodes the result.

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

// --- Panel ---

function renderPanel() {
  if (strokes.length === 0) {
    strokeList.innerHTML = '<div id="no-strokes">No strokes yet</div>';
    return;
  }
  function makeCursor(pos) {
    const d = document.createElement('div');
    d.className = 'stroke-cursor' + (pos === insertionPoint ? ' active' : '');
    d.dataset.pos = pos;
    return d;
  }
  strokeList.innerHTML = '';
  strokeList.appendChild(makeCursor(0));
  strokes.forEach((stroke, i) => {
    const { dx, dy, dt } = stroke[0];
    const row = document.createElement('div');
    row.className = 'stroke-row' + (i === selectedStroke ? ' selected' : '');
    row.dataset.stroke = i;
    row.innerHTML = `
      <div class="stroke-header">
        <div class="stroke-label">Stroke ${i + 1}</div>
        <div class="stroke-actions">
          <button class="btn-move-up" data-stroke="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-move-down" data-stroke="${i}" ${i === strokes.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn-delete" data-stroke="${i}">×</button>
        </div>
      </div>
      <div class="stroke-fields">
        <label>dx<input type="number" value="${dx}" data-stroke="${i}" data-field="dx"></label>
        <label>dy<input type="number" value="${dy}" data-stroke="${i}" data-field="dy"></label>
        <label>dt<input type="number" value="${dt}" data-stroke="${i}" data-field="dt"></label>
      </div>
    `;
    strokeList.appendChild(row);
    strokeList.appendChild(makeCursor(i + 1));
  });
}

// --- Event handlers ---

// Settings
btnSettings.addEventListener('click', () => {
  chkSidebarRight.checked = config.sidebarRight;
  settingsDialog.showModal();
});
settingsClose.addEventListener('click', () => settingsDialog.close());

chkSidebarRight.addEventListener('change', () => {
  config.sidebarRight = chkSidebarRight.checked;
  document.body.classList.toggle('panel-left', !config.sidebarRight);
  saveConfig();
});

btnSettingsReset.addEventListener('click', () => {
  Object.assign(config, DEFAULT_CONFIG);
  saveConfig();
  chkSidebarRight.checked = config.sidebarRight;
  document.body.classList.toggle('panel-left', !config.sidebarRight);
  chkGuidelines.checked = config.guidelines;
  renderHighlight();
});

// Canvas input
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
  if (alignTransform.enabled) return;
  canvas.setPointerCapture(e.pointerId);
  if (strokes.length === 0 && currentStroke === null) startTime = performance.now();
  const pt = pointerPt(e);
  lastAbsPt = pt;
  const insertAbs = getInsertionAbs(insertionPoint);
  currentStroke = [{ dx: pt.x - insertAbs.x, dy: pt.y - insertAbs.y, dt: pt.t - insertAbs.t }];
  liveAbsPts = [{ x: pt.x, y: pt.y }];
});

canvas.addEventListener('pointermove', e => {
  if (currentStroke === null) return;
  const pt = pointerPt(e);
  const dx = pt.x - lastAbsPt.x, dy = pt.y - lastAbsPt.y;
  if (dx === 0 && dy === 0) return;
  const prevAbsPt = lastAbsPt;
  currentStroke.push({ dx, dy, dt: pt.t - lastAbsPt.t });
  lastAbsPt = pt;
  if (smoothMode) {
    liveAbsPts.push({ x: pt.x, y: pt.y });
    clearCanvas();
    drawAllStrokes(strokes);
    if (liveAbsPts.length >= 2) drawSmoothPath(liveAbsPts);
    else drawDot(liveAbsPts[0]);
    drawInsertionCrosshair();
  } else {
    drawSegment(prevAbsPt, pt);
  }
});

canvas.addEventListener('pointerup', () => {
  if (currentStroke === null) return;
  if (currentStroke.length === 1) drawDot(lastAbsPt);
  const k = insertionPoint;
  strokes.splice(k, 0, currentStroke);
  if (k + 1 < strokes.length) {
    let sumDx = 0, sumDy = 0;
    for (const { dx, dy } of currentStroke) { sumDx += dx; sumDy += dy; }
    strokes[k + 1][0].dx -= sumDx;
    strokes[k + 1][0].dy -= sumDy;
  }
  insertionPoint = k + 1;
  cursorAbs = lastAbsPt;
  lastAbsPt = null;
  currentStroke = null;
  btnExport.disabled = false;
  updateScrubber();
  renderHighlight();
  renderPanel();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointercancel', () => {
  if (currentStroke === null) return;
  const k = insertionPoint;
  strokes.splice(k, 0, currentStroke);
  if (k + 1 < strokes.length) {
    let sumDx = 0, sumDy = 0;
    for (const { dx, dy } of currentStroke) { sumDx += dx; sumDy += dy; }
    strokes[k + 1][0].dx -= sumDx;
    strokes[k + 1][0].dy -= sumDy;
  }
  insertionPoint = k + 1;
  cursorAbs = lastAbsPt;
  lastAbsPt = null;
  currentStroke = null;
});

// Playback
btnPlay.addEventListener('click', () => {
  if (replayHandle !== null) pauseReplay();
  else startReplay();
});

scrubber.addEventListener('input', () => {
  pauseReplay();
  replayElapsed = +scrubber.value;
  drawUpTo(replayElapsed);
});

// Clear
btnClear.addEventListener('click', () => {
  if (!confirm('Clear all strokes?')) return;
  stopReplay();
  clearCanvas();
  strokes = [];
  currentStroke = null;
  cursorAbs = { x: 0, y: 0, t: 0 };
  selectedStroke = null;
  insertionPoint = 0;
  btnExport.disabled = true;
  status.textContent = '';
  updateScrubber();
  renderPanel();
});

// Import / Export
btnExport.addEventListener('click', () => {
  exportFilenameInput.value = '';
  exportGzipCheck.checked = false;
  exportDialog.showModal();
});

exportCancel.addEventListener('click', () => exportDialog.close());

exportConfirm.addEventListener('click', async () => {
  const name = exportFilenameInput.value.trim() || 'drawing';
  const gz = exportGzipCheck.checked;
  const text = serialize(getEffectiveStrokes());
  const content = gz ? await compressText(text) : text;
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + (gz ? '.scrawl.gz' : '.scrawl');
  a.click();
  URL.revokeObjectURL(a.href);
  exportDialog.close();
});

btnImport.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const raw = await file.text();
  const text = file.name.endsWith('.gz') ? await decompressText(raw) : raw;
  stopReplay();
  resetModes();
  strokes = deserialize(text);
  cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
  selectedStroke = null;
  insertionPoint = strokes.length;
  btnExport.disabled = strokes.length === 0;
  updateScrubber();
  renderHighlight();
  fileInput.value = '';
  renderPanel();
});

// Panel
strokeList.addEventListener('click', e => {
  const cursorEl = e.target.closest('.stroke-cursor');
  if (cursorEl) {
    insertionPoint = +cursorEl.dataset.pos;
    renderHighlight();
    renderPanel();
    return;
  }
  const deleteBtn = e.target.closest('.btn-delete');
  if (deleteBtn) { deleteStroke(+deleteBtn.dataset.stroke); return; }
  const moveUpBtn = e.target.closest('.btn-move-up');
  if (moveUpBtn) {
    const i = +moveUpBtn.dataset.stroke;
    swapAdjacentStrokes(i - 1);
    if (selectedStroke === i) selectedStroke = i - 1;
    else if (selectedStroke === i - 1) selectedStroke = i;
    return;
  }
  const moveDownBtn = e.target.closest('.btn-move-down');
  if (moveDownBtn) {
    const i = +moveDownBtn.dataset.stroke;
    swapAdjacentStrokes(i);
    if (selectedStroke === i) selectedStroke = i + 1;
    else if (selectedStroke === i + 1) selectedStroke = i;
    return;
  }
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

// Align
btnAlign.addEventListener('click', () => {
  alignTransform.enabled = !alignTransform.enabled;
  btnAlign.classList.toggle('active', alignTransform.enabled);
  btnAlignApply.disabled = !alignTransform.enabled;
  canvas.classList.toggle('no-draw', alignTransform.enabled);
  updateScrubber();
  clearCanvas();
  drawAllStrokes(getEffectiveStrokes());
  drawInsertionCrosshair();
});

btnAlignApply.addEventListener('click', () => {
  const abs = toAbsolute(strokes);
  let minX = Infinity, minY = Infinity;
  for (const stroke of abs)
    for (const pt of stroke) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
    }
  strokes[0][0].dx += +padXInput.value - minX;
  strokes[0][0].dy += +padYInput.value - minY;
  cursorAbs = toAbsolute(strokes).flat().at(-1) ?? { x: 0, y: 0, t: 0 };
  alignTransform.enabled = false;
  btnAlign.classList.remove('active');
  btnAlignApply.disabled = true;
  canvas.classList.remove('no-draw');
  updateScrubber();
  renderHighlight();
  renderPanel();
});

function onPadInput() {
  if (alignTransform.enabled) {
    updateScrubber();
    clearCanvas();
    drawAllStrokes(getEffectiveStrokes());
    drawInsertionCrosshair();
  }
}
padXInput.addEventListener('input', onPadInput);
padYInput.addEventListener('input', onPadInput);

// Transforms
btnCapDt.addEventListener('click', () => {
  capDtTransform.enabled = !capDtTransform.enabled;
  btnCapDt.classList.toggle('active', capDtTransform.enabled);
  updateScrubber();
});

capDtInput.addEventListener('input', () => {
  if (capDtTransform.enabled) updateScrubber();
});

// Draw modes
btnSmooth.addEventListener('click', () => {
  smoothMode = !smoothMode;
  btnSmooth.classList.toggle('active', smoothMode);
  renderHighlight();
});

smoothInput.addEventListener('input', () => {
  if (smoothMode) renderHighlight();
});

chkGuidelines.addEventListener('change', () => {
  config.guidelines = chkGuidelines.checked;
  saveConfig();
  renderHighlight();
});
