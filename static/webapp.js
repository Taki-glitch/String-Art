const constrain = (val, min, max) => (val < min ? min : (val > max ? max : val));
const mapRange = (value, x1, y1, x2, y2) => (value - x1) * (y2 - x2) / (y1 - x1) + x2;

class Color {
  constructor(r, g, b, a = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  toCss(alphaScale = 1) {
    return `rgba(${this.r}, ${this.g}, ${this.b}, ${constrain(this.a * alphaScale, 0, 1)})`;
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const state = {
  sourceImage: null,
  sourceData: null,
  instructions: [],
  nailPoints: [],
  lineCache: new Map(),
  cancel: false,
  anim: {
    running: false,
    index: 0,
    accumulator: 0,
    lastTs: undefined,
  },
};

const ui = {
  imageInput: document.getElementById('image-input'),
  sourcePreviewWrap: document.getElementById('source-preview-wrap'),
  sourcePreview: document.getElementById('source-preview'),
  nails: document.getElementById('nails'),
  lines: document.getElementById('lines'),
  size: document.getElementById('size'),
  lineWeight: document.getElementById('line-weight'),
  colorMode: document.getElementById('color-mode'),
  summaryText: document.getElementById('summary-text'),
  generateBtn: document.getElementById('generate-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  exportPngBtn: document.getElementById('export-png-btn'),
  exportTxtBtn: document.getElementById('export-txt-btn'),
  exportPdfBtn: document.getElementById('export-pdf-btn'),
  progress: document.getElementById('progress'),
  status: document.getElementById('status'),
  instructionsList: document.getElementById('instructions-list'),
  stepsCount: document.getElementById('steps-count'),
  resultCanvas: document.getElementById('result-canvas'),
  schemaCanvas: document.getElementById('schema-canvas'),
  animationCanvas: document.getElementById('animation-canvas'),
  speedInput: document.getElementById('speed-input'),
  progressInput: document.getElementById('progress-input'),
  playBtn: document.getElementById('play-btn'),
  pauseBtn: document.getElementById('pause-btn'),
  resetBtn: document.getElementById('reset-btn'),
  animationStatus: document.getElementById('animation-status'),
};

function refreshSummary() {
  const c = ui.colorMode.checked ? ' · mode couleur' : '';
  ui.summaryText.textContent = `${ui.nails.value} clous · ${ui.lines.value} fils · ${ui.size.value}px · épaisseur ${ui.lineWeight.value}${c}`;
}

function createCirclePoints(nails, size) {
  const center = Math.floor(size / 2);
  const radius = Math.floor(size / 2) - 12;
  const points = [];
  for (let i = 0; i < nails; i += 1) {
    const angle = (2 * Math.PI * i) / nails;
    points.push(new Point(
      Math.round(center + radius * Math.cos(angle)),
      Math.round(center + radius * Math.sin(angle)),
    ));
  }
  return points;
}

function bresenham(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

function precomputeLineCache(points) {
  state.lineCache.clear();
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      state.lineCache.set(`${i}|${j}`, bresenham(points[i].x, points[i].y, points[j].x, points[j].y));
    }
  }
}

function getLinePixels(a, b) {
  const i = Math.min(a, b);
  const j = Math.max(a, b);
  return state.lineCache.get(`${i}|${j}`) || [];
}

function drawSourceToData(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');

  const sourceRatio = state.sourceImage.width / state.sourceImage.height;
  const targetRatio = 1;
  let sx = 0;
  let sy = 0;
  let sw = state.sourceImage.width;
  let sh = state.sourceImage.height;

  if (sourceRatio > targetRatio) {
    sw = state.sourceImage.height;
    sx = Math.floor((state.sourceImage.width - sw) / 2);
  } else {
    sh = state.sourceImage.width;
    sy = Math.floor((state.sourceImage.height - sh) / 2);
  }

  ctx.drawImage(state.sourceImage, sx, sy, sw, sh, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function channelData(data, ch) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) out[j] = data[i + ch];
  return out;
}

function toGray(data) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

function pixelIndex(x, y, size) {
  return y * size + x;
}

function renderInstructionsList(max = 300) {
  ui.instructionsList.innerHTML = '';
  const shown = state.instructions.slice(0, max);
  shown.forEach((s) => {
    const li = document.createElement('li');
    li.textContent = `Clou ${s.start} → Clou ${s.end} (${s.color})`;
    ui.instructionsList.appendChild(li);
  });
  ui.stepsCount.textContent = String(state.instructions.length);
}

function drawSchema(size) {
  const ctx = ui.schemaCanvas.getContext('2d');
  ui.schemaCanvas.width = size;
  ui.schemaCanvas.height = size;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  const colorMap = { noir: '#111', rouge: '#d11', vert: '#1a8a1a', bleu: '#1456e0' };
  ctx.lineWidth = 1;
  state.instructions.forEach((s) => {
    const p1 = state.nailPoints[s.start];
    const p2 = state.nailPoints[s.end];
    ctx.strokeStyle = colorMap[s.color] || '#111';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  });

  ctx.fillStyle = '#000';
  ctx.font = '10px Arial';
  state.nailPoints.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(i), p.x + 6, p.y + 6);
  });
}

function renderRealisticResult(size) {
  const canvas = ui.resultCanvas;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4eee1';
  ctx.fillRect(0, 0, size, size);

  const colors = {
    noir: new Color(20, 20, 20, 0.14),
    rouge: new Color(190, 32, 46, 0.14),
    vert: new Color(52, 128, 68, 0.14),
    bleu: new Color(40, 90, 170, 0.14),
  };

  state.instructions.forEach((step) => {
    const p1 = state.nailPoints[step.start];
    const p2 = state.nailPoints[step.end];
    ctx.strokeStyle = (colors[step.color] || colors.noir).toCss();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  });

  state.nailPoints.forEach((p) => {
    const r = constrain(mapRange(state.nailPoints.length, 40, 320, 2.8, 1.8), 1.8, 2.8);
    ctx.beginPath();
    ctx.fillStyle = '#555';
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

async function generateChannel(targetChannel, size, points, totalLines, lineWeight, colorName) {
  const target = targetChannel;
  const currentCanvas = new Float32Array(target.length);
  currentCanvas.fill(255);

  let currentNail = 0;
  let previousNail = -1;
  const out = [];
  const previousConnections = new Map();
  const fade = constrain(mapRange(lineWeight, 5, 50, 0.03, 0.22), 0.03, 0.22);
  const minJump = Math.max(2, Math.floor(points.length / 42));

  for (let step = 0; step < totalLines; step += 1) {
    if (state.cancel) return out;

    let bestCandidate = -1;
    let bestScore = Infinity;
    let bestPixels = null;

    for (let candidate = 0; candidate < points.length; candidate += 1) {
      if (candidate === currentNail || candidate === previousNail) continue;

      const dist = Math.abs(candidate - currentNail);
      const ringDist = Math.min(dist, points.length - dist);
      if (ringDist <= minJump) continue;

      const seen = previousConnections.get(currentNail);
      if (seen && seen.has(candidate)) continue;

      const pixels = getLinePixels(currentNail, candidate);
      if (!pixels.length) continue;

      let score = 0;
      for (let i = 0; i < pixels.length; i += 1) {
        const [x, y] = pixels[i];
        const k = pixelIndex(x, y, size);
        const oldVal = currentCanvas[k];
        const newVal = oldVal * (1 - fade);
        const delta = Math.abs(target[k] - newVal) - Math.abs(target[k] - oldVal);
        score += delta < 0 ? delta : delta / 5;
      }
      score = Math.pow(score / pixels.length, 3);

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
        bestPixels = pixels;
      }
    }

    if (bestCandidate < 0 || bestScore >= 0) break;

    bestPixels.forEach(([x, y]) => {
      const k = pixelIndex(x, y, size);
      currentCanvas[k] = currentCanvas[k] * (1 - fade);
    });

    if (!previousConnections.has(currentNail)) previousConnections.set(currentNail, new Set());
    previousConnections.get(currentNail).add(bestCandidate);

    out.push({ start: currentNail, end: bestCandidate, color: colorName });
    previousNail = currentNail;
    currentNail = bestCandidate;

    if (step % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  return out;
}

function interleaveChannels(channelInstructions) {
  const buckets = channelInstructions.map((arr) => [...arr]);
  const out = [];
  let i = 0;
  while (buckets.some((arr) => arr.length > 0)) {
    if (buckets[i].length) out.push(buckets[i].shift());
    i = (i + 1) % buckets.length;
  }
  return out;
}

function drawAnimationFrame(targetIndex) {
  const canvas = ui.animationCanvas;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4eee1';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const colors = {
    noir: new Color(20, 20, 20, 0.16),
    rouge: new Color(190, 32, 46, 0.16),
    vert: new Color(52, 128, 68, 0.16),
    bleu: new Color(40, 90, 170, 0.16),
  };

  for (let i = 0; i < targetIndex; i += 1) {
    const step = state.instructions[i];
    const p1 = state.nailPoints[step.start];
    const p2 = state.nailPoints[step.end];
    ctx.strokeStyle = (colors[step.color] || colors.noir).toCss();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  const r = constrain(mapRange(state.nailPoints.length, 40, 320, 2.8, 1.8), 1.8, 2.8);
  state.nailPoints.forEach((p) => {
    ctx.beginPath();
    ctx.fillStyle = '#555';
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  ui.animationStatus.textContent = `${targetIndex} / ${state.instructions.length} fils tracés`;
  ui.progressInput.value = String(targetIndex);
}

function resetAnimation() {
  state.anim.running = false;
  state.anim.index = 0;
  state.anim.accumulator = 0;
  state.anim.lastTs = undefined;
  drawAnimationFrame(0);
}

function tickAnimation(ts) {
  if (!state.anim.running) return;
  if (state.anim.lastTs === undefined) state.anim.lastTs = ts;
  const delta = (ts - state.anim.lastTs) / 1000;
  state.anim.lastTs = ts;
  state.anim.accumulator += delta;

  const speed = constrain(Number(ui.speedInput.value) || 1, 1, 240);
  const stepDuration = 1 / speed;

  while (state.anim.accumulator >= stepDuration && state.anim.index < state.instructions.length) {
    state.anim.index += 1;
    state.anim.accumulator -= stepDuration;
  }

  drawAnimationFrame(state.anim.index);

  if (state.anim.index >= state.instructions.length) {
    state.anim.running = false;
    return;
  }
  requestAnimationFrame(tickAnimation);
}

async function generate() {
  if (!state.sourceImage) {
    ui.status.textContent = 'Choisis une image avant de générer.';
    return;
  }

  state.cancel = false;
  state.anim.running = false;
  ui.generateBtn.disabled = true;

  const nails = Math.max(40, Math.min(320, Number(ui.nails.value) || 180));
  const lines = Math.max(50, Math.min(5000, Number(ui.lines.value) || 1200));
  const size = Math.max(300, Math.min(1000, Number(ui.size.value) || 760));
  const lineWeight = Math.max(4, Math.min(40, Number(ui.lineWeight.value) || 16));
  const colorMode = ui.colorMode.checked;

  ui.progress.value = 2;
  ui.status.textContent = 'Préparation...';

  const source = drawSourceToData(size);
  state.sourceData = source;
  state.nailPoints = createCirclePoints(nails, size);
  state.instructions = [];
  precomputeLineCache(state.nailPoints);

  ui.resultCanvas.width = size;
  ui.resultCanvas.height = size;
  ui.schemaCanvas.width = size;
  ui.schemaCanvas.height = size;
  ui.animationCanvas.width = size;
  ui.animationCanvas.height = size;

  if (!colorMode) {
    ui.status.textContent = 'Génération noir et blanc...';
    const gray = toGray(source);
    const steps = await generateChannel(gray, size, state.nailPoints, lines, lineWeight, 'noir');
    if (!state.cancel) state.instructions = steps;
  } else {
    const split = Math.max(1, Math.floor(lines / 3));
    const channels = [
      { name: 'rouge', data: channelData(source, 0), p: 25 },
      { name: 'vert', data: channelData(source, 1), p: 50 },
      { name: 'bleu', data: channelData(source, 2), p: 75 },
    ];

    const allSteps = [];
    for (const ch of channels) {
      ui.progress.value = ch.p;
      ui.status.textContent = `Génération ${ch.name}...`;
      const steps = await generateChannel(ch.data, size, state.nailPoints, split, lineWeight, ch.name);
      if (state.cancel) break;
      allSteps.push(steps);
    }

    if (!state.cancel) state.instructions = interleaveChannels(allSteps);
  }

  if (!state.cancel) {
    renderRealisticResult(size);
    drawSchema(size);
    renderInstructionsList();
    ui.progress.value = 100;
    ui.status.textContent = `Terminé: ${state.instructions.length} fils.`;

    ui.progressInput.max = String(state.instructions.length);
    resetAnimation();
  } else {
    ui.status.textContent = 'Génération annulée.';
  }

  ui.generateBtn.disabled = false;
}

function exportPng() {
  const url = ui.resultCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'string-art-result.png';
  a.click();
}

function exportTxt() {
  const lines = state.instructions.map((s, i) => `${String(i + 1).padStart(4, '0')}. Clou ${s.start} -> Clou ${s.end} (${s.color})`);
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'instructions-string-art.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPdf() {
  if (!window.jspdf?.jsPDF) {
    ui.status.textContent = 'jsPDF indisponible. Vérifie ta connexion internet.';
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  pdf.setFontSize(14);
  pdf.text('String Art - Plan de réalisation', 40, 40);

  const schema = ui.schemaCanvas.toDataURL('image/png');
  const result = ui.resultCanvas.toDataURL('image/png');
  pdf.addImage(schema, 'PNG', 40, 60, 240, 240);
  pdf.addImage(result, 'PNG', 310, 60, 240, 240);

  let y = 330;
  pdf.setFontSize(10);
  state.instructions.forEach((s, i) => {
    if (y > 800) {
      pdf.addPage();
      y = 40;
    }
    pdf.text(`${String(i + 1).padStart(4, '0')}. Clou ${s.start} -> Clou ${s.end} (${s.color})`, 40, y);
    y += 12;
  });

  pdf.save('string-art-plan.pdf');
}

ui.imageInput.addEventListener('change', (e) => {
  const [file] = e.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    ui.sourcePreview.src = ev.target.result;
    ui.sourcePreviewWrap.classList.remove('hidden');
    const img = new Image();
    img.onload = () => {
      state.sourceImage = img;
      ui.status.textContent = 'Image chargée. Prêt à générer.';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

[ui.nails, ui.lines, ui.size, ui.lineWeight, ui.colorMode].forEach((el) => {
  el.addEventListener('input', refreshSummary);
  el.addEventListener('change', refreshSummary);
});

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.preset;
    const presets = {
      fast: { nails: 120, lines: 600, size: 560, lw: 18, color: false },
      balanced: { nails: 180, lines: 1200, size: 760, lw: 16, color: false },
      detailed: { nails: 240, lines: 2200, size: 920, lw: 12, color: false },
      color: { nails: 200, lines: 1500, size: 820, lw: 14, color: true },
    };
    const v = presets[p];
    if (!v) return;
    ui.nails.value = v.nails;
    ui.lines.value = v.lines;
    ui.size.value = v.size;
    ui.lineWeight.value = v.lw;
    ui.colorMode.checked = v.color;
    refreshSummary();
  });
});

ui.generateBtn.addEventListener('click', generate);
ui.cancelBtn.addEventListener('click', () => { state.cancel = true; });
ui.exportPngBtn.addEventListener('click', exportPng);
ui.exportTxtBtn.addEventListener('click', exportTxt);
ui.exportPdfBtn.addEventListener('click', exportPdf);

ui.playBtn.addEventListener('click', () => {
  if (!state.instructions.length) return;
  if (state.anim.index >= state.instructions.length) resetAnimation();
  if (!state.anim.running) {
    state.anim.running = true;
    requestAnimationFrame(tickAnimation);
  }
});
ui.pauseBtn.addEventListener('click', () => { state.anim.running = false; });
ui.resetBtn.addEventListener('click', resetAnimation);
ui.progressInput.addEventListener('input', (e) => {
  state.anim.running = false;
  state.anim.index = constrain(Number(e.target.value) || 0, 0, state.instructions.length);
  drawAnimationFrame(state.anim.index);
});

refreshSummary();
resetAnimation();
