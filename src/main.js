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

clearCanvas();

// --- Drawing ---

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.strokeStyle = '#c8d8f0';
  ctx.lineWidth = 1;
  for (let y = 40; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSegment(a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
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
  drawSegment(lastAbsPt, pt);
  currentStroke.push({ dx: pt.x - lastAbsPt.x, dy: pt.y - lastAbsPt.y, dt: pt.t - lastAbsPt.t });
  lastAbsPt = pt;
});

canvas.addEventListener('pointerup', () => {
  if (currentStroke === null) return;
  strokes.push(currentStroke);
  cursorAbs = lastAbsPt;
  lastAbsPt = null;
  currentStroke = null;
  btnExport.disabled = false;
  updateScrubber();
  renderPanel();
});

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
    if (stroke.length < 2) continue;
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
    if (stroke.length < 2) {
      for (const { dx, dy } of stroke) prev = { x: prev.x + dx, y: prev.y + dy };
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
  ctx.beginPath();
  let first = true;
  for (const { dx, dy } of stroke) {
    prev = { x: prev.x + dx, y: prev.y + dy };
    if (first) { ctx.moveTo(prev.x, prev.y); first = false; }
    else ctx.lineTo(prev.x, prev.y);
  }
  ctx.stroke();
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
  renderHighlight();
});
